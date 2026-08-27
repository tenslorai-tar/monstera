// `import type`, THE STATEMENT FORM, and the difference is 38.1 MB.
//
// Under `verbatimModuleSyntax` — which this repository sets — `import { type X }
// from 'm'` elides the BINDING and keeps the STATEMENT, emitting `import {} from
// 'm'`. That is a side-effect import of the kernel barrel, which re-exports
// `mupdfWriter`, which loads the native MuPDF binding. Measured: written that
// way, this module put the parser into `main`'s process and `perf:gate` failed
// on the BASELINE — 97.6 MB against the 96 MB base limit declared at the time
// (ADR-0025 has since derived it to 80 MB), with the ratio still
// passing at 1.04x, so the number that moved was not the one anybody watches.
//
// `import type { … } from 'm'` is erased whole. The two spellings look
// interchangeable and are not, and invariant 20 is what sits behind the
// difference: no native engine code in main.
import type {
  DocumentService,
  DocumentTeardown,
  EngineSupervisor,
  HostTermination,
  MupdfSession,
} from '@monstera/kernel';
import type { DocId } from '@monstera/shared';

import { describeEngineHostGone, type ShellFailureSink } from './shellFailure.js';

// `import type`, and the header above says why in 38.1 MB. This one is the
// SECOND occurrence and it landed in the file that documents the first: written
// `import { type X } from './documentCommands.js'` it emitted
// `import {} from './documentCommands.js'`, and that module imports
// `declaredSpecs` as a VALUE — so the kernel barrel, `mupdfWriter` and the
// native MuPDF binding all arrived in whatever process loads this, including
// `perf:gate`'s main-service role, which measures main's fixed cost.
import type { DocumentSessions, EngineSessionSource } from './documentCommands.js';

/**
 * The engine session supervisor — the component that creates a document's
 * engine session and owns the directory pair its bytes travel through.
 *
 * ## Why this module exists before the rest of the supervisor does
 *
 * `documentCommands.ts` states the constraint in its own words: `SessionLookup`
 * is *"get-or-miss, never get-or-create"*, and *"widening it to create would be
 * bending this seam to fit a feature, which is B4."* So something other than
 * the lookup must create a session and put it where the lookup finds it. That
 * something is this.
 *
 * What is here is the **creation** step and the **state** — `openEngineSession`
 * and {@link EngineSessions}, which together are Decision 9a. What is not here
 * is what drives them: the transport subscription that observes a death
 * (Decision 9b), the host rebuild, and the lane entry that reopens each
 * document's session rather than draining it (Decision 9c).
 *
 * It is written now rather than with the rest because the capability it mints
 * has to be minted **somewhere**, and `documentService.ts` says what a token
 * with no minter is: *"a method nobody can call — a narrowing that reads as a
 * decision and behaves as a deletion."*
 *
 * ## The B3 split this module is one half of
 *
 * | concern | owner |
 * |---|---|
 * | the handed directory pair's lifetime — created, removed on close | **this module** |
 * | the canonical image, and copying it out | `DocumentService` |
 *
 * Neither writes the other's concern. That is what stops the pair acquiring two
 * owners and the image acquiring two writers — and it is why the image reaches
 * the snapshot directory through `writeCanonicalImage(destination)` rather than
 * through a getter that would hand this module the bytes.
 */

/**
 * THE MINT, and it is the only one.
 *
 * Module-private on purpose, exactly as `commandBus.ts` mints `CommandWriter`:
 * that one line is what makes this component the single holder of the
 * capability, and any other module producing one is a cast visible in a diff.
 */
const SUPERVISOR = {} as EngineSupervisor;

/**
 * The directories one session's bytes travel through, and their lifetime.
 *
 * Injected rather than imported because creating a directory with a DACL is
 * Win32 work — `createSessionDirectories` in `sessionDirectories.ts` — and this
 * module's cases must be decidable without a container, a grant or an
 * AppContainer SID.
 */
export interface SessionAreaOwner {
  /** Creates one session's granted pair and returns where the snapshot goes. */
  readonly create: () => Promise<{ readonly snapshotPath: string }>;
  /** Removes the pair. Called on every failure path out of {@link openEngineSession}. */
  readonly remove: () => Promise<void>;
}

