import { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Finding, Severity } from './types';

/**
 * Per-page checks. Everything here is passive and read-only: Scout
 * observes the page, it never clicks buttons or submits forms.
 */

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SLOW_PAGE_MS = 3_000;
const VERY_SLOW_PAGE_MS = 6_000;

// ── Event collection ─────────────────────────────────────────────────────────

/** A message plus the URL of the script that produced it (when the browser reports one). */
export interface SourcedMessage { text: string; source?: string }

export interface PageEvents {
  consoleErrors: SourcedMessage[];
  pageErrors: SourcedMessage[];
  failedRequests: { url: string; status: number | string; resourceType: string }[];
}

/** First script URL in a stack trace: where an uncaught error was thrown. */
function stackSource(stack: string | undefined): string | undefined {
  return /(https?:\/\/[^\s)'"]+?):\d+:\d+/.exec(stack ?? '')?.[1];
}

/** Attaches listeners once; call reset() before each page load. */
export function collectEvents(page: Page): PageEvents & { reset: () => void } {
  const events: PageEvents = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') events.consoleErrors.push({ text: msg.text(), source: msg.location().url || undefined });
  });
  page.on('pageerror', (error) => events.pageErrors.push({ text: error.message, source: stackSource(error.stack) }));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      events.failedRequests.push({ url: response.url(), status: response.status(), resourceType: response.request().resourceType() });
    }
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'failed';
    // Cancelled requests (Scout navigating away mid-load, or the page aborting its own
    // fetch) are not site failures. Chromium: net::ERR_ABORTED, Firefox: NS_BINDING_ABORTED.
    if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(errorText)) return;
    events.failedRequests.push({ url: request.url(), status: errorText, resourceType: request.resourceType() });
  });
  return {
    ...events,
    reset() {
      events.consoleErrors.length = 0;
      events.pageErrors.length = 0;
      events.failedRequests.length = 0;
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const unique = <T>(items: T[]) => [...new Set(items)];

function finding(f: Omit<Finding, 'pages'>, pageUrl: string): Finding {
  return { ...f, pages: [pageUrl] };
}

const AXE_SEVERITY: Record<string, Severity> = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };

/** Waits two animation frames so layout settles after a resize, without a fixed sleep. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

// ── Checks ───────────────────────────────────────────────────────────────────

export function checkHttp(status: number | null, url: string): Finding[] {
  if (status === null || status < 400) return [];
  return [finding({
    rule: 'http-error', title: `Page returns HTTP ${status}`, severity: status >= 500 ? 'critical' : 'high',
    confidence: 'confirmed', category: 'http', detail: `Loading ${url} returned status ${status}.`,
  }, url)];
}

/** The third-party host a script or frame URL belongs to, or undefined if it's the site's own. */
export function thirdPartyHost(source: string | undefined, origin: string): string | undefined {
  if (!source || !/^https?:/i.test(source)) return undefined; // inline scripts report the page URL or nothing
  return isFirstParty(source, origin) ? undefined : new URL(source).hostname;
}

/**
 * The resource a browser error message is about, for messages logged by the page itself
 * about someone else's resource (so the script URL points at the site, not the culprit):
 *   Chromium: Access to font at 'https://fonts.gstatic.com/x.woff2' from origin '...' has been blocked by CORS policy
 *   Firefox:  Cross-Origin Request Blocked: ... reading the remote resource at https://maps.googleapis.com/x. (Reason: ...)
 *   Firefox:  [JavaScript Error: "downloadable font: rejected by sanitizer (...) source: https://fonts.gstatic.com/x.woff2"]
 */
export function resourceUrlInMessage(text: string): string | undefined {
  const quoted = /^(?:Access to [\w ]+ at|[\w ]*(?:Failed|Unable) to load [\w ]*from|Refused to [\w ]+) '(https?:\/\/[^']+)'/i.exec(text);
  if (quoted) return quoted[1];
  const firefoxCors = /remote resource at (https?:\/\/\S+?)\.? \(Reason:/i.exec(text);
  if (firefoxCors) return firefoxCors[1];
  // Firefox reports resource problems (fonts, stylesheets, images) with the resource's URL as "source: <url>".
  const firefoxSource = /\bsource: (https?:\/\/[^\s"\]]+)/i.exec(text);
  return firefoxSource?.[1];
}

/**
 * JavaScript errors, attributed to the site or to the third party whose script threw them
 * (embedded players, maps, analytics). Third-party errors are low severity: usually not
 * fixable by the site, though worth knowing about if something visible depends on them.
 */
export function checkJavaScript(events: PageEvents, url: string, origin = url): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (kind: 'js' | 'console', m: SourcedMessage) => {
    // Who's responsible: the script that logged it, or (for errors the page logs ABOUT a
    // resource, like a blocked font) the resource's own host.
    const host = thirdPartyHost(m.source, origin) ?? thirdPartyHost(resourceUrlInMessage(m.text), origin);
    const key = `${kind}|${host ?? ''}|${m.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (host) {
      out.push(finding({
        rule: kind === 'js' ? 'third-party-js-error' : 'third-party-console-error',
        title: kind === 'js' ? `Uncaught error in a third-party script (${host})` : `Console error from a third-party script (${host})`,
        severity: 'low', confidence: 'confirmed', category: 'javascript', detail: m.text,
        samples: m.source ? [m.source] : undefined, thirdParty: host,
      }, url));
    } else {
      out.push(finding(kind === 'js'
        ? { rule: 'js-error', title: 'Uncaught JavaScript error', severity: 'high', confidence: 'confirmed', category: 'javascript', detail: m.text }
        : { rule: 'console-error', title: 'Console error', severity: 'medium', confidence: 'confirmed', category: 'javascript', detail: m.text },
      url));
    }
  };
  for (const m of events.pageErrors) add('js', m);
  // Console errors that only echo a failed resource load are reported by checkNetwork instead.
  for (const m of events.consoleErrors) if (!/^Failed to load resource/i.test(m.text)) add('console', m);
  return out;
}

/**
 * Is `requestUrl` part of the scanned site, rather than a third party?
 *
 * The site's domain is the target's hostname minus a leading "www.". A request
 * counts as first-party if its host is that domain or a subdomain of it, so
 * api.shop.com and cdn.shop.com belong to shop.com. Hostnames are compared,
 * not URL prefixes: a prefix check would treat shop.com.evil.net as shop.com.
 *
 * Deliberately conservative: a sibling like api.example.com when scanning
 * app.example.com is reported as third-party, because without the public suffix
 * list we can't tell example.com from co.uk. Erring this way never hides a
 * third-party failure as first-party.
 */
export function isFirstParty(requestUrl: string, siteUrl: string): boolean {
  let host: string;
  try {
    host = new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const site = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
  return host === site || host.endsWith(`.${site}`);
}

export function checkNetwork(events: PageEvents, url: string, origin: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const req of events.failedRequests) {
    // Identify a request by origin + path: analytics beacons put timestamps and IDs in the
    // query string, which would otherwise turn one problem into one finding per request.
    const u = new URL(req.url);
    const endpoint = `${u.origin}${u.pathname}`;
    if (req.resourceType === 'document' || seen.has(endpoint)) continue; // the page itself is checkHttp's job
    seen.add(endpoint);
    const firstParty = isFirstParty(req.url, origin);
    if (req.status === 401 || req.status === 403) {
      // Usually a "who's signed in?" check failing for a signed-out visitor: expected
      // behavior, matching how 401/403 pages are reported (auth-required, info).
      out.push(finding({
        rule: 'auth-required-request', title: 'Background request needs sign-in',
        severity: 'info', confidence: 'confirmed', category: 'network',
        detail: `${req.resourceType} request returned ${req.status}: ${endpoint}. Normal for signed-out visitors `
          + '(often a session check), but worth confirming nothing visible depends on it.',
        samples: [req.url],
      }, url));
      continue;
    }
    out.push(finding({
      rule: firstParty ? 'network-error' : 'third-party-network-error',
      title: firstParty ? 'Failed request to this site' : 'Failed third-party request',
      severity: firstParty ? 'medium' : 'low',
      confidence: 'confirmed', category: 'network',
      detail: `${req.resourceType} request returned ${req.status}: ${endpoint}`,
      samples: [req.url],
      thirdParty: firstParty ? undefined : u.hostname,
    }, url));
  }
  return out;
}

export async function checkImages(page: Page, url: string): Promise<Finding[]> {
  const images = await page.$$eval('img', (els) => els.map((img) => ({
    src: img.currentSrc || img.getAttribute('src') || '',
    alt: img.getAttribute('alt') ?? '',
    broken: img.complete && img.naturalWidth === 0,
    visible: img.getBoundingClientRect().width > 0,
  })));
  const out: Finding[] = [];

  const broken = images.filter((i) => i.broken && i.src);
  if (broken.length) {
    out.push(finding({
      rule: 'broken-image', title: `${broken.length} image(s) failed to load`, severity: 'medium',
      confidence: 'confirmed', category: 'images',
      detail: 'These images are on the page but the browser could not display them.',
      samples: unique(broken.map((i) => i.src)),
    }, url));
  }

  const fileName = (src: string) => src.split('?')[0].split('/').pop() ?? src;
  const placeholders = images.filter((i) => /(^|[^a-z])(404|not[-_]?found|placeholder)([^a-z]|$)/i.test(fileName(i.src)));
  if (placeholders.length) {
    out.push(finding({
      rule: 'placeholder-image', title: `${placeholders.length} image(s) look like "not found" placeholders`,
      severity: 'medium', confidence: 'heuristic', category: 'images',
      detail: 'The image file name suggests a fallback or error image is being shown instead of real content.',
      samples: placeholders.map((i) => `${i.alt || '(no alt)'} → ${fileName(i.src)}`),
    }, url));
  }

  // Several images with DIFFERENT alt text pointing at the SAME file usually means
  // the wrong image is being shown for most of them.
  const bySrc = new Map<string, Set<string>>();
  for (const img of images.filter((i) => i.visible && i.src && i.alt)) {
    bySrc.set(img.src, (bySrc.get(img.src) ?? new Set()).add(img.alt));
  }
  for (const [src, alts] of bySrc) {
    if (alts.size >= 3) {
      out.push(finding({
        rule: 'duplicate-image', title: `${alts.size} different items share one image file`,
        severity: 'medium', confidence: 'heuristic', category: 'images',
        detail: `Images described as different things all load ${fileName(src)}.`,
        samples: [...alts].slice(0, 8),
      }, url));
    }
  }
  return out;
}

/**
 * axe tags each rule with the WCAG success criteria it tests, as "wcag" + digits:
 * wcag111 → 1.1.1, wcag143 → 1.4.3, wcag1410 → 1.4.10. Level tags (wcag2a,
 * wcag21aa) don't match because they contain letters.
 */
export function wcagFromTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...new Set(out)];
}

type AxeTarget = (string | string[])[];
const FRAME_TAG = /^<(iframe|frame|embed|object)\b/i;

/**
 * Which third party (if any) an axe node belongs to. A node inside a frame has a
 * multi-part target whose first part selects the frame; a node that IS a frame
 * (e.g. an untitled YouTube iframe) has a single part and frame-tag HTML. Either
 * way, the frame's src decides whether it's the site's own or a third party's.
 */
async function embedHostFor(
  page: Page, origin: string, target: AxeTarget, html: string, cache: Map<string, string | undefined>,
): Promise<string | undefined> {
  const frameSelector = target.length > 1 || FRAME_TAG.test(html.trim()) ? target[0] : undefined;
  if (typeof frameSelector !== 'string') return undefined; // top-level node, or inside shadow DOM
  if (!cache.has(frameSelector)) {
    const src = await page.locator(frameSelector).first()
      .evaluate((el) => el.getAttribute('src') || el.getAttribute('data') || '', null, { timeout: 2_000 })
      .catch(() => '');
    let host: string | undefined;
    try {
      host = src ? thirdPartyHost(new URL(src, page.url()).toString(), origin) : undefined;
    } catch {
      host = undefined;
    }
    cache.set(frameSelector, host);
  }
  return cache.get(frameSelector);
}

export async function checkAccessibility(page: Page, url: string, origin = url): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const cache = new Map<string, string | undefined>();
  const out: Finding[] = [];
  for (const v of results.violations) {
    // Split each violation's elements into the site's own and each embed's.
    const groups = new Map<string, typeof v.nodes>(); // '' = the site's own content
    for (const node of v.nodes) {
      const host = await embedHostFor(page, origin, node.target as AxeTarget, node.html ?? '', cache) ?? '';
      groups.set(host, [...(groups.get(host) ?? []), node]);
    }
    for (const [host, nodes] of groups) {
      out.push(finding({
        rule: `a11y:${v.id}`,
        title: host ? `${v.help} (in embedded content from ${host})` : v.help,
        severity: AXE_SEVERITY[v.impact ?? 'moderate'] ?? 'medium',
        confidence: 'likely',
        category: 'accessibility',
        // No per-page element count in the detail: the same rule on two pages with different
        // counts must merge into one finding. The affected elements are listed in `samples`.
        detail: `${v.description} (impact: ${v.impact ?? 'unknown'})`,
        samples: nodes.slice(0, 5).map((n) => (n.target as AxeTarget).map((t) => (Array.isArray(t) ? t.join(' >>> ') : t)).join(' ⟶ ')),
        helpUrl: v.helpUrl,
        wcag: wcagFromTags(v.tags),
        thirdParty: host || undefined,
      }, url));
    }
  }
  return out;
}

export async function checkMobile(
  page: Page,
  url: string,
  screenshotPath: () => { absolute: string; relative: string },
): Promise<Finding[]> {
  const original = page.viewportSize();
  await page.setViewportSize(MOBILE_VIEWPORT);
  await nextFrames(page);
  const { scrollWidth, innerWidth, widest } = await page.evaluate(() => {
    const vw = window.innerWidth;
    let widestEl = '';
    let widestRight = vw;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const right = el.getBoundingClientRect().right;
      if (right > widestRight + 1) {
        widestRight = right;
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
        widestEl = `${el.tagName.toLowerCase()}${id}${cls} (right edge ${Math.round(right)}px)`;
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, widest: widestEl };
  });

  const out: Finding[] = [];
  if (scrollWidth > innerWidth + 1) {
    const shot = screenshotPath();
    await page.screenshot({ path: shot.absolute, fullPage: false });
    out.push(finding({
      rule: 'mobile-overflow', title: 'Page scrolls sideways on a phone', wcag: ['1.4.10'],
      severity: 'medium', confidence: 'confirmed', category: 'mobile',
      detail: `At ${MOBILE_VIEWPORT.width}px wide the page is ${scrollWidth}px wide, so users must scroll horizontally.`,
      samples: widest ? [widest] : undefined,
      screenshot: shot.relative,
    }, url));
  }
  if (original) await page.setViewportSize(original);
  await nextFrames(page);
  return out;
}

export function checkPerformance(loadMs: number, url: string): Finding[] {
  if (loadMs < SLOW_PAGE_MS) return [];
  return [finding({
    rule: 'slow-page', title: `Slow page load (${(loadMs / 1000).toFixed(1)}s)`,
    severity: loadMs >= VERY_SLOW_PAGE_MS ? 'medium' : 'low', confidence: 'confirmed', category: 'performance',
    detail: `The page took ${loadMs}ms to finish loading (threshold ${SLOW_PAGE_MS}ms).`,
  }, url)];
}
// Missing <title> and missing <html lang> are covered by axe (document-title, html-has-lang).
