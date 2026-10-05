import type { CatalogueFace } from './fontCatalogue.js';
import { type FontRequest, resolveRuns } from './fontResolver.js';

/**
 * How a run's new text is split when its own font cannot carry all of it
 * ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decisions 1, 2 and 7). Pure: the run's own font is asked through `ownCarries`, which the PDFium host answers with a
 * probe, so the rule is the same in a proof that has no PDFium.
 *
 * ## The rule, in order
 *
 * 1. Each `Intl.Segmenter` word segment the run's own font carries stays in it: the rest of the line keeps the
 *    document's font (the owner's Q6).
 * 2. A segment it cannot carry goes to the resolver over the catalogue (ADR-0172 Decision 1), whole where a face
 *    carries it whole, by grapheme where none does, and a grapheme no face carries is the box (Decision 8).
 * 3. Neighbouring stretches in one face are one piece.
 * 4. The spaces that end an own-font piece before a piece in another face move into that piece, where its face
 *    carries them: measured 2026-10-05, pdf.js drops a standard font's trailing space when the next object starts flush
 *    against it, and reads a leading space in the next piece.
 */

/** One piece of a run's new text: the run's own font (`face: null`), a catalogue face, or the box. */
export interface EditPiece {
  readonly text: string;
  /** `null` for the run's own font. */
  readonly face: CatalogueFace | null;
  /** The weight to pin a variable face at; the face's own for a static one, and unused for the run's own font. */
  readonly weight: number;
  /** Non-empty for a piece of characters no source carries: the characters, each drawn as the box. */
  readonly boxed: readonly string[];
}

const WORDS = new Intl.Segmenter('und', { granularity: 'word' });

/**
 * The pieces `text` is written in, for a run whose own font carries what `ownCarries` says it does.
 *
 * @param ownCarries whether the run's own font draws a segment as written
 * @param request the run's family and style, which the resolver matches; its `own` is ignored, the run's own font
 *   having been asked already
 */
export function editPieces(
  text: string,
  ownCarries: (segment: string) => boolean,
  request: FontRequest,
  faces: readonly CatalogueFace[],
): EditPiece[] {
  const pieces: { text: string; face: CatalogueFace | null; weight: number; boxed: string[] }[] = [];
  const add = (piece: string, face: CatalogueFace | null, weight: number, boxed: readonly string[]): void => {
    const previous = pieces.at(-1);
    if (previous?.face === face && previous.boxed.length === 0 && boxed.length === 0) {
      previous.text += piece;
      return;
    }
    pieces.push({ text: piece, face, weight, boxed: [...boxed] });
  };
  for (const { segment } of WORDS.segment(text)) {
    if (ownCarries(segment)) {
      add(segment, null, 0, []);
      continue;
    }
    for (const run of resolveRuns(segment, { ...request, own: [] }, faces)) {
      // THE CATALOGUE'S FACE, found back by id: the resolver answers the candidate it was handed, which is one of these.
      const face = run.face === null ? null : (faces.find((each) => each.id === run.face?.id) ?? null);
      if (run.missing.length > 0 || face === null) add(run.text, face, run.weight, Array.from(run.text));
      else add(run.text, face, run.weight, []);
    }
  }
  // THE SPACE BEFORE A WORD IN ANOTHER FACE IS THAT WORD'S (point 4).
  for (let at = 1; at < pieces.length; at += 1) {
    const before = pieces[at - 1];
    const piece = pieces[at];
    // NOT INTO A BOX, which is one glyph standing for one character (Decision 7): a space there would be drawn as a box.
    if (before === undefined || piece === undefined || before.face !== null || piece.face === null || piece.boxed.length > 0) {
      continue;
    }
    const trailing = /\s+$/u.exec(before.text)?.[0] ?? '';
    if (trailing === '' || trailing === before.text) continue;
    const face = piece.face;
    if (!Array.from(trailing).every((character) => face.unicodes.has(character.codePointAt(0) ?? 0))) continue;
    before.text = before.text.slice(0, before.text.length - trailing.length);
    piece.text = `${trailing}${piece.text}`;
  }
  return pieces;
}
