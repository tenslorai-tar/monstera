import { AsyncLocalStorage } from 'node:async_hooks';

import { type DocId, type DocVersion, type FileHandle, asDocId, asDocVersion } from '@monstera/shared';

import { type CapabilityRegistry } from './capabilityRegistry.js';
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
 */

/**
 * `DocVersion` starts at 1; 0 is reserved for "never" (ADR-0009 §5), so
 * `savedVersion === 0` on a document that has never been written is
 * distinguishable from one saved at its opening version.
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
  readonly version: DocVersion;
}

/**
 * A lane entry's result, stamped with the version it ran at.
 *
 * The stamp comes from the lane, not from the caller, so a late result is
 * recognisable rather than plausible.
 */
export interface Versioned<T> {
  readonly value: T;
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
  readonly version: DocVersion;
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
  | { readonly kind: 'opened'; readonly docId: DocId; readonly version: DocVersion }
  | { readonly kind: 'already-open'; readonly docId: DocId }
  | { readonly kind: 'absent' };

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
  /** The check ran and could not settle whether the file was replaced. */
  | { readonly kind: 'unverifiable'; readonly reason: 'no-file-index' };

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
 * So the only evidence here is `dev:ino`, and where the filesystem supplies
 * none, replacement is undetectable — reported as such rather than as a clear
 * verdict. That case does not arise on NTFS; it is the unmeasured network-share
 * shape from ADR-0009's correction, and it degrades to the behaviour this
 * project already had, which is to say no detection.
 */
function replacementVerdict(opened: FileIdentity, now: FileIdentity): WriteTargetVerdict {
  if (opened.dev === null || opened.ino === null || now.dev === null || now.ino === null) {
    return { kind: 'unverifiable', reason: 'no-file-index' };
  }
  if (opened.dev !== now.dev || opened.ino !== now.ino) return { kind: 'replaced' };
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

export class DocumentService {
  readonly #records = new Map<DocId, DocumentRecord>();
  readonly #capabilities: CapabilityRegistry;
  readonly #randomBytes: TokenBytesSource;
  readonly #teardown: DocumentTeardown;
  readonly #readIdentity: IdentityReader;

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

  constructor(
    capabilities: CapabilityRegistry,
    options: {
      readonly teardown?: DocumentTeardown;
      readonly randomBytesSource?: TokenBytesSource;
      readonly readIdentity?: IdentityReader;
    } = {},
  ) {
    this.#capabilities = capabilities;
    this.#teardown = options.teardown ?? noTeardown;
    this.#randomBytes = options.randomBytesSource ?? cryptoBytes;
    this.#readIdentity = options.readIdentity ?? readFileIdentity;
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
      version,
      lane: Promise.resolve(),
      queued: 0,
    });
    return { kind: 'opened', docId, version };
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
  close(docId: DocId): Promise<void> {
    const record = this.#records.get(docId);
    if (record === undefined) return Promise.resolve();

    // Half 1. Synchronous, before any await, outside every lane.
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

    const record = this.#records.get(docId);
    if (record === undefined) {
      // Get-or-miss. A lazily created lane would run this work against a
      // torn-down document, which is the resurrection L10 forbids.
      throw new Error('Cannot run work for a document that is not open.');
    }

    if (record.queued >= MAX_QUEUED) throw new DocumentBusyError(docId, record.queued);
    record.queued += 1;

    const started = record.lane.then(async () => {
      // Read here, when the work actually runs — not when it was queued.
      const version = record.version;
      const value = await work({ docId: record.docId, path: record.path, version });
      return { value, version };
    });

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
      throw new Error('Cannot verify a write target for a document that is not open.');
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
