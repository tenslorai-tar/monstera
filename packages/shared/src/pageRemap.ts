/**
 * The **remap contract**: where a page index ends up after a page operation.
 *
 * ## Why this is in `shared` and not in the kernel
 *
 * It was in `packages/kernel/src/pageOrder.ts`, beside the writes it is derived
 * from, and for a range nothing outside a test called it — *"the arithmetic is
 * proven and the invariant is not"*. The consumer that needs it is the
 * renderer's back-stack (`documentStores.ts`' `history`), and
 * `eslint.config.js` gives `ui` the reach `['shared', 'contract']`: it may not
 * import `@monstera/kernel/engine`, where these lived.
 *
 * So the caller was never missing. It was **unreachable**, and what was owed
 * was a move rather than a feature. The arithmetic is pure — no session, no
 * engine, no document — and `PriorPageOrder` is two numbers, so nothing about
 * it belonged behind a subpath that binds a native library.
 *
 * ## The kernel still owns the WRITES, and re-exports these
 *
 * `pageOrder.ts` re-exports every symbol here, so the permutations the tree
 * rewrite is built from are still the permutations a consumer asks about —
 * literally the same functions. That is the property the whole contract rests
 * on: *deriving it twice, once to rewrite the tree and once to remap a
 * destination, is two opinions about what a move means* (B3a), and they would
 * agree until the day one of them was fixed.
 *
 * ## `null` is a real state, in both directions
 *
 * A page that was deleted and a page the document never had are the same answer
 * deliberately: a destination that no longer resolves is one thing to a panel
 * however it stopped resolving.
 */

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
export function remapPageIndex(count: number, move: PriorPageOrder, page: number): number | null {
  if (page < 0 || page >= count) return null;
  const order = movePermutation(count, move.from, move.to);
  const at = order.indexOf(page);
  return at === -1 ? null : at;
}

/**
 * The destination order a delete produces — the pages that remain, in order.
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
 * and they are deliberately the same answer.
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
