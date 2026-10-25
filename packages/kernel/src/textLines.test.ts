import { MAX_PUSHED_BLOCKS } from '@monstera/contract/host';
import { paragraphsOfLines } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  type BlockBox,
  type BlockableRun,
  type GroupableRun,
  groupIntoBlocks,
  groupIntoLines,
  pushesOf,
  pushesOfPage,
  settingOf,
  softEnds,
  withRises,
} from './textLines.js';

/** A block's words from its lines by the one rule the editor and the translation both use (ADR-0179 Decision 2). */
function paragraphText(lines: readonly { text: string; box: { x0: number; x1: number } }[], right: number): string {
  const soft = softEnds(lines, right);
  return paragraphsOfLines(lines.map((line, at) => ({ text: line.text, soft: soft[at] === true })));
}

describe('softEnds (ADR-0097 4c, ADR-0179 Decision 2)', () => {
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

  /**
   * THE OWNER'S A4 (2026-10-14): four sentences of similar length, one to a line, each too long for the next one's
   * first word to have fitted after it, were read as one paragraph, and a font change reflowed them into one. CONTROL:
   * the same widths with a line that ends mid-sentence stay a wrap, so the sentence's end is what keeps the break.
   */
  it('keeps a break after a line that ends a sentence when the next begins one', () => {
    expect(
      paragraphText(
        [line('Quarterly results came in above the plan.', 195), line('Costs held steady across every department.', 198), line('Revenue grew in all three regions.', 190)],
        200,
      ),
    ).toBe('Quarterly results came in above the plan.\nCosts held steady across every department.\nRevenue grew in all three regions.');
    expect(paragraphText([line('Quarterly results came in above the', 195), line('Plan for the year, as forecast.', 190)], 200)).toBe(
      'Quarterly results came in above the Plan for the year, as forecast.',
    );
    expect(paragraphText([line('It came in above the plan.', 195), line('and the board approved it.', 190)], 200)).toBe(
      'It came in above the plan. and the board approved it.',
    );
  });

  /**
   * A BLOCK OF CODE: its second line is indented, and was read as the first line's wrap. CONTROL: a centred
   * paragraph's shorter line starts further in by the same amount it ends further in, and is still a wrap.
   */
  it('keeps a break before an indented line, and not before a centred one', () => {
    const at = (text: string, x0: number, x1: number) => ({ text, box: { x0, x1 } });
    expect(paragraphText([at('function add(first, second, third) {', 0, 190), at('return first + second;', 20, 130)], 200)).toBe(
      'function add(first, second, third) {\nreturn first + second;',
    );
    expect(paragraphText([at('A centred heading that runs long', 0, 195), at('onto a second line', 50, 145)], 200)).toBe(
      'A centred heading that runs long onto a second line',
    );
  });

  it('never calls the last line soft: it ends nothing', () => {
    expect(softEnds([line('The quick brown fox', 180)], 200)).toStrictEqual([false]);
  });

  /**
   * COMMANDS ONE TO A LINE, in a fixed-pitch face (cloud run 19, measured on four Courier lines read by PDFium): the
   * widest ends the block's right edge, the next begins with `#`, and nothing else keeps the break. CONTROL: the same
   * lines and widths not marked fixed-pitch still read as a wrap, so the face is what keeps it.
   */
  it('keeps a break between two lines set in a fixed-pitch face', () => {
    const command = 'git clone https://github.com/explodinggradients/ragas.git';
    const comment = '# 2. Install uv (if not already installed)';
    const code = (text: string, fixedPitch: boolean) => ({ text, box: { x0: 0, x1: text.length * 5 }, fixedPitch });
    const right = command.length * 5;
    expect(softEnds([code(command, true), code(comment, true)], right)).toStrictEqual([false, false]);
    expect(softEnds([code(command, false), code(comment, false)], right)).toStrictEqual([true, false]);
  });

  /**
   * TWO ENTRIES OF A BULLETED LIST (cloud run 19, measured): the first reached the block's right edge and read as wrapping
   * into the second. CONTROL: the same second line without its bullet is a wrap, so the bullet is what keeps the break;
   * and a numbered entry and a lettered one keep theirs the same way.
   */
  it('keeps a break before a line that begins a list entry', () => {
    const first = line('• Retrieval quality – measured on the held out set', 195);
    expect(softEnds([first, line('• Answer accuracy – scored by two readers', 180)], 200)).toStrictEqual([false, false]);
    expect(softEnds([first, line('answer accuracy – scored by two readers', 180)], 200)).toStrictEqual([true, false]);
    expect(softEnds([first, line('2. Answer accuracy', 90)], 200)).toStrictEqual([false, false]);
    expect(softEnds([first, line('b) answer accuracy', 90)], 200)).toStrictEqual([false, false]);
  });
});

