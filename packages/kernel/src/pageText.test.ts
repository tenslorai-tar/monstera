import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  type PageTransform,
  fitzPoint,
  fromFitz,
  ok,
  pageTransform,
  toPdf,
  viewportPoint,
} from '@monstera/shared';

import type { ByteImage } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { readPageText } from './pageText.js';
import { scoreAgainstTruth } from './textAccuracy.js';
import { findInPages } from './textSearch.js';
import { linesOf } from './textStructure.js';

/**
 * The text substrate's FIRST REAL CALLER, against a real engine.
 *
 * Every other case for these modules feeds `parsePageText` a payload — a
 * shortened reading, faithful but transcribed. This one goes fixture → MuPDF →
 * `readPageText` → the score and the search, with nothing hand-copied in
 * between, which is what separates *the parser handles the shape I wrote down*
 * from *the substrate works*.
 *
 * ## The fixture's ground truth is a property of the generator
 *
 * Every run is placed here at a coordinate chosen here, so which runs share a
 * column is a fact rather than an opinion of the thing under test. Scoring a
 * clusterer against labels a clusterer produced measures agreement, not
 * correctness.
 *
 * **The two columns share every baseline deliberately.** A grouper keying on
 * baseline alone merges them and reads across the gutter, which is the classic
 * two-column failure; staggered baselines are handled correctly by the broken
 * version and would separate nothing.
 */

const COLUMNS = ['left', 'right'] as const;
const ROWS = 5;

/** The reading order a person wants: a column at a time. */
const TRUTH = COLUMNS.flatMap((column) =>
  Array.from({ length: ROWS }, (_, row) => `${column}${String(row)}`),
);

async function twoColumnDocument(): Promise<ByteImage> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  for (let row = 0; row < ROWS; row += 1) {
    const y = 700 - row * 24;
    page.drawText(`left${String(row)}`, { x: 72, y, size: 12, font });
    page.drawText(`right${String(row)}`, { x: 340, y, size: 12, font });
  }
  return doc.save({ useObjectStreams: false });
}

/** A page with no text at all, for the control below. */
async function blankDocument(): Promise<ByteImage> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/** Where the rotation fixtures put their single run, in PDF user space. */
const TURNED = { x: 60, baseline: 600, size: 14, text: 'FRAME PROBE' };

/** A non-square page, so a swapped axis cannot hide. */
const TURNED_PAGE = { width: 400, height: 700 };

/**
 * The SAME ink at the SAME user-space position, with one `/Rotate`.
 *
 * The pre-image is identical across all four, so a reported box that moves is
 * the frame moving rather than the content — which is what makes a comparison
 * across turns mean anything. A fixture that drew upright ink and declared
 * `/Rotate 90` would read sideways and answer a question nobody asked.
 */
async function turnedDocument(rotation: number): Promise<ByteImage> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([TURNED_PAGE.width, TURNED_PAGE.height]);
  page.drawText(TURNED.text, {
    x: TURNED.x,
    y: TURNED.baseline,
    size: TURNED.size,
    font,
  });
  page.setRotation(degrees(rotation));
  return doc.save({ useObjectStreams: false });
}

/** The page's transform at scale 1, built from the fixture's own numbers. */
function turnedTransform(rotation: number): PageTransform {
  return pageTransform(
    { x0: 0, y0: 0, x1: TURNED_PAGE.width, y1: TURNED_PAGE.height },
    rotation,
    1,
  );
}

/**
 * Whether a converted rectangle lands on the run this fixture drew.
 *
 * The left edge and the baseline, not the whole box: a line's reported height
 * carries the font's ascent and descent, which is a fact about the font rather
 * than about the frame, and requiring it to match would fail every candidate
 * for a reason that is not the one under test.
 */
function landsOnTheRun(rect: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const left = Math.min(rect.x0, rect.x1);
  const bottom = Math.min(rect.y0, rect.y1);
  const top = Math.max(rect.y0, rect.y1);
  return (
    Math.abs(left - TURNED.x) < 2 &&
    bottom < TURNED.baseline + 1 &&
    top > TURNED.baseline &&
    top - bottom < TURNED.size * 2
  );
}

