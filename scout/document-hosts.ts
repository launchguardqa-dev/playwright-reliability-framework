/**
 * Third-party platforms where government agencies publish agendas, minutes and packets.
 *
 * Many agencies link from their own site to documents hosted by a meeting-management
 * vendor. Those documents are still the agency's content under the ADA Title II rule,
 * so Scout checks them too. Their URLs often don't end in ".pdf" (Legistar's look like
 * View.ashx?M=A&ID=123), so a candidate link is only treated as a PDF once the server
 * confirms it (Content-Type or the %PDF- file signature).
 */

/** Host suffixes of common agenda / document platforms (matched on a dot boundary). */
export const KNOWN_DOCUMENT_HOSTS = [
  'granicus.com',          // Granicus (MetaViewer, AgendaViewer, DocumentViewer)
  'legistar.com',          // Legistar (View.ashx)
  'escribemeetings.com',   // eScribe (FileStream.ashx)
  'iqm2.com',              // IQM2 / Accela Meeting Portal (FileOpen.aspx)
  'novusagenda.com',       // NovusAgenda
  'primegov.com',          // PrimeGov
  'boarddocs.com',         // BoardDocs
  'municode.com',          // Municode Meetings
  'civicweb.net',          // iCompass CivicWeb (/document/123)
];

/** Paths and queries that look like a document download on those platforms. */
const DOCUMENT_PATH = /\.pdf(\?|$)|view\.ashx|filestream\.ashx|metaviewer\.php|documentviewer\.php|agendaviewer\.php|fileopen\.aspx|\.ashx\b|\/document\/\d+|\/files?\/|download|attachment|compiled|packet|agenda|minutes/i;

function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase().replace(/^\*?\./, '');
  return h === s || h.endsWith(`.${s}`);
}

/**
 * Is this a link to a document on a known agenda platform (or one of `extraHosts`)?
 * Only a candidate: the server must still confirm it's a PDF before it's analyzed.
 */
export function isHostedDocumentLink(url: string, extraHosts: string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const hosts = [...KNOWN_DOCUMENT_HOSTS, ...extraHosts];
  if (!hosts.some((h) => hostMatches(u.hostname, h))) return false;
  return DOCUMENT_PATH.test(`${u.pathname}${u.search}`);
}

/** Does this response body start with the PDF file signature? */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}
