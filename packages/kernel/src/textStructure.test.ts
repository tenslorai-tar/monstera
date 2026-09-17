import { describe, expect, it } from 'vitest';

import { scoreAgainstTruth } from './textAccuracy.js';
import {
  PAGE_TEXT_READS,
  SEGMENTATION_RAW_ROLE,
  STEXT_OPTION_STRING,
  STEXT_OPTIONS,
  linesOf,
  parsePageStructure,
  parsePageTables,
  parsePageText,
  plainTextOf,
  stextOptionsFor,
} from './textStructure.js';

/**
 * MuPDF's JSON for the two-column fixture, as `SEGMENT` returns it.
 *
 * **Shortened from a real reading, never invented.** The nesting is the shape
 * measured on 2026-09-02 through `mz_stext_json`: text blocks live under
 * `{"type":"structure","contents":[…]}` and the column-major order is the order
 * of that tree. A hand-imagined flat payload would have made every case here
 * pass against a parser that cannot read the shape MuPDF actually sends, which
 * is the defect the spike's first summariser had.
 */
function segmentedTwoColumn(): string {
  const line = (text: string, x: number, y: number) => ({
    wmode: 0,
    bbox: { x, y: y - 13, w: 22, h: 16 },
    font: { name: 'Helvetica', size: 12 },
    x,
    y,
    text,
  });
  const textBlock = (text: string, x: number, y: number) => ({
    type: 'text',
    bbox: { x, y: y - 13, w: 22, h: 16 },
    lines: [line(text, x, y)],
  });

  return JSON.stringify({
    blocks: [
      {
        type: 'structure',
        raw: 'Split',
        std: 'Div',
        contents: [
          { type: 'structure', raw: 'Split', std: 'Div', contents: [textBlock('left0', 72, 92), textBlock('left1', 72, 116)] },
          { type: 'structure', raw: 'Split', std: 'Div', contents: [textBlock('right0', 340, 92), textBlock('right1', 340, 116)] },
        ],
      },
    ],
  });
}

/** The same page as MuPDF returns it with NO options: flat, and row-major. */
function unsegmentedTwoColumn(): string {
  const textBlock = (text: string, x: number, y: number) => ({
    type: 'text',
    bbox: { x, y: y - 13, w: 22, h: 16 },
    lines: [{ wmode: 0, bbox: { x, y: y - 13, w: 22, h: 16 }, font: { size: 12 }, x, y, text }],
  });
  return JSON.stringify({
    blocks: [
      textBlock('left0', 72, 92),
      textBlock('right0', 340, 92),
      textBlock('left1', 72, 116),
      textBlock('right1', 340, 116),
    ],
  });
}

/** The reading order a person wants: a column at a time. */
const TRUTH = ['left0', 'left1', 'right0', 'right1'];

describe('the stext options', () => {
  it('asks for SEGMENT and leaves TABLE_HUNT out of what it asks for', () => {
    // THE POINT OF THE MODULE, asserted rather than assumed. ADR-0034 measured
    // TABLE_HUNT splitting a prose line in two and undoing SEGMENT's ordering,
    // and 2026-09-10 measured it against real documents — two of the six corpus
    // documents carrying text move, at −1.5 and −17.5 points of line agreement,
    // and none improves (ADR-0013's correction). So it is declared — a consumer
    // may opt in — and not asked for.
    //
    // SPLIT ON THE SEPARATOR rather than matched as a substring: `table-hunt`
    // contains no option name, but a future option whose name is a prefix of
    // another would make `includes` answer yes for an option nobody asked for.
    const asked = STEXT_OPTION_STRING.split(',');
    expect(asked).toContain(STEXT_OPTIONS.segment);
    expect(asked).not.toContain(STEXT_OPTIONS.tableHunt);
  });

  it('CONTROL: the two options are different names, so the case above can fail', () => {
    // Without this, both assertions pass for any option string if the two
    // constants happened to be equal — the case would be checking one thing
    // twice and reporting it as two.
    expect(STEXT_OPTIONS.segment).not.toBe(STEXT_OPTIONS.tableHunt);
  });

  it('spells the names MuPDFs own parser accepts, not names invented here', () => {
    // `fz_parse_stext_options` matches these literally. This comment said an
    // unknown option is IGNORED rather than refused; measured 2026-09-14 on
    // MuPDF 1.28.0 (ADR-0013's correction of that date), an unknown option
    // THROWS. So a misspelling fails at the first read — and a name misspelt INTO
    // another valid option would not, which is why the spelling is still asserted
    // rather than trusted.
    expect(STEXT_OPTIONS.segment).toBe('segment');
    expect(STEXT_OPTIONS.tableHunt).toBe('table-hunt');
    expect(STEXT_OPTIONS.structured).toBe('structured');
    expect(STEXT_OPTIONS.vectors).toBe('vectors');
    expect(STEXT_OPTIONS.accurateBboxes).toBe('accurate-bboxes');
  });

  it('keeps `structured` OUT of the shared read (ADR-0065)', () => {
    // Measured 2026-09-14: under it every one of the corpus's 12 tagged pages
    // carrying text gives a different line sequence from the shared read. Search,
    // the text layer, word count and spell check asked for none of that.
    expect(STEXT_OPTION_STRING.split(',')).not.toContain(STEXT_OPTIONS.structured);
  });
});

