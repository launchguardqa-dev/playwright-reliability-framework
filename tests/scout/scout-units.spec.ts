import { test, expect } from '@playwright/test';
import { isFirstParty, wcagFromTags, resourceUrlInMessage, checkJavaScript } from '../../scout/checks';
import { dedupe } from '../../scout/crawl';
import { analyzePdf, looksLikePdfLink, pdfFindings, pdfSummary } from '../../scout/pdf';
import { parseRobots, fetchRobots } from '../../scout/robots';
import { isHostedDocumentLink, hasPdfSignature } from '../../scout/document-hosts';
import { Finding } from '../../scout/types';
import { makePdf } from './pdf-fixtures';

/**
 * Unit tests for Scout's classification and merging logic (no browser needed).
 */

test.describe('Scout: first-party detection', () => {
  const cases: [request: string, site: string, expected: boolean, why: string][] = [
    ['https://shop.com/api/cart', 'https://shop.com/', true, 'same host'],
    ['https://api.shop.com/users/me', 'https://shop.com/', true, 'subdomain API'],
    ['https://shop.com/x', 'https://www.shop.com/', true, 'www. stripped from the site'],
    ['https://cdn.shop.com/img.png', 'https://www.shop.com/', true, 'subdomain of a www site'],
    ['https://SHOP.com/x', 'https://shop.com/', true, 'case-insensitive'],
    ['https://shop.com.evil.net/x', 'https://shop.com/', false, 'look-alike domain (URL-prefix bug)'],
    ['https://notshop.com/x', 'https://shop.com/', false, 'suffix without a dot boundary'],
    ['https://events.backtrace.io/x', 'https://www.saucedemo.com/', false, 'real third party'],
    ['https://api.example.com/x', 'https://app.example.com/', false, 'sibling subdomain: conservative'],
    ['not a url', 'https://shop.com/', false, 'unparseable URL'],
  ];

  for (const [request, site, expected, why] of cases) {
    test(`${why}: ${request} vs ${site} → ${expected}`, () => {
      expect(isFirstParty(request, site)).toBe(expected);
    });
  }
});

test.describe('Scout: merging findings', () => {
  const a11y = (page: string, samples: string[]): Finding => ({
    rule: 'a11y:label', title: 'Form elements must have labels', severity: 'high', confidence: 'likely',
    category: 'accessibility', pages: [page], detail: 'Ensure every form element has a label (impact: critical)', samples,
  });

  test('same rule on two pages merges into one finding with both pages and all evidence', () => {
    const merged = dedupe([a11y('https://s.com/a', ['#name']), a11y('https://s.com/b', ['#email', '#phone'])]);
    expect(merged).toHaveLength(1);
    expect(merged[0].pages).toEqual(['https://s.com/a', 'https://s.com/b']);
    expect(merged[0].samples).toEqual(['#name', '#email', '#phone']);
  });

  test('merged evidence is de-duplicated and capped', () => {
    const many = Array.from({ length: 15 }, (_, i) => a11y(`https://s.com/p${i}`, [`#field-${i}`, '#shared']));
    const merged = dedupe(many);
    expect(merged).toHaveLength(1);
    expect(merged[0].pages).toHaveLength(15);
    expect(merged[0].samples).toHaveLength(10);
    expect(merged[0].samples!.filter((s) => s === '#shared')).toHaveLength(1);
  });
});

test.describe('Scout: robots.txt', () => {
  const robots = parseRobots([
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /search',
    'Allow: /admin/public/',
    'Disallow: /*.php$',
    'Crawl-delay: 10',
    '',
    'User-agent: BadBot',
    'Disallow: /',
  ].join('\n'));
  const at = (path: string) => robots.isAllowed(`https://city.gov${path}`);

  test('allows paths with no matching rule', () => expect(at('/agendas/2026')).toBe(true));
  test('disallows a matching prefix', () => expect(at('/admin/users')).toBe(false));
  test('longest match wins: Allow inside a disallowed folder', () => expect(at('/admin/public/notice')).toBe(true));
  test('prefix rules include query strings', () => expect(at('/search?q=water')).toBe(false));
  test('$ anchors the end; * matches anything', () => {
    expect(at('/forms/apply.php')).toBe(false);
    expect(at('/forms/apply.php?x=1')).toBe(true);
  });
  test('uses the * group, not another bot\'s group', () => expect(robots.crawlDelaySeconds).toBe(10));

  test('a group naming Scout takes priority over *', () => {
    const r = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: LaunchGuardScout\nDisallow: /\n');
    expect(r.isAllowed('https://city.gov/')).toBe(false);
  });
  test('an empty Disallow allows everything', () => {
    expect(parseRobots('User-agent: *\nDisallow:\n').isAllowed('https://city.gov/anything')).toBe(true);
  });
  /** A fake robots.txt fetcher: a status, or null for "no response". */
  const respond = (status: number | null) => async () => (status === null ? null : { status, text: '' });

  test('missing robots.txt (404) allows; server error (5xx) or no response disallows', async () => {
    expect((await fetchRobots(respond(404), 'https://city.gov')).isAllowed('https://city.gov/')).toBe(true);
    expect((await fetchRobots(respond(503), 'https://city.gov')).isAllowed('https://city.gov/')).toBe(false);
    expect((await fetchRobots(respond(null), 'https://city.gov')).isAllowed('https://city.gov/')).toBe(false);
  });
});

