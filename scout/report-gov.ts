import { Finding, ScoutResult } from './types';
import { STYLES, esc, pathOf, findingCard } from './report';
import { pdfSummary } from './pdf';

/**
 * Government accessibility report (ADA Title II, WCAG 2.1 AA).
 *
 * Written for a non-technical reader (a city clerk or district manager) first,
 * with the technical detail an implementer needs underneath.
 */

/**
 * The DOJ rule's requirements. One place to update if the dates change again.
 * Verified against ada.gov on 2026-11-22: an Interim Final Rule (Federal Register,
 * April 20, 2026) extended the original 2026/2027 dates by one year.
 */
export const TITLE_II = {
  standard: 'WCAG 2.1 Level AA',
  deadlines: [
    { who: 'State and local governments serving 50,000 or more people', date: 'April 26, 2027' },
    { who: 'Governments serving fewer than 50,000 people, and all special district governments', date: 'April 26, 2028' },
  ],
  sources: [
    { label: 'ADA.gov: Fact sheet on the web and mobile app accessibility rule', url: 'https://www.ada.gov/resources/2024-03-08-web-rule/' },
    { label: 'Federal Register, April 20, 2026: Extension of compliance dates (Interim Final Rule)', url: 'https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web' },
  ],
  verifiedOn: 'November 22, 2026',
};

/** WCAG 2.1 success criterion names (the ones Scout and the checklist reference). */
export const WCAG_NAMES: Record<string, string> = {
  '1.1.1': 'Non-text Content', '1.2.2': 'Captions (Prerecorded)', '1.2.5': 'Audio Description (Prerecorded)',
  '1.3.1': 'Info and Relationships', '1.3.2': 'Meaningful Sequence', '1.3.5': 'Identify Input Purpose',
  '1.4.1': 'Use of Color', '1.4.3': 'Contrast (Minimum)', '1.4.4': 'Resize Text', '1.4.10': 'Reflow',
  '1.4.11': 'Non-text Contrast', '1.4.12': 'Text Spacing', '2.1.1': 'Keyboard', '2.1.2': 'No Keyboard Trap',
  '2.2.1': 'Timing Adjustable', '2.2.2': 'Pause, Stop, Hide', '2.4.1': 'Bypass Blocks', '2.4.2': 'Page Titled',
  '2.4.3': 'Focus Order', '2.4.4': 'Link Purpose (In Context)', '2.4.6': 'Headings and Labels', '2.4.7': 'Focus Visible',
  '2.5.3': 'Label in Name', '3.1.1': 'Language of Page', '3.1.2': 'Language of Parts', '3.3.1': 'Error Identification',
  '3.3.2': 'Labels or Instructions', '3.3.3': 'Error Suggestion', '4.1.1': 'Parsing', '4.1.2': 'Name, Role, Value',
  '1.4.13': 'Content on Hover or Focus', '2.4.5': 'Multiple Ways', '1.4.5': 'Images of Text',
};

/** Plain-English descriptions of the most common automated findings, for the executive summary. */
const PLAIN: Record<string, string> = {
  'a11y:image-alt': 'images have no text description, so blind visitors using screen readers don’t know what they show',
  'a11y:color-contrast': 'some text is too faint against its background for people with low vision to read',
  'a11y:label': 'form fields have no labels, so screen reader users can’t tell what to type',
  'a11y:link-name': 'some links have no readable name, so screen readers announce them only as “link”',
  'a11y:button-name': 'some buttons have no readable name, so screen readers announce them only as “button”',
  'a11y:html-has-lang': 'pages don’t declare their language, so screen readers may mispronounce the content',
  'a11y:document-title': 'pages have no title, so visitors can’t tell browser tabs or search results apart',
  'a11y:frame-title': 'embedded content (maps, videos, forms) has no title for screen reader users',
  'a11y:list': 'lists are coded incorrectly, so screen readers misreport how many items they contain',
  'a11y:label-content-name-mismatch': 'some controls are announced with a different name than the visible text, which breaks voice control',
  'a11y:select-name': 'drop-down menus have no label',
  'a11y:aria-roles': 'some elements use invalid accessibility roles',
  'mobile-overflow': 'pages scroll sideways on a phone, which is hard to use at high zoom',
  'pdf-untagged': 'PDF documents are untagged, so screen readers read them as one unstructured block',
  'pdf-scanned': 'some PDF documents are scanned images with no text, so screen readers can’t read them at all',
  'pdf-partly-scanned': 'some PDF documents contain scanned pages with no text',
  'pdf-no-title': 'PDF documents have no title, so they’re announced by file name',
  'pdf-no-language': 'PDF documents don’t declare their language',
};

