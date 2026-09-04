import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
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
 * The four numbers of a box object, or `null` if it is not one.
 *
 * A malformed box is a **capture refusal** rather than a throw, for the reason
 * ADR-0009's 2026-08-19 decision gives: *this document cannot have its prior
 * state recorded* is an outcome the bus answers with a checkpoint, where *this
 * command is illegal* is a caller error. A `/CropBox` that is a name rather
 * than an array is the first, and the fixture that produces one is the same
 * shape `rotatePages` uses for a malformed `/Rotate`.
 */
function boxOf(object: PDFObject): readonly number[] | null {
  if (!object.isArray() || object.length !== 4) return null;
  const numbers: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const entry = object.get(index);
    if (!entry.isNumber()) return null;
    numbers.push(entry.asNumber());
  }
  return numbers;
}

/**
 * The box a page displays: its own `/CropBox`, or the media box it falls back
 * to.
 *
 * `getInheritable` for both, because either may come from an ancestor `/Pages`
 * node — and what the inset is taken from has to be what the reader is looking
 * at, not what the leaf happens to declare.
 */
function displayedBox(object: PDFObject): readonly number[] | null {
  const crop = object.getInheritable('CropBox');
  if (!crop.isNull()) return boxOf(crop);
  return boxOf(object.getInheritable('MediaBox'));
}

/**
 * Insets a box, or reports that the margins leave nothing.
 *
 * The box's corners are **not ordered** by the format — a `/MediaBox` may be
 * written `[0 792 612 0]` — so the edges are taken as min and max rather than
 * as first and second. Reading them positionally inverts the crop on such a
 * page, and the page still renders, which is the failure that would not
 * announce itself.
 */
function inset(
  box: readonly number[],
  margins: CommandOfKind<'cropPages'>['margins'],
): readonly number[] | null {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  const left = Math.min(x0, x1) + margins.left;
  const right = Math.max(x0, x1) - margins.right;
  const bottom = Math.min(y0, y1) + margins.bottom;
  const top = Math.max(y0, y1) - margins.top;
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
          `page ${String(page)} has no readable box to crop from — neither a /CropBox nor a ` +
            `/MediaBox of four numbers`,
        );
      }
      const cropped = inset(box, command.margins);
      if (cropped === null) {
        throw new RangeError(
          `those margins leave page ${String(page)} with no visible area. Its box is ` +
            `${box.join(', ')}.`,
        );
      }
      return { object, cropped };
    });

    for (const { object, cropped } of writes) putCropBox(document, object, cropped);
  });