describe('the named reads', () => {
  it('the substrate read is the shared option string, exactly', () => {
    expect(stextOptionsFor('substrate')).toBe(STEXT_OPTION_STRING);
  });

  it('the structure read is the shared set PLUS `structured`, and nothing else', () => {
    // AS SETS, both directions: a read that dropped `preserve-images` would
    // contain `structured` and pass a one-way check, and on a page tagged only as
    // a Figure it would report nothing on the page.
    const shared = STEXT_OPTION_STRING.split(',');
    const structure = stextOptionsFor('structure').split(',');
    expect(structure.filter((name) => !shared.includes(name))).toStrictEqual([
      STEXT_OPTIONS.structured,
    ]);
    expect(shared.filter((name) => !structure.includes(name))).toStrictEqual([]);
  });

  it('the table read is the shared set PLUS the CSV writer’s three, and nothing else (ADR-0073)', () => {
    // AS SETS, both directions, for the structure case's reason. `vectors` is the
    // member that decides it: without it every generated grid came back two
    // columns wide, measured 2026-09-17.
    const shared = STEXT_OPTION_STRING.split(',');
    const table = stextOptionsFor('table').split(',');
    expect(table.filter((name) => !shared.includes(name)).sort()).toStrictEqual(
      [STEXT_OPTIONS.vectors, STEXT_OPTIONS.accurateBboxes, STEXT_OPTIONS.tableHunt].sort(),
    );
    expect(shared.filter((name) => !table.includes(name))).toStrictEqual([]);
  });

  it('keeps the table read’s options OUT of the shared read', () => {
    const shared = STEXT_OPTION_STRING.split(',');
    expect(shared).not.toContain(STEXT_OPTIONS.vectors);
    expect(shared).not.toContain(STEXT_OPTIONS.accurateBboxes);
  });

  it('names exactly the three reads, so a fourth is a visible change to this line', () => {
    expect(PAGE_TEXT_READS).toStrictEqual(['substrate', 'structure', 'table']);
  });
});

/**
 * A ruled three-by-two grid as the table read returns it.
 *
 * **Shortened from a real reading**: the keys, the nesting — a `Table` holding its
 * `grid` block and `TR` elements, a `TD` holding a segmentation block around its
 * text — and the flags are MuPDF 1.28.0's for a generated ruled grid, read
 * 2026-09-17. 28 is full plus top and left border, 4 a left border alone on the
 * right-hand edge, 8 a top border alone along the bottom. **Two edges are left
 * unruled on purpose** — the first row's right and the second row's first bottom —
 * so a cell's far edges read from its own point, the wrong one, differ from the
 * right answer.
 */
