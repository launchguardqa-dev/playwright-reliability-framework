import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Browser, chromium, Page } from '@playwright/test';
import {
  collectEvents, checkHttp, checkJavaScript, checkNetwork, checkImages,
  checkAccessibility, checkMobile, checkPerformance, isFirstParty,
} from './checks';
import { analyzePdf, looksLikePdfLink, pdfFindings } from './pdf';
import { detectBlock } from './blocked';
import { hasPdfSignature, isHostedDocumentLink } from './document-hosts';
import { fetchRobots, Robots, SCOUT_TOKEN } from './robots';
import { Finding, PageResult, PdfResult, ScoutOptions, ScoutResult, Severity, Confidence } from './types';

/**
 * Crawls a site and runs every check on each page.
 *
 * Safety rules (enforced here, not just documented):
 * - Same origin only: links to other sites are never visited.
 * - Read-only: Scout navigates with GET and never clicks or submits anything,
 *   except the login steps the operator explicitly configures in a profile.
 * - Polite: a delay between page loads and a hard page limit.
 *
 * Public scans (mode "public", for sites you have NOT been given permission to test)
 * are stricter, and the limits are enforced here so no caller can bypass them:
 * - At most PUBLIC_MAX_PAGES pages (the start page plus 2 more).
 * - At least PUBLIC_MIN_DELAY_MS between requests (or the site's Crawl-delay, if longer).
 * - robots.txt is obeyed; if the start page is disallowed, the scan refuses to run.
 * - Identified: the User-Agent names the tool and a contact address, also sent as From.
 * - No login profiles, no broken-link checking of unvisited pages.
 * - PDFs are never downloaded: at most PUBLIC_MAX_PDF_HEADS HEAD requests for size.
 */

export const PUBLIC_MAX_PAGES = 3;
export const PUBLIC_MIN_DELAY_MS = 5_000;
export const PUBLIC_MAX_PDF_HEADS = 5;
const MAX_CRAWL_DELAY_MS = 30_000;
const DEFAULT_MAX_PDFS = 20;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const SKIP_EXTENSIONS = /\.(pdf|zip|gz|dmg|exe|msi|png|jpe?g|gif|svg|webp|mp4|mp3|woff2?|css|js)(\?|$)/i;
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CONFIDENCE_ORDER: Confidence[] = ['confirmed', 'likely', 'heuristic'];
/** Evidence samples kept per merged finding (enough to act on, small enough to read). */
const MAX_SAMPLES = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Errors that mean the page navigated (or reloaded) while Scout was reading it. */
export function isNavigationError(message: string): boolean {
  return /execution context was destroyed|because of a navigation|navigated while being checked|frame was detached|target (page, context or browser )?has been closed|cannot find context with specified id/i.test(message);
}

/** One finding per page whose checks couldn't be completed (it kept navigating, or a check failed). */
function incompleteFindings(list: { url: string; reason: string }[]): Finding[] {
  return list.map(({ url, reason }) => ({
    rule: 'page-check-incomplete',
    title: 'Page changed while being checked',
    severity: 'low' as const, confidence: 'confirmed' as const, category: 'http' as const,
    pages: [url],
    detail: `${url}: checks incomplete (${reason}). Other pages were scanned normally; check this one by hand.`,
  }));
}

/** What analyzing one loaded page produced. Committed by the crawl loop only on success. */
type PageOutcome =
  | { kind: 'page'; result: PageResult; rendered: boolean; names: string[]; fingerprint?: string; links: { href: string; inNav: boolean }[] }
  | { kind: 'duplicate'; sameAs: string; names: string[] }
  | { kind: 'blocked'; blocked: NonNullable<ScoutResult['blocked']> }
  | { kind: 'incomplete'; reason: string };

/**
 * Query parameters that never change what a page shows: tracking tags, and language
 * switches like Granicus/OpenCities' oc_lang. Dropping them stops one page from being
 * crawled several times under different URLs.
 */
