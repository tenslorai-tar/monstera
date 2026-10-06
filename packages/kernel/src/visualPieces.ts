import { isNeutralOnly, lineDirection, lineSpans, paragraphLevels } from './bidiOrder.js';
import type { EditPiece } from './editPieces.js';

/**
 * A piece of a line's new text with the direction its span is drawn in
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)).
 */
export interface DrawnPiece extends EditPiece {
  /**
   * Whether the piece's span is right to left, so its glyphs are drawn last letter first; absent for a piece that is the
   * whole line, which is ordered as the line is.
   */
  readonly rtl: boolean | undefined;
}

/**
 * `pieces`, the logical split of `text` by font ({@link EditPiece}s), as the objects of one line in DRAWING order: cut at
 * every change of direction the Unicode Bidirectional Algorithm makes, and ordered as a reader sees the line from the
 * left.
 *
 * ## Why the split is by direction as well as by font
 *
 * An object is one run of glyphs in one order. A piece that held `Hello שלום` in one face would be drawn in one order
 * or the other, and a text page, which takes an object as right to left when it holds a right-to-left letter, would
 * read it back reversed whole. So each object holds one span of one level: its glyphs are drawn as typed or reversed
 * whole.
 *
 * ## A space is never an object of its own
 *
 * A text page reads an object of spaces alone as nothing, so `Hello` and `שלום` drawn as two objects with a space object
 * between them read back as `Helloשלום` and the editor, opening the page again, would show the words run together.
 * A piece of neutrals alone joins the piece beside it in its span, the one before it where there is one, where that
 * piece's own source carries it (`carried`); where nothing does it stays an object, and a line that loses its space in
 * a reader is the lesser cost than a character not drawn.
 *
 * Pieces are laid out left to right in the order returned, so in a right-to-left line the first word typed is the last
 * object. A line with no right-to-left span is returned as it came, in the order it came.
 *
 * @param carried whether a piece's source draws `text`, asked of the piece it would join
 */
export function inDrawingOrder(
  text: string,
  pieces: readonly EditPiece[],
  carried: (piece: EditPiece, text: string) => boolean,
): DrawnPiece[] {
  // ONE PIECE IS THE WHOLE LINE and is ordered as a whole, which a line in one object can be.
  if (pieces.length === 1) return pieces.map((piece) => ({ ...piece, rtl: undefined }));
  const spans = lineSpans(paragraphLevels(text, lineDirection(text)), 0, text.length);
  if (!spans.some((span) => span.rtl)) return pieces.map((piece) => ({ ...piece, rtl: false }));
  const starts: number[] = [];
  let at = 0;
  for (const piece of pieces) {
    starts.push(at);
    at += piece.text.length;
  }
  const drawn: DrawnPiece[] = [];
  for (const span of spans) {
    const within: DrawnPiece[] = [];
    pieces.forEach((piece, index) => {
      const start = starts[index] ?? 0;
      const from = Math.max(span.start, start);
      const to = Math.min(span.end, start + piece.text.length);
      if (from >= to) return;
      const part = piece.text.slice(from - start, to - start);
      within.push({ ...piece, text: part, boxed: piece.boxed.length === 0 ? [] : Array.from(part), rtl: span.rtl });
    });
    const joined = joinNeutrals(within, carried);
    drawn.push(...(span.rtl ? joined.reverse() : joined));
  }
  return drawn;
}

/** The pieces of one span, in logical order, with each piece of neutrals alone joined to its neighbour where that carries it. */
function joinNeutrals(
  within: readonly DrawnPiece[],
  carried: (piece: EditPiece, text: string) => boolean,
): DrawnPiece[] {
  // A BOX IS ONE GLYPH FOR ONE CHARACTER and takes nothing with it, nor joins anything.
  const joinable = (neutral: DrawnPiece, to: DrawnPiece): boolean =>
    neutral.boxed.length === 0 && to.boxed.length === 0 && carried(to, neutral.text);
  const joined: DrawnPiece[] = [];
  for (const piece of within) {
    const before = joined.at(-1);
    if (before !== undefined && isNeutralOnly(piece.text) && joinable(piece, before)) {
      joined[joined.length - 1] = { ...before, text: `${before.text}${piece.text}` };
    } else {
      joined.push(piece);
    }
  }
  // A NEUTRAL PIECE THAT OPENED THE SPAN has nothing before it, so it joins the piece after it.
  const [first, second] = joined;
  if (first !== undefined && second !== undefined && isNeutralOnly(first.text) && joinable(first, second)) {
    joined.splice(0, 2, { ...second, text: `${first.text}${second.text}` });
  }
  // PIECES OF ONE SOURCE THAT NOW TOUCH ARE ONE OBJECT: the words either side of a joined space are the same face, and
  // two objects for them would read back in the order they stand in, which in a right-to-left line is the reverse of
  // the order typed.
  const coalesced: DrawnPiece[] = [];
  for (const piece of joined) {
    const before = coalesced.at(-1);
    if (before !== undefined && sameSource(before, piece)) {
      coalesced[coalesced.length - 1] = { ...before, text: `${before.text}${piece.text}` };
    } else {
      coalesced.push(piece);
    }
  }
  return coalesced;
}

/** Whether two pieces are drawn in one face and can be one object: neither a box, and the same face, sibling and weight. */
function sameSource(a: DrawnPiece, b: DrawnPiece): boolean {
  return a.boxed.length === 0 && b.boxed.length === 0 && a.face === b.face && a.sibling === b.sibling && a.weight === b.weight;
}
