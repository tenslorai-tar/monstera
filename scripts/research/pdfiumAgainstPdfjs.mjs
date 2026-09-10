// @ts-check
/**
 * PDFium against PDF.js, in PIXELS — the reading the HD render row owes.
 *
 * ## The debt, in the row's own words
 *
 * `docs/FEATURES.md`'s *HD render toggle* row: **it owes a PDFium-against-PDF.js
 * reading before it ships, `canvasReadback.mjs` carrying pixels, not counts.**
 * `pdfiumRender.mjs` (2026-09-08) said the same thing from the other side —
 * *"Neither pair is measured against PDF.js here… Extending that to carry pixels
 * is proof infrastructure, and it is owed before the toggle ships."* This is
 * that reading, and the harness now writes the canvas's own pixels to a file.
 *
 * ## Why the pair matters, and why the earlier one did not answer it
 *
 * `docs/ARCHITECTURE.md` §3 places the toggle where **PDF.js** draws every page
 * a reader sees, so the toggle's pair is PDFium against PDF.js and MuPDF appears
 * in it nowhere. `pdfiumRender.mjs` measured PDFium against MuPDF — deliberately,
 * because that is the pair that decides the COST — and recorded that its answer
 * is not this one.
 *
 * ## WHAT IS MEASURED, and what it is not
 *
 * *Which of these two images is better* has no answer a script can give. What a
 * toggle needs is narrower and answerable: **do they differ at all, and where.**
 * A toggle offering a second rasteriser that draws the same pixels is the
 * display-only defect with a settings entry on it.
 *
 * So this reports, over the same page at the same device size:
 *
 *   - the mean absolute difference per pixel, in levels 0–255;
 *   - the same over INKED pixels only, because a page is mostly white and a mean
 *     over the whole canvas is a small number whatever the glyphs do;
 *   - how much ink each engine laid down, so *they differ* can be read against
 *     *one of them drew more*, which is the hinting explanation
 *     `pdfiumRender.mjs` had to separate too.
 *
 * ## Its own controls, because a difference metric's reassuring answer is small
 *
 * - **RESOLUTION (audit item 4a):** two buffers differing by one level in one
 *   pixel must report exactly that, before anything real is compared. A blind
 *   metric reports small numbers for everything, and small is what this hopes
 *   for.
 * - **BOTH ENGINES DREW.** A comparison of two blank canvases agrees perfectly,
 *   which is the reassuring answer produced by total failure. Each side's ink is
 *   required to be non-zero and is printed.
 * - **THE SIZES MATCH.** Comparing buffers of different shapes is either a crash
 *   or an accidental crop; the run refuses rather than reporting a number about
 *   an alignment nobody chose.
 *
 * Usage: node scripts/research/pdfiumAgainstPdfjs.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import koffi from 'koffi';

import { controlName, readback } from '../lib/canvasReadback.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { formatError } from '../lib/reportError.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The fixture's page box, in points.
 *
 * A4 at 72dpi, which is what `PDFDocument.addPage()` produces by default and
 * what the renderer will lay out — so the device size PDF.js draws at is this
 * times its own scale, and PDFium is asked for exactly the pixels that came
 * back rather than a size computed here.
 */
const PAGE = { width: 595.28, height: 841.89 };

/**
 * A page of text at several sizes, plus one filled shape.
 *
 * TEXT IS THE SUBJECT: the toggle's whole claim is about how glyphs look, and a
 * page of rectangles would agree between any two rasterisers that can fill a
 * box. The sizes vary because anti-aliasing differs most where stems are
 * thinnest, and the shape is there so a difference confined to glyphs is
 * separable from one that is everywhere.
 *
 * @returns {Promise<Uint8Array>}
 */
async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [at, size] of [7, 9, 11, 14, 18, 24, 36].entries()) {
    page.drawText('Handgloves qijp 0123 — the quick brown fox', {
      x: 40,
      y: PAGE.height - 80 - at * 70,
      size,
      font,
    });
  }
  page.drawRectangle({ x: 40, y: 60, width: 200, height: 60, color: rgb(0, 0, 0) });
  return document.save();
}

/** PDFium's bindings, exactly the set this reading needs. */
function pdfiumApi() {
  const library = koffi.load(pdfiumLibrary(REPO_ROOT));
  return {
    initialise: library.func('void FPDF_InitLibrary()'),
    destroy: library.func('void FPDF_DestroyLibrary()'),
    loadDocument: library.func(
      'void *FPDF_LoadMemDocument(const void *data, int size, const char *password)',
    ),
    closeDocument: library.func('void FPDF_CloseDocument(void *document)'),
    loadPage: library.func('void *FPDF_LoadPage(void *document, int index)'),
    closePage: library.func('void FPDF_ClosePage(void *page)'),
    createBitmap: library.func('void *FPDFBitmap_Create(int width, int height, int alpha)'),
    fillRect: library.func(
      'void FPDFBitmap_FillRect(void *bitmap, int left, int top, int width, int height, unsigned long colour)',
    ),
    renderPage: library.func(
      'void FPDF_RenderPageBitmap(void *bitmap, void *page, int start_x, int start_y, int size_x, int size_y, int rotate, int flags)',
    ),
    bitmapBuffer: library.func('void *FPDFBitmap_GetBuffer(void *bitmap)'),
    bitmapStride: library.func('int FPDFBitmap_GetStride(void *bitmap)'),
    destroyBitmap: library.func('void FPDFBitmap_Destroy(void *bitmap)'),
  };
}