/**
 * How the engine is asked to open what was written.
 *
 * A narrower shape than `EngineWriter` deliberately: this step opens, and
 * `serialise`/`close` belong to the parts of the supervisor that are not built.
 * A parameter typed to the whole writer would let this function grow into them
 * without anybody choosing to.
 */
export type EngineOpenFromPath = (snapshotPath: string) => Promise<MupdfSession>;

/**
 * Creates the engine session for one open document.
 *
 * ## The image never passes through this function
 *
 * `writeCanonicalImage` takes a **destination** and returns a count. That is
 * the whole point of the capability: this module is the one component permitted
 * to have the service copy an image out, and it still never holds one. A
 * version of this that read the bytes and wrote them itself would put a second
 * copy of the document in main for the duration — 1.00× becoming 2.00× against
 * a 1.5× ceiling, measured.
 *
 * ## Every failure removes the pair
 *
 * By the time the engine is asked to open, the user's document is on disk in a
 * directory the contained host may read. A caller that receives an error rather
 * than a session will never close a session, so nothing else would remove it.
 *
 * @param documents The service holding the canonical image.
 * @param docId The open document.
 * @param areas The granted directory pair, whose lifetime this owns.
 * @param open How the engine opens a path.
 * @returns The session, and the byte count the service reported writing.
 */
export async function openEngineSession(
  documents: DocumentService,
  docId: DocId,
  areas: SessionAreaOwner,
  open: EngineOpenFromPath,
): Promise<{ readonly session: MupdfSession; readonly snapshotBytes: number }> {
  const { snapshotPath } = await areas.create();
  try {
    const snapshotBytes = await documents.writeCanonicalImage(SUPERVISOR, docId, snapshotPath);
    const session = await open(snapshotPath);
    return { session, snapshotBytes };
  } catch (error) {
    await areas.remove();
    throw error;
  }
}

/**
 * The same capability, for an instrument that must drive the SHIPPED call site.
 *
 * ## Why this is exported and why it is not a widening
 *
 * `perf:gate`'s coverage row asks whether writing a snapshot from a main
 * process already holding the document adds a resident copy. Answering it needs
 * the real `writeCanonicalImage`, and the alternatives were both the defect
 * that gate's own role exists because of (LL-4/JJ-1): a harness that reads the
 * file a second time measures its own copy, and a harness that invents a call
 * site measures something nothing ships.
 *
 * So the instrument takes the capability rather than a copy of the mechanism.
 * What it does **not** get is the bytes — the method's whole shape is that
 * nothing receives them, and that is unchanged by who holds the token.
 *
 * Named so that a use of it in production code is a sentence a reviewer reads,
 * which is the same property `CommandWriter`'s module-private mint has: the
 * brand never made forgery impossible, it made it visible.
 */
export const SUPERVISOR_CAPABILITY_FOR_INSTRUMENTS: EngineSupervisor = SUPERVISOR;

/**
 * What the death handler needs that is not the supervisor's own state.
 *
 * Injected rather than imported for the reason the whole module is: a case about
 * *which lanes were entered, in what order* must be decidable without a pipe, a
 * process or a container.
 */
export interface HostDeathSurfaces {
  /** The lanes. Entered through `run`, which is get-or-miss on the record. */
  readonly documents: DocumentService;
  /** Where the death is reported. Decision 9b. */
  readonly failures: ShellFailureSink;
  /**
   * Builds a replacement host and resolves when it can answer.
   *
   * Called **once** per death, and every lane awaits the same promise — one host
   * per engine (Decision 9c), not one per document.
   */
  readonly rebuild: () => Promise<void>;
  /**
   * Reopens one document's sessions against the rebuilt host.
   *
   * Runs **inside** that document's lane, so the reopened session cannot be
   * handed to a command that queued before it.
   */
  readonly reopen: (docId: DocId) => Promise<DocumentSessions>;
  /**
   * Whether a lane entry failed because the document closed underneath it.
   *
   * **Injected because this module may not value-import the kernel.**
   * `DocumentNotOpenError` is a class, `instanceof` needs it at run time, and
   * `@monstera/kernel` exports only `.` — so naming it here would load the
   * barrel, `mupdfWriter` and the native MuPDF binding into `main`. That is
   * invariant 20, and it is the 38 MB this module's own header is about.
   *
   * Matching on `error.name` instead was the other candidate and is rejected:
   * a string copied out of a class is a second opinion about that class's
   * identity, and it drifts in silence (B3a). The composition root already
   * imports the kernel, so the one place that can answer this cheaply is the
   * one place that answers it.
   */
  readonly closedMeanwhile: (error: unknown) => boolean;
}

