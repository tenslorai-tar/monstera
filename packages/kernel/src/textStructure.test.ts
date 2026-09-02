import { describe, expect, it } from 'vitest';

import { scoreAgainstTruth } from './textAccuracy.js';
import { STEXT_FLAGS, STEXT_OPTIONS, linesOf, parsePageText, plainTextOf } from './textStructure.js';

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
  it('names SEGMENT and leaves TABLE_HUNT out of the flag word', () => {
    // THE POINT OF THE MODULE, asserted rather than assumed. ADR-0034 measured
    // TABLE_HUNT splitting a prose line in two and undoing SEGMENT's ordering,
    // so it is declared — a consumer may opt in — and not set.
    expect(STEXT_FLAGS & STEXT_OPTIONS.segment).toBe(STEXT_OPTIONS.segment);
    expect(STEXT_FLAGS & STEXT_OPTIONS.tableHunt).toBe(0);
  });

  it('CONTROL: the two options are different bits, so the case above can fail', () => {
    // Without this, both assertions pass for a flag word of any value if the
    // two constants happened to be equal — the case would be checking one thing
    // twice and reporting it as two.
    expect(STEXT_OPTIONS.segment).not.toBe(STEXT_OPTIONS.tableHunt);
  });
});

describe('parsePageText', () => {
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
    expect(parsePageText('{"blocks":[]}')).toStrictEqual({ blocks: [] });
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