describe('a block carries its soft ends and its shape (ADR-0179)', () => {
  const style = { font: 'f', bold: false, italic: false, size: 10, colour: { r: 0, g: 0, b: 0 } };
  const long = (index: number, text: string, bottom: number, top: number, right: number): BlockableRun<string> => ({
    index,
    text,
    bottom,
    top,
    left: 72,
    right,
    style: 'body',
    setting: settingOf(style),
    size: style.size,
  });

  it('answers soft on the lines that wrapped and not on the last, and a left shape for a ragged paragraph', () => {
    const blocks = groupIntoBlocks([
      long(0, 'The quick brown fox jumps over', 700, 710, 280),
      long(1, 'the lazy dog and then it runs', 688, 698, 270),
      long(2, 'away', 676, 686, 100),
    ]);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block?.lines.map((line) => line.soft)).toStrictEqual([true, true, false]);
    expect(block?.shape).toStrictEqual({ align: 'left', firstIndent: 0 });
  });

  it('CONTROL: lines broken where the next word WOULD have fitted are not soft', () => {
    const [block] = groupIntoBlocks([
      long(0, 'Ada Lovelace', 700, 710, 140),
      long(1, 'England', 688, 698, 120),
      long(2, 'London SW1A 1AA', 676, 686, 200),
    ]);
    expect(block?.lines.map((line) => line.soft)).toStrictEqual([false, false, false]);
  });

  it('carries a run’s fixed pitch to the soft ends: the wrapped paragraph above, set fixed-pitch, keeps every break', () => {
    const fixed = (run: BlockableRun<string>): BlockableRun<string> => ({ ...run, fixedPitch: true });
    const [block] = groupIntoBlocks([
      fixed(long(0, 'The quick brown fox jumps over', 700, 710, 280)),
      fixed(long(1, 'the lazy dog and then it runs', 688, 698, 270)),
      fixed(long(2, 'away', 676, 686, 100)),
    ]);
    expect(block?.lines.map((line) => line.soft)).toStrictEqual([false, false, false]);
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
 * run's own index, so a case can say which run a block took its style from;
 * every run is set alike unless a case says otherwise.
 */
const placed = (
  index: number,
  text: string,
  left: number,
  right: number,
  bottom: number,
  top: number,
  setting = 'Body|11.00|0,0,0',
  size = 11,
): BlockableRun<number> => ({ index, text, left, right, bottom, top, style: index, setting, size });

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

  it('SPLITS two columns whose baselines are OFFSET, though their combined line is taller than the gutter', () => {
    // The shape measured in the owner's document 11 (2026-10-24): 12 pt lines 11.03 pt tall, baselines 3.81 pt apart, a
    // 13.71 pt gutter. Their union is 14.84 pt tall, so a gap measured against the LINE joined the two columns.
    const blocks = groupIntoBlocks([
      placed(1, 'Left column words', 72, 300, 295.0, 306.03, 'Body|12.00|0,0,0', 12),
      placed(2, 'Right column words', 313.71, 540, 298.81, 309.84, 'Body|12.00|0,0,0', 12),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[1]], [[2]]]);
  });

  it('SPLITS a large figure from the smaller words beside it, though the figure makes the line taller than the gap', () => {
    // The owner's document 11, page 1: a 40 pt figure 14.29 pt from an 11.5 pt list. The figure alone makes the line
    // over 30 pt tall, so a gap measured against the line joined the figure to the list.
    const blocks = groupIntoBlocks([
      placed(1, '34', 72, 130, 280, 310, 'Figure|40.00|0,0,0', 40),
      placed(2, 'A list of names', 144.29, 400, 298, 306.5, 'Body|11.50|0,0,0', 11.5),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[1]], [[2]]]);
  });

  it('CONTROL: what is under an em of the smaller type stays one line — a raised mark, a wide justified space, a big word', () => {
    // A rule that split on an offset or on a change of size passes the cases above and breaks these. A reference mark
    // raised 4 pt in 7 pt type beside its word; a space stretched to 0.94 em, the widest the corpus joins; and a 40 pt
    // word a word space from smaller words.
    const marked = groupIntoBlocks([
      placed(1, 'A sentence with a mark', 72, 300, 295.0, 306.03),
      placed(2, '12', 300.5, 307, 299.0, 306.5, 'Body|7.00|0,0,0', 7),
    ]);
    const justified = groupIntoBlocks([
      placed(1, 'Stretched', 72, 200, 295, 306),
      placed(2, 'words', 200 + 0.94 * 11, 300, 295, 306),
    ]);
    const large = groupIntoBlocks([
      placed(1, 'BIG', 72, 160, 280, 310, 'Figure|40.00|0,0,0', 40),
      placed(2, 'small words', 163, 400, 298, 306.5),
    ]);

    expect(marked.map((block) => block.lines.map(covers))).toStrictEqual([[[1, 2]]]);
    expect(justified.map((block) => block.lines.map(covers))).toStrictEqual([[[1, 2]]]);
    expect(large.map((block) => block.lines[0]?.runs.length)).toStrictEqual([2]);
  });

  describe('a justified line’s wide spaces (ADR-0096’s correction of 2026-10-25)', () => {
    // A JUSTIFIED PARAGRAPH SET ONE WORD TO A RUN, as document 4 page 4 is: 11 pt lines 3 pt apart, the middle line's
    // spaces stretched to 1.2 em, the lines above and below set tighter.
    const above = [placed(1, 'Words', 72, 150, 300, 311), placed(2, 'set', 155, 230, 300, 311), placed(3, 'above', 235, 350, 300, 311)];
    const middle = [
      placed(4, 'Stretched', 72, 120, 286, 297),
      placed(5, 'words', 133.2, 180, 286, 297),
      placed(6, 'wide', 193.2, 240, 286, 297),
      placed(7, 'apart', 253.4, 350, 286, 297),
    ];
    const below = [placed(8, 'Words', 72, 140, 272, 283), placed(9, 'set', 145, 260, 272, 283), placed(10, 'below', 265, 350, 272, 283)];

    it('JOINS a justified line whose spaces are past an em: its spaces match, and words beside span them', () => {
      expect(groupIntoBlocks([...above, ...middle, ...below]).map((block) => block.lines.map(covers))).toStrictEqual([
        [[1, 2, 3], [4, 5, 6, 7], [8, 9, 10]],
      ]);
      // CONTROL: the same line with no line beside it splits at each space, as the em rule alone splits it.
      expect(groupIntoBlocks(middle)).toHaveLength(4);
    });

    it('CONTROL: a line with ONE wide gap stays split, though a word beside spans it — nothing shows it was justified', () => {
      const blocks = groupIntoBlocks([
        placed(1, 'One long word above', 72, 350, 300, 311),
        placed(2, 'Left', 72, 150, 286, 297),
        placed(3, 'Right', 163.2, 350, 286, 297),
      ]);
      expect(blocks.flatMap((block) => block.lines.map(covers))).toContainEqual([2]);
    });

    it('CONTROL: columns stay split where a line beside STARTS a column after the gap, though a run above bridges it', () => {
      // A three-column list whose gutters are equal by chance (document 4 page 6), with a run above reaching across both
      // gutters: the line below starts each column where the middle line's next run does.
      const blocks = groupIntoBlocks([
        placed(1, 'A long entry', 72, 170, 300, 311),
        placed(2, 'reaching over', 180, 270, 300, 311),
        placed(3, 'First', 72, 150, 286, 297),
        placed(4, 'Second', 163.2, 250, 286, 297),
        placed(5, 'Third', 263.2, 350, 286, 297),
        placed(6, 'Under', 72, 140, 272, 283),
        placed(7, 'the', 163.2, 230, 272, 283),
        placed(8, 'columns', 263.2, 320, 272, 283),
      ]);
      const middleLine = blocks.flatMap((block) => block.lines.map(covers)).filter((line) => line.some((index) => index >= 3 && index <= 5));
      expect(middleLine).toStrictEqual([[3], [4], [5]]);
    });

    it('CONTROL: table cells stay split where the words below reach PAST each gap’s middle but not across it', () => {
      // Document 5's table: cells whose padding makes the gaps equal, and a cell below ending 0.9 pt past a gap's middle.
      const blocks = groupIntoBlocks([
        placed(1, 'Cell one', 72, 150, 286, 297),
        placed(2, 'Cell two', 163.2, 250, 286, 297),
        placed(3, 'Cell three', 263.2, 350, 286, 297),
        placed(4, 'A wider cell', 100, 157.5, 272, 283),
        placed(5, 'and another', 200, 257.5, 272, 283),
      ]);
      const cells = blocks.flatMap((block) => block.lines.map(covers)).filter((line) => line.some((index) => index <= 3));
      expect(cells).toStrictEqual([[1], [2], [3]]);
    });
  });

  it('REFUSES a run with no size, which would otherwise join every gap', () => {
    // A script building runs by hand with `{ ...run, setting }` leaves `size` out; compared, it joins the columns above.
    const sizeless = { ...placed(2, 'Right column words', 320, 540, 699.9, 711.1), size: undefined as unknown as number };
    expect(() => groupIntoBlocks([placed(1, 'Left column words', 72, 280, 700.0, 711.0), sizeless])).toThrow(TypeError);
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

  it('keeps the ENGINE’S indices, and takes the style of the block’s first line', () => {
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

/**
 * The owner's page of 2026-10-02, from the numbers measured there (the document is not copied): a Roboto-Bold heading
 * drawn at 13.03 pt in 66, 83, 149, and under it thirteen list lines drawn at 9.198 pt in 64, 64, 64 — each a
 * Nunito-Bold lead word and a Nunito-Regular rest — with the heading 7.99 pt above a list line 8.47 pt tall.
 */
interface Set {
  readonly size: number;
  readonly colour: { readonly r: number; readonly g: number; readonly b: number };
  readonly bold: boolean;
}
/** A run's setting with what `settingOf` reads beside it: the font's name and whether it is italic. */
type Named = Set & { readonly font: string; readonly italic: boolean };
const HEADING: Named = { font: 'Roboto-Bold', size: 13.032, colour: { r: 66, g: 83, b: 149 }, bold: true, italic: false };
const LEAD: Named = { font: 'Nunito-Bold', size: 9.198, colour: { r: 64, g: 64, b: 64 }, bold: true, italic: false };
const REST: Named = { font: 'Nunito-Regular', size: 9.198, colour: { r: 64, g: 64, b: 64 }, bold: false, italic: false };

function headingOverList(setting: (style: Named) => string): BlockableRun<Set>[] {
  const run = (index: number, text: string, left: number, right: number, bottom: number, top: number, style: Named) => ({
    index,
    text,
    left,
    right,
    bottom,
    top,
    style: { size: style.size, colour: style.colour, bold: style.bold },
    setting: setting(style),
    size: style.size,
  });
  const runs = [run(0, 'What we offer', 2, 160, 685, 700, HEADING)];
  // THE GAP THE OWNER MEASURED: 7.99 pt from the heading to a line 8.47 pt tall — under the line's height.
  let top = 685 - 7.99;
  for (let line = 0; line < 13; line += 1) {
    runs.push(run(1 + line * 2, 'Lead', 16, 40, top - 8.47, top, LEAD));
    runs.push(run(2 + line * 2, 'words that follow the lead word', 42, 240, top - 8.47, top, REST));
    top -= 12.3;
  }
  return runs;
}

describe('a block does not continue across a change of SETTING (N4, the owner’s Part A)', () => {
  it('a heading set tight over list lines is its OWN block, and each block opens in its own size and colour', () => {
    const blocks = groupIntoBlocks(headingOverList(settingOf));

    expect(blocks.map((block) => block.lines.length)).toStrictEqual([1, 13]);
    expect(blocks[0]?.style).toStrictEqual({ size: 13.032, colour: { r: 66, g: 83, b: 149 }, bold: true });
    // THE LIST IS SET IN ITS RUNS' OWN FACE: the rest of each line, not the bold lead word that begins it.
    expect(blocks[1]?.style).toStrictEqual({ size: 9.198, colour: { r: 64, g: 64, b: 64 }, bold: false });
  });

  it('and EACH RUN keeps its own style inside its block — the lead word bold, the rest regular (ADR-0145)', () => {
    const [, list] = groupIntoBlocks(headingOverList(settingOf));

    expect(list?.lines[0]?.runs.map((run) => [run.text, run.style.bold, run.style.size])).toStrictEqual([
      ['Lead', true, 9.198],
      ['words that follow the lead word', false, 9.198],
    ]);
  });

  it('CONTROL: grouped by the gap alone, the same page is ONE block in the heading’s style — 1.42 times too large', () => {
    // EVERY RUN SET ALIKE is the rule before this one, which read no setting at all: the block the owner measured.
    const blocks = groupIntoBlocks(headingOverList(() => 'one'));

    expect(blocks.map((block) => block.lines.length)).toStrictEqual([14]);
    expect(blocks[0]?.style.bold).toBe(true);
    expect(blocks[0]?.style.colour).toStrictEqual({ r: 66, g: 83, b: 149 });
    expect((blocks[0]?.style.size ?? 0) / REST.size).toBeCloseTo(1.42, 2);
  });

  it('a WORD set apart inside a paragraph’s line does not break the paragraph — its longest run decides', () => {
    // An ordinary document: a bold word in the middle of a line, and a line that BEGINS with an italic word.
    const body = 'Body|11.00|0,0,0';
    const blocks = groupIntoBlocks([
      placed(1, 'The first line of a paragraph with a ', 72, 260, 700, 711, body),
      placed(2, 'bold', 262, 285, 700, 711, 'Body-Bold|11.00|0,0,0'),
      placed(3, ' word in it,', 287, 340, 700, 711, body),
      placed(4, 'Italics', 72, 110, 686, 697, 'Body-Italic|11.00|0,0,0'),
      placed(5, ' begin the second line of the same paragraph', 112, 380, 686, 697, body),
    ]);

    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[1, 2, 3], [4, 5]]]);
  });

  it('settingOf keys the font, the size to a hundredth and the fill — and nothing else', () => {
    expect(settingOf(HEADING)).toBe('Roboto-Bold|13.03|66,83,149');
    expect(settingOf({ ...REST, size: 9.1984 })).toBe(settingOf(REST));
    expect(settingOf({ ...REST, colour: { r: 64, g: 64, b: 65 } })).not.toBe(settingOf(REST));
    expect(settingOf({ ...REST, font: 'Nunito-Bold' })).not.toBe(settingOf(REST));
  });
});

/**
 * The brochure's heading (ADR-0096's correction of 2026-10-25, measured): set in the standard Helvetica PDFium reads as
 * `LiberationSans`, its longer words written by an edit partly in the bundled Arimo that stands in for it, `QQKGUW+Arimo-
 * Regular-wght400`, 26 pt in one green. Its two lines read back as two blocks, and a colour change reached one.
 */
describe('a block continues across look-alike faces: a change of font is a change of the face a person sees', () => {
  const green = { r: 26, g: 89, b: 64 };
  const heading = (font: string, bold = false, italic = false): Named => ({ font, size: 26, colour: green, bold, italic });

  it('the page’s face and the stand-in written beside it are one setting, and its two lines one block', () => {
    expect(settingOf(heading('QQKGUW+Arimo-Regular-wght400'))).toBe(settingOf(heading('LiberationSans')));
    const blocks = groupIntoBlocks([
      placed(0, 'Summer at the', 53.17, 221.37, 759.77, 779.14, settingOf(heading('QQKGUW+Arimo-Regular-wght400')), 26),
      placed(1, 'garden', 53.09, 131.25, 723.42, 747.94, settingOf(heading('LiberationSans')), 26),
    ]);
    expect(blocks.map((block) => block.lines.map(covers))).toStrictEqual([[[0], [1]]]);
    // CONTROL: the same two lines keyed by the font's name are the two blocks measured.
    const byName = groupIntoBlocks([
      placed(0, 'Summer at the', 53.17, 221.37, 759.77, 779.14, 'QQKGUW+Arimo-Regular-wght400', 26),
      placed(1, 'garden', 53.09, 131.25, 723.42, 747.94, 'LiberationSans', 26),
    ]);
    expect(byName.map((block) => block.lines.map(covers))).toStrictEqual([[[0]], [[1]]]);
  });

  it('two subsets of one font are one face, whatever their tags; Helvetica, Arial and Arimo are one', () => {
    expect(settingOf(heading('ABCDEF+Roboto-Regular'))).toBe(settingOf(heading('GHIJKL+Roboto-Regular')));
    expect(settingOf(heading('Helvetica'))).toBe(settingOf(heading('ArialMT')));
    expect(settingOf(heading('Calibri', true))).toBe(settingOf(heading('XYZABC+Carlito-Bold-wght700', true)));
  });

  it('CONTROL: bold, italic, and faces the table does not pair still change the setting', () => {
    expect(settingOf(heading('LiberationSans', true))).not.toBe(settingOf(heading('LiberationSans')));
    expect(settingOf(heading('Arimo', false, true))).not.toBe(settingOf(heading('Arimo')));
    expect(settingOf(heading('Roboto-Light'))).not.toBe(settingOf(heading('Roboto-Regular')));
    expect(settingOf(heading('Arimo'))).not.toBe(settingOf(heading('Tinos')));
    // AND BY NAME, the rule before this one: the measured heading's two fonts are two keys.
    const byName = (style: Named): string => `${style.font}|${style.size.toFixed(2)}`;
    expect(byName(heading('QQKGUW+Arimo-Regular-wght400'))).not.toBe(byName(heading('LiberationSans')));
  });
});

/**
 * A run's rise from its line (the owner's N14): the page's baseline becomes the offset from the line's FIRST run's
 * baseline (`lineBaselineOf`), the rule the writer lays a block's lines out by — so a superscript is drawn raised while
 * the block is open, as it is written. CONTROL: the line's own runs rise by nothing, and a line whose first run is the
 * raised one measures the others as lowered, which is the rule's answer and the writer's.
 */
describe('withRises', () => {
  const at = (index: number, text: string, left: number, right: number, baseline: number): BlockableRun<{ baseline: number }> => ({
    index,
    text,
    left,
    right,
    bottom: baseline - 2,
    top: baseline + 8,
    style: { baseline },
    setting: 'Body|11.00|0,0,0',
    size: 11,
  });

  it('gives each run its offset from its line’s first run, and the block a style with no baseline', () => {
    const blocks = withRises(
      groupIntoBlocks([at(0, 'Results.', 72, 120, 700), at(1, ' The method', 120, 200, 700), at(2, '12', 200, 206, 703.96), at(3, ' tested.', 206, 250, 700)]),
      (_style, rise) => ({ rise: Math.round(rise * 100) / 100 }),
      () => ({ rise: Number.NaN }),
    );
    expect(blocks[0]?.lines[0]?.runs.map((run) => run.style.rise)).toStrictEqual([0, 0, 3.96, 0]);
    expect(Number.isNaN(blocks[0]?.style.rise)).toBe(true);
    const raisedFirst = withRises(
      groupIntoBlocks([at(0, '1', 72, 78, 703.96), at(1, ' Note', 78, 120, 700)]),
      (_style, rise) => Math.round(rise * 100) / 100,
      () => 0,
    );
    expect(raisedFirst[0]?.lines[0]?.runs.map((run) => run.style)).toStrictEqual([0, -3.96]);
  });

  /**
   * THE LINE'S BASELINE crosses with it (the owner's A5 and A7), by the writer's rule: its first run's. CONTROL: a line
   * whose first run is a raised marker takes the marker's, which is the rule's answer and not the lowest run's.
   */
  it('gives each line its baseline, its first run’s', () => {
    const two = withRises(
      groupIntoBlocks([at(0, 'First line', 72, 200, 700), at(1, 'Second line', 72, 200, 686)]),
      () => 0,
      () => 0,
    );
    expect(two[0]?.lines.map((line) => line.baseline)).toStrictEqual([700, 686]);
    const raised = withRises(groupIntoBlocks([at(0, '1', 72, 78, 703.96), at(1, ' Note', 78, 120, 700)]), () => 0, () => 0);
    expect(raised[0]?.lines[0]?.baseline).toBe(703.96);
  });
});

describe('pushesOfPage: nothing is pushed where the read cannot answer it', () => {
  const PAGE = { x0: 0, y0: 0, x1: 612, y1: 792 };
  const heading = { x0: 72, y0: 690, x1: 540, y1: 720 };
  const body = { x0: 72, y0: 100, x1: 540, y1: 680 };

  it('a page read in part pushes nothing, for any block', () => {
    expect(pushesOfPage([heading, body], { box: PAGE, truncated: true })).toStrictEqual([
      { below: [], room: 0 },
      { below: [], room: 0 },
    ]);
  });

  it('nor does a page with no box', () => {
    expect(pushesOfPage([heading, body], { box: null, truncated: false })).toStrictEqual([
      { below: [], room: 0 },
      { below: [], room: 0 },
    ]);
  });

  it('CONTROL: the same page read whole pushes the body below the heading', () => {
    expect(pushesOfPage([heading, body], { box: PAGE, truncated: false })[0]?.below).toStrictEqual([1]);
  });
});

describe('pushesOf (ADR-0249 Decision 2)', () => {
  /** A Letter page, and a block by its left, bottom, right and top. */
  const PAGE = { x0: 0, y0: 0, x1: 612, y1: 792 };
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  // THE PAGE'S TOP MARGIN IS 72 (its highest text's top is 720), so its bottom margin ends at 72 and a block wholly under
  // that is the footer.
  const heading = box(72, 690, 540, 720);
  const paragraph = box(72, 600, 540, 680);
  const smallPrint = box(72, 560, 540, 590);
  const footer = box(280, 40, 330, 52);

  it('pushes the text below a block in its column, and the room runs to the footer’s top', () => {
    const pushes = pushesOf([heading, paragraph, smallPrint, footer], PAGE);
    expect(pushes[1]).toStrictEqual({ below: [2], room: 560 - 52 });
    expect(pushes[0]).toStrictEqual({ below: [1, 2], room: 560 - 52 });
  });

  it('CONTROL: a block in the second column does not move, and neither does the footer', () => {
    const left = box(72, 600, 290, 680);
    const right = box(320, 500, 540, 590);
    const underLeft = box(72, 500, 290, 590);
    const pushes = pushesOf([heading, left, right, underLeft, footer], PAGE);
    // THE RIGHT COLUMN IS NOT BELOW THE LEFT: they do not overlap horizontally. The footer is in no block's push.
    expect(pushes[1]?.below).toStrictEqual([3]);
    expect(pushes.flatMap((push) => push.below)).not.toContain(4);
    expect(pushes[4]).toStrictEqual({ below: [], room: 0 });
  });

  it('closes the column: text below a pushed block is pushed too, so moved text never lands on text that stayed', () => {
    // THE CAPTION overlaps the small print and not the narrow paragraph; pushed with the small print, it is pushed too.
    const narrow = box(72, 600, 200, 680);
    const wide = box(72, 560, 540, 590);
    const caption = box(400, 500, 540, 540);
    const pushes = pushesOf([heading, narrow, wide, caption, footer], PAGE);
    expect(pushes[1]?.below).toStrictEqual([2, 3]);
    expect(pushes[1]?.room).toBe(500 - 52);
  });

  it('with no footer, the room runs to the mirrored bottom margin', () => {
    const pushes = pushesOf([heading, paragraph, smallPrint], PAGE);
    expect(pushes[1]?.room).toBe(560 - 72);
  });

  it('a page with no room left has room 0, and a block with nothing below pushes nothing', () => {
    const lowest = box(72, 60, 540, 100);
    const pushes = pushesOf([heading, paragraph, lowest], PAGE);
    // THE LOWEST TEXT ALREADY REACHES THE MARGIN (72) from above it, so there is no room: 60 is under 72.
    expect(pushes[1]).toStrictEqual({ below: [2], room: 0 });
    expect(pushes[2]).toStrictEqual({ below: [], room: 0 });
  });

  describe('the one sweep answers the worklist it replaced, on every page shape', () => {
    type Box = BlockBox;
    /** THE WORKLIST `pushesOf` ran until 2026-10-18, verbatim but for its name: the closure by definition, cubic. */
    function worklistBelow(boxes: readonly Box[], page: Box): number[][] {
      const highest = Math.max(...boxes.map((b) => b.y1));
      const margin = page.y0 + Math.max(0, page.y1 - highest);
      const footer = boxes.map((b) => b.y1 <= margin);
      const sideBySide = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1;
      return boxes.map((b, at) => {
        if (footer[at] === true) return [];
        const pushed = new Set<number>();
        const reached: Box[] = [b];
        for (const above of reached) {
          for (const [other, candidate] of boxes.entries()) {
            if (other === at || pushed.has(other) || footer[other] === true) continue;
            if (sideBySide(candidate, above) && candidate.y1 < above.y1) {
              pushed.add(other);
              reached.push(candidate);
            }
          }
        }
        return [...pushed].sort((x, y) => x - y);
      });
    }
    /** A seeded generator, so a failing page is the same page on the next run. */
    function generator(seed: number): () => number {
      let state = seed;
      return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 2 ** 32;
      };
    }
    /**
     * Pages built to reach the sweep's edges: tops on a coarse grid, so rows of EQUAL tops are common; edges on a grid,
     * so extents that only TOUCH are common; some blocks zero wide; some inside the bottom margin, the footer.
     */
    function pageOf(random: () => number, count: number): Box[] {
      return Array.from({ length: count }, () => {
        const x0 = Math.floor(random() * 12) * 50;
        const wide = random() < 0.1 ? 0 : (1 + Math.floor(random() * 4)) * 50;
        const y1 = 20 + Math.floor(random() * 30) * 25;
        return box(x0, y1 - 10, x0 + wide, y1);
      });
    }

    it('on 400 seeded pages of up to 60 blocks, every block pushes the same blocks', () => {
      const random = generator(20_261_018);
      let compared = 0;
      let pushing = 0;
      for (let page = 0; page < 400; page += 1) {
        const boxes = pageOf(random, 1 + Math.floor(random() * 60));
        const expected = worklistBelow(boxes, PAGE);
        expect(pushesOf(boxes, PAGE).map((column) => [...column.below]), `page ${String(page)}`).toStrictEqual(expected);
        compared += boxes.length;
        pushing += expected.filter((below) => below.length > 1).length;
      }
      // THE PAGES REACH WHAT THEY ARE FOR: thousands of blocks, and many pushing more than one block, so the closure, not
      // only the first step, is what was compared.
      expect(compared).toBeGreaterThan(10_000);
      expect(pushing).toBeGreaterThan(2_000);
    });

    it('CONTROL: a row of equal tops does not reach along itself, which a sweep widening per block would', () => {
      // THE ONE PLACE the sweep could disagree with the worklist where a page shape decides it: a block widening the
      // interval for the next block of its OWN top. A is under the top block; B, at A's top, overlaps A only; C, lower,
      // overlaps B only. The worklist reaches neither B (not lower than A) nor so C.
      const boxes = [box(0, 700, 100, 720), box(50, 480, 150, 500), box(140, 480, 250, 500), box(200, 280, 250, 300)];
      expect(worklistBelow(boxes, PAGE)[0]).toStrictEqual([1]);
      expect(pushesOf(boxes, PAGE).map((column) => [...column.below])).toStrictEqual(worklistBelow(boxes, PAGE));
    });
  });

  it('a column with more blocks below than one edit may carry has no room, so the editor warns rather than send it', () => {
    // ONE A POINT HIGH, stacked under the paragraph: MAX_PUSHED_BLOCKS of them is carried, one more is not.
    const stack = (count: number) => Array.from({ length: count }, (_, at) => box(72, 590 - at - 0.5, 540, 590 - at));
    const carried = pushesOf([heading, paragraph, ...stack(MAX_PUSHED_BLOCKS)], PAGE)[1];
    const over = pushesOf([heading, paragraph, ...stack(MAX_PUSHED_BLOCKS + 1)], PAGE)[1];
    expect(carried?.below).toHaveLength(MAX_PUSHED_BLOCKS);
    expect(carried?.room).toBeGreaterThan(0);
    expect(over?.below).toHaveLength(MAX_PUSHED_BLOCKS + 1);
    expect(over?.room).toBe(0);
  });
});
