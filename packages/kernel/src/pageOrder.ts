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
function rewriteKids(document: PDFDocument, permutation: readonly number[]): void {
  const leaves: PDFObject[] = [];
  for (let index = 0; index < permutation.length; index += 1) {
    const page = document.findPage(index);
    for (const key of INHERITABLE) {
      if (page.get(key).isNull()) {
        const inherited = page.getInheritable(key);
        if (!inherited.isNull()) page.put(key, inherited);
      }
    }
    leaves.push(page);
  }

  const root = deref(document.getTrailer().get('Root', 'Pages'));
  const kids = document.newArray();
  for (const source of permutation) {
    const leaf = leaves[source];
    if (leaf === undefined) throw new RangeError(`page ${String(source)} is not in this document`);
    kids.push(leaf);
  }

  root.put('Kids', kids);
  root.put('Count', permutation.length);
  for (const leaf of leaves) leaf.put('Parent', root);

  document.setPageTreeCache(true);
}

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
