import { test, expect } from '@playwright/test';
import { isFirstParty } from '../../scout/checks';
import { dedupe } from '../../scout/crawl';
import { Finding } from '../../scout/types';

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
