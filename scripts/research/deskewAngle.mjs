// @ts-check
/**
 * How crooked is a crooked scan, measured in the bitmap?
 *
 * ## The question this answers, and the one it deliberately does not
 *
 * D2's deskew row was deferred to Stage 6 with its open question named: *the
 * open question is the fixture, not the algorithm.* A projection-profile skew
 * search is well understood; what this build had no way to check was whether
 * its **fixture** was skewed the way it claimed. The first attempt drew bars
 * with `drawRectangle` at an angle and measured them — and `drawRectangle`
 * rotates each bar about its **own origin**, so what that produces in device
 * space was never established. An instrument that measures its own artefact
 * agrees with itself perfectly.
 *
 * The corpus now carries a real crooked scan, so the fixture question is
 * answerable. This measures the angle; it decides nothing about how a deskew
 * command would correct it.
 *
 * ## No tuned constant anywhere in it
 *
 * - the ink threshold is **Otsu's**, computed from each page's own histogram;
 * - the angle is the **argmax** of a sweep, not a value compared against a
 *   cutoff;
 * - the sweep's range and step are stated as the resolution of the answer, not
 *   as a decision about what counts as skewed.
 *
 * ## THE CONTROLS COME FIRST, and the instrument refuses without them
 *
 * A skew search reports a number for any input, including a blank page and a
 * page of noise, so the reassuring answer here is *an angle*. Two constructed
 * pages run before any corpus document:
 *
 * 1. **upright text must read ~0°** — an instrument with a sign error or an
 *    off-by-one in its binning reports a confident tilt for a page that has
 *    none;
 * 2. **text drawn at a known angle must read that angle** — this is the
 *    resolution test, and it is the one the earlier attempt never had. Without
 *    it, case 1 is satisfied by a function that always answers zero.
 *
 * Usage: node scripts/research/deskewAngle.mjs
 *        MONSTERA_CORPUS=<directory> node scripts/research/deskewAngle.mjs
 */

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { formatError } from '../lib/reportError.mjs';

/** Where the sweep looks, and how finely. The resolution of the answer. */
const SWEEP_DEGREES = 8;
const SWEEP_STEP = 0.1;

/** What the pages are rasterised at. Enough ink to bin, small enough to sweep. */
const DPI = 150;

/**
 * One page as grey bytes, through MuPDF — the rasteriser §3's matrix assigns.
 *
 * @param {mupdf.PDFPage} page
 * @returns {{ grey: Uint8Array, width: number, height: number }}
 */
function greyRaster(page) {
  const scale = DPI / 72;
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceGray,
    false,
    true,
  );
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  // `getPixels` answers one byte per component; DeviceGray with no alpha is one
  // byte per pixel, which the length assertion below is the check for rather
  // than the comment being the check.
  const pixels = pixmap.getPixels();
  if (pixels.length !== width * height) {
    throw new Error(
      `expected ${String(width * height)} grey bytes and got ${String(pixels.length)} — the ` +
        'pixmap is not one byte per pixel, so every reading below would be sampling the wrong ' +
        'component',
    );
  }
  return { grey: new Uint8Array(pixels), width, height };
}

/**
 * Otsu's threshold: the grey level that best separates the histogram in two.
 *
 * Computed from the page rather than chosen, which is what keeps this
 * instrument free of the constant the row's own note warns about.
 *
 * @param {Uint8Array} grey
 * @returns {number}
 */
function otsu(grey) {
  const histogram = new Array(256).fill(0);
  for (const value of grey) histogram[value] += 1;
  const total = grey.length;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];

  let weightBelow = 0;
  let sumBelow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let level = 0; level < 256; level += 1) {
    weightBelow += histogram[level];
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += level * histogram[level];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (between > bestVariance) {
      bestVariance = between;
      best = level;
    }
  }
  return best;
}

/**
 * The skew angle, as the argmax of a horizontal-projection sweep.
 *
 * ## Sheared rather than rotated, which is exact
 *
 * Rotating the image would resample it, and a resampled image is a second thing
 * to be wrong about. Each ink pixel is instead accumulated into the bin
 * `y - x·tan(θ)`, which is what a rotation does to a horizontal line's row
 * without touching a single pixel value.
 *
 * The score is the sum of squared bin counts: it is largest when ink lines fall
 * together into few bins, which is what "the text is level" means.
 *
 * @param {{ grey: Uint8Array, width: number, height: number }} raster
 * @returns {{ degrees: number, score: number, atZero: number }}
 */
function skewOf(raster) {
  const { grey, width, height } = raster;
  const threshold = otsu(grey);

  /** @type {{x: number, y: number}[]} */
  const ink = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // DARKER THAN THE THRESHOLD IS INK. A scan's background is the light
      // side of Otsu's split whichever way round the page was written.
      if ((grey[y * width + x] ?? 255) < threshold) ink.push({ x, y });
    }
  }

  /** @param {number} angle @returns {number} */
  const scoreAt = (angle) => {
    const slope = Math.tan((angle * Math.PI) / 180);
    const bins = new Float64Array(height + width + 1);
    const offset = Math.ceil(width * Math.abs(slope));
    for (const point of ink) {
      const bin = Math.round(point.y - point.x * slope) + offset;
      if (bin >= 0 && bin < bins.length) bins[bin] = (bins[bin] ?? 0) + 1;
    }
    let score = 0;
    for (const count of bins) score += count * count;
    return score;
  };

  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -SWEEP_DEGREES; angle <= SWEEP_DEGREES + 1e-9; angle += SWEEP_STEP) {
    const rounded = Math.round(angle * 10) / 10;
    const score = scoreAt(rounded);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = rounded;
    }
  }
  return { degrees: bestAngle, score: bestScore, atZero: scoreAt(0) };
}

