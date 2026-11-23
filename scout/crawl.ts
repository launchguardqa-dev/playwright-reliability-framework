import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Browser, chromium, Page } from '@playwright/test';
import {
  collectEvents, checkHttp, checkJavaScript, checkNetwork, checkImages,
  checkAccessibility, checkMobile, checkPerformance, isFirstParty,
} from './checks';
import { analyzePdf, looksLikePdfLink, pdfFindings } from './pdf';
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
  if (identity) {
    await context.route('**/*', async (route) => {
      const request = route.request();
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
    const knownPages = new Map<string, string>(); // pageKey -> url of the scanned page it belongs to
    const contentSeen = new Map<string, string>(); // text fingerprint -> scanned page url
    const duplicates: { url: string; duplicateOf: string; reason: string }[] = [];
    // Links inside <nav>/<header> are queued ahead of the rest, so a small budget
    // (a 3-page public scan) covers the homepage plus top-level sections.
    const navQueue: string[] = [];
    let navigations = 0;

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

      log(`[${pages.length + 1}/${maxPages}] ${url}`);
      events.reset();
      const t0 = Date.now();
      let status: number | null = null;
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
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
      statusByUrl.set(url, status);
      if (status !== null && status >= 400) {
        // Single-page apps often serve every route with a 404 status and render it client-side.
        // Distinguish "really missing" from "renders fine for users, wrong status for crawlers".
        const rendered = await page.evaluate(() => {
          const text = (document.body?.innerText ?? '').trim();
          const head = `${document.title} ${text.slice(0, 300)}`;
          return text.length > 40 && !/\b(404|not found|page not found|error)\b/i.test(head);
        });
        if (rendered) renderedDespiteError.add(url);
      }

      // Register this page's names, and drop it if it's a duplicate discovered only now.
      const identity = await page.evaluate(() => ({
        canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href ?? '',
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      })).catch(() => ({ canonical: '', text: '' }));
      const names = [url, page.url(), identity.canonical]
        .filter((n) => /^https?:/i.test(n) && n.startsWith(origin))
        .map(pageKey);
      const sameAs = names.map((k) => knownPages.get(k)).find(Boolean)
        ?? (identity.text.length >= 200 ? contentSeen.get(createHash('sha1').update(identity.text).digest('hex')) : undefined);
      if (sameAs) {
        duplicates.push({ url, duplicateOf: sameAs, reason: 'loaded the same page as one already scanned' });
        log(`  duplicate of ${sameAs}: not counted`);
        for (const k of names) if (!knownPages.has(k)) knownPages.set(k, sameAs);
        continue;
      }
      for (const k of names) knownPages.set(k, url);
      if (identity.text.length >= 200) contentSeen.set(createHash('sha1').update(identity.text).digest('hex'), url);

      const shot = nextShot();
      await page.screenshot({ path: shot.absolute, fullPage: true }).catch(() => {});

      // On an error page (a 404, a 401 sign-in wall, a failed load) the browser is showing an
      // error screen, not the site's content, so content checks would only produce noise.
      // The status itself is reported once the crawl finishes.
      const errorPage = status === null || (status >= 400 && !renderedDespiteError.has(url));
      const findings: Finding[] = errorPage ? [] : [
        ...checkJavaScript(events, url, origin),
        ...checkNetwork(events, url, origin),
        ...await checkImages(page, url),
        ...await checkAccessibility(page, url, origin).catch((e) => { log(`  axe failed: ${(e as Error).message}`); return []; }),
        ...await checkMobile(page, url, nextShot),
        ...checkPerformance(loadMs, url),
      ];
      pages.push({ url, status, loadMs, title: await page.title(), screenshot: shot.relative, findings });

      const links = await page.$$eval('a[href]', (as) => as.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        inNav: !!a.closest('nav, header, [role="navigation"]'),
      })));
      for (const { href: raw, inNav } of links) {
        if (!/^https?:/i.test(raw)) continue;
        const link = normalize(raw);
        // PDFs are collected separately (and may live on a subdomain, e.g. a docs CDN).
        if (looksLikePdfLink(link) && isFirstParty(link, origin) && !exclude.some((re) => re.test(link))) {
          if (!pdfLinks.has(link)) pdfLinks.set(link, new Set());
          pdfLinks.get(link)!.add(url);
          continue;
        }
        if (!link.startsWith(origin)) continue;
        if (!referrers.has(link)) referrers.set(link, new Set());
        referrers.get(link)!.add(url);
        if (!visited.has(link) && allowed(link)) (inNav ? navQueue : queue).push(link);
      }
    }

    // Same-origin links found but not visited (page limit): check their status directly.
    // Skipped in public scans: requests beyond the sampled pages need permission.
    const unchecked = isPublic ? []
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
    for (const [url, from] of pdfLinks) {
      const result: PdfResult = { url, linkedFrom: [...from], analyzed: false };
      pdfs.push(result);
      if (!robotsAllow(url)) {
        result.skippedReason = 'disallowed by robots.txt';
        continue;
      }
      if (fetched >= pdfCap) {
        result.skippedReason = isPublic ? 'public scan: not requested' : `over the --max-pdfs limit (${pdfCap})`;
        continue;
      }
      fetched++;
      await sleep(delayMs);
      const head = await context.request.head(url, { timeout: 30_000, maxRedirects: 5, ...directHeaders }).catch(() => null);
      const type = head?.headers()['content-type'] ?? '';
      const length = Number(head?.headers()['content-length']);
      if (Number.isFinite(length) && length > 0) result.bytes = length;
      // Links like /DocumentCenter/View/123 are only PDFs if the server says so.
      if (head?.ok() && type && !/pdf/i.test(type) && !/\.pdf$/i.test(new URL(url).pathname)) {
        pdfs.pop();
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
      const res = await context.request.get(url, { timeout: 60_000, maxRedirects: 5, ...directHeaders }).catch((e: Error) => e);
      if (res instanceof Error || !res.ok()) {
        result.error = res instanceof Error ? res.message.split('\n')[0] : `HTTP ${res.status()}`;
        continue;
      }
      const analysis = await analyzePdf(url, await res.body());
      Object.assign(result, analysis, { url, linkedFrom: [...from] });
    }
    siteFindings.push(...pdfFindings(pdfs));

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
    };
  } finally {
    await context.close();
    if (!existingBrowser) await browser.close();
  }
}
