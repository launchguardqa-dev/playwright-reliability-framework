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

export interface PageEvents {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number | string; resourceType: string }[];
}

/** Attaches listeners once; call reset() before each page load. */
export function collectEvents(page: Page): PageEvents & { reset: () => void } {
  const events: PageEvents = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') events.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => events.pageErrors.push(error.message));
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

export function checkJavaScript(events: PageEvents, url: string): Finding[] {
  const out: Finding[] = [];
  for (const message of unique(events.pageErrors)) {
    out.push(finding({
      rule: 'js-error', title: 'Uncaught JavaScript error', severity: 'high', confidence: 'confirmed',
      category: 'javascript', detail: message,
    }, url));
  }
  // Console errors that only echo a failed resource load are reported by checkNetwork instead.
  const consoleOnly = unique(events.consoleErrors).filter((m) => !/^Failed to load resource/i.test(m));
  for (const message of consoleOnly) {
    out.push(finding({
      rule: 'console-error', title: 'Console error', severity: 'medium', confidence: 'confirmed',
      category: 'javascript', detail: message,
    }, url));
  }
  return out;
}

export function checkNetwork(events: PageEvents, url: string, origin: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const req of events.failedRequests) {
    if (req.resourceType === 'document' || seen.has(req.url)) continue; // the page itself is checkHttp's job
    seen.add(req.url);
    const firstParty = req.url.startsWith(origin);
    out.push(finding({
      rule: firstParty ? 'network-error' : 'third-party-network-error',
      title: firstParty ? 'Failed request to this site' : 'Failed third-party request',
      severity: firstParty ? 'medium' : 'low',
      confidence: 'confirmed', category: 'network',
      detail: `${req.resourceType} request returned ${req.status}: ${req.url}`,
      samples: [req.url],
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

export async function checkAccessibility(page: Page, url: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => finding({
    rule: `a11y:${v.id}`,
    title: v.help,
    severity: AXE_SEVERITY[v.impact ?? 'moderate'] ?? 'medium',
    confidence: 'likely',
    category: 'accessibility',
    detail: `${v.description} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'}, impact: ${v.impact ?? 'unknown'})`,
    samples: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    helpUrl: v.helpUrl,
  }, url));
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
      rule: 'mobile-overflow', title: 'Page scrolls sideways on a phone',
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