/**
 * A single-channel view of a render, in levels 0–255.
 *
 * @typedef {{ width: number, height: number, grey: Float64Array }} Grey
 */

/**
 * PDFium's render at exactly the pixel size the renderer produced.
 *
 * THE SIZE IS PASSED IN rather than computed from a scale, which is the whole
 * alignment: PDF.js chose a device size from its own layout and its own device
 * pixel ratio, and a size derived here from a scale would agree with it on the
 * developer's display and differ on anyone else's.
 *
 * @param {ReturnType<typeof pdfiumApi>} api
 * @param {Uint8Array} bytes
 * @param {number} width
 * @param {number} height
 * @returns {Grey}
 */
function renderWithPdfium(api, bytes, width, height) {
  const buffer = Buffer.from(bytes);
  const document = api.loadDocument(buffer, buffer.length, null);
  if (document === null) throw new Error('PDFium refused the fixture');
  const page = api.loadPage(document, 0);
  const bitmap = api.createBitmap(width, height, 1);
  // WHITE FIRST. PDFium draws onto whatever the buffer holds, and a page with no
  // background would otherwise composite over uninitialised memory — noise in
  // exactly the places anti-aliasing is being compared.
  api.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
  api.renderPage(bitmap, page, 0, 0, width, height, 0, 0);

  const stride = api.bitmapStride(bitmap);
  const pixels = koffi.decode(api.bitmapBuffer(bitmap), 'uint8_t', stride * height);
  const grey = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // LUMINANCE, not one channel. `pdfiumRender.mjs` reads blue alone because
      // its fixture is black on white and one channel is the grey value there;
      // this compares two engines whose sub-pixel handling may differ, so the
      // three are weighted rather than one being trusted to stand for them.
      const at = y * stride + x * 4;
      const blue = pixels[at] ?? 0;
      const green = pixels[at + 1] ?? 0;
      const red = pixels[at + 2] ?? 0;
      grey[y * width + x] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    }
  }

  api.destroyBitmap(bitmap);
  api.closePage(page);
  api.closeDocument(document);
  return { width, height, grey };
}

/**
 * The harness's RGBA file as the same single-channel view.
 *
 * @param {string} path
 * @param {number} width
 * @param {number} height
 * @returns {Grey}
 */
function greyFromRgba(path, width, height) {
  const bytes = readFileSync(path);
  if (bytes.length !== width * height * 4) {
    throw new Error(
      `${path} holds ${String(bytes.length)} bytes for a ${String(width)}x${String(height)} ` +
        `canvas, which needs ${String(width * height * 4)}. Comparing this would be a reading ` +
        `about an alignment nobody chose.`,
    );
  }
  const grey = new Float64Array(width * height);
  for (let at = 0; at < grey.length; at += 1) {
    const red = bytes[at * 4] ?? 0;
    const green = bytes[at * 4 + 1] ?? 0;
    const blue = bytes[at * 4 + 2] ?? 0;
    grey[at] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  return { width, height, grey };
}

/**
 * How two renders differ.
 *
 * @param {Grey} left
 * @param {Grey} right
 */
function compare(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `${String(left.width)}x${String(left.height)} against ` +
        `${String(right.width)}x${String(right.height)}: two buffers of different shapes cannot ` +
        `be compared pixel for pixel, and cropping one would be an alignment nobody chose.`,
    );
  }
  let total = 0;
  let worst = 0;
  let differing = 0;
  let inkedTotal = 0;
  let inked = 0;
  let leftInk = 0;
  let rightInk = 0;
  for (let at = 0; at < left.grey.length; at += 1) {
    const a = left.grey[at] ?? 0;
    const b = right.grey[at] ?? 0;
    const delta = Math.abs(a - b);
    total += delta;
    if (delta > worst) worst = delta;
    if (delta >= 1) differing += 1;
    // INKED means either engine put something there. Using one engine's ink
    // would measure the other against the first's idea of where the page is,
    // which is the comparison-against-a-reference shape this avoids.
    if (a < 250 || b < 250) {
      inked += 1;
      inkedTotal += delta;
    }
    if (a < 250) leftInk += 1;
    if (b < 250) rightInk += 1;
  }
  return {
    pixels: left.grey.length,
    mean: total / left.grey.length,
    meanInked: inked === 0 ? 0 : inkedTotal / inked,
    worst,
    differing,
    inked,
    leftInk,
    rightInk,
  };
}

