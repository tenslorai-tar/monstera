import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFGraftMap } from './mupdfRaw.js';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { removeFieldsOnPages } from './formFields.js';
import { withDocumentList, withDocuments } from './mupdfWriter.js';
import { graftingWithoutPageTree } from './pageGraft.js';
import { pagesOf } from './pageScope.js';

/**
 * Another document's pages, copied into this one
 * ([ADR-0040](../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)).
 *
 * `docs/ARCHITECTURE.md:372` assigns *"Page tree ops:
 * delete/insert/extract/merge/split/crop/resize"* to MuPDF — **merge** is this
 * row, and it is the one ADR-0040 was written for: the first command whose
 * `apply` is handed a second session.
 *
 * (That quotation is not emphasised in place, and the reason is mechanical. An
 * emphasised `merge` inside the slash-separated list spells `**merge**` before
 * `/split`, which is `*` immediately followed by `/` — the sequence that ENDS a
 * block comment. It closed this one and produced 568 unrelated errors. Same
 * family as the emitted-template backtick class: prose and code sharing a
 * delimiter, in a file where the prose is long enough that nobody is looking
 * for one.)
 *
 * ## `graftPage` IS THE CALL, and the alternative is wrong in a way nothing
 * renders
 *
 * Measured 2026-09-05 against a source whose leaves inherit `/Rotate 90` from
 * an intermediate `/Pages` node — the nested shape the audit checklist names
 * and the one that bit `duplicatePage`:
 *
 * | route | the copy's `/Rotate` | the copy's `/Parent` |
 * |---|---|---|
 * | `graftObject` + a `/Kids` push | absent from the leaf | `6 0 R` — **a grafted copy of the source's intermediate node** |
 * | `graftPage` | `90`, written onto the leaf | `1 0 R` — the target's own page-tree root |
 *
 * The target's real root is `1 0 R` in both. So the raw graft produces a page
 * that is listed in one node's `/Kids` and names a **different** node as its
 * parent, with a phantom two-kid subtree reachable beside the real tree.
 *
 * **Both render identically.** pdf-lib reads the rotation as 90 for each,
 * because inheritance walks the wrong chain and arrives at the right answer. A
 * proof asserting page count, order, sizes and rotations passes on the broken
 * document — which is why `pageMerge.test.ts` asserts the **parent chain**, and
 * why this is written here rather than left to whoever reads the diff.
 *
 * ## So `pageOrder.ts`' one-`/Kids`-writer rule yields, on evidence
 *
 * B3 puts every `/Kids` rewrite through `pageOrder.ts`, and `graftPage` writes
 * `/Kids` itself. That rule yields here as B3a rather than as an exception:
 * *copy a page between documents* is a question MuPDF already answers, the
 * hand-rolled alternative was measured to disagree with it structurally, and
 * `duplicatePage`'s own note makes the same argument for `graftObject` **within**
 * one document — where there is no foreign parent chain to inherit, which is
 * exactly why that pattern does not cross the boundary with it.
 *
 * This is not `rearrangePages`' situation. That call was measured to DROP
 * `/AcroForm` even for the identity permutation (ADR-0006), which is why L6
 * exists; `graftPage` was measured to leave the target's catalog entries in
 * place. Same engine, opposite result, and only running them tells you which.
 *
 * ## The SOURCE is never modified
 *
 * `graftPage` reads it. That is what lets the log hold one entry against the
 * target and nothing against the source, and what makes a merge safe to run
 * against a document open in another tab.
 */