describe('readPageText, against a real MuPDF session', () => {
  let columns: ByteImage;
  let blank: ByteImage;

  beforeAll(async () => {
    columns = await twoColumnDocument();
    blank = await blankDocument();
  });

  it('reads every placed run back, in COLUMN-major reading order', async () => {
    const session = await mupdfWriter.open(columns);
    const { pageCount, pages } = await readPageText(session, [0]);

    expect(pageCount).toBe(1);
    const [page] = pages;
    if (page === undefined) throw new Error('one page was requested');

    // The whole point of the option this module sets. Without `segment` MuPDF
    // returns these ten runs row-major — every line correct, the document
    // unreadable — which is why the assertion is the ORDER and not the set.
    expect(linesOf(page).map((line) => line.text)).toStrictEqual(TRUTH);
  });

  it('scores 1.00 on both lines and order, through the shipped parser', async () => {
    const session = await mupdfWriter.open(columns);
    const { pages } = await readPageText(session, [0]);

    const score = scoreAgainstTruth(pages[0] ?? { blocks: [] }, TRUTH);
    expect(score.lines).toBe(1);
    expect(score.order).toBe(1);
    expect(score.missing).toStrictEqual([]);
  });

  it('CONTROL: the score is NOT 1.00 for an order this document does not have', async () => {
    const session = await mupdfWriter.open(columns);
    const { pages } = await readPageText(session, [0]);

    // Row-major: the order MuPDF returns with no options. Without this case the
    // one above passes for a score that answers 1.00 to anything, which is the
    // instrument reporting the answer it was hoping for.
    const rowMajor = Array.from({ length: ROWS }, (_, row) => [
      `left${String(row)}`,
      `right${String(row)}`,
    ]).flat();
    const score = scoreAgainstTruth(pages[0] ?? { blocks: [] }, rowMajor);
    expect(score.lines).toBe(1);
    expect(score.order).toBeLessThan(1);
  });

  it('SEARCH FINDS THE RUNS, which is the substrate having a real consumer', async () => {
    const session = await mupdfWriter.open(columns);
    const { pages } = await readPageText(session, [0]);

    const found = findInPages(pages, 'right');
    if (!found.ok) throw new Error(`the query compiles: ${found.error}`);
    const matches = found.value;
    expect(matches).toHaveLength(ROWS);
    // Located in reading order: all five right-column runs sit after all five
    // left ones, so their line indices start at ROWS rather than interleaving.
    expect(matches.map((match) => match.line)).toStrictEqual([5, 6, 7, 8, 9]);
    expect(matches.every((match) => match.page === 0)).toBe(true);
  });

  it('CONTROL: a search for text this document does not contain finds nothing', async () => {
    const session = await mupdfWriter.open(columns);
    const { pages } = await readPageText(session, [0]);
    // `ok` with an empty list, not a refusal — the distinction the `Result`
    // exists for, and asserting the wrapper is what keeps "found nothing" from
    // covering "could not compile".
    expect(findInPages(pages, 'centre')).toStrictEqual(ok([]));
  });

  it('reads a genuinely blank page as a page with no text, not as a failure', async () => {
    const session = await mupdfWriter.open(blank);
    const { pages } = await readPageText(session, [0]);
    expect(pages[0]?.blocks).toStrictEqual([]);
  });

  it('REFUSES a page index outside the document rather than answering empty', async () => {
    const session = await mupdfWriter.open(columns);
    // An empty page is what a caller treats as "no text here", so a bad index
    // must not produce one — the same rule `readPageGeometry` states about a
    // plausible upright rotation.
    await expect(readPageText(session, [7])).rejects.toThrow(RangeError);
  });

  it('validates EVERY requested page before reading any of them', async () => {
    const session = await mupdfWriter.open(columns);
    // A half-read answer whose length matches the request and whose contents
    // describe a different set of pages is what a per-page check would allow.
    await expect(readPageText(session, [0, 7])).rejects.toThrow(/outside this document/u);
  });
});

