import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import * as mupdf from './mupdfRaw.js';
import type { RecognisedLine, RecognisedPage } from './ocrRecognise.js';
import { wholeFile } from './pdfLibSession.js';

/**
 * A printed scan of a clean ruled table, built here so no binary is committed (B10): the owner's O2 `scanned-table.pdf`
 * as the reviewer described it — one page that is a picture, holding a table of Region / Units / Price with a row each
 * for North, South and West, every cell ruled. Used only by tests.
 *
 * The table is drawn with vectors and words, rendered to pixels by MuPDF, and the pixels are the whole of the second
 * document's page: no vector, no word, nothing but an image, which is what a scanner writes.
 */

/** The table's cells, by row, as a reader of the picture should find them. */
export const SCAN_TABLE_ROWS: readonly (readonly string[])[] = [
  ['Region', 'Units', 'Price'],
  ['North', '120', '4.50'],
  ['South', '95', '4.75'],
  ['West', '210', '3.90'],
];

/** The resolution the picture is rendered at: a common scanning resolution. */
const SCAN_DPI = 200;

/** Where the table is drawn, in PDF user space: what a recognised layer of it is placed from. */
const LAYOUT = { left: 120, top: 640, widths: [140, 100, 100], height: 32, inset: 8, drop: 21, size: 13 } as const;

/**
 * The words of the scanned table as a recognition reads them: one line per ROW, its words in their cells, at the places
 * the table drew them. A row as one line is what MuPDF makes of a recognised layer written word by word, across the
 * cells' rulings, so the reader under test has to put a line's characters into cells and cannot take a line as a cell.
 */
export async function scanTableRecognised(): Promise<RecognisedPage> {
  const measure = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const lines: RecognisedLine[] = SCAN_TABLE_ROWS.map((cells, row) => {
    const baseline = LAYOUT.top - row * LAYOUT.height - LAYOUT.drop;
    let at = LAYOUT.left;
    const words = cells.map((text, column) => {
      const x0 = at + LAYOUT.inset;
      at += LAYOUT.widths[column] ?? 0;
      const box: [number, number, number, number] = [x0, baseline - 3, x0 + measure.widthOfTextAtSize(text, LAYOUT.size), baseline + 10];
      return { text, box, confidence: 95 };
    });
    const first = words[0]?.box ?? [0, 0, 0, 0];
    const last = words.at(-1)?.box ?? first;
    return { text: cells.join(' '), box: [first[0], first[1], last[2], last[3]], words };
  });
  return { lines, confidence: 95, languages: ['eng'] };
}

/** The ruled table as vectors and words, the document a scanner would have been shown. */
export async function buildRuledTablePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const { left, top, widths, height } = LAYOUT;
  const right = left + widths.reduce((sum, width) => sum + width, 0);
  const bottom = top - height * SCAN_TABLE_ROWS.length;
  for (let row = 0; row <= SCAN_TABLE_ROWS.length; row += 1) {
    const y = top - row * height;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.2, color: rgb(0, 0, 0) });
  }
  let x = left;
  for (let column = 0; column <= widths.length; column += 1) {
    page.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 1.2, color: rgb(0, 0, 0) });
    x += widths[column] ?? 0;
  }
  SCAN_TABLE_ROWS.forEach((cells, row) => {
    let at = left;
    cells.forEach((cell, column) => {
      page.drawText(cell, { x: at + LAYOUT.inset, y: top - row * height - LAYOUT.drop, size: LAYOUT.size, font });
      at += widths[column] ?? 0;
    });
  });
  return wholeFile(document);
}

/** The ruled table as a scan: the picture of {@link buildRuledTablePdf}'s page, and nothing else on the page. */
export async function buildScannedTablePdf(): Promise<Uint8Array> {
  return scanOf(await buildRuledTablePdf());
}

/** The lines of {@link buildPrintedScanPdf}'s typed page, as a reader of the picture should find them. */
export const PRINTED_SCAN_LINES: readonly string[] = [
  'Quarterly report for the northern region',
  'Sales rose by twelve percent over the quarter,',
  'led by strong demand for the new product line.',
  'The team expects similar growth next year.',
];

/** A typed page of prose as a scan: the printed counterpart to a handwritten page, for recognition and then an edit. */
export async function buildPrintedScanPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  PRINTED_SCAN_LINES.forEach((text, row) => {
    page.drawText(text, { x: 72, y: 700 - row * 22, size: 14, font });
  });
  return scanOf(await wholeFile(document));
}

/** Page 1 of `bytes` as a scanner writes it: its pixels at {@link SCAN_DPI}, greyscale, and nothing else on the page. */
async function scanOf(bytes: Uint8Array): Promise<Uint8Array> {
  const drawn = mupdf.Document.openDocument(bytes, 'application/pdf');
  const scale = SCAN_DPI / 72;
  const pixmap = drawn.loadPage(0).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false);
  const png = pixmap.asPNG();
  pixmap.destroy();
  drawn.destroy();
  const scanned = await PDFDocument.create();
  const page = scanned.addPage([612, 792]);
  const image = await scanned.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return wholeFile(scanned);
}
