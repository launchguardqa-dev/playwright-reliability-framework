import { Finding, ScoutResult, Severity } from './types';

/** Renders a scan result as a single self-contained HTML page (screenshots are sibling files). */

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Shared by the standard and government reports. */
export const STYLES = `  :root {
    --bg: #f7f7f5; --surface: #ffffff; --text: #1c1c1a; --muted: #5f5e5a; --border: #e2e1dc;
    --critical: #a3122a; --high: #c2410c; --medium: #a16207; --low: #2563a8; --info: #5f5e5a;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #161615; --surface: #1f1f1d; --text: #ecebe6; --muted: #a8a7a1; --border: #33322f;
      --critical: #f2667b; --high: #f59e5b; --medium: #e5b84b; --low: #6ea8ec; --info: #a8a7a1;
    }
  }
  :root[data-theme="dark"] {
    --bg: #161615; --surface: #1f1f1d; --text: #ecebe6; --muted: #a8a7a1; --border: #33322f;
    --critical: #f2667b; --high: #f59e5b; --medium: #e5b84b; --low: #6ea8ec; --info: #a8a7a1;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 12px; }
  h3 { font-size: 16px; margin: 0; }
  a { color: inherit; }
  .sub { color: var(--muted); margin: 0 0 24px; overflow-wrap: anywhere; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 16px; min-width: 96px; }
  .stat strong { display: block; font-size: 24px; }
  .stat span { color: var(--muted); text-transform: capitalize; }
  .stat.sev-critical strong { color: var(--critical); } .stat.sev-high strong { color: var(--high); }
  .stat.sev-medium strong { color: var(--medium); } .stat.sev-low strong { color: var(--low); }
  .count { color: var(--muted); font-weight: normal; }
  .card { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--info); border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .card.sev-critical { border-left-color: var(--critical); } .card.sev-high { border-left-color: var(--high); }
  .card.sev-medium { border-left-color: var(--medium); } .card.sev-low { border-left-color: var(--low); }
  .card header { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .card p { margin: 8px 0; overflow-wrap: anywhere; }
  .badge { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--surface); background: var(--info); border-radius: 4px; padding: 1px 6px; }
  .badge.sev-critical { background: var(--critical); } .badge.sev-high { background: var(--high); }
  .badge.sev-medium { background: var(--medium); } .badge.sev-low { background: var(--low); }
  .meta { color: var(--muted); font-size: 13px; }
  details { margin: 6px 0; } summary { cursor: pointer; color: var(--muted); font-size: 14px; }
  ul { margin: 6px 0; padding-left: 20px; } li { overflow-wrap: anywhere; }
  .mono, code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 13px; }
  .shot img { display: block; max-width: 100%; max-height: 320px; margin-top: 8px; border: 1px solid var(--border); border-radius: 6px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { color: var(--muted); font-weight: 600; }
  .empty { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
  footer { color: var(--muted); font-size: 13px; margin-top: 40px; }
`;

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const CONFIDENCE_LABEL = {
  confirmed: 'Confirmed: directly observed',
  likely: 'Likely: strong automated signal',
  heuristic: 'Heuristic: worth a human look',
};

export function pathOf(url: string, origin: string): string {
  return url.startsWith(origin) ? url.slice(origin.length) || '/' : url;
}

export function findingCard(f: Finding, origin: string): string {
  const pages = f.pages.map((p) => `<li><a href="${esc(p)}">${esc(pathOf(p, origin))}</a></li>`).join('');
  const samples = f.samples?.length
    ? `<details><summary>Evidence (${f.samples.length})</summary><ul class="mono">${f.samples.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>`
    : '';
  const shot = f.screenshot
    ? `<a class="shot" href="${esc(f.screenshot)}"><img src="${esc(f.screenshot)}" alt="Screenshot for: ${esc(f.title)}" loading="lazy"></a>`
    : '';
  const help = f.helpUrl ? ` · <a href="${esc(f.helpUrl)}">How to fix</a>` : '';
  const wcag = f.wcag?.length ? ` · WCAG ${f.wcag.map(esc).join(', ')}` : '';
  const source = f.thirdParty ? ` · third-party: ${esc(f.thirdParty)}` : '';
  return `
  <article class="card sev-${f.severity}">
    <header>
      <span class="badge sev-${f.severity}">${f.severity}</span>
      <h3>${esc(f.title)}</h3>
    </header>
    <p>${esc(f.detail)}</p>
    <p class="meta"><span title="${esc(CONFIDENCE_LABEL[f.confidence])}">${f.confidence}</span> · ${f.category} · <code>${esc(f.rule)}</code>${wcag}${source}${help}</p>
    <details><summary>Seen on ${f.pages.length} page${f.pages.length === 1 ? '' : 's'}</summary><ul>${pages}</ul></details>
    ${samples}
    ${shot}
  </article>`;
}

export function renderHtml(result: ScoutResult): string {
  const origin = new URL(result.target).origin;
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, result.findings.filter((f) => f.severity === s).length]));
  const stats = SEVERITIES.filter((s) => s !== 'info' || counts[s])
    .map((s) => `<div class="stat sev-${s}"><strong>${counts[s]}</strong><span>${s}</span></div>`).join('');
  const sections = SEVERITIES.filter((s) => counts[s]).map((s) => `
    <section>
      <h2>${s[0].toUpperCase() + s.slice(1)} <span class="count">${counts[s]}</span></h2>
      ${result.findings.filter((f) => f.severity === s).map((f) => findingCard(f, origin)).join('')}
    </section>`).join('');
  const pageRows = result.pages.map((p) => `
    <tr>
      <td><a href="${esc(p.url)}">${esc(pathOf(p.url, origin))}</a></td>
      <td>${p.status ?? 'n/a'}</td>
      <td>${(p.loadMs / 1000).toFixed(1)}s</td>
      <td>${p.findings.length}</td>
      <td>${p.screenshot ? `<a href="${esc(p.screenshot)}">view</a>` : ''}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scout Report</title>
<style>
${STYLES}</style>
</head>
<body>
<main>
  <h1>LaunchGuard Scout Report</h1>
  <p class="sub">${esc(result.target)} · profile <strong>${esc(result.profile)}</strong> · ${result.pages.length} page(s) · ${(result.durationMs / 1000).toFixed(0)}s · ${esc(new Date(result.startedAt).toLocaleString('en-US'))}</p>
  <div class="stats">${stats}</div>
  ${result.findings.length ? sections : '<p class="empty">No issues found on the scanned pages.</p>'}
  <h2>Pages scanned</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Page</th><th>Status</th><th>Load</th><th>Findings</th><th>Screenshot</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table></div>
  <footer>Generated by LaunchGuard Scout. Automated checks find likely problems; heuristic findings need human review. Only scan sites you are authorized to test.</footer>
</main>
</body>
</html>`;
}
