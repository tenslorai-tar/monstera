// @ts-check
/**
 * The print route, measured through the module the application ships
 * (`apps/desktop/dist/win32PrintSurface.js`, ADR-0074). Windows only; build first.
 *
 * ## Two readings, and what each can and cannot say
 *
 * 1. **The dialog's structure.** `PrintDlgExW` validates `lStructSize` and refuses a
 *    structure it does not recognise, so asking it for the DEFAULT printer — which
 *    shows no dialog — and getting a device context back says the structure koffi
 *    lays out is the one comdlg32 reads. Nothing is printed: the context is released
 *    without a document. What it cannot say is anything about the dialog a person
 *    sees; that is a live run.
 * 2. **The drawing.** `printJobOn` — the code a print runs — draws a generated
 *    two-page document's MuPDF rasters into a *Microsoft Print to PDF* device context
 *    whose output is a file, and the file is read back and each printed page compared
 *    with the raster sent for it. **The control is the other page**: a comparison
 *    that could not tell pages apart would score both pairs alike.
 *
 * Usage: node scripts/research/printRoute.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';

if (process.platform !== 'win32') throw new Error('the print route is Win32; nothing was measured');

const root = repoRoot();
const require = createRequire(join(root, 'package.json'));
const koffi = require('koffi');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const mupdf = await import(pathToFileURL(require.resolve('mupdf', { paths: [join(root, 'packages/kernel')] })).href);
const surface = await import(pathToFileURL(join(root, 'apps/desktop/dist/win32PrintSurface.js')).href);

const DPI = 150;

/**
 * A PNG's pixels as the surface takes them, decoded by MuPDF — the application uses Electron's decoder.
 *
 * @param {Uint8Array} png
 */
function decode(png) {
  const pixmap = new mupdf.Image(png).toPixmap();
  const rgbPixmap = pixmap.getNumberOfComponents() === 3 ? pixmap : pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
  const width = rgbPixmap.getWidth();
  const height = rgbPixmap.getHeight();
  const stride = rgbPixmap.getStride();
  const source = rgbPixmap.getPixels();
  const bgra = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = y * stride + x * 3;
      const to = (y * width + x) * 4;
      bgra[to] = source[from + 2];
      bgra[to + 1] = source[from + 1];
      bgra[to + 2] = source[from];
    }
  }
  return { width, height, bgra };
}

// ── 1. The dialog's structure, through the default printer ───────────────────
// THE DESKTOP WINDOW AS OWNER, since this process has no window of its own and the
// dialog refuses none (E_HANDLE); the application passes its own window.
const user = koffi.load('user32.dll');
const desktopWindow = user.func('void *GetDesktopWindow()');
const owner = () => BigInt(koffi.address(desktopWindow()));
const chosen = surface.createWin32PrintSurface(decode, owner, true).choose(3);
if (chosen === null) throw new Error('PrintDlgExW answered no default printer, so the structure was not measured');
console.log(`default printer answered: pages ${JSON.stringify(chosen.pages)} (all three, since no range was typed)`);
chosen.release();

// ── 2. The drawing, into a file ───────────────────────────────────────────────
const document = await PDFDocument.create();
const font = await document.embedFont(StandardFonts.HelveticaBold);
for (const [label, colour] of /** @type {const} */ ([
  ['FIRST PAGE', rgb(0.8, 0.1, 0.1)],
  ['SECOND', rgb(0.1, 0.2, 0.8)],
])) {
  const page = document.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 500, width: 300, height: 200, color: colour });
  page.drawText(label, { x: 72, y: 300, size: 40, font });
}
const source = mupdf.Document.openDocument(await document.save(), 'application/pdf');

const folder = mkdtempSync(join(tmpdir(), 'monstera-print-'));
const output = join(folder, 'printed.pdf');
const gdi = koffi.load('gdi32.dll');
const createDc = gdi.func('void *CreateDCW(const char16_t *driver, const char16_t *device, const char16_t *port, void *mode)');
const deleteDc = gdi.func('bool DeleteDC(void *dc)');
const dc = createDc('WINSPOOL', 'Microsoft Print to PDF', null, null);
if (dc === null) throw new Error('no Microsoft Print to PDF printer, so the drawing was not measured');

const sent = [];
try {
  const job = surface.printJobOn(surface.win32PrintBindings(), dc, 'print route', decode, output);
  for (let index = 0; index < source.countPages(); index += 1) {
    const pixmap = source.loadPage(index).toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceRGB, false);
    sent.push({ width: pixmap.getWidth(), height: pixmap.getHeight(), pixels: pixmap.getPixels().slice() });
    job.page(pixmap.asPNG());
  }
  job.finish();
} finally {
  deleteDc(dc);
}

for (let wait = 0; wait < 100 && !existsSync(output); wait += 1) await new Promise((resolve) => setTimeout(resolve, 100));
if (!existsSync(output)) throw new Error('the printer wrote no file');
const printed = mupdf.Document.openDocument(readFileSync(output), 'application/pdf');
console.log(`printed ${String(printed.countPages())} page(s) from ${String(sent.length)} sent`);

/** @type {(a: Uint8Array, b: Uint8Array) => number} */
const meanDifference = (a, b) => {
  let total = 0;
  for (let at = 0; at < a.length; at += 1) total += Math.abs((a[at] ?? 0) - (b[at] ?? 0));
  return total / a.length;
};
for (let index = 0; index < printed.countPages(); index += 1) {
  const page = printed.loadPage(index);
  const [x0, y0, x1, y1] = page.getBounds();
  for (const [other, raster] of sent.entries()) {
    const back = page.toPixmap(mupdf.Matrix.scale(raster.width / (x1 - x0), raster.height / (y1 - y0)), mupdf.ColorSpace.DeviceRGB, false);
    const label = other === index ? 'the raster sent for it' : 'the other page (control)';
    console.log(`printed page ${String(index + 1)} against ${label}: mean ${meanDifference(back.getPixels(), raster.pixels).toFixed(2)} of 255`);
  }
}
rmSync(folder, { recursive: true, force: true });
