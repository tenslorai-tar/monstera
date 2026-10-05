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
  };
}

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,!';
const ARIMO = face('arimo', 'Arimo', `${LATIN}ПриветΩ`);
const CATALOGUE = [ARIMO];
const OWN_LATIN = (segment: string): boolean => Array.from(segment).every((character) => LATIN.includes(character));
const REQUEST: FontRequest = { family: 'Helvetica', bold: false, italic: false, own: [] };

function summary(text: string, faces: readonly CatalogueFace[] = CATALOGUE): [string, string | null, string][] {
  return editPieces(text, OWN_LATIN, REQUEST, faces).map((piece) => [piece.text, piece.face?.id ?? null, piece.boxed.join('')]);
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
    expect(editPieces('Hello Привет', OWN_LATIN, REQUEST, [noSpace]).map((piece) => piece.text)).toStrictEqual([
      'Hello ',
      'Привет',
    ]);
  });

  it('boxes a character no source carries, naming it, and keeps the rest of the line', () => {
    const box = String.fromCodePoint(0x4e2d);
    expect(summary(`Hello ${box} world`)).toStrictEqual([
      ['Hello ', null, ''],
      [box, 'arimo', box],
      [' world', null, ''],
    ]);
  });

  it('starts with a piece in another face where the run’s first word is one its font lacks', () => {
    expect(summary('Привет world')).toStrictEqual([
      ['Привет', 'arimo', ''],
      [' world', null, ''],
    ]);
  });
});
