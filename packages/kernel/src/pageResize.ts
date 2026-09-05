import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import { COORDINATE_DECIMALS, SCALE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
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

/**
 * A page's `/Contents` **shape** before the command ran.
 *
 * Not its value. The entries themselves are left in place and still referenced
 * by the array this command writes, so what the inverse needs is where they
 * are: how many, and whether they were wrapped in an array to begin with.
 *
 * **`wasArray` is not cosmetic**, and it is the member most likely to be read
 * as such. A bare stream reference and a one-element array render identically,
 * which is precisely `setPageTransition`'s argument for restoring absence: two
 * documents that show a reader the same thing are still two documents, and the
 * next command to read `/Contents` sees the difference even though no viewer
 * does.
 */
export type PriorContents =
  | { readonly present: false }
  | { readonly present: true; readonly wasArray: boolean; readonly length: number };

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
 * The four numbers of a box object, or `null` if it is not one.
 *
 * `pageCrop.ts`' reader, and the same reason for the same shape: a malformed
 * box is a **capture refusal** rather than a throw, because *this document
 * cannot have its prior state recorded* is an outcome the bus answers with a
 * checkpoint (ADR-0009, 2026-08-19).
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

/** A box's extent, taken as min and max because the corners are not ordered. */
interface Extent {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A box as an extent.
 *
 * `pageCrop.ts`' rule: PDF does not order a box's corners, so `[0 792 612 0]`
 * is a legal spelling of the same rectangle. Reading them positionally gives a
 * negative height here, which would produce a **mirrored** page that still
 * renders — the failure that does not announce itself.
 */
function extentOf(box: readonly number[]): Extent | null {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width <= 0 || height <= 0) return null;
  return { minX: Math.min(x0, x1), minY: Math.min(y0, y1), width, height };
}

/**
 * The box a page displays: its own or an inherited `/CropBox`, falling back to
 * `/MediaBox`.
 *
 * `getInheritable` for both, because what the content is scaled *from* has to
 * be what the reader is looking at, not what the leaf happens to declare.
 */
function displayedBox(object: PDFObject): readonly number[] | null {
  const crop = object.getInheritable('CropBox');
  if (!crop.isNull()) return boxOf(crop);
  return boxOf(object.getInheritable('MediaBox'));
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
function fit(extent: Extent, boxWidth: number, boxHeight: number): Resize['scale'] {
  return Math.min(boxWidth / extent.width, boxHeight / extent.height);
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
  const box = displayedBox(object);
  if (box === null) {
    throw new RangeError(
      `page ${String(page)} has no readable box to resize from — neither a /CropBox nor a ` +
        `/MediaBox of four numbers`,
    );
  }
  const extent = extentOf(box);
  if (extent === null) {
    throw new RangeError(
      `page ${String(page)} declares a box with no area (${box.join(', ')}), so there is ` +
        `nothing to scale`,
    );
  }

  const turned = quarterTurns(object) % 2 === 1;
  const boxWidth = turned ? command.heightPoints : command.widthPoints;
  const boxHeight = turned ? command.widthPoints : command.heightPoints;

  const scale = fit(extent, boxWidth, boxHeight);
  return {
    object,
    scale,
    translateX: (boxWidth - scale * extent.width) / 2 - scale * extent.minX,
    translateY: (boxHeight - scale * extent.height) / 2 - scale * extent.minY,
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

/** Bytes for a content stream. */
function streamBytes(operators: string): Uint8Array {
  return new TextEncoder().encode(operators);
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
    const malformedContents = entries.find(
      ({ contents }) => !contents.isNull() && !contents.isArray() && !contents.isStream(),
    );
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
        contents: contents.isNull()
          ? ({ present: false } as const)
          : ({
              present: true,
              wasArray: contents.isArray(),
              length: contents.isArray() ? contents.length : 1,
            } as const),
      })),
    };
  });
}

/**
 * Rebuilds one page's `/Contents` from the array this command wrote.
 *
 * The array is `[transform, ...original, restore]`, so the originals are the
 * entries between the first and the last. **A shape that does not match is
 * refused rather than guessed at**: rebuilding from an array of the wrong
 * length would produce a page holding some other command's streams, and a
 * refused undo is `applyCropPages`' stated preference over a half-restore.
 */
function restoreContents(
  document: PDFDocument,
  object: PDFObject,
  page: number,
  prior: PriorContents,
): void {
  if (!prior.present) return;
  const current = object.get('Contents');
  const expected = prior.length + 2;
  if (!current.isArray() || current.length !== expected) {
    throw new Error(
      `page ${String(page)} does not carry the /Contents this command wrote — expected an array ` +
        `of ${String(expected)} entries and found ` +
        `${current.isArray() ? `${String(current.length)} entries` : 'no array'}. Its content ` +
        `has been changed since, so restoring the recorded shape would rebuild the page from ` +
        `the wrong streams.`,
    );
  }
  if (prior.wasArray) {
    const rebuilt = document.newArray();
    for (let at = 1; at <= prior.length; at += 1) rebuilt.push(current.get(at));
    object.put('Contents', rebuilt);
    return;
  }
  // A BARE REFERENCE COMES BACK BARE. It renders identically to a one-element
  // array, and it is a different document — `setPageTransition`'s rule.
  object.put('Contents', current.get(1));
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
      restoreContents(document, object, entry.page, entry.contents);
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
      const existing = resize.object.get('Contents');
      // AN EMPTY PAGE GETS NO TRANSFORM. There is nothing to scale, so adding
      // two streams to bracket nothing would leave a page whose `/Contents`
      // shape the inverse then has to restore for no effect.
      if (!existing.isNull()) {
        const opened = document.addStream(
          streamBytes(openingOperators(resize)),
          document.newDictionary(),
        );
        const closed = document.addStream(streamBytes(CLOSING_OPERATORS), document.newDictionary());
        const contents = document.newArray();
        contents.push(opened);
        if (existing.isArray()) {
          for (let at = 0; at < existing.length; at += 1) contents.push(existing.get(at));
        } else {
          contents.push(existing);
        }
        contents.push(closed);
        resize.object.put('Contents', contents);
      }

      const box = [0, 0, resize.boxWidth, resize.boxHeight];
      resize.object.put('MediaBox', boxArray(document, box));
      resize.object.put('CropBox', boxArray(document, box));
    }
  });

/**
 * The closing stream.
 *
 * A leading newline because content streams in an array are concatenated with
 * no separator inserted, so a page whose last stream ends mid-token would
 * otherwise have `Q` welded onto it.
 */
const CLOSING_OPERATORS = '\nQ\n';

// NO MARKER IS EXPORTED FOR THE PROOF, and the reason is worth keeping: the
// obvious one is `cm`, and pdf-lib's `drawRectangle` emits four of them before
// it draws anything. A proof keyed on it would report a transform on every page
// in a fixture, including the pages this command was told not to touch — a
// marker that matches the thing it exists to distinguish from. What separates
// them is the five-decimal spelling `SCALE_DECIMALS` gives the matrix, which
// the proof keys on directly.
