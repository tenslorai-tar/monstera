import { ColorSpace, Matrix } from 'mupdf';
import type { PDFPage } from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * How crooked a page is, measured in its own raster.
 *
 * ## The frame is in the field name, and that is the whole defence
 *
 * A skew reading and the rotation that corrects it are two numbers in two
 * frames, and on this page they are **numerically equal** — which is the trap
 * this module is arranged around. PDF user space is y-up and a raster is
 * y-down, so content drawn at +θ in the document reads −θ in the bitmap; the
 * correction is the opposite of the document's tilt, which brings the sign back
 * to the raster's. Measured 2026-09-10 by `scripts/research/deskewAngle.mjs`'s
 * second control: *text drawn at −3.0° in PDF space reads 3.0° in the raster*,
 * and it was the instrument's first run that reported it rather than an
 * expectation quietly adjusted to match.
 *
 * Two consequences, and the second is the one to carry:
 *
 * 1. every field here says which frame it is in, and the conversion is two
 *    named functions rather than one minus sign at a call site;
 * 2. **a fixture whose skew is symmetric proves nothing about the sign.** Both
 *    conventions produce the same number for it, so the case that separates
 *    them is a round trip: draw a page at a known non-zero angle, deskew it,
 *    and measure again. A flipped sign doubles the tilt instead of removing it.
 *
 * ## No threshold anywhere in it
 *
 * The ink split is Otsu's, computed from each page's own histogram. The angle
 * is the **argmax of a sweep**, never a value compared against a cutoff. A page
 * with no line structure — a photograph, a blank sheet, a page of noise — has a
 * flat sweep whose argmax is 0.0°, so it corrects by nothing without anybody
 * choosing a number at which a page counts as crooked. {@link PageSkew.ratio}
 * is reported for a reader and is compared with nothing here.
 *
 * That property is the row's own (`docs/FEATURES.md`, deskew): the 2026-09-05
 * attempt was withdrawn for tuning, and this one is kept free of it.
 */

/** A page rasterised to one grey byte per pixel. */
export interface GreyRaster {
  readonly grey: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * What one page's ink says about how it is turned.
 *
 * `rasterDegrees` and not `degrees`: this is the tilt in the **bitmap**, whose
 * y runs downwards. {@link deskewRotation} is the number a content stream
 * takes.
 */
export interface PageSkew {
  /** The tilt of the page's ink lines in the raster, y-down, in degrees. */
  readonly rasterDegrees: number;
  /**
   * The best score over the score at level.
   *
   * **What says whether the angle means anything**, and it is reported rather
   * than tested: a page whose best score is its score at 0° has no line
   * structure to align, and the argmax of a flat sweep is noise wearing a
   * number. Such a page reads 0.0° at 1.000 and is corrected by nothing, which
   * is why no cutoff is needed to protect it.
   */
  readonly ratio: number;
}

/**
 * Where the sweep looks, and how finely — the resolution of the answer, not a
 * decision about what counts as skewed.
 *
 * ±8° covers what a sheet does on a flatbed or in a feeder. A page turned
 * further than that is a page somebody put in sideways, and straightening it is
 * `rotatePages`' quarter turn rather than this.
 */
export const SKEW_SWEEP_DEGREES = 8;
export const SKEW_SWEEP_STEP = 0.1;

/**
 * Device pixels per inch the measurement rasterises at.
 *
 * **150, because that is the figure the corpus reading was taken at** — one
 * scan at −1.7° scoring 1.428× its own score at level, 2026-09-10. Lowering it
 * would be cheaper and would silently retire that evidence, so it is the same
 * number rather than a new one.
 */
export const SKEW_DPI = 150;

/**
 * Otsu's threshold: the grey level that best separates the histogram in two.
 *
 * Computed from the page rather than chosen, which is what keeps this free of
 * the constant the row's own note warns about.
 *
 * **Exported since 2026-09-11, for `pageEnhance.ts`** (B3a). *Which grey level
 * separates this image's ink from its paper* is one question, and a second
 * implementation of it would agree with this one on an ordinary scan and differ
 * on the pages that matter — a faint one, a dark one, a photograph. The skew
 * detector found the answer first; it does not own the question.
 */
export function otsu(grey: Uint8Array | Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of grey) histogram[value] = (histogram[value] ?? 0) + 1;
  const total = grey.length;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * (histogram[level] ?? 0);

