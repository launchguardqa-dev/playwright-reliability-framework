import * as fs from 'fs';
import * as path from 'path';
import { runScout } from './crawl';
import { renderHtml } from './report';
import { Profile, Severity } from './types';

/**
 * LaunchGuard Scout CLI
 *
 *   npm run scout -- <url> --authorized
 *   npm run scout -- --profile scout/profiles/saucedemo.json --authorized --username problem_user
 *
 * Options:
 *   --authorized         Required. Confirms you have permission to test the target site.
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

  if (!args.authorized) {
    fail('refusing to scan without --authorized.\n'
      + 'Only scan sites you own or have explicit permission to test. Add --authorized to confirm.');
  }

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

  console.log(`\nLaunchGuard Scout → ${profile.startUrl} (profile: ${profile.name})\n`);
  const result = await runScout({
    profile,
    maxPages: Number(args['max-pages'] ?? 15),
    delayMs: Number(args.delay ?? 750),
    outDir,
    username: typeof args.username === 'string' ? args.username : undefined,
    password: typeof args.password === 'string' ? args.password : undefined,
    watch: args.watch ? { slowMo: Number(args['slow-mo'] ?? 300) } : undefined,
    log: (m) => console.log(`  ${m}`),
  });

  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.html'), renderHtml(result));

  const counts = SEVERITIES.map((s) => `${result.findings.filter((f) => f.severity === s).length} ${s}`).join(' · ');
  console.log(`\nScanned ${result.pages.length} page(s) in ${(result.durationMs / 1000).toFixed(0)}s`);
  console.log(`Findings: ${counts}`);
  for (const f of result.findings.slice(0, 10)) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.title} (${f.pages.length} page${f.pages.length === 1 ? '' : 's'})`);
  }
  if (result.findings.length > 10) console.log(`  ...and ${result.findings.length - 10} more`);
  console.log(`\nReport:   ${path.resolve(outDir, 'report.html')}`);
  console.log(`Raw data: ${path.resolve(outDir, 'findings.json')}\n`);

  if (failOn) {
    const threshold = SEVERITIES.indexOf(failOn);
    if (result.findings.some((f) => SEVERITIES.indexOf(f.severity) <= threshold)) process.exit(1);
  }
}

main().catch((e) => fail((e as Error).message));