/**
 * What {@link onDocumentOpened} needs. A strict subset of
 * {@link HostDeathSurfaces} — no `rebuild`, because a host that is already
 * running is not rebuilt for a new document, and `create` instead of `reopen`
 * because the two are the same call with different names in the log.
 */
export interface DocumentOpenSurfaces {
  readonly documents: HostDeathSurfaces['documents'];
  readonly failures: HostDeathSurfaces['failures'];
  readonly closedMeanwhile: HostDeathSurfaces['closedMeanwhile'];
  /** Creates one document's sessions. Runs **inside** that document's lane. */
  readonly create: (docId: DocId) => Promise<DocumentSessions>;
}

/**
 * A document was opened: give it a session, inside its own lane.
 *
 * ADR-0023's 2026-08-27 correction. The shape is 9c's death path with one
 * document and no rebuild, and it exists so that **an open document is either
 * sessioned or poisoned and never neither** — without it a failed creation
 * leaves the document open, sessionless and healthy, and the next command
 * answers `MissingSessionError` → `internal`, which is 9c's rejected on-demand
 * rebuild arriving through the back door.
 *
 * ## Why this retries, when the death path does not
 *
 * On a death the count is already raised and a second death poisons; there is a
 * later event to carry the outcome. At open there is no later event, so the
 * entry itself has to reach a terminal state. The loop is bounded by 9a's
 * counter and nothing else: each failure increments, and `POISON_AT` is 2, so
 * it makes at most two attempts.
 *
 * **That bound is why this is not 9a's rejected "try again".** The rejection is
 * of a retry that makes the second attempt *cheaper* than the first; this one
 * spends the bound rather than resetting it, so a document whose bytes kill the
 * host at open costs two deaths and is then poisoned — which is what the bound
 * is for. `N = 1` was the alternative and 9a rejects it by name, because an
 * open-time host-creation failure is exactly the transient-versus-deterministic
 * case a retry exists to separate.
 *
 * ## The ordering, which is 9c's argument reused
 *
 * The lane entry is queued before this returns, so it sits ahead of every
 * command the user issues afterwards. A command therefore observes the document
 * only after the entry has settled — sessioned or poisoned — which is what makes
 * *never neither* a property of the shape rather than something to check.
 *
 * @returns a promise that settles when the entry has finished. `open` must not
 *   await it: a document opens whether or not an engine is available, and
 *   waiting here would make every open as slow as a host build. Returned for
 *   the cases, and because a caller that wants to know may.
 */
