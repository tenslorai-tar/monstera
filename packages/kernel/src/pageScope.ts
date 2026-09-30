/**
 * What a command's page **scope** names, resolved once.
 *
 * ## Why this is a module and not a function in `pageCrop.ts`, where it began
 *
 * `cropPages` introduced the `'all' | number[]` scope and `pagesOf` was
 * exported from beside it, with a comment saying exactly why: *"the capture and
 * the apply must resolve it identically — two readings of what `all` means is
 * the second opinion B3a is about"*. That argument was right and its reach was
 * one file.
 *
 * `watermarkPages` is the second command to take a scope, and it is routed to a
 * **byte-image** writer that runs in `main`. `pageCrop.ts` imports
 * `withDocument` from `mupdfWriter.ts`, so importing `pagesOf` from there would
 * bind the MuPDF native library in `main` — invariant 20's exact prohibition,
 * measured at +40.1 MB (ADR-0026). The alternatives were both worse than a
 * module: re-deriving four lines in the watermark is the third opinion B3a's
 * own record says arrives *inside the hour, written by the author who just
 * consolidated the other two*; and moving `pagesOf` into `commandDeclarations.ts`
 * would put an implementation in the file whose whole property is having none.
 *
 * So the resolver moves somewhere both sides can reach, which is a module whose
 * only import is the contract — no engine, so `main` may load it.
 *
 * ## The scope is stated here, not taken from one command's schema
 *
 * `pagesOf` used to take `CommandOfKind<'cropPages'>['pages']`, which made
 * every later caller's scope structurally *cropPages'* scope. {@link PageScope}
 * is the shape itself, so a third command declaring the same union in its
 * schema resolves through this without naming a command it has nothing to do
 * with.
 */

import { type PageSet, pagesOfSet } from '@monstera/contract/host';

/**
 * Which pages a command names: `'all'`, or single pages and runs (`@monstera/contract`'s `pageSet.ts`, decision D).
 *
 * `'all'` is not sugar for a list: a list of every page is one integer per
 * page, which is a payload that scales with the document and invariant L11
 * rules out by name. The word crosses the boundary and becomes a list **here**,
 * where the page count is already known — and a run does the same for any
 * stretch of pages.
 */
export type PageScope = 'all' | PageSet;

/**
 * THE ONE REFUSAL for a page index a document does not have — thrown by every loader here and by the expansion below,
 * so the words and the class are the same whether the index arrived alone, inside a run, or from a read.
 */
export function refusePageOutside(page: number, total: number): never {
  throw new RangeError(
    `Page ${String(page)} is outside this document, which has ${String(total)} page(s). Page indices are zero-based.`,
  );
}

/** `page`, where this document has it; {@link refusePageOutside} otherwise. */
export function pageInDocument(page: number, total: number): number {
  if (!Number.isInteger(page) || page < 0 || page >= total) refusePageOutside(page, total);
  return page;
}

/**
 * The pages a scope names, given the document's page count.
 *
 * Zero-based, in ascending order for `'all'`, and **in the caller's own order**
 * for a set — a command that names `[3, 1]` gets `[3, 1]`, because a capture
 * records its prior state in the order the command named its pages and a
 * silently sorted list would put an inverse's entries against the wrong pages.
 *
 * A run past the document is refused BEFORE it is listed, so a run of millions against a short document is a
 * refusal and never a list of millions; a single index is still refused where its page is loaded, by the same
 * {@link refusePageOutside}.
 */
export function pagesOf(scope: PageScope, total: number): readonly number[] {
  if (scope === 'all') return Array.from({ length: total }, (_unused, index) => index);
  return pagesOfSet(scope, total, refusePageOutside);
}
