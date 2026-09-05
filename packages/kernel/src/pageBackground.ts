import { PDFArray, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import { COORDINATE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import { pagesOf } from './pageScope.js';

/**
 * A page background — a filled rectangle **behind** the page's own content.
 *
 * ## *Behind* is the whole feature, and a drawing call cannot give it
 *
 * PDF paints in content-stream order, and every drawing API appends. So
 * `page.drawRectangle(...)` with the page's own box produces a rectangle over
 * the document: the text vanishes, the command looks like a rendering bug, and
 * every assertion that *the page now has a fill* passes.
 *
 * A background is therefore a **prepend**, which is an operation on the page's
 * `/Contents` rather than a different call. `/Contents` may be one stream or an
 * array of them (PDF 32000-1 §7.7.3.3), and the two are concatenated in order,
 * so putting a new stream first is exactly *paint this before anything else*.
 *
 * ## The graphics state is saved and restored around the fill
 *
 * `q … Q` brackets it. Without that, the fill's colour would still be current
 * when the page's own stream begins — and a page whose first operator assumes
 * the default black would draw in the background's colour instead. That is the
 * one way a prepended stream can corrupt content it is meant to sit behind, and
 * it is invisible on any page whose content sets its own colour first, which is
 * most of them.
 *
 * ## The rectangle is the page's own box, per page
 *
 * Read where it is drawn, so a document of mixed page sizes fills correctly
 * with nothing per-page on the wire — `pageWatermark.ts`'s reason on a
 * different geometry.
 */

/** Capture — which always refuses, for `pageWatermark.ts`'s reason. */
export const captureSetPageBackground: (
  image: ByteImage,
  command: CommandOfKind<'setPageBackground'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page whose content stream has been changed has no recordable prior state: restoring ' +
      'it means restoring the whole stream, which is document-scaled and would be counted by ' +
      'nothing',
  });

/** Invert — unreachable by the type, present because the table's shape requires it. */
export const invertSetPageBackground: Invert<'pdf-lib', 'setPageBackground'> = (
  _image,
  _inverse,
) => {
  throw new Error(
    'setPageBackground has no inverse and this is unreachable: its prior state is `never`, so ' +
      'no caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Prepends a full-page fill to each named page's content.
 *
 * ## Every page is validated before the first is written
 *
 * `pageCrop.ts`'s ordering: a command naming one page this document does not
 * have changes nothing.
 */
export const applySetPageBackground: Apply<'pdf-lib', 'setPageBackground'> = async (
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

  const context = document.context;

  for (const index of targets) {
    const page = pages[index];
    // NOT REACHABLE — validated above against this same array.
    if (page === undefined) continue;

    const { width, height } = page.getSize();
    // `q … Q` BRACKETS THE FILL. See the module note: without the restore, the
    // background's colour is still current when the page's own stream starts.
    const operators =
      `q\n${fixed(command.red)} ${fixed(command.green)} ${fixed(command.blue)} rg\n` +
      // EVERY NUMBER THROUGH `fixed`, including the origin. Writing `0 0`
      // directly is shorter and correct, and it makes the no-exponential
      // guarantee true of two of the four numbers rather than of the operator —
      // which is the kind of partial property that reads as whole.
      `${fixed(0)} ${fixed(0)} ${fixed(width)} ${fixed(height)} re\nf\nQ\n`;

    const stream = context.flateStream(operators);
    const reference = context.register(stream);

    // PREPENDED, and both `/Contents` shapes are handled because the format
    // permits both: one stream or an array of them. A page with none is an
    // empty page, and the fill becomes its only content.
    const existing = page.node.get(PDFName.of('Contents'));
    const contents = PDFArray.withContext(context);
    contents.push(reference);
    if (existing instanceof PDFArray) {
      for (let at = 0; at < existing.size(); at += 1) contents.push(existing.get(at));
    } else if (existing !== undefined) {
      contents.push(existing);
    }
    page.node.set(PDFName.of('Contents'), contents);
  }

  return document.save();
};

/**
 * A coordinate or colour component as content-stream text.
 *
 * **The no-exponential rule and its reason now live in `contentNumbers.ts`**,
 * which is where they were moved when `pageResize.ts` needed them: a rule
 * spelt out at two call sites is one the third caller re-derives (B3a), and
 * the two callers want different precision, so the shared thing is the
 * guarantee and the digits are the argument.
 */
function fixed(value: number): string {
  return contentNumber(value, COORDINATE_DECIMALS);
}

/** Exported for the proof, which asserts the operator text a page carries. */
export const BACKGROUND_MARKER = 're\nf\nQ';

// `PDFRawStream` is named so the proof can assert what a prepended entry IS,
// rather than only that the array grew.
export type { PDFRawStream };
