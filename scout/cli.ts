import * as fs from 'fs';
import * as path from 'path';
import { runScout } from './crawl';
import { renderHtml } from './report';
import { renderGovHtml } from './report-gov';
import { Profile, Severity } from './types';

/**
 * LaunchGuard Scout CLI
 *
 *   npm run scout -- <url> --authorized
 *   npm run scout -- --profile scout/profiles/saucedemo.json --authorized --username problem_user
 *
 *   npm run scout -- https://agency.gov --public-scan --contact you@example.com --report gov
 *
 * Scan mode (exactly one is required):
 *   --authorized         You have permission to test the site: full crawl, PDFs downloaded and analyzed.
 *   --public-scan        You do NOT have permission: a strictly limited, identified preview of public pages
 *                        (3 pages max, 5s+ between requests, robots.txt obeyed, no logins, PDFs counted not
 *                        downloaded). Requires --contact.
 *
 * Options:
 *   --contact <email>    Sent in the User-Agent and From header so site owners can reach you.
 *   --report gov         Government accessibility report (ADA Title II, WCAG 2.1 AA) instead of the standard one.
 *   --max-pdfs <n>       PDFs to download and analyze in an authorized scan (default 20).
 *   --profile <file>     JSON profile (start URL, extra paths, excludes, optional login steps).
 *   --max-pages <n>      Page limit (default 15).
 *   --delay <ms>         Politeness delay between page loads (default 750).
 *   --out <dir>          Report folder (default scout-reports/<host>-<timestamp>).
 *   --username / --password   Login values for the profile (or SCOUT_USERNAME / SCOUT_PASSWORD).
 *   --fail-on <severity> Exit with code 1 if any finding is at or above this severity (for CI).
 *   --watch              Open a visible Chrome window so you can watch the scan.
 *   --slow-mo <ms>       Slowdown per browser action in watch mode (default 300).
 */

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { args, positional };
}

function fail(message: string): never {
  console.error(`\nScout: ${message}\n`);
  process.exit(2);
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2));

  if (args.authorized && args['public-scan']) {
    fail('choose one: --authorized (you have permission) or --public-scan (you do not).');
  }
  if (!args.authorized && !args['public-scan']) {
    fail('refusing to scan without a mode.\n'
      + '  --authorized   you own the site or have explicit permission to test it (full scan)\n'
      + '  --public-scan  you do not: a limited, identified preview of 3 public pages (needs --contact)');
  }
  const mode = args['public-scan'] ? 'public' as const : 'authorized' as const;
  const contact = typeof args.contact === 'string' ? args.contact : undefined;
  if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) fail(`--contact must be an email address, got "${contact}".`);
  if (mode === 'public' && !contact) {
    fail('--public-scan requires --contact <email>, so the site owner can identify and reach you.');
  }
  const reportKind = args.report === undefined ? 'standard' : args.report;
  if (reportKind !== 'standard' && reportKind !== 'gov') fail('--report must be "gov" (or omitted for the standard report).');

  let profile: Profile;
  if (typeof args.profile === 'string') {
    profile = JSON.parse(fs.readFileSync(args.profile, 'utf8')) as Profile;
    if (positional[0]) profile.startUrl = positional[0];
  } else if (positional[0]) {
    profile = { name: 'default', startUrl: positional[0] };
  } else {
    fail('give a URL or --profile <file>. Example: npm run scout -- https://example.com --authorized');
  }
  try {
    new URL(profile.startUrl);
  } catch {
    fail(`not a valid URL: ${profile.startUrl}`);
  }

  const failOn = typeof args['fail-on'] === 'string' ? args['fail-on'] as Severity : undefined;
  if (failOn && !SEVERITIES.includes(failOn)) fail(`--fail-on must be one of: ${SEVERITIES.join(', ')}`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const outDir = typeof args.out === 'string'
    ? args.out
    : path.join('scout-reports', `${new URL(profile.startUrl).hostname}-${stamp}`);

  console.log(`\nLaunchGuard Scout → ${profile.startUrl} (profile: ${profile.name}, mode: ${mode})`);
  if (mode === 'public') {
    console.log('  Public scan: up to 3 pages, 5s+ between requests, robots.txt obeyed, PDFs counted not downloaded.');
  }
  console.log('');
  const result = await runScout({
    profile,
    maxPages: Number(args['max-pages'] ?? 15),
    delayMs: Number(args.delay ?? 750),
    outDir,
    username: typeof args.username === 'string' ? args.username : undefined,
    password: typeof args.password === 'string' ? args.password : undefined,
    watch: args.watch ? { slowMo: Number(args['slow-mo'] ?? 300) } : undefined,
    mode,
    contact,
    maxPdfs: args['max-pdfs'] !== undefined ? Number(args['max-pdfs']) : undefined,
    log: (m) => console.log(`  ${m}`),
  });

  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.html'), reportKind === 'gov' ? renderGovHtml(result) : renderHtml(result));

  const counts = SEVERITIES.map((s) => `${result.findings.filter((f) => f.severity === s).length} ${s}`).join(' · ');
  console.log(`\nScanned ${result.pages.length} page(s) in ${(result.durationMs / 1000).toFixed(0)}s`);
  console.log(`Findings: ${counts}`);
  for (const f of result.findings.slice(0, 10)) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title} (${f.pages.length} page${f.pages.length === 1 ? '' : 's'})`);
  }
  if (result.findings.length > 10) console.log(`  ...and ${result.findings.length - 10} more`);
  console.log(`\nReport:   ${path.resolve(outDir, 'report.html')}`);
  console.log(`Raw data: ${path.resolve(outDir, 'findings.json')}\n`);

  if (result.blocked) {
    const b = result.blocked;
    const what = `HTTP ${b.status}${b.title ? ` "${b.title}"` : ''}, ${b.vendor}`;
    if (b.atStart) {
      console.error(`Scout: ${b.url} blocked automated access (${what}).`);
      console.error('  No accessibility, mobile or performance checks were run; the report says so.');
      console.error(mode === 'public'
        ? '  Request permission before testing. The owner can allowlist the "LaunchGuardScout" User-Agent or your IP.\n'
        : '  Ask the site owner to allowlist the "LaunchGuardScout" User-Agent or your IP in their firewall/CDN, then re-run.\n');
      process.exit(3);
    }
    console.warn(`Scout: the site started blocking automated access at ${b.url} (${what}); stopped early.`);
    console.warn(`  Findings cover only the ${result.pages.length} page(s) scanned before the block.\n`);
  }

  if (failOn) {
    const threshold = SEVERITIES.indexOf(failOn);
    if (result.findings.some((f) => SEVERITIES.indexOf(f.severity) <= threshold)) process.exit(1);
  }
}

main().catch((e) => fail((e as Error).message));
