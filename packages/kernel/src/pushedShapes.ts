import { type PageBox, written } from './contentCarry.js';
import { foundBox, placedSpan, placementIn } from './drawnObjectEdit.js';
import { decorationBand } from './markDecorations.js';
import { type XObjectKind, drawnObjects } from './textOperators.js';

/**
 * What sits with a line a push moves, and the move that carries it ([ADR-0249](../../../docs/DECISIONS/0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md)'s
 * correction of 2026-10-26).
 *
 * A pushed block is text, and a page draws what belongs to its lines beside the text: a list's bullet as a filled square,
 * a link's rule under its words as a path a point tall (the owner's document 2, page 2, read by PDFium 2026-10-26). The
 * writer sets a pushed block's words again lower down; this moves every drawing that sat with one of its lines by the
 * same amount, so nothing that belonged to a moved line stays behind. The corpus proof asks {@link sitsWithLine} too, so
 * the writer and the instrument that judges it hold one opinion of which drawing is a line's.
 */

/** A line of a pushed block, in user space: its baseline and size, the push's column, and how far down it moved. */
export interface PushedLine {
  readonly baseline: number;
  readonly size: number;
  /** The column of the push: the growing block's and the pushed block's horizontal extent together. */
  readonly left: number;
  readonly right: number;
  readonly down: number;
}

/** How far a drawing may stand past a line's band and still be on it: half a point, a stroke's own width. */
const SLACK = 0.5;

/**
 * Whether a drawing with `box` sits with `line`: WHOLLY inside the band the line's words fill — where a highlight behind
 * them is drawn (`decorationBand('behind', …)`, the one spelling of that band) — and across the push's column. A drawing
 * taller than the band is not one line's: a picture beside a list, or a table's ruling, stays where it is.
 */
export function sitsWithLine(box: PageBox, line: Omit<PushedLine, 'down'>): boolean {
  const band = decorationBand('behind', line.baseline, line.size);
  return box.bottom >= band.bottom - SLACK && box.top <= band.top + SLACK && box.right > line.left && box.left < line.right;
}

/** One insertion of a move: text put in at a byte offset of the content. */
export interface ShapeMove {
  readonly at: number;
  readonly text: string;
}

/**
 * The insertions that move every drawing sitting with one of `lines` down by that line's move, by Edit object's own
 * placement (`placedSpan`, ADR-0240's E3 addendum): its instructions, or the clip window it is drawn through where that
 * window holds nothing else, wrapped in `q … cm … Q`. `marked(start)` names a drawing the writer moves itself — its own
 * marked decorations — which this leaves alone.
 *
 * Not moved, as the ADR states: a drawing that also sets the clip for what follows (moving it would re-cut what comes
 * after), and a form or a shading, which have no box this read can state.
 */
export function shapesMovedWith(
  content: Uint8Array,
  kinds: (name: string) => XObjectKind,
  lines: readonly PushedLine[],
  marked: (start: number) => boolean,
): readonly ShapeMove[] {
  if (lines.length === 0) return [];
  const drawn = drawnObjects(content, kinds);
  const moves: ShapeMove[] = [];
  /** A window is wrapped once, though it is found through the drawing it holds. */
  const wrapped = new Set<number>();
  for (const object of drawn) {
    if (object.clips || marked(object.start)) continue;
    const box = foundBox(object);
    if (box === undefined) continue;
    const line = lines.find((each) => sitsWithLine(box, each));
    if (line === undefined) continue;
    const span = placedSpan(content, drawn, object);
    if (wrapped.has(span.start)) continue;
    const matrix = placementIn(span.ctm, [1, 0, 0, 1, 0, -line.down]);
    if (matrix === null) continue;
    wrapped.add(span.start);
    // A LINE BREAK AFTER THE `Q`, the placement's own reason: a window's span ends where its `Q` begins.
    moves.push({ at: span.start, text: `q ${matrix.map(written).join(' ')} cm\n` }, { at: span.end, text: '\nQ\n' });
  }
  return moves;
}
