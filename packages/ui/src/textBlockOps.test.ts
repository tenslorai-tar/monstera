import { describe, expect, it } from 'vitest';

import type { TextBlock } from './commands/documentCommands.js';
import { joinEdits, neighbourOf, runSpans, splitEdits, styleMarks, wordsOfBlock } from './textBlockOps.js';

const REGULAR = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const BOLD = { ...REGULAR, bold: true, colour: { r: 200, g: 0, b: 0 } };

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** A block of the given lines, each a list of [index, text, style] runs, at the given top. */
function block(top: number, lines: { runs: [number, string, TextBlock['lines'][number]['runs'][number]['style']][]; soft: boolean }[]): TextBlock {
  return {
    box: box(72, top - 14 * lines.length, 300, top),
    lines: lines.map((line, at) => ({
      runs: line.runs.map(([index, text, style]) => ({ index, text, style })),
      box: box(72, top - 14 * (at + 1), 300, top - 14 * at),
      soft: line.soft,
      baseline: top - 14 * (at + 1) + 3,
    })),
    style: REGULAR,
    shape: { align: 'left', firstIndent: 0 },
  };
}

/** Two lines, the first soft: ONE paragraph; then a hard line of its own. */
const UPPER = block(700, [
  { runs: [[1, 'Words that run on ', REGULAR]], soft: true },
  { runs: [[2, 'and end here.', REGULAR]], soft: false },
]);
const LOWER = block(660, [{ runs: [[3, 'A ', REGULAR], [4, 'bold', BOLD], [5, ' close.', REGULAR]], soft: false }]);

describe('runSpans', () => {
  it('names every run by an offset into the words the editor shows, across a soft wrap and a hard break', () => {
    const words = wordsOfBlock(UPPER);
    expect(words).toBe('Words that run on and end here.');
    const spans = runSpans(UPPER);
    expect(spans.map((span) => words.slice(span.from, span.to))).toStrictEqual(['Words that run on ', 'and end here.']);
    // CONTROL: a hard break between lines is one character in the words, and the offsets count it.
    const hard = block(500, [
      { runs: [[1, 'one', REGULAR]], soft: false },
      { runs: [[2, 'two', REGULAR]], soft: false },
    ]);
    expect(wordsOfBlock(hard)).toBe('one\ntwo');
    expect(runSpans(hard).map((span) => wordsOfBlock(hard).slice(span.from, span.to))).toStrictEqual(['one', 'two']);
  });
});

describe('styleMarks', () => {
  it('carries each run’s look over its own words, shifted, and merges neighbours that look alike', () => {
    expect(styleMarks(LOWER, 10)).toStrictEqual([
      { from: 10, to: 12, set: { bold: false, italic: false, size: 11, colour: { r: 0, g: 0, b: 0 } } },
      { from: 12, to: 16, set: { bold: true, italic: false, size: 11, colour: { r: 200, g: 0, b: 0 } } },
      { from: 16, to: 23, set: { bold: false, italic: false, size: 11, colour: { r: 0, g: 0, b: 0 } } },
    ]);
    const alike = block(500, [{ runs: [[1, 'ab', REGULAR], [2, 'cd', REGULAR]], soft: false }]);
    expect(styleMarks(alike, 0)).toHaveLength(1);
  });
});

/** No family known for any font. */
const NONE = (): undefined => undefined;

describe('joinEdits', () => {
  it('is one paragraph of both blocks’ words, the lower block’s looks kept, and the lower block emptied', () => {
    const [upper, lower] = joinEdits(UPPER, LOWER, NONE).edits;
    expect(upper.text).toBe('Words that run on and end here. A bold close.');
    expect(upper.lines).toStrictEqual([[1], [2]]);
    // THE LOWER BLOCK'S BOLD WORD is bold at ITS offset in the joined words, which is where a mark for it must be.
    const bold = upper.marks?.find((mark) => mark.set.bold === true);
    expect(upper.text.slice(bold?.from, bold?.to)).toBe('bold');
    expect(lower.text).toBe('');
    expect(lower.lines).toStrictEqual([[3, 4, 5]]);
  });

  it('names every run of both blocks once, so the wire accepts it', () => {
    const [upper, lower] = joinEdits(UPPER, LOWER, NONE).edits;
    const named = [...upper.lines.flat(), ...lower.lines.flat()];
    expect(new Set(named).size).toBe(named.length);
  });

  // THE OWNER'S DECISION OF 2026-10-18 (VVVVVVV-18): the lower block's family carried where its page font resolves.
  const HELVETICA = { ...REGULAR, font: 'ABCDEF+Helvetica' };
  const TIMES = { ...REGULAR, serif: true, font: 'GHIJKL+Times-Roman' };
  const sansUpper = block(700, [{ runs: [[1, 'Upper words.', HELVETICA]], soft: false }]);
  const serifLower = block(660, [{ runs: [[2, 'Lower words.', TIMES]], soft: false }]);

  it('carries the lower block’s family where its font resolves, and keeps nothing', () => {
    const familyOf = (font: string): string | undefined => (font === 'GHIJKL+Times-Roman' ? 'Tinos' : undefined);
    const { edits, kept } = joinEdits(sansUpper, serifLower, familyOf);
    const carried = edits[0].marks?.find((mark) => edits[0].text.slice(mark.from, mark.to) === 'Lower words.');
    expect(carried?.set.family).toBe('Tinos');
    expect(kept).toBe(false);
  });

  it('CONTROL: where it does not resolve, no family is carried and the join says the upper’s was kept', () => {
    const { edits, kept } = joinEdits(sansUpper, serifLower, NONE);
    expect(edits[0].marks?.some((mark) => mark.set.family !== undefined)).toBe(false);
    expect(kept).toBe(true);
    // AND NOTHING TO SAY where the lower block is already in the upper's font, resolved or not.
    const sansLower = block(660, [{ runs: [[2, 'Lower words.', { ...HELVETICA, font: 'MNOPQR+Helvetica' }]], soft: false }]);
    expect(joinEdits(sansUpper, sansLower, NONE).kept).toBe(false);
  });
});

