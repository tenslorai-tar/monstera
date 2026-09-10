import type { Box } from '@monstera/shared';
import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import { COORDINATE_DECIMALS, SCALE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { boxOf, displayedBox } from './pageBoxes.js';
import {
  type PriorContents,
  contentsAreWrappable,
  contentsPrior,
  restoreWrappedContents,
  wrapContents,
} from './pageContentWrap.js';
import { pagesOf } from './pageScope.js';

/**
 * Resizing — moving a page's boxes **and scaling its content to match**.
 *
 * ## Moving the box alone is a crop, and this build already has one
 *
 * `/MediaBox` is the sheet and `/CropBox` is the visible region, and changing
 * either without touching the content leaves the content at its original size
 * inside a different frame. That is cropping or matting, `cropPages` is the
 * command for the first, and a reader cannot tell the two apart from the
 * page's declared size — *this page is now A4* is true of both. So the
 * load-bearing half of this command is the content transform, and the proof
 * below is arranged so that a box-only implementation fails it.
 *
 * ## MuPDF, and this is not the content-composition row
 *
 * `docs/ARCHITECTURE.md:382` names resize on *"Page tree ops:
 * delete/insert/extract/merge/split/crop/**resize**"*, which is MuPDF's. The
 * row below it — content composition — is *drawing onto pages*, and nothing
 * here draws: the prepended stream adds no marks, sets no colour and paints
 * nothing. It changes the coordinate system the existing marks are interpreted
 * in. Routing it to the byte-image writer because it touches a content stream
 * would be grouping by which object is written rather than by what the write
 * does, which is the same mistake `setPageTransition` avoided from the other
 * side.
 *
 * ## IT IS INVERTIBLE, AND THE REASON IS THAT `/Contents` IS A REFERENCE
 *
 * Every other command that touches a content stream here takes a checkpoint,
 * because *drawing appends to the stream* and the prior state is therefore the
 * whole stream — document-scaled, and counted by nothing. This one appends
 * nothing to any existing stream. It adds two new ones and rewrites `/Contents`
 * to `[transform, ...original, restore]`, so the original streams are untouched
 * and still referenced, and the prior state is **the shape of the array**: was
 * it an array, and how many entries did it hold. Two numbers and a boolean per
 * page, whatever the document weighs.
 *
 * That is recorded positionally and **never by object number**, which is the
 * distinction that decides whether the inverse survives a save: MuPDF renumbers
 * objects when it garbage-collects on write, so a prior naming object 8 names
 * something else afterwards, while *the middle of the array* keeps meaning the
 * middle of the array.
 *
 * ## A quarter-turned page is resized to what the READER sees
 *
 * `/Rotate 90` means the viewer shows the page turned, so a page whose
 * `/MediaBox` is 612×792 displays as 792×612. Asking for A4 on that page and
 * writing a 595×842 box would produce a page that displays as 842×595 —
 * landscape, from a portrait request. The target is therefore swapped for a
 * quarter turn, so the box written is the one that *displays* as what was
 * asked for. This is the audit's *"a flat object → one with inherited
 * attributes, rotation, or a CropBox origin"* shape, and it is the case a
 * fixture of unrotated pages cannot see.
 *
 * ## The fit is uniform and the remainder is centred
 *
 * `min(w/W, h/H)` on both axes. A per-axis fit would make the page exactly the
 * target size and distort every glyph on it, which is not what any application
 * offers because it is not what anyone means.
 */

/** A box a page declared for itself, before the command ran (ADR-0009 §3). */
export type PriorBox =
  | { readonly present: false }
  | { readonly present: true; readonly raw: readonly number[] };

/** One page's prior own-state, in the order the command named its pages. */
export interface PriorPageResize {
  readonly page: number;
  readonly mediaBox: PriorBox;
  readonly cropBox: PriorBox;
  readonly contents: PriorContents;
}

/** The page object, refusing an index this document does not have. */
function pageObject(document: PDFDocument, page: number, total: number): PDFObject {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page).getObject();
}

/**
 * THE BOX RULE IS `pageBoxes.ts`' AND WAS ANSWERED HERE A SECOND TIME UNTIL
 * 2026-09-10.
 *
 * This module carried its own `boxOf`, `extentOf` and `displayedBox`, written
 * before `pageBoxes.ts` existed and never taken off. They agreed with it on
 * every well-formed document, which is why nothing noticed — and `pageBoxes.ts`'
 * own header records what they disagree about: PDF 32000-1 §14.11.2 says the
 * crop box *"shall be... clipped to the media box"*, and the copy here did not
 * clip. Measured there against MuPDF 1.28.0: a `/CropBox [-20 -30 400 500]` on
 * a `/MediaBox [0 0 200 300]` page displays as `[0 0 200 300]`, and the
 * unclipped reading is 20 and 30 units out on two edges and 200 and 200 on the
 * other two.
 *
 * For a resize that is not a cosmetic difference: the extent is what the
 * content is scaled **from**, so an oversized crop box made every glyph on the
 * page too small and put the result off-centre. B3a's own sentence, in the
 * shape it warns about — *the finding is the second opinion, not the wrong
 * one*.
 *
 * @param object the page object
 * @returns the displayed region, ordered and clipped, or `null`
 */