export async function onDocumentOpened(
  sessions: EngineSessions,
  docId: DocId,
  surfaces: DocumentOpenSurfaces,
): Promise<void> {
  // Both of these run BEFORE this function's first `await`, so they complete
  // synchronously from the caller's side — which is what puts the lane entry
  // ahead of anything the user does next.
  //
  // `begin` is outside the entry rather than inside it: `recordFailure` skips a
  // document with no entry, so an entry that appeared only on success could
  // never record the failure this function exists to bound.
  sessions.begin(docId);
  const entered = surfaces.documents.run(docId, async () => {
    // BOUNDED STRUCTURALLY AS WELL AS SEMANTICALLY, and the second bound is not
    // belt-and-braces — it was found by mutation. The exit that matters is
    // `poisoned()`, which is 9a's authority on when to stop; but `poisoned()`
    // only ever becomes true because `recordFailure` incremented, and
    // `recordFailure` silently skips a document with no entry. Delete the
    // `begin` above and a `for (;;)` here does not fail — it SPINS, for ever,
    // inside a lane, with no diagnostic. A loop whose termination depends on a
    // different method's side effect is a runaway waiting for that method to
    // change; `POISON_AT` bounds it here too, so the illegal state cannot be
    // represented rather than being caught (B5).
    for (let attempt = 0; attempt < POISON_AT; attempt += 1) {
      try {
        sessions.hold(docId, await surfaces.create(docId));
        return;
      } catch (error) {
        if (surfaces.closedMeanwhile(error)) return;
        sessions.recordFailure([docId]);
        if (sessions.poisoned(docId) !== undefined) {
          surfaces.failures({
            event: 'engine-host-gone',
            detail:
              `no engine session could be created for document ${docId.slice(0, 8)}… and it ` +
              `is now poisoned: ${String(error)}. Commands against it answer document-poisoned ` +
              `rather than internal, and close-and-reopen is what clears it.`,
          });
          return;
        }
      }
    }

    // Reached only if the attempts ran out without `poisoned()` agreeing, which
    // means the counter and this loop disagree about 9a's bound. Reported rather
    // than ignored: the document is open and sessionless, which is the one state
    // this function exists to prevent, and silence here would restore it.
    surfaces.failures({
      event: 'engine-host-gone',
      detail:
        `supervisor defect: ${String(POISON_AT)} session-creation attempts for document ` +
        `${docId.slice(0, 8)}… did not leave it poisoned, so it is open with no session. The ` +
        `failure counter and this bound disagree.`,
    });
  });

  try {
    await entered;
  } catch (error) {
    // `run` itself refused — the document closed between `open` returning and
    // the lane being entered. The seam working, not a failure to report.
    if (surfaces.closedMeanwhile(error)) return;
    surfaces.failures({
      event: 'engine-host-gone',
      detail: `could not enter document ${docId.slice(0, 8)}…'s lane to create its session: ${String(error)}`,
    });
  }
}

/**
 * The engine host connection ended: report it, and put every document back.
 *
 * Wired as `createEngineHostConnection`'s `onEnded`. It is one function rather
 * than two because Decisions 9b and 9c both happen **at the moment the ending is
 * observed**, and the ordering below is the only thing that makes 9c's claims
 * true.
 *
 * ## Why the lane entries are queued SYNCHRONOUSLY
 *
 * `documents.run` is called for every document before this function awaits
 * anything. That is what puts each reopen **ahead of every command the user
 * issues afterwards**. Wiring it the other way round — build the host, then
 * enter the lanes — leaves a window in which a command queues in front of the
 * reopen and finds no session, which is the `MissingSessionError` Decision 9c
 * exists to keep off the ordinary post-crash path.
 *
 * ## What is deliberately NOT done
 *
 * **Nothing is drained and nothing is failed.** In-flight calls have already
 * rejected — the client settles them, and that is a deduction rather than a
 * decision. Queued commands never touched the host and the canonical bytes they
 * will run against are intact in main, so failing them would report a fault they
 * did not have. They simply sit behind their document's reopen, in the order the
 * lane already guarantees.
 *
 * **A poisoned document gets no reopen.** That is Decision 9a's whole content:
 * at two consecutive failures with no success between them, no session is
 * rebuilt and `document.execute` answers `document-poisoned`.
 *
 * **A document closed in the meantime is skipped by the seam, not by a check.**
 * `run` is get-or-miss on the record, so it refuses rather than resurrecting,
 * and the refusal is swallowed here because it is the correct outcome rather
 * than a failure to report.
 *
 * ## The anchor Decision 9c asks for is NOT here, and that is stated
 *
 * The rebuild set is derived from this supervisor's own map, whose failure
 * direction is *smaller* (audit item 4c), so it wants an anchor outside itself —
 * *open minus poisoned must equal sessions held*, against `DocumentService.size`.
 * **It cannot hold yet.** Nothing creates a session at open, so `size` counts
 * documents this supervisor has never heard of and the identity is false by
 * construction today. Shipping it now would be a check that is wrong rather than
 * one that watches, so it is owed at the moment sessions are created at open.
 *
 * @returns a promise that settles when every lane entry has finished. Returned
 *   for the cases; a subscriber calls this for its effect and the connection's
 *   `onEnded` is synchronous.
 */
