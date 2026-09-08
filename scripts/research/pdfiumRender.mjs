// @ts-check
/**
 * What a second rasteriser would buy, measured before the host that carries it.
 *
 * ## The claim under test
 *
 * `docs/ARCHITECTURE.md`:797 says **PDFium is an optional higher-fidelity
 * rasteriser behind a setting**, and `docs/FEATURES.md`:144's *HD render toggle*
 * is that setting. Both are claims. Building a second contained host is the most
 * expensive thing Stage 5 does — ADR-0022's process shape, an AppContainer SID,
 * a DACL, a second host body, a second adapter — so the question is asked before
 * it, not after. A toggle offering *better rendering* that renders no better is
 * the display-only defect with a settings entry on it.
 *
 * ## WHICH PAIR — and the first version of this file measured the wrong one
 *
 * Recorded rather than corrected away, because the mistake is the instructive
 * part. This compared **PDFium against MuPDF** and read the result as an answer
 * about the toggle. It is not: §3 places the toggle where **PDF.js** draws every
 * page a reader sees, so the toggle's own pair is PDFium against PDF.js, and
 * MuPDF appears in it nowhere.
 *
 * What the pair it *did* measure answers is the question that decides the cost,
 * and that turns out to be the sharper one. **MuPDF is already here** — already
 * provisioned, already contained, already behind a host, already the kernel's
 * rasteriser for snapshots. If the product wants a second opinion about how a
 * page looks, there are two candidates and only one of them costs a host. So the
 * pair below is *the engine that is free* against *the engine that is expensive*,
 * and it is asked in the direction that could stop the work.
 *
 * Neither pair is measured against PDF.js here, and that is stated rather than
 * left implicit: PDF.js's raster comes from Chromium's canvas inside a renderer
 * process, which this project already reads back through
 * `scripts/lib/canvasReadback.mjs` — counts, not a buffer. Extending that to
 * carry pixels is proof infrastructure, and it is owed before the toggle ships.
 *
 * ## The metric, and why it is not a comparison between the two engines
 *
 * *Which of these two images is better* has no answer a script can give: they
 * differ, and difference is not quality. Comparing both against a reference
 * produced by one of them measures agreement with that one.
 *
 * So each engine is measured **against itself**. A correct rasteriser's 1×
 * output should look like its own 4× output box-filtered down to 1× — that is
 * what anti-aliasing is approximating, and the supersampled version is the answer
 * it is approximating *toward*. The deviation is per-engine, needs no shared
 * reference, and cannot favour either.
 *
 *   score = mean |native(1×) − downsample(own 4×)|   in levels, 0–255
 *
 * **A low score is agreement with itself across scale, which is not the same as
 * quality**, and §3 exists because of it. An engine that deliberately fattens
 * stems at low resolution — hinting, stem darkening — is scale-*inconsistent* on
 * purpose and scores badly here while looking better on a screen. That reading is
 * separable: darkening shows up as more ink at 1× than the same engine's own
 * supersampled render carries, so the ink is counted at both scales and the two
 * explanations stop being one number.
 *
 * ## And the scale sweep, which is the question the toggle actually asks
 *
 * An HD render toggle renders at a **higher** device pixel ratio. So the reading
 * that decides it is not how the engines differ at 1× — it is whether they still
 * differ where the toggle operates. §4 puts the same page through both at 1× to
 * 4× and reports the difference at each.
 *
 * ## Its own controls
 *
 * **The metric is resolution-tested before it measures anything** (audit item
 * 4a): two renders differing by one level in one pixel must report exactly that,
 * not zero. A difference metric's reassuring answer is a small number, and a
 * blind one produces small numbers for everything.
 *
 * **A downsampled 4× render must differ from the native 1× render at all.** If
 * the two agree exactly, this script is comparing something with itself and the
 * score is zero for a reason that has nothing to do with anti-aliasing.
 *
 * **And the fixture must carry glyph edges.** A blank page scores 0.00 for every
 * engine, which is the reassuring answer, so the ink is counted and a page
 * without it is refused.
 *
 * Run (after `node scripts/provision/pdfium.mjs`):
 *
 *   node scripts/research/pdfiumRender.mjs
 *
 * It prints readings, never a verdict.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import koffi from 'koffi';
import * as mupdf from 'mupdf';

import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The page, in points. */
const PAGE = { width: 612, height: 792 };

