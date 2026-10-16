import { describe, expect, it } from 'vitest';

import { editPieces } from './editPieces.js';
import type { CatalogueFace } from './fontCatalogue.js';
import type { FontRequest } from './fontResolver.js';

/**
 * The pieces an edit's run is written in (ADR-0173 Decisions 1, 2 and 7), against a synthetic catalogue and a run's
 * own font that carries Latin alone, so each case says which piece every character must land in.
 */
function face(id: string, family: string, characters: string): CatalogueFace {
  return {
    id,
    origin: 'bundled',
    family,
    weight: 400,
    italic: false,
    embedding: 'subset',
    unicodes: new Set(Array.from(characters, (character) => character.codePointAt(0) ?? 0)),
    weights: null,
    path: `${id}.ttf`,
    faceIndex: 0,
    localNames: [`${family.replaceAll(' ', '')}-Regular`],
  };
}

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,!';
const ARIMO = face('arimo', 'Arimo', `${LATIN}ПриветΩ`);
const CATALOGUE = [ARIMO];
const OWN_LATIN = (segment: string): boolean => Array.from(segment).every((character) => LATIN.includes(character));
const REQUEST: FontRequest = { family: 'Helvetica', bold: false, italic: false, own: [] };

function summary(text: string, faces: readonly CatalogueFace[] = CATALOGUE): [string, string | null, string][] {
  return editPieces(text, OWN_LATIN, REQUEST, faces, []).map((piece) => [piece.text, piece.face?.id ?? null, piece.boxed.join('')]);
}

/** A sibling in the document that draws `characters` and nothing else, asked as the host's probe asks. */
function sibling(characters: string): { carries: (segment: string) => boolean } {
  return { carries: (segment) => Array.from(segment).every((character) => characters.includes(character)) };
}

/** Each piece as text, catalogue face and sibling, for the sibling cases. */
function bySource(text: string, siblings: readonly { carries: (segment: string) => boolean }[]): [string, string | null, number | null][] {
  return editPieces(text, OWN_LATIN, REQUEST, CATALOGUE, siblings).map((piece) => [piece.text, piece.face?.id ?? null, piece.sibling]);
}