/** What automation can't verify; a tester marks each one. */
export const MANUAL_CHECKS: { id: string; wcag: string[]; item: string; how: string }[] = [
  { id: 'keyboard', wcag: ['2.1.1', '2.1.2'], item: 'Everything works with a keyboard alone, with no keyboard traps',
    how: 'Unplug the mouse. Use Tab, Shift+Tab, Enter, Space and arrow keys to reach and use every link, button, menu and form. Make sure you can always Tab away.' },
  { id: 'focus-order', wcag: ['2.4.3'], item: 'Focus moves in a logical order',
    how: 'Tab through each sampled page. Focus should follow the visual reading order and never jump unexpectedly.' },
  { id: 'focus-visible', wcag: ['2.4.7'], item: 'You can always see where keyboard focus is',
    how: 'While tabbing, every focused element should show a clear outline or highlight.' },
  { id: 'skip-link', wcag: ['2.4.1'], item: 'A “Skip to main content” link (or equivalent) is available',
    how: 'Press Tab once after the page loads. A skip link should appear and move focus past the navigation.' },
  { id: 'nvda-structure', wcag: ['1.3.1', '2.4.2', '2.4.6'], item: 'Screen reader: page title, headings and landmarks make sense',
    how: 'With NVDA, check the announced page title, press H to move through headings and D through landmarks. The structure should match the page.' },
  { id: 'nvda-content', wcag: ['1.1.1', '2.4.4', '4.1.2'], item: 'Screen reader: images, links and buttons are announced meaningfully',
    how: 'With NVDA, browse the page. Images should be described (or skipped if decorative); links and buttons should say where they go or what they do.' },
  { id: 'forms', wcag: ['3.3.1', '3.3.2', '3.3.3'], item: 'Forms: labels, required fields and error messages',
    how: 'Fill in each form with mistakes. Errors should be announced, describe the problem, and say how to fix it. Required fields must be identified.' },
  { id: 'zoom', wcag: ['1.4.4', '1.4.10'], item: 'Pages work at 200% zoom, and at 400% without sideways scrolling',
    how: 'Zoom the browser to 200% and 400%. No content should be cut off or require horizontal scrolling.' },
  { id: 'media', wcag: ['1.2.2', '1.2.5'], item: 'Videos have accurate captions (and audio description where needed)',
    how: 'Play each embedded video, including recorded council meetings. Captions must be present and accurate, not just auto-generated.' },
  { id: 'motion', wcag: ['2.2.1', '2.2.2'], item: 'Moving content can be paused, and time limits can be extended',
    how: 'Check carousels, scrolling alerts and session timeouts. Users must be able to pause, stop or extend them.' },
  { id: 'color', wcag: ['1.4.1'], item: 'Color is never the only way information is shown',
    how: 'Look for required fields, errors, links and charts that rely only on color.' },
  { id: 'pdf-reading', wcag: ['1.3.2', '1.1.1'], item: 'Sample PDFs read correctly with a screen reader',
    how: 'Open 2–3 representative PDFs (an agenda, minutes, a form) in a PDF reader with NVDA. Reading order, headings, tables and image descriptions should make sense.' },
];

