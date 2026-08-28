import type { CommandKind, CommandOfKind } from '@monstera/contract';
// DECLARATIONS, not specs. This reads `spec.writer` and calls nothing on it, so
// importing the spec table would bind the MuPDF native library **in main** —
// which invariant 20 forbids by name and §9.17's budget is argued against
// (ADR-0026). The kernel's barrel is now free of that edge too.
import {
  type ByteImage,
  type CommandBus,
  type DeclaredCommands,
  type DocumentService,
  type SaveDependencies,
  type SaveOutcome,
  type SessionsByWriter,
  declaredCommands,
  saveDocument,
} from '@monstera/kernel';
import type { DocId, DocVersion } from '@monstera/shared';

/**
 * The composition point (ADR-0009, 2026-08-19): the one place that owns
 * `DocumentService.run → CommandBus.execute`.
 *
 * ## Why one, and why here
 *
 * §7 fixes the lane, §4 fixes the log, §6 fixes routing, and nothing said who
 * assembles them. If every handler assembled it, a handler that forgets the lane
 * is a race — and there would be **a second place where a feature is wired**,
 * which is the thing the command registry exists to forbid.
 *
 * It lives under `apps/desktop/src` and imports no Electron, and the location is
 * a constraint rather than a convenience: the reachability trigger in
 * `docs/security/engine-advisories.json` scans every `src` tree under `apps/`,
 * so handlers put anywhere else would leave that verdict green through the whole
 * unit it was armed for. The repository map's rule is that `apps/desktop` is the
 * *only* package that **may** import Electron, not that everything in it must.
 *
 * ## What it deliberately does not own
 *
 * **Engine session lifetime.** Sessions are looked up, never created here — see
 * {@link SessionLookup}.
 *
 * **Who owns them is settled, and this comment used to say it was not.**
 * `docs/ARCHITECTURE.md` §2 states that per document `DocumentService` owns
 * "canonical bytes, lazily-created engine handles (invalidated together on any
 * mutation), the command log and checkpoints, and the originating `FileHandle`",
 * and §3.2 restates the handle half. That is the answer to *who opens a session
 * and from which bytes*: `DocumentService`, lazily, from its own canonical
 * image, as a cache that may be thrown away and rebuilt.
 *
 * The earlier text read ADR-0009 §8's silence as the project's. §8 is silent —
 * it says only that the kernel keeps the bytes — but the **living law is not**,
 * and `CLAUDE.md`'s document table puts `ARCHITECTURE.md` above an ADR wherever
 * they diverge. The advisory register agreed with the law rather than with this
 * comment: its entry called itself "a prompt to decide", and a prompt to decide
 * is not a change-control stop. Widening a source's silence into the project's
 * is how three lines of work acquire a ruling-sized question (EE-7's shape).
 *
 * What is genuinely open is the **policy**, not the ownership: how many images
 * are resident, what happens at ADR-0007's ceiling, and whether a killed host
 * actually recovers. The first two are answered in
 * [ADR-0021](../../../docs/DECISIONS/0021-the-canonical-image-is-retained.md).
 *
 * **The third is now two claims, and only one of them is still owed.** Its
 * *policy* is decided —
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9: the rebuild is bounded per document and poisons at two consecutive
 * failures, a death is reported on `ShellFailureSink`, and other documents are
 * neither drained nor failed because the supervisor enters their lanes rather
 * than creating at the lookup below. That last part is why {@link SessionLookup}
 * is unchanged: widening it to create would be bending this seam to fit a
 * feature, which is B4.
 *
 * What remains owed is the *measurement* — that a killed host actually recovers,
 * against a running one — and it is a `docs/FEATURES.md` row.
 */

/**
 * The engine sessions one open document currently has, keyed by writer of
 * record.
 *
 * **Partial by construction**, the same shape and the same reason as the bus's
 * `WriterRegistry`: four writers of record are declared and one has an adapter,
 * so a total map could not be built today and pretending otherwise would mean a
 * placeholder that fails at a native call instead of at lookup.
 *
 * **The type moved to `packages/kernel` on 2026-08-28 and this is an alias.**
 * `CommandBus.undo` takes one: undo reads the log to find which writer its last
 * entry routes to, and only then knows which session it needs — so the bus
 * takes the set and picks. Two declarations of the same mapped type, one on
 * each side of a call that passes it, is the shape where they agree until they
 * do not (B3a). The name stays because this is the vocabulary the module's
 * seams are written in.
 */
export type DocumentSessions = SessionsByWriter;

