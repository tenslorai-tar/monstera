import * as mupdf from 'mupdf';

import type { ByteImage, EngineWriter, MupdfSession } from './engineSeam.js';

/**
 * The one adapter behind the engine seam today.
 *
 * MuPDF is the writer of record for page-tree work because invariant L6 needs
 * the tree rewritten **in place** through its own `PDFObject` API — rebuilding
 * into a new document drops `/AcroForm`, `/Outlines`, `/Names` and
 * `/OCProperties`, which ADR-0006 measured rather than assumed.
 *
 * The byte-image side of the seam has no adapter and is not missing one; see
 * `engineSeam.ts`.
 */

/**
 * A live MuPDF session's native document.
 *
 * The native document is held **beside** the token in a `WeakMap`, not on it.
 * Two things follow, and neither is available from a property on the object:
 *
 * - **Provenance is unforgeable.** `MupdfSession` is structural, so
 *   `{ engine: 'mupdf' }` satisfies it; a duck-typed check for a `document`
 *   property would accept any object carrying one, and hand it to a native
 *   call. Map membership can only come from `open`.
 * - **A closed session stays closed.** `close` deletes the entry, so closing
 *   twice is a named error rather than a second `destroy()` on a freed native
 *   document.
 *
 * The map is weak, so a session the kernel drops without closing does not pin
 * the entry — the native document still leaks until GC runs its finaliser,
 * which is why `DocumentService` calls `close` in its teardown rather than
 * relying on this.
 */
const documents = new WeakMap<MupdfSession, mupdf.PDFDocument>();

/**
 * Runs synchronous engine work as a promise, turning a **throw into a
 * rejection**.
 *
 * MuPDF's binding is synchronous; the seam is async because other writers are
 * not. Without this the two disagree in the worst way: a caller writing
 * `.catch()` around a call that throws before returning a promise does not
 * catch it. `async` would do the same job, but it reads as "there is an await
 * here" and the linter is right that there is not — this says what is actually
 * happening. It is the same trap `DocumentService.run` closed by being `async`.
 *
 * @template T
 * @param {() => T} work
 * @returns {Promise<T>}
 */
function promised<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The document behind a session this adapter opened and has not closed. */
function documentFor(session: MupdfSession): mupdf.PDFDocument {
  const document = documents.get(session);
  if (document === undefined) {
    throw new Error(
      'This MuPDF session was not produced by this adapter, or it has already been closed. ' +
        'Sessions are opened from the canonical bytes and are not transferable.',
    );
  }
  return document;
}

/**
 * Runs `work` against the native document behind a session.
 *
 * The single door between a session token and a `PDFDocument`, and the reason
 * it is here rather than on the seam: `documentFor` is the provenance check, so
 * routing every reader through this keeps *"only this adapter turns a token
 * into a document"* true no matter how many command handlers exist. A getter
 * returning the document would be the same thing with the check optional.
 *
 * Command handlers are the callers. They live in their own modules because a
 * boundary adapter that also implements `rotatePages` is two concerns in one
 * file, and the next command would make it three.
 *
 * @template T
 */
export function withDocument<T>(
  session: MupdfSession,
  work: (document: mupdf.PDFDocument) => T,
): Promise<T> {
  return promised(() => work(documentFor(session)));
}

/**
 * Runs `work` against the native documents behind **two** sessions.
 *
 * ## Why this exists rather than nesting {@link withDocument}
 *
 * ADR-0040's cross-document commands need both documents live at once — a
 * graft reads the source while writing the target, so neither can be resolved,
 * used and released before the other. Nesting would work at runtime and types
 * as `Promise<Promise<T>>`, which every caller then has to flatten; and it puts
 * the provenance check for the two sessions at two nesting levels, where one of
 * them is easy to write without.
 *
 * The **same** `documentFor` runs for both, which is the property that matters:
 * *only this adapter turns a token into a document* stays true for the second
 * token as much as the first, so a forged or closed source session is refused
 * exactly as a target one is.
 *
 * ## The two parameters are named, and the order is the command's
 *
 * `target` first, `source` second, matching `Apply`'s
 * `(session, command, source)`. Both are `MupdfSession`, so a transposition is
 * **not** a type error — `engineSeam.ts` says so at `Apply` and it is why the
 * bus passes them positionally from a map keyed by `DocId` rather than by role.
 * Naming them here is what makes a transposed call readable at the one place it
 * could happen.
 *
 * @template T
 */