const NO_OP_PARAMS = /^(utm_[a-z]+|oc_lang|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|ref_src)$/i;

/** Canonical form of a URL for crawling: no fragment, no no-op query params. */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (NO_OP_PARAMS.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}
const normalize = normalizeUrl;

/** Identity of a page for duplicate detection: normalized, host lowercased, no trailing slash. */
export function pageKey(url: string): string {
  const u = new URL(normalizeUrl(url));
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '/';
  return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
}

async function login(page: Page, options: ScoutOptions): Promise<number> {
  const cfg = options.profile.login!;
  const username = options.username ?? process.env.SCOUT_USERNAME ?? cfg.username ?? '';
  const password = options.password ?? process.env.SCOUT_PASSWORD ?? cfg.password ?? '';
  const fill = (value: string) => value.replace('{{username}}', username).replace('{{password}}', password);

  await page.goto(cfg.url);
  const start = Date.now();
  for (const step of cfg.steps) {
    if (step.fill) await page.fill(step.fill, fill(step.value ?? ''));
    if (step.click) await page.click(step.click);
  }
  try {
    await page.waitForSelector(cfg.successSelector, { timeout: 30_000 });
  } catch {
    throw new Error(`Login failed: "${cfg.successSelector}" never appeared after the login steps.`);
  }
  return Date.now() - start;
}

