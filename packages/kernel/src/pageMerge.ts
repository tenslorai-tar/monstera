import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocuments } from './mupdfWriter.js';

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
 * Copies every page of `source` into the target, starting at `command.at`.
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
export const applyMergeDocument: Apply<'mupdf', 'mergeDocument', 'one'> = (
  session: MupdfSession,
  command: CommandOfKind<'mergeDocument'>,
  source: MupdfSession,
): Promise<void> =>
  withDocuments(session, source, (target, from) => {
    const count = target.countPages();
    const at = Math.min(command.at, count);
    const pages = from.countPages();

    for (let page = 0; page < pages; page += 1) {
      // READ FROM `from` AND WRITTEN INTO `target`, which is the one line where
      // a transposition would be silent: both are `PDFDocument` and both are
      // `MupdfSession` upstream, so nothing in the type system separates them.
      // `withDocuments` names its parameters for this reason.
      target.graftPage(at + page, from, page);
    }
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