function tablePage(options: { readonly spanned?: boolean } = {}): string {
  const text = (words: string, x: number) => ({
    type: 'text',
    bbox: { x, y: 83, w: 21, h: 8 },
    lines: [
      {
        wmode: 0,
        bbox: { x, y: 83, w: 21, h: 8 },
        font: { name: 'Helvetica-Bold', family: 'sans-serif', weight: 'bold', style: 'normal', size: 11 },
        x,
        y: 91,
        text: words,
      },
    ],
  });
  const cell = (words: string, x: number) => ({
    type: 'structure',
    raw: 'TD',
    std: 'TD',
    contents: [{ type: 'structure', raw: 'Split', std: 'Div', contents: [text(words, x)] }],
  });
  const secondRow = options.spanned === true ? [cell('Apple', 78)] : [cell('Apple', 78), cell('3', 198), cell('1.20', 318)];
  return JSON.stringify({
    blocks: [
      text('Above the table', 72),
      {
        type: 'structure',
        raw: 'Table',
        std: 'Table',
        contents: [
          {
            type: 'grid',
            xpos: [71.5, 192, 312, 432.5],
            ypos: [73.5, 98, 122.5],
            w: 3,
            h: 2,
            flags: [
              [28, 28, 28, 0],
              [28, 28, 28, 4],
              [0, 8, 8, 0],
            ],
          },
          { type: 'structure', raw: 'TR', std: 'TR', contents: [cell('Item', 78), cell('Qty', 198), cell('Price', 318)] },
          { type: 'structure', raw: 'TR', std: 'TR', contents: secondRow },
        ],
      },
    ],
  });
}

describe('parsePageTables', () => {
  it('reads each Table as its rows and cells, in the engine’s order, reaching through segmentation', () => {
    const [table, ...others] = parsePageTables(tablePage()).tables;

    expect(others).toStrictEqual([]);
    expect(table?.columns).toBe(3);
    expect(table?.rows.map((row) => row.map((cell) => cell.lines.map((line) => line.text).join('|')))).toStrictEqual([
      ['Item', 'Qty', 'Price'],
      ['Apple', '3', '1.20'],
    ]);
    // THE CELL KEEPS ITS LINES, font and all, for a styled export to read.
    expect(table?.rows[0]?.[0]?.lines[0]?.font.bold).toBe(true);
  });

  it('counts every line on the page, inside a table or not, so no-table and no-text stay two answers', () => {
    const page = parsePageTables(tablePage());
    expect(page.lines).toBe(7);
    expect(page.images).toBe(0);
  });

  it('reads a cell’s ruled edges off the grid’s flags, the bottom and right from the next point', () => {
    const borders = parsePageTables(tablePage()).tables[0]?.borders;
    expect(borders?.[0]?.[0]).toStrictEqual({ top: true, left: true, bottom: true, right: true });
    expect(borders?.[0]?.[2]).toStrictEqual({ top: true, left: true, bottom: true, right: false });
    expect(borders?.[1]?.[0]).toStrictEqual({ top: true, left: true, bottom: false, right: true });
  });

  it('CONTROL: gives NO borders for a row shorter than the grid, where a cell’s place is not its column', () => {
    // A SPANNING CELL arrives as one TD and its row is short; placing the others by
    // index would draw a border on the wrong cell, so there are none.
    const table = parsePageTables(tablePage({ spanned: true })).tables[0];
    expect(table?.rows[1]).toHaveLength(1);
    expect(table?.borders).toBeNull();
  });

  it('CONTROL: a page with no Table element has no tables and still counts its lines', () => {
    const page = parsePageTables(segmentedTwoColumn());
    expect(page.tables).toStrictEqual([]);
    expect(page.lines).toBe(4);
  });

  it('refuses what parsePageText refuses, rather than answering a page with no tables', () => {
    expect(() => parsePageTables('not json')).toThrow();
    expect(() => parsePageTables('{}')).toThrow();
  });
});

/**
 * A tagged page as the structure read returns it.
 *
 * The keys — `raw`, `std`, `contents` — and the nesting are the shape read on
 * 2026-09-14 from MuPDF 1.28.0 on a generated page whose tree lists its second
 * paragraph first. The lines are shortened; the ORDER is the tree's, which is the
 * engine's answer, and the parser must keep it.
 */