function extentOf(object: PDFObject): Box | null {
  const box = displayedBox(object);
  if (box === null) return null;
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return null;
  return box;
}

/**
 * A page's rotation in degrees, normalised to 0, 90, 180 or 270.
 *
 * A missing, non-numeric or unaligned `/Rotate` reads as 0 rather than
 * refusing: the value only decides whether the target's two numbers are
 * swapped, and a page whose rotation a viewer ignores is one this command
 * should treat the way the viewer does.
 */
function quarterTurns(object: PDFObject): number {
  const rotate = object.getInheritable('Rotate');
  if (!rotate.isNumber()) return 0;
  const degrees = rotate.asNumber();
  if (!Number.isFinite(degrees) || degrees % 90 !== 0) return 0;
  return (((degrees / 90) % 4) + 4) % 4;
}

/** Four numbers as a PDF array. */
function boxArray(document: PDFDocument, box: readonly number[]): PDFObject {
  const array = document.newArray();
  for (const value of box) array.push(value);
  return array;
}

/** Restores a box a page declared for itself, **including its absence**. */
function restoreBox(
  document: PDFDocument,
  object: PDFObject,
  key: 'MediaBox' | 'CropBox',
  prior: PriorBox,
): void {
  if (prior.present) object.put(key, boxArray(document, prior.raw));
  else object.delete(key);
}

/**
 * What one page's transform is, once the box and the rotation have been read.
 *
 * Resolved for every page before the first write, for `applyCropPages`' reason:
 * a document with three of ten pages resized is one the user did not ask for
 * and cannot see the shape of.
 */
interface Resize {
  readonly object: PDFObject;
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
}

/** The transform that fits `extent` into the target, centred. */
function fit(extent: Box, boxWidth: number, boxHeight: number): Resize['scale'] {
  return Math.min(boxWidth / (extent.x1 - extent.x0), boxHeight / (extent.y1 - extent.y0));
}

/**
 * Everything one page needs, or a thrown reason it cannot be resized.
 *
 * The translation carries **two** terms and the second is the one a fixture of
 * origin-zero pages cannot see: the content is placed by centring the scaled
 * extent in the target box, and then shifted back by the source box's own
 * origin, because a page whose `/CropBox` starts at `[20 20 …]` has its content
 * addressed in coordinates that begin at 20.
 */
function resizeOf(
  object: PDFObject,
  page: number,
  command: CommandOfKind<'resizePages'>,
): Resize {
  const extent = extentOf(object);
  if (extent === null) {
    throw new RangeError(
      `page ${String(page)} displays no region to resize from — it has no /MediaBox of four ` +
        `numbers, or its /CropBox and /MediaBox do not overlap`,
    );
  }

  const turned = quarterTurns(object) % 2 === 1;
  const boxWidth = turned ? command.heightPoints : command.widthPoints;
  const boxHeight = turned ? command.widthPoints : command.heightPoints;

  const scale = fit(extent, boxWidth, boxHeight);
  return {
    object,
    scale,
    translateX: (boxWidth - scale * (extent.x1 - extent.x0)) / 2 - scale * extent.x0,
    translateY: (boxHeight - scale * (extent.y1 - extent.y0)) / 2 - scale * extent.y0,
    boxWidth,
    boxHeight,
  };
}

/**
 * The operators that open the transform.
 *
 * `q` before the matrix and `Q` in the closing stream, so the existing content
 * is bracketed rather than followed. Without the `q`/`Q` pair the matrix is
 * simply concatenated into whatever the page left in the graphics state, and
 * anything appended later — a watermark, a header — would be scaled too.
 *
 * **The one shape this cannot survive is a stream with more `Q` than `q`**, in
 * which case an unmatched `Q` pops the state this opened and the remainder of
 * the page renders unscaled. That is a malformed content stream by §8.4.4 and
 * nothing here can repair it; it is stated because it is the failure that
 * renders rather than throws.
 */
function openingOperators(resize: Resize): string {
  const scale = contentNumber(resize.scale, SCALE_DECIMALS);
  const zero = contentNumber(0, SCALE_DECIMALS);
  const x = contentNumber(resize.translateX, COORDINATE_DECIMALS);
  const y = contentNumber(resize.translateY, COORDINATE_DECIMALS);
  return `q\n${scale} ${zero} ${zero} ${scale} ${x} ${y} cm\n`;
}

