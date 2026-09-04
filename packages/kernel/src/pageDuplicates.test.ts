import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { applyDuplicatePage } from './pageOrder.js';
import { findDuplicatePages } from './pageDuplicates.js';

/**
 * Finding duplicate pages — a measurement, so it owes a resolution test before
 * it decides anything.
 *
 * ## The resolution test is the FIRST case, and it is the point
 *
 * Audit item 4a: feed it two values that differ by the smallest amount that
 * would change the answer, and confirm it tells them apart. For a content
 * comparison the smallest such difference is **one drawn shape in a different
 * place**, so the fixture below has two pages that differ by a single
 * coordinate and one pair that does not differ at all.
 *
 * Without that case, an instrument that answered *every page is a duplicate of
 * every other* would pass a *finds the duplicates* assertion perfectly.
 */

/**
 * Four pages: 0 and 2 identical, 1 differing from them by one coordinate, and
 * 3 differing by its resources.
 *
 * The near-identical pair is the resolution test's subject. `1` draws the same
 * rectangle one point to the right, which is the smallest change that produces
 * different content bytes.
 */
async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const x of [10, 11, 10]) {
    document.addPage([200, 200]).drawRectangle({ x, y: 10, width: 5, height: 5 });
  }
  // TWO PAGES WITH NO CONTENT AT ALL, and the second is what makes the case
  // about them mean anything. With one, an implementation that grouped
  // unreadable pages under a shared key produces a group of one, which the
  // *more than one member* filter removes — so the wrong version and the right
  // one give the same answer. Found by mutation.
  document.addPage([200, 200]);
  document.addPage([200, 200]);
  return document.save({ useObjectStreams: false });
}

/** Runs `work` against a live session over `bytes`. */
async function against<T>(
  bytes: Uint8Array,
  work: (session: Parameters<typeof findDuplicatePages>[0]) => Promise<T>,
): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('findDuplicatePages', () => {
  it('RESOLUTION: two pages differing by ONE COORDINATE are not duplicates', async () => {
    // Audit item 4a, run before anything below is believed. Pages 0 and 1 draw
    // the same rectangle one point apart — the smallest difference that changes
    // the answer — and page 2 is page 0 exactly.
    //
    // An instrument that grouped everything answers `[[0, 1, 2]]` here and
    // satisfies every *it finds the duplicates* assertion in this file.
    const groups = await against(await fixture(), findDuplicatePages);

    expect(groups).toStrictEqual([{ pages: [0, 2] }]);
  });

  it('FINDS A DUPLICATE THE DOCUMENT MADE ITSELF, by identity rather than resemblance', async () => {
    // `duplicatePage` leaves `/Contents` shared — measured — so a document's
    // own duplicates are exact. This is the case that says the two features
    // agree, which neither alone can.
    const groups = await against(await fixture(), async (session) => {
      await applyDuplicatePage(session, { kind: 'duplicatePage', page: 1 });
      return findDuplicatePages(session);
    });

    // Page 1 was copied to index 2, so the original pair 0 and 2 is now 0 and 3.
    expect(groups).toStrictEqual([{ pages: [0, 3] }, { pages: [1, 2] }]);
  });

  it('DOES NOT GROUP PAGES IT COULD NOT READ', async () => {
    // A page with no content stream has no identity, and pages that share
    // *no identity* are not pages that share *an* identity. Grouping them under
    // one "unreadable" key produces the same shape of answer and means the
    // opposite — and a person acting on it would delete a real page.
    //
    // The fixture's pages 3 and 4 are both empty, and TWO is what makes this
    // case separate anything: with one, an implementation that grouped them
    // under a shared key produces a group of one member, which the *more than
    // one* filter removes — the wrong version and the right one give the same
    // answer. Found by mutation.
    const groups = await against(await fixture(), findDuplicatePages);

    expect(groups.flatMap((group) => group.pages)).toStrictEqual([0, 2]);
  });

  it('CONTROL: a document with no duplicates answers with nothing', async () => {
    // The reassuring answer, and it needs its own case for the reason the audit
    // gives: *found nothing* is what every broken version of a search reports.
    // The case above is the positive control that makes this one mean
    // something.
    const document = await PDFDocument.create();
    for (const x of [10, 20, 30]) {
      document.addPage([200, 200]).drawRectangle({ x, y: 10, width: 5, height: 5 });
    }
    const groups = await against(
      await document.save({ useObjectStreams: false }),
      findDuplicatePages,
    );

    expect(groups).toStrictEqual([]);
  });

  it('CONTROL: a page is never a duplicate of itself', async () => {
    // A one-page document has one identity with one member. A grouping that
    // kept singletons would answer `[{ pages: [0] }]`, which every caller would
    // then have to filter — and one of them would forget.
    const document = await PDFDocument.create();
    document.addPage([200, 200]).drawRectangle({ x: 10, y: 10, width: 5, height: 5 });
    const groups = await against(
      await document.save({ useObjectStreams: false }),
      findDuplicatePages,
    );

    expect(groups).toStrictEqual([]);
  });
});
