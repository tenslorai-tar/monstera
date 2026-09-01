import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, writeFile } from 'node:fs/promises';

import {
  type Brand,
  type DocId,
  type DocVersion,
  type FileHandle,
  asDocId,
  asDocVersion,
} from '@monstera/shared';

import type { CapabilityRegistry } from './capabilityRegistry.js';
import { CommandLog, type LogTrim, type ReadonlyCommandLog } from './commandLog.js';
import { type FileIdentity, isSameDocument, readFileIdentity } from './documentIdentity.js';
import { type TokenBytesSource, cryptoBytes, mintToken } from './token.js';

/**
 * The registry of open documents: what is open, which file each one is, and
 * whether a write is about to land on a file some other document also owns.
 *
 * Main owns the document (invariant L1). The renderer holds a `DocId` and a
 * `DocVersion` and never a path, so this is the only place that knows which
 * file a document came from.
 *
 * ## The failure this class exists to prevent
 *
 * Two documents over one file means two command logs and two save pipelines,
 * and the second save silently discards the first's edits. That is data loss —
 * not a glitch — and it has two independent causes, each with its own
 * mechanism here:
 *
 * 1. **The same file opened twice under two names.** Closed by identity
 *    (`isSameDocument`) at open time. A second open returns the same `DocId`.
 * 2. **A file that becomes another document's file *after* both are open** —
 *    replaced, renamed, or hard-linked underneath us. No path-derived identity
 *    can cover this, so it is closed at the other end, by re-verifying against
 *    the actual file immediately before writing ({@link DocumentService.checkWriteTarget}).
 *
 * The second is not a backstop for the first. It is the mechanism that makes
 * the merge-only identity rule shippable ahead of the one filesystem shape
 * ADR-0009's correction could not measure: with it in place, a wrong identity
 * answer is a **caught error rather than a silent overwrite**.
 *
 * ## Two lanes, and the order between them is a rule
 *
 * There are two serial lanes here and they are not the same thing:
 *
 * - **`#indexLane`** is service-wide. It protects the open-document index
 *   itself, because `open` is check-then-insert across an `await`.
 * - **the per-document lane**, one per record, is ADR-0009 §7's: commands,
 *   queries, save and teardown for one `DocId` queue behind each other.
 *
 * **The only permitted direction is per-document lane → index lane.** Save runs
 * in a document's lane and calls {@link DocumentService.checkWriteTarget},
 * which enters the index lane; that is the sanctioned nesting.
 *
 * **Nothing may await a per-document lane from inside the index lane.** These
 * are promise chains with no reentrancy, so that direction self-deadlocks — the
 * index-lane entry waits for a document lane that cannot start until the index
 * lane frees. A service-wide `saveAll` or `closeAll` is the obvious future thing
 * that would do it, and a deadlock is the worst failure to ship because it is
 * silent.
 *
 * The rule is enforced rather than only written: {@link DocumentService.run}
 * refuses when it is called from inside the index lane's async context, so the
 * violation is a named error at the call site rather than a hang. A depth
 * counter was rejected for this — it cannot tell "called from inside the index
 * lane" from "called concurrently while an index-lane entry happens to be
 * mid-await", and a guard that rejects legitimate work is worse than the hazard.
 *
 * **Same-document reentry is refused for both `run` and `close`**, and it is the
 * worse hazard of the two kinds: a certain deadlock with no error and no stack.
 *
 * `close(A)` from inside `run(A)` is guarded despite having no call site today,
 * because of an **inversion the other guards do not have**. Every other refusal
 * here punishes the wrong shape. This one punishes the *careful* caller and
 * rewards the careless: `await close(A)` hangs while `void close(A)` behaves.
 * So the person who eventually meets it is someone whose fire-and-forget
 * version already worked, and a recorded hazard does not reach that person.
 * The flow that produces it is ordinary, not exotic —
 * `run(A, async () => { await save(); await close(A); })` is the obvious
 * implementation of close-with-unsaved-changes.
 *
 * It is refused with a **named error, not a conditional contract**. Making
 * `close`'s promise mean "teardown finished" everywhere except inside the lane,
 * where it would mean "teardown scheduled", is exactly the reasonable-looking
 * exception that gets cited later. The correct flow is available and simpler:
 * run the save in the lane, close outside it. Closing terminates the stream; it
 * is not an operation within it.
 *
 * ## One reentry hazard left OPEN, with the analysis rather than a guard
 *
 * **`run(A)` from inside `run(B)`.** Not a certain deadlock — the lanes are
 * independent, so it completes whenever B's work does not itself depend on A's.
 * It is a **lock-ordering hazard**: two documents' work each entering the
 * other's lane deadlocks the pair. Both forms fail the same way, so there is no
 * inversion to punish a careful caller, and there is no call site. The fix when
 * one arrives is a total order on `DocId`s acquired low-to-high, not a blanket
 * refusal — which is why the guard above is keyed on the `DocId` rather than on
 * "any nested run".
 */

/**
 * `DocVersion` starts at 1; 0 is reserved for "never" (ADR-0009 §5).
 *
 * **Nothing here can produce a 0, and `savedVersion` must never be seeded to
 * one.** §5 seeds `savedVersion` from the *initial* version, so an untouched
 * document is not dirty and closing it prompts nobody. Every document this
 * service opens comes from a file, so "never written" is unreachable through
 * any existing path.
 *
 * This comment previously justified the reservation by saying `savedVersion ===
 * 0` distinguishes a never-written document from one saved at its opening
 * version. That state does not exist, and the comment sits exactly where
 * someone seeding `savedVersion` looks — seeding to 0 on its authority would
 * make every freshly opened document dirty.
 *
 * The reservation is kept for the case that will exist: **File → New**, a
 * document with no file behind it, which cannot be opened here at all today
 * because a path with no file gets no identity.
 */
const FIRST_VERSION = 1;

/**
 * How many entries may be queued on one document's lane before work is refused.
 *
 * ADR-0009 §7 wants a runaway loop to surface as a busy failure rather than
 * unbounded growth. The value is chosen so a **proof can drive it without a
 * pathological loop** — a cap no test can reach is a vacuous check, and "set it
 * to 1000" is exactly that cap. 64 is also far above any legitimate depth: a
 * user producing 64 outstanding operations on one document is a stuck retry
 * loop, not a fast typist.
 */
const MAX_QUEUED = 64;

/**
 * Refusal because a document's lane is saturated.
 *
 * A distinct type rather than a message, because the correct response differs
 * from every other failure here: back off and retry, not surface an error to
 * the user. Errors cross boundaries structurally (`{name, message, stack,
 * cause}`), so the name is what survives the trip.
 */
export class DocumentBusyError extends Error {
  override readonly name = 'DocumentBusyError';

