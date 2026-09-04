import { PDFArray, PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import {
  applyDeletePages,
  applyMovePage,
  captureDeletePages,
  captureMovePage,
  invertMovePage,
  keptPermutation,
  movePermutation,
  remapPageIndex,
  remapPageIndexAfterDelete,
} from './pageOrder.js';

/**
 * Moving a page, read back through a DIFFERENT library than the one that wrote.
 *
 * ## The round trip is the case, and it is read with pdf-lib
 *
 * `layers.ts` paid for this three weeks of work ago in one day: a reader and a
 * writer that share an in-memory cache agree with each other immediately, and
 * six cases passed about a toggle that a save dropped. So every assertion about
 * the resulting document below re-opens the saved bytes and walks `/Kids` with
 * pdf-lib. A round trip verified by the engine that wrote it proves the engine
 * is self-consistent and nothing else.
 *
 * ## Each page is identifiable, which a fixture of blank pages is not
 *
 * Every page carries a distinct `/MediaBox` width, so the order after a move is
 * read off the document rather than assumed from the call. A fixture of
 * identical pages makes *reordered correctly*, *reordered wrongly* and *not
 * reordered at all* the same observation.
 */

/** Page `n` is `100 + n` wide, so a saved document can be read back as an order. */
const WIDTH_BASE = 100;

/** A flat document whose pages are distinguishable by width. */
async function flatDocument(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    document.addPage([WIDTH_BASE + index, 500]);
  }
  return document.save({ useObjectStreams: false });
}

/**
 * The same pages in a NESTED, uneven tree — `root → [ inner → [p0, p1], … ]`.
 *
 * The checklist's own hard shape, and for this command it is the shape the
 * spike's first implementation got wrong in two ways at once: permuting the
 * root `/Kids` permutes SUBTREES rather than pages, and flattening without
 * pushing inherited attributes down changes how a page renders while the order
 * still looks right.
 *
 * Restructured in place rather than copied into a new document, for
 * `pageLinks.test.ts`'s measured reason: `copyPages` drops things, and a
 * fixture that differs on two axes attributes the failure to the wrong one.
 */
async function nestedDocument(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.load(await flatDocument(pages));
  const root = document.catalog.Pages();
  const kids = root.Kids();
  if (kids.size() !== pages) {
    throw new Error(`the fixture should have ${String(pages)} pages, not ${String(kids.size())}`);
  }

  const innerKids = PDFArray.withContext(document.context);
  const first = kids.get(0);
  const second = kids.get(1);
  innerKids.push(first);
  innerKids.push(second);

  // THE INHERITED ATTRIBUTE, which is the second half of the hard shape. The
  // intermediate node declares a /Rotate its two leaves do not, so a flatten
  // that fails to push it down produces a document whose first two pages are no
  // longer turned — with the page ORDER still correct, which is what makes it
  // invisible.
  const inner = document.context.obj({
    Type: PDFName.of('Pages'),
    Kids: innerKids,
    Count: PDFNumber.of(2),
    Rotate: PDFNumber.of(90),
    Parent: document.catalog.get(PDFName.of('Pages')),
  });
  const innerRef = document.context.register(inner);

  const outerKids = PDFArray.withContext(document.context);
  outerKids.push(innerRef);
  for (let index = 2; index < pages; index += 1) outerKids.push(kids.get(index));
  root.set(PDFName.of('Kids'), outerKids);

  for (const ref of [first, second]) {
    const page = document.context.lookup(ref);
    if (page !== undefined && 'set' in page && typeof page.set === 'function') {
      (page as { set: (key: unknown, value: unknown) => void }).set(PDFName.of('Parent'), innerRef);
    }
  }

  return document.save({ useObjectStreams: false });
}

/** The page widths of a saved document, in tree order, read with pdf-lib. */
async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => Math.round(page.getWidth()));
}

/** The `/Rotate` each page resolves to, inherited or declared. */
async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

