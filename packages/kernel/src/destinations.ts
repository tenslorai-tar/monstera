import type { OutlineEntry } from '@monstera/contract';
import type * as mupdf from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * A document's named destinations, as its outline states them.
 *
 * ## The OUTLINE, and why that is the right source rather than `/Dests`
 *
 * A PDF carries named destinations in two places: the catalogue's `/Dests` name
 * tree, which is a dictionary of anchors, and the outline, which is the tree a
 * reader is shown. MuPDF reads both and answers with the outline — titles a
 * person wrote, in the order that person put them in — while `/Dests` is a set
 * of internal keys that mostly nobody named for reading.
 *
 * A panel wants what a reader would recognise. Asking the engine for the
 * outline is asking the authority the question it already answers; walking
 * `/Dests` here would be this build deciding which anchors are worth showing,
 * which is a second opinion about a document's own structure (§3.2).
 *
 * ## FLATTENED, with the depth kept
 *
 * The tree is real — an outline nests — and a flat list with a `depth` is what
 * a panel renders. Keeping the nesting as nesting would push the tree walk into
 * every consumer, and the first thing each would do is flatten it.
 *
 * **The order is the walk's order**, depth-first, which is the order the
 * document states and the order a reader sees in every other viewer. Nothing
 * here sorts: an outline's order is authored, and re-sorting it would be this
 * build overruling the author.
 */

/**
 * One entry in the document's outline — the CONTRACT's shape, named here.
 *
 * ## One declaration, not two that agree
 *
 * This was an `interface` restating `@monstera/contract`'s `outlineEntrySchema`
 * field for field, and its own note said so: three fields declared twice,
 * structurally identical, with nothing checking they stayed so. Nothing could
 * have. Two identical declarations are mutually assignable and indistinguishable
 * to every type-level test there is, so the drift a check would look for is
 * invisible until a field is added to one of them — which is the moment the
 * check was supposed to be for.
 *
 * So this is an **alias**, and the class is closed by shape rather than by a
 * guard: with one declaration, disagreeing is unrepresentable (B5). A field
 * added to the schema arrives here; a field removed from it is a compile error
 * at whichever reader wanted it.
 *
 * The contract is the right end to own it because this shape **crosses the
 * wire** — `document.destinations` answers with it, and ADR-0040's 2026-09-05
 * extension hands it to a command's `apply` as pre-read data. A schema is where
 * a crossing shape is declared; this module reads a document and fills it.
 *
 * `Readonly` rather than the bare alias, because that is what the four modules
 * naming this type were written against, and a modifier that quietly leaves is
 * a loosening nobody asked for. It costs nothing: TypeScript ignores property
 * `readonly` when it decides assignability, so the two spellings interchange
 * freely and this one refuses a write.
 *
 * **The reason this was backed out of a feature commit did not hold, and that
 * is recorded here rather than dropped.** The note said the alias reaches four
 * modules *"whose inference depends on this being an `interface` with these
 * exact optional-vs-nullable spellings"*. Measured 2026-09-05 by writing it
 * both ways: `npm run typecheck` is clean for `Readonly<OutlineEntry>` **and**
 * for the bare `OutlineEntry`, so no module's inference depended on either the
 * declaration form or the modifiers. What actually blocked the mechanical edit
 * was a NAME COLLISION inside this one file — the MuPDF tree node below was
 * also called `OutlineEntry` — which is a rename, not four files. The size of
 * the change was estimated from the number of modules that name the type, and
 * naming a type is not depending on how it is declared.
 *
 * Why `page` is nullable rather than optional, and why `null` is a real state
 * rather than a failure, is at the contract's `outlineEntrySchema`.
 */
export type Destination = Readonly<OutlineEntry>;

/**
 * How deep the reader walks.
 *
 * A bound rather than none, because the outline comes from the document and a
 * document is hostile by invariant 25's premise: a `/Outlines` tree with a cycle
 * in it walks for ever. MuPDF resolves the tree into plain objects before this
 * sees it, so a cycle would already have been a problem for the engine — but
 * *the engine handled it* is an assumption, and a bound costs one comparison.
 *
 * Ten is far past any authored outline; a document nesting deeper than that has
 * a table of contents nobody could read.
 */
const MAX_DEPTH = 10;

/**
 * How many entries cross.
 *
 * The same argument as the depth, on the axis a real document actually
 * stretches: a long technical manual carries hundreds of headings. Four
 * thousand is past what a panel could present and short of what a hostile
 * document could try.
 */
const MAX_ENTRIES = 4096;

/**
 * What this reader needs from an outline entry.
 *
 * **`OutlineItem` is not exported by the `mupdf` package**, so the shape is
 * declared rather than imported. Declared MINIMALLY on purpose: naming only the
 * four fields this walk reads means a package that adds a fifth changes
 * nothing here, and a package that removes one of these four is a compile
 * error at the point that depends on it.
 *
 * The optionality mirrors the package's own: `title` and `page` are declared
 * optional there, and treating either as guaranteed is how a reader ends up
 * with `undefined` in a string.
 *
 * **Named for the package it describes**, not for what this module answers
 * with. It was `OutlineEntry` while `Destination` was a local interface; the
 * two now differ only in that one is MuPDF's tree node and the other is the
 * wire's flattened row, and a file where those share a name is one where the
 * wrong import reads correctly.
 */
interface MupdfOutlineItem {
  readonly title?: string | undefined;
  readonly page?: number | undefined;
  readonly down?: readonly MupdfOutlineItem[] | undefined;
}

/** Reads the document's outline, flattened. */
export function readDestinations(session: MupdfSession): Promise<readonly Destination[]> {
  return withDocument(session, (document) => flatten(document));
}

function flatten(document: mupdf.PDFDocument): readonly Destination[] {
  // NULL IS "THIS DOCUMENT HAS NO OUTLINE", which is the common case and not a
  // failure — most documents carry none. An empty list is the honest answer and
  // a panel says so.
  const outline = document.loadOutline();
  if (outline === null) return [];

  const found: Destination[] = [];
  const walk = (items: readonly MupdfOutlineItem[], depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const item of items) {
      if (found.length >= MAX_ENTRIES) return;
      found.push({
        // A TITLE IS REQUIRED BY THE SHAPE AND OPTIONAL IN THE FORMAT. An entry
        // with none is a row a reader cannot identify, so it takes the empty
        // string and the panel decides what to show — rather than this dropping
        // it, which would silently renumber everything below it.
        title: item.title ?? '',
        page: typeof item.page === 'number' ? item.page : null,
        depth,
      });
      if (item.down !== undefined) walk(item.down, depth + 1);
    }
  };
  walk(outline, 0);
  return found;
}
