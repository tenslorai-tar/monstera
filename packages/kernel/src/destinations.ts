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

/** One entry in the document's outline. */
/**
 * ONE SHAPE, DECLARED TWICE, and this note is the record of it rather than a
 * fix.
 *
 * `@monstera/contract`'s `outlineEntrySchema` declares the same three fields —
 * it has to, because this shape crosses the wire — and since ADR-0040's
 * 2026-09-05 extension the kernel seam names it too, as what a command's
 * `apply` is handed. The three are structurally identical, so they are mutually
 * assignable and nothing converts; what is missing is a check that they stay
 * so.
 *
 * Aliasing this to the contract's type was attempted 2026-09-05 and backed out:
 * it reaches four other modules whose inference depends on this being an
 * `interface` with these exact optional-vs-nullable spellings, and a
 * consolidation that changes four unrelated files is its own unit rather than a
 * step inside a feature. **Owed:** the alias, in its own commit.
 */
export interface Destination {
  /** What the author called it. */
  readonly title: string;
  /**
   * The page it goes to, zero-based, or `null` when it resolves to none.
   *
   * **`null` is a real state, not a failure.** An outline may carry an entry
   * pointing at an external URI, or at a destination the document does not
   * define — and both are things a reader should see rather than have silently
   * dropped, because a gap in a table of contents is more confusing than an
   * entry that cannot be followed.
   *
   * **`null` and not an absent property**, because this shape crosses a
   * boundary as JSON and JSON cannot carry `undefined`. An optional property
   * would mean the wire spelling and this one differ, with a conversion nobody
   * would remember at each end; a value that travels is one spelling
   * throughout.
   */
  readonly page: number | null;
  /** How deep in the outline it sits. The top level is 0. */
  readonly depth: number;
}

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
 */
interface OutlineEntry {
  readonly title?: string | undefined;
  readonly page?: number | undefined;
  readonly down?: readonly OutlineEntry[] | undefined;
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
  const walk = (items: readonly OutlineEntry[], depth: number): void => {
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
