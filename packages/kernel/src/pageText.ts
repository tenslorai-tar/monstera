import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { type PageText, STEXT_OPTION_STRING, parsePageText } from './textStructure.js';

/**
 * One page's text, read from a live session through the engine's own
 * structuring.
 *
 * The sibling of `readPageGeometry`, and deliberately built the same way: one
 * pass inside one `withDocument`, because a per-page call is a native round trip
 * each and, through the remote writer, a **message** each.
 *
 * ## Why `asJSON` rather than `walk`
 *
 * `StructuredText` offers both. `walk` hands back callbacks per character and
 * would make this module reconstruct lines and blocks from chars — which is the
 * clusterer [ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
 * rejected, arriving through a different door. `asJSON` is MuPDF's own
 * serialisation of the structure it computed, and `parsePageText` is the one
 * reader of it.
 *
 * The scale is left at its default of 1, so coordinates arrive in the page's
 * own units. Scaling here would bake a rendering decision into an extraction
 * path, which is the coordinate confusion invariant L3 exists to prevent.
 */
export interface PageTextResult {
  /** The document's page count, so a caller can bound a search without a second call. */
  readonly pageCount: number;
  /** One entry per requested page, in the order requested. */
  readonly pages: readonly PageText[];
}

/**
 * Reads the named pages' text.
 *
 * @param pages zero-based indices, as `commands.ts` declares them. An index
 *   outside the document is a `RangeError` rather than an empty page, for the
 *   reason `readPageGeometry` gives about a plausible upright rotation: an
 *   empty page is the reassuring answer, and a caller that asked about a page
 *   that does not exist has a bug its consumer would silently absorb.
 */
export function readPageText(
  session: MupdfSession,
  pages: readonly number[],
): Promise<PageTextResult> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    // VALIDATED IN FULL BEFORE THE FIRST READ, so a half-read answer whose
    // length matches the request and whose contents describe a different set of
    // pages is unrepresentable rather than undetectable.
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
        throw new RangeError(
          `Page ${String(page)} is outside this document, which has ${String(pageCount)} ` +
            'page(s). Page indices are zero-based.',
        );
      }
    }

    const read = pages.map((number) => {
      const structured = document.loadPage(number).toStructuredText(STEXT_OPTION_STRING);
      try {
        return parsePageText(structured.asJSON());
      } finally {
        // MuPDF's JS objects hold native memory that the finaliser frees on its
        // own schedule. A page of text is small; a document-wide search is one
        // per page, and the engine host's job object is what turns "eventually"
        // into a breach. Dropped in `finally` so a parse failure does not leak
        // the structure it failed to read.
        structured.destroy();
      }
    });

    return { pageCount, pages: read };
  });
}
