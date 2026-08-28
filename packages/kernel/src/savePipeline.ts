import type { DocId, DocVersion } from '@monstera/shared';

import { type AtomicWriteFailure, type AtomicWriteSurface, atomicWrite } from './atomicWrite.js';
import type { DocumentContext, SaveWriter, WriteTargetVerdict } from './documentService.js';
import type { ByteImage } from './engineSeam.js';

/**
 * `ARCHITECTURE.md` §4's save pipeline, and the thing invariant 18 is about.
 *
 * > flush each writer of record once → atomic write → stamp saved version
 *
 * with `checkWriteTarget` in front, because that check is *"the last thing
 * standing between a stale identity and a silent overwrite"* and its own comment
 * settles what a verdict permits: **`sole-writer` is what permits the write.**
 * All five other verdicts refuse, `target-absent` included — a file that
 * vanished is a file whose control did not run, not a clear one.
 *
 * ## What this owns, and what it deliberately does not
 *
 * It owns the **ordering**. Every step here is placed against a way the save
 * can lose the user's work, and the order is the whole argument:
 *
 * 1. **Refuse before writing.** A contested or replaced target is a save that
 *    discards something the user has not seen.
 * 2. **Flush, then write.** The bytes are produced before anything on disk is
 *    touched, so an engine that fails to serialise costs a failed save and not
 *    a damaged file.
 * 3. **Write atomically.** `atomicWrite` keeps the original intact until the
 *    rename — invariant 18's own sentence.
 * 4. **Stamp last.** {@link DocumentContext.markSaved} runs only after the
 *    bytes have landed. Stamped earlier, a failed write would leave a document
 *    that believes the file holds its current version: the user closes it,
 *    nothing prompts, and the work is gone. That is the loss invariant 18
 *    names, produced by an ordering rather than by a bug in any step.
 *
 * It does **not** own which engine to flush. `flush` arrives as a thunk from
 * wherever the writer and the session were created together, because that is
 * the only place they are known to be correlated. §4 says *"each writer of
 * record once"*, and today exactly one writer has an adapter and one session
 * per document, so composing that thunk is unambiguous. **The day a second
 * writer holds a session for one document, §4's sentence stops being a
 * procedure**: two live-session writers each return the whole document from
 * `serialise`, and nothing in the law says which bytes win. That question is
 * answered where the thunk is composed, and it is not answered here, because
 * inventing a merge rule under a feature is what B4 exists to stop.
 *
 * ## Why the whole of it runs inside one lane entry
 *
 * The caller runs this inside `DocumentService.run`, which is why it takes a
 * {@link DocumentContext} rather than a `DocId`. Split across two entries, a
 * command could land between the flush and the stamp — and `markSaved` records
 * *the current version*, so the document would be marked clean at a version
 * whose bytes were never written. One entry makes that unrepresentable rather
 * than unlikely.
 */

/**
 * The one {@link SaveWriter} in existence, minted module-privately.
 *
 * The same mechanism, in the same shape, as `commandBus.ts`' `COMMAND_WRITER`
 * and the supervisor's `EngineSupervisor`: `markSaved` narrowed to a capability
 * whose only production mint is this line, so stamping a document saved is
 * something **this pipeline** does rather than something any lane entry can do.
 *
 * `documentService.ts` used to say `markSaved` "deliberately keeps no token …
 * a token with no minter is a method nobody can call". That was true and is
 * now false: this is the minter, and that comment is corrected in the same
 * commit rather than left standing beside its own refutation.
 */
const SAVE_WRITER = 'save-writer' as SaveWriter;

/** How the pipeline asks whether this document may write to its own file. */
export type WriteTargetCheck = (docId: DocId) => Promise<WriteTargetVerdict>;

/**
 * Where the temp and backup files go for a given target.
 *
 * Supplied rather than derived for {@link atomicWrite}'s reason: what a sibling
 * file may be called is a question about the destination directory, not about
 * this ordering.
 */
export type SaveFileNames = (target: string) => {
  readonly temp: string;
  readonly backup: string;
};

/** Everything the pipeline needs that is not the document itself. */
export interface SaveDependencies {
  readonly checkWriteTarget: WriteTargetCheck;
  readonly surface: AtomicWriteSurface;
  readonly names: SaveFileNames;
  /** Injected so the ladder's cases do not spend real time proving they waited. */
  readonly wait: (ms: number) => Promise<void>;
}

/**
 * What a save did.
 *
 * Three outcomes and no thrown error for any of them, because all three are
 * things a user can be told and act on. Anything that throws out of here is a
 * defect — a closed document, a broken reader contract — and reaches the
 * boundary as `internal` with the diagnostic kept main-side.
 */
export type SaveOutcome =
  /** The bytes are on disk and the document is no longer dirty. */
  | {
      readonly kind: 'saved';
      readonly version: DocVersion;
      readonly bytes: number;
      /** Whether a `.bak` was left holding the user's previous version. */
      readonly backedUp: boolean;
    }
  /**
   * The write-target check refused. The document is untouched and still dirty.
   *
   * **`sole-writer` is excluded from the type, not merely absent in practice.**
   * It is the verdict that PERMITS the write, so a refusal carrying it is a
   * contradiction — and a caller narrowing on the four real refusals should be
   * able to be exhaustive without a branch for a state that cannot occur. B5:
   * the impossible one is unrepresentable rather than handled.
   */
  | {
      readonly kind: 'refused';
      readonly verdict: Exclude<WriteTargetVerdict, { kind: 'sole-writer' }>;
    }
  /** The filesystem refused. The original is intact and the document still dirty. */
  | { readonly kind: 'write-failed'; readonly failure: AtomicWriteFailure };

/**
 * Runs one save, inside the document's lane.
 *
 * @param deps the filesystem and the write-target check
 * @param context the lane entry's own context — proof this is running in the lane
 * @param flush produces the document's current bytes. Composed where the writer
 *   and its session are known to be correlated; see the module comment.
 * @returns what happened, never a thrown outcome.
 */
export async function saveDocument(
  deps: SaveDependencies,
  context: DocumentContext,
  flush: () => Promise<ByteImage>,
): Promise<SaveOutcome> {
  const verdict = await deps.checkWriteTarget(context.docId);
  if (verdict.kind !== 'sole-writer') {
    // REFUSED WITHOUT FLUSHING. Serialising first would be a round trip to the
    // engine host for a document that must not be written, and the verdict does
    // not become more true for having waited.
    return { kind: 'refused', verdict };
  }

  const bytes = await flush();

  const written = await atomicWrite(
    deps.surface,
    context.path,
    bytes,
    deps.names(context.path),
    deps.wait,
  );
  if (!written.ok) {
    // THE STAMP IS NOT REACHED, and that is invariant 18 rather than tidiness.
    // The document stays dirty, its command log is untouched, and the original
    // file is what it was — so the work is recoverable by every route the
    // invariant names. A stamp here would make the loss silent.
    return { kind: 'write-failed', failure: written.error };
  }

  return {
    kind: 'saved',
    version: context.markSaved(SAVE_WRITER),
    bytes: bytes.byteLength,
    backedUp: written.value.backedUp,
  };
}
