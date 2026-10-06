/**
 * The colour of the paper round a box on a rendered page
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)
 * Decision 9): what a word on a scan is covered with, so that the words typed over it stand on the paper and not on a
 * patch.
 *
 * ## A ring, not the box
 *
 * The box holds the ink of the words being replaced, so its own pixels are the one place the paper is not. A ring of
 * pixels just outside it is paper wherever the word is not touching its neighbour, and the MEDIAN of each channel
 * separately is the colour most of the ring is, so a stain, a fold or the ink of the next line crossing the ring moves it
 * by nothing. A scan's paper is rarely white: measured on the committed corpus pages, a cream or grey that a white patch
 * would show as a box.
 *
 * Pure: pixels in, a colour out, so the rule is tested without an engine.
 */

/** A pixel box in device space, `x1` and `y1` exclusive. */
export interface PixelBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The ring's thickness in pixels: past the soft edge of a scanned word and short of the next line's ink. */
export const PAPER_RING = 3;

/**
 * The median colour of the pixels of `bgra` (four bytes a pixel, blue first, as PDFium renders) in the ring of
 * {@link PAPER_RING} pixels outside `box`, and white where the ring is wholly off the raster.
 */
export function paperColourAround(
  bgra: Uint8Array,
  width: number,
  height: number,
  box: PixelBox,
): { readonly r: number; readonly g: number; readonly b: number } {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const x0 = Math.floor(box.x0) - PAPER_RING;
  const y0 = Math.floor(box.y0) - PAPER_RING;
  const x1 = Math.ceil(box.x1) + PAPER_RING;
  const y1 = Math.ceil(box.y1) + PAPER_RING;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      const inside = x >= Math.floor(box.x0) && x < Math.ceil(box.x1) && y >= Math.floor(box.y0) && y < Math.ceil(box.y1);
      if (inside) continue;
      const at = (y * width + x) * 4;
      blues.push(bgra[at] ?? 255);
      greens.push(bgra[at + 1] ?? 255);
      reds.push(bgra[at + 2] ?? 255);
    }
  }
  if (reds.length === 0) return { r: 255, g: 255, b: 255 };
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };
  return { r: median(reds), g: median(greens), b: median(blues) };
}
