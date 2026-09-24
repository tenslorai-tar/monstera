// @ts-check
/**
 * What MuPDF writes for a highlight's blend mode, author and creation date, and whether a second
 * engine draws the blend the same way — measured before the Properties tab's Blend, Author and
 * Created rows are designed (the owner's request, 2026-09-24).
 *
 * ## The questions
 *
 * 1. Does MuPDF's regenerated appearance (`update()`) for a highlight carry a blend mode, and where —
 *    the annotation dictionary's `/BM`, the appearance stream's `/ExtGState`, or neither?
 * 2. If the appearance's ExtGState is set to `/Normal`, do MuPDF AND PDFium both draw the highlight
 *    over a black box as opaque yellow — and with `/Multiply`, both leave the box black? A viewer
 *    reads the appearance stream, so agreement between two independent rasterisers on the same bytes
 *    is the evidence that other viewers will show what Monstera shows.
 * 3. Does a later `update()` keep an ExtGState blend written by hand, or regenerate it away?
 * 4. `setAuthor` and `setCreationDate`: what bytes, and does either (or `update()`) also stamp `/M`,
 *    which would put a clock in a command declared reproducible?
 *
 * ## The fixture
 *
 * One page, a black box at x 100–200, y 600–700, and a yellow highlight at opacity 1 whose quad
 * covers x 150–250 of the same band — half over the box, half over white paper. PDFium is asked to
 * render WITH `FPDF_ANNOT` (0x01); without it no annotation is drawn at all, which would make every
 * reading below the paper's.
 *
 * Run: node scripts/research/annotationBlend.mjs
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import koffi from 'koffi';
import * as mupdf from 'mupdf';

import { pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE = { width: 612, height: 792 };
/** Sample points in PDF user space: inside the highlight over the box, and over paper. */
const OVER_BOX = { x: 175, y: 650 };
const OVER_PAPER = { x: 225, y: 650 };
const FPDF_ANNOT = 0x01;

async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 100, y: 600, width: 100, height: 100, color: rgb(0, 0, 0) });
  return document.save({ useObjectStreams: false });
}

/**
 * @param {Uint8Array} bytes
 * @param {(annotation: mupdf.PDFAnnotation, document: mupdf.PDFDocument) => void} work
 */
function withHighlight(bytes, work) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  const page = /** @type {mupdf.PDFPage} */ (document.loadPage(0));
  const annotation = page.createAnnotation('Highlight');
  annotation.setColor([1, 1, 0]);
  annotation.setOpacity(1);
  // MuPDF's QUAD IS TOP-DOWN (fitz space): PDF y 600–700 on a 792-high page is fitz y 92–192. The
  // first run wrote the PDF numbers here and drew the highlight mirrored, at PDF y 92–192, where no
  // sample point was — every reading was paper.
  annotation.addQuadPoint([150, 92, 250, 92, 150, 192, 250, 192]);
  work(annotation, document);
  const out = document.saveToBuffer('').asUint8Array().slice();
  document.destroy();
  return out;
}

/** @param {mupdf.PDFAnnotation} annotation */
function describe(annotation) {
  const object = annotation.getObject();
  const ap = object.get('AP');
  const normal = ap.isNull() ? null : ap.get('N');
  const resources = normal === null || normal.isNull() ? null : normal.get('Resources');
  const gs = resources === null || resources.isNull() ? null : resources.get('ExtGState');
  /** @type {string[]} */
  const states = [];
  if (gs !== null && !gs.isNull()) {
    gs.forEach((value, key) => {
      states.push(`${String(key)}: BM=${String(value.get('BM'))} CA=${String(value.get('CA'))} ca=${String(value.get('ca'))}`);
    });
  }
  return {
    dictBM: String(object.get('BM')),
    dictT: String(object.get('T')),
    dictCreationDate: String(object.get('CreationDate')),
    dictM: String(object.get('M')),
    apStates: states,
    apContent: normal === null || normal.isNull() ? null : normal.readStream().asString().slice(0, 200),
  };
}

/** @param {mupdf.PDFAnnotation} annotation @param {mupdf.PDFDocument} document @param {string} mode */
function setAppearanceBlend(annotation, document, mode) {
  const normal = annotation.getObject().get('AP').get('N');
  const gs = normal.get('Resources').get('ExtGState');
  gs.forEach((value) => {
    value.put('BM', document.newName(mode));
  });
}

