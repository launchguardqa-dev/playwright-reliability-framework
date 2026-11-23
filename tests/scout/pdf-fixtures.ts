import { PDFDocument, PDFName, PDFBool, PDFString, StandardFonts } from 'pdf-lib';

/**
 * Generates small PDFs with known accessibility properties, for testing Scout's
 * PDF checks without depending on real-world files.
 */

// 1x1 PNG, used as a "scanned page" image
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

interface Options {
  pages?: number;
  /** Each page is a scanned image (no fonts). Overrides text. */
  scanned?: boolean;
  /** Only the last page is a scanned image. */
  lastPageScanned?: boolean;
  title?: string;
  lang?: string;
  /** Adds a StructTreeRoot and MarkInfo/Marked = true. */
  tagged?: boolean;
}

export async function makePdf(opts: Options = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(PNG);
  const count = opts.pages ?? 1;
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([300, 400]);
    const imageOnly = opts.scanned || (opts.lastPageScanned && i === count - 1);
    if (imageOnly) page.drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
    else page.drawText(`Page ${i + 1} of a public agenda`, { x: 20, y: 360, size: 12, font });
  }
  if (opts.title) doc.setTitle(opts.title);
  // pdf-lib sets a default Producer/Creator but no Title unless asked.
  if (opts.lang) doc.catalog.set(PDFName.of('Lang'), PDFString.of(opts.lang));
  if (opts.tagged) {
    doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: PDFBool.True }));
    doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(doc.context.obj({ Type: 'StructTreeRoot' })));
  }
  return doc.save({ updateFieldAppearances: false });
}
