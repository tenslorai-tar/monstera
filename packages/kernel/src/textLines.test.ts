import { describe, expect, it } from 'vitest';

import { type BlockableRun, type GroupableRun, groupIntoBlocks, groupIntoLines, paragraphText } from './textLines.js';

describe('paragraphText (ADR-0097 4c)', () => {
  /** A line of `text` from 0 to `x1`: ten characters take 50, so a character is 5 wide. */
  const line = (text: string, x1: number) => ({ text, box: { x0: 0, x1 } });

  it('joins a line the next line’s first word would NOT have fitted after — a soft wrap', () => {
    // `jumps` is 5 characters and a space: 30 at 5 each. 180 + 30 = 210 > 200, so it wrapped.
    expect(paragraphText([line('The quick brown fox', 180), line('jumps over the dog', 90)], 200)).toBe(
      'The quick brown fox jumps over the dog',
    );
  });

  it('keeps a break where the word WOULD have fitted — a short line was broken on purpose', () => {
    // 120 + 30 = 150 < 200: room for `jumps`, so the break was the writer's, as in an address.
    expect(paragraphText([line('14 Elm Street', 120), line('jumps over the dog', 90)], 200)).toBe(
      '14 Elm Street\njumps over the dog',
    );
  });

  it('decides line by line, so a paragraph then an address keeps only the address’s breaks', () => {
    expect(
      paragraphText(
        [line('Please send the forms to', 190), line('our office at', 65), line('14 Elm Street', 65)],
        200,
      ),
    ).toBe('Please send the forms to our office at\n14 Elm Street');
  });
});

/**
 * The editor's line grouping, cased on the shapes the measurement produced.
 *
 * ## The fixtures are the MEASURED numbers, not round ones
 *
 * `scripts/research/pdfiumLines.mjs` ran two runs on one baseline in one font
 * through PDFium and got tops of **237.9 and 238.0** — a tenth of a point
 * apart. Every case here uses figures of that shape rather than `230` and `230`,
 * because a fixture whose same-line runs are exactly equal is one an
 * equality-based grouping also passes, and equality is the version this module
 * exists instead of.
 */
const run = (index: number, text: string, bottom: number, top: number): GroupableRun => ({
  index,
  text,
  bottom,
  top,
});

/**
 * What a line says, derived the way its consumers derive it.
 *
 * A line carries its RUNS and not a concatenated string, because a run is the
 * thing `replaceTextObject` names. Every assertion about the words therefore
 * goes through this, which is also the check that the runs are in the right
 * order — a line whose runs were reordered reads wrong here.
 */
const say = (line: { readonly runs: readonly { readonly text: string }[] }): string =>
  line.runs.map((part) => part.text).join('');

/** The object indices a line covers, in the order its runs appear. */
const covers = (line: { readonly runs: readonly { readonly index: number }[] }): number[] =>
  line.runs.map((part) => part.index);

