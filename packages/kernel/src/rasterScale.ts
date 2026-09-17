import type { PageSize } from './pageGeometry.js';

/**
 * The page-image scale for a page of `size` points at `dpi`, or less where that
 * would pass `pixels`. Never below 1, the engine's floor: a page too large even at
 * 1 is refused by the engine by name rather than drawn smaller than it allows.
 *
 * **The one rule** for fitting a raster under a pixel budget, taken by the slide
 * picture, the print and the barcode read alike (B3a).
 *
 * ## The budget is counted in ROUNDED pixels, because that is what the engine counts
 *
 * `rasterisePageImage` rounds each side up before it compares with its bound, so a
 * scale whose unrounded area just meets the budget draws up to one pixel more per
 * side. Measured 2026-09-17: an A0 page (2384 × 3370 points) fitted to the engine's
 * 32,000,000 by area alone came out 4758 × 6726 = 32,002,308 and was refused. So the
 * scale solves `(w·s + 1)(h·s + 1) = pixels` instead, and since a side rounded up is
 * less than one more than itself, the rounded area cannot pass the budget.
 */
export function rasterScale(size: PageSize, dpi: number, pixels: number): number {
  const wanted = dpi / 72;
  const area = Math.max(size.width * size.height, 1);
  const sides = size.width + size.height;
  const fitted = (-sides + Math.sqrt(sides * sides - 4 * area * (1 - pixels))) / (2 * area);
  return Math.max(1, Math.min(wanted, fitted));
}
