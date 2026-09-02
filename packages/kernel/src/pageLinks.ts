import type * as mupdf from 'mupdf';

import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';

/**
 * The links on a page, read through the engine.
 *
 * ## Two kinds, and the distinction is a SECURITY one rather than a display one
 *
 * A link either goes somewhere inside the document or somewhere outside it.
 * MuPDF answers both as a URI string and `isExternal()` separates them, so this
 * module resolves an internal one to a page index here — inside the engine,
 * which is the only thing that knows how — and leaves an external one as the
 * URI it is.
 *
 * That matters because invariant 24 says opening a document runs none of its
 * content: **no external fetch until the user asks, for that item.** A panel
 * that could not tell the two apart would have to treat every link as either
 * safe or dangerous, and both are wrong. The discriminant is carried, so the
 * surface can offer a jump for one and a confirmation for the other.
 *
 * ## The URI of an internal link is NOT carried
 *
 * It resolves to a page index and that is what a caller needs. Passing the raw
 * destination string on as well would give a renderer a second way to act on a
 * link — and the one thing it must not do is interpret a document's own strings
 * (§3.2, and invariant 20's *main never parses* one layer up).
 */

/** One link on a page. */
export type PageLink =
  | {
      readonly kind: 'internal';
      /** Zero-based, as everything that crosses the contract is. */
      readonly page: number;
      readonly bounds: LinkBounds;
    }
  | {
      readonly kind: 'external';
      /** The URI exactly as the document carries it. Nothing here follows it. */
      readonly uri: string;
      readonly bounds: LinkBounds;
    };

/**
 * A link's rectangle, in MuPDF's own coordinate space.
 *
 * Two corners rather than a size, matching `FitzRect` in the text substrate —
 * MuPDF answers corners, and converting to a size here would be a second shape
 * for one thing the engine already describes.
 *
 * **THE ORIGIN IS TOP-LEFT, which is MuPDF's and not the PDF's**, and it is
 * measured rather than assumed: a `/Rect [10 20 90 40]` on a 200-high page
 * comes back as `y0: 160, y1: 180` (`pageLinks.test.ts`, 2026-09-02). PDF space
 * puts the origin at the bottom-left, so the two differ by a flip about the
 * page height — which is exactly the conversion `monstera/no-bare-y-flip`
 * exists to keep out of call sites.
 *
 * So a consumer that wants to draw one of these over a rendered page converts
 * through `PageTransform` like every other coordinate. Nothing here flips
 * anything: this is the engine's answer, carried as the engine gave it.
 */
export interface LinkBounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Reads one page's links.
 *
 * The page index is validated in full before the read, for `readPageText`'s
 * reason: an out-of-range page is a `RangeError` and never an empty array,
 * because empty is what a consumer reads as *no links on this page*.
 */
export function readPageLinks(session: MupdfSession, page: number): Promise<readonly PageLink[]> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(pageCount)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
    return linksOn(document, page);
  });
}

/**
 * The one place a page's `Link` objects are created and dropped.
 *
 * MuPDF's JS objects hold native memory whose finaliser runs on its own
 * schedule. A page's links are few; a document-wide read is one set per page,
 * and the engine host's job object is what turns *eventually* into a breach.
 * Dropped in `finally`, so a failure part-way through does not leak the rest.
 */
function linksOn(document: mupdf.PDFDocument, page: number): readonly PageLink[] {
  const loaded = document.loadPage(page);
  const links = loaded.getLinks();
  try {
    return links.map((link) => {
      const [x0, y0, x1, y1] = link.getBounds();
      const bounds: LinkBounds = { x0, y0, x1, y1 };
      if (link.isExternal()) return { kind: 'external', uri: link.getURI(), bounds };
      // RESOLVED HERE, because the engine is the only thing that knows how to
      // turn a destination into a page — a named destination, an explicit
      // /XYZ, or a page reference all arrive as one string and all mean a page.
      return { kind: 'internal', page: document.resolveLink(link), bounds };
    });
  } finally {
    for (const link of links) link.destroy();
  }
}
