import type { ScreenBox } from '../annotations/annotationSpace.js';

/**
 * The parts of a field a press fills while a tool that picks comments is on (the owner, 2026-10-10: *a click on a form
 * field fills it even while the comment Select tool is on, unless the click lands on a comment*).
 *
 * ## Pieces, never a polygon with holes
 *
 * A clip with a hole per comment is the obvious shape and it is wrong where two comments overlap: under `evenodd` the
 * overlap of two holes is filled again, and under `nonzero` with holes wound against the field the overlap winds to a
 * non-zero count and is filled too. Either way a press on the place two comments share would fill the field under them.
 * So the comments are SUBTRACTED from the field as rectangles, which leaves disjoint pieces, and disjoint pieces drawn
 * as one `evenodd` polygon are exactly their union: the segments joining them are travelled twice and enclose nothing.
 */

/** A box with its far corner, so a subtraction reads as four comparisons. */
interface Span {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const spanOf = (box: ScreenBox): Span => ({ left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height });

/** What is left of `piece` once `hole` is taken out: up to four disjoint spans, the piece itself when they miss. */
function subtract(piece: Span, hole: Span): Span[] {
  const top = Math.max(piece.top, hole.top);
  const bottom = Math.min(piece.bottom, hole.bottom);
  const left = Math.max(piece.left, hole.left);
  const right = Math.min(piece.right, hole.right);
  // TOUCHING IS NOT OVERLAPPING: a comment whose edge is the field's edge takes no press from it.
  if (top >= bottom || left >= right) return [piece];
  const leftOver: Span[] = [];
  if (piece.top < top) leftOver.push({ ...piece, bottom: top });
  if (bottom < piece.bottom) leftOver.push({ ...piece, top: bottom });
  if (piece.left < left) leftOver.push({ left: piece.left, right: left, top, bottom });
  if (right < piece.right) leftOver.push({ left: right, right: piece.right, top, bottom });
  return leftOver;
}

/**
 * Where a field takes the press, given the comments over its page: `'whole'` when none overlaps it, `'none'` when they
 * cover all of it, and otherwise the CSS `clip-path` that leaves the comments to the tool, in the field's own pixels.
 */
export function fieldPressArea(field: ScreenBox, comments: readonly ScreenBox[]): 'whole' | 'none' | { readonly clipPath: string } {
  const whole = spanOf(field);
  let pieces: Span[] = [whole];
  for (const comment of comments) pieces = pieces.flatMap((piece) => subtract(piece, spanOf(comment)));
  if (pieces.length === 0) return 'none';
  if (pieces.length === 1 && pieces[0] === whole) return 'whole';
  const at = (x: number, y: number): string => `${String(x - whole.left)}px ${String(y - whole.top)}px`;
  const points = pieces.flatMap((piece) => [
    at(piece.left, piece.top),
    at(piece.right, piece.top),
    at(piece.right, piece.bottom),
    at(piece.left, piece.bottom),
    at(piece.left, piece.top),
    // BACK TO THE FIELD'S CORNER between pieces, so each join is travelled out and back and encloses nothing.
    at(whole.left, whole.top),
  ]);
  return { clipPath: `polygon(evenodd, ${points.join(', ')})` };
}
