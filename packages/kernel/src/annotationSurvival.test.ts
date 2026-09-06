import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from '@cantoo/pdf-lib';
import type { AnnotationDraft, CommandKind, CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { declaredCommands } from './commandDeclarations.js';
import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyAddAnnotation } from './pageAnnotations.js';
import { extractPages } from './pageExtract.js';
import { applyMergeDocument, applyReplacePage } from './pageMerge.js';
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
  opacity: 1,
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

/**
 * What the first annotation on `page` names in its `/P`, beside that page's own
 * reference — the pair a caller compares.
 *
 * Read as two strings rather than asserted here, so a failure prints both
 * object numbers: *the annotation points at 12 0 R and the page it is on is
 * 7 0 R* is a diagnosis, where *expected true* sends someone back to the
 * document with a hex editor.
 */
async function parentOf(
  bytes: Uint8Array,
  page: number,
): Promise<{ readonly names: string; readonly own: string }> {
  const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
  const target = loaded.getPages()[page];
  if (target === undefined) throw new Error(`the document has no page ${String(page)}`);
  const annots = target.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) throw new Error(`page ${String(page)} carries no /Annots`);
  const [first] = annots.asArray();
  const dict = first instanceof PDFRef ? loaded.context.lookup(first, PDFDict) : undefined;
  if (dict === undefined) throw new Error('the first annotation is not a reachable dictionary');
  const parent = dict.get(PDFName.of('P'));
  if (!(parent instanceof PDFRef)) throw new Error('the annotation names no page at all');
  return { names: parent.toString(), own: target.ref.toString() };
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
    const { names, own } = await parentOf(await mergedWithMark(), 2);
    expect(names).toBe(own);
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

/**
 * A two-page target whose page **1** is replaced by a three-page marked source.
 *
 * `at: 1` rather than `at: 0`, and the difference is the whole fixture: the
 * apply grafts each source page to `command.at + page` and then deletes the
 * replaced page from `command.at + pages`. At zero both expressions collapse to
 * the loop variable and the page count, so an implementation that ignored `at`
 * entirely would produce exactly this document. A fixture the defect also
 * handles correctly separates nothing.
 */
async function replacedWithMark(): Promise<Uint8Array> {
  const into = await mupdfWriter.open(await document(2));
  const from = await mupdfWriter.open(await marked());
  try {
    await applyReplacePage(into, { kind: 'replacePage', source: 'source' as never, at: 1 }, from);
    return await mupdfWriter.serialise(into);
  } finally {
    await mupdfWriter.close(from);
    await mupdfWriter.close(into);
  }
}

describe('an annotation survives the OTHER command that crosses documents', () => {
  // `replacePage` shares `graftPageWithAnnotations` with the merge above, which
  // is a fact about today's code and not a property. Rule 0's *fix the class,
  // not the instance* has its matching failure in the tests: closing one caller
  // and leaving its sibling uncovered is the half-fix that reads as done,
  // because the helper is proven and the call site is where the argument order,
  // the index arithmetic and the deletion afterwards live.
  it('arrives with the pages a replace grafts, at the index the replace named', async () => {
    // The target's page 0 stays; the source's three pages land at 1, 2 and 3;
    // the replaced page is deleted from 4. Its marked page was 1, so the mark
    // is at 2 and four pages remain. The COUNT is asserted beside the index
    // because an apply that deleted the wrong page leaves the mark where this
    // expects it and the document one page short.
    const replaced = await replacedWithMark();
    const loaded = await PDFDocument.load(replaced, { updateMetadata: false });
    expect(loaded.getPageCount()).toBe(4);
    expect(await marksIn(replaced)).toStrictEqual([{ page: 2, rect: PLACED }]);
  });

  it('points the arrived annotation at the page it is now ON', async () => {
    const { names, own } = await parentOf(await replacedWithMark(), 2);
    expect(names).toBe(own);
  });
});

/** Pages 2 and 1 of a marked document, extracted in that order. */
async function extractedWithMark(): Promise<Uint8Array> {
  const session = await mupdfWriter.open(await marked());
  try {
    return await extractPages(session, [2, 1]);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('an annotation survives an extract into a NEW document', () => {
  /**
   * The third crossing, and the one that takes a different route entirely.
   *
   * `extractPages` does not use `graftPage` at all: its own header records the
   * measurement that made that choice — `graftPage` drops both `/Annots` and
   * the four catalog entries — so it grafts the page object and inserts it.
   * Nothing here follows from the merge cases: that route carries `/Annots`
   * because the whole page graph goes in one `graftObject`, which is a
   * different reason from the one the merge needed a second call for.
   *
   * The order is reversed on purpose. An extract of `[2, 1]` puts the source's
   * page 1 at output index 1, so *the mark is on page 1* is true before and
   * after — and would be true of an implementation that ignored the order. The
   * page count is what separates them, and the case below asserts it.
   */
  it('arrives on the extracted page, in the order asked for', async () => {
    const extracted = await extractedWithMark();
    const loaded = await PDFDocument.load(extracted, { updateMetadata: false });
    expect(loaded.getPageCount()).toBe(2);
    expect(await marksIn(extracted)).toStrictEqual([{ page: 1, rect: PLACED }]);
  });

  it('points at the page it is now on, which no second call re-pointed', async () => {
    // The merge needed `/P` written explicitly because the page and its
    // annotations crossed in two grafts, and the second carried a `/P` naming
    // the first graft's copy. Here one graft carries the page and everything it
    // references, so the map resolves `/P` to the same object it just made.
    // That is a reason to EXPECT this, and it is not evidence: the assertion is
    // what makes the route's difference from the merge a measured one.
    const { names, own } = await parentOf(await extractedWithMark(), 1);
    expect(names).toBe(own);
  });
});

/** The cross-document commands the cases above exercise. */
const COVERED: readonly CommandKind[] = ['mergeDocument', 'replacePage'];

describe('the set of crossings this file covers', () => {
  it('is every command that declares a second document', () => {
    // DERIVED from the declaration table, because the failure feared makes the
    // set BIGGER: a third command naming a second document arrives with no case
    // here, and a hand-kept list cannot see that. `COVERED` is the anchor the
    // derivation cannot supply — it is a claim about what this FILE exercises,
    // not a second opinion about which kinds carry a source, which the kernel's
    // `sources` axis owns and `commandDeclarations.test.ts` ties to the
    // contract.
    //
    // `extractPages` is the third crossing and is deliberately absent: it is a
    // query rather than a command, so no axis here can name it, and it is
    // covered by the block above rather than by this roster. Stated so its
    // absence reads as a boundary rather than as a gap.
    const crossing = (Object.keys(declaredCommands) as readonly CommandKind[]).filter(
      (kind) => declaredCommands[kind].sources === 'one',
    );
    expect(
      [...crossing].sort(),
      'A command declaring sources: one copies pages out of another document, and whether an ' +
        'annotation arrives with them is a fact about how that copy is made rather than about ' +
        'the page tree. Give it a case in this file, then name it in COVERED.',
    ).toStrictEqual([...COVERED].sort());
  });
});
