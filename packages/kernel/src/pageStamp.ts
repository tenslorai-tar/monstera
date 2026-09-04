import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import { pagesOf } from './pageScope.js';

/**
 * Headers and footers — **the second command routed to a byte-image writer**,
 * and the one that says whether `pageWatermark.ts` should have been abstracted.
 *
 * ## It should not have been, and the reason is in the geometry
 *
 * The two look alike from a distance: parse, draw text, serialise. They differ
 * in every part that matters. A watermark is **one string, centred on the
 * page, rotated about its own centre, translucent**. A header is **six strings,
 * pinned to two edges at three horizontal alignments, upright and opaque, with
 * per-page substitution**. A shared *draw text on pages* helper would take the
 * union of both parameter sets and branch on which half was filled in, which is
 * the premature abstraction B7 names — and the branch would be exactly the
 * difference the two features are.
 *
 * What they genuinely share is already shared: {@link pagesOf} resolves the
 * scope, `updateMetadata: false` keeps them reproducible, and both refuse every
 * page before drawing any. Those are three lines, and a module holding them
 * would be a module holding three lines.
 *
 * Recorded here rather than left implicit, because *the second instance is what
 * shows whether an abstraction is real* is only useful if somebody writes down
 * what the second instance showed.
 *
 * ## The tokens, and what happens to text that is not one
 *
 * `{n}` is the page's 1-based number and `{N}` the document's page count.
 * Anything else in braces is left **verbatim** — a template that silently
 * deleted `{total}` because it did not recognise it would remove text the
 * person typed, which is worse than printing it back at them.
 *
 * ## Substitution happens per page, and that is why the scope is resolved first
 *
 * `{n}` differs per page, so the six strings are resolved inside the loop.
 * Resolving them once and drawing the same text everywhere is the defect a
 * single-page fixture cannot see, which is why the proof stamps three pages and
 * reads all three.
 */

/**
 * The colour headers and footers are drawn in.
 *
 * Black, because a header is document content a reader is meant to read, where
 * a watermark is a mark laid over it. Not a design token for
 * `pageWatermark.ts`'s reason: §10.2's rule is about components, and this is
 * content written into a file other readers will open.
 */
const STAMP_BLACK = rgb(0, 0, 0);

/** The three horizontal positions one edge carries, in reading order. */
const SLOTS = ['left', 'centre', 'right'] as const;

type Slot = (typeof SLOTS)[number];

/**
 * Resolves `{n}` and `{N}` in one slot's text.
 *
 * A single pass over the string rather than two `replaceAll` calls, so a
 * document whose header text is literally `{N}` cannot be affected by the order
 * the two tokens are substituted in. With two passes and a `{n}` substitution
 * that produced the text `{N}`, the second pass would rewrite it — a defect
 * that needs a page number of exactly the right shape to appear.
 *
 * @param text the slot's template
 * @param page the page's 1-based number
 * @param total the document's page count
 */
export function resolveStampTokens(text: string, page: number, total: number): string {
  return text.replace(/\{[nN]\}/gu, (token) =>
    token === '{n}' ? String(page) : String(total),
  );
}

/**
 * Capture — which always refuses, exactly as `captureWatermarkPages` does.
 *
 * `CommandPrior['headerFooterPages']` is `never`, so `CaptureResult<never>` has
 * no constructible `{ captured: true }` member and this could not report
 * success even if it were written to.
 */
export const captureHeaderFooterPages: (
  image: ByteImage,
  command: CommandOfKind<'headerFooterPages'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page that has been drawn on has no recordable prior state: restoring it means ' +
      'restoring its whole content stream, which is document-scaled and would be counted by ' +
      'nothing',
  });

/** Invert — unreachable by the type, present because the table's shape requires it. */
export const invertHeaderFooterPages: Invert<'pdf-lib', 'headerFooterPages'> = (
  _image,
  _inverse,
) => {
  throw new Error(
    'headerFooterPages has no inverse and this is unreachable: its prior state is `never`, so ' +
      'no caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Draws the header and footer slots and returns the new document.
 *
 * ## The vertical placement is the margin, measured from the right edge each way
 *
 * The header's baseline sits `marginPoints` below the top and the footer's
 * `marginPoints` above the bottom, so one number describes a symmetric inset —
 * which is what a person means by *margin*. The footer's baseline is the margin
 * itself rather than the margin minus the type height: a baseline at the margin
 * puts the descenders inside it, which is the convention every word processor
 * uses and the one a reader will not notice.
 *
 * ## An empty slot draws NOTHING, and that is not the same as drawing ''
 *
 * pdf-lib will happily emit a text object for an empty string, which puts an
 * operator in the content stream for a slot the person left blank — invisible,
 * and enough to make a *this document has no footer* assertion false. So an
 * empty slot is skipped.
 */
export const applyHeaderFooterPages: Apply<'pdf-lib', 'headerFooterPages'> = async (
  image,
  command,
) => {
  const document = await PDFDocument.load(image, { updateMetadata: false });
  const pages = document.getPages();
  const targets = pagesOf(command.pages, pages.length);

  // EVERY PAGE VALIDATED BEFORE THE FIRST IS DRAWN, for `pageCrop.ts`'s reason:
  // a command naming one page this document does not have changes nothing.
  for (const page of targets) {
    if (!Number.isInteger(page) || page < 0 || page >= pages.length) {
      throw new RangeError(
        `Page ${String(page)} is outside this document, which has ${String(pages.length)} ` +
          'page(s). Page indices are zero-based.',
      );
    }
  }

  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = pages.length;

  for (const index of targets) {
    const page = pages[index];
    // NOT REACHABLE — validated above against this same array. The check is
    // here because `noUncheckedIndexedAccess` is on and a cast would be the one
    // place this file stopped carrying the property.
    if (page === undefined) continue;
    const { width, height } = page.getSize();

    for (const [edge, y] of [
      ['header', height - command.marginPoints],
      ['footer', command.marginPoints],
    ] as const) {
      for (const slot of SLOTS) {
        const template = command[edge][slot];
        if (template.length === 0) continue;

        // PER PAGE, not once. `{n}` differs page to page, so a resolution
        // hoisted out of this loop stamps page 1's number onto every page — a
        // defect a single-page fixture cannot see.
        const text = resolveStampTokens(template, index + 1, total);
        page.drawText(text, {
          x: horizontalOrigin(slot, font.widthOfTextAtSize(text, command.fontSize), {
            width,
            margin: command.marginPoints,
          }),
          y,
          size: command.fontSize,
          font,
          color: STAMP_BLACK,
        });
      }
    }
  }

  // NO OPTIONS. `updateMetadata` is a **load** option — see `pageWatermark.ts`,
  // where the measurement behind that sentence is recorded.
  return document.save();
};

/**
 * Where a slot's text starts, given how wide it turned out to be.
 *
 * The width is passed in rather than measured here because measuring needs the
 * font and the size, and a function that took those would be doing two jobs.
 * Centre and right both depend on the measured width, which is the whole reason
 * this cannot be a constant per slot.
 */
function horizontalOrigin(
  slot: Slot,
  textWidth: number,
  page: { readonly width: number; readonly margin: number },
): number {
  if (slot === 'left') return page.margin;
  if (slot === 'right') return page.width - page.margin - textWidth;
  // CENTRED ON THE PAGE, not on the space between the margins. They are the
  // same number for a symmetric margin and differ the moment one is not, and
  // the page's own centre is what a reader's eye uses.
  return (page.width - textWidth) / 2;
}
