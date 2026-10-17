import { describe, expect, it } from 'vitest';

import { type JoinStyle, type ObjectRun, joinRuns, membersOf } from './textRunJoin.js';

const STYLE: JoinStyle = {
  size: 10,
  colour: { r: 0, g: 0, b: 0 },
  serif: true,
  mono: false,
  italic: false,
  bold: false,
  orientation: 'upright',
  baseline: 700,
};

/** A glyph object at `x` on the baseline `y`, five points wide. */
function glyph(index: number, text: string, x: number, y = 700, style = STYLE): ObjectRun {
  return { index, text, drawn: text, left: x, right: x + 5, bottom: y, top: y + 7, style: { ...style, baseline: y } };
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
      // A SUPERSCRIPT IN THE SAME SIZE AND FACE (the owner's N14): its ink overlaps the line's by 4 of 10, past the
      // line test's 3, so only the baseline keeps its rise from being joined away.
      ['a piece raised off the baseline', [glyph(0, 'a', 72), glyph(1, '2', 77, 703)]],
      ['a gap wider than the size', [glyph(0, 'a', 72), glyph(1, 'b', 77 + 11)]],
      ['an overlap deeper than a quarter', [glyph(0, 'a', 72), glyph(1, 'b', 77 - 3)]],
      [
        'text not set upright',
        [glyph(0, 'a', 72, 700, { ...STYLE, orientation: 'turned' }), glyph(1, 'b', 77, 700, { ...STYLE, orientation: 'turned' })],
      ],
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

describe('joinRuns’ two direction rules (ADR-0185; VVVVVVV-31: only the native proof reached them)', () => {
  it('objects that run OPPOSITE WAYS are two runs however they abut, and a digit between them joins either way', () => {
    // "abc" then Hebrew "אב" drawn one glyph per object, abutting on one line in one style.
    const latin = word(0, 'abc', 72);
    const hebrew = [glyph(3, 'ב', 87), glyph(4, 'א', 92)];
    const split = joinRuns([...latin, ...hebrew]);
    expect(split.map((run) => [run.index, run.last])).toStrictEqual([
      [0, 2],
      [3, 4],
    ]);
    // CONTROL: a digit has no direction, so it joins the Latin before it — the split above is the direction rule's.
    expect(joinRuns([...latin, glyph(3, '7', 87)]).map((run) => [run.index, run.last])).toStrictEqual([[0, 3]]);
  });

  it('a joined RIGHT-TO-LEFT run’s text is its drawn glyphs read logically, not their order on the page', () => {
    // DRAWN left to right as the page shows them: ב then א — which reads, logically, א then ב.
    const [run] = joinRuns([glyph(0, 'ב', 72), glyph(1, 'א', 77)]);
    expect(run?.drawn).toBe('בא');
    expect(run?.text).toBe('אב');
    // CONTROL: a Latin run's text is its drawn order, untouched.
    expect(joinRuns(word(0, 'ab', 72))[0]?.text).toBe('ab');
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