function taggedPage(): string {
  const text = (words: string, y: number) => ({
    type: 'text',
    bbox: { x: 72, y, w: 80, h: 16 },
    lines: [{ wmode: 0, bbox: { x: 72, y, w: 80, h: 16 }, font: { size: 14 }, x: 72, y, text: words }],
  });
  return JSON.stringify({
    blocks: [
      {
        type: 'structure',
        raw: 'Document',
        std: 'Document',
        contents: [
          { type: 'structure', raw: 'P', std: 'P', contents: [text('drawn second', 180)] },
          { type: 'structure', raw: 'P', std: 'P', contents: [text('drawn first', 580)] },
        ],
      },
    ],
  });
}

describe('parsePageStructure', () => {
  it('reads the elements in TREE order, with their depth and their own lines', () => {
    expect(parsePageStructure(taggedPage())).toStrictEqual({
      nodes: [
        { role: 'Document', raw: 'Document', depth: 0, lines: 0 },
        { role: 'P', raw: 'P', depth: 1, lines: 1 },
        { role: 'P', raw: 'P', depth: 1, lines: 1 },
      ],
      untaggedLines: 0,
      images: 0,
    });
  });

  it('walks THROUGH segmentation’s blocks: an untagged page has no elements', () => {
    // The two-column fixture is `SEGMENT`'s output, raw `Split` at every level —
    // measured on every untagged corpus page. Reported as elements, it would tell
    // a reader an untagged page is tagged as three `Div`s.
    expect(parsePageStructure(segmentedTwoColumn())).toStrictEqual({
      nodes: [],
      untaggedLines: 4,
      images: 0,
    });
  });

  it('a tagged element inside a segmentation block keeps its own depth', () => {
    const json = JSON.stringify({
      blocks: [
        {
          type: 'structure',
          raw: SEGMENTATION_RAW_ROLE,
          std: 'Div',
          contents: [
            {
              type: 'structure',
              raw: 'Caption',
              std: 'Caption',
              contents: [
                {
                  type: 'text',
                  bbox: { x: 0, y: 0, w: 1, h: 1 },
                  lines: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, x: 0, y: 0, text: 'inside' }],
                },
              ],
            },
            {
              type: 'text',
              bbox: { x: 0, y: 0, w: 1, h: 1 },
              lines: [{ bbox: { x: 0, y: 0, w: 1, h: 1 }, x: 0, y: 0, text: 'outside' }],
            },
            { type: 'image', bbox: { x: 0, y: 0, w: 1, h: 1 } },
          ],
        },
      ],
    });
    // DEPTH ZERO, not one: the `Split` above it is not a parent. And the line
    // beside it belongs to no element, so it is counted as untagged rather than
    // given to the element that happened to close just before it.
    expect(parsePageStructure(json)).toStrictEqual({
      nodes: [{ role: 'Caption', raw: 'Caption', depth: 0, lines: 1 }],
      untaggedLines: 1,
      images: 1,
    });
  });

  it('ONE WALK: the structure view accounts for exactly the lines the text view reads', () => {
    for (const json of [taggedPage(), segmentedTwoColumn(), unsegmentedTwoColumn()]) {
      const structure = parsePageStructure(json);
      const counted = structure.nodes.reduce((sum, node) => sum + node.lines, 0);
      expect(counted + structure.untaggedLines).toBe(linesOf(parsePageText(json)).length);
    }
    // CONTROL: the tagged page's text view keeps the TREE's order, so the two
    // views agree on order as well as on count.
    expect(linesOf(parsePageText(taggedPage())).map((line) => line.text)).toStrictEqual([
      'drawn second',
      'drawn first',
    ]);
  });

  it('refuses what parsePageText refuses, rather than answering an untagged page', () => {
    expect(() => parsePageStructure('not json')).toThrow(/not JSON/u);
    expect(() => parsePageStructure('{}')).toThrow(/no `blocks` array/u);
  });
});

