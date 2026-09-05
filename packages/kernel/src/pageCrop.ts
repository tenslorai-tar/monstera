import type { CommandOfKind } from '@monstera/contract';
import type { Box } from '@monstera/shared';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { boxOf, displayedBox } from './pageBoxes.js';
import { pagesOf } from './pageScope.js';

/**
 * Cropping — insetting a page's **visible** box, and leaving its media box
 * alone.
 *
 * ## `/CropBox` and not `/MediaBox`, which is the whole of what crop means
 *
 * PDF 32000-1 §14.11.2: `/MediaBox` is the sheet the page was made for and
 * `/CropBox` is the region a viewer displays. Cropping by shrinking the media
 * box throws the content away — the page no longer *has* the margin — where
 * shrinking the crop box hides it, which is what every application this one
 * replaces does and what makes the operation reversible without a checkpoint.
 *
 * A page with no `/CropBox` displays its `/MediaBox`, so the inset is taken
 * from whichever the page **resolves to**, and absence is restored as absence
 * for `rotatePages`' §3 reason: writing the media box back as an explicit crop
 * box renders identically and leaves the page declaring what it used to
 * inherit.
 *
 * ## The inset is clamped by REFUSAL, never by arithmetic
 *
 * Margins that meet or cross leave a box with no area, which is a page a viewer
 * renders as nothing. Silently clamping to a sliver would be the *"widening a
 * type to make an error disappear"* shape one layer down: the user asked for
 * something impossible and the honest answer says so, per page, naming the one
 * that could not take it.
 *
 * ## What the box IS moved to `pageBoxes.ts`, and it changed on the way
 *
 * The inset is taken from what the page displays, and that rule now has one
 * home because a second caller arrived — the annotation writer places a
 * rectangle inside the same region. It is not a pure move: the version that
 * lived here did **not** clip the crop box to the media box, which PDF
 * 32000-1 §14.11.2 requires and MuPDF's own page transform does. Measured
 * 2026-09-05; the divergence is invisible on every document whose crop box sits
 * inside its media box, and twenty units on one where it does not.
 *
 * What that changes here: a page with an oversized or partly overlapping crop
 * box is now inset from the region a reader can actually see. A page whose two
 * boxes do not overlap at all has no visible region, so it is refused rather
 * than cropped from a frame the document does not have.
 */

/** A page's own `/CropBox` before the command ran (ADR-0009 §3). */
export type PriorCropBox =
  | { readonly present: false }
  | { readonly present: true; readonly raw: readonly number[] };

/** One page's prior own-state, in the order the command named its pages. */
export interface PriorPageCrop {
  readonly page: number;
  readonly prior: PriorCropBox;
}

// `pagesOf` MOVED to `pageScope.ts`, and this note is here because the reason
// is not visible from either end. It was exported from this file so the capture
// and the apply would resolve `'all'` identically; the second command to take a
// scope is `watermarkPages`, which runs in `main`, and importing anything from
// this file binds the MuPDF native library there (ADR-0026, +40.1 MB). Copying
// four lines into the watermark is the third opinion B3a's own record says
// arrives within the hour. See `pageScope.ts`.

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
 * Insets a box, or reports that the margins leave nothing.
 *
 * The corners arrive **ordered**, because `displayedBox` normalises them — the
 * format specifies a rectangle by any two diagonally opposite corners, so a
 * `/MediaBox` may be written `[0 792 612 0]`, and reading such a box
 * positionally inverts the crop while the page still renders. That
 * normalisation used to live here and moved with the rest of the box rule; the
 * property it protects is unchanged and is asserted by the reversed-box case.
 */
function inset(
  box: Box,
  margins: CommandOfKind<'cropPages'>['margins'],
): readonly number[] | null {
  const left = box.x0 + margins.left;
  const right = box.x1 - margins.right;
  const bottom = box.y0 + margins.bottom;
  const top = box.y1 - margins.top;
  if (right <= left || top <= bottom) return null;
  return [left, bottom, right, top];
}

/** Four numbers as a PDF array. */
function boxArray(document: PDFDocument, box: readonly number[]): PDFObject {
  const array = document.newArray();
  for (const value of box) array.push(value);
  return array;
}

/** Writes a box as a `/CropBox` on a page. */
function putCropBox(document: PDFDocument, object: PDFObject, box: readonly number[]): void {
  object.put('CropBox', boxArray(document, box));
}

/**
 * Reads each named page's prior own `/CropBox`, before anything is written.
 *
 * `get` and not `getInheritable`, exactly as `captureRotatePages` does and for
 * the same reason: the inverse must restore what the page **declared**, so a
 * page that inherited its crop box comes back inheriting it.
 */
export function captureCropPages(
  session: MupdfSession,
  command: CommandOfKind<'cropPages'>,
): Promise<CaptureResult<readonly PriorPageCrop[]>> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const entries = pagesOf(command.pages, total).map((page) => ({
      page,
      own: pageObject(document, page, total).get('CropBox'),
    }));

    const malformed = entries.find(({ own }) => !own.isNull() && boxOf(own) === null);
    if (malformed !== undefined) {
      return {
        captured: false,
        reason:
          `page ${String(malformed.page)} carries a /CropBox that is not four numbers, so its ` +
          `prior state cannot be recorded as one`,
      };
    }

    return {
      captured: true,
      prior: entries.map(({ page, own }) => ({
        page,
        prior: own.isNull()
          ? ({ present: false } as const)
          : ({ present: true, raw: boxOf(own) ?? [] } as const),
      })),
    };
  });
}

/**
 * Restores each page's own `/CropBox` verbatim, **including absence**.
 *
 * §3's rule on a second key: a page that displayed its media box because it had
 * no crop box must come back with none. Writing the media box in as an explicit
 * crop box renders identically and is a different document — and the next crop
 * would then inset from a box the page never declared.
 */
export const invertCropPages: Invert<'mupdf', 'cropPages'> = (
  session: MupdfSession,
  inverse: readonly PriorPageCrop[],
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    // Validated in full before the first write, for `applyCropPages`' reason:
    // a half-restored document is worse than a refused undo.
    const restorations = inverse.map((entry) => ({
      object: pageObject(document, entry.page, total),
      prior: entry.prior,
    }));
    for (const { object, prior } of restorations) {
      if (prior.present) putCropBox(document, object, prior.raw);
      else object.delete('CropBox');
    }
  });

/**
 * Insets each named page's visible box.
 *
 * **Every page is resolved and checked before the first write.** A margin that
 * empties page 7 of a ten-page crop must refuse the whole command rather than
 * leave three pages cropped — a partial crop is a document the user did not ask
 * for and cannot see the shape of.
 */
export const applyCropPages: Apply<'mupdf', 'cropPages'> = (
  session: MupdfSession,
  command: CommandOfKind<'cropPages'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const writes = pagesOf(command.pages, total).map((page) => {
      const object = pageObject(document, page, total);
      const box = displayedBox(object);
      if (box === null) {
        throw new RangeError(
          `page ${String(page)} displays no region to crop from — it has no /MediaBox of four ` +
            `numbers, or its /CropBox and /MediaBox do not overlap`,
        );
      }
      const cropped = inset(box, command.margins);
      if (cropped === null) {
        throw new RangeError(
          `those margins leave page ${String(page)} with no visible area. Its box is ` +
            `${[box.x0, box.y0, box.x1, box.y1].join(', ')}.`,
        );
      }
      return { object, cropped };
    });

    for (const { object, cropped } of writes) putCropBox(document, object, cropped);
  });
