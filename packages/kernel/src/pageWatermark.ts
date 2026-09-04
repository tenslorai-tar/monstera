import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import { pagesOf } from './pageScope.js';

/**
 * Drawing a text watermark across pages — **the first command routed to a
 * byte-image writer**
 * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## The shape is the whole difference from every command before it
 *
 * A live-session `apply` mutates in place and returns nothing. This one takes
 * the document's bytes and **returns new ones**, which is what `Apply<W, K>`
 * has said about a byte-image writer since the seam was written. What ADR-0039
 * settles is where the input comes from — the live writer's `serialise`, never
 * `main`'s canonical image, which finding OOOOO-1 measured as stale for the
 * life of an open document — and where the output goes.
 *
 * ## `updateMetadata: false`, and it is the declaration rather than a habit
 *
 * `commandDeclarations.ts` declares this `reproducible: true`, which asserts
 * that running it twice against the same document writes the same bytes.
 * pdf-lib's `updateMetadata` **defaults to `true`** and stamps `/ModDate` on
 * save, which would make that declaration false — and false in the quiet
 * direction, since §3a spends reproducibility on whether replay may re-run the
 * command or must store its effect.
 *
 * Measured with `scripts/research/pdfLibRoundTrip.mjs` on 2026-09-04, against a
 * fixture whose `/ModDate` is pinned to `D:20010102030405Z` so the reading
 * cannot come out right by accident:
 *
 * | option | the output's `/ModDate` |
 * |---|---|
 * | `updateMetadata: false` | `D:20010102030405Z` — the document's own |
 * | `updateMetadata: true` | `D:20260904133827Z` — the clock's |
 *
 * The first version of that script compared two whole outputs for equality
 * instead, and both options came back IDENTICAL: two runs inside one clock tick
 * produce the same stamp, so the fixture was one the defect also handled
 * correctly. The pinned date is what separates them.
 *
 * ## What a round trip carries, executed rather than assumed
 *
 * This rewrites the whole document, and ADR-0006 measured MuPDF's
 * `rearrangePages` rewrite dropping `/AcroForm` while the widget annotations
 * stayed on their pages — fields rendering against an orphaned field tree. So
 * the same question was put to pdf-lib, with the answer **read back through
 * MuPDF** rather than through pdf-lib, because one library agreeing with itself
 * is not a reading. Same script, same date: a document carrying `/AcroForm`,
 * `/Outlines`, `/Names` and `/OCProperties` and one text field still carried
 * all four and its widget afterwards, and still did after a second application
 * to its own output.
 */

/**
 * The colour every watermark is drawn in, and there is deliberately only one.
 *
 * A mid grey reads against white paper and against a dark scan, and it is not a
 * design token: tokens govern **components**, and this is content written into
 * a document that will be opened in other readers. `docs/ARCHITECTURE.md`
 * §10.2's rule is scoped to components in its own words, and CLAUDE.md's
 * digest carried a wider reading until 2026-08-31, which is the mistake this
 * comment exists to not repeat.
 */
const WATERMARK_GREY = 0.5;

/**
 * Capture — **which always refuses**, and cannot do anything else.
 *
 * `CommandPrior['watermarkPages']` is `never`, so `CaptureResult<never>` has no
 * constructible `{ captured: true }` member: this function could not report a
 * successful capture even if it were written to. The bus answers a refusal by
 * taking a checkpoint, which for this command is the same bytes the apply
 * consumes — see ADR-0039.
 *
 * It takes no lock and reads nothing. Stating a reason is the whole job, and
 * the reason travels into the log entry where a UI can say why undo will cost
 * a checkpoint rather than an inverse.
 */
export const captureWatermarkPages: (
  image: ByteImage,
  command: CommandOfKind<'watermarkPages'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page that has been drawn on has no recordable prior state: restoring it means ' +
      'restoring its whole content stream, which is document-scaled and would be counted by ' +
      'nothing',
  });

