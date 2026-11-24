import { test, expect, Browser } from '@playwright/test';
import { runScout, PUBLIC_MAX_PAGES } from '../../scout/crawl';
import { NavKind, startNavigatingSite } from './navigating-site';

/**
 * A page that navigates on its own while Scout is checking it must never crash the scan.
 *
 * Found live: a CivicPlus directory page navigated after loading, Scout's page reads threw
 * "Execution context was destroyed", the error escaped the crawl, and the CLI exited
 * without writing a report, losing the findings for every page already scanned.
 */

const CONTACT = 'audits@example.com';

async function scan(kind: NavKind, mode: 'authorized' | 'public', outDir: string, browser: Browser) {
  const site = await startNavigatingSite(kind);
  try {
    const result = await runScout({
      profile: { name: kind, startUrl: `${site.origin}/` },
      maxPages: 10, delayMs: 0, outDir, mode, contact: CONTACT,
    }, browser);
    return { result, origin: site.origin, requests: site.requests };
  } finally {
    await site.close();
  }
}

const path = (u: string) => new URL(u).pathname;
const rulesOn = (r: Awaited<ReturnType<typeof scan>>['result'], p: string) =>
  r.findings.filter((f) => f.pages.some((u) => path(u) === p)).map((f) => f.rule);

test.describe('Scout: pages that navigate while being checked', () => {
  test('redirect to another page: the scan completes and the page it landed on is checked', async ({ browser }, testInfo) => {
    const { result } = await scan('redirect-elsewhere', 'authorized', testInfo.outputPath('elsewhere'), browser);
    const scanned = result.pages.map((p) => path(p.url));
    expect(scanned).toEqual(expect.arrayContaining(['/', '/news', '/contact', '/directory/results']));
    expect(rulesOn(result, '/directory/results'), "the results page's own problem").toContain('a11y:button-name');
    expect(rulesOn(result, '/'), 'pages scanned earlier keep their findings').toContain('a11y:image-alt');
    expect(rulesOn(result, '/news')).toContain('a11y:label');
    expect(result.aborted).toBeUndefined();
  });

  test('a page that keeps reloading: recorded as incomplete, everything else still scanned', async ({ browser }, testInfo) => {
    const { result } = await scan('reload-loop', 'authorized', testInfo.outputPath('reload'), browser);
    const incomplete = result.findings.filter((f) => f.rule === 'page-check-incomplete');
    expect(incomplete.map((f) => path(f.pages[0]))).toEqual(['/directory']);
    expect(incomplete[0].title).toBe('Page changed while being checked');
    expect(incomplete[0].severity).toBe('low');
    expect(result.pages.map((p) => path(p.url)).sort()).toEqual(['/', '/contact', '/news']);
    expect(rulesOn(result, '/')).toContain('a11y:image-alt');
    expect(rulesOn(result, '/news')).toContain('a11y:label');
    expect(result.aborted).toBeUndefined();
  });

  test('redirect to a page already scanned: treated as a duplicate', async ({ browser }, testInfo) => {
    const { result } = await scan('redirect-home', 'authorized', testInfo.outputPath('home'), browser);
    expect(result.duplicates?.map((d) => path(d.url))).toContain('/directory');
    expect(result.pages.filter((p) => path(p.url) === '/')).toHaveLength(1);
    expect(result.aborted).toBeUndefined();
  });

  test(`public scan: page-initiated navigations count, and the ${PUBLIC_MAX_PAGES}-page budget holds`, async ({ browser }, testInfo) => {
    testInfo.setTimeout(90_000); // public scans wait 5s between requests
    const { result, requests } = await scan('reload-loop', 'public', testInfo.outputPath('public'), browser);
    const pageLoads = requests.filter((r) => r.method === 'GET' && !/\.(png|txt)$/.test(r.path));
    expect(pageLoads.length, `page loads: ${pageLoads.map((r) => r.path).join(', ')}`).toBeLessThanOrEqual(PUBLIC_MAX_PAGES);
    expect(result.aborted).toBeUndefined();
    expect(result.pages.length).toBeGreaterThan(0);
  });
});