  constructor(docId: DocId, queued: number) {
    super(
      `Document lane is saturated: ${String(queued)} entries queued, limit ${String(MAX_QUEUED)}. ` +
        'Work is refused rather than queued, so a runaway loop surfaces as a busy failure ' +
        'instead of growing without bound. ' +
        `(document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * Refusal because the document is not in the index.
 *
 * A named type for the same reason {@link DocumentBusyError} is one, and the
 * argument is stronger here: this is the **ordinary** end of a document's life
 * seen from outside. A renderer holds a `DocId` and a command can be in flight
 * when the document closes, and §2's synchronous index removal is what turns
 * that race into a lookup miss rather than work landing in a torn-down document.
 * So the miss is expected, and the caller's correct response — report it as an
 * outcome, not as a defect — differs from every other throw here.
 *
 * **A plain `Error` forced the caller to match on message text**, which is the
 * shape that silently stops working when someone rewords a sentence. Everything
 * else this class throws is a genuine defect — lane-ordering violations, lane
 * reentry — and those stay plain `Error`s deliberately: the distinction a
 * boundary needs is *"is this a named outcome or a bug"*, and the type is now
 * what draws it.
 */
export class DocumentNotOpenError extends Error {
  override readonly name = 'DocumentNotOpenError';

  constructor(docId: DocId, attempted: string) {
    super(
      `Cannot ${attempted} for a document that is not open. Lookup is get-or-miss, never ` +
        'get-or-create: a lazily created record would run this work against a torn-down ' +
        `document. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * Proof that the holder is the `CommandBus` (rule B3).
 *
 * Declared here, beside the properties it guards, and **minted only inside
 * `commandBus.ts`** — that module-private line is what makes the bus the single
 * writer of record for the two properties ADR-0009 assigns it: the version
 * counter (§5) and the command log (§4).
 *
 * **Named for its holder, not for one of the properties.** B3 is about one
 * *component* being permitted to write, so a second token would say there are
 * two writers when there is one. It was `VersionWriter` for one commit, before
 * the log moved onto the record and needed the same guarantee.
 *
 * **What a brand buys, stated precisely rather than generously:** it does not
 * make forgery impossible — a cast produces one, here as for every brand in this
 * kernel. It makes writing **by accident** impossible, and it makes any
 * production code that tries **visible in a diff**. That is the whole difference
 * between a property with one writer and a property with a convention.
 *
 * A capability rather than a comment because the alternative was measured in
 * this project's own history: `bumpVersion` sat on the context reachable by any
 * lane entry, with the narrowing recorded as an intention in the ADR for three
 * commits. An intention is what a property has just before it acquires a second
 * writer.
 */
export type CommandWriter = Brand<'command-writer', 'CommandWriter'>;

/**
 * Proof that the holder is the engine session supervisor (rule B3).
 *
 * Declared here beside {@link CommandWriter} and for the same reason, and
 * **minted only inside the supervisor's module** — that module-private line is
 * what makes the supervisor the one component permitted to have this service
 * copy a canonical image out.
 *
 * ## Why a capability and not an accessor
 *
 * The question this answers is *what hands `record.bytes` to
 * `EngineWriter.open`*, and the tempting answer is a getter. It is the wrong
 * one: an accessor hands out a **reference**, and ADR-0021's own sentence is
 * that "a second copy anywhere in main is not a matter of taste" — measured, at
 * 2.00× of file size against a 1.5× ceiling. A getter makes the second
 * reference *discouraged*; this makes it **unrepresentable**, because nothing
 * ever receives the bytes.
 *
 * What crosses is a **destination**. The service writes; the caller says where.
 *
 * ## The B3 split, stated so two owners do not become two writers
 *
 * The supervisor owns the handed directory pair's **lifetime** — creating it,
 * and removing it on close. This service owns the **bytes**, and is the only
 * thing that can copy them out. Neither writes the other's concern, which is
 * what stops the pair having two owners and the image having two writers.
 *
 * As for `CommandWriter`, the brand does not make forgery impossible — a cast
 * produces one. It makes copying the image out **by accident** impossible, and
 * any production code that tries **visible in a diff**.
 */
export type EngineSupervisor = Brand<'engine-supervisor', 'EngineSupervisor'>;

/**
 * Proof that the holder is the save pipeline (rule B3).
 *
 * The third of these, declared beside {@link CommandWriter} and
 * {@link EngineSupervisor} and minted the same way: one module-private line, in
 * `savePipeline.ts`. That line is what makes *"the file now holds this
 * version"* a claim the pipeline makes rather than one any lane entry can make.
 *
 * ## Why it was absent, and why that stopped being the right answer
 *
 * {@link DocumentContext.markSaved} carried no token until 2026-08-28, on the
 * stated grounds that a token with no minter is a method nobody can call. That
 * was correct while no pipeline existed and is not a general principle: the
 * narrowing was **deferred for want of a minter**, not rejected. The minter now
 * exists, so the parameter does.
 *
 * As for its two siblings, the brand does not make forgery impossible — a cast
 * produces one. It makes stamping a document saved **by accident** impossible,
 * and any production code that tries **visible in a diff**.
 */
export type SaveWriter = Brand<'save-writer', 'SaveWriter'>;

/**
 * Proof that the holder serves the renderer's byte-range reads (rule B3).
 *
 * The fourth of these, minted module-privately in `documentRanges.ts`.
 *
 * ## It receives bytes, and its three siblings exist so that nothing does
 *
 * {@link EngineSupervisor}'s whole argument is that an accessor hands out a
 * **reference** to the canonical image, so `writeCanonicalImage` takes a
 * destination instead and nothing ever receives the bytes. This one is the
 * exception and it is a narrow, stated one rather than a hole in that reasoning:
 *
 * - what it returns is a **copy of a bounded slice**, never the image. `subarray`
 *   would be a view onto the whole allocation — the exact defect
 *   `assertOwnsItsBuffer` exists for — so the slice is copied, and the copy's
 *   size is what the caller asked for and nothing else.
 * - the ask is bounded at the **boundary**, by the contract's own schema, before
 *   this is reached ([ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
 *   So "the renderer asked for the whole document" is not a request this method
 *   has to refuse; it is a request that cannot be expressed.
 *
 * The brand does not make forgery impossible — a cast produces one. It makes
 * reading document bytes **by accident** impossible, and any production code
 * that tries **visible in a diff**.
 */
export type RangeReader = Brand<'range-reader', 'RangeReader'>;

/**
 * The answer to a byte-range read.
 *
 * `stale` is an **outcome, not a failure**. A transport is bound to one
 * `DocVersion` and a command may bump between its construction and its next
 * ask; the renderer's answer is to rebuild it, which is ordinary. It carries the
 * current version **and** the new length so that rebuilding costs no second
 * round trip.
 */
export type RangeOutcome =
  /**
   * `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`, and it
   * is the type carrying the copy guarantee: a `SharedArrayBuffer`-backed view
   * is exactly the thing that would hand the renderer a window onto memory main
   * still owns.
   */
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array<ArrayBuffer> }
  | {
      readonly kind: 'stale';
      readonly version: DocVersion;
      readonly byteLength: number;
    };

/**
 * Everything a lane entry is told about the document, **as of the moment it
 * actually runs**.
 *
 * The version is handed in rather than read, and that is the whole point
 * (ADR-0009 §7). A caller that read a version from a main-side field after an
 * await would stamp a result that executed at v3 with v4; the renderer's
 * staleness check then passes and it caches stale content as current. There is
 * no accessor for a document's current version, so that sentence cannot be
 * written.
 */
export interface DocumentContext {
  readonly docId: DocId;
  readonly path: string;
  /** The version the document is at **now**, which is what this work operates against. */
  readonly version: DocVersion;
  /**
   * Advances the document's version and returns the new value.
   *
   * ADR-0009 §5: monotonic, never reused, bumped by **every applied mutation
   * including undo and redo**, so a late async result stamped with an old
   * version is unambiguously stale. *Which* operations count as applied
   * mutations is the command log's to say; this is the only mechanism by which
   * a version can change, and it is reachable only from inside the lane, so a
   * bump cannot race a stamp.
   *
   * **Writer of record: the `CommandBus` (B3), and now by capability rather
   * than by intention.** The token is minted in one module-private line in
   * `commandBus.ts`, so a lane entry cannot bump without one — the same
   * mechanism `Checkpoint` uses to keep §4's *"never by a handler"* structural,
   * and the same one `MupdfSession` uses for provenance.
   *
   * The brand does not make forgery impossible; a cast could produce one, as it
   * could for any brand here. What it makes impossible is bumping **by
   * accident**, and forgery visible in a diff — which is the whole difference
   * between a property with one writer and a property with a convention.
   *
   * {@link markSaved} now carries {@link SaveWriter} for the same reason and by
   * the same mechanism. It deliberately kept no token while the save pipeline
   * did not exist, because a token with no minter is a method nobody can call —
   * a narrowing that reads as a decision and behaves as a deletion. The pipeline
   * exists and mints one, so the parameter is back.
   */
  bumpVersion(writer: CommandWriter): DocVersion;

  /**
   * This document's command log (ADR-0009 §4), for the bus to record into.
   *
   * **Per document, and on the record rather than on the bus.** A log held by
   * an application-wide bus would be one log across every open document, so
   * undo on one would walk another's entries — the cross-document corruption
   * the per-document store rule makes unrepresentable by shape, reintroduced
   * one layer down. A `Map<DocId, log>` would be get-or-create, minting a log
   * for a closed `DocId`; that is the hazard that put the lane here too.
   *
   * Living on the record means its lifetime **is** the record's, dropped on
   * close by construction rather than by anyone remembering to.
   *
   * Guarded, because the log is a property of the document and §4 gives it one
   * writer. {@link CommandLog.entries} and the cursor predicates are readable
   * without a token through {@link log}; recording and moving the cursor are
   * not.
   */
  commandLog(writer: CommandWriter): CommandLog;

  /**
   * Sheds retained checkpoints until this document is back inside the service's
   * ceiling, and reports what the user lost (§4, invariant 18).
   *
   * ## Why it is here rather than at `open`, which is where it used to be
   *
   * The ceiling was consulted once, when a document arrived, and never again —
   * so checkpoints accumulated without limit for the whole life of a session
   * and the only thing ever refused was the *next* open. §4's budget was
   * measured and unenforced, which is the shape a green figure hides best: the
   * accounting was right and nothing acted on it.
   *
   * ## Behind the same capability as `commandLog`, and for the same reason
   *
   * It moves the cursor and discards entries, which is exactly what §4 gives
   * one writer. A lane entry that could trim would be a second component
   * deciding how much history the user keeps.
   *
   * ## No number crosses this seam
   *
   * The target is computed here from `documentBytesCeiling`, which §9.17 is the
   * writer of record for. The bus decides *when* to enforce — after an entry is
   * recorded, which is the only moment the log grows — and never *how much*.
   */
  enforceRetention(writer: CommandWriter): LogTrim;

  /**
   * A read-only view of the log, for work that needs to ask rather than change.
   *
   * "Is there anything to undo" is a query a lane entry may legitimately make.
   * Separating it from {@link commandLog} is what lets the mutating half stay
   * behind a capability without making the readable half useless.
   */
  readonly log: ReadonlyCommandLog;

  /**
   * How long the document's canonical image is, **right now**.
   *
   * ## Why a lane entry may read this, when it may not read the version
   *
   * There is deliberately no accessor for a document's current version outside
   * the lane, because a stamp read after an await would attribute one version's
   * work to another. This is the same value class and it is safe for the same
   * reason the version stamp on {@link Versioned} is: read inside the lane,
   * which is serial, so nothing can change it between the work finishing and
   * this being read.
   *
   * ## What needs it, and the state that is NOT yet true
   *
   * `document.open` already answers with a byte length, because the renderer
   * builds a `PDFDataRangeTransport` around one and PDF.js needs the total up
   * front. ADR-0031 argues staleness from *"answering a stale offset out of the
   * new bytes"*, so a renderer rebuilding a view after a command needs the new
   * total the same way.
   *
   * **There are no new bytes today, and this value is therefore constant**
   * (finding OOOOO-1, measured 2026-08-30). A record's `bytes` is `readonly` and
   * a command never replaces it: the mutation lands in the engine session, and
   * main's canonical image stays what was opened. So this reads correctly and
   * reads the same number before and after — which is the honest description of
   * a field whose purpose arrives with the refresh that does not exist yet.
   *
   * It is here rather than deferred because the alternative is a renderer that
   * rebinds on a version alone, which is wrong the moment the refresh lands and
   * wrong in a way nothing observes: a range past the end is a `RangeError` the
   * handler reports as `internal`, and one short of it is a truncated parse.
   */
  readonly byteLength: number;

  /**
   * Records that the document's current content is what the file now holds.
   *
   * Called by the save pipeline after the bytes land. Safe to read the current
   * version here rather than one captured earlier: the whole save is one lane
   * entry, so nothing can bump between serialising and this call.
   *
   * **After, and that ordering is invariant 18 rather than tidiness.** Stamped
   * before the write, a save whose rename then failed would leave a document
   * that believes the file holds its current version: the user closes it,
   * nothing prompts, and the work is gone — with every individual step correct.
   *
   * Writer of record: the save pipeline, by capability. See {@link SaveWriter}.
   */
  markSaved(writer: SaveWriter): DocVersion;

  /**
   * Whether the document holds content the file does not.
   *
   * `savedVersion !== currentVersion` (ADR-0009 §5), read **live** rather than
   * snapshotted, so work that bumps and then asks gets the answer it just
   * produced.
   *
   * ## A conservative approximation, not an exact answer
   *
   * Save at v5, undo to v6, redo to v7: the content is byte-identical to the
   * file, and this reports dirty. That is the right trade — it fails towards
   * prompting for a save nobody needed, never towards losing work — but "right
   * trade" and "exact" are different claims and only the first is true here.
   * Recorded as an approximation so a later reader does not conclude a real
   * false-clean is impossible.
   *
   * Cursor equality is what this replaces, and it fails the other way: once a
   * new command truncates the redo tail the cursor can land back on the saved
   * index while the content differs, and the document renders clean while
   * holding unsaved work.
   *
   * ## Why there is no service-level `isDirty(docId)`
   *
   * Reading dirtiness outside the lane can race a command that bumps, and the
   * stale answer is **clean** — which closes a document without prompting and
   * loses work. That is the same reasoning that removed `versionOf`, with a
   * worse consequence, so dirtiness is a query like any other: it runs in the
   * lane and its result carries the version it was computed at.
   */
  isDirty(): boolean;
}

/**
 * A lane entry's result, stamped with the version it ran at.
 *
 * The stamp comes from the lane, not from the caller, so a late result is
 * recognisable rather than plausible.
 */
export interface Versioned<T> {
  readonly value: T;
  /**
   * The version the document was at **when this work finished**.
   *
   * Read after the work, not before, and the distinction is not pedantic: they
   * are two different values wearing one name. The version handed to the work is
   * what it operated against; the version stamped on the result is what the
   * document is at now. For a query they are equal, because nothing bumps
   * during one. For a **command that bumps**, stamping the pre-work value
   * returns the version the command *replaced* — §7's failure with the sign
   * flipped: a fresh result that reads as stale, and a later stale one that can
   * read as fresh.
   *
   * Reading after is exact for both kinds precisely because the lane is serial:
   * nothing can bump between the work finishing and the read. That is the same
   * argument that makes the lane worth having.
   */
  readonly version: DocVersion;
}

/** What one open document is, from this service's side of the boundary. */
interface DocumentRecord {
  readonly docId: DocId;
  /** The capability the renderer used. Kept so close can reach the registry. */
  readonly handle: FileHandle;
  /** The path string the handle stands for, as minted — **not** canonicalised. */
  readonly path: string;
  /**
   * The file this document was opened from.
   *
   * This is **evidence of what was opened**, and it has exactly one use: to
   * detect that the file at {@link path} is no longer that file. It is never
   * used to decide who is who *now* — that question is answered by re-reading,
   * because a cached identity is correct precisely until the file moves, and
   * the cases the walk exists to catch are the ones where it moved.
   */
  readonly openedIdentity: FileIdentity;
  /**
   * The canonical image — **ARCHITECTURE §2's first clause**, and the reason
   * killing an engine host is a re-open rather than a loss.
   *
   * §2 states that per document this service owns "canonical bytes,
   * lazily-created engine handles …, the command log and checkpoints, and the
   * originating `FileHandle`". Four of the five were here; this is the fifth,
   * and until it arrived the seam only *enabled* the guarantee. A killed host
   * lost everything since the last save, because the only bytes anywhere were
   * the file on disk.
   *
   * Held on the record for the same reason the lane and the log are: its
   * lifetime **is** the record's. Dropping the record releases the image, by
   * construction rather than by a `delete` someone must remember on every close
   * path.
   *
   * One image per open document, and exactly one — measured. `npm run perf:gate`
   * reports `main` at 1.00x of file size holding one and 2.00x holding two,
   * which breaches ADR-0007's 1.5x on both content shapes. So a second copy
   * anywhere in main is not a matter of taste.
   */
  readonly bytes: Uint8Array;
  /** Mutable only through {@link DocumentContext.bumpVersion}, inside the lane. */
  version: DocVersion;
  /**
   * The version whose content the file holds.
   *
   * Seeded from the **initial version** at open, not from 0 (ADR-0009 §5): an
   * untouched document is not dirty, and closing it prompts nobody. Mutable
   * only through {@link DocumentContext.markSaved}, inside the lane.
   */
  savedVersion: DocVersion;
  /**
   * ADR-0009 §7's lane, **living on the record**.
   *
   * Not in a `Map<DocId, lane>` filled lazily, and the difference is not
   * stylistic: a lazily-filled map is get-or-**create**, so it happily mints a
   * lane for a `DocId` that was closed and runs the work against a torn-down
   * document — the resurrection invariant L10 forbids, arriving through the
   * structure meant to prevent it. Here the lane cannot outlive the record and
   * cannot exist without one, so "no record, no lane, miss" is the shape rather
   * than a check. It also cannot leak: dropping the record drops the lane.
   */
  lane: Promise<void>;
  /** Entries queued or running on {@link lane}, for the {@link MAX_QUEUED} cap. */
  queued: number;
  /**
   * ADR-0009 §4's log, **on the record for the same reason the lane is**.
   *
   * The alternative shapes both fail, and each is what somebody reaches for
   * first. A log held by an application-wide `CommandBus` is **one log across
   * every open document**, so undo on one walks another's entries — the
   * cross-document corruption the per-document store rule makes unrepresentable
   * by shape, arriving one layer down. A `Map<DocId, log>` is get-or-create, so
   * it mints a log for a closed `DocId`.
   *
   * Here the log's lifetime **is** the record's. Dropping the record drops the
   * log and every checkpoint in it, by construction rather than by discipline —
   * which is also what stops a closed document's byte snapshots outliving it.
   */
  readonly log: CommandLog;
}

/**
 * The result of opening.
 *
 * `already-open` carries **no state** — no version, no snapshot, nothing a
 * caller could build a second view from. That is deliberate (ADR-0009 §2):
 * "render a second copy of an already-open document" is not a bug to be caught,
 * it is a sentence that cannot be written down. The only thing a caller can do
 * with this variant is focus the document that is already there.
 */
export type OpenOutcome =
  | {
      readonly kind: 'opened';
      readonly docId: DocId;
      readonly version: DocVersion;
      /**
       * The canonical image's size, which a renderer needs before it can read
       * any of it: a `PDFDataRangeTransport` is constructed with the document's
       * length and asks for offsets inside it.
       *
       * **Bounded, and that is what keeps it out of L11's way.** A number is the
       * same size for a 2 KB document and a 2 GB one. It is here rather than on
       * a query of its own because the alternative — bootstrapping a transport
       * with a version it knows to be wrong, to be told the length by the stale
       * answer — is a round trip and a lie to make one field travel.
       *
       * Only on `opened`. `already-open` carries no state by design (ADR-0009
       * §2), and adding a length to it would be the second view this variant
       * exists to make unsayable.
       */
      readonly byteLength: number;
    }
  | { readonly kind: 'already-open'; readonly docId: DocId }
  | { readonly kind: 'absent' }
  /**
   * The canonical image would not fit under {@link DocumentServiceOptions.documentBytesCeiling}.
   *
   * **An outcome, not a defect.** Opening a document larger than main may hold,
   * or one more document than main may hold, is a thing a user can do and be
   * told about — the same category as `absent`, and reported the same way.
   */
  | {
      readonly kind: 'at-capacity';
      /** What the resident total would have become, in bytes. */
      readonly wouldHold: number;
      /** The ceiling it would have crossed. */
      readonly ceiling: number;
    };

/**
 * The result of asking whether a document may write to its own file.
 *
 * Exactly one variant permits the write. The other three are the three ways
 * ADR-0009 names for a path to stop meaning what it meant at open — replaced,
 * hard-linked to another open document, or gone.
 *
 * `target-absent` is a distinct answer rather than a quiet `sole-writer`
 * because the two are reached by different routes: one ran the check and found
 * nothing, the other had nothing to check. Collapsing them would make "the file
 * vanished" indistinguishable from "verified clear", which is the exact shape
 * audit item 4b exists to forbid.
 */
export type WriteTargetVerdict =
  /** Verified: this document, and only this document, reaches this file. */
  | { readonly kind: 'sole-writer' }
  /** Another open document reaches the same file. Writing loses its edits. */
  | { readonly kind: 'contested'; readonly others: readonly DocId[] }
  /** The file at this path is not the file this document was opened from. */
  | { readonly kind: 'replaced' }
  /** Nothing is at this path. The write would create rather than overwrite. */
  | { readonly kind: 'target-absent' }
  /**
   * The check ran and could not settle whether the file was replaced.
   *
   * `index-reused-or-modified` is the case ADR-0009's 2026-08-19 correction
   * added: the file index matches, and the inode's change time does not. That
   * is either a different file on a reused inode or the same file edited in
   * place by something else, and nothing available here separates them. Both
   * are states where writing discards something the user has not seen, so both
   * refuse — and the verdict says "could not tell" rather than claiming a
   * replacement it cannot demonstrate.
   */
  | {
      readonly kind: 'unverifiable';
      readonly reason: 'no-file-index' | 'no-change-time' | 'index-reused-or-modified';
    };

/**
 * Releases whatever a document holds outside this index — the engine session,
 * above all.
 *
 * A seam rather than a future edit, because the ordering is the point: the
 * index entry is gone before this is awaited, so a message arriving during
 * teardown misses the index instead of racing it.
 */
export type DocumentTeardown = (docId: DocId) => Promise<void>;

const noTeardown: DocumentTeardown = () => Promise.resolve();

/**
 * Whether the file behind a **fixed path** is still the one that was opened.
 *
 * This deliberately does **not** call `isSameDocument`, and the reason is the
 * kind of mistake that looks correct in review: the two functions take the same
 * pair of identities and ask opposite questions.
 *
 * `isSameDocument` asks "do these two *paths* name one document", and there an
 * equal canonical path is sufficient evidence — it is the first row of the
 * rule. Here the path is held constant on both sides, so canonical-path
 * equality is guaranteed and carries **no information at all**. Routing this
 * question through `isSameDocument` returns `true` for every replaced file,
 * which is `sole-writer` for a write that destroys a file the user never
 * opened. It was written that way first, and the proof caught it.
 *
 * So the primary evidence here is `dev:ino`, and where the filesystem supplies
 * none, replacement is undetectable — reported as such rather than as a clear
 * verdict. That case does not arise on NTFS; it is the unmeasured network-share
 * shape from ADR-0009's correction, and it degrades to the behaviour this
 * project already had, which is to say no detection.
 *
 * ## A MATCHING index is not sufficient, and that half was missing
 *
 * ADR-0009's 2026-08-19 correction, found by an ubuntu runner reporting
 * `sole-writer` — the one verdict that permits a write — for a file deleted and
 * recreated at the same path. An inode number is a slot, and slots are handed
 * back out: `unlink` then `create` can land the new file on the freed inode, and
 * then the pair matches for two different files.
 *
 * So the two directions are not symmetric. `dev:ino` **differing** settles
 * replacement. `dev:ino` **matching** is necessary and never sufficient, and it
 * needs a corroborator that a reused inode cannot fake. `ctime` is that: it is
 * set at creation and moves on any change to the inode, so a reused one always
 * carries a fresh value.
 *
 * `birthtime` is the field this obviously wants and is the one that lies —
 * measured on NTFS, file tunneling restores the previous file's creation time
 * for exactly the delete-and-recreate pattern. See the ADR for the table.
 *
 * What `ctime` cannot do is tell a reused inode from an in-place edit by another
 * application. Both mean the file is not in the state that was opened, so both
 * land in `unverifiable` — which refuses the write and, unlike `replaced`, does
 * not claim something it cannot demonstrate.
 */
function replacementVerdict(opened: FileIdentity, now: FileIdentity): WriteTargetVerdict {
  if (opened.dev === null || opened.ino === null || now.dev === null || now.ino === null) {
    return { kind: 'unverifiable', reason: 'no-file-index' };
  }
  if (opened.dev !== now.dev || opened.ino !== now.ino) return { kind: 'replaced' };

  // The index matches. That is where the old implementation returned
  // `sole-writer`, and where inode reuse made it wrong.
  if (opened.changedMs === null || now.changedMs === null) {
    return { kind: 'unverifiable', reason: 'no-change-time' };
  }
  if (opened.changedMs !== now.changedMs) {
    return { kind: 'unverifiable', reason: 'index-reused-or-modified' };
  }
  return { kind: 'sole-writer' };
}

/**
 * How this service learns what file is at a path.
 *
 * Injectable for the same reason `TokenBytesSource` is, and it is the same
 * argument: **a property no test can reach is a property the code is free to
 * lose.** {@link DocumentService.checkWriteTarget} is the last thing standing
 * between a stale identity and a silent overwrite, and its refusal branches —
 * above all the one that fires when the index walk finds nothing — cannot be
 * reached from outside the class through a real filesystem, because they
 * describe the filesystem changing underneath a single function. Untestable,
 * they are decoration.
 *
 * It is not a configuration seam. Production has no reason to pass one.
 */
export type IdentityReader = (path: string) => Promise<FileIdentity | null>;

/**
 * Reads a document's canonical image. Injected so tests need no filesystem.
 *
 * **It must return a buffer it solely owns**: `byteOffset` zero, spanning its
 * whole `ArrayBuffer`. Not a style preference — the accounting depends on it.
 * A reader returning `big.subarray(0, n)` retains all of `big` while reporting
 * `n`, so `residentDocumentBytes` under-reports **in the unsafe direction** and
 * the ceiling is satisfied by a service holding far more than it says.
 *
 * The obvious alternative — counting `buffer.byteLength` — trades one wrong
 * direction for another, because a pooled allocation would then over-report.
 * Requiring sole ownership keeps the exact figure and makes the ambiguous case
 * unrepresentable instead of estimated (B5).
 *
 * Measured, so the requirement is known to be satisfiable: Node's `readFile`
 * returns an exactly-sized, offset-zero buffer for both a 14-byte and a
 * 9,000-byte file — it does not hand out pool slices. A reader that cannot meet
 * this copies, which is a decision made where the buffer's provenance is known.
 */
export type BytesReader = (path: string) => Promise<Uint8Array>;

/**
 * Refuses a buffer the reader does not solely own.
 *
 * Thrown rather than reported as an outcome: `at-capacity` is something a user
 * did, and this is a caller supplying a reader that breaks its contract.
 */
function requireSoleOwnership(bytes: Uint8Array, path: string): void {
  if (bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength) return;
  throw new TypeError(
    `The BytesReader returned a VIEW rather than a buffer it owns for ${path}: ` +
      `byteOffset ${String(bytes.byteOffset)}, view ${String(bytes.byteLength)} bytes of a ` +
      `${String(bytes.buffer.byteLength)}-byte allocation. The whole allocation stays reachable ` +
      `while only the view is counted, so the resident total would under-report by ` +
      `${String(bytes.buffer.byteLength - bytes.byteLength)} bytes — in the direction that ` +
      `satisfies the ceiling while breaching it. Copy the slice before returning it.`,
  );
}

/** The default: the file, whole, once. */
const readFileBytes: BytesReader = (path) => readFile(path);

/**
 * How a canonical image reaches a destination this service was handed.
 *
 * The mirror of {@link BytesReader}, and injectable for the same reason: a case
 * that needs to know *what was written where* should not need a filesystem, and
 * the production path should not be substitutable by accident.
 *
 * **It receives the record's buffer and must not retain it.** A writer that
 * kept a reference would hold a second copy of the document for as long as it
 * lived — the exact accounting failure `requireSoleOwnership` guards on the way
 * in, arriving on the way out where nothing counts it. Node's `writeFile`
 * consumes and returns.
 */
export type BytesWriter = (destination: string, bytes: Uint8Array) => Promise<void>;

/** The default: the bytes, whole, once. */
const writeFileBytes: BytesWriter = (destination, bytes) => writeFile(destination, bytes);

export interface DocumentServiceOptions {
  /**
   * Total canonical-image bytes this service may hold across every open
   * document.
   *
   * **Required, and there is no default. That is the whole design of this
   * option.** ADR-0007 states `main`'s budget, `docs/ARCHITECTURE.md` §9.17
   * carries it as the one machine-read line, and `scripts/lib/memoryBudgets.mjs`
   * is the single reader of it. The kernel cannot reach that module — it is
   * plain Node under `scripts/`, and the boundary is deliberate — so any number
   * written here would be **a second opinion about the budget** (B3a), correct
   * on the day it was typed and silently stale afterwards.
   *
   * A default would also be the specific kind this project distrusts most: the
   * one nobody revisits. `undefined` meaning "unbounded" would let retention
   * ship with no bound at all, which is the condition ADR-0007 exists to
   * prevent.
   *
   * So the composition root supplies it, derived from the invariant, and a
   * service constructed without it does not compile.
   */
  readonly documentBytesCeiling: number;
  readonly teardown?: DocumentTeardown;
  readonly randomBytesSource?: TokenBytesSource;
  readonly readIdentity?: IdentityReader;
  readonly readBytes?: BytesReader;
  readonly writeBytes?: BytesWriter;
}

export class DocumentService {
  readonly #records = new Map<DocId, DocumentRecord>();
  readonly #capabilities: CapabilityRegistry;
  readonly #randomBytes: TokenBytesSource;
  readonly #teardown: DocumentTeardown;
  readonly #readIdentity: IdentityReader;
  readonly #readBytes: BytesReader;
  readonly #writeBytes: BytesWriter;
  readonly #documentBytesCeiling: number;

  /**
   * Serialises everything that reads the index and then writes it.
   *
   * `open` is check-then-insert across an `await`, and two concurrent opens of
   * one file would both miss and both mint — producing exactly the two-documents
   * -over-one-file state the check exists to prevent. A lane makes that
   * interleaving unrepresentable rather than unlikely; opens are user-initiated
   * and rare, so serialising them costs nothing worth measuring.
   *
   * This is **not** ADR-0009 §7's per-document lane, which covers commands,
   * queries, save and close on one `DocId`. This one protects the index itself
   * and is service-wide.
   */
  #indexLane: Promise<void> = Promise.resolve();

  /**
   * Marks the async context of work running inside {@link #indexLane}.
   *
   * This is what makes the lane-ordering rule in the class comment enforced
   * rather than merely stated. `AsyncLocalStorage` propagates through awaits, so
   * it answers precisely the question that matters — *was this call made from
   * within an index-lane entry* — which a flag or a depth counter cannot: those
   * also fire for unrelated work that happens to run while an index-lane entry
   * is mid-await, and rejecting legitimate work is worse than the deadlock.
   */
  readonly #insideIndexLane = new AsyncLocalStorage<true>();

  /**
   * The document whose lane entry is currently executing, if any.
   *
   * Same mechanism as {@link #insideIndexLane}, closing the **worse** of the two
   * reentry hazards. `run(A, work)` where `work` calls `run(A, …)` cannot
   * complete: by then `record.lane` is a promise that settles only when the
   * outer work does, so the inner entry queues behind the outer while the outer
   * awaits the inner. Neither ever resolves — **no error, no timeout, no stack,
   * just a document that stops responding.** A named error is debuggable in
   * seconds; a hang is a bug report.
   *
   * Keyed on the `DocId`, not on "any nested run". Refusing all nesting is
   * stricter than the evidence supports — see the open hazards below.
   */
  readonly #executingDocument = new AsyncLocalStorage<DocId>();

  constructor(capabilities: CapabilityRegistry, options: DocumentServiceOptions) {
    if (!Number.isFinite(options.documentBytesCeiling) || options.documentBytesCeiling < 0) {
      throw new TypeError(
        `documentBytesCeiling must be a finite, non-negative byte count; received ` +
          `${String(options.documentBytesCeiling)}. There is no default, deliberately — see ` +
          `DocumentServiceOptions.`,
      );
    }
    this.#capabilities = capabilities;
    this.#documentBytesCeiling = options.documentBytesCeiling;
    this.#teardown = options.teardown ?? noTeardown;
    this.#randomBytes = options.randomBytesSource ?? cryptoBytes;
    this.#readIdentity = options.readIdentity ?? readFileIdentity;
    this.#readBytes = options.readBytes ?? readFileBytes;
    this.#writeBytes = options.writeBytes ?? writeFileBytes;
  }

  /**
   * **Every document-scaled byte this service is holding**, across every open
   * document — the one place that answers it.
   *
   * ## Two terms, because two things scale with the document
   *
   * The canonical image is one. **Checkpoints are the other**, and an earlier
   * version of this method counted only the first. `Checkpoint` is
   * `Brand<ByteImage, …>` — a whole byte image per terminal entry, uncapped —
   * so with a 1.5× budget and a 1.00× image, *the first checkpoint written puts
   * `main` over budget while `open` still reports capacity*. A guard that can be
   * satisfied while the thing it guards is breached is not a guard.
   *
   * The checkpoint term is asked of the log rather than computed here, so it
   * moves on its own the day checkpoint policy changes. A comment naming the
   * exclusion would have been the weaker form of the same fix, with the failure
   * mode that the note and the code drift — which is what deriving the roster
   * count removed one commit earlier.
   *
   * **This is accounting, not policy.** How many checkpoints may exist, and what
   * spills when, is deferred to the Stage 0 performance gate by ADR-0009's
   * *Left open* and is deliberately not settled here
   * ([ADR-0021](../../../docs/DECISIONS/0021-the-canonical-image-is-retained.md)).
   * What this fixes is that the number the ceiling compares against is the whole
   * number.
   */
  residentDocumentBytes(): number {
    let total = 0;
    for (const record of this.#records.values()) {
      total += record.bytes.byteLength + record.log.retainedBytes();
    }
    return total;
  }

  /**
   * Writes an open document's canonical image to a destination the caller
   * names, and returns how many bytes went.
   *
   * **The only way anything outside this service can obtain a document's
   * bytes** — and it does not obtain them. The image goes from the record to
   * the writer without passing through the caller, so the second reference
   * ADR-0021 costs at 2.00× of file size is not discouraged here, it is
   * unrepresentable (B5).
   *
   * ## What it is for
   *
   * ADR-0023 Decision 7: the engine host is handed a snapshot it may read, in a
   * directory main granted it. This is the step that puts the image there —
   * `EngineWriter.open` receives a path, never a buffer, and this is why it can.
   *
   * ## Guarded, and the token is the supervisor's
   *
   * See {@link EngineSupervisor}. The B3 split it records: the supervisor owns
   * the handed directory's **lifetime**, this service owns the **bytes**.
   *
   * ## No lane, and that is a decision rather than an omission
   *
   * The lane serialises work that reads the index and then writes it. This
   * reads one record's immutable buffer and writes elsewhere; it changes
   * nothing about the document, so taking the lane would make a snapshot write
   * wait behind an unrelated command and — worse — would let a supervisor
   * rebuilding a dead host deadlock against the lane entry that is waiting for
   * the host.
   *
   * The buffer it hands out is safe to read outside the lane because a record's
   * `bytes` is `readonly` and replaced only by a new record: there is no
   * mutation for this read to tear.
   *
   * @param supervisor Proof the caller is the session supervisor.
   * @param docId The open document.
   * @param destination Where the image goes. The caller granted it.
   * @returns The number of bytes written.
   * @throws DocumentNotOpenError when the document is closed or was never open.
   */
  async writeCanonicalImage(
    supervisor: EngineSupervisor,
    docId: DocId,
    destination: string,
  ): Promise<number> {
    void supervisor;
    const record = this.#records.get(docId);
    if (record === undefined) {
      // THE SAME REFUSAL EVERY OTHER PER-DOCUMENT OPERATION MAKES. A supervisor
      // opening a session for a document that closed underneath it is racing a
      // teardown, and writing the image of a document nobody has open would put
      // a copy of it in a directory whose removal is keyed to a session that
      // will never exist.
      throw new DocumentNotOpenError(docId, 'write the canonical image');
    }
    await this.#writeBytes(destination, record.bytes);
    return record.bytes.byteLength;
  }

  /**
   * Serves one byte range of a document, or reports the version moved.
   *
   * ## SYNCHRONOUS, and NOT on the lane, and both are the design
   *
   * A demand-paged renderer issues tens of these to show one page — 42 requests
   * measured for page 1 of a 199 MB document. Queueing them behind the lane
   * would put every read behind whatever command is running, count each against
   * {@link MAX_QUEUED}, and serialise a reader against itself for no benefit:
   * a read mutates nothing. §2 says it in one line — mutations are commands,
   * reads are queries.
   *
   * That leaves the race `versionOf` was removed for: reading a version outside
   * the lane can answer with one a command has already replaced. It cannot here,
   * and the reason is the `async` keyword this method does not have. The lane
   * only ever mutates a record at an `await`, and there is no await between the
   * two reads below — so the version and the bytes are the same document's, by
   * the language's own scheduling rather than by a lock.
   *
   * **Add an `await` to this method and that argument is gone**, which is why it
   * is stated here rather than left to be re-derived from the absence of a
   * keyword.
   *
   * ## The slice is COPIED
   *
   * `subarray` returns a view that keeps the whole canonical image reachable —
   * the defect {@link assertOwnsItsBuffer} exists to catch, arriving through the
   * one method that is allowed to hand bytes out. A 64 KiB view of a 199 MB
   * document retains 199 MB. `slice` copies.
   *
   * @param reader Proof the caller serves the renderer's reads. See {@link RangeReader}.
   * @param docId The open document.
   * @param expected The version the caller's transport is bound to.
   * @param begin First byte, inclusive.
   * @param end Last byte, exclusive.
   * @throws DocumentNotOpenError when the document is closed or was never open.
   * @throws RangeError when the range falls outside the document at `expected`.
   */
  readRange(
    reader: RangeReader,
    docId: DocId,
    expected: DocVersion,
    begin: number,
    end: number,
  ): RangeOutcome {
    void reader;
    const record = this.#records.get(docId);
    if (record === undefined) throw new DocumentNotOpenError(docId, 'read a byte range');

    // Both reads, before anything can suspend. See the note above.
    const version = record.version;
    const bytes = record.bytes;

    if (version !== expected) {
      return { kind: 'stale', version, byteLength: bytes.byteLength };
    }

    // REFUSED RATHER THAN CLAMPED. A read past the end of a document is the
    // caller having got its arithmetic wrong, and a clamped answer is a short
    // read that a parser reports later as a corrupt document — the diagnosis
    // then lands nowhere near the mistake.
    if (begin < 0 || end < begin || end > bytes.byteLength) {
      throw new RangeError(
        `Range [${String(begin)}, ${String(end)}) falls outside a ${String(bytes.byteLength)}-byte ` +
          `document at version ${String(expected)}.`,
      );
    }

    // Allocated and filled rather than `slice`d, because the allocation is what
    // the type above promises: `new Uint8Array(n)` owns a plain `ArrayBuffer`,
    // where `slice` on a view of unknown provenance carries that provenance
    // along. The `subarray` is transient and never leaves this expression.
    const copy = new Uint8Array(end - begin);
    copy.set(bytes.subarray(begin, end));
    return { kind: 'bytes', bytes: copy };
  }

  /**
   * The refusal, or `null` if `incoming` fits.
   *
   * @param incoming bytes the service would additionally hold
   */
  #refuseIfOverCeiling(incoming: number): OpenOutcome | null {
    const wouldHold = this.residentDocumentBytes() + incoming;
    if (wouldHold <= this.#documentBytesCeiling) return null;
    return { kind: 'at-capacity', wouldHold, ceiling: this.#documentBytesCeiling };
  }

  /**
   * Opens the file a handle stands for, or reports that it is already open.
   *
   * A path that does not exist yields `absent` rather than a new document.
   * There is no honest canonical form for a path with no file behind it, and
   * hand-folding case to invent one would reintroduce the fallible normaliser
   * deliberately kept out of `CapabilityRegistry` (ADR-0009 §2). Save As
   * establishes identity **after** the rename, when the OS can answer.
   */
  open(handle: FileHandle): Promise<OpenOutcome> {
    return this.#throughIndexLane(() => this.#openNow(handle));
  }

  async #openNow(handle: FileHandle): Promise<OpenOutcome> {
    const path = this.#capabilities.resolveOrThrow(handle);

    const identity = await this.#readIdentity(path);
    if (identity === null) return { kind: 'absent' };

    const existing = (await this.#documentsAt(identity))[0];
    if (existing !== undefined) return { kind: 'already-open', docId: existing };

    // CAPACITY IS CHECKED TWICE, and the first check is the one that matters for
    // the failure everyone worries about.
    //
    // `identity.size` comes from the `stat` already performed, so a document
    // larger than this service may hold is refused **without being read**.
    // Checking only after the read would allocate the very image the refusal
    // exists to prevent — a 2 GB file would have to be held in order to be told
    // it is too big, which is the shape where a guard causes the condition it
    // guards against.
    const refusal = this.#refuseIfOverCeiling(identity.size);
    if (refusal !== null) return refusal;

    const bytes = await this.#readBytes(path);
    requireSoleOwnership(bytes, path);

    // The second check is the CORRECT one, and it is not redundant. `stat` and
    // the read are two observations of a file that anything may write between
    // them, so the size used above is evidence and the length read is fact. The
    // bytes are dropped by returning without storing them.
    const overshoot = this.#refuseIfOverCeiling(bytes.byteLength);
    if (overshoot !== null) return overshoot;

    // Minted, never derived. A hash of the path is the path in a lossy coat and
    // changes when the file is renamed; a counter gets reused after close, so a
    // late renderer message naming document 3 lands on a *different* document
    // that now holds id 3 — which is the cross-document corruption invariant
    // L10 exists to prevent. A random token makes that a lookup miss.
    const docId = asDocId(mintToken('DocId', this.#randomBytes));
    const version = asDocVersion(FIRST_VERSION);
    this.#records.set(docId, {
      docId,
      handle,
      path,
      openedIdentity: identity,
      bytes,
      version,
      // §5: seeded from the initial version, never from 0. A freshly opened
      // document is clean.
      savedVersion: version,
      lane: Promise.resolve(),
      queued: 0,
      log: new CommandLog(),
    });
    return { kind: 'opened', docId, version, byteLength: bytes.byteLength };
  }

  /**
   * Closes a document. **Two halves, and they are deliberately not symmetric.**
   *
   * ADR-0009 §2 requires the index entry to be gone before anything is awaited;
   * §7 requires close to run in the per-document lane. Read literally those
   * contradict, and resolving it by queueing the whole of close behind pending
   * commands would lose the §2 property — the document would be closing and
   * still findable, which is exactly the window `c86b434` shut. So close splits:
   *
   * 1. **Index removal is synchronous and outside every lane.** This is the part
   *    that must not wait. It turns invariant L10 — "an async result must not
   *    land in a closed document's state" — into a lookup miss rather than a
   *    discipline every commit path has to remember.
   * 2. **Teardown enters the document's lane** and runs after pending work
   *    drains. This is the part that must be serialised: tearing an engine
   *    session down underneath a command still executing against it is the
   *    failure §7 exists to prevent.
   *
   * The two halves compose safely because of the record-owned lane: once the
   * record is gone, {@link run} misses, so **nothing further can join the lane**.
   * The captured lane is therefore a closed set of already-accepted work, and
   * teardown is genuinely last. Teardown runs whether that work succeeded or
   * failed — a command that threw still leaves an engine session to release.
   *
   * The cost of the bypass is real and is paid where it should be. A close can
   * land inside a running {@link checkWriteTarget} for the same document, and
   * the check then finds nothing and refuses to report a verdict. Refusing to
   * write a document that is being closed is the correct outcome; the failure
   * message names this cause first among the three so nobody who hits it goes
   * hunting a filesystem race instead.
   */
  async close(docId: DocId): Promise<void> {
    // FIRST STATEMENT, before the removal. Placed after it, this would refuse
    // AND remove the document, handing the caller an error with the index
    // already mutated — worse than either outcome alone.
    if (this.#executingDocument.getStore() === docId) {
      throw new Error(
        'Cannot close a document from inside its own lane. The returned promise awaits a ' +
          'lane containing the work that called it, so awaiting this would hang. Closing ' +
          'terminates the stream; it is not an operation within it. Run the save in the ' +
          'lane and close outside it.',
      );
    }

    const record = this.#records.get(docId);
    if (record === undefined) return;

    // Half 1. Synchronous, before any await, outside every lane. `close` is
    // `async` only so the guard above rejects rather than throwing
    // synchronously; the body reaches this line without yielding.
    this.#records.delete(docId);

    // Half 2. The lane is captured after the removal, so it can only contain
    // work accepted while the document was open.
    return record.lane.then(
      () => this.#teardown(docId),
      () => this.#teardown(docId),
    );
  }

  /**
   * Runs `work` in this document's serial lane (ADR-0009 §7).
   *
   * Commands, queries and save share one lane per `DocId`. They queue; they do
   * not interleave and are not rejected on contention, because rejecting loses
   * user intent and pushes a second scheduler into the UI. **A save that
   * serialised a live engine session while a command mutated it would write a
   * byte image mixing pre- and post-command state**, and the atomic rename would
   * then promote that over the user's file — which is why byte-producing reads
   * belong in the lane and not beside it.
   *
   * `work` is **handed** the version it is running at, and the result comes back
   * stamped with it. Nothing here exposes a document's current version, so a
   * caller cannot read one after an await and stamp a result that executed
   * earlier — the mistake that makes a renderer's staleness check pass on stale
   * content.
   *
   * @throws `DocumentBusyError` when the lane is saturated ({@link MAX_QUEUED}).
   * @throws if the document is not open — **get-or-miss, never get-or-create**.
   * @throws if called from inside the index lane; see the class comment.
   */
  async run<T>(docId: DocId, work: (context: DocumentContext) => Promise<T>): Promise<Versioned<T>> {
    if (this.#insideIndexLane.getStore() === true) {
      throw new Error(
        'Lane ordering violation: a per-document lane was awaited from inside the index ' +
          'lane. The only permitted direction is per-document lane -> index lane. These ' +
          'are promise chains with no reentrancy, so this would have deadlocked silently ' +
          'rather than failed. A service-wide saveAll or closeAll is the usual cause.',
      );
    }

    if (this.#executingDocument.getStore() === docId) {
      throw new Error(
        'Lane reentry: work running in a document\'s lane asked to run more work in the ' +
          'same lane. The inner entry would queue behind the outer while the outer awaits ' +
          'the inner, and neither would ever resolve — a silent hang rather than a ' +
          'failure. Whatever the inner work does belongs in the outer entry, or after it.',
      );
    }

    const record = this.#records.get(docId);
    if (record === undefined) {
      // Get-or-miss. A lazily created lane would run this work against a
      // torn-down document, which is the resurrection L10 forbids.
      throw new DocumentNotOpenError(docId, 'run work');
    }

    if (record.queued >= MAX_QUEUED) throw new DocumentBusyError(docId, record.queued);
    record.queued += 1;

    const started = record.lane.then(() =>
      this.#executingDocument.run(docId, async () => {
        // Read here, when the work actually runs — not when it was queued.
        const version = record.version;
        const value = await work({
          docId: record.docId,
          path: record.path,
          version,
          // The token is not read. Its whole job is being unobtainable outside
          // `commandBus.ts`, which is a compile-time property — checking it at
          // runtime would be the guard B5 says to prefer a type over.
          bumpVersion: () => {
            record.version = asDocVersion(record.version + 1);
            return record.version;
          },
          // Same treatment, same reason: the token is not read, because being
          // unobtainable outside `commandBus.ts` is a compile-time property and
          // checking it here would be the runtime guard B5 says to prefer a
          // type over.
          commandLog: () => record.log,
          // The ceiling is THIS service's and the log is the record's, so the
          // arithmetic that joins them belongs here and in one place: the
          // target is whatever the ceiling has left once every other document's
          // image and log are accounted for. A target computed in the bus would
          // be a second opinion about a budget §9.17 owns (B3a).
          enforceRetention: () =>
            record.log.trimTo(
              Math.max(
                0,
                this.#documentBytesCeiling -
                  (this.residentDocumentBytes() - record.log.retainedBytes()),
              ),
            ),
          log: record.log,
          // A GETTER, so it answers about the image the document has NOW rather
          // than the one it had when this entry started. A command rewrites the
          // canonical bytes, and the caller that needs this reads it after the
          // bus returns — a value captured at entry would be the length of the
          // document the command replaced, which is `Versioned`'s own hazard
          // wearing a different field name.
          get byteLength() {
            return record.bytes.byteLength;
          },
          markSaved: () => {
            record.savedVersion = record.version;
            return record.savedVersion;
          },
          isDirty: () => record.savedVersion !== record.version,
        });
        // Read AGAIN, after the work, still inside the lane. See `Versioned`.
        return { value, version: record.version };
      }),
    );

    // The lane carries no failures forward. Without this, one command that
    // threw would reject every command after it on that document — turning a
    // single bad operation into a dead document, a worse failure than the one
    // being reported. Same reasoning as the index lane.
    record.lane = started.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await started;
    } finally {
      record.queued -= 1;
    }
  }