describe('parsePageText', () => {
  it('keeps each line’s FONT as MuPDF classified it — name, family, bold, italic', () => {
    // MuPDF's own node shape, measured 2026-09-17 on a Helvetica-Bold run:
    // {name, family, weight, style, size}. Two lines that differ in every
    // classified property, so a reader hard-wiring any one of them fails.
    const json = JSON.stringify({
      blocks: [
        {
          type: 'text',
          bbox: { x: 0, y: 0, w: 100, h: 40 },
          lines: [
            { wmode: 0, bbox: { x: 0, y: 0, w: 100, h: 20 }, x: 0, y: 16, text: 'bold', font: { name: 'Helvetica-Bold', family: 'sans-serif', weight: 'bold', style: 'normal', size: 12 } },
            { wmode: 0, bbox: { x: 0, y: 20, w: 100, h: 20 }, x: 0, y: 36, text: 'italic', font: { name: 'Times-Italic', family: 'serif', weight: 'normal', style: 'italic', size: 10 } },
          ],
        },
      ],
    });

    expect(linesOf(parsePageText(json)).map((line) => line.font)).toStrictEqual([
      { name: 'Helvetica-Bold', family: 'sans-serif', bold: true, italic: false },
      { name: 'Times-Italic', family: 'serif', bold: false, italic: true },
    ]);
  });

  it('reads lines out of MuPDFs NESTED structure blocks', () => {
    const page = parsePageText(segmentedTwoColumn());

    // Four lines, one level down. A walk that read `page.blocks[].lines` finds
    // none of them and reports a clean empty page — the exact failure the spike
    // hit before this module existed.
    expect(linesOf(page).map((line) => line.text)).toStrictEqual(TRUTH);
  });

  it('preserves MuPDFs order and does not re-sort into anything of its own', () => {
    // The unsegmented payload is row-major and MUST come back row-major. Any
    // ordering here would be the block clusterer ADR-0034 rejected, arriving as
    // a tidy-up — and it would silently make the flag choice untestable.
    const page = parsePageText(unsegmentedTwoColumn());
    expect(linesOf(page).map((line) => line.text)).toStrictEqual([
      'left0',
      'right0',
      'left1',
      'right1',
    ]);
  });

  it('brands coordinates as Fitz space, y-down from the page top', () => {
    const [first] = linesOf(parsePageText(segmentedTwoColumn()));
    if (first === undefined) throw new Error('the fixture holds a line');

    // Measured: a run drawn at PDF user y=700 on a 792pt page arrives at y=92.
    // The number is asserted so a normalisation that quietly flipped it — the
    // banned bare y-flip, one layer up — fails here rather than in a renderer.
    expect(first.origin.y).toBe(92);
    expect(first.box.topLeft.y).toBe(79);
    expect(first.box.bottomRight.y).toBe(95);
  });

  it('separates blocks by a blank line and lines by a single one', () => {
    // The block boundary is a paragraph and the line boundary is a wrap, which
    // is the distinction SEGMENT was turned on to preserve.
    expect(plainTextOf(parsePageText(segmentedTwoColumn()))).toBe(
      'left0\n\nleft1\n\nright0\n\nright1',
    );
  });

  it('REFUSES malformed input rather than answering with an empty page', () => {
    // An empty page is what every consumer treats as a clean result: search
    // finds nothing, extraction yields nothing, and none of them reports a
    // problem. So the parse throws instead.
    expect(() => parsePageText('not json')).toThrow(/not JSON/u);
    expect(() => parsePageText('{"pages":[]}')).toThrow(/no `blocks` array/u);
  });

  it('CONTROL: a page MuPDF says is genuinely empty is legal and parses', () => {
    // Without this the refusal above could be a ban on empty pages, and the
    // first blank page in a real document would be a crash rather than a page
    // with no text.
    expect(parsePageText('{"blocks":[]}')).toStrictEqual({ blocks: [], images: 0 });
  });

  it('counts image blocks, including ones nested inside a structure block', () => {
    // THE NESTING IS THE POINT. `FZ_STEXT_SEGMENT` wraps a page's blocks in
    // `structure` nodes, so a count taken at the top level would report zero
    // for exactly the segmented pages this option was turned on for — and zero
    // is *this page has no picture on it*, which is the answer that reads fine.
    const page = parsePageText(
      JSON.stringify({
        blocks: [
          { type: 'image', bbox: { x: 0, y: 0, w: 100, h: 100 } },
          {
            type: 'structure',
            contents: [
              { type: 'image', bbox: { x: 0, y: 0, w: 10, h: 10 } },
              { type: 'text', bbox: { x: 0, y: 0, w: 10, h: 10 }, lines: [] },
            ],
          },
        ],
      }),
    );
    expect(page.images).toBe(2);
    // AND THE BLOCKS ARE STILL DROPPED, which is what makes the option safe for
    // every existing consumer: an image is counted and never becomes a line.
    expect(page.blocks).toStrictEqual([]);
  });

  it('CONTROL: a page of text alone counts no images', () => {
    // Without this, `images` could be a count of blocks rather than of image
    // blocks and both cases above would still pass.
    const page = parsePageText(
      JSON.stringify({
        blocks: [
          {
            type: 'text',
            bbox: { x: 0, y: 0, w: 10, h: 10 },
            lines: [{ bbox: { x: 0, y: 0, w: 10, h: 10 }, font: { size: 12 }, text: 'a', x: 0, y: 0 }],
          },
        ],
      }),
    );
    expect(page.images).toBe(0);
    expect(page.blocks).toHaveLength(1);
  });

  it('drops image and vector blocks rather than emitting empty text blocks', () => {
    const flat: { readonly blocks: readonly unknown[] } = JSON.parse(unsegmentedTwoColumn()) as {
      readonly blocks: readonly unknown[];
    };
    const withImage = JSON.stringify({
      blocks: [{ type: 'image', bbox: { x: 0, y: 0, w: 10, h: 10 } }, flat.blocks[0]],
    });
    expect(parsePageText(withImage).blocks).toHaveLength(1);
  });
});

