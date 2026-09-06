import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from '@cantoo/pdf-lib';
import type { AnnotationDraft, CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { applyMergeDocument } from './pageMerge.js';
import { applyDeletePages, applyDuplicatePage, applyMovePage } from './pageOrder.js';
import { applyRotatePages } from './rotatePages.js';

/**
 * Whether an annotation survives the page operations D2 already ships — the
 * third of Stage 3's three properties, and the one that was **assumed**.
 *
 * ## Why this is measured rather than reasoned
 *
 * The reasoning is easy and it is not evidence: an annotation lives in the page
 * dictionary's `/Annots`, and every page operation here rewrites the page tree
 * in place (invariant L6), so a page carries its annotations wherever it goes.
 * That argument is correct for `movePage` and says nothing about
 * `duplicatePage`, which copies a page, or about `mergeDocument`, which grafts
 * one across documents — and *nothing about the annotation moved* is exactly
 * what a document that quietly dropped it would also look like.
 *
 * `docs/FEATURES.md` carries the row *"Annotations survive page ops via command
 * remapping"*, and the phrase names a renderer-side mechanism the back-stack
 * uses. What these cases establish is the half underneath it: whether the
 * DOCUMENT still holds the annotation, and on which page. A remap that pointed
 * at the right index of a document that had lost the object would be correct
 * and useless.
 *
 * ## Every case asserts WHICH page, not that one exists
 *
 * A document with three pages and one annotation has three chances to be
 * wrong, and *an annotation is present somewhere* passes for all of them. So
 * each case reads the annotation's page index back and names it.
 */

const MEDIA: readonly [number, number] = [200, 300];
const PAGES = 3;

/** A rectangle, distinctive enough to be recognised after a page move. */
const MARK: AnnotationDraft = {
  type: 'square',
  rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
  colour: [1, 0, 0],
  borderWidth: 2,
};

/**
 * The `/Rect` {@link MARK} lands as, measured rather than computed here.
 *
 * The command names `10, 20` to `110, 70` in PDF user space; MuPDF expands the
 * stored rectangle by half the border width plus its own half point and records
 * the difference in `/RD`, so the four numbers on disk are the command's
 * inflated by 1.5. `pageAnnotations.test.ts` is where that placement is
 * asserted against the format's own `/RD` rule — here it is a CONSTANT the
 * survival cases compare against, because what this file is about is whether
 * the same rectangle comes back, not what it should have been.
 */
const PLACED: readonly number[] = [8.5, 18.5, 111.5, 71.5];

/** Three plain pages. */
async function document(pages = PAGES): Promise<Uint8Array> {
  const built = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) built.addPage([...MEDIA]);
  return built.save({ useObjectStreams: false });
}

function command(page: number): CommandOfKind<'addAnnotation'> {
  return { kind: 'addAnnotation', page, annotation: MARK };
}

/** Runs `work` against an open session and serialises the result. */
async function through(
  bytes: Uint8Array,
  work: (session: MupdfSession) => Promise<void>,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await work(session);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * Which pages carry a `/Square` annotation, and what its `/Rect` is — read with
 * pdf-lib, which is not the library that wrote it.
 */
async function marksIn(
  bytes: Uint8Array,
): Promise<readonly { readonly page: number; readonly rect: readonly number[] }[]> {
  const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
  const found: { page: number; rect: readonly number[] }[] = [];
  loaded.getPages().forEach((page, index) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (const entry of annots.asArray()) {
      const dict = entry instanceof PDFRef ? loaded.context.lookup(entry, PDFDict) : undefined;
      if (dict === undefined) continue;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (!(subtype instanceof PDFName) || subtype.asString() !== '/Square') continue;
      const rect = dict.lookup(PDFName.of('Rect'));
      found.push({
        page: index,
        rect:
          rect instanceof PDFArray
            ? rect.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : NaN))
            : [],
      });
    }
  });
  return found;
}

/** A three-page document with a mark on page 1. */
async function marked(): Promise<Uint8Array> {
  return through(await document(), (session) => applyAddAnnotation(session, command(1)));
}

