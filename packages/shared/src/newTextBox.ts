/**
 * Where a box of new text goes when a person presses on a page with Add text: the one rule, taken by the editor that opens
 * the box and by the proof that the words land on the page (`textInsertPlacement.test.ts`).
 *
 * ## The whole box is ON THE PAGE
 *
 * The box's top left is the press, moved only as far as keeps the box inside the page's box: a margin from the right edge
 * the line runs towards, at least {@link NEW_TEXT_MIN_MEASURE} points of measure, and room for the first line below the
 * top. Measured 2026-10-12 before this rule: the left was kept a margin inside the right edge but the minimum measure was
 * not, so a press near that edge wrote a line running up to 80 points past it, and on a page turned a quarter that edge
 * is the foot of the page as shown — words typed 89% or more down were written off the page, which the write's own
 * read-back (it reads past the page's edge, for the owner's Q7) counted as written. Nothing then showed them.
 *
 * All in PDF user space, where the page's box is: a turned page turns the box on screen and not here, so one rule holds
 * at every turn and wherever the box starts.
 */

/** The margin a new box keeps from the page's right edge, in points. */
export const NEW_TEXT_MARGIN = 36;
/** The narrowest a new box's measure is, in points, page width allowing. */
export const NEW_TEXT_MIN_MEASURE = 80;
/** The widest a new box's measure is, in points. */
export const NEW_TEXT_MAX_MEASURE = 360;
/** How far below its top a new box's first baseline is, as a share of the size. */
const FIRST_BASELINE = 0.8;
/** How tall a new box's first line is, as a share of the size. */
const FIRST_LINE = 1.2;

export interface NewTextBox {
  readonly left: number;
  readonly measure: number;
  readonly top: number;
  readonly baseline: number;
  readonly bottom: number;
}

/**
 * The box a press at `at` begins, on a page whose box is `crop`, for words of `size` points.
 *
 * @param crop the page's box in PDF user space, corners either way round
 */
export function newTextBox(
  at: { readonly x: number; readonly y: number },
  crop: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  size: number,
): NewTextBox {
  const x0 = Math.min(crop.x0, crop.x1);
  const x1 = Math.max(crop.x0, crop.x1);
  const y0 = Math.min(crop.y0, crop.y1);
  const y1 = Math.max(crop.y0, crop.y1);
  const width = x1 - x0;
  const pressed = Math.min(Math.max(at.x, x0), Math.max(x0, x1 - NEW_TEXT_MARGIN));
  const measure = Math.min(Math.max(x1 - NEW_TEXT_MARGIN - pressed, NEW_TEXT_MIN_MEASURE), NEW_TEXT_MAX_MEASURE, width);
  // MOVED BACK FROM THE EDGE by as much as the measure needs, never past the page's other edge.
  const left = Math.max(x0, Math.min(pressed, x1 - measure));
  const line = size * FIRST_LINE;
  const top = Math.max(Math.min(at.y, y1), Math.min(y1, y0 + line));
  return { left, measure, top, baseline: top - size * FIRST_BASELINE, bottom: top - line };
}
