import { describe, expect, it } from 'vitest';

import { type ObjectRun, joinRuns, membersOf } from './textRunJoin.js';

const STYLE = {
  size: 10,
  colour: { r: 0, g: 0, b: 0 },
  serif: true,
  mono: false,
  italic: false,
  bold: false,
  upright: true,
};

/** A glyph object at `x` on the baseline `y`, five points wide. */
function glyph(index: number, text: string, x: number, y = 700, style = STYLE): ObjectRun {
  return { index, text, left: x, right: x + 5, bottom: y, top: y + 7, style };
}

/** A word drawn one glyph per object, from object `first`, starting at `x`. */
function word(first: number, text: string, x: number, y = 700): ObjectRun[] {
  return Array.from(text, (character, at) => glyph(first + at, character, x + at * 5, y));
}

describe('joinRuns', () => {
  it('joins a line drawn one glyph per object into ONE run, named by its first object and carrying its last', () => {
    const line = [...word(0, 'Hello', 72), ...word(5, 'world', 72 + 5 * 5 + 3)];
    const joined = joinRuns(line);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ index: 0, last: 9, text: 'Helloworld', left: 72, right: 72 + 25 + 3 + 25 });
  });

  it('a page of 60 lines × 140 glyphs answers 60 runs, not 8,400 — the page the bound used to refuse', () => {
    const page: ObjectRun[] = [];
    for (let line = 0; line < 60; line += 1) {
      for (let at = 0; at < 140; at += 1) page.push(glyph(line * 140 + at, 'x', 36 + at * 4, 760 - line * 12));
    }
    expect(page).toHaveLength(8400);
    expect(joinRuns(page)).toHaveLength(60);
  });

  it('CONTROL: keeps runs apart that differ in style, line, gap, overlap or object order', () => {
    const bold = { ...STYLE, bold: true };
    const cases: [string, ObjectRun[]][] = [
      ['a style change', [glyph(0, 'a', 72), glyph(1, 'b', 77, 700, bold)]],
      ['a new line', [glyph(0, 'a', 72), glyph(1, 'b', 77, 688)]],
      ['a line at tight leading, its ink barely touching', [glyph(0, 'a', 72), glyph(1, 'b', 77, 693.5)]],
      ['a gap wider than the size', [glyph(0, 'a', 72), glyph(1, 'b', 77 + 11)]],
      ['an overlap deeper than a quarter', [glyph(0, 'a', 72), glyph(1, 'b', 77 - 3)]],
      ['text not set upright', [glyph(0, 'a', 72, 700, { ...STYLE, upright: false }), glyph(1, 'b', 77, 700, { ...STYLE, upright: false })]],
    ];
    for (const [why, runs] of cases) expect(joinRuns(runs), why).toHaveLength(2);
  });

  it('a DESCENDER keeps its glyph on the line: ink that reaches lower is still the same line', () => {
    // `g` reaches 2.5 points below the baseline at 12 points: its ink's bottom differs from its neighbours' by a fifth
    // of the size, and comparing bottoms broke a real line at its first `g` (measured 2026-10-01).
    const descender = { ...glyph(1, 'g', 77), bottom: 697.5 };
    expect(joinRuns([glyph(0, 'n', 72), descender, glyph(2, 'n', 82)])).toHaveLength(1);
  });

  it('joins in the page’s OWN order whatever order the walk handed them in', () => {
    const shuffled = [...word(0, 'abc', 72)].reverse();
    expect(joinRuns(shuffled)).toMatchObject([{ index: 0, last: 2, text: 'abc' }]);
  });
});

describe('membersOf', () => {
  it('expands a named run into exactly its objects, and refuses a name the read never answered', () => {
    const joined = joinRuns([...word(3, 'four', 72), glyph(7, 'X', 200)]);
    expect(membersOf(joined, 3)).toStrictEqual([3, 4, 5, 6]);
    expect(membersOf(joined, 7)).toStrictEqual([7]);
    // A MEMBER is not a name: only a run's first object names it, so an edit naming the inside of a run is refused.
    expect(membersOf(joined, 4)).toBeUndefined();
  });

  it('joins ACROSS an object the walk holds no run for, and never names that object as a member', () => {
    // Objects 0–4 "Drawn", object 5 a space drawn with no ink (no run), objects 6–8 "one" — measured as the shape a
    // line drawn one glyph per object takes.
    const joined = joinRuns([...word(0, 'Drawn', 72), ...word(6, 'one', 72 + 25 + 3)]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ index: 0, last: 8 });
    expect(membersOf(joined, 0)).toStrictEqual([0, 1, 2, 3, 4, 6, 7, 8]);
  });
});