const wcagLabel = (sc: string) => (WCAG_NAMES[sc] ? `${sc} ${WCAG_NAMES[sc]}` : sc);
const compareSc = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function executiveSummary(result: ScoutResult): string {
  const host = new URL(result.target).hostname;
  const date = new Date(result.startedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const accessibility = result.findings.filter((f) => f.wcag?.length);
  const affectedPages = new Set(accessibility.flatMap((f) => f.pages).filter((p) => !/\.pdf/i.test(p)));
  const pdf = pdfSummary(result.pdfs);
  const top = accessibility
    .filter((f) => PLAIN[f.rule])
    .slice(0, 4)
    .map((f) => `<li>${esc(PLAIN[f.rule][0].toUpperCase() + PLAIN[f.rule].slice(1))}.</li>`)
    .join('');

  const scope = result.mode === 'public'
    ? `This is a <strong>limited preview</strong>: Scout looked at ${plural(result.pages.length, 'public page')} of ${esc(host)} on ${date}, without downloading any documents. A full audit covers the whole site and every PDF.`
    : `Scout checked ${plural(result.pages.length, 'page')}${pdf.analyzed ? ` and ${plural(pdf.analyzed, 'PDF document')}` : ''} on ${esc(host)} on ${date}.`;

  const pdfLine = pdf.analyzed
    ? `<p>Of the ${plural(pdf.analyzed, 'PDF')} checked, <strong>${pdf.untagged} ${pdf.untagged === 1 ? 'is' : 'are'} untagged</strong>, ${pdf.noTitle} ${pdf.noTitle === 1 ? 'has' : 'have'} no title, ${pdf.noLang} ${pdf.noLang === 1 ? 'has' : 'have'} no language set, and ${pdf.scanned} ${pdf.scanned === 1 ? 'contains' : 'contain'} scanned pages with no readable text.</p>`
    : pdf.found
      ? `<p>The sampled pages link to <strong>${plural(pdf.found, 'PDF document')}</strong>. PDFs such as agendas and minutes must also meet ${TITLE_II.standard}; they were not opened in this preview.</p>`
      : '';

  return `
  <section class="summary">
    <h2>Summary</h2>
    <p>${scope}</p>
    <p>Automated testing found <strong>${plural(accessibility.length, 'type')} of accessibility problem</strong> on ${plural(affectedPages.size, 'page')}, measured against ${TITLE_II.standard}, the standard the ADA Title II rule requires.${top ? ' The most important:' : ''}</p>
    ${top ? `<ul>${top}</ul>` : ''}
    ${pdfLine}
    <p>Automated tools can only detect some kinds of accessibility problems. The <a href="#manual">manual checklist</a> below covers what a person has to verify, such as keyboard use and screen reader experience. Passing an automated scan does not by itself mean a site complies.</p>
  </section>`;
}

function titleIINote(): string {
  const rows = TITLE_II.deadlines.map((d) => `<tr><td>${esc(d.who)}</td><td><strong>${esc(d.date)}</strong></td></tr>`).join('');
  const sources = TITLE_II.sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.label)}</a></li>`).join('');
  return `
  <section>
    <h2>What the ADA Title II rule requires</h2>
    <p>The U.S. Department of Justice rule under Title II of the ADA requires state and local governments, including cities, counties and special districts such as water and fire districts, to make their websites, mobile apps and online documents meet <strong>${TITLE_II.standard}</strong>.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Who</th><th>Compliance date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="meta">Dates verified against the sources below on ${esc(TITLE_II.verifiedOn)}. They were extended once already, by an April 2026 rule, so confirm them before relying on this. This report is a technical assessment, not legal advice.</p>
    <ul class="meta">${sources}</ul>
  </section>`;
}

function pdfSection(result: ScoutResult): string {
  if (!result.pdfs.length) return '';
  const s = pdfSummary(result.pdfs);
  const mb = (s.knownBytes / 1024 / 1024).toFixed(1);
  const stats = result.mode === 'public'
    ? `<div class="stats">
        <div class="stat"><strong>${s.found}</strong><span>PDFs linked</span></div>
        ${s.knownBytes ? `<div class="stat"><strong>${mb} MB</strong><span>size of those checked</span></div>` : ''}
      </div>
      <p class="meta">Preview only: PDFs were counted (and a few sized) but not downloaded or analyzed.</p>`
    : `<div class="stats">
        <div class="stat"><strong>${s.analyzed}</strong><span>PDFs analyzed</span></div>
        <div class="stat"><strong>${s.totalPages}</strong><span>total pages</span></div>
        <div class="stat sev-high"><strong>${s.untagged}</strong><span>untagged (${s.untaggedPages} pages)</span></div>
        <div class="stat sev-critical"><strong>${s.scanned}</strong><span>with scanned pages (${s.scannedPages} pages)</span></div>
        <div class="stat sev-medium"><strong>${s.noTitle}</strong><span>no title</span></div>
        <div class="stat sev-medium"><strong>${s.noLang}</strong><span>no language</span></div>
      </div>
      ${s.notAnalyzed ? `<p class="meta">${s.notAnalyzed} more PDF(s) were found but not analyzed (over the limit, too large, or unreadable). See the table.</p>` : ''}`;

  const yes = (v: boolean | undefined) => (v === undefined ? '–' : v ? 'Yes' : '<strong>No</strong>');
  const textLabel = { full: 'Yes', partial: '<strong>Partly scanned</strong>', none: '<strong>Scanned (no text)</strong>', empty: 'Empty' };
  const rows = result.pdfs.map((p) => {
    const file = decodeURIComponent(new URL(p.url).pathname.split('/').pop() || p.url);
    const status = p.analyzed ? '' : `<br><span class="meta">${esc(p.skippedReason ?? p.error ?? 'not analyzed')}</span>`;
    return `<tr>
      <td><a href="${esc(p.url)}">${esc(file)}</a>${status}</td>
      <td>${p.pages ?? '–'}</td>
      <td>${p.analyzed ? yes(p.tagged) : '–'}</td>
      <td>${p.analyzed ? (p.title ? 'Yes' : '<strong>No</strong>') : '–'}</td>
      <td>${p.analyzed ? (p.lang ? esc(p.lang) : '<strong>No</strong>') : '–'}</td>
      <td>${p.analyzed && p.textLayer ? textLabel[p.textLayer] : '–'}</td>
    </tr>`;
  }).join('');

  return `
  <section>
    <h2>PDF documents</h2>
    <p>Agendas, minutes, budgets and forms published as PDFs must meet the same standard as web pages. These numbers support a remediation estimate: untagged PDFs need tagging, and scanned pages also need text recognition (OCR) before they can be tagged.</p>
    ${stats}
    <details><summary>All ${result.pdfs.length} PDF(s)</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Document</th><th>Pages</th><th>Tagged</th><th>Title</th><th>Language</th><th>Text</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>
  </section>`;
}

function findingsByCriterion(result: ScoutResult, origin: string): string {
  const withWcag = result.findings.filter((f) => f.wcag?.length);
  const other = result.findings.filter((f) => !f.wcag?.length);
  const groups = new Map<string, Finding[]>();
  for (const f of withWcag) {
    const sc = [...f.wcag!].sort(compareSc)[0];
    groups.set(sc, [...(groups.get(sc) ?? []), f]);
  }
  const sections = [...groups.keys()].sort(compareSc).map((sc) => `
    <h3 class="sc">WCAG ${esc(wcagLabel(sc))}</h3>
    ${groups.get(sc)!.map((f) => findingCard(f, origin)).join('')}`).join('');
  return `
  <section>
    <h2>Automated findings by WCAG success criterion</h2>
    ${withWcag.length ? sections : '<p class="empty">No WCAG issues were detected automatically on the scanned pages.</p>'}
    ${other.length ? `<h2>Other technical findings</h2><p class="meta">Not WCAG failures in themselves, but problems a visitor may hit.</p>${other.map((f) => findingCard(f, origin)).join('')}` : ''}
  </section>`;
}

function manualChecklist(result: ScoutResult): string {
  const rows = MANUAL_CHECKS.map((c, i) => `
    <fieldset class="check" data-id="${c.id}">
      <legend><strong>${i + 1}. ${esc(c.item)}</strong> <span class="meta">WCAG ${c.wcag.map(esc).join(', ')}</span></legend>
      <p class="meta">${esc(c.how)}</p>
      <div class="choices">
        ${['pass', 'fail', 'n/a'].map((v) => `<label><input type="radio" name="check-${c.id}" value="${v}"> ${v === 'n/a' ? 'Not applicable' : v[0].toUpperCase() + v.slice(1)}</label>`).join('')}
      </div>
      <label class="notes">Notes <textarea name="notes-${c.id}" rows="2"></textarea></label>
    </fieldset>`).join('');
  const site = esc(new URL(result.target).hostname);
  return `
  <section id="manual">
    <h2>Manual testing checklist</h2>
    <p>Automation can’t judge these. A tester marks each item after checking the sampled pages. Your choices are kept in this browser while the report is open; use <strong>Download results</strong> to save them.</p>
    <form id="checklist">${rows}</form>
    <p><button type="button" id="download">Download results (CSV)</button> <span id="progress" class="meta"></span></p>
    <script>
      (function () {
        var form = document.getElementById('checklist');
        var key = 'scout-checklist:' + location.pathname;
        function save() {
          var data = {};
          new FormData(form).forEach(function (v, k) { data[k] = v; });
          try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
          var done = form.querySelectorAll('input[type=radio]:checked').length;
          document.getElementById('progress').textContent = done + ' of ${MANUAL_CHECKS.length} checked';
        }
        try {
          var saved = JSON.parse(localStorage.getItem(key) || '{}');
          Object.keys(saved).forEach(function (k) {
            var radio = form.querySelector('input[name="' + k + '"][value="' + saved[k] + '"]');
            if (radio) radio.checked = true;
            var text = form.querySelector('textarea[name="' + k + '"]');
            if (text) text.value = saved[k];
          });
        } catch (e) {}
        form.addEventListener('input', save);
        save();
        document.getElementById('download').addEventListener('click', function () {
          var csv = [['Site', 'Item', 'WCAG', 'Result', 'Notes']];
          form.querySelectorAll('fieldset.check').forEach(function (fs) {
            var id = fs.getAttribute('data-id');
            var picked = fs.querySelector('input[type=radio]:checked');
            csv.push(['${site}', fs.querySelector('legend strong').textContent,
              fs.querySelector('legend .meta').textContent.replace('WCAG ', ''),
              picked ? picked.value : 'not checked', fs.querySelector('textarea').value]);
          });
          var text = csv.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\\r\\n');
          var a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
          a.download = 'manual-checklist-${site}.csv';
          a.click();
        });
      })();
    </script>
  </section>`;
}

export function renderGovHtml(result: ScoutResult): string {
  const origin = new URL(result.target).origin;
  const host = new URL(result.target).hostname;
  const pageRows = result.pages.map((p) => `
    <tr><td><a href="${esc(p.url)}">${esc(pathOf(p.url, origin))}</a></td><td>${p.status ?? 'n/a'}</td><td>${p.findings.length}</td></tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility Report: ${esc(host)}</title>