/**
 * The resolution test, run BEFORE anything real is measured.
 *
 * Audit item 4a: feed the metric two buffers that differ by the smallest amount
 * that would change a reading, and confirm it reports exactly that. A difference
 * metric's reassuring answer is a small number, and a blind one produces small
 * numbers for everything.
 */
function resolutionTest() {
  const width = 4;
  const height = 4;
  /** @returns {Grey} */
  const flat = () => ({ width, height, grey: new Float64Array(width * height).fill(255) });
  const left = flat();
  const right = flat();
  right.grey[5] = 254;
  const seen = compare(left, right);
  const expected = 1 / (width * height);
  if (Math.abs(seen.mean - expected) > 1e-9 || seen.worst !== 1 || seen.differing !== 1) {
    throw new Error(
      `The metric cannot see one level in one pixel: mean ${String(seen.mean)} against ` +
        `${String(expected)}, worst ${String(seen.worst)}, differing ${String(seen.differing)}. ` +
        `Nothing it reports below would mean anything.`,
    );
  }
  process.stdout.write(
    `  resolution: one level in one of ${String(width * height)} pixels reads as ` +
      `mean ${seen.mean.toFixed(6)}, worst ${String(seen.worst)}, differing ${String(seen.differing)}\n\n`,
  );
}

const library = pdfiumLibrary(REPO_ROOT);
if (!existsSync(library)) {
  process.stderr.write(
    `\nNo PDFium at ${library}. Run \`npm run provision:pdfium\` — it fetches the pinned ` +
      `${PDFIUM_VERSION} build and verifies it against a recorded SHA-256.\n`,
  );
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-render-pair-'));
try {
  process.stdout.write(`# PDFium ${PDFIUM_VERSION} against PDF.js, in pixels\n\n`);
  resolutionTest();

  const bytes = await fixture();
  const document = join(scratch, 'fixture.pdf');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(document, bytes);
  const pixels = join(scratch, 'pdfjs.rgba');

  // THE SHIPPED RENDERER, driven through the shipped Open control — which is
  // what makes this PDF.js *as the product uses it* rather than PDF.js as a
  // script configures it. The control's name is read from the catalogue, with
  // its own positive control.
  // THE KEYS ARE `canvasPixels.proof.mjs`' OWN, and they are read from the
  // catalogue rather than spelt as English here — `controlName` throws on a
  // miss, which is what stops a wrong key being handed to the harness as the
  // name to click and producing "the control was not found" for a control that
  // is there.
  const answer = readback(
    electronBinaryPath(REPO_ROOT),
    controlName('command.open-document.title'),
    document,
    controlName('command.zoom-in.title'),
    pixels,
  );
  if (answer.pixelsWritten === null) {
    throw new Error('The harness wrote no pixels, so there is nothing to compare PDFium against.');
  }
  const { width, height } = answer.pixelsWritten;
  process.stdout.write(
    `  PDF.js drew ${String(width)}x${String(height)} device pixels ` +
      `(settled by ${answer.settledBy}, ${String(answer.painted)} painted)\n`,
  );

  const api = pdfiumApi();
  api.initialise();
  const fromPdfium = renderWithPdfium(api, bytes, width, height);
  api.destroy();
  const fromPdfjs = greyFromRgba(answer.pixelsWritten.path, width, height);

  const seen = compare(fromPdfjs, fromPdfium);
  process.stdout.write(
    `\n## the two renders, pixel for pixel\n\n` +
      `  pixels compared     ${String(seen.pixels)}\n` +
      `  PDF.js ink          ${String(seen.leftInk)} pixels\n` +
      `  PDFium ink          ${String(seen.rightInk)} pixels\n` +
      `  mean difference     ${seen.mean.toFixed(3)} levels over the whole canvas\n` +
      `  mean over inked     ${seen.meanInked.toFixed(3)} levels\n` +
      `  worst pixel         ${seen.worst.toFixed(1)} levels\n` +
      `  differing pixels    ${String(seen.differing)} (${((seen.differing / seen.pixels) * 100).toFixed(2)}%)\n\n`,
  );

  // BOTH DREW, and this is the control that makes every figure above mean
  // something: two blank canvases agree perfectly, which is the reading total
  // failure produces.
  if (seen.leftInk === 0 || seen.rightInk === 0) {
    throw new Error(
      `One of the engines drew nothing — PDF.js ${String(seen.leftInk)} inked pixels, PDFium ` +
        `${String(seen.rightInk)}. A comparison against a blank canvas agrees with it perfectly, ` +
        `which is the answer this reading hopes for and the one total failure produces.`,
    );
  }
  process.stdout.write(
    '  Both engines drew, so the agreement above is between two renders rather than\n' +
      '  between two blank canvases. What this does NOT say is which is better: they\n' +
      '  differ, and difference is not quality (`pdfiumRender.mjs` §the metric).\n',
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
