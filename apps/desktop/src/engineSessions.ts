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
  MupdfSession,
} from '@monstera/kernel';
import type { DocId } from '@monstera/shared';

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
}
