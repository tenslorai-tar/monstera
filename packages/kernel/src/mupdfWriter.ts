import * as mupdf from 'mupdf';

import type { ByteImage, EngineWriter, MupdfSession, SavePurpose } from './engineSeam.js';

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

/**
 * A MuPDF buffer's bytes, **copied out of the engine's memory**, with the buffer
 * released.
 *
 * ## `asUint8Array()` IS A VIEW INTO THE WASM HEAP, and the heap moves
 *
 * Read from `mupdf/dist/mupdf.js` on 2026-09-07: it answers
 * `HEAPU8.subarray(data, data + size)`. So the array is a window onto memory the
 * engine owns, and two things can happen to it — the buffer is freed and the
 * bytes are reused, or the heap **grows**, which replaces `HEAPU8` and leaves
 * every earlier view **detached**.
 *
 * The second is not theoretical. `pageAnnotations.test.ts` reached it while a
 * case held a serialised document across later engine work, and the failure is
 * the one this hazard produces: *"Cannot perform Construct on a detached
 * ArrayBuffer"*, thrown when those bytes were handed back to `openDocument`.
 * It appeared only once the file did enough work to grow the heap — which is
 * why it had not appeared before, and why nothing about the earlier greens said
 * the bytes were safe.
 *
 * `ByteImage` is the document's canonical bytes, held by the service across
 * commands and written to disk by the save pipeline. Those are exactly the
 * bytes that must not be a window onto somebody else's allocator.
 *
 * The buffer is dropped rather than left to a finaliser, for `pageLinks.ts`'
 * reason: MuPDF's JS objects hold native memory whose finaliser runs on its own
 * schedule.
 */
export function copiedOut(buffer: mupdf.Buffer): ByteImage {
  try {
    // `new Uint8Array(view)` COPIES, where `view.subarray()` would not: the
    // constructor allocates and reads through, so what comes back owns its own
    // `ArrayBuffer` — which is also the property the proof asserts, because a
    // copy's `buffer.byteLength` equals its own and a view's does not.
    return new Uint8Array(buffer.asUint8Array());
  } finally {
    buffer.destroy();
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
 * Sessions a removal-purpose command has been applied to.
 *
 * ## Why the state is here and not a parameter on `serialise`
 *
 * [ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md).
 * MuPDF collects at write time and has no in-session equivalent, so the objects
 * a removal unlinks stay in this document until the session closes — which
 * makes *a removal has happened here* a property of the session rather than of
 * the moment somebody asks for bytes. `CommandBus.execute` serialises **before**
 * apply to mint a checkpoint, so a live-session removal's own execution never
 * asks for bytes at all, and there is no single call site a purpose could ride
 * in on.
 *
 * A `WeakSet` because the key is the session token and the entry must not keep
 * one alive: `close` drops the document, and a session that has been closed can
 * never be serialised again.
 *
 * ## It is one-way, and that is the safe direction
 *
 * Nothing removes a session from this set. A document that has had content
 * removed does not stop having had it — a later ordinary command does not make
 * the orphans safe — so the only transition is *ordinary → removal*, and the
 * absent transition is the one whose bug is a leak.
 */
const removals = new WeakSet<MupdfSession>();

/**
 * Runs `work` and records that this session has had content removed.
 *
 * {@link withDocument}'s shape for a command declaring `purpose: 'removal'`.
 * Separate rather than a flag, so the call reads as what it is at the one place
 * a reviewer meets it, and so the ordinary helper cannot be given a `true` by a
 * caller who has not thought about it.
 *
 * **What stops a future removal command from using the wrong one is not this
 * name.** It is `removalCollects.test.ts`, whose roster is derived from
 * `declaredCommands` — every kind declaring `purpose: 'removal'` owes a case
 * proving its serialised bytes no longer carry what it removed. A command added
 * to that axis arrives owing evidence rather than inheriting this one's.
 *
 * @template T
 */
export function withDocumentRemoving<T>(
  session: MupdfSession,
  work: (document: mupdf.PDFDocument) => T,
): Promise<T> {
  return promised(() => {
    const answer = work(documentFor(session));
    // MARKED AFTER THE WORK, so a mutation that threw does not leave a session
    // collecting for a removal that never happened. `documentFor` refuses an
    // unknown token first, which is what keeps a forged session out of the set.
    removals.add(session);
    return answer;
  });
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

/**
 * Decodes image bytes a person picked.
 *
 * Exported for {@link newDocument}'s reason — one value import of the binding
 * in this package — and it is the second caller that reason anticipated.
 *
 * **The format is SNIFFED here rather than declared by the caller**, which is
 * the opposite of `insertImagePage`, and the difference is which library does
 * the work: `@cantoo/pdf-lib` offers `embedJpg` and `embedPng` as two calls, so
 * something must choose; MuPDF's `Image` takes bytes and decides. A media type
 * carried alongside would be a second opinion about a question this constructor
 * already answers (B3a), and it would be the weaker of the two — a caller reads
 * a file extension, and this reads the bytes.
 *
 * **The decode happens in the engine host**, which is where a hostile image
 * should meet a decoder: invariant 25's containment is exactly what a malformed
 * JPEG is for. It throws on anything it cannot read, and that throw is what
 * validates the file rather than a check anywhere upstream.
 */
export function decodedImage(bytes: Uint8Array): mupdf.Image {
  return new mupdf.Image(bytes);
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
   * The canonical bytes for the session's current state, for a stated purpose.
   *
   * ## The adapter is TOLD the purpose; it does not choose one
   *
   * This comment used to say save mode belongs to the pipeline and *"an adapter
   * that quietly chose one would be a second writer of that concern"*. That
   * sentence is still the rule and this is not a departure from it: the choice
   * is the **command's**, declared once in `commandDeclarations.ts`, and what
   * happens here is the translation of a purpose into one engine's option
   * string — which is the one thing only this module can do
   * ([ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)).
   *
   * What changed is where §4's removal row is applied. It read as the disk
   * save's business until it was measured: `bake(false, true)` unlinks nine
   * widgets and the empty option string writes all nine back out, the object
   * count **growing** 49 to 55, so the orphans are in the canonical image long
   * before any file is written.
   *
   * ## Why `garbage` and not `garbage=deduplicate`
   *
   * Measured 2026-09-07, all three of MuPDF's levels leave **zero** widget and
   * field dictionaries: `garbage` and `garbage=compact` answer 22 objects and
   * `garbage=deduplicate` answers 21. The removal is complete at the first
   * level, and the extra levels buy a smaller file rather than a cleaner one —
   * so this asks for exactly what invariant 19 requires and nothing that would
   * make a save's output depend on a size decision nobody took.
   *
   * An empty option string remains a plain save: no incremental update, no
   * garbage collection, no re-encryption.
   */
  serialise(session: MupdfSession): Promise<ByteImage> {
    // EXHAUSTIVE OVER THE UNION rather than an `if`, so a third purpose is a
    // compile error here instead of an option string silently defaulting to the
    // one that keeps what a command removed.
    const options: Record<SavePurpose, string> = { ordinary: '', removal: 'garbage' };
    const purpose: SavePurpose = removals.has(session) ? 'removal' : 'ordinary';
    return promised(() => copiedOut(documentFor(session).saveToBuffer(options[purpose])));
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
