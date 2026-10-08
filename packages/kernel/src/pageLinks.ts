import type { CommandOfKind, LinkOutline } from '@monstera/contract';
import { LINK_OUTLINES, LINK_OUTLINE_DEFAULT_COLOUR } from '@monstera/contract/host';
import type { PageTransform } from '@monstera/shared';
import type * as mupdf from './mupdfRaw.js';

import { BoundedList } from './boundedList.js';
import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { ENGINE_LINK_ADDRESS_MAX, ENGINE_LINK_URI_MAX, ENGINE_PAGE_LINKS_MAX } from './host/engineChannels.js';
import { withDocument } from './mupdfWriter.js';
import { shownName } from './shownName.js';
import { frameOf, placedRect, touchesPage } from './pageAnnotations.js';
import { pageInDocument } from './pageScope.js';

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

/** How a link's own outline reads: one of the four a person may choose, or `other` for what the document brought (ADR-0212). */
export type ListedOutline = LinkOutline | 'other';

/** What every listed link carries beside its target: how it is outlined in the document, and in what colour. */
interface LinkLook {
  readonly outline: ListedOutline;
  /** The outline's colour when the document gives one in RGB, gray or CMYK, as RGB; absent when it gives none. */
  readonly colour?: [number, number, number] | undefined;
}

/** One link on a page. */
export type PageLink =
  | ({
      readonly kind: 'internal';
      /** Zero-based, as everything that crosses the contract is. */
      readonly page: number;
      readonly bounds: LinkBounds;
    } & LinkLook)
  | ({
      readonly kind: 'external';
      /** The URI exactly as the document carries it. Nothing here follows it. */
      readonly uri: string;
      readonly bounds: LinkBounds;
    } & LinkLook);

/**
 * A link's rectangle, in MuPDF's own coordinate space.
 *
 * Two corners rather than a size, matching `FitzRect` in the text substrate —
 * MuPDF answers corners, and converting to a size here would be a second shape
 * for one thing the engine already describes.
 *
 * **THE FRAME IS THE PAGE AS DISPLAYED, with its origin at the displayed
 * top-left, which is MuPDF's and not the PDF's.** Measured on an UPRIGHT page
 * whose box starts at the origin: a `/Rect [10 20 90 40]` on a 200-high page
 * comes back as `y0: 160, y1: 180` (`pageLinks.test.ts`, 2026-09-02). That is a
 * flip about the page height ONLY for such a page. On a rotated page the
 * rotation is applied too, and on a CropBox whose origin is not zero the origin
 * moves with it, as `pageAnnotations.ts` records for `getRect` (CR-COR-05). A
 * consumer must therefore not undo this by flipping about the height.
 *
 * A consumer that wants to draw one of these over a rendered page converts
 * through `PageTransform` like every other coordinate, which carries the
 * rotation and the box origin a flip cannot. Nothing here converts anything:
 * this is the engine's answer, carried as the engine gave it.
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
 * because empty is what a consumer reads as *no links on this page*. Bounded through `BoundedList`.
 *
 * @param bound every caller passes none; a case passes a small one to reach the stop on a small page
 */
export function readPageLinks(session: MupdfSession, page: number, bound = ENGINE_PAGE_LINKS_MAX): Promise<ListedPageLinks> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    pageInDocument(page, pageCount);
    return linksOn(document, page, bound);
  });
}

/** What {@link readLinkAddress} answers: the address, or why there is none to follow. */
export type LinkAddress =
  | { readonly kind: 'address'; readonly uri: string }
  /** No link at that place on the page, or one that goes inside the document. */
  | { readonly kind: 'no-such-link' }
  /** An address past {@link ENGINE_LINK_ADDRESS_MAX}, which is not opened rather than opened cut. */
  | { readonly kind: 'too-long' };

/**
 * One external link's address, in full, by its place among the page's links (ADR-0167 Decision 3).
 *
 * The place is the position {@link readPageLinks} lists it at, which is MuPDF's own order for `getLinks`, so the two
 * reads name one link by one number. The address is NOT shortened as the listing's is: a person who asked to follow
 * a tracking link gets the link the document holds, or, past {@link ENGINE_LINK_ADDRESS_MAX}, nothing opened.
 */
