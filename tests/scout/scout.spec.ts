import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { runScout } from '../../scout/crawl';
import { renderHtml } from '../../scout/report';
import { renderGovHtml, MANUAL_CHECKS, TITLE_II } from '../../scout/report-gov';
import { Finding, ScoutResult } from '../../scout/types';
import { startFixtureSite } from './fixture-site';

/**
 * Scout's own tests: does the scanner catch what it claims, and nothing it shouldn't?
 *
 * Runs one scan against a local fixture site with exactly one planted bug per
 * check, plus a clean control page that must produce zero findings.
 */

test.describe('LaunchGuard Scout', () => {
  test.describe.configure({ mode: 'default' }); // one shared scan, tests in order

  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let result: ScoutResult;
  let outDir: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    site = await startFixtureSite();
    outDir = testInfo.outputPath('scout-report');
    result = await runScout({
      profile: { name: 'fixture', startUrl: `${site.origin}/`, paths: ['/gone.html'] },
      maxPages: 20,
      delayMs: 0,
      outDir,
    }, browser);
  });

  test.afterAll(async () => {
    await site?.close();
  });

  const on = (pagePath: string): Finding[] =>
    result.findings.filter((f) => f.pages.includes(`${site.origin}${pagePath}`));
  const rulesOn = (pagePath: string) => on(pagePath).map((f) => f.rule);

  test('clean control page produces zero findings', () => {
    expect(on('/clean.html'), 'any finding here is a false positive').toEqual([]);
  });

  test('catches broken, placeholder and duplicated images', () => {
    expect(rulesOn('/images.html')).toEqual(expect.arrayContaining(['broken-image', 'placeholder-image', 'duplicate-image']));
    const duplicate = on('/images.html').find((f) => f.rule === 'duplicate-image');
    expect(duplicate?.samples).toEqual(expect.arrayContaining(['Red shirt', 'Blue hat', 'Green bag']));
  });

  test('lazy-loading placeholders are not reported as duplicate or "not found" images', () => {
    expect(on('/lazy.html').filter((f) => f.category === 'images'), 'any image finding here is a false positive').toEqual([]);
  });

  test('catches uncaught errors, console errors and failed requests', () => {
    const findings = on('/errors.html');
    expect(findings.find((f) => f.rule === 'js-error')?.detail).toContain('Fixture uncaught error');
    expect(findings.find((f) => f.rule === 'console-error')?.detail).toContain('Fixture console error');
    expect(findings.find((f) => f.rule === 'network-error')?.detail).toContain('/api/missing');
  });

  test('catches horizontal overflow on a phone, with a screenshot', () => {
    const overflow = on('/overflow.html').find((f) => f.rule === 'mobile-overflow');
    expect(overflow, 'mobile-overflow finding').toBeDefined();
    expect(fs.existsSync(path.join(outDir, overflow!.screenshot!)), 'screenshot file exists').toBe(true);
  });

  test('catches WCAG violations via axe', () => {
    expect(rulesOn('/a11y.html')).toEqual(expect.arrayContaining(['a11y:image-alt', 'a11y:label', 'a11y:html-has-lang']));
  });

  test('merges one accessibility rule across pages with different element counts', () => {
    const label = result.findings.filter((f) => f.rule === 'a11y:label');
    expect(label, 'one finding, not one per page').toHaveLength(1);
    expect(label[0].pages).toEqual(expect.arrayContaining([`${site.origin}/a11y.html`, `${site.origin}/a11y-more.html`]));
    expect(label[0].samples!.length, 'evidence from both pages kept').toBeGreaterThanOrEqual(3);
  });

  test('flags slow pages', () => {
    expect(rulesOn('/slow.html')).toContain('slow-page');
  });

  test('reports a broken link with the page that links to it', () => {
    const broken = result.findings.find((f) => f.rule === 'broken-link');
    expect(broken?.samples).toEqual([`${site.origin}/missing.html`]);
    expect(broken?.pages).toEqual([`${site.origin}/`]);
  });

  test('reports an HTTP error for a requested page nothing links to', () => {
    const httpError = result.findings.find((f) => f.rule === 'http-error');
    expect(httpError?.pages).toEqual([`${site.origin}/gone.html`]);
  });

  test('treats a 401 sign-in wall as "requires sign-in", not a broken link', () => {
    const auth = result.findings.find((f) => f.rule === 'auth-required');
    expect(auth?.pages).toEqual([`${site.origin}/private.html`]);
    expect(auth?.severity).toBe('info');
    const brokenTargets = result.findings.filter((f) => f.rule === 'broken-link').flatMap((f) => f.samples ?? []);
    expect(brokenTargets).not.toContain(`${site.origin}/private.html`);
  });

  test('reports one failing endpoint once, even with changing query strings', () => {
    const beacon = on('/beacons.html').filter((f) => f.rule === 'network-error');
    expect(beacon, 'exactly one finding for /api/beacon').toHaveLength(1);
    expect(beacon[0].detail).toContain(`${site.origin}/api/beacon`);
    expect(beacon[0].detail).not.toContain('?t=');
  });

  test('reports a 401 background request as info, not a failed request', () => {
    const findings = on('/beacons.html');
    const me = findings.filter((f) => f.detail.includes('/api/me'));
    expect(me.map((f) => [f.rule, f.severity])).toEqual([['auth-required-request', 'info']]);
  });

  test('runs no content checks on error pages (404, 401)', () => {
    expect(on('/missing.html'), 'the 404 page itself').toEqual([]);
    expect(on('/private.html').map((f) => f.rule), 'the 401 page itself').toEqual(['auth-required']);
    expect(on('/gone.html').map((f) => f.rule), 'unlinked 404 seed').toEqual(['http-error']);
  });

  // ── PDFs (authorized scan) ─────────────────────────────────────────────────

  const pdf = (p: string) => `${site.origin}${p}`;
  const pdfSamples = (rule: string) => result.findings.find((f) => f.rule === rule)?.samples?.join('\n') ?? '';

  test('finds every linked PDF once, including a CMS link without .pdf', () => {
    expect(result.pdfs.map((p) => p.url).sort()).toEqual([
      pdf('/DocumentCenter/View/12'), pdf('/docs/accessible.pdf'), pdf('/docs/agenda.pdf'),
      pdf('/docs/not-really.pdf'), pdf('/docs/scanned.pdf'),
    ]);
    const agenda = result.pdfs.find((p) => p.url === pdf('/docs/agenda.pdf'))!;
    expect(agenda.linkedFrom.sort(), 'linked from both pages, merged').toEqual([`${site.origin}/`, `${site.origin}/documents.html`]);
  });

  test('flags each planted PDF problem, and nothing on the accessible control PDF', () => {
    expect(pdfSamples('pdf-untagged')).toContain('agenda.pdf');
    expect(pdfSamples('pdf-untagged')).toContain('scanned.pdf');
    expect(pdfSamples('pdf-no-title')).toContain('agenda.pdf');
    expect(pdfSamples('pdf-no-language')).toContain('scanned.pdf');
    expect(pdfSamples('pdf-scanned')).toContain('scanned.pdf');
    expect(pdfSamples('pdf-partly-scanned')).toContain('DocumentCenter/View/12');
    expect(pdfSamples('pdf-unreadable')).toContain('not-really.pdf');
    const everyPdfSample = result.findings.filter((f) => f.category === 'pdf').flatMap((f) => f.samples ?? []).join('\n');
    expect(everyPdfSample, 'accessible.pdf is the control').not.toContain('accessible.pdf');
  });

  test('records page counts for the remediation estimate', () => {
    const pages = Object.fromEntries(result.pdfs.map((p) => [new URL(p.url).pathname, p.pages]));
    expect(pages).toMatchObject({ '/docs/agenda.pdf': 3, '/docs/accessible.pdf': 2, '/docs/scanned.pdf': 4, '/DocumentCenter/View/12': 5 });
  });

  test('tags accessibility findings with their WCAG success criteria', () => {
    expect(result.findings.find((f) => f.rule === 'a11y:image-alt')?.wcag).toContain('1.1.1');
    expect(result.findings.find((f) => f.rule === 'a11y:html-has-lang')?.wcag).toContain('3.1.1');
    expect(result.findings.find((f) => f.rule === 'mobile-overflow')?.wcag).toEqual(['1.4.10']);
  });

  // ── Government report ──────────────────────────────────────────────────────

  test('government report: summary, Title II dates, WCAG grouping, PDF estimate, checklist', () => {
    const html = renderGovHtml(result);
    expect(html).toContain('<h2>Summary</h2>');
    for (const d of TITLE_II.deadlines) expect(html).toContain(d.date);
    expect(html).toContain(TITLE_II.sources[0].url);
    expect(html).toContain('WCAG 1.1.1 Non-text Content');
    expect(html).toContain('WCAG 1.4.10 Reflow');
    expect(html).toMatch(/<strong>4<\/strong><span>PDFs analyzed<\/span>/);
    expect(html).toMatch(/<strong>14<\/strong><span>total pages<\/span>/);
    expect(html.match(/<fieldset class="check"/g)).toHaveLength(MANUAL_CHECKS.length);
    expect(html, 'no unfilled values').not.toMatch(/undefined|NaN/);
    expect(html).not.toContain('<script>console.error'); // page content is escaped
  });

  test('government report: checklist choices download as CSV', async ({ page }) => {
    const file = path.join(outDir, 'report-gov.html');
    fs.writeFileSync(file, renderGovHtml(result));
    await page.goto(`file:///${file.replace(/\\/g, '/')}`);
    await page.locator('input[name="check-keyboard"][value="fail"]').check();
    await page.locator('textarea[name="notes-keyboard"]').fill('Menu "Services" can\'t be opened by keyboard');
    await page.locator('input[name="check-media"][value="n/a"]').check();
    await expect(page.locator('#progress')).toHaveText(`2 of ${MANUAL_CHECKS.length} checked`);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    expect(csv.split('\r\n')).toHaveLength(MANUAL_CHECKS.length + 1);
    expect(csv).toContain('"fail","Menu ""Services"" can\'t be opened by keyboard"');
    expect(csv).toContain('"n/a"');
    expect(csv).toContain('"not checked"');
  });

  test('renders a report that escapes page content', () => {
    const html = renderHtml(result);
    expect(html).toContain('LaunchGuard Scout Report');
    expect(html).toContain('Fixture uncaught error');
    expect(html).not.toContain('<script>console.error'); // page content must never be injected raw
  });
});
