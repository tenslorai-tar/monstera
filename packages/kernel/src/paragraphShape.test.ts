import { describe, expect, it } from 'vitest';

import { characterUnit, paragraphShape, paragraphSpacing, type LineExtent } from './paragraphShape.js';

/** Six points a character, so an edge is "agreeing" within six points and the cases read in characters. */
const CHARACTER = 6;

/** A line of `characters` characters starting at `x0`. */
function line(x0: number, characters: number): LineExtent {
  return { x0, x1: x0 + characters * CHARACTER, characters };
}

/** A line of `characters` characters whose CENTRE is `centre`. */
function centred(centre: number, characters: number): LineExtent {
  const width = characters * CHARACTER;
  return { x0: centre - width / 2, x1: centre + width / 2, characters };
}

/** A line of `characters` characters whose RIGHT edge is `right`. */
function flushRight(right: number, characters: number): LineExtent {
  return { x0: right - characters * CHARACTER, x1: right, characters };
}

describe('the unit two edges are compared in (ADR-0179 Decision 5)', () => {
  it('is one character’s width across the lines, and 0 where no line holds one', () => {
    expect(characterUnit([line(0, 10), line(0, 30)])).toBe(CHARACTER);
    expect(characterUnit([{ x0: 0, x1: 0, characters: 0 }])).toBe(0);
  });
});

describe('paragraphShape', () => {
  it('reads left-aligned, ragged lines as left with no indent', () => {
    const shape = paragraphShape([line(72, 40), line(72, 38), line(72, 22)]);
    expect(shape).toMatchObject({ align: 'left', firstIndent: 0, left: 72 });
  });

  it('reads a first-line indent as positive and a hanging indent as negative', () => {
    expect(paragraphShape([line(90, 36), line(72, 40), line(72, 12)])).toMatchObject({ align: 'left', firstIndent: 18, left: 72 });
    expect(paragraphShape([line(54, 36), line(72, 40), line(72, 12)])).toMatchObject({ align: 'left', firstIndent: -18, left: 72 });
  });

  it('reads lines that agree on their CENTRES and not their edges as centred', () => {
    const shape = paragraphShape([centred(300, 30), centred(300, 42), centred(300, 18)]);
    expect(shape.align).toBe('center');
    expect(shape.firstIndent).toBe(0);
    expect(shape.centre).toBeCloseTo(300);
  });

  it('reads lines that agree on their RIGHT edges and not their lefts as right-aligned', () => {
    const shape = paragraphShape([flushRight(540, 30), flushRight(540, 42), flushRight(540, 18)]);
    expect(shape.align).toBe('right');
    expect(shape.right).toBe(540);
  });

  it('reads a justified paragraph, whose last line is short, as left: the stated limit', () => {
    const shape = paragraphShape([line(72, 60), line(72, 60), line(72, 60), line(72, 21)]);
    expect(shape.align).toBe('left');
  });

  it('reads a block of ONE line as left, since a line agrees with itself on every edge', () => {
    expect(paragraphShape([centred(300, 30)])).toMatchObject({ align: 'left', firstIndent: 0 });
  });

  it('reads a paragraph of equal-width lines as left, not centred or right', () => {
    expect(paragraphShape([line(72, 40), line(72, 40), line(72, 40)]).align).toBe('left');
  });

  it('reads two centred lines as centred, and two lines one indented as left with an indent', () => {
    expect(paragraphShape([centred(300, 30), centred(300, 20)]).align).toBe('center');
    expect(paragraphShape([line(90, 30), line(72, 20)])).toMatchObject({ align: 'left', firstIndent: 18 });
  });

  it('CONTROL: an edge half a character off agrees, and one and a half characters off does not', () => {
    // Lefts 3 pt apart (half a character) are the same edge: no indent. Lefts 9 pt apart (a character and a half) are
    // not: the first line stands 9 pt left of the rest. Were the tolerance wide enough to call 9 pt the same edge, the
    // second would read an indent of 0.
    expect(paragraphShape([line(72, 30), line(75, 24), line(75, 36)]).firstIndent).toBe(0);
    expect(paragraphShape([line(72, 30), line(81, 24), line(81, 36)]).firstIndent).toBe(-9);
  });
});

describe('paragraphSpacing (ADR-0179 Decision 6)', () => {
  it('is 0 for a block with no hard break and for hard breaks at the pitch', () => {
    expect(paragraphSpacing([700, 686, 672], [true, true, false])).toBe(0);
    expect(paragraphSpacing([700, 686, 672], [false, false, false])).toBe(0);
  });

  it('is how much wider than the pitch a gap at a hard break is', () => {
    expect(paragraphSpacing([700, 686, 672, 652, 638], [true, true, false, true, false])).toBe(6);
  });

  it('CONTROL: a wide gap INSIDE a paragraph, at a soft end, is not paragraph spacing', () => {
    expect(paragraphSpacing([700, 686, 666], [true, true, false])).toBe(0);
  });

  it('is 0 for a single line', () => {
    expect(paragraphSpacing([700], [false])).toBe(0);
  });
});
