import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { runScout } from '../../scout/crawl';
import { renderHtml } from '../../scout/report';
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

  test('renders a report that escapes page content', () => {
    const html = renderHtml(result);
    expect(html).toContain('LaunchGuard Scout Report');
    expect(html).toContain('Fixture uncaught error');
    expect(html).not.toContain('<script>console.error'); // page content must never be injected raw
  });
});