  let weightBelow = 0;
  let sumBelow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let level = 0; level < 256; level += 1) {
    weightBelow += histogram[level] ?? 0;
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += level * (histogram[level] ?? 0);
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
 * The skew of a rasterised page, as the argmax of a horizontal-projection
 * sweep.
 *
 * ## Sheared rather than rotated, which is exact
 *
 * Rotating the image would resample it, and a resampled image is a second thing
 * to be wrong about. Each ink pixel is accumulated into the bin
 * `y - x·tan(θ)`, which is what a rotation does to a horizontal line's row
 * without touching a single pixel value. The score is the sum of squared bin
 * counts: largest when ink lines fall together into few bins, which is what
 * *the text is level* means.
 */
export function skewOfRaster(raster: GreyRaster): PageSkew {
  const { grey, width, height } = raster;
  if (grey.length !== width * height) {
    throw new RangeError(
      `expected ${String(width * height)} grey bytes and got ${String(grey.length)} — the ` +
        'raster is not one byte per pixel, so every reading below would sample the wrong ' +
        'component',
    );
  }
  const threshold = otsu(grey);

  const inkX: number[] = [];
  const inkY: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // DARKER THAN THE THRESHOLD IS INK. A scan's background is the light side
      // of Otsu's split whichever way round the page was written.
      if ((grey[y * width + x] ?? 255) < threshold) {
        inkX.push(x);
        inkY.push(y);
      }
    }
  }

  const scoreAt = (angle: number): number => {
    const slope = Math.tan((angle * Math.PI) / 180);
    const offset = Math.ceil(width * Math.abs(slope));
    const bins = new Float64Array(height + width + 1);
    for (let index = 0; index < inkX.length; index += 1) {
      const bin = Math.round((inkY[index] ?? 0) - (inkX[index] ?? 0) * slope) + offset;
      if (bin >= 0 && bin < bins.length) bins[bin] = (bins[bin] ?? 0) + 1;
    }
    let score = 0;
    for (const count of bins) score += count * count;
    return score;
  };

  const atZero = scoreAt(0);
  let bestAngle = 0;
  let bestScore = -1;
  for (
    let angle = -SKEW_SWEEP_DEGREES;
    angle <= SKEW_SWEEP_DEGREES + 1e-9;
    angle += SKEW_SWEEP_STEP
  ) {
    // ROUNDED TO THE STEP before scoring, so the sweep visits the grid it
    // claims to: accumulating 0.1 in floating point drifts, and an argmax
    // reported as -1.7000000000000002 is a number nobody can compare.
    const rounded = Math.round(angle * 10) / 10;
    const score = scoreAt(rounded);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = rounded;
    }
  }
  return { rasterDegrees: bestAngle, ratio: bestScore / Math.max(1, atZero) };
}

/**
 * One page as grey bytes, through MuPDF — the rasteriser §3's matrix assigns.
 *
 * **`false, true`**: no alpha, and the extras flag MuPDF's own binding takes,
 * so the pixmap is one byte per pixel. {@link skewOfRaster} asserts that rather
 * than this comment being the check.
 *
 * Exported for `scripts/research/deskewAngle.mjs`, which measures the corpus
 * with it: the instrument that produced this row's evidence and the command
 * that acts on it must not hold two opinions about how a page is rasterised
 * (B3a). A page rasterised at a different size is a page with a different
 * argmax.
 */
export function greyRasterOfPage(page: PDFPage): GreyRaster {
  const scale = SKEW_DPI / 72;
  const pixmap = page.toPixmap(
    Matrix.scale(scale, scale),
    ColorSpace.DeviceGray,
    false,
    true,
  );
  try {
    return {
      grey: new Uint8Array(pixmap.getPixels()),
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    };
  } finally {
    pixmap.destroy();
  }
}

/**
 * The tilt of one page in a session this process holds.
 *
 * **The raster never leaves this function.** §9.17's gate is that no bitmap
 * crosses a process boundary, and what this answers is two scalars — which is
 * what lets the measurement live inside the command that uses it rather than
 * needing a channel of its own.
 *
 * @throws `RangeError` for a page index this document does not have.
 */
export function measurePageSkew(session: MupdfSession, page: number): Promise<PageSkew> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    if (!Number.isInteger(page) || page < 0 || page >= total) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
          'Page indices are zero-based.',
      );
    }
    return skewOfRaster(greyRasterOfPage(document.loadPage(page)));
  });
}

/**
 * The page content's own tilt, in PDF user space.
 *
 * y-up against the raster's y-down, so the sign turns over. Named rather than
 * spelt inline because a minus sign at a call site is a claim about a frame
 * that nothing at that call site states.
 */
export function pdfSkewOf(skew: PageSkew): number {
  return -skew.rasterDegrees;
}

/**
 * The rotation that levels the page, in PDF user space.
 *
 * The opposite of its tilt — so this is `-(-rasterDegrees)` and comes out equal
 * to the raster reading. **That coincidence is the reason this is a function
 * with a name**: written as one expression at a call site it is indistinguishable
 * from having applied no conversion at all, and from having applied the wrong
 * one. The round-trip case in `pageDeskew.test.ts` is what separates them.
 */
export function deskewRotation(skew: PageSkew): number {
  return -pdfSkewOf(skew);
}
