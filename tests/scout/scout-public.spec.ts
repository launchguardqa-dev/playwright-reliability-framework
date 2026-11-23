import { test, expect } from '@playwright/test';
import { runScout, PUBLIC_MAX_PAGES, PUBLIC_MIN_DELAY_MS, PUBLIC_MAX_PDF_HEADS } from '../../scout/crawl';
import { renderGovHtml } from '../../scout/report-gov';
import { ScoutResult } from '../../scout/types';
import { startFixtureSite } from './fixture-site';

/**
 * Public scan mode: a limited, identified preview of a site Scout has NO permission
 * to test. These tests check the limits at the server (what Scout actually sent),
 * not just what Scout reports about itself.
 */

const CONTACT = 'audits@example.com';
const PDF_PATH = /\.pdf$|\/DocumentCenter\//;

test.describe('LaunchGuard Scout: public scan', () => {
  test.describe.configure({ mode: 'default' }); // one shared scan, tests in order

  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let result: ScoutResult;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(180_000); // the enforced 5s spacing makes this scan slow on purpose
    site = await startFixtureSite();
    result = await runScout({
      profile: { name: 'public-fixture', startUrl: `${site.origin}/` },
      // Deliberately ask for MORE than public mode allows; the limits must win.
      maxPages: 20,
      delayMs: 0,
      outDir: testInfo.outputPath('public-scan'),
      mode: 'public',
      contact: CONTACT,
    }, browser);
  });

  test.afterAll(async () => {
    await site?.close();
  });

  test(`visits at most ${PUBLIC_MAX_PAGES} pages even when more are requested`, () => {
    expect(result.mode).toBe('public');
    expect(result.pages.length).toBeLessThanOrEqual(PUBLIC_MAX_PAGES);
    expect(result.pages.length).toBeGreaterThan(1); // it did crawl, within the cap
  });

  test('fetches robots.txt first and never requests a disallowed page', () => {
    expect(site.requests[0].path).toBe('/robots.txt');
    expect(site.requests.map((r) => r.path)).not.toContain('/blocked/page.html');
    expect(result.robots?.skipped).toContain(`${site.origin}/blocked/page.html`);
  });

  test('identifies itself on every request: User-Agent and From header', () => {
    expect(site.requests.length).toBeGreaterThan(0);
    for (const r of site.requests) {
      expect(r.userAgent, `${r.method} ${r.path}`).toContain('LaunchGuardScout');
      expect(r.userAgent, `${r.method} ${r.path}`).toContain(CONTACT);
      expect(r.from, `${r.method} ${r.path}`).toBe(CONTACT);
    }
  });

  test(`never downloads a PDF: at most ${PUBLIC_MAX_PDF_HEADS} HEAD requests`, () => {
    const pdfRequests = site.requests.filter((r) => PDF_PATH.test(r.path));
    expect(pdfRequests.length).toBeGreaterThan(0);
    expect(pdfRequests.length).toBeLessThanOrEqual(PUBLIC_MAX_PDF_HEADS);
    expect(pdfRequests.every((r) => r.method === 'HEAD'), 'every PDF request is a HEAD').toBe(true);
    expect(result.pdfs.every((p) => !p.analyzed)).toBe(true);
    expect(result.pdfs.length, 'PDFs are still counted').toBeGreaterThan(0);
  });

  test(`waits at least ${PUBLIC_MIN_DELAY_MS / 1000}s between its own requests (delayMs: 0 was ignored)`, () => {
    // Requests Scout makes itself: page loads and PDF HEADs. (Images and scripts a page
    // loads arrive together with that page, the same as for any visitor.)
    const pagePaths = new Set(result.pages.map((p) => new URL(p.url).pathname));
    const own = site.requests.filter((r) => (r.method === 'GET' && pagePaths.has(r.path)) || r.method === 'HEAD');
    expect(own.length).toBeGreaterThan(2);
    for (let i = 1; i < own.length; i++) {
      expect(own[i].at - own[i - 1].at, `${own[i - 1].path} → ${own[i].path}`).toBeGreaterThanOrEqual(PUBLIC_MIN_DELAY_MS - 100);
    }
  });

  test('does not probe pages it did not visit (no broken-link checking)', () => {
    const visited = new Set(result.pages.map((p) => new URL(p.url).pathname));
    const htmlGets = site.requests.filter((r) => r.method === 'GET' && (r.path.endsWith('.html') || r.path === '/'));
    for (const r of htmlGets) expect(visited.has(r.path), `unexpected request for ${r.path}`).toBe(true);
  });

  test('government report marks it as a limited preview', () => {
    const html = renderGovHtml(result);
    expect(html).toContain('Limited preview of public pages only');
    expect(html).toMatch(/PDFs linked/);
    expect(html).not.toMatch(/PDFs analyzed/);
  });
});

test.describe('LaunchGuard Scout: public scan refusals', () => {
  test('refuses to start when robots.txt disallows the start page, and requests nothing else', async ({ browser }, testInfo) => {
    const site = await startFixtureSite({ robots: 'User-agent: *\nDisallow: /\n' });
    try {
      await expect(runScout({
        profile: { name: 'blocked', startUrl: `${site.origin}/` },
        maxPages: 3, delayMs: 0, outDir: testInfo.outputPath('blocked'), mode: 'public', contact: CONTACT,
      }, browser)).rejects.toThrow(/robots\.txt does not allow/);
      expect(site.requests.map((r) => r.path)).toEqual(['/robots.txt']);
    } finally {
      await site.close();
    }
  });

  test('honors a robots.txt group addressed to Scout by name', async ({ browser }, testInfo) => {
    const site = await startFixtureSite({ robots: 'User-agent: *\nDisallow:\n\nUser-agent: LaunchGuardScout\nDisallow: /\n' });
    try {
      await expect(runScout({
        profile: { name: 'named', startUrl: `${site.origin}/` },
        maxPages: 3, delayMs: 0, outDir: testInfo.outputPath('named'), mode: 'public', contact: CONTACT,
      }, browser)).rejects.toThrow(/robots\.txt does not allow/);
    } finally {
      await site.close();
    }
  });

  test('requires a contact email', async ({ browser }, testInfo) => {
    await expect(runScout({
      profile: { name: 'x', startUrl: 'http://127.0.0.1:9/' },
      maxPages: 3, delayMs: 0, outDir: testInfo.outputPath('x'), mode: 'public',
    }, browser)).rejects.toThrow(/require a contact email/);
  });

  test('refuses login profiles', async ({ browser }, testInfo) => {
    await expect(runScout({
      profile: {
        name: 'x', startUrl: 'http://127.0.0.1:9/',
        login: { url: 'http://127.0.0.1:9/', steps: [], successSelector: 'body' },
      },
      maxPages: 3, delayMs: 0, outDir: testInfo.outputPath('y'), mode: 'public', contact: CONTACT,
    }, browser)).rejects.toThrow(/cannot use login steps/);
  });
});