/**
 * Grafts `pages` of `from`, in their order, from `at` onwards, with the annotations `graftPage` leaves behind.
 *
 * ## `graftPage` DOES NOT CARRY `/Annots`, measured 2026-09-06
 *
 * A source page whose `/Annots` is `[9 0 R]` produces a grafted page whose
 * `/Annots` is **null** — every page of the merged document, in a direct probe
 * against MuPDF 1.28.0. Nothing in the declaration says so and nothing in this
 * build noticed: a merged document renders correctly, has the right page count
 * in the right order, and is missing every comment, highlight and mark the
 * source carried.
 *
 * It was found by Stage 3 measuring the property `docs/FEATURES.md` states as
 * *"annotations survive page ops"* — which is the point of measuring a property
 * rather than reasoning to it. The reasoning was sound and covered a different
 * call: a page carries its `/Annots` wherever the page TREE moves it, which is
 * true of `movePage` and `deletePages` and says nothing about a copy between
 * documents.
 *
 * ## Three things have to arrive, and only the first is obvious
 *
 * - **the array**, grafted through the same map as the page, so an appearance
 *   stream shared between two annotations stays one object rather than two;
 * - **the appearance stream** each annotation points at, which the graft brings
 *   because it follows references;
 * - **the `/P` back-pointer**, which the graft copies verbatim and which
 *   therefore names *the source's page*. Left alone it is a page in another
 *   document — a dangling identity join of exactly the kind §3 bans — so each
 *   annotation is re-pointed at the page it is now on.
 *
 * ## ONE GRAFT MAP for the whole operation
 *
 * `PDFDocument.graftPage` mints an implicit map per call, so a source's shared
 * objects are copied once per page. A map held across the loop keeps them
 * shared, and it is what lets the annotations be grafted into the same identity
 * space as the page they belong to. The parent-chain walk in
 * `pageMerge.test.ts` is the control that says the page tree is unaffected —
 * that walk is why this module uses `graftPage` at all.
 */
function graftPagesWithAnnotations(
  map: PDFGraftMap,
  target: PDFDocument,
  from: PDFDocument,
  at: number,
  pages: readonly number[],
): void {
  pages.forEach((page, offset) => {
    map.graftPage(at + offset, from, page);
  });

  // THE ANNOTATIONS WITH THE SOURCE'S TREE DETACHED, after every page is placed: `graftPage` reads inherited
  // attributes up `/Parent`, and an annotation's `/P` names a source leaf whose `/Parent` reaches every page of the
  // source (`pageGraft.ts`) — measured as a second copy of each page's dictionary and of the tree above it.
  graftingWithoutPageTree(from, () => {
    pages.forEach((page, offset) => {
      // `findPage` walks `/Kids` and reads no `/Parent`; `loadPage` would build a page from an inheritance it cannot see.
      const annots = from.findPage(page).get('Annots');
      if (annots.isNull()) return;

      const onto = target.loadPage(at + offset).getObject();
      const grafted = map.graftObject(annots);
      onto.put('Annots', grafted);
      for (let index = 0; index < grafted.length; index += 1) {
        grafted.get(index).put('P', onto);
      }
    });
  });
}

/**
 * The target's pages a replace names, ascending and each once: the set is the pages being replaced, so a page named
 * twice is still one page and the pairing reads them in document order.
 */
function replacedPages(command: CommandOfKind<'replacePage'>, total: number): readonly number[] {
  return [...new Set(pagesOf(command.pages, total))].sort((a, b) => a - b);
}

/**
 * Copies the chosen pages of `source` (`sourcePages`, every page for `'all'`) into the target, starting at
 * `command.at`. A source page the source does not have is refused, by `pageScope.ts`' one refusal.
 *
 * ## Pages are grafted in order, each one index further along
 *
 * `graftPage(to, srcDoc, srcPage)` inserts one page at `to`, so appending the
 * source's page `n` at `at + n` walks the block forward as it is built. Writing
 * `at` for every page would reverse the source's order — it would insert each
 * new page ahead of the ones already placed — and the result renders as a
 * complete merge with the pages backwards, which is the failure a fixture of
 * identical pages cannot see.
 *
 * ## The insertion point is clamped, never refused
 *
 * `insertImagePage`'s rule and its reason: `at` is in the destination frame, so
 * the one value past the end a caller can name is *after the last page*, which
 * is a real request. Refusing it would make *merge onto the end* an error on a
 * document whose length the renderer knows only from a version it may already
 * have lost.
 *
 * ## A zero-page source is UNREACHABLE in this build, and the loop bound is all
 * that handles it
 *
 * Stated rather than covered, because two attempts at a fixture failed for
 * different reasons and both are worth knowing. `PDFDocument.create()` reports
 * zero pages and **writes one on save** — measured 2026-09-05, `getPageCount()`
 * 0 before and 1 after a round trip, and MuPDF agrees. Emptying a document
 * through `applyDeletePages` is refused on purpose: *"deleting 1 of 1 page(s)
 * would leave a document with none, which is not a PDF a reader can open."*
 *
 * So no path this build has produces the input, and `pageMerge.test.ts` asserts
 * that refusal instead — the thing that makes the branch unreachable, so the
 * day it stops refusing, the case goes red and a real merge case becomes
 * writable. Writing a merge case against a fixture that secretly has a page
 * would be coverage of a branch nothing reached.
 */
