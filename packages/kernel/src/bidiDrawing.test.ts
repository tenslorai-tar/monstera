import { describe, expect, it } from 'vitest';

import {
  drawnOrder,
  drawnRightToLeft,
  drewTheGlyphs,
  isNeutralOnly,
  lineDirection,
  logicalOf,
  readBackOf,
} from './bidiOrder.js';
import type { EditPiece } from './editPieces.js';
import { inDrawingOrder } from './visualPieces.js';

/**
 * The order right-to-left text is written in and read back in
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)).
 * Every expected string here is a reading MEASURED on PDFium 155.0.8044.0's Linux build on 2026-10-06 (`readBackOf`) or
 * the order a reader sees (`drawnOrder`), not one computed by the function under test.
 */

const SHALOM = 'שלום';
const OLAM = 'עולם';

describe('drawnOrder', () => {
  it('writes a right-to-left line last letter first, a left-to-right line as typed', () => {
    expect(drawnOrder(`${SHALOM} ${OLAM}`)).toBe('םלוע םולש');
    expect(drawnOrder('Hello world')).toBe('Hello world');
  });

  it('keeps a left-to-right word inside a right-to-left line in place and mirrors a bracket', () => {
    expect(drawnOrder(`${SHALOM} (${OLAM})`)).toBe('(םלוע) םולש');
    expect(drawnOrder(`Hello ${SHALOM}`)).toBe('Hello םולש');
  });

  // THE CONTROL: with no right-to-left letter there is nothing to reorder, so the function must hand back the text it was given
  it('does not reorder text with no right-to-left letter in it', () => {
    expect(drawnOrder('(a) b, 123')).toBe('(a) b, 123');
  });
});

describe('drawnRightToLeft', () => {
  it('keeps a letter’s marks after it, since a mark is drawn where the letter ended', () => {
    const marked = `ב${String.fromCodePoint(0x5b7)}א`;
    expect(drawnRightToLeft(marked)).toBe(`אב${String.fromCodePoint(0x5b7)}`);
  });
});

describe('readBackOf', () => {
  it('reverses each word in place and leaves the words in the order drawn, as a text page does', () => {
    expect(readBackOf('םלוע םולש')).toBe(`${OLAM} ${SHALOM}`);
  });

  it('leaves a neutral before a word where it stands and reverses and mirrors one between two words', () => {
    expect(readBackOf('(םלוע) םולש')).toBe(`(${OLAM} (${SHALOM}`);
    expect(readBackOf(' םולש')).toBe(` ${SHALOM}`);
  });

  it('does not reverse a neutral that is a number’s separator: a colon stays where it is drawn', () => {
    expect(readBackOf('םלוע :םולש')).toBe(`${OLAM} :${SHALOM}`);
  });

  it('mirrors a bracket that ends the text after a word', () => {
    expect(readBackOf('(םולש)')).toBe(`(${SHALOM}(`);
  });

  it('is its own inverse, which `logicalOf` relies on', () => {
    for (const drawn of ['םלוע םולש', '(םלוע) םולש', 'Hello םולש', 'םלוע :םולש']) {
      expect(readBackOf(readBackOf(drawn))).toBe(drawn);
    }
  });
});

describe('logicalOf', () => {
  it('turns a text page’s reading back into the line as typed', () => {
    expect(logicalOf(`${OLAM} ${SHALOM}`)).toBe(`${SHALOM} ${OLAM}`);
    expect(logicalOf(`(${OLAM} (${SHALOM}`)).toBe(`${SHALOM} (${OLAM})`);
  });

  it('is the inverse of drawing then reading, for every kind of line this writes', () => {
    for (const typed of [
      `${SHALOM} ${OLAM}`,
      `${SHALOM} (${OLAM})`,
      `${SHALOM}, 123 ${OLAM}`,
      `Hello (${SHALOM})`,
      `${SHALOM} Hello`,
      `abc ${SHALOM} def ${OLAM} xyz`,
      'مرحبا بالعالم',
      'Hello world',
    ]) {
      expect(logicalOf(readBackOf(drawnOrder(typed)))).toBe(typed);
    }
  });

  it('hands back a line with no right-to-left letter unread', () => {
    expect(logicalOf('Hello (world), 123')).toBe('Hello (world), 123');
  });
});

