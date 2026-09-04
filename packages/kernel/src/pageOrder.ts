import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * Moving a page, and the page-tree rewrite every page operation will take.
 *
 * ## Why the command is a MOVE and not a permutation
 *
 * The spike's reference implementation
 * (`scripts/spike/reorderInPlace.mjs`) takes a full permutation, which is the
 * right shape for a function that already holds the document. It is the wrong
 * shape for a **channel**: a permutation is one integer per page, so the
 * payload scales with the document on every drag, which is the design §2 rules
 * out by name. `movePage` is two integers whatever the file, and this module
 * derives the permutation from them here, where it costs nothing.
 *
 * ## `rearrangePages` IS BANNED, and the reason is measured
 *
 * MuPDF ships a page-selection primitive that would do this in one call. ADR-0006
 * measured it dropping `/AcroForm` **even for the identity permutation**, and
 * the widget annotations survive on their pages — so the fields still render
 * while the field tree is orphaned and the document silently stops being a
 * valid AcroForm. Invariant L6 predicted the failure class; the primitive is
 * not used, and the `/Kids` rewrite below preserves all four catalog entries.
 *
 * ## THE NESTED TREE IS THE HARD SHAPE, and it is invisible on a flat one
 *
 * A page tree may nest, and an intermediate `/Pages` node can carry
 * `/Resources`, `/MediaBox`, `/CropBox` or `/Rotate` that its leaves inherit
 * rather than declare. Two things go wrong if the root `/Kids` is permuted
 * directly, and neither is visible on a flat document:
 *
 * - it permutes **subtrees** rather than pages — a six-page document in two
 *   branches of three comes back `4 5 6 1 2 3` for a request of `6 5 4 3 2 1`;
 * - the leaves lose what they inherited, turning a landscape page portrait
 *   **while the page order still looks correct**.
 *
 * So inheritable attributes are pushed down onto each leaf *before* the tree is
 * flattened, and the root `/Pages` object is **mutated, never replaced** —
 * everything the catalog points at hangs off its identity, and assigning a new
 * `/Pages` is a rebuild wearing an in-place costume.
 */

/** Attributes a leaf may inherit from an ancestor `/Pages` node (PDF 32000-1 §7.7.3.4). */
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'] as const;

/** What a move needs in order to be undone. */
export interface PriorPageOrder {
  /** Where the page was before the move. */
  readonly from: number;
  /** Where it is after it. */
  readonly to: number;
}

/**
 * The destination order a single move produces.
 *
 * Exported because it is the **remap contract's** answer for this command: a
 * consumer holding a page index asks what that index becomes, and the honest
 * way to answer is the same array the write is built from. Deriving it twice —
 * once to rewrite the tree and once to remap a destination — is two opinions
 * about what a move means (B3a), and they would agree until the day one of them
 * was fixed.
 *
 * `permutation[d]` is the SOURCE index that ends up at destination `d`.
 *
 * @param count how many pages the document has
 */
export function movePermutation(count: number, from: number, to: number): readonly number[] {
  const order = Array.from({ length: count }, (_unused, index) => index);
  const [moved] = order.splice(from, 1);
  // `moved` is `number | undefined` under noUncheckedIndexedAccess, and the
  // caller has already bounded `from` — but a splice that removed nothing must
  // not silently insert `undefined` into the order, so it is a refusal.
  if (moved === undefined) throw new RangeError(`page ${String(from)} is not in this document`);
  order.splice(to, 0, moved);
  return order;
}

/**
 * Where a page index ends up after a move — the remap, for one index.
 *
 * **The inverse lookup of {@link movePermutation}**, and derived from it rather
 * than reasoned about: `permutation[d] === s` means the page at source `s` is
 * at destination `d` afterwards. Written as a search over the array the write
 * itself uses, so a consumer's answer cannot disagree with the tree.
 *
 * Returns `null` for an index the document does not have, which is a real state
 * rather than a failure: a stale destination pointing past the end is something
 * a panel renders as unresolvable, exactly as it already renders a `/Dest` that
 * names no page.
 */
export function remapPageIndex(
  count: number,
  move: PriorPageOrder,
  page: number,
): number | null {
  if (page < 0 || page >= count) return null;
  const order = movePermutation(count, move.from, move.to);
  const at = order.indexOf(page);
  return at === -1 ? null : at;
}

