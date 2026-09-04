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

/** The two edges a page has, top first. */
const EDGES = ['header', 'footer'] as const;

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

    for (const edge of EDGES) {
      const y = verticalOrigin(edge, { height, margin: command.marginPoints });
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
 *
 * **Exported for `batesNumberPages`, which is the second caller and the one
 * that made this worth naming.** It is the same question — *where on this page
 * does an edge-pinned string start* — asked by a command whose text is
 * generated rather than typed. That is a real shared concern, unlike *draw text
 * on pages*, which this file's header explains is not one.
 */
export function horizontalOrigin(
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

/**
 * The baseline for an edge, from the page's height and the margin.
 *
 * Shared with `batesNumberPages` for {@link horizontalOrigin}'s reason, and it
 * is the smaller half of the pair: one line, and worth a name only because the
 * two commands agreeing about which edge is which is a property rather than a
 * coincidence. A Bates stamp in the footer must land where a footer lands, or a
 * document carrying both has two different ideas of the bottom margin.
 */
export function verticalOrigin(
  edge: 'header' | 'footer',
  page: { readonly height: number; readonly margin: number },
): number {
  return edge === 'header' ? page.height - page.margin : page.margin;
}

/**
 * One Bates identifier: the prefix, the number zero-padded to `digits`, the
 * suffix.
 *
 * **`padStart` and not a slice**, so a number wider than `digits` keeps every
 * digit. Truncating would produce a *different exhibit* under a name that looks
 * right, which is the failure mode this feature cannot have — and the reason
 * the contract calls `digits` a minimum width rather than a width.
 */
export function batesIdentifier(
  command: Pick<CommandOfKind<'batesNumberPages'>, 'prefix' | 'suffix' | 'digits'>,
  value: number,
): string {
  return `${command.prefix}${String(value).padStart(command.digits, '0')}${command.suffix}`;
}

/**
 * Capture — which always refuses, exactly as the two above do.
 */
export const captureBatesNumberPages: (
  image: ByteImage,
  command: CommandOfKind<'batesNumberPages'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page that has been drawn on has no recordable prior state: restoring it means ' +
      'restoring its whole content stream, which is document-scaled and would be counted by ' +
      'nothing',
  });

/** Invert — unreachable by the type, present because the table's shape requires it. */
export const invertBatesNumberPages: Invert<'pdf-lib', 'batesNumberPages'> = (
  _image,
  _inverse,
) => {
  throw new Error(
    'batesNumberPages has no inverse and this is unreachable: its prior state is `never`, so ' +
      'no caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Stamps a continuous Bates sequence across the pages named.
 *
 * ## THE SEQUENCE FOLLOWS THE SCOPE, not the page index
 *
 * The k-th page in the resolved scope carries `start + k`, so stamping pages 5,
 * 6 and 9 from 1 gives 1, 2, 3 — which is what the feature is for, and what
 * separates it from a header carrying `{n}`. An implementation using the page
 * index would produce 6, 7, 10 and pass every test whose scope is `'all'` from
 * page 0, which is why the proof's load-bearing case names a gapped list.
 *
 * The order is the scope's own, so a caller naming `[9, 5]` numbers 9 first.
 * `pagesOf` preserves a list verbatim for exactly this kind of reason, and it
 * is stated there.
 */
export const applyBatesNumberPages: Apply<'pdf-lib', 'batesNumberPages'> = async (
  image,
  command,
) => {
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

  for (const [position, index] of targets.entries()) {
    const page = pages[index];
    if (page === undefined) continue;
    const { width, height } = page.getSize();

    // POSITION IN THE SCOPE, not `index`. The two agree for a whole-document
    // scope starting at page 0, which is every fixture somebody writes first.
    const text = batesIdentifier(command, command.start + position);
    page.drawText(text, {
      x: horizontalOrigin(command.slot, font.widthOfTextAtSize(text, command.fontSize), {
        width,
        margin: command.marginPoints,
      }),
      y: verticalOrigin(command.edge, { height, margin: command.marginPoints }),
      size: command.fontSize,
      font,
      color: STAMP_BLACK,
    });
  }

  return document.save();
};