export async function onEngineHostEnded(
  sessions: EngineSessions,
  termination: HostTermination,
  surfaces: HostDeathSurfaces,
): Promise<void> {
  surfaces.failures(describeEngineHostGone(termination));

  // Snapshotted BEFORE the count moves, because `recordFailure` is what decides
  // which of these are poisoned and the set itself must not change under it.
  const affected = sessions.documentIds();
  sessions.recordFailure(affected);

  // A deliberate close is not a rebuild. Nothing is coming back, and entering
  // lanes to await a host nobody is building would hang every document.
  if (termination.code === 'shutdown') return;

  const rebuilt = surfaces.rebuild();

  // Every entry is queued here, in this loop, before the first await below.
  const entries = affected
    .filter((docId) => sessions.poisoned(docId) === undefined)
    .map(async (docId) => {
      try {
        await surfaces.documents.run(docId, async () => {
          await rebuilt;
          sessions.hold(docId, await surfaces.reopen(docId));
        });
      } catch (error) {
        // A closed document is the seam working; anything else is a rebuild
        // that did not arrive, and the document keeps its raised count.
        if (surfaces.closedMeanwhile(error)) return;
        surfaces.failures({
          event: 'engine-host-gone',
          detail:
            `reopen failed for document ${docId.slice(0, 8)}…: ${String(error)}. Its session is ` +
            `not restored and its consecutive-failure count stands, so a second death with no ` +
            `success between them poisons it.`,
        });
      }
    });

  // `rebuilt` is awaited inside the lanes rather than here, so a rejection has a
  // handler by the time it settles. Awaiting it first would make the rejection
  // unhandled for a tick and lose the per-document reporting above.
  await Promise.all(entries);
}

/**
 * How many consecutive engine-host failures poison a document.
 *
 * **A decision, not a derivation** (ADR-0023 Decision 9a, decided 2026-08-25),
 * and its own text says so: the number is not derivable from anything that ADR
 * cites. One retry tells you whether the failure is deterministic; a second
 * re-derives an answer already in hand while feeding the suspect input to a
 * fresh process again.
 *
 * Module-private on purpose. A test importing this and computing its
 * expectations from it would agree with any value — the bound is what the cases
 * exist to pin, so they spell the counts out.
 */
const POISON_AT = 2;

/** One open document's supervisor state. See {@link EngineSessions}. */
interface DocumentEntry {
  sessions: DocumentSessions;
  /** Reset to zero by any call the host answers (Decision 9a). */
  consecutiveFailures: number;
}

/**
 * The supervisor's per-document state: which engine sessions a document has,
 * and how many consecutive host failures it has had.
 *
 * ## Why the sessions and the count are ONE map
 *
 * Decision 9a's DDDD-16 correction fixes it: *"the failure count and the poison
 * live on the supervisor's per-document state, whose lifetime is the record's"*.
 * Two maps keyed by `DocId` would be two owners of one document's supervisor
 * state, which is the B3 defect — and they would drift at exactly the moment
 * that matters, when a document closes during a host death.
 *
 * ## Recovery needs no mechanism, and that is the design rather than a gap
 *
 * ADR-0009 fixes that a `DocId` is **minted, never derived** — 256 random bits
 * per open. So closing and reopening a file arrives here as an id with no entry,
 * at zero, and the four candidate recovery policies collapse to one that cannot
 * be got wrong. The worst of them — *never, for the life of the process* — is
 * unrepresentable rather than rejected, because it has no key to live on (B5).
 *
 * **What that recovery costs is stated in the ADR and is not free**: the DDDD-18
 * correction withdraws *"a poisoned document is still saveable"*, because a save
 * is a parse and a poisoned document has no session. Close-and-reopen resets the
 * count by dropping the record, and the command log's lifetime is the record's,
 * so it takes the user's unsaved work with it. Refusing **strands** the work
 * where closing **destroys** it; that, and not saveability, is why refusing wins.
 *
 * ## What is not here
 *
 * The transport subscription that calls {@link EngineSessions.recordFailure},
 * the host rebuild, and the lane entry that reopens each document's session
 * (Decisions 9b and 9c). This is the state those act on, written first for the
 * same reason the module's header gives for `openEngineSession`: the alternative
 * is a second map arriving later beside this one.
 */