/** Follows an indirect reference; `PDFObject.Null` has no document to resolve against. */
function deref(object: PDFObject): PDFObject {
  return object.isNull() ? object : object.resolve();
}

/**
 * Rewrites `/Kids` to `permutation`, in place.
 *
 * The four steps are the spike's, in the order the spike's failing tests
 * established: push inheritables down while the tree that carries them is
 * intact, then flatten, then fix `/Count` and reparent, then reset MuPDF's
 * page-tree cache — without which `loadPage` still answers the old order and
 * the change appears not to have happened.
 */
function leavesWithInheritables(document: PDFDocument): PDFObject[] {
  const leaves: PDFObject[] = [];
  // OVER THE DOCUMENT'S PAGES, not over the caller's list, and the two are the
  // same length only for a permutation. `leaves` is indexed by SOURCE, so a
  // keep-set shorter than the document — every delete — would otherwise stop
  // collecting before it reached the sources it keeps: deleting page 1 of five
  // asks for `leaves[4]` out of an array of four. Found by the first delete
  // case, which is the shape a move could never produce.
  const count = document.countPages();
  for (let index = 0; index < count; index += 1) {
    const page = document.findPage(index);
    for (const key of INHERITABLE) {
      if (page.get(key).isNull()) {
        const inherited = page.getInheritable(key);
        if (!inherited.isNull()) page.put(key, inherited);
      }
    }
    leaves.push(page);
  }
  return leaves;
}

/**
 * Makes `leaves` the document's pages, in order, in place.
 *
 * Separated from {@link rewriteKids} because a duplicate's new order contains a
 * leaf that is **not** one of the document's own — an index-based permutation
 * cannot name it. Every page operation ends here, which is what keeps the
 * flatten, the `/Count` and the reparenting in one place (B3a).
 */
function setKids(document: PDFDocument, leaves: readonly PDFObject[]): void {
  const root = deref(document.getTrailer().get('Root', 'Pages'));
  const kids = document.newArray();
  for (const leaf of leaves) kids.push(leaf);

  root.put('Kids', kids);
  root.put('Count', leaves.length);
  // REPARENTS WHAT IT KEPT, not every leaf it read. For a move the two sets are
  // the same — a permutation names every page — and for a delete they are not:
  // a removed leaf given a `/Parent` pointing at the root is a page that claims
  // to be in a tree whose `/Kids` does not list it, which is the inconsistent
  // half of a page tree that some readers repair by trusting `/Parent`.
  for (const leaf of leaves) leaf.put('Parent', root);

  document.setPageTreeCache(true);
}

function rewriteKids(document: PDFDocument, permutation: readonly number[]): void {
  const leaves = leavesWithInheritables(document);
  setKids(
    document,
    permutation.map((source) => {
      const leaf = leaves[source];
      if (leaf === undefined) throw new RangeError(`page ${String(source)} is not in this document`);
      return leaf;
    }),
  );
}

/**
 * The destination order that removing `removed` produces.
 *
 * A **keep-set**, built once from the original frame, which is what makes the
 * order the indices arrive in irrelevant. Deleting them one at a time is the
 * shape with the defect: each later index needs shifting by how many earlier
 * ones went, and that arithmetic is re-derived at every call site until one of
 * them gets it wrong on a document nobody tested.
 *
 * Duplicates collapse, because a `Set` is what the question is.
 *
 * @param count how many pages the document has
 * @param removed zero-based indices in the document as it stands
 */
export function keptPermutation(count: number, removed: Iterable<number>): readonly number[] {
  const gone = new Set(removed);
  const kept: number[] = [];
  for (let index = 0; index < count; index += 1) if (!gone.has(index)) kept.push(index);
  return kept;
}

/**
 * Where a page index ends up after a delete, or `null` if it was one of them.
 *
 * {@link remapPageIndex}'s sibling, derived from the same array the write uses
 * for the same reason: a consumer's answer must not be able to disagree with
 * the tree. `null` carries two states here — *deleted* and *never existed* —
 * and they are deliberately the same answer, because a destination that no
 * longer resolves is one thing to a panel however it stopped resolving.
 */