/**
 * How this finds a document's sessions — **get-or-miss, never get-or-create**.
 *
 * The same rule the lane and the log follow, for the same reason: a lookup that
 * creates would mint a session for a closed `DocId` and run a command against a
 * torn-down document. A miss here is a **defect**, not an outcome — an open
 * document without its session is an inconsistency in whoever holds them, and it
 * is reported as {@link MissingSessionError} so it reaches the renderer as
 * `internal` with a diagnostic recorded rather than as something a user is asked
 * to act on.
 */
export type SessionLookup = (docId: DocId) => DocumentSessions | undefined;

/**
 * What the engine session supervisor exposes to this composition point.
 *
 * ## Why two questions and not one
 *
 * {@link SessionLookup}'s `undefined` means **three** things — never opened, a
 * session awaiting a rebuild, and a document the supervisor has decided to stop
 * rebuilding for. Only the last is an outcome the user can be told about; the
 * others are a defect and a transient. Overloading one return value with all
 * three would make the difference unrecoverable at the only place that has to
 * act on it, so the decided state is asked for by name.
 *
 * ## Why ONE parameter carrying both
 *
 * They are two answers from one authority — the supervisor holds a single
 * per-document entry, by [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9a's DDDD-16 correction, precisely so the count and the sessions
 * cannot acquire separate owners. Handed over as two independent parameters,
 * nothing would stop a caller wiring them from two places, which is the second
 * opinion B3a is about. One object makes that unrepresentable rather than
 * discouraged.
 *
 * {@link SessionLookup} itself is unchanged, and that is the point: this
 * registers a second question beside it rather than widening it, which would be
 * B4 for the reason its own comment gives.
 */
export interface EngineSessionSource {
  /** Get-or-miss. See {@link SessionLookup}. */
  readonly sessions: SessionLookup;
  /**
   * The consecutive engine-host failure count that poisoned this document, or
   * `undefined` if it is not poisoned (Decision 9a). A document the supervisor
   * has never seen is not poisoned.
   *
   * **The count rather than a boolean, and the bound stays with the
   * supervisor.** This module must not re-derive *how many is too many* — that
   * would be a second opinion about a rule Decision 9a owns, and the two would
   * agree right up until the bound moved (B3a). It reports the number it was
   * handed, which is also what stops the diagnostic below carrying a figure
   * somebody recalled (B6).
   */
  readonly poisoned: (docId: DocId) => number | undefined;
}

/**
 * What a save needs that the engine session source does not provide.
 *
 * ## Why `flush` is here and NOT on {@link EngineSessionSource}
 *
 * It was there first, and the composition order refused it: `EngineSessions` is
 * built **before** the engine host exists, and the host is what yields the
 * registered writer — so the supervisor cannot be handed a flush at
 * construction without a cycle, and holding one it could be given later would
 * make its answers mutable after the fact. That class's `implements` clause is
 * what keeps its two answers honest, and widening the interface it satisfies to
 * something it cannot satisfy would have cost exactly that.
 *
 * So the flush travels with the save's other dependencies, composed at the root
 * where the writer and the session are both in scope — which is the only place
 * they are known to be correlated. This module therefore names no writer of
 * record and holds no second routing table (B3a), which matters because a save
 * has no command to route from and so cannot ask `CommandBus` the way undo
 * does.
 *
 * §4's *"flush each writer of record once"* is unambiguous at one adapter and
 * one session per document. The day a second writer holds a session for one
 * document, two live-session writers each return the WHOLE document from
 * `serialise` and nothing in the law says which bytes win. That is a B4
 * question, answered where this is composed rather than by picking one here.
 */
export interface SaveSource {
  /** The write-target check and the filesystem the atomic ordering runs on. */
  readonly deps: SaveDependencies;
  /** A document's current bytes. */
  readonly flush: DocumentFlush;
}

/** An open document had no session for the writer its command routes to. */
export class MissingSessionError extends Error {
  override readonly name = 'MissingSessionError';