export function readLinkAddress(session: MupdfSession, page: number, index: number): Promise<LinkAddress> {
  return withDocument(session, (document) => {
    pageInDocument(page, document.countPages());
    const links = document.loadPage(page).getLinks();
    try {
      const link = links[index];
      if (link?.isExternal() !== true) return { kind: 'no-such-link' };
      const uri = link.getURI();
      return uri.length > ENGINE_LINK_ADDRESS_MAX ? { kind: 'too-long' } : { kind: 'address', uri };
    } finally {
      for (const link of links) link.destroy();
    }
  });
}

/** One page's links, and whether the walk stopped at {@link ENGINE_PAGE_LINKS_MAX}. */
export interface ListedPageLinks {
  readonly links: readonly PageLink[];
  readonly truncated: boolean;
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
    if (command.border !== undefined) writeLinkBorder(document, loaded, command.border);
  });

/**
 * The outline of a link: a one-point blue `/Border` for `thin`, an explicit zero-width one for `none`.
 *
 * ## The link just made is the LAST entry of the page's `/Annots`
 *
 * `createLink` appends, and the page's annotation walk never lists a link (`addLinkSchema`), so the array's last entry is the
 * one this command made. It is found by that, asserted by the proof reading it back from the saved bytes, and a page whose
 * `/Annots` is not an array of dictionaries is left alone rather than guessed at.
 */
function writeLinkBorder(document: mupdf.PDFDocument, page: mupdf.PDFPage, border: 'none' | 'thin'): void {
  const annots = page.getObject().get('Annots');
  if (!annots.isArray() || annots.length === 0) return;
  const made = annots.get(annots.length - 1);
  if (!made.isDictionary()) return;
  writeOutline(document, made, border, undefined);
}

/**
 * Writes a link's outline into its dictionary: the ONE writer of `/Border`, `/BS` and `/C` on a link, for a link just added and
 * a link a person changed (B3).
 *
 * `/BS` is deleted whenever an outline is written, because the format makes `/BS` win over `/Border` (PDF 32000 §12.5.2) and
 * `createLink` writes a `/BS /W 0` of its own: a `/Border` written beside it was stored and then OVERRIDDEN, so a link added
 * "thin" was drawn with no outline by every reader that follows the rule. Found 2026-10-08 by reading the listing back, which
 * follows the same rule (`pageLinks.test.ts`); the earlier proof read `/Border` alone.
 *
 * A visible outline on a link with no `/C` gets the default blue, never the black a reader would draw; a colour the link has is
 * kept, and `none` leaves the colour for the next time.
 */
function writeOutline(
  document: mupdf.PDFDocument,
  dictionary: mupdf.PDFObject,
  outline: LinkOutline | undefined,
  colour: readonly number[] | undefined,
): void {
  const numbers = (values: readonly number[]): mupdf.PDFObject => {
    const array = document.newArray();
    for (const value of values) array.push(document.newReal(value));
    return array;
  };
  if (outline !== undefined) {
    const { width, dash } = OUTLINE_STYLE[outline];
    const border = numbers([0, 0, width]);
    if (dash.length > 0) border.push(numbers(dash));
    dictionary.delete('BS');
    dictionary.put('Border', border);
  }
  if (colour !== undefined) {
    dictionary.put('C', numbers(colour));
  } else if (outline !== undefined && outline !== 'none' && colourOf(dictionary) === undefined) {
    dictionary.put('C', numbers(LINK_BORDER_COLOUR));
  }
}

/** A thin link outline: one point wide, in a blue that reads on white paper (the accent's family). */
const LINK_BORDER_WIDTH = 1;
const LINK_BORDER_COLOUR: readonly number[] = LINK_OUTLINE_DEFAULT_COLOUR;

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

