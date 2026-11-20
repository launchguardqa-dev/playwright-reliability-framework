import * as fs from 'fs';
import * as path from 'path';
import { Browser, chromium, Page } from '@playwright/test';
import {
  collectEvents, checkHttp, checkJavaScript, checkNetwork, checkImages,
  checkAccessibility, checkMobile, checkPerformance,
} from './checks';
import { Finding, PageResult, ScoutOptions, ScoutResult, Severity, Confidence } from './types';

/**
 * Crawls a site and runs every check on each page.
 *
 * Safety rules (enforced here, not just documented):
 * - Same origin only: links to other sites are never visited.
 * - Read-only: Scout navigates with GET and never clicks or submits anything,
 *   except the login steps the operator explicitly configures in a profile.
 * - Polite: a delay between page loads and a hard page limit.
 */

const SKIP_EXTENSIONS = /\.(pdf|zip|gz|dmg|exe|msi|png|jpe?g|gif|svg|webp|mp4|mp3|woff2?|css|js)(\?|$)/i;
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const CONFIDENCE_ORDER: Confidence[] = ['confirmed', 'likely', 'heuristic'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
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
    } else {
      merged.set(key, { ...f, pages: [...f.pages] });
    }
  }
  return [...merged.values()].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence)
    || b.pages.length - a.pages.length);
}

export async function runScout(options: ScoutOptions, existingBrowser?: Browser): Promise<ScoutResult> {
  const log = options.log ?? (() => {});
  const { profile } = options;
  const origin = new URL(profile.startUrl).origin;
  const exclude = (profile.exclude ?? []).map((p) => new RegExp(p, 'i'));
  const shotsDir = path.join(options.outDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const browser = existingBrowser ?? await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const events = collectEvents(page);
  const startedAt = new Date();

  let shotCount = 0;
  const nextShot = () => {
    const name = `shot-${String(++shotCount).padStart(3, '0')}.png`;
    return { absolute: path.join(shotsDir, name), relative: `screenshots/${name}` };
  };

  try {
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
    const pages: PageResult[] = [];
    const allowed = (url: string) =>
      url.startsWith(origin) && !SKIP_EXTENSIONS.test(url) && !exclude.some((re) => re.test(url));

    while (queue.length && pages.length < options.maxPages) {
      const url = queue.shift()!;
      if (visited.has(url) || !allowed(url)) continue;
      visited.add(url);
      if (pages.length) await sleep(options.delayMs);

      log(`[${pages.length + 1}/${options.maxPages}] ${url}`);
      events.reset();
      const t0 = Date.now();
      let status: number | null = null;
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        status = response?.status() ?? null;
      } catch (e) {
        log(`  navigation failed: ${(e as Error).message.split('\n')[0]}`);
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

      const shot = nextShot();
      await page.screenshot({ path: shot.absolute, fullPage: true }).catch(() => {});

      const findings: Finding[] = [
        ...checkJavaScript(events, url),
        ...checkNetwork(events, url, origin),
        ...await checkImages(page, url),
        ...await checkAccessibility(page, url).catch((e) => { log(`  axe failed: ${(e as Error).message}`); return []; }),
        ...await checkMobile(page, url, nextShot),
        ...checkPerformance(loadMs, url),
      ];
      pages.push({ url, status, loadMs, title: await page.title(), screenshot: shot.relative, findings });

      const links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const raw of links) {
        if (!/^https?:/i.test(raw)) continue;
        const link = normalize(raw);
        if (!link.startsWith(origin)) continue;
        if (!referrers.has(link)) referrers.set(link, new Set());
        referrers.get(link)!.add(url);
        if (!visited.has(link) && allowed(link)) queue.push(link);
      }
    }

    // Same-origin links found but not visited (page limit): check their status directly.
    const unchecked = [...referrers.keys()].filter((l) => !statusByUrl.has(l) && allowed(l)).slice(0, 25);
    for (const link of unchecked) {
      const res = await context.request.get(link, { maxRedirects: 5, timeout: 15_000 }).catch(() => null);
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
    for (const [url, status] of statusByUrl) {
      if (status === null || status < 400 || renderedDespiteError.has(url)) continue;
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

    return {
      target: profile.startUrl,
      profile: profile.name,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      loginMs,
      pages,
      findings: dedupe([...siteFindings, ...pages.flatMap((p) => p.findings)]),
    };
  } finally {
    await context.close();
    if (!existingBrowser) await browser.close();
  }
}