describe('grouping runs into visual lines', () => {
  it('joins runs whose extents overlap, however far apart they are horizontally', () => {
    // THE CASE THE ROW EXISTS FOR. PDFium answers one rect per run whether these
    // sit 170pt or 3pt apart — measured — so if this module did not exist a
    // "line" would be a run and line-level editing would be region replacement
    // with a different label.
    const lines = groupIntoLines([
      run(1, 'LEFT HALF ', 230.0, 237.9),
      run(2, 'RIGHT HALF', 229.9, 238.0),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines.map(say)).toStrictEqual(['LEFT HALF RIGHT HALF']);
    // THE RUNS SURVIVE, which is what the line is for: a grouping that answered
    // one joined string would pass the assertion above and leave nothing for
    // `replaceTextObject` to name.
    expect(lines.map(covers)).toStrictEqual([[1, 2]]);
  });

  it('does NOT join runs a tenth of a point apart VERTICALLY when they do not overlap', () => {
    // THE CONTROL for the case above, and it is what separates *overlap* from
    // *joins everything*. These two are as close as the pair above, on the axis
    // that decides — so a grouping that merged on proximity rather than on
    // overlap passes the first case and fails here.
    const lines = groupIntoLines([
      run(1, 'ABOVE', 238.0, 246.0),
      run(2, 'BELOW', 229.9, 237.9),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines.map(say)).toStrictEqual(['ABOVE', 'BELOW']);
  });

  it('treats runs that merely TOUCH at an edge as two lines', () => {
    // `bottom < top` strictly. Tightly set text puts one line's descender at the
    // next line's ascender, and a `<=` here would join every line of a paragraph
    // into one — offering a person a "line" that is the whole page.
    expect(groupIntoLines([run(1, 'ONE', 230, 238), run(2, 'TWO', 222, 230)])).toHaveLength(2);
  });

  it('keeps the RUNS’ order within a line rather than sorting by position', () => {
    // `textRuns` walks PDFium's text page, which IS reading order, so the runs
    // arrive ordered. A sort here would be this module holding an opinion about
    // reading order — wrong for right-to-left, and disagreeing with the text the
    // user is shown, which comes from the same walk.
    //
    // The fixture hands them in an order a positional sort would CHANGE, which
    // is what makes the assertion separate the two.
    const lines = groupIntoLines([
      run(7, 'SECOND ', 230.0, 237.9),
      run(3, 'FIRST', 229.9, 238.0),
    ]);

    expect(lines.map(covers)).toStrictEqual([[7, 3]]);
    expect(lines.map(say)).toStrictEqual(['SECOND FIRST']);
  });

  it('carries the ENGINE’S indices, and never a position in its own output', () => {
    // ADR-0049's first decision, asserted where it can be: the indices are what
    // `replaceTextObject` names, so a grouping that renumbered them 0,1,2 would
    // produce a command that edits whatever the page's first objects happen to
    // be. The fixture's indices are non-contiguous and do not start at zero for
    // exactly that reason.
    const lines = groupIntoLines([
      run(4, 'A', 230.0, 238.0),
      run(9, 'B', 230.0, 238.0),
      run(2, 'C', 100.0, 108.0),
    ]);

    expect(lines).toStrictEqual([
      {
        runs: [
          { index: 4, text: 'A' },
          { index: 9, text: 'B' },
        ],
      },
      { runs: [{ index: 2, text: 'C' }] },
    ]);
  });

  it('answers nothing for a page with no text runs', () => {
    // A page of images is a real page. An empty list is the honest answer and
    // the editor says so in words; a grouping that threw would make *this page
    // has no text* an error somebody reports.
    expect(groupIntoLines([])).toStrictEqual([]);
  });
});

/**
 * A run with a horizontal extent, for the block grouping. The style is the
 * run's own index, so a case can say which run a block took its style from.
 */
const placed = (
  index: number,
  text: string,
  left: number,
  right: number,
  bottom: number,
  top: number,
): BlockableRun<number> => ({ index, text, left, right, bottom, top, style: index });

describe('grouping lines into the blocks a person edits in place (ADR-0096)', () => {
  it('joins a paragraph’s lines into ONE block, however many lines it has', () => {
    // THE CASE THE ROW EXISTS FOR, in the owner's recording: a bulleted list
    // with a wrapped line inside it is one outline. Lines 14pt apart at 11pt
    // text leave a 3pt gap, well under a line's height.
    const blocks = groupIntoBlocks([
      placed(3, 'Help in providing care', 175, 400, 700.2, 711.1),
      placed(8, 'Offers assistance during labour', 175, 440, 686.0, 697.0),
      placed(12, 'identifies and recognize', 175, 380, 671.9, 682.9),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.lines.map(covers)).toStrictEqual([[3], [8], [12]]);
    expect(blocks[0]?.box).toStrictEqual({ x0: 175, y0: 671.9, x1: 440, y1: 711.1 });
  });

  it('CONTROL: a gap TALLER than a line starts a new block', () => {
    // What separates *a block is lines close together* from *a block is the
    // page*: the same two lines, moved apart by more than a line's height, must
    // be two outlines. A grouping that joined everything horizontally
    // overlapping passes the case above and fails here.
    const blocks = groupIntoBlocks([
      placed(3, 'WORK EXPERIENCE', 147, 336, 700, 711),
      placed(8, '09/2024 till date', 147, 428, 676, 687),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[3]], [[8]]]);
  });

  it('SPLITS one line across a gap wider than the line is tall — two columns on one baseline', () => {
    // PDFium's overlap puts both columns in one line; a block across both would
    // be edited as one string that is not on the page. The runs share a
    // baseline to the tenth, as measured runs do.
    const blocks = groupIntoBlocks([
      placed(1, 'Left column words', 72, 280, 700.0, 711.0),
      placed(2, 'Right column words', 320, 540, 699.9, 711.1),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[1]], [[2]]]);
  });

  it('CONTROL: runs a word-space apart stay ONE line of one block', () => {
    // The same line with the second run starting 3pt after the first ends — the
    // gap a space leaves. A splitter that split at every run boundary passes the
    // case above and would break a bold word off the sentence it is in.
    const blocks = groupIntoBlocks([
      placed(1, 'HEALTH CARE ASSISTANT ', 147, 395, 700.0, 711.0),
      placed(2, 'FLONEFAIR BEAUTY SPA', 398, 637, 699.9, 711.1),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[1, 2]]]);
  });

  it('keeps the ENGINE’S indices, and takes the style of the block’s FIRST run', () => {
    // Indices non-contiguous and not from zero, for ADR-0049's first decision;
    // the style identifies which run it came from.
    const blocks = groupIntoBlocks([
      placed(9, 'First line', 100, 300, 700, 711),
      placed(4, 'second line', 100, 280, 686, 697),
    ]);

    expect(blocks[0]?.style).toBe(9);
    expect(blocks[0]?.lines.map(covers)).toStrictEqual([[9], [4]]);
  });

  it('a line that comes LAST in reading order still joins its paragraph, in its place', () => {
    // THE SHAPE A WRAP LEAVES, seen in the running build: the new line is a new
    // object at the end of the content stream, so its run arrives last though it
    // sits second on the page. Grouped in reading order it joined the line above
    // and split the paragraph in two outlines.
    const blocks = groupIntoBlocks([
      placed(3, 'First line of the paragraph', 72, 400, 700, 711),
      placed(8, 'third line, moved down', 72, 380, 670, 681),
      placed(12, 'fourth line', 72, 200, 655, 666),
      placed(40, 'the wrapped words', 72, 300, 685, 696),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[3], [40], [8], [12]]]);
  });

  it('answers nothing for a page with no runs', () => {
    expect(groupIntoBlocks([])).toStrictEqual([]);
  });
});
