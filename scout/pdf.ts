import {
  PDFDocument, PDFName, PDFDict, PDFBool, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';
import { Finding, PdfResult } from './types';

/**
 * PDF accessibility checks.
 *
 * Reads a PDF's internal structure (no rendering) to answer the questions that
 * drive remediation quotes: is it tagged, does it have a title and a language,
 * does it have real text or is it a scanned image, and how many pages is it.
 */

/** Looks like a link to a PDF, by extension or by a common government CMS document URL. */
export function looksLikePdfLink(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.pdf$/i.test(pathname) || /\/DocumentCenter\/View\//i.test(pathname);
  } catch {
    return false;
  }
}

function text(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    const s = value.decodeText().trim();
    return s || undefined;
  }
  return undefined;
}

/** dc:title from the XMP metadata stream, the other place a PDF title can live. */
function xmpTitle(doc: PDFDocument): string | undefined {
  const stream = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(stream instanceof PDFStream)) return undefined;
  try {
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
    const xml = Buffer.from(bytes).toString('utf8');
    const match = /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i.exec(xml);
    const title = match?.[1]?.replace(/<[^>]+>/g, '').trim();
    return title || undefined;
  } catch {
    return undefined;
  }
}

function dictHas(dict: PDFDict | undefined, key: string): boolean {
  if (!dict) return false;
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFDict && value.keys().length > 0;
}

/** Fonts or images in a resources dict, looking one level into Form XObjects. */
function resourceContents(doc: PDFDocument, resources: PDFDict | undefined): { fonts: boolean; images: boolean } {
  const result = { fonts: dictHas(resources, 'Font'), images: false };
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return result;
  for (const key of xobjects.keys()) {
    const raw = xobjects.get(key);
    const xobj = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (!(xobj instanceof PDFStream)) continue;
    const subtype = xobj.dict.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Image')) result.images = true;
    if (subtype === PDFName.of('Form')) {
      const formResources = xobj.dict.lookup(PDFName.of('Resources'));
      if (formResources instanceof PDFDict && dictHas(formResources, 'Font')) result.fonts = true;
    }
  }
  return result;
}

/** Analyzes PDF bytes. Never throws: problems are returned in `error`. */
export async function analyzePdf(url: string, bytes: Uint8Array): Promise<PdfResult> {
  const base: PdfResult = { url, linkedFrom: [], bytes: bytes.byteLength, analyzed: false };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    return { ...base, error: `Could not read PDF: ${(e as Error).message.split('\n')[0]}` };
  }
  // pdf-lib can "load" garbage without throwing and hand back a document with no
  // catalog, so the structural reads are guarded as a whole.
  try {
    return inspect(doc, base);
  } catch (e) {
    return { ...base, error: `Could not read PDF structure: ${(e as Error).message.split('\n')[0]}` };
  }
}

function inspect(doc: PDFDocument, base: PdfResult): PdfResult {
  const catalog = doc.catalog;
  if (!catalog) throw new Error('no document catalog');
  const markInfo = catalog.lookup(PDFName.of('MarkInfo'));
  const marked = markInfo instanceof PDFDict && markInfo.get(PDFName.of('Marked')) === PDFBool.True;
  const hasStructTree = catalog.has(PDFName.of('StructTreeRoot'));

  let textPages = 0;
  let imageOnlyPages = 0;
  const pages = doc.getPages();
  for (const page of pages) {
    const resources = page.node.Resources();
    const { fonts, images } = resourceContents(doc, resources);
    if (fonts) textPages++;
    else if (images) imageOnlyPages++;
  }
  const textLayer: PdfResult['textLayer'] =
    textPages === pages.length ? 'full'
      : textPages > 0 ? 'partial'
        : imageOnlyPages > 0 ? 'none'
          : 'empty';

  return {
    ...base,
    analyzed: true,
    pages: pages.length,
    tagged: hasStructTree && marked,
    title: doc.getTitle()?.trim() || xmpTitle(doc),
    lang: text(catalog.lookup(PDFName.of('Lang'))),
    textLayer,
    imageOnlyPages,
    encrypted: doc.isEncrypted,
  };
}

// ── Findings ─────────────────────────────────────────────────────────────────

const name = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
const sample = (p: PdfResult) => `${name(p.url)}${p.pages ? ` (${p.pages} page${p.pages === 1 ? '' : 's'})` : ''} → ${p.url}`;