/** Device pixels per point at the size a reader actually looks at. */
const NATIVE_SCALE = 1;

/**
 * How much supersampling the reference uses.
 *
 * Four rather than two, because the reference has to be enough better than the
 * thing it judges for the difference to be about anti-aliasing rather than about
 * the reference's own edges. Sixteen samples per output pixel.
 */
const REFERENCE_SCALE = 4;

/** The device pixel ratios §4 sweeps. An HD toggle lives at the top of this. */
const SCALES = [1, 2, 3, 4];

/**
 * A text-heavy page, which is where rasterisation quality is visible at all.
 *
 * Glyph edges are the only thing on a page whose rendering differs measurably
 * between engines at the same scale — a filled rectangle is the same pixels
 * either way, and a fixture of those would score both engines identically and
 * prove nothing. Nine point, because a difference in anti-aliasing that does not
 * show at body-text size is not a difference a reader meets.
 */
async function textPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (let line = 0; line < 40; line += 1) {
    page.drawText(
      'The quick brown fox jumps over the lazy dog, 0123456789 — illegible at 6pt.',
      { x: 40, y: 740 - line * 18, size: 9, font },
    );
  }
  return document.save();
}

/**
 * Greyscale samples of one render, as a flat array.
 *
 * Greyscale rather than RGB because the question is edge quality: three channels
 * of the same black text triple the arithmetic and say the same thing, and one
 * of the two engines is asked for RGBA and the other for grey.
 *
 * @typedef {{ width: number, height: number, grey: Float64Array }} Render
 */

/**
 * MuPDF's render at a given scale.
 *
 * @param {Uint8Array} bytes
 * @param {number} scale
 * @returns {Render}
 */
function renderWithMupdf(bytes, scale) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceGray,
      false,
      true,
    );
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const pixels = pixmap.getPixels();
    const components = pixmap.getNumberOfComponents();
    const stride = pixmap.getStride();
    const grey = new Float64Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        grey[y * width + x] = pixels[y * stride + x * components] ?? 0;
      }
    }
    pixmap.destroy();
    return { width, height, grey };
  } finally {
    document.destroy();
  }
}

/** The PDFium entry points this script uses, bound once. */
function pdfiumApi() {
  const library = koffi.load(pdfiumLibrary(root));
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
 * PDFium's render at a given scale.
 *
 * The rectangle is filled white first because PDFium draws onto whatever the
 * buffer holds and a page with no background would otherwise be composited over
 * uninitialised memory — which reads as noise in exactly the places
 * anti-aliasing is being measured.
 *
 * @param {ReturnType<typeof pdfiumApi>} api
 * @param {Uint8Array} bytes
 * @param {number} scale
 * @returns {Render}
 */
function renderWithPdfium(api, bytes, scale) {
  const width = Math.round(PAGE.width * scale);
  const height = Math.round(PAGE.height * scale);
  const buffer = Buffer.from(bytes);
  const document = api.loadDocument(buffer, buffer.length, null);
  if (document === null) throw new Error('PDFium refused the fixture');
  const page = api.loadPage(document, 0);
  const bitmap = api.createBitmap(width, height, 1);
  api.fillRect(bitmap, 0, 0, width, height, 0xffffffff);
  api.renderPage(bitmap, page, 0, 0, width, height, 0, 0);

  const stride = api.bitmapStride(bitmap);
  const pointer = api.bitmapBuffer(bitmap);
  const pixels = koffi.decode(pointer, 'uint8_t', stride * height);

  const grey = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // BGRA. The blue channel alone is the grey value for black-on-white text,
      // and the arithmetic only ever sees one channel — see {@link Render}.
      grey[y * width + x] = pixels[y * stride + x * 4] ?? 0;
    }
  }

  api.destroyBitmap(bitmap);
  api.closePage(page);
  api.closeDocument(document);
  return { width, height, grey };
}

/**
 * A render box-filtered down by an integer factor.
 *
 * @param {Render} source
 * @param {number} factor
 * @returns {Render}
 */