describe('the accuracy score', () => {
  /**
   * THE RESOLUTION TEST, and it runs before the score measures anything real.
   *
   * Two readings that differ by exactly the amount a decision turns on: the
   * same four lines, once in column-major order and once in row-major. If the
   * score cannot tell them apart it is an instrument that would have reported
   * the unsegmented page as perfect, which is how ADR-0034 would have been
   * written the other way round.
   */
  it('separates correct reading order from row-major, which is the decision it exists for', () => {
    const segmented = scoreAgainstTruth(parsePageText(segmentedTwoColumn()), TRUTH);
    const flat = scoreAgainstTruth(parsePageText(unsegmentedTwoColumn()), TRUTH);

    expect(segmented.order).toBe(1);
    expect(flat.order).toBeLessThan(1);
    // Named as a gap rather than two bounds: the number that matters is that
    // the instrument RESOLVES the two, and a gap of zero is the blind case
    // however good each figure looks alone.
    expect(segmented.order - flat.order).toBeGreaterThan(0.1);
  });

  it('scores both pages perfect on LINES, which is why order is a second number', () => {
    // The failure a single blended figure would hide: with no options MuPDF
    // returns every line correctly and the document is still unreadable.
    expect(scoreAgainstTruth(parsePageText(segmentedTwoColumn()), TRUTH).lines).toBe(1);
    expect(scoreAgainstTruth(parsePageText(unsegmentedTwoColumn()), TRUTH).lines).toBe(1);
  });

  it('reports a merged line as missing text, naming what it could not find', () => {
    const merged = JSON.stringify({
      blocks: [
        {
          type: 'text',
          bbox: { x: 72, y: 79, w: 290, h: 16 },
          lines: [{ x: 72, y: 92, font: { size: 12 }, bbox: { x: 72, y: 79, w: 290, h: 16 }, text: 'left0 right0' }],
        },
      ],
    });
    const score = scoreAgainstTruth(parsePageText(merged), TRUTH);
    expect(score.lines).toBe(0);
    expect(score.missing).toStrictEqual(TRUTH);
  });

  it('REFUSES an empty truth, because every page is perfect against nothing', () => {
    expect(() => scoreAgainstTruth(parsePageText('{"blocks":[]}'), [])).toThrow(/broken fixture/u);
  });

  it('reports order as 0 when there are no pairs to compare, never as perfect', () => {
    const one = scoreAgainstTruth(parsePageText(unsegmentedTwoColumn()), ['left0']);
    expect(one.lines).toBe(1);
    // Nothing was compared, so nothing is claimed. A 1.00 here would say the
    // reading order was checked.
    expect(one.order).toBe(0);
  });
});