/**
 * One finding per problem type across all PDFs (not one per file), so a site with
 * 80 untitled agendas gets one clear line item. Every affected PDF is in `samples`.
 */
export function pdfFindings(pdfs: PdfResult[]): Finding[] {
  const analyzed = pdfs.filter((p) => p.analyzed);
  const linkedFrom = (list: PdfResult[]) => [...new Set(list.flatMap((p) => p.linkedFrom))];
  const out: Finding[] = [];
  const add = (list: PdfResult[], f: Omit<Finding, 'pages' | 'samples' | 'category'>) => {
    if (!list.length) return;
    out.push({ ...f, category: 'pdf', pages: linkedFrom(list), samples: list.map(sample) });
  };

  add(analyzed.filter((p) => p.textLayer === 'none'), {
    rule: 'pdf-scanned', title: `${analyzed.filter((p) => p.textLayer === 'none').length} PDF(s) appear to be scanned images with no text`,
    severity: 'critical', confidence: 'heuristic', wcag: ['1.1.1'],
    detail: 'These PDFs contain page images but no text layer. Screen readers cannot read them at all, and they cannot be searched. They need OCR plus tagging, or an accessible replacement.',
  });
  add(analyzed.filter((p) => p.textLayer === 'partial'), {
    rule: 'pdf-partly-scanned', title: `${analyzed.filter((p) => p.textLayer === 'partial').length} PDF(s) have some scanned pages`,
    severity: 'high', confidence: 'heuristic', wcag: ['1.1.1'],
    detail: 'Some pages have text and others are images only (often a signature page or an attached scan). The image-only pages are unreadable to screen readers.',
  });
  add(analyzed.filter((p) => p.tagged === false), {
    rule: 'pdf-untagged', title: `${analyzed.filter((p) => p.tagged === false).length} PDF(s) are not tagged`,
    severity: 'high', confidence: 'confirmed', wcag: ['1.3.1', '1.3.2'],
    detail: 'Untagged PDFs have no structure (headings, lists, tables, reading order). Screen readers read them as one unstructured stream, or in the wrong order.',
  });
  add(analyzed.filter((p) => !p.title), {
    rule: 'pdf-no-title', title: `${analyzed.filter((p) => !p.title).length} PDF(s) have no document title`,
    severity: 'medium', confidence: 'confirmed', wcag: ['2.4.2'],
    detail: 'Without a title, screen readers and browser tabs announce only the file name (e.g. "agenda_0412_final2.pdf").',
  });
  add(analyzed.filter((p) => !p.lang), {
    rule: 'pdf-no-language', title: `${analyzed.filter((p) => !p.lang).length} PDF(s) have no language set`,
    severity: 'medium', confidence: 'confirmed', wcag: ['3.1.1'],
    detail: 'Without a language, screen readers may read the document with the wrong pronunciation rules.',
  });
  const unreadable = pdfs.filter((p) => !p.analyzed && p.error);
  add(unreadable, {
    rule: 'pdf-unreadable', title: `${unreadable.length} PDF(s) could not be analyzed`,
    severity: 'low', confidence: 'confirmed',
    detail: 'Scout could not read these files (corrupt, unusual format, or not actually PDFs). Check them by hand.',
  });
  return out;
}

/** Totals used for the remediation estimate in the report. */
export function pdfSummary(pdfs: PdfResult[]) {
  const analyzed = pdfs.filter((p) => p.analyzed);
  const sum = (list: PdfResult[]) => list.reduce((n, p) => n + (p.pages ?? 0), 0);
  const untagged = analyzed.filter((p) => p.tagged === false);
  const scanned = analyzed.filter((p) => p.textLayer === 'none' || p.textLayer === 'partial');
  return {
    found: pdfs.length,
    analyzed: analyzed.length,
    notAnalyzed: pdfs.length - analyzed.length,
    totalPages: sum(analyzed),
    untagged: untagged.length,
    untaggedPages: sum(untagged),
    scanned: scanned.length,
    scannedPages: analyzed.reduce((n, p) => n + (p.imageOnlyPages ?? 0), 0),
    noTitle: analyzed.filter((p) => !p.title).length,
    noLang: analyzed.filter((p) => !p.lang).length,
    knownBytes: pdfs.reduce((n, p) => n + (p.bytes ?? 0), 0),
  };
}