<style>
${STYLES}
  .summary { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 4px 20px 8px; }
  h3.sc { margin: 24px 0 10px; font-size: 16px; }
  .check { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; margin: 0 0 12px; }
  .check legend { padding: 0 4px; }
  .choices { display: flex; flex-wrap: wrap; gap: 16px; margin: 6px 0; }
  .choices label { display: inline-flex; gap: 6px; align-items: center; min-height: 32px; }
  .notes { display: block; font-size: 14px; color: var(--muted); }
  .notes textarea { display: block; width: 100%; margin-top: 4px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
  button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  .preview { border-left: 4px solid var(--medium); background: var(--surface); padding: 10px 14px; border-radius: 6px; }
  @media print { button, .choices input { print-color-adjust: exact; } #download { display: none; } details { display: block; } }
</style>
</head>
<body>
<main>
  <h1>Website Accessibility Report</h1>
  <p class="sub">${esc(host)} · ${esc(new Date(result.startedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))} · Prepared with LaunchGuard Scout</p>
  ${result.mode === 'public' ? '<p class="preview">Limited preview of public pages only. A full audit is needed before drawing compliance conclusions.</p>' : ''}
  ${executiveSummary(result)}
  ${titleIINote()}
  ${pdfSection(result)}
  ${findingsByCriterion(result, origin)}
  ${manualChecklist(result)}
  <h2>Pages scanned</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Page</th><th>Status</th><th>Findings</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table></div>
  <footer>Generated by LaunchGuard Scout. Automated checks find likely problems; items marked heuristic need human review. This report is a technical assessment, not legal advice.</footer>
</main>
</body>
</html>`;
}