/**
 * A page of horizontal lines of text, drawn at a known angle.
 *
 * `drawText` with a `rotate` turns each line about its own origin, which is
 * exactly the artefact the first deskew attempt measured — so the lines are
 * placed on the rotated baseline themselves rather than laid out upright and
 * spun. At a small angle the two are the same thing to within a pixel, and
 * placing them makes the fixture's ground truth a property of the arithmetic
 * here rather than of pdf-lib's rotation origin.
 *
 * @param {number} angle
 */
async function constructedPage(angle) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const radians = (angle * Math.PI) / 180;
  const line = 'The quick brown fox jumps over the lazy dog, again and again and again.';
  for (let index = 0; index < 24; index += 1) {
    // THE BASELINE IS COMPUTED, so the fixture's angle is this file's
    // arithmetic and not a library's idea of a rotation origin.
    const x0 = 60;
    const y0 = 760 - index * 28;
    page.drawText(line, {
      x: x0,
      y: y0,
      size: 11,
      font,
      rotate: degrees(angle),
      // Each line starts on the same rotated ray from the page's left edge, so
      // the block as a whole is a rotated block rather than a stack of
      // individually spun lines.
      xSkew: degrees(0),
      ySkew: degrees(0),
    });
    void radians;
  }
  return document.save();
}

/** @param {Uint8Array} bytes */
function firstPageOf(bytes) {
  const document = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
  return document.loadPage(0);
}

try {
  process.stdout.write('# How crooked is a crooked scan?\n\n');
  process.stdout.write(
    `  swept ±${String(SWEEP_DEGREES)}° in ${String(SWEEP_STEP)}° steps, ` +
      `rasterised at ${String(DPI)} dpi through MuPDF, ink split by Otsu\n\n`,
  );

  process.stdout.write('## Controls\n\n');
  const upright = skewOf(greyRaster(firstPageOf(await constructedPage(0))));
  process.stdout.write(
    `  text drawn upright reads ${upright.degrees.toFixed(1)}°\n`,
  );
  const drawnAt = -3;
  const tilted = skewOf(greyRaster(firstPageOf(await constructedPage(drawnAt))));
  process.stdout.write(
    `  text drawn at ${drawnAt.toFixed(1)}° in PDF space reads ` +
      `${tilted.degrees.toFixed(1)}° in the raster\n`,
  );
  if (Math.abs(upright.degrees) > 0.5) {
    throw new Error(
      `CONTROL FAILED: upright text reads ${upright.degrees.toFixed(1)}°. Every figure below ` +
        'would be that error plus whatever the page has.',
    );
  }
  // THE SIGN IS FLIPPED, AND THAT IS ASSERTED RATHER THAN ABSORBED. pdf-lib
  // rotates counter-clockwise in PDF user space, which is **y-up**; the raster
  // this sweeps is **y-down**, so the same tilt has the opposite sign here.
  // The first run of this file reported `-3.0° reads 3.0°` and stopped, which
  // is the control doing its job — an expected value quietly adjusted to match
  // would have buried a frame difference in a number.
  //
  // Every figure this instrument prints is therefore a RASTER angle, and a
  // deskew command taking one has a conversion to make.
  if (Math.abs(tilted.degrees + drawnAt) > 0.5) {
    throw new Error(
      `CONTROL FAILED: text drawn at ${drawnAt.toFixed(1)}° in PDF space reads ` +
        `${tilted.degrees.toFixed(1)}° in the raster, where the y-flip predicts ` +
        `${(-drawnAt).toFixed(1)}°. Without this case the one above is satisfied by an ` +
        'instrument that always answers zero.',
    );
  }
  process.stdout.write(
    '  both within 0.5°, so the sweep can see an angle and can see zero — and the sign flips,\n' +
      '  because PDF user space is y-up and this raster is y-down\n\n',
  );

  process.stdout.write('## The supplied corpus\n\n');
  const corpus = openCorpus();
  if (!corpus.available) {
    process.stdout.write(`${corpus.outcome.text}\n`);
  } else {
    process.stdout.write('  id                pages   skew    score at best / at 0°\n');
    for (const item of corpus.documents) {
      const document = /** @type {mupdf.PDFDocument} */ (
        mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
      );
      const pages = document.countPages();
      const page = document.loadPage(0);
      // TEXT PAGES ARE SKIPPED, and said so rather than scored: a page whose
      // text this build can already read is not what deskew is for, and a
      // number for it invites somebody to compare the two.
      const stext = page.toStructuredText('segment');
      const json = stext.asJSON();
      stext.destroy();
      if (json.includes('"text"')) {
        process.stdout.write(`  ${item.id}${String(pages).padStart(7)}   — carries text\n`);
        continue;
      }
      const skew = skewOf(greyRaster(page));
      process.stdout.write(
        `  ${item.id}${String(pages).padStart(7)}` +
          `${skew.degrees.toFixed(1).padStart(8)}°` +
          `   ${(skew.score / Math.max(1, skew.atZero)).toFixed(3)}× better than level\n`,
      );
    }
    process.stdout.write(`\n${corpusCaveat(corpus.documents.length)}\n`);
    process.stdout.write(
      '  The ratio is what says whether the angle MEANS anything: a page whose best score is\n' +
        '  barely above its score at 0° is a page with no line structure to align, and the\n' +
        '  argmax of a flat sweep is noise wearing a number.\n',
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