/** Runs `work` against a live MuPDF session over `bytes`, and saves the result. */
async function edited(
  bytes: Uint8Array,
  work: (session: Parameters<typeof applyMovePage>[0]) => Promise<void>,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await work(session);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('movePermutation', () => {
  it('produces the DESTINATION order, which is not the transposition', () => {
    // Moving page 0 to index 2 of a five-page document gives `1 2 0 3 4`, not
    // `1 2 3 0 4`. The two readings of `to` are equally natural and only one is
    // what a reader dragging a thumbnail onto a gap means.
    expect(movePermutation(5, 0, 2)).toStrictEqual([1, 2, 0, 3, 4]);
  });

  it('moves backwards too, and the two directions are not symmetric', () => {
    expect(movePermutation(5, 3, 1)).toStrictEqual([0, 3, 1, 2, 4]);
  });

  it('CONTROL: a move to its own index changes nothing', () => {
    // Without this the two above pass for an implementation that always
    // rotates the array, which would be wrong for exactly this input.
    expect(movePermutation(4, 2, 2)).toStrictEqual([0, 1, 2, 3]);
  });
});

describe('remapPageIndex', () => {
  it('answers where a page ENDS UP, for the page that moved and for one that did not', () => {
    // The remap contract's whole point. A destination naming page 0 must name
    // page 2 after `0 → 2`, and one naming page 3 must still name page 3 —
    // a remap that shifted everything would be wrong on the second.
    const move = { from: 0, to: 2 };
    expect(remapPageIndex(5, move, 0)).toBe(2);
    expect(remapPageIndex(5, move, 1)).toBe(0);
    expect(remapPageIndex(5, move, 3)).toBe(3);
  });

  it('answers null for a page the document does not have, rather than a number', () => {
    // A stale destination pointing past the end is a real state — the outline
    // panel already renders an unresolvable entry — and returning a clamped
    // index instead would send a reader to a page nobody asked for.
    expect(remapPageIndex(3, { from: 0, to: 1 }, 7)).toBeNull();
  });
});

describe('applyMovePage', () => {
  it('MOVES THE PAGE, and the saved document says so', async () => {
    const moved = await edited(await flatDocument(4), (session) =>
      applyMovePage(session, { kind: 'movePage', from: 0, to: 2 }),
    );

    expect(await widthsOf(moved)).toStrictEqual([101, 102, 100, 103]);
  });

  it('IS CORRECT ON A NESTED TREE, which permuting the root /Kids is not', async () => {
    // The spike's first implementation reversed the root array and produced
    // `4 5 6 1 2 3` for a six-page document in two branches of three. Here the
    // first two pages hang off an intermediate node, so a subtree permutation
    // cannot land on the right answer by luck.
    const moved = await edited(await nestedDocument(4), (session) =>
      applyMovePage(session, { kind: 'movePage', from: 0, to: 2 }),
    );

    expect(await widthsOf(moved)).toStrictEqual([101, 102, 100, 103]);
  });

  it('CARRIES THE INHERITED ROTATION DOWN, which the order alone cannot show', async () => {
    // The second half of the nested hazard, and the one that renders. Pages 0
    // and 1 inherit /Rotate 90 from the intermediate node; after a flatten that
    // does not push it down they are upright, with the ORDER still correct.
    const source = await nestedDocument(4);
    expect(await rotationsOf(source)).toStrictEqual([90, 90, 0, 0]);

    const moved = await edited(source, (session) =>
      applyMovePage(session, { kind: 'movePage', from: 0, to: 2 }),
    );

    // The two rotated pages are now at indices 1 and 2 — 101 kept its place
    // relative to 100, which moved past it.
    expect(await widthsOf(moved)).toStrictEqual([101, 102, 100, 103]);
    expect(await rotationsOf(moved)).toStrictEqual([90, 0, 90, 0]);
  });

  it('REFUSES an index the document does not have, rather than addressing past its end', async () => {
    const session = await mupdfWriter.open(await flatDocument(3));
    try {
      await expect(
        applyMovePage(session, { kind: 'movePage', from: 0, to: 9 }),
      ).rejects.toThrow(/outside a document of 3 page/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('captureMovePage and invertMovePage', () => {
  it('THE INVERSE RESTORES THE ORIGINAL ORDER, read back after a save', async () => {
    const original = await flatDocument(5);
    const command = { kind: 'movePage', from: 1, to: 4 } as const;

    const session = await mupdfWriter.open(original);
    try {
      const capture = await captureMovePage(session, command);
      expect(capture.captured).toBe(true);
      if (!capture.captured) throw new Error('the capture was refused');

      await applyMovePage(session, command);
      const after = await mupdfWriter.serialise(session);
      expect(await widthsOf(after)).toStrictEqual([100, 102, 103, 104, 101]);

      await invertMovePage(session, capture.prior);
      const restored = await mupdfWriter.serialise(session);
      expect(await widthsOf(restored)).toStrictEqual([100, 101, 102, 103, 104]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the inverse restores a NESTED document too, including its rotations', async () => {
    // The inverse rewrites the same flattened tree the forward direction does,
    // so a document that was nested does not come back nested — what must come
    // back is every page's ORDER and every page's rendering.
    const original = await nestedDocument(4);
    const command = { kind: 'movePage', from: 0, to: 3 } as const;

    const session = await mupdfWriter.open(original);
    try {
      const capture = await captureMovePage(session, command);
      if (!capture.captured) throw new Error('the capture was refused');
      await applyMovePage(session, command);
      await invertMovePage(session, capture.prior);
      const restored = await mupdfWriter.serialise(session);

      expect(await widthsOf(restored)).toStrictEqual([100, 101, 102, 103]);
      expect(await rotationsOf(restored)).toStrictEqual([90, 90, 0, 0]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a move OUTSIDE the document is NOT CAPTURED, with a reason', async () => {
    const session = await mupdfWriter.open(await flatDocument(2));
    try {
      const capture = await captureMovePage(session, { kind: 'movePage', from: 0, to: 5 });
      expect(capture.captured).toBe(false);
      if (capture.captured) throw new Error('the capture should have been refused');
      expect(capture.reason).toMatch(/outside this document, which has 2 page/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a move to its own index is captured and inverts to the same order', async () => {
    // A no-op must not be a refusal — it is a legal command with an inverse
    // that changes nothing, and an implementation that special-cased it would
    // have a branch the bus never takes.
    const original = await flatDocument(3);
    const session = await mupdfWriter.open(original);
    try {
      const command = { kind: 'movePage', from: 1, to: 1 } as const;
      const capture = await captureMovePage(session, command);
      expect(capture.captured).toBe(true);
      if (!capture.captured) throw new Error('the capture was refused');

      await applyMovePage(session, command);
      await invertMovePage(session, capture.prior);

      expect(await widthsOf(await mupdfWriter.serialise(session))).toStrictEqual([100, 101, 102]);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('keptPermutation and remapPageIndexAfterDelete', () => {
  it('removes every named index IN THE ORIGINAL FRAME, not one after another', () => {
    // THE FIXTURE SEPARATES THE TWO READINGS, which is the whole reason the
    // indices are not adjacent. Deleting 1 then 3 sequentially removes the
    // page that was at 4, because 3 slid down — so `[0, 2, 3]` is the answer a
    // sequential implementation gives and `[0, 2, 4]` is the correct one. A
    // fixture of adjacent indices produces the same array either way.
    expect(keptPermutation(5, [1, 3])).toStrictEqual([0, 2, 4]);
  });

  it('is order- and duplicate-insensitive, because it is a set question', () => {
    expect(keptPermutation(5, [3, 1])).toStrictEqual([0, 2, 4]);
    expect(keptPermutation(5, [1, 1, 3])).toStrictEqual([0, 2, 4]);
  });

  it('answers where a surviving page ENDS UP, and null for one that was removed', () => {
    // Page 4 survives at index 2 once 1 and 3 are gone. Asked of a deleted page
    // the answer is null — and the same null a page past the end gets, because
    // *this no longer resolves* is one state to whoever holds the reference.
    expect(remapPageIndexAfterDelete(5, [1, 3], 4)).toBe(2);
    expect(remapPageIndexAfterDelete(5, [1, 3], 0)).toBe(0);
    expect(remapPageIndexAfterDelete(5, [1, 3], 3)).toBeNull();
    expect(remapPageIndexAfterDelete(5, [1, 3], 9)).toBeNull();
  });
});

describe('applyDeletePages', () => {
  it('DELETES THE PAGES, and the saved document says which ones', async () => {
    const cut = await edited(await flatDocument(5), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [1, 3] }),
    );

    // Read with pdf-lib after a save, for this file's stated reason: an engine
    // agreeing with itself about its own cache proves nothing about the bytes.
    expect(await widthsOf(cut)).toStrictEqual([100, 102, 104]);
  });

  it('IS CORRECT ON A NESTED TREE, and carries the inherited rotation down', async () => {
    // Both halves of the nested hazard in one case, because for a delete they
    // interact: pages 0 and 1 inherit `/Rotate 90` from the intermediate node,
    // and page 0 is the one being removed — so a flatten that pushed nothing
    // down would leave page 1 upright while the ORDER looked right.
    const source = await nestedDocument(4);
    expect(await rotationsOf(source)).toStrictEqual([90, 90, 0, 0]);

    const cut = await edited(source, (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [0] }),
    );

    expect(await widthsOf(cut)).toStrictEqual([101, 102, 103]);
    expect(await rotationsOf(cut)).toStrictEqual([90, 0, 0]);
  });

  it('REFUSES a delete that would empty the document', async () => {
    // The one rule the schema cannot carry, because it needs the page count.
    const session = await mupdfWriter.open(await flatDocument(3));
    try {
      await expect(
        applyDeletePages(session, { kind: 'deletePages', pages: [0, 1, 2] }),
      ).rejects.toThrow(/would leave a document with none/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES an index the document does not have', async () => {
    const session = await mupdfWriter.open(await flatDocument(3));
    try {
      await expect(
        applyDeletePages(session, { kind: 'deletePages', pages: [9] }),
      ).rejects.toThrow(/outside a document of 3 page/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('captureDeletePages', () => {
  it('NEVER captures, and says why — which is what makes the entry terminal', async () => {
    const session = await mupdfWriter.open(await flatDocument(3));
    try {
      const capture = await captureDeletePages(session, { kind: 'deletePages', pages: [1] });

      expect(capture.captured).toBe(false);
      if (capture.captured) throw new Error('a delete cannot be captured');
      expect(capture.reason).toMatch(/no serialisable inverse/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THROWS rather than refusing when the command is invalid, so redo cannot repeat it', async () => {
    // The distinction ADR-0009's 2026-08-19 decision draws, and it is the one
    // thing this capture can get wrong. *Prior state cannot be recorded* is an
    // outcome the bus answers with a checkpoint; *this command is not legal for
    // this document* is a caller error. Converted into the first, an
    // out-of-range delete would be recorded as a terminal entry, take a
    // checkpoint, and fail at `apply` — after the log had grown.
    const session = await mupdfWriter.open(await flatDocument(3));
    try {
      await expect(
        captureDeletePages(session, { kind: 'deletePages', pages: [9] }),
      ).rejects.toThrow(/outside a document of 3 page/u);
      await expect(
        captureDeletePages(session, { kind: 'deletePages', pages: [0, 1, 2] }),
      ).rejects.toThrow(/would leave a document with none/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
