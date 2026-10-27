/**
 * How far right a block of ONE line may grow as words are added to it before it wraps (the owner's test of milestone 1: a
 * tight box wrapped on its first added letter): to the edge of its column, else to the page's text margin. A block of
 * several lines keeps its width. The one rule the editor lays a one-line block out by and the writer wraps it at, so the
 * line breaks the person sees are the ones written (the local agent's walk: *the editor and the writer break lines by one
 * rule*).
 *
 * - THE NEXT BLOCK ON ITS LINE stops it: a block whose band meets this one's and which starts at or past its right edge,
 *   less {@link LINE_GAP}.
 * - ELSE ITS COLUMN'S RIGHT: the furthest right edge of the blocks that share its left-to-right span, it included;
 * - and where none reaches past it, the page's text margin, the furthest right edge of any block on the page;
 * - and where nothing on the page reaches past it, the margin mirrored: as far from the page's right as it is from its
 *   left.
 *
 * Never less than the block's own right edge. Boxes are the page's own, `x0 <= x1` and `y0 <= y1`.
 */

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Points kept clear before the next block on the line. */
export const LINE_GAP = 6;

/** How far a box's edge may stand past another's and still be the same edge: a rounding. */
const SAME_EDGE = 0.5;

export function oneLineReach(box: Box, others: readonly Box[], page: Box): number {
  const band = (other: Box): boolean => Math.min(other.y1, box.y1) - Math.max(other.y0, box.y0) > 0;
  const next = others.filter((other) => band(other) && other.x0 >= box.x1 - SAME_EDGE).reduce((nearest, other) => Math.min(nearest, other.x0), Number.POSITIVE_INFINITY);
  const across = (other: Box): boolean => Math.min(other.x1, box.x1) - Math.max(other.x0, box.x0) > 0;
  let edge = Math.max(box.x1, ...others.filter(across).map((other) => other.x1));
  if (edge <= box.x1 + SAME_EDGE) edge = Math.max(box.x1, ...others.map((other) => other.x1));
  if (edge <= box.x1 + SAME_EDGE) edge = page.x1 - (box.x0 - page.x0);
  return Math.max(box.x1, Math.min(edge, next - LINE_GAP));
}
