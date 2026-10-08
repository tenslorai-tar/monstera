import { describe, expect, it } from 'vitest';

import { logicalLine, readInLineOrder } from './bidiLine.js';
import { logicalFromDrawn, reorderedFrom, strongDirections } from './bidiOrder.js';
import { groupIntoBlocks } from './textLines.js';
import { visualUnits } from './visualPieces.js';

/**
 * A line of several objects, read and written as one line
 * ([ADR-0185](../../../docs/DECISIONS/0185-a-line-of-several-objects-is-read-and-written-as-one-line.md)). Every expected
 * string is worked out here by hand from the algorithm's reordering (a right-to-left span reversed, a left-to-right word
 * inside it in place), never taken from the function under test.
 */

const SHALOM = 'שלום';
const OLAM = 'עולם';

/** A run: `drawn` is its glyphs left to right, `text` what it says read alone. */
function run(drawn: string, left: number, text = drawn) {
  return { drawn, text, left };
}

describe('reorderedFrom', () => {
  it('answers where each unit of the reordered text came from, a right-to-left word reversed and the rest in place', () => {
    const { text, from } = reorderedFrom(`Hello ${SHALOM}`, 'ltr');
    expect(text).toBe('Hello םולש');
    // H e l l o, the space, then the four letters of the word last first (indices 9, 8, 7, 6).
    expect(from).toStrictEqual([0, 1, 2, 3, 4, 5, 9, 8, 7, 6]);
  });

  it('mirrors a bracket in a right-to-left span and says which unit it came from', () => {
    const { text, from } = reorderedFrom(`(${SHALOM})`, 'rtl');
    expect(text).toBe('(םולש)');
    expect(from).toStrictEqual([5, 4, 3, 2, 1, 0]);
  });

  it('is the identity, unit for unit, for text with nothing to reorder', () => {
    expect(reorderedFrom('Hello world', 'ltr')).toStrictEqual({ text: 'Hello world', from: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });

  it('keeps a letter and its marks together, the marks first as the shaper answers a right-to-left cluster', () => {
    // ب + fatha, then ا: drawn right to left as ا, then the fatha, then ب.
    const { text, from } = reorderedFrom('بَا', 'rtl');
    expect(text).toBe('اَب');
    expect(from).toStrictEqual([2, 1, 0]);
  });
});

describe('strongDirections', () => {
  it('names which ways the strong letters run, and none for digits, spaces and punctuation', () => {
    expect(strongDirections('Hello')).toBe(1);
    expect(strongDirections(SHALOM)).toBe(2);
    expect(strongDirections(`Hello ${SHALOM}`)).toBe(3);
    expect(strongDirections('123 (, )')).toBe(0);
  });
});

describe('logicalLine', () => {
  it('reads a Hebrew phrase drawn in two objects as the phrase typed, the right-hand object first', () => {
    // `שלום עולם` drawn: the second word on the left, the first on the right, each word's letters reversed.
    const line = logicalLine([run('םלוע', 0), run(' םולש', 10)]);
    expect(line.texts).toStrictEqual([`${SHALOM} `, OLAM]);
    expect(line.runs.map((each) => each.left)).toStrictEqual([10, 0]);
  });

  it('puts a space at the right side of a word, which each object read alone does not', () => {
    // The right-hand object holds the space that stands between the Latin word and the Hebrew one.
    const alone = [run('Hello', 0), run(' םולש', 40, `${SHALOM} `)];
    // Read alone, the object ` םולש` says `שלום ` (the space after the word): joined, the line says `Helloשלום `.
    expect(alone.map((each) => each.text).join('')).toBe(`Hello${SHALOM} `);
    // As one line, tied letters, left to right: `Hello שלום`, the space between the two words.
    expect(logicalLine(alone).texts.join('')).toBe(`Hello ${SHALOM}`);
  });

  it('reads a Latin word between Hebrew phrases in the order the line was typed', () => {
    // Typed `שלום עולם Hello`, mostly Hebrew so right to left: Hello at the far left, the phrase to its right.
    const drawn = [run('Hello', 0), run(' םלוע םולש', 42, `${SHALOM} ${OLAM} `)];
    const line = logicalLine(drawn);
    expect(line.texts).toStrictEqual([`${SHALOM} ${OLAM} `, 'Hello']);
    expect(line.runs.map((each) => each.drawn)).toStrictEqual([' םלוע םולש', 'Hello']);
  });

  it('does not depend on the order the runs are given in: it goes by where they are', () => {
    const left = run('םלוע', 0);
    const right = run(' םולש', 10);
    expect(logicalLine([right, left]).texts).toStrictEqual(logicalLine([left, right]).texts);
  });

  it('returns a line with no right-to-left letter exactly as it came', () => {
    const runs = [run('Hello ', 0), run('world', 40)];
    const line = logicalLine(runs);
    expect(line.runs).toBe(runs);
    expect(line.texts).toStrictEqual(['Hello ', 'world']);
  });

  it('CONTROL: where a run is split by another, it keeps each run its own words in the order given', () => {
    // `ab אב cd` drawn `ab בא cd`, cut between the two letters of the Hebrew word: the first run holds `ab ב`, the
    // second `א cd`. In the line as typed the word's alef (the second run's) stands between the first run's `ab ` and its
    // bet, so neither run is one stretch of the line.
    const runs = [run('ab ב', 0, 'ab ב'), run('א cd', 30, 'א cd')];
    const line = logicalLine(runs);
    expect(line.runs).toBe(runs);
    expect(line.texts).toStrictEqual(['ab ב', 'א cd']);
  });
});

describe('logicalFromDrawn', () => {
  it('reads the line from its glyphs with the majority direction, a tie going to the first strong letter drawn', () => {
    // `Hello שלום`: five Latin letters, four Hebrew: left to right, so the Hebrew word is turned back.
    expect(logicalFromDrawn('Hello םולש').text).toBe(`Hello ${SHALOM}`);
  });
});

describe('readInLineOrder', () => {
  const box = { bottom: 100, top: 112 };
  const full = (index: number, drawn: string, left: number, right: number, text = drawn) => ({
    index,
    drawn,
    text,
    left,
    right,
    ...box,
  });

  it('puts a line the page gives left to right into the order typed, each run saying its words, in the slots the line filled', () => {
    const before = full(7, 'Hello', 0, 40);
    const phrase = full(8, ' םלוע םולש', 42, 100, 'לא נכון');
    const other = full(9, 'Elsewhere', 0, 60);
    const elsewhere = { ...other, bottom: 20, top: 32 };
    const list = [before, elsewhere, phrase];
    const out = readInLineOrder(list, () => true);
    expect(out.map((each) => each.index)).toStrictEqual([8, 9, 7]);
    expect(out.map((each) => each.text)).toStrictEqual([`${SHALOM} ${OLAM} `, 'Elsewhere', 'Hello']);
  });

  it('leaves the runs it is not asked about where they are, and a line with no right-to-left letter as it came', () => {
    const plain = [full(1, 'one', 0, 30), full(2, 'two', 32, 60)];
    const out = readInLineOrder(plain, () => true);
    expect(out).toStrictEqual(plain);
    const turned = [full(1, 'םלוע', 0, 30), full(2, ' םולש', 32, 60, `${SHALOM} `)];
    expect(readInLineOrder(turned, () => false)).toStrictEqual(turned);
  });
});

describe('the block grouping over a line given in the order typed', () => {
  it('is one line, though a run in the order typed is far from the run before it in the list', () => {
    // The Arabic phrase at the right comes first, then `Hello` at the far left, then ` world` between them and the
    // phrase: the order of a right-to-left line. A sweep in list order measures `Hello` from the phrase, 47 pt away, and
    // ends the line; swept by position the three are one.
    const style = { size: 18 };
    const at = (index: number, left: number, right: number, text: string) => ({
      index,
      text,
      left,
      right,
      bottom: 114.5,
      top: 132.3,
      style,
      setting: 'x',
    });
    const blocks = groupIntoBlocks([at(2, 158.5, 241, 'A'), at(0, 72.3, 111.5, 'Hello'), at(1, 112, 158.3, ' world')]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.lines).toHaveLength(1);
    expect(blocks[0]?.lines[0]?.runs.map((each) => each.index)).toStrictEqual([2, 0, 1]);
  });
});

describe('visualUnits', () => {
  it('draws a row in the order it is seen: a right-to-left phrase typed last is at the left, each stretch in its direction', () => {
    // `Hello שלום עולם`, mostly Hebrew so right to left: the Hebrew words at the left, `Hello` at the right.
    const units = visualUnits(['Hello ', `${SHALOM} ${OLAM}`]);
    expect(units).toStrictEqual([
      { piece: 1, text: `${SHALOM} ${OLAM}`, rtl: true },
      // The space between the words is the Hebrew's by the algorithm, and is drawn with the Latin word it was typed with.
      { piece: 0, text: ' Hello', rtl: false },
    ]);
  });

  it('answers nothing for a row of one piece, or of one direction, which is written as it stands', () => {
    expect(visualUnits([`${SHALOM} ${OLAM}`])).toBeUndefined();
    expect(visualUnits(['Hello ', 'world'])).toBeUndefined();
  });

  it('cuts a stretch at the boundary of the pieces it crosses, and draws a right-to-left run of them last typed first', () => {
    // `שלום עולם Hello` in three pieces, mostly Hebrew so right to left: `Hello`, typed last, is at the left; the two Hebrew
    // pieces are one rtl stretch cut in two, drawn second first (the second typed is to the left of the first).
    const units = visualUnits([SHALOM, ` ${OLAM} `, 'Hello']);
    expect(units?.map((unit) => [unit.piece, unit.text, unit.rtl])).toStrictEqual([
      [2, 'Hello', false],
      [1, ` ${OLAM} `, true],
      [0, SHALOM, true],
    ]);
  });
});
