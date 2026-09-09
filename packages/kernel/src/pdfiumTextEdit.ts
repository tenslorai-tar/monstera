import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import { pdfiumWriter, replaceTextObjects, textObjectText } from './pdfiumFfi.js';

/**
 * In-place text editing, as the bus calls it: **region replacement**.
 *
 * ## Every function here OPENS, and that is ADR-0047's shape rather than waste
 *
 * PDFium is a **byte-image** writer of record
 * ([ADR-0047](../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)),
 * so what the bus hands each of these is the document's current bytes and what
 * an apply answers is new bytes. There is no session between calls to reuse,
 * which is the point: a writer that holds nothing between commands cannot hold
 * a competing opinion about the document, and `savePipeline.ts`'s *which bytes
 * win* stays unaskable rather than answered.
 *
 * The cost of that is a parse per call, and it was measured before the shape
 * was chosen rather than after: `FPDF_LoadMemDocument` is **0.1–3.5 ms** across
 * every cell `proof:editcost` builds, against a `FPDFPage_GenerateContent` that
 * is the whole cost of an edit (0.17–29.18 ms, tracking the document's
 * content). A second open is inside the noise of the operation it belongs to.
 *
 * ## Why this is its own module and not part of `commandSpecs.ts`
 *
 * `pdfLibWriter.ts`'s reason, one engine along and stronger. `commandSpecs.ts`
 * reaches `rotatePages.ts` → `mupdfWriter.ts` → MuPDF, so a PDFium host that
 * imported it to find its own `apply` would load the **other engine** into the
 * contained process that exists to hold this one. The edge therefore runs one
 * way: `commandSpecs.ts` spreads `pdfiumSpecs` and this module names no MuPDF
 * spec, so `import-x/no-cycle` has nothing to find and the PDFium host's module
 * graph reaches no MuPDF.
 *
 * ## Every session opened here is closed here, on every path
 *
 * A `PdfiumSession` holds a native document **and the bytes it is still
 * reading** (`pdfiumFfi.ts`'s `Live`). A throw that skipped the close would
 * leak both, in a process whose job object bounds its memory — so each function
 * below is a `try`/`finally` around one session, and there is no path that
 * returns while one is open.
 */

/**
 * What a replacement has to put back, and **which object puts it back**.
 *
 * The page and the index travel with the string because an inverse RESTORES
 * rather than derives (ADR-0009 §3): an invert that reached for the command to
 * find out where to write would be an inverse computed from the intent, which
 * is the one shape §3 forbids. See `CommandPrior.replaceTextObject`.
 */
export interface PriorTextObject {
  readonly page: number;
  readonly index: number;
  readonly text: string;
}

/**
 * Runs `work` against a session opened from `image`, closing it however `work`
 * ends.
 *
 * The three exports below are the same four lines with a different middle, and
 * this is where the `finally` lives so that none of them can be written
 * without one.
 */
async function onImage<T>(
  image: ByteImage,
  work: (session: Awaited<ReturnType<typeof pdfiumWriter.open>>) => Promise<T>,
): Promise<T> {
  const session = await pdfiumWriter.open(image);
  try {
    return await work(session);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * The string the named object currently holds.
 *
 * ## It captures BEFORE the bus applies, and a failed read is an outcome
 *
 * `captured: false` is what the bus answers by taking a checkpoint and applying
 * anyway (ADR-0009's 2026-08-19 decision), so a page or an index this document
 * does not have is reported here rather than thrown. That is not leniency: the
 * apply refuses the same input a moment later, with the adapter's own message,
 * and reporting it twice from two places would be two opinions about one
 * refusal.
 *
 * The `reason` is this side's own text and names no document content — it
 * carries the numbers the caller sent and nothing the file said.
 */
export async function captureReplaceTextObject(
  image: ByteImage,
  command: CommandOfKind<'replaceTextObject'>,
): Promise<CaptureResult<PriorTextObject>> {
  return onImage(image, async (session) => {
    try {
      const text = await textObjectText(session, command.page, command.index);
      return { captured: true, prior: { page: command.page, index: command.index, text } };
    } catch {
      return {
        captured: false,
        reason:
          `page ${String(command.page)} object ${String(command.index)} is not a text object ` +
          'this document has, so there is no prior string to record',
      };
    }
  });
}

/**
 * Replaces one text object's string and answers the document's new bytes.
 *
 * ## One entry in the list, and the list is the adapter's shape rather than
 * this command's
 *
 * `replaceTextObjects` takes several because a content stream is regenerated
 * once per command and not once per object — ADR-0047 Decision 2, measured at
 * 13.7× over forty replacements. Region replacement names one object, so it
 * passes one; **document-wide replace-all is the caller that passes many**, and
 * it will pass them through this same adapter call rather than looping over
 * this function, which is what the plural signature exists to make possible.
 */
export async function applyReplaceTextObject(
  image: ByteImage,
  command: CommandOfKind<'replaceTextObject'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await replaceTextObjects(session, command.page, [
      { index: command.index, text: command.text },
    ]);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Puts the recorded string back, and answers the document's new bytes.
 *
 * Reads nothing off a command, which is what {@link PriorTextObject} carrying
 * page and index is for. `applyReplaceTextObject`'s body with the prior's three
 * fields in place of the command's — written out rather than shared, because a
 * helper taking *(page, index, text)* would be one call away from an invert
 * that took its coordinates from the intent.
 */
export async function invertReplaceTextObject(
  image: ByteImage,
  inverse: PriorTextObject,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await replaceTextObjects(session, inverse.page, [
      { index: inverse.index, text: inverse.text },
    ]);
    return pdfiumWriter.serialise(session);
  });
}
