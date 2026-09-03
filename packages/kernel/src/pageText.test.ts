import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { ok } from '@monstera/shared';

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
