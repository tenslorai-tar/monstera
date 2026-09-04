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
 * imports are a type and nothing else.
 *
 * ## The scope is stated here, not taken from one command's schema
 *
 * `pagesOf` used to take `CommandOfKind<'cropPages'>['pages']`, which made
 * every later caller's scope structurally *cropPages'* scope. {@link PageScope}
 * is the shape itself, so a third command declaring the same union in its
 * schema resolves through this without naming a command it has nothing to do
 * with.
 */

/**
 * Which pages a command names.
 *
 * `'all'` is not sugar for a list: a list of every page is one integer per
 * page, which is a payload that scales with the document and invariant L11
 * rules out by name. The word crosses the boundary and becomes a list **here**,
 * where the page count is already known.
 */
export type PageScope = 'all' | readonly number[];

/**
 * The pages a scope names, given the document's page count.
 *
 * Zero-based, in ascending order for `'all'`, and **in the caller's own order**
 * for a list — a command that names `[3, 1]` gets `[3, 1]`, because a capture
 * records its prior state in the order the command named its pages and a
 * silently sorted list would put an inverse's entries against the wrong pages.
 *
 * It does **not** validate. An index this document does not have is refused
 * where the page is loaded, with the page count in the message; refusing here
 * as well would be two components deciding what a valid index is, and the one
 * that can name the document is the one that should.
 */
export function pagesOf(scope: PageScope, total: number): readonly number[] {
  if (scope !== 'all') return scope;
  return Array.from({ length: total }, (_unused, index) => index);
}
