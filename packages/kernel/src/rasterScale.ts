import type { PageSize } from './pageGeometry.js';

/**
 * The page-image scale for a page of `size` points at `dpi`, or less where that
 * would pass `pixels`. Never below 1, the engine's floor: a page too large even at
 * 1 is refused by the engine by name rather than drawn smaller than it allows.
 *
 * **The one rule** for fitting a raster under a pixel budget, taken by the slide
 * picture and the print alike (B3a).
 */
export function rasterScale(size: PageSize, dpi: number, pixels: number): number {
  const wanted = dpi / 72;
  const area = Math.max(size.width * size.height, 1);
  return Math.max(1, Math.min(wanted, Math.sqrt(pixels / area)));
}
