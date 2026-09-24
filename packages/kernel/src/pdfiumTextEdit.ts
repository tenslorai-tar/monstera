import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import {
  editTextBlocks,
  pdfiumWriter,
  replaceTextObjects,
  textObjectText,
  drawnTexts,
} from './pdfiumFfi.js';
import { TextNotWritableError } from './textEditRefusals.js';

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
 * What a replacement has to put back, and **which objects put it back**.
 *
 * The page and the indices travel with the strings because an inverse RESTORES
 * rather than derives (ADR-0009 §3): an invert that reached for the command to
 * find out where to write would be an inverse computed from the intent, which
 * is the one shape §3 forbids. See `CommandPrior.replaceTextObject`.
 *
 * ## One prior per named object, and the undo is ONE step
 *
 * A command names a page's objects as a list, so its inverse is the same list
 * with the strings that were there. Recording one prior per object and
 * restoring them in one call is what keeps a line edit a single undo — and it
 * is the same reason the command carries a list rather than the caller sending
 * several commands.
 */
export interface PriorTextObjects {
  readonly page: number;
  readonly objects: readonly { readonly index: number; readonly text: string }[];
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
): Promise<CaptureResult<PriorTextObjects>> {
  return onImage(image, async (session) => {
    const objects: { index: number; text: string }[] = [];
    for (const replacement of command.replacements) {
      try {
        // SEQUENTIALLY, on one session. `textObjectText` loads and closes a text
        // page per call, and PDFium's page handles are not safe to work through
        // concurrently — a `Promise.all` here would interleave loads against one
        // document for no gain, the whole read being in-memory.
        const text = await textObjectText(session, command.page, replacement.index);
        objects.push({ index: replacement.index, text });
      } catch {
        // ALL OR NOTHING, and that is the capture's own rule rather than a
        // convenience: a partial prior would invert a line edit into some of the
        // runs it changed, leaving the document in a state the user never saw
        // and no further undo can leave. One unreadable index makes the whole
        // command take a checkpoint instead, which is what `captured: false`
        // asks the bus for.
        return {
          captured: false,
          reason:
            `page ${String(command.page)} object ${String(replacement.index)} is not a text ` +
            'object this document has, so there is no prior string to record',
        };
      }
    }
    return { captured: true, prior: { page: command.page, objects } };
  });
}

/**
 * Replaces the named text objects' strings and answers the document's new bytes.
 *
 * ## The whole list in ONE call, which is where the cost is
 *
 * `replaceTextObjects` takes several because a content stream is regenerated
 * once per call and not once per object — ADR-0047 Decision 2, measured at
 * 13.7× over forty replacements. Passing the command's list straight through is
 * therefore the point of the plural payload rather than an implementation
 * detail: a loop over this function would pay `FPDFPage_GenerateContent` per
 * run, and a visual line is several runs.
 */
export async function applyReplaceTextObject(
  image: ByteImage,
  command: CommandOfKind<'replaceTextObject'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await replaceTextObjects(session, command.page, command.replacements);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Puts the recorded strings back, and answers the document's new bytes.
 *
 * Reads nothing off a command, which is what {@link PriorTextObjects} carrying
 * the page and the indices is for. `applyReplaceTextObject`'s body with the
 * prior's fields in place of the command's — written out rather than shared,
 * because a helper taking *(page, list)* would be one call away from an invert
 * that took its coordinates from the intent.
 *
 * One call for the whole list, for the apply's reason and one of its own: an
 * undo that regenerated per run would also arrive as several byte images, and a
 * single inverse is what makes the step reversible in one move.
 */
export async function invertReplaceTextObject(
  image: ByteImage,
  inverse: PriorTextObjects,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await replaceTextObjects(session, inverse.page, inverse.objects);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Edits blocks of text on one page in place and answers the document's new bytes
 * ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md),
 * [ADR-0097](../../../docs/DECISIONS/0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)).
 *
 * Everything the edit decides — which runs change, where a line breaks, where
 * the new lines go, which writes need a standard-font twin — is
 * `editTextBlocks`' in the adapter, on one loaded page: the diff must read the
 * runs at the moment it writes them, and a read taken in a separate open would
 * be a second reading of the page to diff against.
 *
 * Text neither a run's font nor its twin can carry throws `TextNotWritableError`
 * and this answers no bytes — so the document is exactly what it was.
 *
 * ## Every write is read back from the SAVED bytes, reopened
 *
 * The adapter reads each write back from the live page, and for a run's own font
 * that agrees with a reader of the file — 0 disagreements in 457 corpus writes
 * (`scripts/research/pdfiumFallbackFont.mjs`). A standard-font TWIN is where it
 * does not: measured 2026-09-24, in a document already holding a Helvetica-family
 * font declared in StandardEncoding (Helvetica, Helvetica-Bold, Arial), the
 * Helvetica twin reads `é` on the live page and is saved into that font's own
 * dictionary, where a reader decodes the byte `E9` as `Ø`. Times-Roman and
 * Courier in the same encoding twin correctly, because their twin is a different
 * font.
 *
 * So the new bytes are opened again and every write read back as a reader reads
 * it, and anything that says other than what was written refuses the edit. There
 * is no retry: the failure this catches is the twin collapsing into the page's
 * font, and a second attempt would make the same twin.
 */
export async function applyEditTextBlock(
  image: ByteImage,
  command: CommandOfKind<'editTextBlock'>,
): Promise<ByteImage> {
  const { bytes, written } = await onImage(image, async (session) => {
    const placed = await editTextBlocks(session, command.page, command.blocks);
    return { bytes: await pdfiumWriter.serialise(session), written: placed };
  });
  const read = await onImage(bytes, (session) => drawnTexts(session, command.page, written.map((write) => write.index)));
  if (written.some((write, at) => read[at] !== write.text)) throw new TextNotWritableError();
  return bytes;
}

/**
 * Says why a block edit has no prior, so the bus takes a checkpoint.
 *
 * `captureDeletePageObjects`' reason: the edit can make and remove objects, and
 * PDFium can describe an object and cannot rebuild one. A prior of the old
 * strings would restore the text and keep the lines it made.
 */
export function captureEditTextBlock(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason:
      'a block edit can make and remove text objects, and PDFium cannot rebuild a removed one, ' +
      'so the strings it changed are not enough to put the block back',
  });
}

/**
 * Unreachable, and required by `CommandSpec`'s shape: `CommandPrior.editTextBlock`
 * is `never`, so nothing can construct an argument for it.
 */
export function invertEditTextBlock(): Promise<ByteImage> {
  return Promise.reject(
    new Error('editTextBlock has no inverse: its undo is a checkpoint, and no prior can be built for it.'),
  );
}