export function withDocuments<T>(
  target: MupdfSession,
  source: MupdfSession,
  work: (target: mupdf.PDFDocument, source: mupdf.PDFDocument) => T,
): Promise<T> {
  return promised(() => work(documentFor(target), documentFor(source)));
}

/**
 * A blank PDF, for an operation whose output is a document that did not exist.
 *
 * **Not a session**, and that distinction is the whole reason this is here
 * rather than beside `open`. A `MupdfSession` is a document the kernel owns and
 * an adapter must close; this is a transient the caller serialises and drops
 * within one call. Minting a session for it would put an entry in the
 * provenance map that nothing ever closes.
 *
 * Exported so `pageExtract.ts` can build one without a second
 * `import * as mupdf` — every value import of the binding in this package is a
 * place invariant 20 has to be argued about, and one is enough.
 */
export function newDocument(): mupdf.PDFDocument {
  return new mupdf.PDFDocument();
}

export const mupdfWriter: EngineWriter<MupdfSession> = {
  /**
   * Parses `image` into a session.
   *
   * The MIME type is stated rather than sniffed. A filename never selects
   * native code here (invariant 23): the shim names the entry point it wants,
   * and MuPDF's extension-driven writer dispatch — which reaches Tesseract for
   * a path ending `.ocr` — is exactly what that rule keeps closed.
   *
   * The dispatcher's own symbol is deliberately not written here. Invariant 23
   * bans that family from shipped code, the advisory register's reachability
   * walk is a text search that cannot tell a comment from a call, and it
   * expired this verdict when an earlier draft of this line named it. The
   * instrument was right: a comment in a shipped file is shipped text.
   */
  // Every method is `async` so a failure is a REJECTION, never a synchronous
  // throw. The interface promises one; MuPDF throws the other, and a caller
  // writing `.catch()` around a call that throws before returning a promise
  // does not catch it. Mixing the two is the trap `DocumentService.run` closed
  // the same way.
  open(image: ByteImage): Promise<MupdfSession> {
    return promised(() => {
      const document = mupdf.PDFDocument.openDocument(image, 'application/pdf');
      if (!(document instanceof mupdf.PDFDocument)) {
        // `openDocument` is typed as returning the base Document. A non-PDF
        // that parsed would otherwise reach page-tree code assuming PDF objects.
        throw new Error('Opened document is not a PDF, so no PDF writer may act on it.');
      }
      // The one place a MupdfSession is minted. Keeping this cast unexported is
      // what makes the brand mean "this adapter produced it".
      const session = { engine: 'mupdf' } as MupdfSession;
      documents.set(session, document);
      return session;
    });
  },

  /**
   * The canonical bytes for the session's current state.
   *
   * An empty option string is a plain save: no incremental update, no
   * garbage-collection pass, no re-encryption. Save *mode* is ADR-0008's
   * decision and belongs to the save pipeline, not to the seam — an adapter
   * that quietly chose one would be a second writer of that concern.
   */
  serialise(session: MupdfSession): Promise<ByteImage> {
    return promised(() => documentFor(session).saveToBuffer('').asUint8Array());
  },

  /**
   * Releases the native document.
   *
   * Called by `DocumentService`'s teardown, which runs inside the per-document
   * lane after pending work drains — so this cannot land underneath a command
   * still executing against the session.
   */
  close(session: MupdfSession): Promise<void> {
    return promised(() => {
      const document = documentFor(session);
      // Removed BEFORE destroying, so a second close is a named error rather
      // than a second `destroy()` on a freed native document.
      documents.delete(session);
      document.destroy();
    });
  },
};
