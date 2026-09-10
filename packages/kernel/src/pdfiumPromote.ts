import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import { pdfiumWriter, promoteFormObjects } from './pdfiumFfi.js';

/**
 * Normalize-then-edit, as the bus calls it.
 *
 * ## What it closes
 *
 * `FPDFPage_GetObject` does not descend into a Form XObject, and every editing
 * command this build ships names an object by its index in that walk. So text
 * emitted as a block — Office, InDesign, PowerPoint — is findable through
 * `FPDFText` and editable by nothing. Measured over the supplied corpus on
 * 2026-09-10: **two of eleven documents**, one of them with no page-level text
 * at all, and one mixing 307 unreachable characters with 647 reachable.
 *
 * The promotion moves each form's children onto the page with the form's matrix
 * composed in, then removes the emptied form. Afterwards the page's objects are
 * exactly what they looked like, and every editing command can name them.
 *
 * ## Its own command rather than a step inside the first edit
 *
 * The founding record says *on first edit of such a page*, which reads as
 * automatic. It cannot be, and the reason is mechanical rather than a
 * preference: the promotion **renumbers the page**, and `replaceTextObject`'s
 * prior is a list of indices. An edit that promoted on its way through would
 * record a prior naming objects that no longer exist — an undo that puts text
 * somewhere else rather than one that fails.
 *
 * ## A page with no form costs nothing
 *
 * `promoteFormObjects` regenerates only when something moved, so dispatching
 * this at a page that needs it is cheap and dispatching it at one that does not
 * is free. The count comes back so a caller can tell the two apart.
 */

/**
 * Runs `work` against a session opened from `image`, closing it however it ends.
 *
 * The fourth copy of these four lines in this package, and they stay copied for
 * the reason `pdfiumReplaceAll.ts` gives: sharing them would put an import edge
 * between modules with no other reason to know about each other, and the shared
 * thing would be a `try`/`finally`.
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
 * Says why a promotion has no prior, so the bus takes a checkpoint.
 *
 * **The fourth distinct reason in this build, and it is the first one's shape
 * arrived at backwards.** `deletePageObjects` has no prior because PDFium can
 * describe an object and not rebuild one. Here the prior would be *a Form
 * XObject and its placement* — and PDFium's public API can take a form apart
 * (`FPDFFormObj_RemoveObject`) and offers nothing that builds one. So the
 * inverse is unrepresentable for the same reason, reached from the far end: the
 * pieces are all recoverable and the container is not.
 */
export function capturePromoteFormObjects(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason:
      'a promotion cannot be recorded as prior state: putting it back means rebuilding a Form ' +
      'XObject, and PDFium can take one apart and cannot construct one',
  });
}

/**
 * Unreachable, and required by `CommandSpec`'s shape.
 *
 * `CommandPrior` is `never` here, so nothing can construct an argument.
 * Throwing rather than resolving keeps a widened type from landing as an undo
 * that did nothing.
 */
export function invertPromoteFormObjects(): Promise<ByteImage> {
  throw new Error(
    'a promotion has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
}

/**
 * Promotes every form on one page, and answers the new bytes.
 *
 * @throws where PDFium refuses a step it began — a half-promoted page is a page
 *   whose text has moved, and the adapter refuses rather than continuing.
 */
export async function applyPromoteFormObjects(
  image: ByteImage,
  command: CommandOfKind<'promoteFormObjects'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await promoteFormObjects(session, command.page);
    return pdfiumWriter.serialise(session);
  });
}