/**
 * Which SPACE the substrate's boxes are in, checked as a pre-image against all
 * four turns rather than extrapolated from one.
 *
 * ## Why these cases exist
 *
 * `textStructure.ts` typed its corners `FitzPoint` until 2026-09-08.
 * `@monstera/shared`'s `FitzPoint` is the **unrotated** y-down space —
 * `toFitz` is `(x − crop.x0, crop.y1 − y)` and touches rotation nowhere — and
 * MuPDF's structured text comes off the page's display list, which has already
 * applied `/Rotate`.
 *
 * **At `/Rotate 0` the two conversions are arithmetically the same operation.**
 * Every other fixture in this repository is upright, so the wrong brand agreed
 * with the right one everywhere it was ever exercised, and nothing in the
 * product converted one of these boxes — search carries `line`, `offset` and
 * `text` and no geometry. The text layer is the first caller that would, and it
 * would have placed every line of every rotated page somewhere the text is not.
 *
 * So the assertion is the CONSEQUENCE rather than the brand: a name is checked
 * by the compiler and would be changed back by the same edit that broke this.
 * What cannot be argued with is whether the converted box lands on the run.
 */
describe('the space the substrate reports boxes in', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`places the run correctly through toPdf at /Rotate ${String(rotation)}`, async () => {
      const session = await mupdfWriter.open(await turnedDocument(rotation));
      const { pages } = await readPageText(session, [0]);
      const line = linesOf(pages[0] ?? { blocks: [] }).find((entry) =>
        entry.text.includes(TURNED.text),
      );
      if (line === undefined) throw new Error('the fixture draws one run');

      const transform = turnedTransform(rotation);
      const a = toPdf(viewportPoint(line.box.topLeft.x, line.box.topLeft.y), transform);
      const b = toPdf(
        viewportPoint(line.box.bottomRight.x, line.box.bottomRight.y),
        transform,
      );
      expect(landsOnTheRun({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })).toBe(true);
    });
  }

  /**
   * THE CASE THAT SEPARATES THE TWO SPACES, and without it the four above pass
   * for a page that is not turned at all.
   *
   * Read as a pair with the `/Rotate 0` case below it: `fromFitz` is correct
   * upright and wrong on every turn, which is exactly the shape of a defect
   * that ships. A case asserting only that `toPdf` works would stay green if
   * the brand were changed back, because `toPdf` would still be the call
   * somebody wrote.
   */
  it('CONTROL: fromFitz — the OLD brand’s conversion — misses on a turned page', async () => {
    const session = await mupdfWriter.open(await turnedDocument(90));
    const { pages } = await readPageText(session, [0]);
    const line = linesOf(pages[0] ?? { blocks: [] }).find((entry) =>
      entry.text.includes(TURNED.text),
    );
    if (line === undefined) throw new Error('the fixture draws one run');

    const transform = turnedTransform(90);
    const a = fromFitz(fitzPoint(line.box.topLeft.x, line.box.topLeft.y), transform);
    const b = fromFitz(
      fitzPoint(line.box.bottomRight.x, line.box.bottomRight.y),
      transform,
    );
    expect(landsOnTheRun({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })).toBe(false);
  });

  it('CONTROL: fromFitz agrees with toPdf upright, which is why this went unnoticed', async () => {
    const session = await mupdfWriter.open(await turnedDocument(0));
    const { pages } = await readPageText(session, [0]);
    const line = linesOf(pages[0] ?? { blocks: [] }).find((entry) =>
      entry.text.includes(TURNED.text),
    );
    if (line === undefined) throw new Error('the fixture draws one run');

    const transform = turnedTransform(0);
    const viaFitz = fromFitz(fitzPoint(line.box.topLeft.x, line.box.topLeft.y), transform);
    const viaPdf = toPdf(viewportPoint(line.box.topLeft.x, line.box.topLeft.y), transform);
    expect({ x: viaFitz.x, y: viaFitz.y }).toStrictEqual({ x: viaPdf.x, y: viaPdf.y });
  });
});