export const applyMergeDocument: Apply<'mupdf', 'mergeDocument', 'several'> = (
  session: MupdfSession,
  command: CommandOfKind<'mergeDocument'>,
  sources: readonly [MupdfSession, ...MupdfSession[]],
): Promise<void> =>
  withDocumentList(session, sources, (target, documents) => {
    // EVERY PART'S PAGES ARE CHECKED BEFORE ANY IS GRAFTED (ADR-0152): an index a later document does not have refuses
    // the merge with nothing placed, never after the documents before it went in.
    const parts = command.documents.map((part, index) => {
      const from = documents[index];
      const token = sources[index];
      if (from === undefined || token === undefined) {
        throw new Error('unreachable: the bus resolves one session for each document the merge names');
      }
      return { from, token, pages: pagesOf(part.sourcePages, from.countPages()) };
    });

    // ONE MAP PER SOURCE DOCUMENT FOR THE WHOLE MERGE. See `graftPagesWithAnnotations`: a map keeps a source's shared
    // objects shared across the pages that reference them, and puts the annotations in the same identity space as
    // their page. It is keyed by its source because a map belongs to ONE: MuPDF binds it to the document of the first
    // indirect object it grafts and refuses any other (`pdf-graft.c`, *"grafted objects must all belong to the same
    // source document"*, MuPDF 1.28.0). A document named twice reuses its map, so its shared objects are copied once.
    const maps = new Map<MupdfSession, PDFGraftMap>();
    let at = Math.min(command.at, target.countPages());
    for (const { from, token, pages } of parts) {
      const map = maps.get(token) ?? target.newGraftMap();
      maps.set(token, map);
      // READ FROM `from` AND WRITTEN INTO `target`, which is the one line where
      // a transposition would be silent: both are `PDFDocument` and both are
      // `MupdfSession` upstream, so nothing in the type system separates them.
      // `withDocumentList` names its parameters for this reason.
      graftPagesWithAnnotations(map, target, from, at, pages);
      at += pages.length;
    }
  });

/**
 * Replaces target pages with chosen pages of `source`, by the pairing the contract states (`replacePageSchema`).
 *
 * ## INSERT FIRST, THEN DELETE, and the order is the whole of it
 *
 * Deleting first would leave a one-page document holding **no pages** between
 * the two calls — a state `pageOrder.ts` refuses outright because it is not a
 * PDF a reader can open, reached here through a different door. Inserting
 * first means the document is never shorter than it started.
 *
 * The consequence is that a page being replaced has MOVED by the time it is
 * deleted: it sits after the pages just placed in front of it. Computing that
 * index from the count placed rather than re-finding the page is what keeps
 * the two halves in step.
 *
 * ## The same number of each pairs IN PLACE, one page at a time
 *
 * Each pair inserts one page and deletes one, so the document's length never
 * changes between pairs and the next pair's index is still the one the person
 * chose — which is what lets pages that are not next to each other be replaced
 * at all.
 *
 * ## MuPDF's own `deletePage`, for `graftPage`'s reason
 *
 * This command is delegated to the authority end to end rather than half of it,
 * and `pageMerge.test.ts` asserts the target's catalog entries survive — the
 * check `rearrangePages` fails and the reason invariant L6 exists. A
 * declaration is not behaviour, so the assertion is the evidence.
 */