/** Merges identical findings from different pages into one, listing every page. */
export function dedupe(findings: Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule}|${f.title}|${f.detail}`;
    const existing = merged.get(key);
    if (existing) {
      existing.pages = [...new Set([...existing.pages, ...f.pages])];
      existing.screenshot ??= f.screenshot;
      if (f.samples?.length) {
        existing.samples = [...new Set([...(existing.samples ?? []), ...f.samples])].slice(0, MAX_SAMPLES);
      }
    } else {
      merged.set(key, { ...f, pages: [...f.pages] });
    }
  }
  return [...merged.values()].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence)
    || b.pages.length - a.pages.length);
}

/**
 * User-Agent that identifies Scout. Keeps the "Mozilla/5.0 (compatible; ...)" form crawlers use.
 * With a contact it's for the scanned site only; without one it's the browser-wide default,
 * so third parties (fonts, maps, video players) see the tool's name but never the email.
 */
export function scoutUserAgent(contact?: string): string {
  return `Mozilla/5.0 (compatible; ${SCOUT_TOKEN}/1.0; accessibility audit${contact ? `; contact: ${contact}` : ''})`;
}

export async function runScout(options: ScoutOptions, existingBrowser?: Browser): Promise<ScoutResult> {
  const log = options.log ?? (() => {});
  const { profile } = options;
  const origin = new URL(profile.startUrl).origin;
  const mode = options.mode ?? 'authorized';
  const isPublic = mode === 'public';

  if (isPublic) {
    if (!options.contact) throw new Error('Public scans require a contact email (--contact) so site owners can reach you.');
    if (profile.login) throw new Error('Public scans cannot use login steps: only pages any visitor can see are allowed.');
  }
  const maxPages = isPublic ? Math.min(options.maxPages, PUBLIC_MAX_PAGES) : options.maxPages;
  let delayMs = isPublic ? Math.max(options.delayMs, PUBLIC_MIN_DELAY_MS) : options.delayMs;
  const exclude = (profile.exclude ?? []).map((p) => new RegExp(p, 'i'));
  const shotsDir = path.join(options.outDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  // Watch mode uses the installed Google Chrome: some machines (e.g. Windows with
  // Smart App Control) block Playwright's bundled browser from opening a window.
  const browser = existingBrowser ?? await chromium.launch(options.watch
    ? { headless: false, channel: 'chrome', slowMo: options.watch.slowMo }
    : {});
  // Identification goes ONLY to the scanned site's own origin:
  // - "From" isn't a CORS-safelisted header, so adding it to cross-origin requests forces a
  //   preflight that font CDNs, map APIs and video players reject. Scout would then report
  //   failures it caused itself (seen live: Google Fonts "blocked by CORS policy").
  // - The contact email must not be sent to third parties at all.
  // So the browser-wide User-Agent names the tool without the email, and same-origin requests
  // get the full User-Agent and From header via routing. Same-origin requests are never
  // subject to CORS. The site's own subdomains are cross-origin to the browser, so they're
  // left alone too.
  const identity = options.contact
    ? { 'user-agent': scoutUserAgent(options.contact), from: options.contact }
    : undefined;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(identity ? { userAgent: scoutUserAgent() } : {}),
  });
  // Page loads count against the page budget, including ones the PAGE starts on its own
  // (client-side redirects, reloads, auto-submitted forms) after Scout's navigation.
  let navigations = 0;
  let scoutNavigating = false;
  if (identity) {
    await context.route('**/*', async (route) => {
      const request = route.request();
      let mainFrameNavigation = false;
      try {
        mainFrameNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
      } catch {
        mainFrameNavigation = false;
      }
      if (mainFrameNavigation && !scoutNavigating) {
        // A public scan promises at most PUBLIC_MAX_PAGES page loads, so once the budget
        // is spent, a page-initiated navigation is refused (the page stays where it is).
        if (isPublic && navigations >= maxPages) {
          log(`  refused a page-initiated navigation to ${request.url()}: page budget (${maxPages}) spent`);
          await route.abort('blockedbyclient').catch(() => {});
          return;
        }
        navigations++;
      }
      let sameOrigin = false;
      try {
        sameOrigin = new URL(request.url()).origin === origin;
      } catch {
        sameOrigin = false;
      }
      await (sameOrigin
        ? route.continue({ headers: { ...request.headers(), ...identity } })
        : route.continue()
      ).catch(() => {}); // the page may have navigated away mid-request
    });
  }
  /** Headers for Scout's own direct requests (robots.txt, PDFs, link checks): not browser CORS. */
  const directHeaders = identity ? { headers: identity } : {};
  const page = await context.newPage();
  const events = collectEvents(page);
  // The latest main-frame document response, so a page that navigates itself still gets
  // the right HTTP status.
  let lastDocument: { url: string; status: number } | undefined;
  page.on('response', (response) => {
    try {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        lastDocument = { url: response.url(), status: response.status() };
      }
    } catch {
      // frame gone: nothing to record
    }
  });
  const startedAt = new Date();

  let shotCount = 0;
  const nextShot = () => {
    const name = `shot-${String(++shotCount).padStart(3, '0')}.png`;
    return { absolute: path.join(shotsDir, name), relative: `screenshots/${name}` };
  };

  try {
    let robots: Robots | undefined;
    const robotsSkipped: string[] = [];
    if (isPublic) {
      robots = await fetchRobots(async (url) => {
        const res = await context.request.get(url, { timeout: 15_000, maxRedirects: 3, ...directHeaders }).catch(() => null);
        return res ? { status: res.status(), text: await res.text().catch(() => '') } : null;
      }, origin);
      log(`robots.txt: ${robots.status}`);
      if (!robots.isAllowed(profile.startUrl)) {
        throw new Error(robots.status === 'unreachable'
          ? 'robots.txt could not be fetched (server error), so a public scan will not proceed.'
          : `robots.txt does not allow ${profile.startUrl}, so a public scan will not proceed.`);
      }
      if (robots.crawlDelaySeconds) {
        delayMs = Math.max(delayMs, Math.min(robots.crawlDelaySeconds * 1000, MAX_CRAWL_DELAY_MS));
      }
    }
    const robotsAllow = (url: string) => {
      if (!robots || robots.isAllowed(url)) return true;
      robotsSkipped.push(url);
      return false;
    };

    let loginMs: number | undefined;
    if (profile.login) {
      log(`Logging in at ${profile.login.url}`);
      loginMs = await login(page, options);
      log(`Logged in (${loginMs}ms)`);
    }

    const seeds = [profile.startUrl, ...(profile.paths ?? []).map((p) => new URL(p, origin).toString())];
    const queue = seeds.map(normalize);
    const seedSet = new Set(queue);
    const visited = new Set<string>();
    const referrers = new Map<string, Set<string>>(); // link target -> pages linking to it
    const statusByUrl = new Map<string, number | null>();
    const renderedDespiteError = new Set<string>();
    const navFailures = new Map<string, string>(); // url -> error, for loads that failed outright
    const pdfLinks = new Map<string, Set<string>>(); // pdf url -> pages linking to it
    const pages: PageResult[] = [];
    const allowed = (url: string) =>
      url.startsWith(origin) && !SKIP_EXTENSIONS.test(url) && !exclude.some((re) => re.test(url));

    // Duplicate detection. Every scanned page registers all its names (requested URL,
    // final URL after redirects, canonical link), so a later link to any of them is
    // skipped WITHOUT a request. Pages that only turn out to be duplicates after loading
    // (identical visible text) are dropped from the results.
    let blocked: ScoutResult['blocked'];
    const knownPages = new Map<string, string>(); // pageKey -> url of the scanned page it belongs to
    const contentSeen = new Map<string, string>(); // text fingerprint -> scanned page url
    const duplicates: { url: string; duplicateOf: string; reason: string }[] = [];
    // Links inside <nav>/<header> are queued ahead of the rest, so a small budget
    // (a 3-page public scan) covers the homepage plus top-level sections.
    const navQueue: string[] = [];
    let scoutNavigations = 0;
    const incomplete: { url: string; reason: string }[] = [];

    /**
     * Reads everything Scout needs from the loaded page WITHOUT committing anything:
     * the caller commits on success. Page reads are not error-swallowed here, so a page
     * that navigates mid-analysis surfaces as a navigation error the caller can retry.
     */
    const analyzePage = async (target: string, status: number | null, isStart: boolean, loadMs: number): Promise<PageOutcome> => {
      const startedAt = page.url();
      const seen = await page.evaluate(() => ({
        title: document.title,
        text: (document.body?.innerText ?? '').trim(),
        canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ?? '',
      }));

      // Bot protection (CDN/WAF block or challenge page)? Then this isn't the site: stop.
      // Nothing on a block page may be reported as the site's, and once a site starts
      // blocking, further requests are unwelcome (and, in a public scan, not ours to make).
      const block = detectBlock(status, seen.title, seen.text, isStart);
      if (block) {
        const shot = nextShot();
        await page.screenshot({ path: shot.absolute, fullPage: false }).catch(() => {});
        return { kind: 'blocked', blocked: { url: target, status, title: seen.title.trim(), vendor: block.vendor, atStart: isStart, screenshot: shot.relative } };
      }

      // Single-page apps often serve every route with a 404 status and render it client-side.
      // Distinguish "really missing" from "renders fine for users, wrong status for crawlers".
      // Only 404/410: a 401/403/429/5xx page is never treated as the site's content.
      const rendered = (status === 404 || status === 410)
        && seen.text.length > 40
        && !/\b(404|not found|page not found|error)\b/i.test(`${seen.title} ${seen.text.slice(0, 300)}`);

      // This page's names, and whether it's a duplicate discovered only now.
      const text = seen.text.replace(/\s+/g, ' ');
      const names = [target, page.url(), seen.canonical]
        .filter((n) => /^https?:/i.test(n) && n.startsWith(origin))
        .map(pageKey);
      const fingerprint = text.length >= 200 ? createHash('sha1').update(text).digest('hex') : undefined;
      const sameAs = names.map((k) => knownPages.get(k)).find(Boolean) ?? (fingerprint ? contentSeen.get(fingerprint) : undefined);
      if (sameAs) return { kind: 'duplicate', sameAs, names };

      const shot = nextShot();
      await page.screenshot({ path: shot.absolute, fullPage: true }).catch(() => {});

      // On an error page (a 404, a 401 sign-in wall, a failed load) the browser is showing an
      // error screen, not the site's content, so content checks would only produce noise.
      // The status itself is reported once the crawl finishes.
      const errorPage = status === null || (status >= 400 && !rendered);
      const findings: Finding[] = errorPage ? [] : [
        ...checkJavaScript(events, target, origin),
        ...checkNetwork(events, target, origin),
        ...await checkImages(page, target),
        ...await checkAccessibility(page, target, origin).catch((e: Error) => {
          if (isNavigationError(e.message)) throw e; // let the caller retry
          log(`  axe failed: ${e.message}`);
          return [];
        }),
        ...await checkMobile(page, target, nextShot),
        ...checkPerformance(loadMs, target),
      ];
      const title = await page.title();
      const links = await page.$$eval('a[href]', (as) => as.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        inNav: !!a.closest('nav, header, [role="navigation"]'),
      })));
      // A navigation that completed between reads wouldn't throw, but the results would mix
      // two pages. Treat it the same as one that interrupted a read.
      if (page.url() !== startedAt) throw new Error('page navigated while being checked');
      return { kind: 'page', result: { url: target, status, loadMs, title, screenshot: shot.relative, findings }, rendered, names, fingerprint, links };
    };

    try {
    while ((navQueue.length || queue.length) && pages.length < maxPages && (!isPublic || navigations < maxPages)) {
      const url = navQueue.length ? navQueue.shift()! : queue.shift()!;
      if (visited.has(url) || !allowed(url)) continue;
      visited.add(url);
      const known = knownPages.get(pageKey(url));
      if (known) {
        duplicates.push({ url, duplicateOf: known, reason: 'same address as a scanned page (redirect, canonical or no-op parameter)' });
        log(`  skipped (duplicate of ${known}): ${url}`);
        continue;
      }
      if (!robotsAllow(url)) {
        log(`  skipped (robots.txt): ${url}`);
        continue;
      }
      if (navigations) await sleep(delayMs);
      navigations++;
      scoutNavigations++;

      log(`[${pages.length + 1}/${maxPages}] ${url}`);
      events.reset();
      const t0 = Date.now();
      let status: number | null = null;
      try {
        scoutNavigating = true;
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).finally(() => { scoutNavigating = false; });
        status = response?.status() ?? null;
      } catch (e) {
        const message = (e as Error).message.split('\n')[0];
        log(`  navigation failed: ${message}`);
        // A visible browser shows a sign-in prompt instead of a 401 page; treat it the same.
        if (/AUTH/i.test(message)) status = 401;
        else navFailures.set(url, message);
      }
      const loadMs = Date.now() - t0;
      // Give single-page apps a moment to render and surface late errors.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

      // Analyze the page. Pages that navigate on their own after "load" (client-side
      // redirects, CMS postbacks, reloads) can pull the page out from under any read, so
      // analysis is one step that only commits its results at the end, and a navigation
      // error gets one retry on wherever the page ended up. Nothing here may abort the scan.
      const isStart = scoutNavigations === 1;
      let target = url;
      let targetStatus = status;
      let outcome: PageOutcome | undefined;
      for (let attempt = 1; attempt <= 2 && !outcome; attempt++) {
        try {
          outcome = await analyzePage(target, targetStatus, isStart, loadMs);
        } catch (e) {
          const message = (e as Error).message.split('\n')[0];
          if (attempt === 2 || !isNavigationError(message)) {
            outcome = { kind: 'incomplete', reason: isNavigationError(message) ? 'kept changing while being checked' : message };
            break;
          }
          // Let the page settle, then see where it went. When the error fires, the navigation
          // has started but may not have committed yet (page.url() still shows the old
          // address), so wait for the main frame to actually navigate before reading it.
          if (normalize(page.url()) === normalize(target)) {
            await page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: 5_000 }).catch(() => {});
          }
          await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
          const landed = normalize(page.url());
          if (pageKey(landed) === pageKey(target)) {
            log('  page reloaded itself while being checked; retrying once');
            continue;
          }
          log(`  page navigated to ${landed} while being checked`);
          if (!landed.startsWith(origin)) {
            outcome = { kind: 'incomplete', reason: `navigated away from the site, to ${landed}` };
          } else if (knownPages.has(pageKey(landed)) || (visited.has(landed) && landed !== url)) {
            outcome = { kind: 'duplicate', sameAs: knownPages.get(pageKey(landed)) ?? landed, names: [pageKey(url)] };
          } else {
            visited.add(landed);
            target = landed;
            targetStatus = lastDocument?.url && normalize(lastDocument.url) === landed ? lastDocument.status : targetStatus;
          }
        }
      }
      outcome ??= { kind: 'incomplete', reason: 'kept changing while being checked' };

      if (outcome.kind === 'blocked') {
        blocked = outcome.blocked;
        log(`  BLOCKED by ${blocked.vendor} (HTTP ${blocked.status}${blocked.title ? ` "${blocked.title}"` : ''}): stopping the scan`);
        break;
      }
      if (outcome.kind === 'duplicate') {
        duplicates.push({ url, duplicateOf: outcome.sameAs, reason: 'loaded the same page as one already scanned' });
        log(`  duplicate of ${outcome.sameAs}: not counted`);
        for (const k of outcome.names) if (!knownPages.has(k)) knownPages.set(k, outcome.sameAs);
        continue;
      }
      if (outcome.kind === 'incomplete') {
        log(`  checks incomplete: ${outcome.reason}`);
        incomplete.push({ url, reason: outcome.reason });
        continue;
      }

      // Commit the page.
      const { result: pageResult, rendered, names, fingerprint, links } = outcome;
      statusByUrl.set(pageResult.url, pageResult.status);
      if (rendered) renderedDespiteError.add(pageResult.url);
      for (const k of names) knownPages.set(k, pageResult.url);
      if (fingerprint) contentSeen.set(fingerprint, pageResult.url);
      pages.push(pageResult);
      const from = pageResult.url;

      for (const { href: raw, inNav } of links) {
        if (!/^https?:/i.test(raw)) continue;
        const link = normalize(raw);
        // PDFs are collected separately (and may live on a subdomain, e.g. a docs CDN).
        // Also documents on agenda platforms (Legistar, Granicus, ...) the site links to.
        const isDocument = (looksLikePdfLink(link) && isFirstParty(link, origin))
          || isHostedDocumentLink(link, options.documentHosts);
        if (isDocument && !exclude.some((re) => re.test(link))) {
          if (!pdfLinks.has(link)) pdfLinks.set(link, new Set());
          pdfLinks.get(link)!.add(from);
          continue;
        }
        if (!link.startsWith(origin)) continue;
        if (!referrers.has(link)) referrers.set(link, new Set());
        referrers.get(link)!.add(from);
        if (!visited.has(link) && allowed(link)) (inNav ? navQueue : queue).push(link);
      }
    }

    // Same-origin links found but not visited (page limit): check their status directly.
    // Skipped in public scans (requests beyond the sampled pages need permission) and after
    // a block (the site has said no).
    const unchecked = isPublic || blocked ? []
      : [...referrers.keys()].filter((l) => !statusByUrl.has(l) && allowed(l)).slice(0, 25);
    for (const link of unchecked) {
      const res = await context.request.get(link, { maxRedirects: 5, timeout: 15_000, ...directHeaders }).catch(() => null);
      statusByUrl.set(link, res ? res.status() : null);
    }

    // A bad status is a "broken link" if something links to it, or an "http-error" for a seed URL,
    // unless the browser rendered the page normally (see renderedDespiteError).
    const siteFindings: Finding[] = [];
    const softErrorPages = [...renderedDespiteError];
    if (softErrorPages.length) {
      siteFindings.push({
        rule: 'error-status-but-renders', title: 'Pages render normally but return an HTTP error status',
        severity: 'low', confidence: 'heuristic', category: 'http', pages: softErrorPages,
        detail: `${softErrorPages.length} page(s) display real content to users but the server answers with an error status `
          + `(${[...new Set(softErrorPages.map((u) => statusByUrl.get(u)))].join(', ')}). Common with single-page apps. `
          + 'Users are unaffected, but search engines and uptime monitors will treat these pages as missing.',
      });
    }
    // 401/403/407 mean "sign in required", which is intended behavior, not breakage.
    const authPages = [...statusByUrl].filter(([, s]) => s === 401 || s === 403 || s === 407).map(([u]) => u);
    if (authPages.length) {
      siteFindings.push({
        rule: 'auth-required', title: 'Pages require sign-in', severity: 'info', confidence: 'confirmed',
        category: 'http', pages: authPages,
        detail: `${authPages.length} page(s) answered with a sign-in requirement (401/403), so Scout could not check them. `
          + 'Give Scout a profile with login steps to include them.',
      });
    }
    for (const [url, message] of navFailures) {
      siteFindings.push({
        rule: 'page-failed-to-load', title: 'Page failed to load', severity: 'high', confidence: 'confirmed',
        category: 'http', pages: [url], detail: message,
      });
    }
    for (const [url, status] of statusByUrl) {
      if (status === null || status < 400 || renderedDespiteError.has(url) || authPages.includes(url)) continue;
      const from = [...(referrers.get(url) ?? [])];
      if (from.length) {
        siteFindings.push({
          rule: 'broken-link', title: `Broken link (HTTP ${status})`, severity: 'medium', confidence: 'confirmed',
          category: 'links', pages: from, detail: `${url} returns ${status} and is linked from ${from.length} page(s).`, samples: [url],
        });
      } else if (seedSet.has(url)) {
        siteFindings.push(...checkHttp(status, url));
      }
    }

    if (loginMs !== undefined) {
      siteFindings.push(...checkPerformance(loginMs, profile.login!.url).map((f) => ({
        ...f, rule: 'slow-login', title: `Slow login (${(loginMs! / 1000).toFixed(1)}s)`,
        detail: `Submitting the login form took ${loginMs}ms until the signed-in page appeared.`,
      })));
    }

    // ── PDFs ────────────────────────────────────────────────────────────────
    const pdfs: PdfResult[] = [];
    const pdfCap = isPublic ? PUBLIC_MAX_PDF_HEADS : (options.maxPdfs ?? DEFAULT_MAX_PDFS);
    let fetched = 0;
    const dropNonPdf = (result: PdfResult) => pdfs.splice(pdfs.indexOf(result), 1);
    for (const [url, from] of pdfLinks) {
      // Documents on an agenda platform (Legistar, Granicus...) are the agency's content
      // but a third party's server: no contact email to them, and public scans don't
      // request them at all.
      const thirdParty = !isFirstParty(url, origin);
      const result: PdfResult = { url, linkedFrom: [...from], analyzed: false, host: thirdParty ? new URL(url).hostname : undefined };
      const requestHeaders = thirdParty ? {} : directHeaders;
      pdfs.push(result);
      if (blocked) {
        result.skippedReason = 'not requested: the site blocked automated access';
        continue;
      }
      if (!thirdParty && !robotsAllow(url)) {
        result.skippedReason = 'disallowed by robots.txt';
        continue;
      }
      if (isPublic && thirdParty) {
        result.skippedReason = `public scan: hosted on ${result.host}, not requested`;
        continue;
      }
      if (fetched >= pdfCap) {
        result.skippedReason = isPublic ? 'public scan: not requested' : `over the --max-pdfs limit (${pdfCap})`;
        continue;
      }
      fetched++;
      await sleep(delayMs);
      const head = await context.request.head(url, { timeout: 30_000, maxRedirects: 5, ...requestHeaders }).catch(() => null);
      const type = head?.headers()['content-type'] ?? '';
      const length = Number(head?.headers()['content-length']);
      if (Number.isFinite(length) && length > 0) result.bytes = length;
      // Links like /DocumentCenter/View/123 or View.ashx?ID=5 are only PDFs if the server says so.
      if (head?.ok() && type && !/pdf/i.test(type) && !/\.pdf$/i.test(new URL(url).pathname)) {
        dropNonPdf(result);
        continue;
      }
      if (isPublic) {
        result.skippedReason = 'public scan: size checked only, not downloaded';
        continue;
      }
      if (result.bytes && result.bytes > MAX_PDF_BYTES) {
        result.skippedReason = `larger than ${MAX_PDF_BYTES / 1024 / 1024} MB`;
        continue;
      }
      log(`  PDF ${fetched}/${Math.min(pdfCap, pdfLinks.size)}: ${url}`);
      const res = await context.request.get(url, { timeout: 60_000, maxRedirects: 5, ...requestHeaders }).catch((e: Error) => e);
      if (res instanceof Error || !res.ok()) {
        result.error = res instanceof Error ? res.message.split('\n')[0] : `HTTP ${res.status()}`;
        continue;
      }
      const body = await res.body();
      // A link that only LOOKED like a document (no .pdf in its path) and turns out not to
      // be a PDF is just a web page: drop it quietly rather than report "unreadable PDF".
      if (!hasPdfSignature(body) && !/pdf/i.test(res.headers()['content-type'] ?? '') && !/\.pdf$/i.test(new URL(url).pathname)) {
        dropNonPdf(result);
        continue;
      }
      const analysis = await analyzePdf(url, body);
      Object.assign(result, analysis, { url, linkedFrom: [...from], host: result.host });
    }
    siteFindings.push(...pdfFindings(pdfs));

    if (blocked) {
      const where = blocked.atStart ? '' : ` at ${new URL(blocked.url).pathname}`;
      const what = `HTTP ${blocked.status}${blocked.title ? ` "${blocked.title}"` : ''}`;
      const advice = isPublic
        ? 'Request permission before testing. The site owner can allowlist Scout\'s User-Agent (LaunchGuardScout) or your IP address for an authorized scan.'
        : 'Ask the site owner to allowlist Scout\'s User-Agent (LaunchGuardScout) or your IP address in their firewall or CDN, then run the scan again.';
      siteFindings.push({
        rule: 'access-blocked',
        title: blocked.atStart
          ? `Site blocks automated access (${what})`
          : `Site started blocking automated access during the scan (${what}${where})`,
        severity: 'info', confidence: 'confirmed', category: 'http',
        pages: [blocked.url],
        screenshot: blocked.screenshot,
        detail: (blocked.atStart
          ? `The site's bot protection (${blocked.vendor}) answered with a block page instead of the site, so no accessibility, mobile or performance checks were run. This says nothing about the site's own accessibility. `
          : `Bot protection (${blocked.vendor}) answered instead of the site, so Scout stopped. Findings cover only the ${pages.length} page(s) scanned before the block. `)
          + advice,
      });
    }

    siteFindings.push(...incompleteFindings(incomplete));

    return {
      target: profile.startUrl,
      profile: profile.name,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      loginMs,
      pages,
      findings: dedupe([...siteFindings, ...pages.flatMap((p) => p.findings)]),
      mode,
      pdfs,
      robots: robots ? { checked: true, skipped: robotsSkipped } : undefined,
      duplicates,
      blocked,
    };
    } catch (e) {
      // Something unexpected after crawling began: keep what was completed rather than
      // losing every finding. The caller reports the scan as aborted (CLI exit 2).
      const message = (e as Error).message.split('\n')[0];
      log(`  scan aborted: ${message}`);
      return {
        target: profile.startUrl,
        profile: profile.name,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        loginMs,
        pages,
        findings: dedupe([...incompleteFindings(incomplete), ...pages.flatMap((p) => p.findings)]),
        mode,
        pdfs: [],
        duplicates,
        blocked,
        aborted: message,
      };
    }
  } finally {
    await context.close();
    if (!existingBrowser) await browser.close();
  }
}