/** @param {Uint8Array} bytes */
function mupdfPixels(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  const pixmap = document.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  const stride = pixmap.getStride();
  const pixels = pixmap.getPixels();
  /** @param {{x: number, y: number}} at */
  const read = (at) => {
    const offset = (PAGE.height - at.y) * stride + at.x * 3;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]].join(',');
  };
  const result = { overBox: read(OVER_BOX), overPaper: read(OVER_PAPER) };
  pixmap.destroy();
  document.destroy();
  return result;
}

function pdfiumApi() {
  const library = koffi.load(pdfiumLibrary(root));
  return {
    initialise: library.func('void FPDF_InitLibrary()'),
    loadDocument: library.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *password)'),
    closeDocument: library.func('void FPDF_CloseDocument(void *document)'),
    loadPage: library.func('void *FPDF_LoadPage(void *document, int index)'),
    closePage: library.func('void FPDF_ClosePage(void *page)'),
    createBitmap: library.func('void *FPDFBitmap_Create(int width, int height, int alpha)'),
    fillRect: library.func('void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)'),
    renderPage: library.func('void FPDF_RenderPageBitmap(void *bitmap, void *page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)'),
    bitmapBuffer: library.func('void *FPDFBitmap_GetBuffer(void *bitmap)'),
    bitmapStride: library.func('int FPDFBitmap_GetStride(void *bitmap)'),
    destroyBitmap: library.func('void FPDFBitmap_Destroy(void *bitmap)'),
  };
}

/** @param {ReturnType<typeof pdfiumApi>} api @param {Uint8Array} bytes */
function pdfiumPixels(api, bytes) {
  const buffer = Buffer.from(bytes);
  const document = api.loadDocument(buffer, buffer.length, null);
  if (document === null) throw new Error('PDFium refused the document');
  const page = api.loadPage(document, 0);
  const bitmap = api.createBitmap(PAGE.width, PAGE.height, 1);
  api.fillRect(bitmap, 0, 0, PAGE.width, PAGE.height, 0xffffffff);
  api.renderPage(bitmap, page, 0, 0, PAGE.width, PAGE.height, 0, FPDF_ANNOT);
  const stride = api.bitmapStride(bitmap);
  const pixels = koffi.decode(api.bitmapBuffer(bitmap), 'uint8_t', stride * PAGE.height);
  /** @param {{x: number, y: number}} at */
  const read = (at) => {
    const offset = (PAGE.height - at.y) * stride + at.x * 4;
    // BGRA to R,G,B.
    return [pixels[offset + 2], pixels[offset + 1], pixels[offset]].join(',');
  };
  const result = { overBox: read(OVER_BOX), overPaper: read(OVER_PAPER) };
  api.destroyBitmap(bitmap);
  api.closePage(page);
  api.closeDocument(document);
  return result;
}

const base = await fixture();
const api = pdfiumApi();
api.initialise();

// POSITIVE CONTROL: the page with no annotation — the box must read black and the paper white in
// both engines, or the sample points are not where the fixture put things.
console.log('no annotation      ', 'mupdf', mupdfPixels(base), 'pdfium', pdfiumPixels(api, base));

/** @type {Record<string, (a: mupdf.PDFAnnotation, d: mupdf.PDFDocument) => void>} */
const variants = {
  'update() as MuPDF writes it': (a) => {
    a.update();
  },
  'AP ExtGState set to Normal': (a, d) => {
    a.update();
    setAppearanceBlend(a, d, 'Normal');
  },
  'AP ExtGState Multiply': (a, d) => {
    a.update();
    setAppearanceBlend(a, d, 'Multiply');
  },
  'Normal, then update() again': (a, d) => {
    a.update();
    setAppearanceBlend(a, d, 'Normal');
    a.setOpacity(0.99);
    a.update();
  },
  'dict /BM Normal, then update()': (a, d) => {
    a.getObject().put('BM', d.newName('Normal'));
    a.update();
  },
  'author + creation date, then update()': (a) => {
    a.setAuthor('Priya Raman');
    a.setCreationDate(new Date(Date.UTC(2026, 8, 24, 9, 38, 0)));
    a.update();
  },
};

/**
 * A filled yellow rectangle over the same band, for the kinds whose appearance MuPDF draws with no
 * ExtGState at opacity 1 — where setting "every ExtGState's /BM" would change nothing.
 *
 * @param {Uint8Array} bytes
 * @param {(annotation: mupdf.PDFAnnotation, document: mupdf.PDFDocument) => void} work
 */