test.describe('Scout: WCAG mapping', () => {
  test('maps axe tags to success criteria and ignores level tags', () => {
    expect(wcagFromTags(['cat.text-alternatives', 'wcag2a', 'wcag111', 'section508'])).toEqual(['1.1.1']);
    expect(wcagFromTags(['wcag2aa', 'wcag21aa', 'wcag143'])).toEqual(['1.4.3']);
    expect(wcagFromTags(['wcag2a', 'wcag244', 'wcag412'])).toEqual(['2.4.4', '4.1.2']);
    expect(wcagFromTags(['wcag21aa', 'wcag1410'])).toEqual(['1.4.10']);
  });
});

test.describe('Scout: PDF detection and analysis', () => {
  test('recognizes PDF links by extension and CivicPlus-style document URLs', () => {
    expect(looksLikePdfLink('https://city.gov/files/Agenda%202026.PDF')).toBe(true);
    expect(looksLikePdfLink('https://city.gov/DocumentCenter/View/123/Minutes')).toBe(true);
    expect(looksLikePdfLink('https://city.gov/agenda.pdf.html')).toBe(false);
    expect(looksLikePdfLink('https://city.gov/pdf-guide')).toBe(false);
  });

  test('reads tagging, title, language, text layer and page count', async () => {
    const plain = await analyzePdf('https://c.gov/a.pdf', await makePdf({ pages: 3 }));
    expect(plain).toMatchObject({ analyzed: true, pages: 3, tagged: false, textLayer: 'full', imageOnlyPages: 0 });
    expect(plain.title).toBeUndefined();
    expect(plain.lang).toBeUndefined();

    const good = await analyzePdf('https://c.gov/b.pdf', await makePdf({ pages: 2, title: 'Agenda', lang: 'en-US', tagged: true }));
    expect(good).toMatchObject({ analyzed: true, pages: 2, tagged: true, title: 'Agenda', lang: 'en-US', textLayer: 'full' });

    const scanned = await analyzePdf('https://c.gov/c.pdf', await makePdf({ pages: 4, scanned: true }));
    expect(scanned).toMatchObject({ textLayer: 'none', imageOnlyPages: 4 });

    const partial = await analyzePdf('https://c.gov/d.pdf', await makePdf({ pages: 3, lastPageScanned: true }));
    expect(partial).toMatchObject({ textLayer: 'partial', imageOnlyPages: 1 });
  });

  test('a corrupt file is reported, never thrown', async () => {
    const bad = await analyzePdf('https://c.gov/x.pdf', new Uint8Array(Buffer.from('%PDF-1.7 not really a pdf')));
    expect(bad.analyzed).toBe(false);
    expect(bad.error).toMatch(/Could not read PDF/);
    const html = await analyzePdf('https://c.gov/y.pdf', new Uint8Array(Buffer.from('<html>error</html>')));
    expect(html.analyzed).toBe(false);
  });

  test('groups problems into one finding per type, with every affected PDF as evidence', async () => {
    const pdfs = await Promise.all([
      analyzePdf('https://c.gov/a.pdf', await makePdf({ pages: 3 })),
      analyzePdf('https://c.gov/b.pdf', await makePdf({ pages: 1 })),
      analyzePdf('https://c.gov/ok.pdf', await makePdf({ title: 'OK', lang: 'en', tagged: true })),
    ]);
    pdfs.forEach((p) => p.linkedFrom.push('https://c.gov/documents'));
    const findings = pdfFindings(pdfs);
    const untagged = findings.find((f) => f.rule === 'pdf-untagged')!;
    expect(untagged.title).toBe('2 PDF(s) are not tagged');
    expect(untagged.samples).toHaveLength(2);
    expect(untagged.samples!.join()).not.toContain('ok.pdf');
    expect(untagged.wcag).toEqual(['1.3.1', '1.3.2']);
    expect(findings.map((f) => f.rule).sort()).toEqual(['pdf-no-language', 'pdf-no-title', 'pdf-untagged']);

    expect(pdfSummary(pdfs)).toMatchObject({ analyzed: 3, totalPages: 5, untagged: 2, untaggedPages: 4, noTitle: 2, noLang: 2 });
  });
});

