/**
 * How a signature's mark is fitted into the box it is placed in — ONE rule
 * ([ADR-0133](../../../docs/DECISIONS/0133-a-signatures-mark-is-drawn-once-for-both-writers.md)), taken by every writer
 * and by the renderer's held look ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)).
 *
 * `signatureDrawing.ts` turns a fit into a content stream for both writers; the renderer draws the same fit while the
 * page has not yet drawn the signature. Here, in the contract, because the renderer cannot import the kernel, and a
 * copy of the arithmetic beside it would agree with the writers until the day one of them changed (B3a).
 *
 * Every fit is in the box's own units with **y running UP** from its bottom-left corner, as a form's are: a drawn or
 * outlined mark arrives y-down (a pad's, a face's), so a point's height in the box is its distance from the ink's
 * bottom edge.
 */

/** How much of the box the mark may fill, on its tighter axis. */
export const SIGNATURE_FILL = 0.9;

/** The pen's width as a share of the box's shorter side, for a drawn mark. */
const PEN_SHARE = 0.03;

/** A mark's ink fitted into a box: one scale on both axes, centred. */
export interface InkFit {
  /** The ink's own box, in the mark's units, y down. */
  readonly left: number;
  readonly bottom: number;
  readonly scale: number;
  /** Where the ink's left and bottom edges land in the box, y up. */
  readonly originX: number;
  readonly originY: number;
}

/** A point of the mark, in the box's units with y up. */
export function fittedPoint(fit: InkFit, x: number, y: number): readonly [number, number] {
  return [fit.originX + (x - fit.left) * fit.scale, fit.originY + (fit.bottom - y) * fit.scale];
}

/**
 * A typed name's outline in the box.
 *
 * **What is fitted is the face's line box and the ink together** (the outline's `frame` and every point): the line box
 * alone would cut a swash that reaches past the advance, and the ink alone would draw *ace* as tall as *Jgy*.
 */
export function outlineFit(
  outline: { readonly points: readonly number[]; readonly frame: readonly [number, number, number, number] },
  width: number,
  height: number,
): InkFit {
  let [left, top, right, bottom] = outline.frame;
  // A LOOP AND NOT `Math.min(...points)`: an outline may carry 24,576 numbers.
  for (let at = 0; at + 1 < outline.points.length; at += 2) {
    const x = outline.points[at] ?? left;
    const y = outline.points[at + 1] ?? top;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  // THE FRAME HAS AN AREA, which the schema refines, so both spans are positive and the scale is finite.
  const scale = Math.min((width * SIGNATURE_FILL) / (right - left), (height * SIGNATURE_FILL) / (bottom - top));
  return { left, bottom, scale, originX: (width - (right - left) * scale) / 2, originY: (height - (bottom - top) * scale) / 2 };
}

/**
 * Drawn strokes in the box, with the pen they are drawn with.
 *
 * **The ink's own bounding box is what is fitted, not the pad's**, so where on the pad a person started and what shape
 * the pad was decide nothing. The pen's width is taken off the room before fitting, so a stroke at the edge is not cut.
 */
export function strokesFit(strokes: readonly (readonly (readonly [number, number])[])[], width: number, height: number): InkFit & { readonly pen: number } {
  // A LOOP AND NOT `Math.min(...points)`: a drawn signature may carry 65,536 points, and spreading that many arguments
  // is a stack limit waiting for the person with the longest name.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const line of strokes) {
    for (const [x, y] of line) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const pen = Math.max(1, Math.min(width, height) * PEN_SHARE);
  const inkWide = right - left;
  const inkTall = bottom - top;
  // A DOT HAS NO EXTENT ON EITHER AXIS, so neither ratio exists; it is drawn at the centre, where the round cap makes
  // it a mark.
  const fits = [
    inkWide > 0 ? (width * SIGNATURE_FILL - pen) / inkWide : Infinity,
    inkTall > 0 ? (height * SIGNATURE_FILL - pen) / inkTall : Infinity,
  ];
  const tightest = Math.min(...fits);
  const scale = Number.isFinite(tightest) ? Math.max(0, tightest) : 0;
  return { left, bottom, scale, pen, originX: (width - inkWide * scale) / 2, originY: (height - inkTall * scale) / 2 };
}

/** A picture in the box: scaled to fit without distortion and centred, its bottom-left corner and size, y up. */
export function pictureFit(
  picture: { readonly width: number; readonly height: number },
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly wide: number; readonly tall: number } {
  if (!(picture.width > 0 && picture.height > 0)) throw new RangeError('a signature picture needs a width and a height');
  const scale = Math.min((width * SIGNATURE_FILL) / picture.width, (height * SIGNATURE_FILL) / picture.height);
  const wide = picture.width * scale;
  const tall = picture.height * scale;
  return { x: (width - wide) / 2, y: (height - tall) / 2, wide, tall };
}
