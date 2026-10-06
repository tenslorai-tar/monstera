import { isBidirectional, isNeutralOnly, lineDirection, lineSpans, paragraphLevels } from './bidiOrder.js';
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
  forced?: boolean,
): DrawnPiece[] {
  // A SPAN OF ONE DIRECTION, cut out of a longer line by the caller (`visualUnits`): its direction is the line's, not
  // what its own letters say, so a span of digits or of marks and neutrals alone is drawn the way the line runs there.
  // Its pieces are in the order typed and are drawn the other way round where the span runs right to left.
  if (forced !== undefined) {
    const joined = joinNeutrals(pieces.map((piece) => ({ ...piece, rtl: forced })), carried);
    return forced ? joined.reverse() : joined;
  }
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

/** One stretch of a row set in one direction: the piece it is cut from, its words, and the way they run. */
export interface RowUnit {
  /** The place of the piece it is cut from, among the row's pieces. */
  readonly piece: number;
  readonly text: string;
  readonly rtl: boolean;
}

/**
 * A row's pieces as the stretches it is DRAWN in, left to right, when it runs both ways
 * ([ADR-0185](../../../docs/DECISIONS/0185-a-line-of-several-objects-is-read-and-written-as-one-line.md)): the row's words
 * (the pieces' texts, one after another, in the order typed) cut at every change of level the algorithm makes and at every
 * piece boundary, the stretches of a level in the order a reader sees them, and the stretches of a right-to-left level
 * last typed first. `undefined` where the row has one piece (which is ordered inside the one that writes it) or does not
 * run both ways, and is written as it stands.
 *
 * Pieces are cut by the style a person set, and a piece written alone is ordered by its own letters. For a line whose
 * pieces are the words of two runs, that is the line written the wrong way round: an Arabic sentence with a coloured Latin
 * word in it was drawn as Arabic, then Latin, left to right, which is the order typed and not the order seen.
 */
export function visualUnits(texts: readonly string[]): RowUnit[] | undefined {
  if (texts.length < 2) return undefined;
  const line = texts.join('');
  if (!isBidirectional(line)) return undefined;
  const starts: number[] = [];
  let at = 0;
  for (const text of texts) {
    starts.push(at);
    at += text.length;
  }
  const units: RowUnit[] = [];
  for (const span of lineSpans(paragraphLevels(line, lineDirection(line)), 0, line.length)) {
    const within: RowUnit[] = [];
    texts.forEach((text, piece) => {
      const start = starts[piece] ?? 0;
      const from = Math.max(span.start, start);
      const to = Math.min(span.end, start + text.length);
      if (from < to) within.push({ piece, text: line.slice(from, to), rtl: span.rtl });
    });
    units.push(...(span.rtl ? within.reverse() : within));
  }
  return withoutLoneSpaces(units);
}

/**
 * The stretches with each one of white space alone taken into the stretch beside it that is cut from the same piece (the
 * next in the order drawn, else the one before): a text page reads an object of spaces alone as nothing, so the space
 * would be gone when the line is read. A stretch that runs right to left holds its words in the order typed and is drawn
 * reversed, so a space drawn before it is typed after it. A space whose neighbours are other pieces' stays an object.
 */
function withoutLoneSpaces(units: readonly RowUnit[]): RowUnit[] {
  const out: RowUnit[] = [];
  let before: RowUnit | undefined;
  units.forEach((unit, at) => {
    if (!/^\s+$/u.test(unit.text)) {
      // A SPACE BEFORE IT IN THE ORDER DRAWN: first typed where it runs left to right, last where it runs right to left.
      const joined = before === undefined ? unit : { ...unit, text: unit.rtl ? unit.text + before.text : before.text + unit.text };
      before = undefined;
      out.push(joined);
      return;
    }
    const next = units[at + 1];
    if (next?.piece === unit.piece && !/^\s+$/u.test(next.text)) {
      before = unit;
      return;
    }
    const last = out.at(-1);
    if (last?.piece === unit.piece) {
      // A SPACE AFTER IT IN THE ORDER DRAWN: last typed where it runs left to right, first where it runs right to left.
      out[out.length - 1] = { ...last, text: last.rtl ? unit.text + last.text : last.text + unit.text };
      return;
    }
    out.push(unit);
  });
  return out;
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