export const applyReplacePage: Apply<'mupdf', 'replacePage', 'one'> = (
  session: MupdfSession,
  command: CommandOfKind<'replacePage'>,
  [source]: readonly [MupdfSession],
): Promise<void> =>
  withDocuments(session, source, (target, from) => {
    // EACH REPLACED PAGE MUST EXIST, unlike an insert's index, which may be one past the end: clamping would replace the
    // last page for a caller who asked for one past it.
    const replaced = replacedPages(command, target.countPages());
    const taken = pagesOf(command.sourcePages, from.countPages());
    const map = target.newGraftMap();
    // A REPLACED PAGE'S FIELDS LEAVE WITH IT, as every page that leaves takes them (ADR-0151).
    const remove = (page: number): void => {
      removeFieldsOnPages(target, [page]);
      target.deletePage(page);
    };

    if (taken.length === replaced.length) {
      replaced.forEach((page, index) => {
        const sourcePage = taken[index];
        if (sourcePage === undefined) throw new Error('unreachable: the two lists have the same length');
        graftPagesWithAnnotations(map, target, from, page, [sourcePage]);
        // SHIFTED BY THE ONE PAGE JUST PLACED IN FRONT OF IT.
        remove(page + 1);
      });
      return;
    }

    const first = replaced[0] ?? 0;
    if (replaced.some((page, index) => page !== first + index)) {
      throw new RangeError(
        `Replacing ${String(replaced.length)} pages that are not next to each other needs as many pages to put in ` +
          `their place; ${String(taken.length)} were chosen. Choose ${String(replaced.length)} pages, or replace ` +
          'pages that are next to each other.',
      );
    }
    graftPagesWithAnnotations(map, target, from, first, taken);
    // THE RUN NOW STARTS after the pages just placed, and closes up as each is deleted, so each deletion is at the same
    // index.
    replaced.forEach(() => {
      remove(first + taken.length);
    });
  });

/**
 * Reports that prior state cannot be recorded, always.
 *
 * `insertImagePage`'s shape and its reason, with one addition worth stating:
 * the checkpoint the bus takes instead is of the **target**, and the source
 * needs no entry because a merge does not modify it (ADR-0040).
 *
 * Not a throw — ADR-0009's 2026-08-19 decision makes *this command is not
 * invertible* an outcome the bus answers with a checkpoint. The reason is
 * returned rather than assumed because the bus puts it in the log entry, and a
 * checkpoint whose reason reads *"unknown"* is one nobody can audit later.
 */
export const captureMergeDocument = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'merging has no recordable prior state: undoing it means removing the grafted pages and ' +
      "everything they reach, which is deletePages' argument in the other direction. The " +
      'checkpoint is of the target; the source is not modified and needs no entry',
  });

/**
 * Unreachable, and it exists because the seam's shape requires it.
 *
 * `CommandPrior['mergeDocument']` is `never`, so no value of the parameter type
 * can be constructed and nothing can call this. It throws rather than returning
 * quietly, which is the opposite of `invertInsertImagePage`'s choice next door
 * and deliberate: that one is a byte-image writer whose only honest no-op is
 * returning the image it was given, and this one mutates in place and returns
 * nothing — so *did nothing* and *silently failed to undo a merge* would be the
 * same observation. Undo restores the checkpoint the bus took.
 */
export const invertMergeDocument: Invert<'mupdf', 'mergeDocument'> = (): Promise<void> => {
  throw new Error(
    'mergeDocument has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Reports that prior state cannot be recorded, always.
 *
 * Written out rather than aliased to {@link captureMergeDocument}: the reason
 * travels into the log entry, and a merge's sentence recorded against a replace
 * names the wrong operation to whoever audits it later. The substance differs
 * too — this one destroys a page as well as adding some.
 */
export const captureReplacePage = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'replacing a page has no recordable prior state: the page that was there is an object and ' +
      'everything it reaches, which is document-scaled and has no serialisable form. The ' +
      'checkpoint is of the target; the source is not modified',
  });

/** Unreachable, for {@link invertMergeDocument}'s reason. */
export const invertReplacePage: Invert<'mupdf', 'replacePage'> = (): Promise<void> => {
  throw new Error(
    'replacePage has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