describe('splitEdits', () => {
  const TWO = block(700, [
    { runs: [[1, 'First para ', REGULAR]], soft: true },
    { runs: [[2, 'continues.', REGULAR]], soft: false },
    { runs: [[3, 'Second para.', REGULAR]], soft: false },
  ]);

  it('divides the lines and the words at the paragraph, each half keeping its own', () => {
    const halves = splitEdits(TWO, 1, []);
    expect(halves?.[0]).toMatchObject({ lines: [[1], [2]], text: 'First para continues.' });
    expect(halves?.[1]).toMatchObject({ lines: [[3]], text: 'Second para.' });
    // THE TWO TOGETHER ARE THE WORDS THEY WERE, so nothing was dropped between them.
    expect([halves?.[0]?.text, halves?.[1]?.text].join('\n')).toBe(wordsOfBlock(TWO));
  });

  it('moves the second half down by a line, the movement that keeps the grouping from joining them again', () => {
    const halves = splitEdits(TWO, 1, []);
    expect(halves?.[1]?.place).toStrictEqual({ move: { x: 0, y: -14 } });
    expect(halves?.[0]?.place).toBeUndefined();
    // AND NOTHING ELSE: the two halves are the whole edit, and the text below stays where it is (ADR-0271 section 11.1).
    expect(halves).toHaveLength(2);
  });

  it('is nothing where there is no paragraph to split before', () => {
    expect(splitEdits(TWO, 0, [])).toBeUndefined();
    expect(splitEdits(TWO, 2, [])).toBeUndefined();
    expect(splitEdits(LOWER, 1, [])).toBeUndefined();
  });

  /** A one-line block in TWO's column whose top is at `top`. */
  const under = (top: number): TextBlock => block(top, [{ runs: [[9, 'Below.', REGULAR]], soft: false }]);

  it('is nothing where the moved half would land within a line of the text below (the owner’s decision, ADR-0271)', () => {
    // TWO's second half is its last line, 658 to 672; moved down 14 it is 644 to 658, and a line under that is 630.
    expect(splitEdits(TWO, 1, [TWO, under(631)])).toBeUndefined();
    // DRAWN OVER: a block the moved half would land on.
    expect(splitEdits(TWO, 1, [TWO, under(650)])).toBeUndefined();
    // CONTROL, at the boundary: a block exactly a line under the moved half is clear, so the case above is the line's.
    expect(splitEdits(TWO, 1, [TWO, under(630)])).toHaveLength(2);
  });

  it('CONTROL: a block close below in ANOTHER column, or the block itself, does not stop the split', () => {
    const beside: TextBlock = { ...under(640), box: box(320, 626, 500, 640) };
    expect(splitEdits(TWO, 1, [TWO, beside])).toHaveLength(2);
    // A SECOND HALF OF TWO LINES, which moved down a line still lies inside the block's own box: the page's list holds
    // the block, and it is not text below.
    const THREE = block(700, [
      { runs: [[1, 'First.', REGULAR]], soft: false },
      { runs: [[2, 'Second, ', REGULAR]], soft: true },
      { runs: [[3, 'and on.', REGULAR]], soft: false },
    ]);
    expect(splitEdits(THREE, 1, [THREE])).toHaveLength(2);
  });
});

describe('neighbourOf', () => {
  const blocks = [
    block(700, [{ runs: [[1, 'Heading', REGULAR]], soft: false }]),
    block(670, [{ runs: [[2, 'Body', REGULAR]], soft: false }]),
    block(300, [{ runs: [[3, 'Far away', REGULAR]], soft: false }]),
  ];

  it('finds the block directly above and below, and none across a page', () => {
    expect(neighbourOf(blocks, 1, 'above')).toBe(0);
    expect(neighbourOf(blocks, 0, 'below')).toBe(1);
    // CONTROL: the far block is neither's neighbour, and the top block has nothing above it.
    expect(neighbourOf(blocks, 1, 'below')).toBeUndefined();
    expect(neighbourOf(blocks, 0, 'above')).toBeUndefined();
  });

  it('wants the same column: a block beside it is no continuation', () => {
    const aside = { ...blocks[1], box: box(400, 656, 520, 670) } as TextBlock;
    const first = blocks[0];
    if (first === undefined) throw new Error('the fixture lost its first block');
    expect(neighbourOf([first, aside], 1, 'above')).toBeUndefined();
  });

  it('never across streams: a block inside a form is no continuation of the page’s, nor of another form’s (ADR-0269)', () => {
    const [first, second] = blocks;
    if (first === undefined || second === undefined) throw new Error('the fixture lost its blocks');
    const inForm = { ...second, form: [{ name: 'Fm1', occurrence: 0 }] };
    expect(neighbourOf([first, inForm], 1, 'above')).toBeUndefined();
    // CONTROL: two blocks of the same form are neighbours as the page's are.
    expect(neighbourOf([{ ...first, form: [{ name: 'Fm1', occurrence: 0 }] }, inForm], 1, 'above')).toBe(0);
    expect(neighbourOf([{ ...first, form: [{ name: 'Fm1', occurrence: 1 }] }, inForm], 1, 'above')).toBeUndefined();
  });
});