export function remapPageIndexAfterDelete(
  count: number,
  removed: Iterable<number>,
  page: number,
): number | null {
  if (page < 0 || page >= count) return null;
  const at = keptPermutation(count, removed).indexOf(page);
  return at === -1 ? null : at;
}

/**
 * The pages a delete would remove, refusing a command this document cannot take.
 *
 * Shared by `capture` and `apply` so the two cannot disagree about which
 * command is legal — the disagreement `applyMovePage`'s own refusal exists to
 * report rather than to cause.
 */
function removableOrThrow(document: PDFDocument, pages: readonly number[]): Set<number> {
  const count = document.countPages();
  const gone = new Set(pages);
  for (const page of gone) {
    if (page >= count) {
      throw new RangeError(
        `page ${String(page)} is outside a document of ${String(count)} page(s). The bus ` +
          `validates against the document it captured, so reaching here means the two disagree.`,
      );
    }
  }
  // REFUSED, and this is the one rule the schema could not carry: it needs the
  // page count. A PDF with an empty `/Kids` is not a document a reader opens,
  // and producing one would turn an undo into the only way back to a file that
  // still parses — which invariant 18 permits and no user expects.
  if (gone.size >= count) {
    throw new RangeError(
      `deleting ${String(gone.size)} of ${String(count)} page(s) would leave a document with ` +
        `none, which is not a PDF a reader can open. Close the document instead.`,
    );
  }
  return gone;
}

/**
 * Reports that a delete's prior state cannot be recorded — **always**.
 *
 * Not a stub. `CommandPrior['deletePages']` is `never`, so the `captured: true`
 * member of this return type cannot be constructed: the only value this
 * function can produce is the refusal below, and the type says so rather than
 * this comment. The bus reads it, takes a checkpoint and applies anyway, which
 * is ADR-0009 §4's declared answer for a non-invertible command.
 *
 * It still **validates**, and that is the point of having it rather than a
 * constant: a command naming a page the document does not have, or naming all
 * of them, must throw here — before `apply` writes — rather than be quietly
 * converted into a checkpoint that reproduces the same failure on redo.
 */
