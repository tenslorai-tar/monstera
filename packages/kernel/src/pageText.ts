import type * as mupdf from 'mupdf';

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

    const read = pages.map((number) => parsePageText(structuredJson(document, number)));

    return { pageCount, pages: read };
  });
}

/**
 * One page's structured text as MuPDF's JSON, unparsed.
 *
 * **The host's reader** — `hostEntry.ts` hands this to the engine handlers, so
 * the hostile process produces the payload and forms no opinion about it.
 * `parsePageText` is the one reader of the format and it runs main-side (§3.2),
 * which is what keeps a second interpretation of MuPDF's tree from existing.
 *
 * The page index is validated the same way {@link readPageText} validates its
 * array: a page outside the document is a `RangeError`, never an empty answer,
 * because empty is what a consumer reads as *no text here*.
 */
export function readPageTextJson(session: MupdfSession, page: number): Promise<string> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(pageCount)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
    return structuredJson(document, page);
  });
}

/**
 * The one place a `StructuredText` is created and dropped.
 *
 * MuPDF's JS objects hold native memory the finaliser frees on its own
 * schedule. A page of text is small; a document-wide search is one per page,
 * and the engine host's job object is what turns *eventually* into a breach.
 * Dropped in `finally`, so a failure between the call and the string does not
 * leak the structure it failed to read.
 *
 * @param document the open document, inside a `withDocument`
 * @param page a zero-based index the caller has already validated
 */
function structuredJson(document: mupdf.PDFDocument, page: number): string {
  const structured = document.loadPage(page).toStructuredText(STEXT_OPTION_STRING);
  try {
    return structured.asJSON();
  } finally {
    structured.destroy();
  }
}