function downsample(source, factor) {
  const width = Math.floor(source.width / factor);
  const height = Math.floor(source.height / factor);
  const grey = new Float64Array(width * height);
  const samples = factor * factor;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          total += source.grey[(y * factor + dy) * source.width + (x * factor + dx)] ?? 0;
        }
      }
      grey[y * width + x] = total / samples;
    }
  }
  return { width, height, grey };
}

/**
 * Mean absolute difference between two renders of the same size, in levels.
 *
 * @param {Render} one
 * @param {Render} two
 * @returns {number}
 */
function meanDifference(one, two) {
  const width = Math.min(one.width, two.width);
  const height = Math.min(one.height, two.height);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      total += Math.abs((one.grey[y * one.width + x] ?? 0) - (two.grey[y * two.width + x] ?? 0));
    }
  }
  return total / (width * height);
}

/**
 * The same difference, over the pixels either render put ink on.
 *
 * ## WHY THE WHOLE-PAGE MEAN CANNOT BE COMPARED ACROSS SCALES
 *
 * A page's ink lives on glyph outlines, whose pixel count grows with the
 * **perimeter** — linearly in scale — while the denominator is the page area,
 * which grows **quadratically**. So a whole-page mean falls as roughly 1/scale
 * for two renderers whose disagreement per edge pixel never changes at all, and
 * a sweep reporting it would show convergence that is arithmetic rather than
 * optical. That is the reassuring answer arriving from the denominator: §4 is
 * asking whether the engines agree better at high resolution, and *they must
 * appear to* under this measure whatever they do.
 *
 * Restricting to pixels either render inked makes the denominator track the same
 * thing the numerator does, so the two scales' figures are about the same
 * quantity. Both are printed, because the whole-page figure is what a reader of
 * the screen actually experiences and the confound is in the comparison between
 * rows, not in either row.
 *
 * @param {Render} one
 * @param {Render} two
 * @returns {{ mean: number, pixels: number }}
 */
function inkedDifference(one, two) {
  const width = Math.min(one.width, two.width);
  const height = Math.min(one.height, two.height);
  let total = 0;
  let counted = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = one.grey[y * one.width + x] ?? 255;
      const right = two.grey[y * two.width + x] ?? 255;
      if (left < 250 || right < 250) {
        total += Math.abs(left - right);
        counted += 1;
      }
    }
  }
  return { mean: counted === 0 ? 0 : total / counted, pixels: counted };
}

/** How much of a render is not white. The fixture's own control, and §3's reading. */
function inkFraction(/** @type {Render} */ render) {
  let inked = 0;
  for (const sample of render.grey) if (sample < 250) inked += 1;
  return inked / render.grey.length;
}

/**
 * The metric's resolution test, run before it measures anything real.
 *
 * The smallest difference that could change a decision here is one level in one
 * pixel — anything the instrument cannot see below that, it reports as agreement,
 * and agreement is the answer every reading below was hoping for. Two synthetic
 * renders are built differing by exactly that, and the expected mean is
 * arithmetic rather than a tolerance: 1 level over `width × height` pixels.
 */
function resolutionTest() {
  const width = 100;
  const height = 100;
  const flat = { width, height, grey: new Float64Array(width * height).fill(200) };
  const nudged = { width, height, grey: Float64Array.from(flat.grey) };
  nudged.grey[42 * width + 17] = 199;

  const expected = 1 / (width * height);
  const measured = meanDifference(flat, nudged);
  console.log(`  one level in one pixel of ${String(width * height)}: expected ` +
    `${expected.toExponential(3)}, measured ${measured.toExponential(3)}`);
  if (measured !== expected) {
    throw new Error(
      `the difference metric reports ${String(measured)} for a one-level, one-pixel change ` +
        `where ${String(expected)} is arithmetic — so every figure below is a fact about a ` +
        'blind instrument rather than about either renderer',
    );
  }

  // AND THE OTHER DIRECTION, because a function returning the pixel count's
  // reciprocal for anything at all passes the case above. Identical inputs must
  // report zero, or the metric is reading something that is not the difference.
  const same = meanDifference(flat, { width, height, grey: Float64Array.from(flat.grey) });
  console.log(`  two identical renders: ${String(same)}`);
  if (same !== 0) {
    throw new Error(`the metric reports ${String(same)} for two identical renders`);
  }
}