test.describe('Scout: console errors about third-party resources', () => {
  const site = 'https://www.city.gov/';
  const chromiumCors = "Access to font at 'https://fonts.gstatic.com/s/x.woff2' from origin 'https://www.city.gov' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
  const firefoxCors = 'Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://maps.googleapis.com/maps/api/js. (Reason: CORS preflight response did not succeed).';

  // Verbatim format from a Firefox CI run (host changed): a broken web font.
  const firefoxFont = '[JavaScript Error: "downloadable font: rejected by sanitizer (font-family: "CityFont" style:normal weight:400 stretch:100 src index:0) source: https://fonts.gstatic.com/s/x.woff2"]';

  test('finds the resource a browser error is about', () => {
    expect(resourceUrlInMessage(chromiumCors)).toBe('https://fonts.gstatic.com/s/x.woff2');
    expect(resourceUrlInMessage(firefoxCors)).toBe('https://maps.googleapis.com/maps/api/js');
    expect(resourceUrlInMessage(firefoxFont)).toBe('https://fonts.gstatic.com/s/x.woff2');
    expect(resourceUrlInMessage('TypeError: x is undefined')).toBeUndefined();
  });

  test("attributes a CORS error the page logs about someone else's resource to that host", () => {
    const events = { consoleErrors: [{ text: chromiumCors, source: site }], pageErrors: [], failedRequests: [] };
    const [f] = checkJavaScript(events, site, site);
    expect(f).toMatchObject({ rule: 'third-party-console-error', thirdParty: 'fonts.gstatic.com', severity: 'low' });
  });

  test('attributes a Firefox resource error ("source: <url>") to that host', () => {
    const events = { consoleErrors: [{ text: firefoxFont }], pageErrors: [], failedRequests: [] };
    const [f] = checkJavaScript(events, site, site);
    expect(f).toMatchObject({ rule: 'third-party-console-error', thirdParty: 'fonts.gstatic.com', severity: 'low' });
  });

  test("the site's own console errors are still the site's", () => {
    const events = { consoleErrors: [{ text: 'Uncaught config error', source: site }], pageErrors: [], failedRequests: [] };
    const [f] = checkJavaScript(events, site, site);
    expect(f).toMatchObject({ rule: 'console-error', severity: 'medium' });
    expect(f.thirdParty).toBeUndefined();
  });
});

test.describe('Scout: documents on agenda platforms', () => {
  test('recognizes document links on known platforms, including ones without .pdf', () => {
    expect(isHostedDocumentLink('https://lamesa.legistar.com/View.ashx?M=A&ID=1234567&GUID=ABC')).toBe(true);
    expect(isHostedDocumentLink('https://lamesa.granicus.com/MetaViewer.php?view_id=2&clip_id=99&meta_id=5')).toBe(true);
    expect(isHostedDocumentLink('https://pub-elcajon.escribemeetings.com/filestream.ashx?DocumentId=4321')).toBe(true);
    expect(isHostedDocumentLink('https://santee.iqm2.com/Citizens/FileOpen.aspx?Type=1&ID=2001')).toBe(true);
    expect(isHostedDocumentLink('https://go.boarddocs.com/ca/district/Board.nsf/files/X/$file/packet.pdf')).toBe(true);
  });

  test('ignores non-document pages on those platforms, and look-alike hosts', () => {
    expect(isHostedDocumentLink('https://lamesa.legistar.com/Calendar.aspx')).toBe(false);
    expect(isHostedDocumentLink('https://legistar.com.evil.net/View.ashx?ID=1')).toBe(false);
    expect(isHostedDocumentLink('https://notgranicus.com/agenda.pdf')).toBe(false);
    expect(isHostedDocumentLink('https://example.com/agenda.pdf')).toBe(false);
  });

  test('extra hosts can be added', () => {
    expect(isHostedDocumentLink('https://docs.city-vendor.com/files/budget.pdf')).toBe(false);
    expect(isHostedDocumentLink('https://docs.city-vendor.com/files/budget.pdf', ['city-vendor.com'])).toBe(true);
  });

  test('recognizes the PDF file signature', () => {
    expect(hasPdfSignature(new Uint8Array(Buffer.from('%PDF-1.7\n...')))).toBe(true);
    expect(hasPdfSignature(new Uint8Array(Buffer.from('<!doctype html>')))).toBe(false);
  });
});