describe('lineDirection', () => {
  it('is the majority’s, not the first letter’s', () => {
    expect(lineDirection(`Hello ${SHALOM} ${OLAM}`)).toBe('rtl');
    expect(lineDirection(`${SHALOM} Hello world`)).toBe('ltr');
  });

  it('is the same for a line as typed and as drawn, so that writing what was read changes nothing', () => {
    const typed = `Hello ${SHALOM} ${OLAM}`;
    expect(lineDirection(drawnOrder(typed))).toBe(lineDirection(typed));
  });

  it('falls to the first strong letter where the two are level', () => {
    expect(lineDirection(`ab ${SHALOM}`.replace(SHALOM, 'אב'))).toBe('ltr');
    expect(lineDirection('אב ab')).toBe('rtl');
  });
});

describe('drewTheGlyphs', () => {
  it('counts a bracket and its mirror image as one glyph, for any text', () => {
    expect(drewTheGlyphs(')', '(')).toBe(true);
    expect(drewTheGlyphs('a)', 'a(')).toBe(true);
  });

  it('lets the order go only for text with right-to-left letters in it', () => {
    expect(drewTheGlyphs(`${SHALOM} (`, `( ${SHALOM}`)).toBe(true);
    expect(drewTheGlyphs('ab', 'ba')).toBe(false);
  });

  // THE CONTROL: a character the font did not draw reads as another or none, and that must still fail.
  it('fails where a character was not drawn', () => {
    expect(drewTheGlyphs(SHALOM, 'ÿÿÿÿ')).toBe(false);
    expect(drewTheGlyphs(SHALOM, SHALOM.slice(1))).toBe(false);
  });
});

describe('isNeutralOnly', () => {
  it('is true of spaces and punctuation alone, and of nothing with a letter or a digit', () => {
    expect(isNeutralOnly(' (")')).toBe(true);
    expect(isNeutralOnly(' a')).toBe(false);
    expect(isNeutralOnly('')).toBe(false);
  });
});

describe('inDrawingOrder', () => {
  const piece = (text: string, own: boolean): EditPiece => ({
    text,
    face: own ? null : ({ id: 'face' } as never),
    sibling: null,
    weight: 400,
    boxed: [],
  });
  const carried = (): boolean => true;
  const shown = (text: string, pieces: EditPiece[]): [string, boolean | undefined][] =>
    inDrawingOrder(text, pieces, carried).map((each) => [each.text, each.rtl]);

  it('returns a line with no right-to-left span as it came', () => {
    expect(shown('Hello world', [piece('Hello ', true), piece('world', false)])).toStrictEqual([
      ['Hello ', false],
      ['world', false],
    ]);
  });

  it('puts the last word typed leftmost in a right-to-left line, and keeps a Latin run in the order typed', () => {
    const text = `${SHALOM} ${OLAM} Hi`;
    expect(shown(text, [piece(`${SHALOM} ${OLAM} `, false), piece('Hi', true)])).toStrictEqual([
      ['Hi', false],
      [`${SHALOM} ${OLAM} `, true],
    ]);
  });

  it('joins a space to the word beside it instead of making an object of it, which a text page would read as nothing', () => {
    const text = `Hello ${SHALOM}`;
    const drawn = inDrawingOrder(text, [piece('Hello', false), piece(' ', true), piece(SHALOM, false)], carried);
    expect(drawn.map((each) => each.text)).toStrictEqual(['Hello ', SHALOM]);
  });

  // THE CONTROL: where the neighbour's source does not carry the space, it stays an object of its own, so nothing is dropped
  it('leaves a space as its own object where the piece beside it cannot carry it', () => {
    const text = `Hello ${SHALOM}`;
    const drawn = inDrawingOrder(text, [piece('Hello', false), piece(' ', true), piece(SHALOM, false)], () => false);
    expect(drawn.map((each) => each.text).join('')).toBe(`Hello ${SHALOM}`);
    expect(drawn.map((each) => each.text)).toContain(' ');
  });

  it('is one object, ordered as a whole, where one piece is the whole line', () => {
    expect(shown(`${SHALOM} Hello`, [piece(`${SHALOM} Hello`, false)])).toStrictEqual([[`${SHALOM} Hello`, undefined]]);
  });
});