  /**
   * Whether this document may write to its own file — verified against the
   * filesystem now.
   *
   * ## The two questions
   *
   * 1. **Which open documents currently resolve to this file?** Read fresh from
   *    the filesystem, because a cached answer is stale exactly when it matters.
   *    The answer must contain this document, and should contain nothing else.
   * 2. **Is the file at this path still the file we opened?** Answered against
   *    the identity recorded at open, which is the only thing that can answer it
   *    — a re-read alone cannot tell "the same file" from "a different file
   *    wearing the same name". See {@link replacementVerdict} for why this is
   *    not `isSameDocument`.
   *
   * The first catches renamed and hard-linked; the second catches replaced.
   * ADR-0009 names all three, and only both questions together cover them.
   *
   * ## The positive control is inside the instrument, not only in its proof
   *
   * This is a search, and a search has one output for every way it can be
   * broken: **found nothing**. An empty index, a mis-keyed map, an identity
   * read that fails on every path — all of them report the same clean result as
   * a genuine all-clear, and "no conflicts" is the answer everyone hopes for,
   * so nothing about it prompts a second look (audit item 4b).
   *
   * So the walk must locate something it is known to be able to find, on every
   * run, and here that is **this document itself**: its own record is in the
   * index and its own path is the target, so the walk reaches it or something
   * is wrong. Three things can be wrong, and they are not equally exotic:
   *
   * - the index is not being walked at all;
   * - the file moved between the target read and the scan;
   * - **the document was closed while this check was running.** {@link close}
   *   removes from the index without waiting for the lane, by design, so it can
   *   land inside this method's first `await`. This is the ordinary one, and it
   *   is the case the close-with-unsaved-changes flow will produce routinely.
   *
   * None is "all clear", so all three throw. Whether the third deserves an
   * outcome of its own rather than a throw is a design question for when that
   * flow exists; refusing to write a document that is being closed is the right
   * answer either way, and `sole-writer` is what permits the write.
   *
   * A stale `contested` — a document closing while this scan runs — is possible
   * and deliberately tolerated: it fails towards a caught error, never towards
   * a silent overwrite.
   *
   * Save As to a *different* path is a different question with no such control,
   * and it is not answered here. It gets its own check when Save As exists.
   *
   * @throws if `docId` is not open, or if the walk cannot find this document at
   * its own file.
   */
  checkWriteTarget(docId: DocId): Promise<WriteTargetVerdict> {
    return this.#throughIndexLane(() => this.#checkWriteTargetNow(docId));
  }