function withSquare(bytes, work) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  const page = /** @type {mupdf.PDFPage} */ (document.loadPage(0));
  const annotation = page.createAnnotation('Square');
  annotation.setRect([150, 92, 250, 192]);
  annotation.setColor([1, 1, 0]);
  annotation.setInteriorColor([1, 1, 0]);
  annotation.setOpacity(1);
  work(annotation, document);
  const out = document.saveToBuffer('').asUint8Array().slice();
  document.destroy();
  return out;
}

/**
 * Prepends `/MonsteraBlend gs` naming an ExtGState that carries only `/BM`, so the whole appearance
 * paints in that mode — the route for an appearance MuPDF drew with no ExtGState of its own.
 *
 * @param {mupdf.PDFAnnotation} annotation @param {mupdf.PDFDocument} document @param {string} mode
 */
function prependBlend(annotation, document, mode) {
  const normal = annotation.getObject().get('AP').get('N');
  let resources = normal.get('Resources');
  if (resources.isNull()) {
    resources = document.newDictionary();
    normal.put('Resources', resources);
  }
  let states = resources.get('ExtGState');
  if (states.isNull()) {
    states = document.newDictionary();
    resources.put('ExtGState', states);
  }
  const state = document.newDictionary();
  state.put('Type', document.newName('ExtGState'));
  state.put('BM', document.newName(mode));
  states.put('MonsteraBlend', state);
  const content = normal.readStream().asString();
  normal.writeStream(`/MonsteraBlend gs\n${content}`);
}

for (const [name, work] of Object.entries({
  'square as MuPDF writes it': (/** @type {mupdf.PDFAnnotation} */ a) => {
    a.update();
  },
  'square with a prepended Multiply': (/** @type {mupdf.PDFAnnotation} */ a, /** @type {mupdf.PDFDocument} */ d) => {
    a.update();
    prependBlend(a, d, 'Multiply');
  },
})) {
  /** @type {ReturnType<typeof describe> | undefined} */
  let seen;
  const bytes = withSquare(base, (annotation, document) => {
    work(annotation, document);
    seen = describe(annotation);
  });
  const drawnByMupdf = mupdfPixels(bytes);
  const drawnByPdfium = pdfiumPixels(api, bytes);
  console.log(`\n${name}`);
  console.log('  in session ', JSON.stringify(seen));
  console.log('  pixels      mupdf', JSON.stringify(drawnByMupdf), 'pdfium', JSON.stringify(drawnByPdfium));
  if (drawnByMupdf.overPaper === '255,255,255' || drawnByPdfium.overPaper === '255,255,255') {
    throw new Error(`${name}: the paper sample reads white, so it is not under the rectangle`);
  }
}

for (const [name, work] of Object.entries(variants)) {
  /** @type {ReturnType<typeof describe> | undefined} */
  let seen;
  const bytes = withHighlight(base, (annotation, document) => {
    work(annotation, document);
    seen = describe(annotation);
  });
  // READ BACK AFTER A SAVE AND REOPEN, so what is described is what a viewer would open.
  const reopened = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  const annotation = /** @type {mupdf.PDFPage} */ (reopened.loadPage(0)).getAnnotations()[0];
  const after = annotation === undefined ? null : describe(annotation);
  const readBack = annotation === undefined ? null : { author: annotation.getAuthor(), created: annotation.getCreationDate().toISOString() };
  reopened.destroy();
  console.log(`\n${name}`);
  console.log('  in session ', JSON.stringify(seen));
  console.log('  reopened   ', JSON.stringify(after));
  console.log('  getters    ', JSON.stringify(readBack));
  const drawnByMupdf = mupdfPixels(bytes);
  const drawnByPdfium = pdfiumPixels(api, bytes);
  console.log('  pixels      mupdf', JSON.stringify(drawnByMupdf), 'pdfium', JSON.stringify(drawnByPdfium));
  // THE CONTROL: over paper, a yellow highlight is yellow in both engines whatever the blend. White
  // there means the sample missed the highlight, and every other reading is worthless.
  if (drawnByMupdf.overPaper === '255,255,255' || drawnByPdfium.overPaper === '255,255,255') {
    throw new Error(`${name}: the paper sample reads white, so it is not under the highlight`);
  }
}