/**
 * Reads each named page's own boxes and its `/Contents` shape, before anything
 * is written.
 *
 * `get` and not `getInheritable` for the boxes, as `captureCropPages` does and
 * for the same reason: the inverse restores what the page **declared**, so a
 * page that inherited its media box comes back inheriting it. `/Contents` is
 * not an inheritable attribute at all (§7.7.3.3 lists four, and this is not one
 * of them), so there is no choice to make there.
 */
export function captureResizePages(
  session: MupdfSession,
  command: CommandOfKind<'resizePages'>,
): Promise<CaptureResult<readonly PriorPageResize[]>> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const entries = pagesOf(command.pages, total).map((page) => {
      const object = pageObject(document, page, total);
      return {
        page,
        media: object.get('MediaBox'),
        crop: object.get('CropBox'),
        contents: object.get('Contents'),
      };
    });

    const malformedBox = entries.find(
      ({ media, crop }) =>
        (!media.isNull() && boxOf(media) === null) || (!crop.isNull() && boxOf(crop) === null),
    );
    if (malformedBox !== undefined) {
      return {
        captured: false,
        reason:
          `page ${String(malformedBox.page)} carries a /MediaBox or /CropBox that is not four ` +
          `numbers, so its prior state cannot be recorded as one`,
      };
    }

    // A `/Contents` that is neither a stream nor an array of them is a page
    // whose shape this command cannot describe positionally, which is exactly
    // the case the inverse would silently mis-rebuild.
    const malformedContents = entries.find(({ contents }) => !contentsAreWrappable(contents));
    if (malformedContents !== undefined) {
      return {
        captured: false,
        reason:
          `page ${String(malformedContents.page)} carries a /Contents that is neither a stream ` +
          `nor an array of them, so the shape its inverse would restore cannot be recorded`,
      };
    }

    return {
      captured: true,
      prior: entries.map(({ page, media, crop, contents }) => ({
        page,
        mediaBox: media.isNull()
          ? ({ present: false } as const)
          : ({ present: true, raw: boxOf(media) ?? [] } as const),
        cropBox: crop.isNull()
          ? ({ present: false } as const)
          : ({ present: true, raw: boxOf(crop) ?? [] } as const),
        contents: contentsPrior(contents),
      })),
    };
  });
}

/**
 * Restores each page's boxes and its `/Contents` shape.
 *
 * The two transform streams are left in the file, unreferenced. That is
 * ordinary PDF garbage, collected by the next full save, and the alternative —
 * deleting objects the document may have grafted elsewhere in the meantime — is
 * a write this command has no authority to make.
 */
export const invertResizePages: Invert<'mupdf', 'resizePages'> = (
  session: MupdfSession,
  inverse: readonly PriorPageResize[],
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    // Resolved in full before the first write, for the apply's reason.
    const restorations = inverse.map((entry) => ({
      object: pageObject(document, entry.page, total),
      entry,
    }));
    for (const { object, entry } of restorations) {
      restoreWrappedContents(document, object, entry.page, entry.contents);
      restoreBox(document, object, 'MediaBox', entry.mediaBox);
      restoreBox(document, object, 'CropBox', entry.cropBox);
    }
  });

/**
 * Resizes each named page, scaling its content to fit.
 *
 * **Both boxes are written explicitly, even where the page inherited them.** A
 * page that took its `/MediaBox` from an ancestor and now has a different size
 * cannot go on inheriting it, and leaving a stale `/CropBox` behind — inherited
 * or its own — would crop the resized page to the old one's region. The two are
 * set to the same rectangle because a resize produces a page with no hidden
 * margin: the crop box's job is to hide part of a sheet, and this command has
 * just made the sheet.
 */
export const applyResizePages: Apply<'mupdf', 'resizePages'> = (
  session: MupdfSession,
  command: CommandOfKind<'resizePages'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const writes = pagesOf(command.pages, total).map((page) =>
      resizeOf(pageObject(document, page, total), page, command),
    );

    for (const resize of writes) {
      // AN EMPTY PAGE GETS NO TRANSFORM, and that rule is the wrap's own — it
      // answers `false` rather than this deciding, because the same argument
      // holds for every command that brackets content.
      wrapContents(document, resize.object, openingOperators(resize));

      const box = [0, 0, resize.boxWidth, resize.boxHeight];
      resize.object.put('MediaBox', boxArray(document, box));
      resize.object.put('CropBox', boxArray(document, box));
    }
  });

// NO MARKER IS EXPORTED FOR THE PROOF, and the reason is worth keeping: the
// obvious one is `cm`, and pdf-lib's `drawRectangle` emits four of them before
// it draws anything. A proof keyed on it would report a transform on every page
// in a fixture, including the pages this command was told not to touch — a
// marker that matches the thing it exists to distinguish from. What separates
// them is the five-decimal spelling `SCALE_DECIMALS` gives the matrix, which
// the proof keys on directly.