export function captureDeletePages(
  session: MupdfSession,
  command: CommandOfKind<'deletePages'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    const gone = removableOrThrow(document, command.pages);
    return {
      captured: false,
      reason:
        `${String(gone.size)} deleted page(s) cannot be recorded as prior state — a page's ` +
        `objects are document-scaled and have no serialisable inverse`,
    };
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `Invert<'mupdf', 'deletePages'>` takes a `CommandPrior['deletePages']`, which
 * is `never`, so no caller can construct an argument for it and no log entry
 * can carry one. It throws rather than resolving: a reachable path here would
 * mean the type had been widened, and a quiet resolve would let that land as an
 * undo that silently did nothing.
 *
 * Kept rather than omitted because the spec table requires all three functions
 * — the same reasoning `commandLog.ts` gives for keeping a branch no code can
 * reach: the fact it encodes is true, and deleting it moves the failure to
 * whoever widens the type.
 */
export const invertDeletePages: Invert<'mupdf', 'deletePages'> = (): Promise<void> => {
  throw new Error(
    'a deleted page has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};

/**
 * The destination order that exchanging two pages produces.
 *
 * Symmetric in `a` and `b`, which is what makes a swap its own inverse — and
 * the reason that is safe to rely on here where {@link movePermutation}'s
 * transposition is not: nothing between the two indices shifts.
 */
export function swapPermutation(count: number, a: number, b: number): readonly number[] {
  const order = Array.from({ length: count }, (_unused, index) => index);
  const first = order[a];
  const second = order[b];
  if (first === undefined || second === undefined) {
    throw new RangeError(`pages ${String(a)} and ${String(b)} are not both in this document`);
  }
  order[a] = second;
  order[b] = first;
  return order;
}

/** What a swap needs in order to be undone: the same two indices. */
export interface PriorPageSwap {
  readonly a: number;
  readonly b: number;
}

/** Records the pair, as validated against this document. */
export function captureSwapPages(
  session: MupdfSession,
  command: CommandOfKind<'swapPages'>,
): Promise<CaptureResult<PriorPageSwap>> {
  return withDocument(session, (document) => {
    const count = document.countPages();
    if (command.a >= count || command.b >= count) {
      return {
        captured: false,
        reason:
          `swap ${String(command.a)} ↔ ${String(command.b)} is outside this document, which ` +
          `has ${String(count)} page(s), so there is no prior order to record`,
      };
    }
    return { captured: true, prior: { a: command.a, b: command.b } };
  });
}

/**
 * Swaps them back — **the same swap**, and here the transposition is the whole
 * of it.
 *
 * `invertMovePage`'s header warns against writing a transposition because a
 * move's inverse is one only by coincidence. A swap's is not a coincidence:
 * {@link swapPermutation} is symmetric in its two arguments and moves nothing
 * else, so applying it twice is the identity. The double-swap case is what
 * holds that rather than this paragraph.
 */
export const invertSwapPages: Invert<'mupdf', 'swapPages'> = (
  session: MupdfSession,
  inverse: PriorPageSwap,
): Promise<void> =>
  withDocument(session, (document) => {
    rewriteKids(document, swapPermutation(document.countPages(), inverse.a, inverse.b));
  });

/** Exchanges two pages. */
export const applySwapPages: Apply<'mupdf', 'swapPages'> = (
  session: MupdfSession,
  command: CommandOfKind<'swapPages'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    if (command.a >= count || command.b >= count) {
      throw new RangeError(
        `swap ${String(command.a)} ↔ ${String(command.b)} is outside a document of ` +
          `${String(count)} page(s). The bus validates against the document it captured, so ` +
          `reaching here means the two disagree.`,
      );
    }
    rewriteKids(document, swapPermutation(count, command.a, command.b));
  });

/** Where a duplicate's copy landed, which is what its inverse removes. */
export interface PriorPageCopy {
  /** Zero-based index the copy occupies after the command. */
  readonly at: number;
}

/**
 * Records where the copy will land, and validates the source page.
 *
 * The destination is computed HERE and stored, rather than re-derived by the
 * inverse from *"immediately after the source"*. The rule is a placement
 * decision the contract states and a later version may change; an inverse that
 * re-derived it would then remove the wrong page for every entry already in a
 * log — silently, and only for documents open across the change.
 */
export function captureDuplicatePage(
  session: MupdfSession,
  command: CommandOfKind<'duplicatePage'>,
): Promise<CaptureResult<PriorPageCopy>> {
  return withDocument(session, (document) => {
    const count = document.countPages();
    if (command.page >= count) {
      return {
        captured: false,
        reason:
          `page ${String(command.page)} is outside this document, which has ` +
          `${String(count)} page(s), so there is nothing to copy`,
      };
    }
    return { captured: true, prior: { at: command.page + 1 } };
  });
}

/** Removes the page the duplicate added. */
export const invertDuplicatePage: Invert<'mupdf', 'duplicatePage'> = (
  session: MupdfSession,
  inverse: PriorPageCopy,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    rewriteKids(document, keptPermutation(count, [inverse.at]));
  });

/**
 * Copies one page, placing the copy immediately after it.
 *
 * ## MuPDF's own graft is the copy, and that is measured rather than assumed
 *
 * `graftObject` within a single document was probed on 2026-09-04 against a
 * three-page fixture: it returns a **new indirect object** (4 → 7), the two
 * dictionaries diverge independently — `/Rotate 90` written on the copy left
 * the source's absent — and `/Contents` comes back as the **same** indirect
 * object, so duplicating a page does not duplicate its bytes.
 *
 * Writing a dictionary walk here instead would be a second opinion about what
 * copying a PDF object means, and it would agree with MuPDF's on the keys
 * somebody thought of (B3a).
 *
 * ## The shared content stream is a PROPERTY, with a trigger
 *
 * Two pages referencing one `/Contents` is what every application this one
 * replaces produces, and it is why a duplicate costs nothing. It stops being
 * harmless the day content becomes editable: D4's text editing must copy the
 * stream before writing to one of them, or an edit lands on both. That belongs
 * to the feature that can first observe it, and its row carries the trigger —
 * stated here so it is not rediscovered as a bug.
 */
export const applyDuplicatePage: Apply<'mupdf', 'duplicatePage'> = (
  session: MupdfSession,
  command: CommandOfKind<'duplicatePage'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    if (command.page >= count) {
      throw new RangeError(
        `page ${String(command.page)} is outside a document of ${String(count)} page(s). The ` +
          `bus validates against the document it captured, so reaching here means the two ` +
          `disagree.`,
      );
    }

    // THE INHERITABLES ARE PUSHED DOWN BEFORE THE GRAFT, which is the ordering
    // that matters: a leaf still inheriting its `/MediaBox` from an
    // intermediate node grafts without one, and the copy would then take the
    // ROOT's box — a landscape page duplicated as a portrait one, with the
    // order and the page count both correct.
    const leaves = leavesWithInheritables(document);
    const source = leaves[command.page];
    if (source === undefined) throw new RangeError(`page ${String(command.page)} vanished`);

    // GRAFTED FROM THE PUSHED-DOWN LEAF. `leavesWithInheritables` mutates the
    // page objects in place, so this line and `graftObject(findPage(page))` are
    // the same object once it has run — measured, and the reason the ordering
    // above is the whole of what makes the copy correct rather than this
    // expression. Moving the graft above that call reddens the nested case with
    // `[90, 0, 90, 0, 0]`: the copy resolves its rotation against the root.
    const copy = document.graftObject(source);
    setKids(document, [
      ...leaves.slice(0, command.page + 1),
      copy,
      ...leaves.slice(command.page + 1),
    ]);
  });

