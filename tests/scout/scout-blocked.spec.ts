import { test, expect } from '@playwright/test';
import { runScout } from '../../scout/crawl';
import { detectBlock } from '../../scout/blocked';
import { renderGovHtml } from '../../scout/report-gov';
import { ScoutResult } from '../../scout/types';
import { BlockKind, startBlockedSite } from './blocked-site';

/**
 * Bot protection must never be mistaken for the site.
 *
 * Found live: El Cajon's WAF answered a public scan with 403 "Access Denied", and Scout
 * reported WCAG findings (missing lang, mobile overflow) against that block page, i.e.
 * false findings against an agency. Every block page in these fixtures has problems axe
 * would flag, so any content finding here means the block page was analyzed.
 */

const CONTACT = 'audits@example.com';

/**
 * Extra pages to visit, so "Scout stops after a block" is actually tested: block pages
 * usually have no links, so without these even a crawler that ignored the block would stop.
 */
const MORE_PAGES = ['/about', '/contact'];

async function scan(kind: BlockKind, mode: 'public' | 'authorized', outDir: string, browser: import('@playwright/test').Browser) {
  const site = await startBlockedSite(kind);
  try {
    const result = await runScout({
      profile: { name: kind, startUrl: `${site.origin}/`, paths: kind === 'blocks-later' || kind === 'spa-404' ? undefined : MORE_PAGES },
      maxPages: 5, delayMs: 0, outDir, mode, contact: CONTACT,
    }, browser);
    return { result, requests: site.requests };
  } finally {
    await site.close();
  }
}

const pageRequests = (requests: { method: string; path: string }[]) =>
  requests.filter((r) => r.method === 'GET' && !/\.(png|js|css)$|\/cdn-cgi\/|\/robots\.txt$/.test(r.path));

for (const kind of ['akamai-403', 'cloudflare-503', 'auth-401', 'rate-limit-429'] as const) {
  test.describe(`Blocked at the start: ${kind}`, () => {
    test.describe.configure({ mode: 'default' });
    let result: ScoutResult;
    let requests: Awaited<ReturnType<typeof scan>>['requests'];

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(60_000);
      ({ result, requests } = await scan(kind, 'public', testInfo.outputPath(kind), browser));
    });

    test('is recognized as blocked, not as the site', () => {
      expect(result.blocked?.atStart).toBe(true);
      expect(result.blocked?.url).toMatch(/\/$/);
    });

    test('reports exactly one finding: blocked access (no accessibility, mobile or performance findings)', () => {
      expect(result.findings.map((f) => f.rule)).toEqual(['access-blocked']);
      expect(result.findings[0].severity).toBe('info');
      expect(result.findings[0].detail).toContain('no accessibility, mobile or performance checks were run');
      expect(result.findings[0].detail).toContain('Request permission before testing');
    });

    test('stops immediately: one request for the start page, no retries, no other pages', () => {
      expect(pageRequests(requests).map((r) => r.path)).toEqual(['/']);
    });

    test('government report says plainly that no checks ran', () => {
      const html = renderGovHtml(result);
      expect(html).toContain('Scan not completed: the site blocks automated access');
      expect(html).toContain(`HTTP ${result.blocked!.status}`);
      expect(html).not.toContain('Automated findings by WCAG');
      expect(html).not.toContain('Manual testing checklist');
      expect(html).not.toMatch(/<strong>\d+ types? of accessibility problem/);
    });
  });
}

test.describe('Blocked: other modes and timing', () => {
  test('authorized mode: a blocked start fails clearly and suggests allowlisting', async ({ browser }, testInfo) => {
    const { result, requests } = await scan('akamai-403', 'authorized', testInfo.outputPath('auth'), browser);
    expect(result.blocked?.atStart).toBe(true);
    expect(result.findings.map((f) => f.rule)).toEqual(['access-blocked']);
    expect(result.findings[0].detail).toMatch(/allowlist Scout's User-Agent \(LaunchGuardScout\) or your IP address/);
    expect(pageRequests(requests).map((r) => r.path)).toEqual(['/']);
  });

  test('a block partway through stops the crawl and keeps only the pages scanned before it', async ({ browser }, testInfo) => {
    const { result, requests } = await scan('blocks-later', 'authorized', testInfo.outputPath('later'), browser);
    expect(result.pages.map((p) => new URL(p.url).pathname)).toEqual(['/']);
    expect(result.blocked?.atStart).toBe(false);
    expect(new URL(result.blocked!.url).pathname).toBe('/second');
    expect(pageRequests(requests).map((r) => r.path), '/third is never requested').toEqual(['/', '/second']);
    // Nothing is reported against the block page except the block itself.
    const onBlockPage = result.findings.filter((f) => f.pages.some((p) => p.endsWith('/second')));
    expect(onBlockPage.map((f) => f.rule)).toEqual(['access-blocked']);
    expect(result.findings.find((f) => f.rule === 'access-blocked')?.title).toContain('during the scan');
  });

  test('NOT a block: a single-page app that renders real content with a 404 is still scanned', async ({ browser }, testInfo) => {
    const { result } = await scan('spa-404', 'authorized', testInfo.outputPath('spa'), browser);
    expect(result.blocked).toBeUndefined();
    const rules = result.findings.map((f) => f.rule);
    expect(rules).toContain('error-status-but-renders');
    expect(rules, 'its real content is checked (the image has no alt text)').toContain('a11y:image-alt');
    expect(rules).not.toContain('access-blocked');
  });
});

test.describe('Block page detection (unit)', () => {
  test('recognizes vendor block pages by signature, with an error status', () => {
    expect(detectBlock(403, 'Access Denied', 'Reference #18.6f0a1b2c.1700000000.abcdef12', false)?.vendor).toBe('Akamai');
    expect(detectBlock(503, 'Just a moment...', 'Checking if the site connection is secure', false)?.vendor).toBe('Cloudflare challenge');
    expect(detectBlock(403, 'Attention Required! | Cloudflare', 'Sorry, you have been blocked', false)?.vendor).toBe('Cloudflare');
    expect(detectBlock(403, '', 'Request unsuccessful. Incapsula incident ID: 123', false)?.vendor).toBe('Imperva (Incapsula)');
    expect(detectBlock(403, 'Sucuri WebSite Firewall - Access Denied', '', false)?.vendor).toBe('Sucuri');
    expect(detectBlock(406, 'Request Rejected', 'The requested URL was rejected. Please consult with your administrator.', false)?.vendor).toBe('F5 BIG-IP');
    expect(detectBlock(429, 'Slow down', 'too many requests', false)?.vendor).toBe('rate limiting');
  });

  test('a 401/403 on the start page is a block even without a signature; elsewhere it is not', () => {
    expect(detectBlock(403, 'Members', 'Members only area', true)).toBeDefined();
    expect(detectBlock(401, '', '', true)).toBeDefined();
    expect(detectBlock(403, 'Members', 'Members only area', false)).toBeUndefined();
  });

  test('never a block: a 2xx page, even one that mentions "Access Denied"', () => {
    expect(detectBlock(200, 'Access Denied: what to do if your permit is denied', 'Appeals process', true)).toBeUndefined();
    expect(detectBlock(null, '', '', true)).toBeUndefined();
  });

  test('never a block: an ordinary 404 page or a server error without a signature', () => {
    expect(detectBlock(404, 'Page not found', 'Sorry, we could not find that page.', true)).toBeUndefined();
    expect(detectBlock(500, 'Server error', 'Something went wrong', true)).toBeUndefined();
  });
});