describe('editPieces', () => {
  it('keeps a run its own font carries as one piece in that font', () => {
    expect(summary('Hello world.')).toStrictEqual([['Hello world.', null, '']]);
  });

  it('sets only the word the run’s font lacks in another face, the rest of the line in its own font (Q6)', () => {
    expect(summary('Hello Привет world')).toStrictEqual([
      ['Hello', null, ''],
      [' Привет', 'arimo', ''],
      [' world', null, ''],
    ]);
  });

  /**
   * THE SPACE BEFORE THE WORD IS THE WORD'S (Decision 2), where its face carries the space. CONTROL: a face that does
   * not carry a space leaves the space in the run's own font, so the move is the face's answer and not a rule that
   * moves every space.
   */
  it('moves the space before such a word into its piece, only where the face carries a space', () => {
    expect(summary('Hello Привет')[1]?.[0]).toBe(' Привет');
    const noSpace = face('cyr', 'Cyr', 'Привет');
    expect(editPieces('Hello Привет', OWN_LATIN, REQUEST, [noSpace], []).map((piece) => piece.text)).toStrictEqual([
      'Hello ',
      'Привет',
    ]);
  });

  /**
   * THE OWNER'S A2 (2026-10-14): a font chosen for a whole block leaves only white space in the run's font, so every
   * space between two restyled words was a piece of its own, and a text page reads an object of one space as nothing.
   * A space alone goes whole into the word after it, and the words in one face are one piece. CONTROL: a face that does
   * not carry a space leaves it where it was, so the move is the face's answer.
   */
  it('puts a space between two words restyled into one face into that face, as one piece', () => {
    const restyled = (segment: string): boolean => segment.trim() === '';
    expect(editPieces('Costs held steady', restyled, REQUEST, CATALOGUE, []).map((piece) => [piece.text, piece.face?.id ?? null])).toStrictEqual([
      ['Costs held steady', 'arimo'],
    ]);
    const noSpace = face('latin', 'Latin', LATIN.replace(' ', ''));
    expect(editPieces('Costs held', restyled, REQUEST, [noSpace], []).map((piece) => [piece.text, piece.face?.id ?? null])).toStrictEqual([
      ['Costs', 'latin'],
      [' ', null],
      ['held', 'latin'],
    ]);
  });

  /**
   * THE OWNER'S " Walked." (2026-10-14): a producer's subset with no W and no k sent "Walked" to a catalogue face and the
   * full stop after it back to the run's own font, a separate object, which PDF.js reads as a separate item: "Walked .".
   * Punctuation stays in the source before it where that source carries it, the resolver's own rule (`resolveRuns`).
   * CONTROL: punctuation after a word in the run's own font stays in the run's own font.
   */
  it('keeps punctuation after a word in another face in that face, as the resolver does', () => {
    const noWk = (segment: string): boolean => OWN_LATIN(segment) && !/[Wk]/u.test(segment);
    const pieces = (text: string): [string, string | null][] =>
      editPieces(text, noWk, REQUEST, CATALOGUE, []).map((piece) => [piece.text, piece.face?.id ?? null]);
    expect(pieces('It was tested Walked.')).toStrictEqual([
      ['It was tested', null],
      [' Walked.', 'arimo'],
    ]);
    expect(pieces('It was tested, then.')).toStrictEqual([['It was tested, then.', null]]);
  });

  it('boxes a character no source carries, naming it, and keeps the rest of the line', () => {
    const box = String.fromCodePoint(0x4e2d);
    expect(summary(`Hello ${box} world`)).toStrictEqual([
      ['Hello ', null, ''],
      [box, 'arimo', box],
      [' world', null, ''],
    ]);
  });

  /**
   * A SIBLING BEFORE THE CATALOGUE (Decision 4): a word the run's font lacks and another subset of that font in the
   * document carries stays in the document's font, with the space before it. CONTROL: with no sibling the same word
   * goes to the catalogue, so the sibling is the case's doing.
   */
  it('sets a word its run’s font lacks in a sibling that carries it, before any catalogue face', () => {
    expect(bySource('Hello Привет world', [sibling(' Привет')])).toStrictEqual([
      ['Hello', null, null],
      [' Привет', null, 0],
      [' world', null, null],
    ]);
    expect(bySource('Hello Привет world', [])).toStrictEqual([
      ['Hello', null, null],
      [' Привет', 'arimo', null],
      [' world', null, null],
    ]);
  });

  /** WHOLE WORDS ONLY: a sibling that carries part of a word is passed over for one that carries it all (Q6). */
  it('passes over a sibling that carries only part of the word, for the next that carries all of it', () => {
    expect(bySource('Hello Привет', [sibling('При'), sibling(' Привет')])).toStrictEqual([
      ['Hello', null, null],
      [' Привет', null, 1],
    ]);
    // AND TO THE CATALOGUE where no sibling carries all of it.
    expect(bySource('Hello Привет', [sibling('При')])).toStrictEqual([
      ['Hello', null, null],
      [' Привет', 'arimo', null],
    ]);
  });

  /** THE SPACE MOVES INTO A SIBLING'S PIECE only where the sibling draws it, as for a catalogue face. */
  it('leaves the space in the run’s own font where the sibling does not draw a space', () => {
    expect(bySource('Hello Привет', [sibling('Привет')])).toStrictEqual([
      ['Hello ', null, null],
      ['Привет', null, 0],
    ]);
  });

  it('starts with a piece in another face where the run’s first word is one its font lacks', () => {
    expect(summary('Привет world')).toStrictEqual([
      ['Привет', 'arimo', ''],
      [' world', null, ''],
    ]);
  });
});