/** Where an insert put its page, which is what its inverse removes. */
export interface PriorPageInsert {
  /** Zero-based index the new page occupies after the command. */
  readonly at: number;
}

/**
 * Records where the blank page will land, and refuses an index past the end.
 *
 * **`at === count` is legal**, unlike every other command's bound in this file:
 * appending is inserting at the index one past the last page, and a `>=` check
 * copied from `applyMovePage` would refuse the most ordinary use of this
 * command. The off-by-one is stated because the two bounds sit ten lines apart
 * and look the same.
 */
export function captureInsertBlankPage(
  session: MupdfSession,
  command: CommandOfKind<'insertBlankPage'>,
): Promise<CaptureResult<PriorPageInsert>> {
  return withDocument(session, (document) => {
    const count = document.countPages();
    if (command.at > count) {
      return {
        captured: false,
        reason:
          `index ${String(command.at)} is past the end of a document with ` +
          `${String(count)} page(s), so there is nowhere to insert`,
      };
    }
    return { captured: true, prior: { at: command.at } };
  });
}

/** Removes the page the insert added. */
export const invertInsertBlankPage: Invert<'mupdf', 'insertBlankPage'> = (
  session: MupdfSession,
  inverse: PriorPageInsert,
): Promise<void> =>
  withDocument(session, (document) => {
    rewriteKids(document, keptPermutation(document.countPages(), [inverse.at]));
  });

/**
 * Inserts an empty page, sized like the one it follows.
 *
 * ## The geometry comes from a NEIGHBOUR, and which one is the whole question
 *
 * The page *before* the insertion point, or — inserting at the front — the one
 * that will follow. A constant default would be A4 or Letter, and either is
 * wrong for the other's documents; the neighbour is right for every document of
 * one size, which is nearly all of them.
 *
 * `getInheritable` rather than `get`, because a page in a nested tree may
 * declare no box of its own and the value that matters is what it **resolves
 * to**. Reading `get` here would size the new page from the root's box and
 * produce a page that is a different shape from the one beside it, with the
 * count and the order correct.
 *
 * ## An empty document is refused rather than defaulted
 *
 * There is no neighbour to size against, and picking a constant at that one
 * moment would put the arbitrary default back in through the door this
 * function's whole design closes. It is unreachable today — `deletePages`
 * refuses to empty a document — and it is a refusal rather than an assumption
 * so that the day something else can produce one, this says so.
 */
export const applyInsertBlankPage: Apply<'mupdf', 'insertBlankPage'> = (
  session: MupdfSession,
  command: CommandOfKind<'insertBlankPage'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    if (command.at > count) {
      throw new RangeError(
        `index ${String(command.at)} is past the end of a document with ${String(count)} ` +
          `page(s). The bus validates against the document it captured, so reaching here means ` +
          `the two disagree.`,
      );
    }
    if (count === 0) {
      throw new RangeError('a blank page has no neighbour to take its size from');
    }

    // THE PUSH-DOWN FIRST, for `applyDuplicatePage`'s reason: the neighbour's
    // box has to be readable off the leaf, and `leaves` is what the rewrite
    // below is built from either way.
    const leaves = leavesWithInheritables(document);
    const neighbour = leaves[command.at === 0 ? 0 : command.at - 1];
    if (neighbour === undefined) throw new RangeError('the neighbour page vanished');

    const blank = document.addObject(
      buildBlankPage(document, neighbour.get('MediaBox'), neighbour.get('Rotate')),
    );
    setKids(document, [
      ...leaves.slice(0, command.at),
      blank,
      ...leaves.slice(command.at),
    ]);
  });