/**
 * Invert — **unreachable by the type**, and present because the table's shape
 * requires it.
 *
 * `CommandPrior['watermarkPages']` is `never`, so nothing can construct an
 * argument for the `inverse` parameter. `invertDeletePages` is the same shape
 * for the same reason and says so in the same words; the throw is what a
 * function with an uninhabited parameter has instead of a body.
 */
export const invertWatermarkPages: Invert<'pdf-lib', 'watermarkPages'> = (_image, _inverse) => {
  throw new Error(
    'watermarkPages has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Draws the watermark and returns the new document.
 *
 * ## Centred on the page's own box, which is why no geometry crosses
 *
 * Each page is measured where it is drawn, so a document of mixed page sizes
 * watermarks correctly with nothing per-page on the wire. A position in the
 * command would be a renderer-supplied coordinate, which invariant L3's
 * branding exists to stop travelling as a bare pair of numbers.
 *
 * The text is centred by measuring it in the font it will be drawn in —
 * `widthOfTextAtSize` — rather than by an approximation, because a wrong centre
 * is invisible at one size and wrong at every other.
 *
 * ## Rotation is applied about the text's own centre
 *
 * pdf-lib rotates about the text's origin, which is its baseline start, so a
 * rotated string drawn at the centred origin swings away from the middle of the
 * page. The origin is therefore offset by the rotated half-extent, which puts
 * the **text's** centre on the page's centre for every angle. Drawing it at the
 * unrotated origin and letting it swing is the version that looks right at 0°
 * and at nothing else — and 0° is the angle a hurried fixture uses.
 *
 * ## Every page is validated before the first is drawn
 *
 * `pageCrop.ts` does the same and for the same reason: a command naming one
 * page this document does not have must change nothing, rather than watermark
 * the pages before it and then throw. The document here is a private parse, so
 * a throw genuinely discards everything — but that is a property of this
 * implementation, and a caller reading `apply` should see the refusal ordering
 * rather than have to derive it from where the bytes live.
 */
export const applyWatermarkPages: Apply<'pdf-lib', 'watermarkPages'> = async (image, command) => {
  const document = await PDFDocument.load(image, { updateMetadata: false });
  const pages = document.getPages();
  const targets = pagesOf(command.pages, pages.length);

  for (const page of targets) {
    if (!Number.isInteger(page) || page < 0 || page >= pages.length) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(pages.length)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
  }

  const font = await document.embedFont(StandardFonts.Helvetica);
  const radians = (command.rotationDegrees * Math.PI) / 180;
  const colour = rgb(WATERMARK_GREY, WATERMARK_GREY, WATERMARK_GREY);

  for (const index of targets) {
    const page = pages[index];
    // NOT REACHABLE — every index was validated above against this same array.
    // The check exists because `noUncheckedIndexedAccess` is on and a cast here
    // would be the one place this file stopped carrying the property.
    if (page === undefined) continue;

    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(command.text, command.fontSize);
    const textHeight = font.heightAtSize(command.fontSize);

    // The rotated half-extent, so the TEXT's centre lands on the PAGE's centre.
    // At 0° this reduces to subtracting half the width and half the height,
    // which is why a fixture at 0° cannot tell a correct implementation from
    // one that ignores the rotation.
    const halfWidth = textWidth / 2;
    const halfHeight = textHeight / 2;
    const offsetX = halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians);
    const offsetY = halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians);

    page.drawText(command.text, {
      x: width / 2 - offsetX,
      y: height / 2 - offsetY,
      size: command.fontSize,
      font,
      color: colour,
      opacity: command.opacity,
      rotate: degrees(command.rotationDegrees),
    });
  }

  // NO OPTIONS. `updateMetadata` is a **load** option, not a save one — pdf-lib
  // stores the flag on the document and `save` reads it back. Passing it here
  // as well type-checks in plain JavaScript and does nothing, which is how the
  // research script came to carry it in both places; the one that decides is
  // the `load` above.
  return document.save();
};
