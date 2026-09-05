import type { DocId, DocVersion } from '@monstera/shared';

import { type AtomicWriteFailure, type AtomicWriteSurface, atomicWrite } from './atomicWrite.js';
import type {
  CopyTargetVerdict,
  DocumentContext,
  SaveWriter,
  WriteTargetVerdict,
} from './documentService.js';
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

/**
 * What writing a copy did.
 *
 * {@link SaveOutcome}'s three shapes minus the one that cannot occur:
 * `refused` carries a {@link CopyTargetVerdict} rather than a
 * `WriteTargetVerdict`, which is two members instead of five.
 */
export type CopyOutcome =
  /** The bytes are on disk at the chosen destination. */
  | { readonly kind: 'copied'; readonly bytes: number }
  /** Another open document reaches the destination. Nothing was written. */
  | { readonly kind: 'refused'; readonly others: readonly DocId[] }
  /** The filesystem refused. Nothing at the destination was replaced. */
  | { readonly kind: 'write-failed'; readonly failure: AtomicWriteFailure };

/**
 * What a split produced.
 *
 * {@link CopyOutcome}'s three members with the success carrying a **count of
 * files** instead of a count of bytes. A split's byte total says almost nothing
 * — it is the sum of documents the user cannot see individually — where *how
 * many files* is the thing they will look for in the folder.
 *
 * `refused` and `write-failed` mean *nothing was written*, which is stronger
 * here than for a copy and is the whole reason the checks run in a first pass:
 * a split that failed on its ninth file would leave eight documents behind with
 * no way to tell them from a completed one.
 */
export type SplitOutcome =
  /** Every file is on disk in the chosen directory. */
  | { readonly kind: 'split'; readonly files: number }
  /** Another open document reaches one of the derived paths. Nothing written. */
  | { readonly kind: 'refused'; readonly others: readonly DocId[] }
  /** The filesystem refused. Nothing was written. */
  | { readonly kind: 'write-failed'; readonly failure: AtomicWriteFailure };

/**
 * One output of a split: where it goes, and what goes in it.
 *
 * The pages are carried rather than a range, because the caller has already
 * parsed them and a range would be a second representation of the same set —
 * and because *one file per page* is expressed as one group per page with no
 * special case anywhere below.
 */
export interface SplitPart {
  readonly destination: string;
  readonly pages: readonly number[];
}

/**
 * Writes several new documents into a directory the user chose.
 *
 * ## EVERY TARGET IS CHECKED BEFORE THE FIRST IS WRITTEN
 *
 * `writeDocumentCopy` checks one destination and then writes it. Here a refusal
 * partway through would leave some of the outputs on disk, and a folder holding
 * four of nine files looks exactly like a folder holding a completed split of
 * four — so the contested check runs over the whole set first and the operation
 * refuses having touched nothing.
 *
 * That ordering matters more than it does for a copy for a second reason: the
 * user picked a **directory**, so these filenames are this build's rather than
 * theirs, and the platform's own overwrite confirmation never fired for any of
 * them. This check is the only thing between a derived name and a file the user
 * did not know they were replacing.
 *
 * ## The build is INTERLEAVED with the writes, deliberately
 *
 * Each part is extracted and written before the next is extracted, rather than
 * building all of them first. A split of a large document into one file per
 * page would otherwise hold every output in memory at once, which is a
 * document-scaled allocation for no gain — the checks that make the operation
 * all-or-nothing have already run.
 *
 * What that costs is stated rather than hidden: a filesystem failure on the
 * seventh write leaves six files behind. That is the same exposure an ordinary
 * save has when the disk fills, and the alternative is the allocation above.
 *
 * ## No `DocumentContext`, for `writeDocumentCopy`'s reason
 *
 * A split writes copies of parts of the document and changes nothing about it,
 * so it must not stamp anything clean — and it is given nothing that could.
 *
 * @param deps the filesystem, the file naming and the ladder's wait
 * @param check answers whether a derived path is contested
 * @param extract builds one part's bytes
 * @param parts where each output goes and which pages it holds
 */
export async function writeDocumentSplit(
  deps: Pick<SaveDependencies, 'surface' | 'names' | 'wait'>,
  check: (destination: string) => Promise<CopyTargetVerdict>,
  extract: (pages: readonly number[]) => Promise<ByteImage>,
  parts: readonly SplitPart[],
): Promise<SplitOutcome> {
  for (const part of parts) {
    const verdict = await check(part.destination);
    if (verdict.kind === 'contested') return { kind: 'refused', others: verdict.others };
  }

  for (const part of parts) {
    const bytes = await extract(part.pages);
    const written = await atomicWrite(
      deps.surface,
      part.destination,
      bytes,
      deps.names(part.destination),
      deps.wait,
    );
    if (!written.ok) return { kind: 'write-failed', failure: written.error };
  }

  return { kind: 'split', files: parts.length };
}

/**
 * Writes the document's current bytes to a destination the user chose, and
 * **leaves the document exactly where it was**.
 *
 * ## Three things this deliberately does NOT do, each of them a decision
 *
 * **It does not stamp `markSaved`.** The document still holds content its own
 * file does not, so it is still dirty and closing it must still prompt. A copy
 * that cleared the dirty flag would be invariant 18's loss with a friendly
 * name: the user writes a copy, sees no prompt on close, and the original file
 * never receives the work.
 *
 * **It does not re-point the document.** Save As, in the sense of *this
 * document now lives here*, would move `path`, `openedIdentity` and the
 * `FileHandle` — and `openedIdentity` is what the replacement half of
 * `checkWriteTarget` compares against, so moving it silently changes what a
 * later ordinary save is allowed to do. That is a separate unit with its own
 * reasoning, and conflating the two is how a copy quietly acquires the power to
 * disarm a guard.
 *
 * **It does not invent its own file naming.** The temporary and backup names
 * come from the same `SaveFileNames` an ordinary save uses, applied to the
 * destination. Writing a copy over an existing file leaves the `.bak` a save
 * would leave, because it is the same act with the same hazard; a second
 * naming rule here would be two opinions about where this application puts its
 * temporary files (B3a).
 *
 * ## The check runs BEFORE the flush, for `saveDocument`'s reason
 *
 * A refused destination does not become writable for having serialised the
 * document first, and the flush is a round trip to the engine host.
 *
 * ## No `DocumentContext`, and that absence is the type carrying the decision
 *
 * `saveDocument` takes one because it stamps `markSaved` through it, and the
 * parameter is what proves the stamp happens inside the lane. This function
 * must not stamp, so it is given nothing that could — B5 over a comment saying
 * *do not call `markSaved` here*. Its caller still runs it in the lane, for the
 * flush's sake; what changed is that this function cannot mark a document
 * clean even by mistake.
 *
 * @param deps the filesystem, the file naming and the ladder's wait
 * @param check answers whether the destination is contested
 * @param flush produces the document's current bytes
 * @param destination the path the picker returned
 */
export async function writeDocumentCopy(
  deps: Pick<SaveDependencies, 'surface' | 'names' | 'wait'>,
  check: (destination: string) => Promise<CopyTargetVerdict>,
  flush: () => Promise<ByteImage>,
  destination: string,
): Promise<CopyOutcome> {
  const verdict = await check(destination);
  if (verdict.kind === 'contested') return { kind: 'refused', others: verdict.others };

  const bytes = await flush();

  const written = await atomicWrite(
    deps.surface,
    destination,
    bytes,
    deps.names(destination),
    deps.wait,
  );
  if (!written.ok) return { kind: 'write-failed', failure: written.error };

  return { kind: 'copied', bytes: bytes.byteLength };
}