  async #checkWriteTargetNow(docId: DocId): Promise<WriteTargetVerdict> {
    const record = this.#records.get(docId);
    if (record === undefined) {
      throw new DocumentNotOpenError(docId, 'verify a write target');
    }

    const target = await this.#readIdentity(record.path);
    // Nothing on disk to contest. The write re-creates the file, and there is
    // no identity for another document to share — but this is reported as its
    // own outcome rather than as a clear verdict, because the control below did
    // not run.
    if (target === null) return { kind: 'target-absent' };

    const reaching = await this.#documentsAt(target);

    // THE CONTROL. See the doc comment: this must find this document, because
    // this document is in the index and this is its own path.
    if (!reaching.includes(docId)) {
      throw new Error(
        'Write-target check could not find this document at its own file. Three ' +
          'causes, and the third is the ordinary one: (1) the open-document index is ' +
          'not being walked; (2) the file moved between the two reads; (3) THE ' +
          'DOCUMENT WAS CLOSED WHILE THIS CHECK WAS RUNNING — `close` removes from ' +
          'the index without waiting for the lane, by design, so it can land during ' +
          "this check's first read. Do not go hunting a filesystem race before ruling " +
          'that out. Refusing to report a verdict either way: a search that finds ' +
          'nothing looks identical whether it is working or broken, and here ' +
          '"nothing" is the answer that permits the write.',
      );
    }

