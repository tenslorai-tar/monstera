import type { CommandOfKind } from '@monstera/contract';
import type { PageTransform } from '@monstera/shared';
import type * as mupdf from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { frameOf, placedRect, touchesPage } from './pageAnnotations.js';

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
/**
 * Adds a link over a rectangle of one page.
 *
 * ## It lives here rather than in `pageAnnotations.ts`, and that is MEASURED
 *
 * A `/Link` is a `/Annot` in the file and is not an annotation in MuPDF's
 * model. Measured 2026-09-06 against MuPDF 1.28.0: `createLink(bbox, uri)`
 * makes one that `getLinks()` returns and `getAnnotations()` does **not**,
 * while `createAnnotation('Link')` makes a different object that joins the
 * annotation walk, is refused `setRect` — *"Link annotations have no Rect
 * property"* — and never appears among the page's links.
 *
 * So the two APIs write the same `/Subtype` and produce different objects, and
 * only one of them is a link a reader can follow. Routing this through the
 * annotation table would have taken the second, silently: `applyAddAnnotation`
 * calls `createAnnotation`, and the failure is a document that renders a
 * rectangle nobody can click.
 *
 * The consequences are worth stating rather than discovering: a link is
 * invisible to the annotation walk, so the annotations panel does not list one,
 * the eraser cannot remove one and the select tool cannot move one.
 * `document.pageLinks` and `LinksPanel` are what answer for links, and removing
 * one is a row this stage does not carry.
 *
 * ## `srcRef` DOES NOT MARK IT
 *
 * The scheme is a private key on an annotation's dictionary
 * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)),
 * and MuPDF's `Link` exposes no object to put one on. So a link this build
 * wrote is indistinguishable from one the document arrived with — which costs
 * nothing today, because nothing reads provenance for links, and is written
 * down because *the mark covers every object we author* would otherwise read as
 * true.
 *
 * ## The rectangle goes in the page's DISPLAYED space
 *
 * `createLink` takes the same frame `setRect` does — measured: `[10, 20, 110,
 * 70]` on a 300-high page stores `/Rect [10 230 110 280]`. So it goes through
 * the same conversion every annotation rectangle does, which is why this takes
 * a `PageTransform` rather than four numbers.
 */
export const applyAddLink: Apply<'mupdf', 'addLink'> = (
  session: MupdfSession,
  command: CommandOfKind<'addLink'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const loaded = pageWithin(document, command.page, total);
    const transform = linkTransform(loaded);
    const rect = placedRect(command.rect, transform);
    if (rect[0] === rect[2] || rect[1] === rect[3]) {
      throw new RangeError(
        'a link with no width or no height covers nothing, so there is no region for a reader ' +
          'to click. What was asked for was a rectangle whose two corners share an axis.',
      );
    }
    if (!touchesPage(rect, transform)) {
      throw new RangeError(
        `that link lies entirely outside page ${String(command.page)}, so nothing would be ` +
          'clickable.',
      );
    }

    let uri: string;
    if (command.target.kind === 'uri') {
      uri = command.target.uri;
    } else {
      // THE TARGET PAGE IS VALIDATED TOO, and separately: a link to page 900 of
      // a three-page document is a caller error, and `formatLinkURI` would
      // happily spell one — `resolveLink` then answers −1 and the reader shows
      // a link that goes nowhere.
      pageWithin(document, command.target.page, total);
      // MuPDF'S OWN SPELLING of an internal destination, never one composed
      // here. `formatLinkURI` is what `resolveLink` reads back, so the two
      // halves of *which page does this go to* have one implementation (B3a),
      // and the `/GoTo` array it produces is the format's rather than a shape
      // this build guessed at.
      uri = document.formatLinkURI({
        chapter: 0,
        page: command.target.page,
        type: 'Fit',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        zoom: 0,
      });
    }

    const link = loaded.createLink(rect, uri);
    // DROPPED IMMEDIATELY. `linksOn` says why every `Link` in this module is
    // destroyed rather than left to a finaliser; the object has done its work
    // by the time `createLink` returns.
    link.destroy();
  });

/**
 * Reports that a link's addition records no prior state.
 *
 * `captureAddAnnotation`'s refusal and its reason on a different object: the
 * command mints something whose identity is not in its payload, and there is no
 * handle naming *which link on this page* — `document.pageLinks` answers with
 * bounds and a target and no identity at all, which is where
 * `document.annotations` was before ADR-0041.
 *
 * The page is validated first, for that function's stated reason: an
 * out-of-range page is a caller error rather than a capture refusal the bus
 * turns into a checkpoint of a command that was never going to apply.
 */
export function captureAddLink(
  session: MupdfSession,
  command: CommandOfKind<'addLink'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    pageWithin(document, command.page, document.countPages());
    return {
      captured: false,
      reason:
        'an added link cannot be recorded as prior state: removing it again needs a handle ' +
        'naming which link on the page it is, and document.pageLinks answers with no identity',
    };
  });
}

/**
 * Unreachable, and required by `CommandSpec`'s shape.
 *
 * `CommandPrior['addLink']` is `never`. It throws for `invertAddAnnotation`'s
 * reason: a reachable path here would mean the type had been widened.
 */
export const invertAddLink: Invert<'mupdf', 'addLink'> = (): Promise<void> => {
  throw new Error(
    'an added link has no inverse yet; undo restores the checkpoint the bus took (ADR-0037)',
  );
};

/** The page for a validated index, or a named refusal. */
function pageWithin(document: mupdf.PDFDocument, page: number, total: number): mupdf.PDFPage {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page);
}

/**
 * The page's transform at scale 1 — the frame `createLink` takes.
 *
 * The SAME function the annotation writer uses, imported rather than rewritten:
 * *what frame does this page display in* has one answer, and a second
 * derivation here would agree on every upright page and diverge on a rotated or
 * cropped one (B3a). Only the refusal's wording is this module's, because a
 * link is not an annotation and a message naming one would send the reader to
 * the wrong file.
 */
function linkTransform(loaded: mupdf.PDFPage): PageTransform {
  const frame = frameOf(loaded);
  if (frame === null) {
    throw new RangeError(
      'this page displays no region — it has no /MediaBox of four numbers, or its /CropBox and ' +
        '/MediaBox do not overlap — so there is no frame to place a link in',
    );
  }
  return frame;
}

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
