import { test, expect } from '@playwright/test';
import { runScout, normalizeUrl, pageKey } from '../../scout/crawl';
import { renderGovHtml } from '../../scout/report-gov';
import { ScoutResult } from '../../scout/types';
import { startCitySite } from './city-site';

/**
 * Two fixes from the first live government scan (a Granicus/OpenCities city site):
 * 1. Duplicate URLs for one page ("/", "/Home", "/Home?oc_lang=en-US") must not use up
 *    the page budget: a 3-page public scan should cover 3 DIFFERENT pages.
 * 2. Problems inside embedded third-party content (a YouTube-style player) must be
 *    attributed to the embed, not reported as the site's own.
 */

const CONTACT = 'audits@example.com';
const pathsOf = (r: ScoutResult) => r.pages.map((p) => new URL(p.url).pathname);

test.describe('Scout on a city site: duplicate pages', () => {
  test('a 3-page public scan visits 3 distinct pages, nav first, without requesting known duplicates', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const site = await startCitySite();
    try {
      const result = await runScout({
        profile: { name: 'city', startUrl: `${site.origin}/` },
        maxPages: 3, delayMs: 0, outDir: testInfo.outputPath('public'), mode: 'public', contact: CONTACT,
      }, browser);

      expect(pathsOf(result)).toEqual(['/', '/departments', '/services']);
      const requested = site.requests.filter((r) => r.method === 'GET').map((r) => r.path);
      expect(requested, '/Home is the canonical of "/", so it is never requested').not.toContain('/Home');
      expect(result.duplicates?.map((d) => new URL(d.url).pathname)).toContain('/Home');
    } finally {
      await site.close();
    }
  });

  test('an authorized crawl drops a page whose content matches one already scanned', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const site = await startCitySite();
    try {
      const result = await runScout({
        profile: { name: 'city', startUrl: `${site.origin}/` }, maxPages: 10, delayMs: 0, outDir: testInfo.outputPath('auth'),
      }, browser);

      expect(pathsOf(result).sort()).toEqual(['/', '/contact', '/departments', '/services']);
      const copy = result.duplicates?.find((d) => d.url.endsWith('/home-copy'));
      expect(copy?.duplicateOf).toBe(`${site.origin}/`);
      // The homepage's one real problem is reported once, not once per copy.
      const imageAlt = result.findings.filter((f) => f.rule === 'a11y:image-alt' && !f.thirdParty);
      expect(imageAlt).toHaveLength(1);
      expect(imageAlt[0].pages).toEqual([`${site.origin}/`]);
    } finally {
      await site.close();
    }
  });

  test('URL normalization drops no-op parameters and trailing slashes, and keeps real ones', () => {
    expect(normalizeUrl('https://city.gov/Home?oc_lang=en-US')).toBe('https://city.gov/Home');
    expect(normalizeUrl('https://city.gov/news?utm_source=x&page=2&fbclid=y#top')).toBe('https://city.gov/news?page=2');
    expect(pageKey('https://City.gov/Departments/')).toBe('https://city.gov/Departments');
    expect(pageKey('https://city.gov/')).toBe(pageKey('https://city.gov'));
    expect(pageKey('https://city.gov/search?q=water')).not.toBe(pageKey('https://city.gov/search?q=parks'));
  });
});

test.describe('Scout on a city site: third-party embeds', () => {
  test.describe.configure({ mode: 'default' }); // one shared scan

  let site: Awaited<ReturnType<typeof startCitySite>>;
  let result: ScoutResult;
  let embedHost: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    site = await startCitySite();
    embedHost = new URL(site.embedOrigin).hostname;
    result = await runScout({
      profile: { name: 'city', startUrl: `${site.origin}/` }, maxPages: 1, delayMs: 0, outDir: testInfo.outputPath('embeds'),
    }, browser);
  });

  test.afterAll(async () => {
    await site?.close();
  });

  test('accessibility problems inside the embedded player are attributed to it', () => {
    const buttonName = result.findings.filter((f) => f.rule === 'a11y:button-name');
    expect(buttonName.map((f) => f.thirdParty), 'the unnamed button lives in the player').toEqual([embedHost]);
    expect(buttonName[0].title).toContain(`embedded content from ${embedHost}`);
  });

  test('an untitled third-party iframe is attributed to the embed', () => {
    const frameTitle = result.findings.filter((f) => f.rule === 'a11y:frame-title');
    expect(frameTitle.map((f) => f.thirdParty)).toEqual([embedHost]);
  });

  test("the site's own problem stays the site's", () => {
    const imageAlt = result.findings.filter((f) => f.rule === 'a11y:image-alt');
    expect(imageAlt).toHaveLength(1);
    expect(imageAlt[0].thirdParty).toBeUndefined();
  });

  test('console errors and failed requests from the embed are third-party, low severity', () => {
    const consoleErr = result.findings.find((f) => f.detail.includes('Player telemetry failed'));
    expect(consoleErr?.rule).toBe('third-party-console-error');
    expect(consoleErr?.thirdParty).toBe(embedHost);
    expect(consoleErr?.severity).toBe('low');
    const stats = result.findings.find((f) => f.detail.includes('/stats'));
    expect(stats?.rule).toBe('third-party-network-error');
    expect(stats?.thirdParty).toBe(embedHost);
    expect(result.findings.filter((f) => f.rule === 'console-error' || f.rule === 'js-error'), 'no site-level JS errors').toEqual([]);
  });

  test('government report: embeds get their own section and stay out of the site summary', () => {
    const html = renderGovHtml(result);
    const summary = html.slice(html.indexOf('<h2>Summary</h2>'), html.indexOf('</section>', html.indexOf('<h2>Summary</h2>')));
    const ownWcagTypes = result.findings.filter((f) => f.wcag?.length && !f.thirdParty).length;
    expect(summary).toContain(`<strong>${ownWcagTypes} type`);
    expect(summary).toContain('embedded content from');
    expect(html).toContain('<section id="embedded">');
    expect(html).toContain('The agency is still responsible for them');
    // Embedded findings appear only in the embedded section, not under the WCAG headings.
    const byCriterion = html.slice(html.indexOf('Automated findings by WCAG'), html.indexOf('<section id="embedded">'));
    expect(byCriterion).not.toContain(`embedded content from ${embedHost}`);
  });
});