  constructor(docId: DocId, writer: string) {
    super(
      `No '${writer}' session for a document that is open. Session lookup is get-or-miss: ` +
        'nothing is created here, so this means the holder of sessions and the open-document ' +
        `index have diverged. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * The supervisor has stopped rebuilding an engine session for this document.
 *
 * An **outcome**, not a defect, and the class is what carries that distinction
 * to `commandHandlers.ts` — matched on the class rather than on the message, for
 * the reason that file states: wording changes silently, and the direction this
 * fails in turns a decided outcome into an unexplained internal error.
 *
 * The message is a main-side diagnostic and never crosses. It names the count
 * because *how many* is the whole of the decision, and a reader meeting this in
 * a log needs the bound rather than the word.
 */
export class DocumentPoisonedError extends Error {
  override readonly name = 'DocumentPoisonedError';

  constructor(docId: DocId, failures: number) {
    super(
      `Engine work refused: ${String(failures)} consecutive engine-host failures with no success in ` +
        'between, so no session is rebuilt for this document (ADR-0023 Decision 9a). The ' +
        'canonical bytes and the command log stay in main, intact and unappliable — refusing ' +
        'STRANDS the work where closing would destroy it, which is the whole of why this is a ' +
        `refusal. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * Fails to compile the day a second command kind exists.
 *
 * **The hard shape this unit has NOT been verified against** (audit item 2),
 * named rather than left for someone to discover. With one kind, `Command` *is*
 * `CommandOfKind<'rotatePages'>`, so {@link DocumentCommands.execute} infers `K`
 * as that kind and every correlated lookup below — `declaredSpecs[command.kind]`
 * to a spec, `spec.writer` to a session — resolves to one concrete type.
 *
 * With two kinds a caller holding the wire union infers `K` as the union, and
 * `DeclaredSpecs[K]` becomes a *union of specs*: `spec.writer` is then a union of
 * writers, and TypeScript cannot correlate the session it selects with the
 * `apply` that will receive it. That needs a narrowing step from `Command` to
 * `CommandOfKind<K>`, which is a design with exactly zero data points today —
 * §6's mapped table routes, and what is missing is the discrimination in front
 * of it.
 *
 * So this is a trigger rather than a guess, the same mechanism `CommandBus.redo`
 * uses for `replay: 'stored-effect'`: it arrives at the moment the path becomes
 * reachable, and not before. `[X] extends [Y]` is the non-distributive form —
 * the bare `X extends Y` distributes and would answer `true` for a union that has
 * grown.
 */
type SingleCommandKindToday = [CommandKind] extends ['rotatePages'] ? true : never;
const singleCommandKind: SingleCommandKindToday = true;
void singleCommandKind;

/**
 * How a document's current bytes are obtained for a save.
 *
 * **Composed where the writer and the session were created together**, which is
 * the only place they are known to be correlated — so this module names no
 * writer of record and holds no second routing table (B3a). `CommandBus` owns
 * the registry; a save has no command to route from, so it cannot ask the bus
 * the way undo does, and the honest answer is to be handed the flush rather
 * than to re-derive it.
 */
export type DocumentFlush = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<ByteImage>;

export class DocumentCommands {
  readonly #documents: DocumentService;
  readonly #bus: CommandBus;
  readonly #engine: EngineSessionSource;
  readonly #save: SaveSource;

  constructor(
    documents: DocumentService,
    bus: CommandBus,
    engine: EngineSessionSource,
    save: SaveSource,
  ) {
    this.#documents = documents;
    this.#bus = bus;
    this.#engine = engine;
    this.#save = save;
  }

  /**
   * Runs one command through the lane and returns the version it produced.
   *
   * **The ordering is the whole of this method**, and every part of it is
   * load-bearing:
   *
   * - the bus runs **inside** `run`'s callback, so a command queues behind
   *   whatever else that document is doing (§7). Outside it, two concurrent
   *   commands would both capture prior state before either applied, and the
   *   second entry's inverse would record the state the *first* replaced —
   *   undo would then restore a document to something it was never in;
   * - the session is resolved **inside** the lane too, so a session torn down
   *   between queueing and running is a miss rather than a stale handle;
   * - the **poison** is read inside the lane, before the session, for both
   *   halves of that same reason. A document poisoned while this command sat in
   *   the queue is refused rather than run — and reading it first is what stops
   *   the decided outcome arriving as {@link MissingSessionError}, since a
   *   poisoned document has no session and the miss would otherwise win;
   * - the version returned is the one `run` stamps **after** the work, not the
   *   one it handed in. For a command those are two different numbers, and the
   *   pre-work value is the version the command *replaced*.
   *
   * `Executed` is deliberately dropped. It carries the log entry, and a log
   * entry holds an inverse or a checkpoint — a whole byte image — which must not
   * leave the main process (L11) and has no renderer-side use.
   *
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link DocumentPoisonedError}
   * — outcomes the handler reports as declared codes.
   * @throws {@link MissingSessionError} and anything the engine throws — defects,
   * which the boundary turns into `internal` with the diagnostic kept main-side.
   */
  async execute<K extends CommandKind>(
    docId: DocId,
    command: CommandOfKind<K>,
  ): Promise<DocVersion> {
    const spec: DeclaredCommands[K] = declaredCommands[command.kind];

    const { version } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      const session = sessions?.[spec.writer];
      if (session === undefined) throw new MissingSessionError(docId, spec.writer);

      await this.#bus.execute<K>(session, context, command);
    });

    return version;
  }

  /**
   * Steps one entry back, inside the document's lane.
   *
   * ## Every guard is `execute`'s, in the same order, and that is the point
   *
   * Poison, then session, then the lane's work. An undo is a mutation — §4
   * bumps the version for it *"including undo and redo"* — so a document that
   * cannot be executed against cannot be undone against either, and the two
   * paths agreeing is what stops one acquiring an exemption the other does not
   * have.
   *
   * ## Which writer, when the caller names no command
   *
   * `execute` reads `spec.writer` from the command it was handed. Undo has no
   * command: the bus reads the log's last entry and routes from **that**. So
   * this cannot resolve a session before entering the lane, and asking for the
   * one writer that has an adapter would be a routing table in a second place
   * (B3a).
   *
   * The session set is handed over whole and the bus picks. That is the same
   * shape `WriterSession` already has — a mapped lookup keyed by writer — and
   * it keeps the *"which engine owns this command"* question in the one file
   * that answers it.
   *
   * @returns the version the lane stamped, or `undefined` when the log had
   *   nothing left. **Not an error**: an empty log is where every document
   *   starts and where undoing to the beginning ends.
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError}, and
   *   `CheckpointRestoreNotBuiltError` for a terminal entry.
   */
  async undo(docId: DocId): Promise<DocVersion | undefined> {
    // HELD ON AN OBJECT rather than in a `let`, which is the idiom
    // `engineHostConnection.ts` records for the same reason: the assignment
    // happens inside a closure, so the compiler narrows the `let` to its single
    // visible value and calls the read below unreachable.
    const stepped = { yes: false };

    const { version } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      stepped.yes = (await this.#bus.undo(sessions, context)) !== undefined;
    });

    // THE VERSION IS READ FROM THE LANE EITHER WAY and returned only when
    // something moved. `run` stamps a version for every entry, so returning it
    // unconditionally would report a bump for an undo that did nothing — and
    // the renderer would show a document as changed because the user pressed a
    // key that was already exhausted.
    return stepped.yes ? version : undefined;
  }