export class EngineSessions implements EngineSessionSource {
  readonly #entries = new Map<DocId, DocumentEntry>();

  /**
   * Get-or-miss, never get-or-create. Arrow-bound because this is handed over
   * as {@link EngineSessionSource}'s member and a method would lose its
   * receiver on the way.
   */
  readonly sessions = (docId: DocId): DocumentSessions | undefined =>
    this.#entries.get(docId)?.sessions;

  /** The count that poisoned this document, or `undefined`. */
  readonly poisoned = (docId: DocId): number | undefined => {
    const failures = this.#entries.get(docId)?.consecutiveFailures ?? 0;
    return failures >= POISON_AT ? failures : undefined;
  };

  /**
   * Mints a document's entry at **open**, before it has any session.
   *
   * The opening half of the lifetime {@link EngineSessions.releaseOnClose}
   * closes, and it did not exist until ADR-0023's 2026-08-27 correction: the
   * entry used to begin at the first {@link EngineSessions.hold}, so a document
   * whose open-time session creation failed had no entry at all — and
   * {@link EngineSessions.recordFailure} skips a document with no entry, so its
   * failure could not be counted. Minting here is what lets that counter see the
   * open path without being given a second job (B3a).
   *
   * Idempotent. `open` is the only caller and mints once per `DocId`, but a
   * guard that overwrote an existing entry would silently reset a poisoned
   * document's count, which is the one thing this class must never do quietly.
   */
  begin(docId: DocId): void {
    if (this.#entries.has(docId)) return;
    this.#entries.set(docId, { sessions: {}, consecutiveFailures: 0 });
  }

  /**
   * Records the sessions a document now has.
   *
   * Refuses a poisoned document rather than accepting it, because *poisoned*
   * means no session is rebuilt: a session held for one could never be used —
   * {@link EngineSessions.poisoned} is read first, and refuses. Accepting it
   * would leave an unreachable session in the map and a supervisor whose two
   * answers disagree, which is the state this class exists as one map to
   * prevent.
   */
  hold(docId: DocId, sessions: DocumentSessions): void {
    const entry = this.#entries.get(docId);
    if (entry !== undefined && entry.consecutiveFailures >= POISON_AT) {
      throw new Error(
        `Supervisor defect: sessions offered for a poisoned document, whose whole meaning is ` +
          `that no session is rebuilt for it. (document ${docId.slice(0, 8)}…)`,
      );
    }
    if (entry === undefined) {
      this.#entries.set(docId, { sessions, consecutiveFailures: 0 });
      return;
    }
    entry.sessions = sessions;
  }

  /**
   * Drops a document's state, on close. **Registered as `DocumentService`'s
   * `teardown`, never called by hand.**
   *
   * This is what makes the entry's lifetime the record's. It is also why a
   * document closed between a call being issued and the host dying is simply
   * absent from {@link EngineSessions.recordFailure}'s effect rather than
   * needing a case: there is nothing left to increment.
   *
   * ## Why it is typed as the seam rather than exposed as a method
   *
   * `DocumentService` is the **only** thing that knows a document closed — the
   * record's lifetime is its concern, and this entry's lifetime is defined to
   * be the record's. A `release(docId)` method for somebody else to call is a
   * fan-out that works only while whoever writes the close path remembers this
   * component exists, and this project replaces callers-you-must-remember with
   * registrations (finding FFFF-1, where three documents asserted the lifetime
   * property in the present tense while nothing invoked it).
   *
   * `DocumentTeardown` is the seam that already existed for exactly this, in its
   * own words — *"releases whatever a document holds outside this index — the
   * engine session, above all"* — so nothing here is a new seam. Typing the
   * member as it is what makes the registration a compile-time fit rather than
   * an adapter arrow in the composition root that could be written wrong.
   *
   * **The ordering is `DocumentService`'s and is why this needs no lane of its
   * own**: `close` removes the index entry *before* awaiting teardown, and
   * awaits the document's lane first, so this runs after that document's
   * in-flight work and after any later message has already missed the index.
   */
  readonly releaseOnClose: DocumentTeardown = (docId) => {
    this.#entries.delete(docId);
    return Promise.resolve();
  };

  /**
   * A host death: increments every document that had a call rejected by it, and
   * **drops the sessions that died with the host**.
   *
   * Dropping is not bookkeeping. One host per engine means every session it held
   * is gone the moment it is, and a handle left in this map is one a queued
   * command would find and use — a stale handle into a process that no longer
   * exists, which is the shape resolving the session inside the lane already
   * exists to prevent one step earlier. Decision 9c's lane entry is what puts
   * them back.
   *
   * The caller supplies that set; this does not derive it. A `DocId` with no
   * entry is skipped, and the only way to be in the set without one is to have
   * been closed in between — see {@link EngineSessions.releaseOnClose}.
   *
   * **Attribution is deliberately absent.** Decision 9a rejected counting only
   * the document whose call was the sole one in flight: it is evadable by
   * concurrency and buys nothing once a success resets the count. The residual
   * it leaves is real and is recorded in the ADR's DDDD-17 correction — a
   * document busy at two successive deaths caused by a *third* document's bytes
   * reaches the bound having caused neither.
   */
  recordFailure(docIds: Iterable<DocId>): void {
    for (const docId of docIds) {
      const entry = this.#entries.get(docId);
      if (entry === undefined) continue;
      entry.consecutiveFailures += 1;
      entry.sessions = {};
    }
  }

  /**
   * A call the host answered: back to zero.
   *
   * **This is what makes a plain counter correct**, and without it the count
   * would poison the innocent. One host per engine means a death rejects calls
   * for documents that had nothing to do with it; their next command succeeds
   * against the rebuilt host and puts them back to zero, so only a document that
   * fails twice with no success in between reaches the bound.
   */
  recordSuccess(docId: DocId): void {
    const entry = this.#entries.get(docId);
    if (entry === undefined) return;
    entry.consecutiveFailures = 0;
  }

  /**
   * How many documents this holds state for.
   *
   * **NOT the anchor Decision 9c needs**, and saying so here is the point. A
   * count read off this map cannot disagree with this map, so it can never
   * report a document that silently lost its session — the failure 9c fears
   * makes the set *smaller* (audit item 4c). That anchor is `DocumentService.size`,
   * which lives outside this class on purpose. This exists so a test can see
   * that {@link EngineSessions.releaseOnClose} dropped an entry rather than
   * leaked it.
   */
  get held(): number {
    return this.#entries.size;
  }

  /**
   * How many documents hold **at least one** engine session.
   *
   * Distinct from {@link EngineSessions.held}, and only since
   * {@link EngineSessions.begin} existed: an entry is now minted at open, so
   * *has an entry* and *has a session* are different questions for the first
   * time. `held` answers the lifetime one — did `releaseOnClose` drop it — and
   * this answers Decision 9c's anchor one.
   *
   * Two accessors rather than one with a parameter, because the choice between
   * them is then two names a caller picks from rather than a paragraph someone
   * has to read and reject (QQQ-3).
   *
   * **This is still not the whole anchor**, for the reason `held`'s comment
   * gives: a count read off this map cannot disagree with this map. The anchor
   * is *`DocumentService.size` minus poisoned equals this*, and the term that
   * makes it load-bearing is the one from outside.
   */
  get sessioned(): number {
    let count = 0;
    for (const entry of this.#entries.values()) {
      if (Object.keys(entry.sessions).length > 0) count += 1;
    }
    return count;
  }

  /**
   * Every document this holds state for, in insertion order.
   *
   * The set a host death acts on: Decision 9c's rebuild set, and the argument
   * {@link EngineSessions.recordFailure} is given. Snapshotted into an array
   * rather than exposing the map, because the caller mutates this state while
   * iterating — `hold` during a reopen would otherwise be a live-collection
   * hazard rather than a decision anybody made.
   */
  documentIds(): readonly DocId[] {
    return [...this.#entries.keys()];
  }
}