/**
 * A page dictionary with nothing on it.
 *
 * Built by hand rather than through MuPDF's `addPage`, and the reason is
 * {@link setKids}: `addPage` returns a page that is not yet in the tree and
 * `insertPage` would put it there, which is a **second writer for `/Kids`** —
 * the thing every operation in this file goes through one function to avoid
 * (B3). What is needed here is the dictionary; the tree is `setKids`'.
 *
 * `/Contents` is omitted rather than written as an empty stream. A page with no
 * content stream is what the format says an empty page is, and an empty stream
 * is an object every later operation has to carry for nothing.
 */
function buildBlankPage(document: PDFDocument, box: PDFObject, rotate: PDFObject): PDFObject {
  const page = document.newDictionary();
  page.put('Type', document.newName('Page'));
  page.put('MediaBox', box);
  if (!rotate.isNull()) page.put('Rotate', rotate);
  page.put('Resources', document.newDictionary());
  return page;
}

/**
 * Removes pages.
 *
 * The same `/Kids` rewrite a move takes, with {@link keptPermutation} in place
 * of {@link movePermutation} — one page-tree writer, because two would be two
 * opinions about inheritance push-down and the second would be found by a
 * landscape page that came back portrait (B3a).
 */
export const applyDeletePages: Apply<'mupdf', 'deletePages'> = (
  session: MupdfSession,
  command: CommandOfKind<'deletePages'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const gone = removableOrThrow(document, command.pages);
    rewriteKids(document, keptPermutation(document.countPages(), gone));
  });

/**
 * Records where the page was, before it moves.
 *
 * The capture is the move itself rather than the tree, because a single move is
 * undone by another move — there is no prior structure to hold. What it does
 * carry is the pair **as validated against this document**, so an inverse
 * cannot be built from a `to` the document never had.
 */
export function captureMovePage(
  session: MupdfSession,
  command: CommandOfKind<'movePage'>,
): Promise<CaptureResult<PriorPageOrder>> {
  return withDocument(session, (document) => {
    const count = document.countPages();
    if (command.from >= count || command.to >= count) {
      return {
        captured: false,
        reason:
          `move ${String(command.from)} → ${String(command.to)} is outside this document, ` +
          `which has ${String(count)} page(s), so there is no prior order to record`,
      };
    }
    return { captured: true, prior: { from: command.from, to: command.to } };
  });
}

/**
 * Moves the page back.
 *
 * **DERIVED, not transposed.** `{ from: to, to: from }` is the right answer for
 * a single move and it is right for a reason that does not generalise — nothing
 * else shifted — so writing the transposition here would be a line the next
 * page operation copies into a case where it is wrong. This asks
 * {@link movePermutation} where the moved page ended up and moves it back from
 * there, which is the same question the forward direction asks.
 */
export const invertMovePage: Invert<'mupdf', 'movePage'> = (
  session: MupdfSession,
  inverse: PriorPageOrder,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    rewriteKids(document, movePermutation(count, inverse.to, inverse.from));
  });

/**
 * Moves one page.
 *
 * Bounds are checked before the write, so an out-of-range index is a refusal
 * rather than a document MuPDF was asked to address past its end.
 */
export const applyMovePage: Apply<'mupdf', 'movePage'> = (
  session: MupdfSession,
  command: CommandOfKind<'movePage'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const count = document.countPages();
    if (command.from >= count || command.to >= count) {
      throw new RangeError(
        `move ${String(command.from)} → ${String(command.to)} is outside a document of ` +
          `${String(count)} page(s). The bus validates against the document it captured, so ` +
          `reaching here means the two disagree.`,
      );
    }
    rewriteKids(document, movePermutation(count, command.from, command.to));
  });
