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
 */

/**
 * `DocVersion` starts at 1; 0 is reserved for "never" (ADR-0009 §5), so
 * `savedVersion === 0` on a document that has never been written is
 * distinguishable from one saved at its opening version.
 */
const FIRST_VERSION = 1;

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
    this.#records.set(docId, { docId, handle, path, openedIdentity: identity, version });
    return { kind: 'opened', docId, version };
  }

  /**
   * Closes a document. The index entry is gone **before** teardown is awaited.
   *
   * That ordering is the whole point (ADR-0009 §2). It turns invariant L10 —
   * "an async result must not land in a closed document's state" — into a
   * lookup miss, rather than a discipline every commit path has to remember. A
   * `close` that awaited teardown first would leave a window in which the
   * document is closing and still findable, and every handler would need its
   * own still-open check to survive it.
   *
   * Deliberately **not** routed through {@link #indexLane}: waiting for the lane
   * is exactly the await that would reopen that window.
   *
   * The cost of that bypass is real and is paid where it should be. A close can
   * land inside a running {@link checkWriteTarget} for the same document, and
   * the check then finds nothing and refuses to report a verdict. Refusing to
   * write a document that is being closed is the correct outcome; the failure
   * message names this cause first among the three so nobody who hits it goes
   * hunting a filesystem race instead.
   */
  close(docId: DocId): Promise<void> {
    if (!this.#records.delete(docId)) return Promise.resolve();
    return this.#teardown(docId);
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

  /** The version a document is at, or `undefined` if it is not open. */
  versionOf(docId: DocId): DocVersion | undefined {
    return this.#records.get(docId)?.version;
  }

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
    const run = this.#indexLane.then(work);
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