    // `contested` outranks `replaced` when both hold. Two writers over one file
    // is the loss this class exists to prevent and it names the other party;
    // a replaced file is an external modification the user can still see. Both
    // refuse the write, so the order decides the message, not the outcome.
    const others = reaching.filter((found) => found !== docId);
    if (others.length > 0) return { kind: 'contested', others };

    return replacementVerdict(record.openedIdentity, target);
  }

  /** Whether this service currently holds the document. */
  isOpen(docId: DocId): boolean {
    return this.#records.has(docId);
  }

  /**
   * Every document this holds, in insertion order.
   *
   * ## Why this is a list and not a count, and why it is safe where
   * `versionOf` is not
   *
   * The note below refuses a `versionOf(docId)` because a value read after an
   * await and stamped onto a result is a lie the type cannot catch. An id is
   * not that: a `DocId` is issued once and never reused within a run, so a
   * stale one names a document that is closed rather than a different one, and
   * every operation taking one already refuses a document it cannot find.
   *
   * **Snapshotted into an array rather than exposing the map**, for
   * `EngineSessions.documentIds`' reason: the only caller iterates it while
   * closing, which mutates the index under a live collection.
   *
   * The caller is application shutdown — closing what is open before the
   * process ends. Nothing about that is derivable from `isOpen`, which answers
   * about a document you already have the id of.
   */
  openDocIds(): readonly DocId[] {
    return [...this.#records.keys()];
  }

  // There is deliberately NO `versionOf(docId)`.
  //
  // It existed, and it was ADR-0009 §7's warned-about main-side field with a
  // public accessor on it. Anything that reads a version after an await and
  // stamps a result with it produces a result that executed at v3 carrying v4;
  // the renderer's staleness check passes and it caches stale content as
  // current. The version is handed to `run`'s work and returned stamped, so the
  // read-then-stamp sentence has no words — rather than being a rule somebody
  // has to remember while there is a convenient getter sitting next to it.

  /** Number of open documents. */
  get size(): number {
    return this.#records.size;
  }

  /**
   * Every open document whose file is `identity`, read from the filesystem now.
   *
   * Identities are re-read rather than cached on the record. A cached identity
   * is correct exactly until the file moves, and the cases this walk exists to
   * catch are the ones where it moved.
   */
  async #documentsAt(identity: FileIdentity): Promise<DocId[]> {
    const found: DocId[] = [];
    for (const record of this.#records.values()) {
      // Sequential on purpose: the number of open documents is the number of
      // tabs, and a stat storm is not worth the concurrency.
      const theirs = await this.#readIdentity(record.path);
      if (theirs !== null && isSameDocument(identity, theirs)) found.push(record.docId);
    }
    return found;
  }

  /** Runs `work` after every previously queued lane entry, whatever their fate. */
  #throughIndexLane<T>(work: () => Promise<T>): Promise<T> {
    // The work runs inside the marked async context, so anything it calls —
    // however deep — can be told it is inside the index lane. See `run`.
    const run = this.#indexLane.then(() => this.#insideIndexLane.run(true, work));
    // The lane carries no failures forward. Without this, one open that threw
    // would reject every open after it — turning a single bad path into a dead
    // service, which is a worse failure than the one being reported.
    this.#indexLane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