async function main() {
  console.log('# What a second rasteriser would buy');
  console.log('');
  console.log(`  PDFium ${PDFIUM_VERSION}, MuPDF via the npm package`);
  console.log(
    `  page ${String(PAGE.width)}×${String(PAGE.height)}pt, native ${String(NATIVE_SCALE)}×,` +
      ` reference ${String(REFERENCE_SCALE)}× box-filtered`,
  );
  console.log('');

  console.log('## 0. The metric can see a difference that would change a decision');
  resolutionTest();
  console.log('');

  const bytes = await textPage();
  const api = pdfiumApi();
  api.initialise();

  try {
    /** @type {Record<string, { native: Render, reference: Render }>} */
    const renders = {
      mupdf: {
        native: renderWithMupdf(bytes, NATIVE_SCALE),
        reference: downsample(renderWithMupdf(bytes, REFERENCE_SCALE), REFERENCE_SCALE),
      },
      pdfium: {
        native: renderWithPdfium(api, bytes, NATIVE_SCALE),
        reference: downsample(renderWithPdfium(api, bytes, REFERENCE_SCALE), REFERENCE_SCALE),
      },
    };

    console.log('## 1. The fixture carries ink, before any score means anything');
    for (const [name, pair] of Object.entries(renders)) {
      const ink = inkFraction(pair.native);
      console.log(`  ${name}: ${(ink * 100).toFixed(2)}% of pixels are not white`);
      if (ink < 0.01) {
        throw new Error(
          `${name} rendered a page that is ${(ink * 100).toFixed(2)}% inked, so every score ` +
            'below would be a fact about a blank image rather than about anti-aliasing',
        );
      }
    }
    console.log('');

    console.log('## 2. Each engine against its own supersampled reference');
    console.log('   lower is agreement across scale; neither engine appears in the other’s');
    console.log('   reference, and §3 says whether agreement here means quality');
    for (const [name, pair] of Object.entries(renders)) {
      const score = meanDifference(pair.native, pair.reference);
      console.log(`  ${name}: ${score.toFixed(3)} mean absolute difference (levels, 0–255)`);

      // THE CONTROL THIS COMPARISON NEEDS. If a native render equals its own
      // downsampled reference, the two are the same image and the score is zero
      // for a reason that has nothing to do with anti-aliasing.
      if (score === 0) {
        throw new Error(
          `${name}'s native render is identical to its own downsampled 4× render, so this ` +
            'script is comparing something with itself and the score means nothing',
        );
      }
    }
    console.log('');

    console.log('## 3. Whether §2 is measuring quality or deliberate scale-dependence');
    console.log('   an engine that fattens stems at low resolution scores badly in §2 and');
    console.log('   looks better on a screen; that shows as ink at 1× above its own 4×');
    for (const [name, pair] of Object.entries(renders)) {
      const near = inkFraction(pair.native);
      const far = inkFraction(pair.reference);
      console.log(
        `  ${name}: ${(near * 100).toFixed(2)}% at 1× against ${(far * 100).toFixed(2)}% ` +
          `from its own 4× — ${near > far ? 'darker' : 'lighter'} by ` +
          `${(Math.abs(near - far) * 100).toFixed(2)} points`,
      );
    }
    console.log('');

    console.log('## 4. Whether they still differ where an HD toggle operates');
    console.log('   the toggle renders at a HIGHER device pixel ratio, so the reading that');
    console.log('   decides it is this column rather than the 1× row.');
    console.log('   READ THE INKED COLUMN ACROSS ROWS: the whole-page mean divides by an');
    console.log('   area that grows quadratically while glyph edges grow linearly, so it');
    console.log('   falls with scale for two engines that never converge at all.');
    console.log('   scale | whole page | inked only | inked pixels');
    for (const scale of SCALES) {
      const mine = renderWithMupdf(bytes, scale);
      const theirs = renderWithPdfium(api, bytes, scale);
      const inked = inkedDifference(mine, theirs);
      console.log(
        `     ${String(scale)}× | ${meanDifference(mine, theirs).toFixed(3).padStart(10)} | ` +
          `${inked.mean.toFixed(3).padStart(10)} | ${String(inked.pixels).padStart(12)}`,
      );
    }
  } finally {
    api.destroy();
  }
}

await main();
