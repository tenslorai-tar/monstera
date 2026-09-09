import { describe, expect, it } from 'vitest';

import { type GroupableRun, groupIntoLines } from './textLines.js';

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
    // the dialog says so in words; a grouping that threw would make *this page
    // has no text* an error somebody reports.
    expect(groupIntoLines([])).toStrictEqual([]);
  });
});