describe('an annotation survives the page operations that move its page', () => {
  it('is on page 1 before anything moves', async () => {
    // THE BASELINE, and it is a case rather than an assumption: every case
    // below asserts where the mark ENDED UP, and none of them means anything
    // if it did not start where this says.
    expect(await marksIn(await marked())).toStrictEqual([
      { page: 1, rect: PLACED },
    ]);
  });

  it('moves with its page', async () => {
    const moved = await through(await marked(), (session) =>
      applyMovePage(session, { kind: 'movePage', from: 1, to: 0 }),
    );
    expect(await marksIn(moved)).toStrictEqual([{ page: 0, rect: PLACED }]);
  });

  it('renumbers when an earlier page is deleted', async () => {
    const shortened = await through(await marked(), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [0] }),
    );
    expect(await marksIn(shortened)).toStrictEqual([{ page: 0, rect: PLACED }]);
  });

  it('goes with the page that is deleted, and takes nothing else with it', async () => {
    const gone = await through(await marked(), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [1] }),
    );
    expect(await marksIn(gone)).toStrictEqual([]);
  });

  it('stays put and keeps its rectangle when the page is rotated', async () => {
    // `/Rect` IS IN USER SPACE and `/Rotate` is a display property, so the
    // annotation turns with the page and its stored rectangle does not move.
    // Asserting the rectangle is what separates that from a rotation that
    // rewrote the annotation's geometry — which would render identically on
    // the turned page and wrongly on the day it is turned back.
    const turned = await through(await marked(), (session) =>
      applyRotatePages(session, { kind: 'rotatePages', pages: [1], quarterTurns: 1 }),
    );
    expect(await marksIn(turned)).toStrictEqual([{ page: 1, rect: PLACED }]);
  });

  it('is COPIED when its page is duplicated, onto both pages', async () => {
    // The half `movePage`'s argument says nothing about: a copy is a new page
    // object, and whether it carries the original's annotations is a fact about
    // how the copy is made rather than about the page tree.
    const doubled = await through(await marked(), (session) =>
      applyDuplicatePage(session, { kind: 'duplicatePage', page: 1 }),
    );
    expect((await marksIn(doubled)).map((mark) => mark.page)).toStrictEqual([1, 2]);
  });

  it('is NOT copied onto a page that never had one', async () => {
    // The control for the case above, and it is the one that separates
    // *duplicate carries annotations* from *every page has one*. Without it a
    // reader cannot tell which of the two the case measured.
    const doubled = await through(await marked(), (session) =>
      applyDuplicatePage(session, { kind: 'duplicatePage', page: 0 }),
    );
    // Page 0 duplicated to page 1 pushes the marked page to 2.
    expect((await marksIn(doubled)).map((mark) => mark.page)).toStrictEqual([2]);
  });
});

/** A two-page target with a three-page marked source merged in at index 1. */
async function mergedWithMark(): Promise<Uint8Array> {
  const into = await mupdfWriter.open(await document(2));
  const from = await mupdfWriter.open(await marked());
  try {
    // `source` is a `DocId` on the wire and the apply never reads it — the
    // session it names is the third argument. The assertion is confined here
    // rather than repeated at each call site.
    await applyMergeDocument(into, { kind: 'mergeDocument', source: 'source' as never, at: 1 }, from);
    return await mupdfWriter.serialise(into);
  } finally {
    await mupdfWriter.close(from);
    await mupdfWriter.close(into);
  }
}

describe('an annotation survives crossing into another document', () => {
  it('arrives with the pages a merge grafts', async () => {
    // `mergeDocument` grafts pages between documents, which is a copy through
    // MuPDF's own object graph rather than a page-tree move — so nothing
    // `movePage` establishes reaches it. MEASURED 2026-09-06: `graftPage` alone
    // carries no `/Annots` at all, and this case is what found it.
    const merged = await mergedWithMark();

    // The source's three pages land at 1, 2 and 3; its marked page was 1.
    expect(await marksIn(merged)).toStrictEqual([{ page: 2, rect: PLACED }]);
  });

  it('points the arrived annotation at the page it is now ON', async () => {
    // THE HALF THAT RENDERS CORRECTLY WHILE BEING WRONG. `/P` is copied
    // verbatim by the graft, so an annotation that arrives without being
    // re-pointed names a page in ANOTHER DOCUMENT — a dangling identity join of
    // the kind §3 bans — and every viewer draws it from its `/Rect` regardless.
    // So the case above passes on the broken document, exactly as the page
    // count and order pass on a broken page tree.
    const merged = await mergedWithMark();
    const loaded = await PDFDocument.load(merged, { updateMetadata: false });
    const page = loaded.getPages()[2];
    if (page === undefined) throw new Error('the merged document lost a page');
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) throw new Error('the mark did not arrive');
    const [first] = annots.asArray();
    const dict = first instanceof PDFRef ? loaded.context.lookup(first, PDFDict) : undefined;
    const parent = dict?.get(PDFName.of('P'));
    // The page's own reference, which is what `/P` must name.
    expect(parent).toBeInstanceOf(PDFRef);
    expect((parent as PDFRef).toString()).toBe(page.ref.toString());
  });

  it('leaves a page that had no annotations without an /Annots key', async () => {
    // The control for the carry: writing `/Annots` unconditionally would put an
    // empty array on every grafted page, which is not what the source said and
    // is a difference no rendering shows.
    const merged = await mergedWithMark();
    const loaded = await PDFDocument.load(merged, { updateMetadata: false });
    const bare = loaded.getPages()[1];
    expect(bare?.node.lookup(PDFName.of('Annots'))).toBeUndefined();
  });
});
