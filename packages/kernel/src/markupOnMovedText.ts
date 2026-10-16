import type { AnnotationKindName, AnnotationRect } from '@monstera/contract';

import type { MovedBlock } from './engineSeam.js';

/**
 * The markup that moves with text a growing paragraph pushed down
 * ([ADR-0249](../../../docs/DECISIONS/0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md) Decision 4): the ONE
 * answer to *which marks sit on this moved text*, for the marks `main` moves by `placeAnnotation` and the links it moves
 * by `editLink`, each in the edit's undo step.
 *
 * ## The kinds that mark WORDS ride; everything else stays, as a picture does
 *
 * A highlight, an underline, a strikeout, a caret and a sticky note say something about the words they sit on, so they
 * go where the words go (the owner's locked decision 4). A shape, a stamp, a text box, a measurement and a redaction are
 * things on the page in their own right, and `other` is a kind this build cannot name, so none of them is moved on a
 * guess. Links are listed apart and always ride: a link is a region of words.
 *
 * ## ON the text is its centre inside the moved block's box
 *
 * The box is the block's objects' own, ascent to descent, which is where a highlight's quads lie. A mark beside the text
 * — a sticky note in the margin — has its centre outside it and stays.
 */
export const KINDS_ON_WORDS: ReadonlySet<AnnotationKindName> = new Set([
  'highlight',
  'underline',
  'strikeout',
  'caret',
  'sticky-note',
]);

/** The moved block `rect` sits on, by its centre, or `undefined` for a rectangle on none. */
export function movedUnder(rect: AnnotationRect, moved: readonly MovedBlock[]): MovedBlock | undefined {
  const x = (rect.x0 + rect.x1) / 2;
  const y = (rect.y0 + rect.y1) / 2;
  return moved.find(({ box }) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
}

/** `rect` moved down with the block it sits on, in PDF user space, where up is positive. */
export function movedDown(rect: AnnotationRect, block: MovedBlock): AnnotationRect {
  return { x0: rect.x0, y0: rect.y0 - block.down, x1: rect.x1, y1: rect.y1 - block.down };
}