  /**
   * §4's save pipeline, inside the document's lane.
   *
   * ## Every guard is `execute`'s, in the same order — and here the ORDER is
   * consistency rather than a mechanism, which is worth saying precisely
   *
   * Poison, then session, then the lane's work. A save calls into the contained
   * host — `serialise` is an engine call — so a document that cannot be
   * executed against cannot be saved either, and the three paths agreeing is
   * what stops one acquiring an exemption the others do not have.
   *
   * But the order carries weight in `execute` that it does not carry here, and
   * the difference was found by mutating it and watching nothing go red.
   * `execute` reads `sessions?.[spec.writer]`, so a poisoned document — whose
   * entry holds an empty session set from `begin` — misses on the writer and
   * would report {@link MissingSessionError} if poison were read second. This
   * reads `sessions === undefined`, which is true only for a document with no
   * entry at all; against the real supervisor a document with no entry is also
   * a document with no failure count, so the two guards are **mutually
   * exclusive** and neither order can be observed.
   *
   * It is kept in `execute`'s order anyway, and that is not superstition: the
   * day this check becomes per-writer — which is what a second registered
   * adapter forces — the order starts mattering, and nobody revisits an
   * ordering that has never been wrong.
   *
   * ## THE WHOLE SAVE IS ONE LANE ENTRY, and that is not an optimisation
   *
   * The flush and the stamp must not be split across two entries. `markSaved`
   * records *the current version*, so a command landing between them would mark
   * the document clean at a version whose bytes were never written — the user
   * closes it, nothing prompts, and the work is gone. One entry makes that
   * unrepresentable rather than unlikely.
   *
   * ## Which writer is flushed
   *
   * The session set holds one entry today and the flush is composed here, where
   * the writer and the session are known to be correlated. §4's *"flush each
   * writer of record once"* is unambiguous at one adapter; the day a second
   * writer holds a session for one document, two live-session writers each
   * return the whole document from `serialise` and nothing in the law says
   * which bytes win. That is a B4 question, and it is not answered by picking
   * one here.
   *
   * @returns what the save did — `saved`, `refused` or `write-failed`. None of
   *   the three is an error: in all of them the document is intact and its log
   *   untouched, which is invariant 18.
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError}, and anything the
   *   engine throws.
   */
  async save(docId: DocId): Promise<SaveOutcome> {
    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await saveDocument(this.#save.deps, context, () =>
        this.#save.flush(docId, sessions),
      );
    });

    return value;
  }
}