/**
 * Changes the outline and colour of one link that already exists (ADR-0212).
 *
 * ## What is written, and what the format says about it
 *
 * `/Border [0 0 w]` — with a dash array as its fourth entry for a dashed one — and `/C` for the colour. **`/BS` is deleted
 * whenever an outline is written**, because the format makes `/BS` win over `/Border` (PDF 32000 §12.5.2): a link the document
 * brought with a `/BS` would keep drawing its old outline under the one just chosen, which is a control that reports done and
 * changes nothing in the viewer that reads `/BS`.
 *
 * ## Making a link visible gives it a colour
 *
 * A visible outline on a link with no `/C` is drawn black by most readers. It is written in `addLink`'s blue instead, and a
 * colour the link already has is never replaced by the default; choosing `none` keeps the colour for the next time.
 *
 * ## The link is named by its place, and the place is checked
 *
 * A position past the page's links, or a page whose `/Link` dictionaries cannot be matched one for one to what `getLinks()`
 * returns, is refused with its reason rather than applied to a neighbour.
 */
export const applySetLinkOutline: Apply<'mupdf', 'setLinkOutline'> = (
  session: MupdfSession,
  command: CommandOfKind<'setLinkOutline'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const loaded = pageWithin(document, command.page, document.countPages());
    const links = loaded.getLinks();
    const count = links.length;
    for (const link of links) link.destroy();
    if (command.index >= count) {
      throw new RangeError(
        `page ${String(command.page)} has ${String(count)} link(s), so there is no link at position ${String(command.index)} to outline`,
      );
    }
    const dictionary = linkDictionaries(loaded, count)[command.index];
    if (dictionary === undefined) {
      throw new RangeError(
        `the links on page ${String(command.page)} cannot be matched one for one to their dictionaries, so none is outlined rather than a neighbour`,
      );
    }
    writeOutline(document, dictionary, command.outline, command.colour);
  });

/**
 * Reports that a link outline change records no prior state: `captureAddLink`'s reason, since a link has no identity to restore
 * to, so undo restores the checkpoint the bus took (ADR-0037). The page is validated first, for that function's reason.
 */
export function captureSetLinkOutline(
  session: MupdfSession,
  command: CommandOfKind<'setLinkOutline'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    pageWithin(document, command.page, document.countPages());
    return {
      captured: false,
      reason:
        'a link outline cannot be recorded as prior state: restoring it needs a handle naming which link on the page it is, ' +
        'and document.pageLinks answers with a position that is stale once the document moves',
    };
  });
}

/** Unreachable, and required by `CommandSpec`'s shape: `CommandPrior['setLinkOutline']` is `never`. */
export const invertSetLinkOutline: Invert<'mupdf', 'setLinkOutline'> = (): Promise<void> => {
  throw new Error('a link outline change has no inverse yet; undo restores the checkpoint the bus took (ADR-0037)');
};

/** The page for a validated index, or a named refusal. */
function pageWithin(document: mupdf.PDFDocument, page: number, total: number): mupdf.PDFPage {
  pageInDocument(page, total);
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

/** How each outline is drawn: the width in points, and the dash pattern (none for a solid line). */
const OUTLINE_STYLE: Readonly<Record<LinkOutline, { readonly width: number; readonly dash: readonly number[] }>> = {
  none: { width: 0, dash: [] },
  thin: { width: LINK_BORDER_WIDTH, dash: [] },
  thick: { width: 3, dash: [] },
  dashed: { width: LINK_BORDER_WIDTH, dash: [3, 2] },
};

/**
 * The page's `/Link` dictionaries, in the order `/Annots` holds them.
 *
 * MuPDF's `getLinks()` is built from the same array in the same order, which is what lets a link's position among the page's
 * links name its dictionary here. The two counts are compared by the caller, and a page where they differ answers no
 * dictionaries rather than a guess (a listing then reads `other` and a change is refused).
 */
function linkDictionaries(page: mupdf.PDFPage, expected: number): readonly mupdf.PDFObject[] {
  const annots = page.getObject().get('Annots');
  if (!annots.isArray()) return [];
  const found: mupdf.PDFObject[] = [];
  for (let at = 0; at < annots.length; at += 1) {
    const entry = annots.get(at);
    if (!entry.isDictionary()) continue;
    const subtype = entry.get('Subtype');
    if (subtype.isName() && subtype.asName() === 'Link') found.push(entry);
  }
  return found.length === expected ? found : [];
}

/** A number in a dictionary entry, or `fallback` where it is absent or is not one. */
function numberOr(value: mupdf.PDFObject, fallback: number): number {
  return value.isNumber() ? value.asNumber() : fallback;
}

/**
 * How a link's outline reads, by the format's own rules (PDF 32000 §12.5.2): a `/BS` dictionary wins over `/Border`, and a
 * link with neither is drawn one point wide. Anything that is not exactly one of the four a person may choose is `other`.
 */
function outlineOf(dictionary: mupdf.PDFObject): ListedOutline {
  let width = 1;
  let dashed = false;
  const style = dictionary.get('BS');
  const border = dictionary.get('Border');
  if (style.isDictionary()) {
    width = numberOr(style.get('W'), 1);
    const kind = style.get('S');
    dashed = kind.isName() && kind.asName() === 'D';
  } else if (border.isArray() && border.length >= 3) {
    width = numberOr(border.get(2), 1);
    const dash = border.length >= 4 ? border.get(3) : undefined;
    dashed = dash !== undefined && dash.isArray() && dash.length > 0;
  }
  for (const outline of LINK_OUTLINES) {
    const wanted = OUTLINE_STYLE[outline];
    if (wanted.width === width && wanted.dash.length > 0 === dashed) return outline;
  }
  return 'other';
}

/** A link's `/C` as RGB: gray and CMYK by the format's own conversions (§10.4.2), and nothing for any other length. */
function colourOf(dictionary: mupdf.PDFObject): [number, number, number] | undefined {
  const colour = dictionary.get('C');
  if (!colour.isArray()) return undefined;
  const unit = (at: number): number => Math.min(1, Math.max(0, numberOr(colour.get(at), 0)));
  if (colour.length === 1) return [unit(0), unit(0), unit(0)];
  if (colour.length === 3) return [unit(0), unit(1), unit(2)];
  if (colour.length === 4) return [(1 - unit(0)) * (1 - unit(3)), (1 - unit(1)) * (1 - unit(3)), (1 - unit(2)) * (1 - unit(3))];
  return undefined;
}

function linksOn(document: mupdf.PDFDocument, page: number, bound: number): ListedPageLinks {
  const loaded = document.loadPage(page);
  const links = loaded.getLinks();
  const dictionaries = linkDictionaries(loaded, links.length);
  try {
    // STOPPED AT THE HOST ANSWER'S BOUND AND SAID, as the outline's walk is (ADR-0130 Decision 3).
    const listed = new BoundedList<PageLink>(bound);
    for (const [at, link] of links.entries()) {
      if (!listed.room()) break;
      const [x0, y0, x1, y1] = link.getBounds();
      const bounds: LinkBounds = { x0, y0, x1, y1 };
      // HOW IT IS OUTLINED, read from the link's own dictionary by its position (`linkDictionaries` says why that names it).
      // A page whose dictionaries could not be matched to its links answers `other` for each rather than a guess.
      const dictionary = dictionaries[at];
      const colour = dictionary === undefined ? undefined : colourOf(dictionary);
      const look: LinkLook = {
        outline: dictionary === undefined ? 'other' : outlineOf(dictionary),
        ...(colour === undefined ? {} : { colour }),
      };
      // SHOWN SHORTENED, never refused: one tracking link past the wire's bound made every link on the page
      // unreadable (`shownName.ts`). Nothing follows THIS text: a link a person follows is read again in full by its
      // place, through `engine/link-address` (ADR-0167), so the ellipsis changes only what is shown.
      // RESOLVED HERE when internal, because the engine is the only thing that knows how to turn a destination into
      // a page — a named destination, an explicit /XYZ, or a page reference all arrive as one string and all mean a
      // page.
      listed.add(
        link.isExternal()
          ? { kind: 'external', uri: shownName(link.getURI(), ENGINE_LINK_URI_MAX), bounds, ...look }
          : { kind: 'internal', page: document.resolveLink(link), bounds, ...look },
      );
    }
    const { items, truncated } = listed.answer();
    return { links: items, truncated };
  } finally {
    for (const link of links) link.destroy();
  }
}
