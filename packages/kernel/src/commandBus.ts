import type { CommandKind, CommandOfKind } from '@monstera/contract';

import type {
  CaptureResult,
  Checkpoint,
  CommandPrior,
  LogEntryFor,
  LogTrim,
} from './commandLog.js';
// DECLARATIONS, not specs. The bus reads `writer` and `replay` and calls
// nothing — `apply`, `capture` and `invert` go through the registered writer
// (ADR-0023 Decision 10). Importing the spec table here would reach
// `rotatePages.ts` → `mupdfWriter.ts` and bind the MuPDF native library in
// whatever process loaded the bus, which for `main` is invariant 20's exact
// prohibition (ADR-0026; measured at +40.1 MB).
import {
  type DeclaredCommands,
  type WriterOf,
  declaredCommands,
} from './commandDeclarations.js';
// `import type`, NOT `import { type … }` — the second keeps the statement and
// emits `import {} from './commandSpecs.js'`, which loads the spec table and
// with it the native library this whole change exists to keep out of `main`.
import type { RegisteredWriter } from './commandSpecs.js';
import type { CommandWriter, DocumentContext } from './documentService.js';
// A VALUE IMPORT, and the only one in this file that is not the declarations
// table. `writerShapes` is what decides whether a command's result is a new
// document, and `engineSeam.ts`'s every other import is `import type`, so the
// edge costs an importer the object literal and nothing else (ADR-0039).
import {
  type ByteImage,
  type CommandReads,
  type PreRead,
  type PreReadValue,
  type SessionsByWriter,
  type WriterSession,
  writerShapes,
} from './engineSeam.js';

/**
 * The one code path from a command to a log entry (ADR-0009 §4).
 *
 * ## Why there is exactly one
 *
 * §4: *"the checkpoint is taken by the bus before `apply`, in one code path,
 * never by a handler."* Two paths is how a checkpoint becomes optional — one of
 * them forgets, the entry is terminal with nothing to restore from, and the
 * failure appears at undo rather than at execution.
 *
 * The rule is enforced three ways rather than written down:
 *
 * 1. `Checkpoint` is **branded**, and {@link CommandBus} holds the only mint.
 * 2. A live-session `apply` returns `Promise<void>` (§8) and has nowhere to put
 *    one.
 * 3. `capture` returns a `CaptureResult`, which has no member that can carry
 *    one.
 *
 * ## Capture first, and the fallback that falls out of it
 *
 * Every execution captures before it applies. If capture succeeds the entry is
 * invertible; if it reports that prior state cannot be recorded, **the bus takes
 * a checkpoint and applies anyway** — ADR-0009's 2026-08-19 decision that
 * invertibility is declared per command and determined per entry.
 *
 * That fallback needs nothing new, which is the argument for capture-before-
 * apply having been the right call: nothing is checkpointed speculatively, and
 * nothing has to predict whether capture will succeed.
 */

/**
 * The engine adapters available to take a checkpoint and to run a command.
 *
 * **Partial by construction, not by oversight.** The seam declares four writers
 * of record and one has an adapter; a total map could not be built today, and
 * pretending otherwise would mean a placeholder adapter that fails at the native
 * call instead of at registration. A command routed to an unregistered writer is
 * refused by name — see {@link UnregisteredWriterError} — which is the same
 * shape as ADR-0018's update provider registered with nothing behind it.
 */
export type WriterRegistry = {
  readonly [W in keyof WriterSession]?: RegisteredWriter<W>;
};

/**
 * The single mint for a {@link Checkpoint}, module-private on purpose.
 *
 * Not exported, so no handler, no adapter and no other kernel module can
 * produce one. §4's *"never by a handler"* is this function's visibility rather
 * than a sentence in a comment — and `scripts/proofs/contract.proof.mjs` holds
 * the door with a case that tries to build one from outside.
 */
function asCheckpoint(bytes: ByteImage): Checkpoint {
  return bytes as Checkpoint;
}

/**
 * One registered writer, narrowed to the single command kind it is about to
 * run.
 *
 * ## The correlated-union limit, in the third module to meet it
 *
 * `commandSpecs.ts` and `pdfLibWriter.ts` each carry a `specFor` with the same
 * explanation, and this is the same wall from the registry's side:
 * `this.#writers[spec.writer]` over a generic `K` resolves to the **union** of
 * every registered writer, whose `apply` parameter is then the intersection of
 * a `MupdfSession` and a `ByteImage` — `never`, so nothing can be called. The
 * lookup is correct and the checker cannot see that the index and the session
 * came from the same `command.kind`.
 *
 * It compiled while there was one writer of record, which is why this arrives
 * with the second one rather than having been needed all along.
 *
 * `apply` and `invert` widen to `ByteImage | undefined` here rather than staying
 * conditional, and that is the point of the type: the bus is the component that
 * has to handle **both** shapes, and a signature that hid the difference would
 * push the decision back into a cast at each call. What decides which arrived
 * is {@link writerShapes}, never the value — see {@link CommandBus.execute}.
 *
 * **`undefined` and not `void`**, and the two are not interchangeable here. A
 * live-session `apply` is declared `Promise<void>`, and awaiting one yields
 * `undefined` at runtime — so this is the value that actually arrives rather
 * than a widening. Writing `ByteImage | void` instead is what the first draft
 * did, and `no-invalid-void-type` refused it for a reason worth keeping: `void`
 * in a union means *ignore this*, which is exactly the reading that would let
 * a byte-image writer's result be dropped.
 */
interface WriterFor<K extends CommandKind> {
  serialise(session: WriterSession[WriterOf<K>]): Promise<ByteImage>;
  apply(
    session: WriterSession[WriterOf<K>],
    command: CommandOfKind<K>,
    // OPTIONAL, mirroring `CommandExecution.apply` — this type is the narrowed
    // view of the same member and cannot be narrower than it. What the bus is
    // obliged to pass is decided by `spec.reads` at the call site, not here:
    // `K` is generic in this interface, so the declaration a command made is
    // not available to the signature.
    reads?: PreReadValue,
  ): Promise<ByteImage | undefined>;
  capture(
    session: WriterSession[WriterOf<K>],
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>>;
  invert(
    session: WriterSession[WriterOf<K>],
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<ByteImage | undefined>;
}

/**
 * The one {@link CommandWriter} in existence, and the reason the version
 * counter and the command log have a single writer of record rather than a
 * documented intention (B3).
 *
 * Module-private, like {@link asCheckpoint}'s mint one line above, and for the
 * same reason: a lane entry that wanted to bump or to record would have to
 * write a cast, and a cast is visible in a diff in a way "someone called the
 * method" is not.
 */
const COMMAND_WRITER = 'command-writer' as CommandWriter;

/** A command routed to a writer of record that has no adapter registered. */
export class UnregisteredWriterError extends Error {
  override readonly name = 'UnregisteredWriterError';

  constructor(kind: string, writer: string) {
    super(
      `Command ${kind} is routed to the '${writer}' writer of record, which has no adapter ` +
        'registered on this bus. Nothing was applied and no checkpoint was taken.',
    );
  }
}

/**
 * Undo routed to a writer this document has no session for.
 *
 * Distinct from {@link UnregisteredWriterError}: that one is *no adapter on
 * this bus*, an application-wide state. This one is *this document has no
 * session for that engine*, which is per document and reachable on its own —
 * a document opened by MuPDF whose last command routed to PDFium has one and
 * not the other.
 */
export class MissingWriterSessionError extends Error {
  override readonly name = 'MissingWriterSessionError';

  constructor(kind: string, writer: string) {
    super(
      `Undoing ${kind} needs this document's '${writer}' session, and it has none. Nothing was ` +
        'inverted and the log cursor did not move.',
    );
  }
}

/**
 * How a checkpoint reaches a destination the session supervisor granted.
 *
 * The bus closes over the checkpoint and the document's context, so the
 * supervisor never receives bytes — it receives this, calls it with a path
 * inside the pair it just created, and gets a count back. Identical in shape to
 * what `openEngineSession` does with the canonical image at open, which is the
 * point: a restore is not a second way to build a session.
 */
export type SnapshotWrite = (destination: string) => Promise<number>;

/**
 * How the session supervisor rebuilds a document's sessions from a checkpoint
 * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
 *
 * Implementing this means: create a granted directory pair, call `write` with a
 * path inside it, open the engine on that path, close the session the document
 * had, and hold the new one. All five are the supervisor's — the engine
 * session's owner is the supervisor and not `DocumentService`
 * (`docs/ARCHITECTURE.md`'s amendment log, 2026-08-28).
 *
 * Returns nothing, deliberately. The bus has no use for the new session on this
 * path — there is nothing to invert — and a return value would invite it to
 * start holding one, which is how a bus that holds no per-document state
 * acquires some.
 */
export type CheckpointRestore = (write: SnapshotWrite) => Promise<void>;

/**
 * How the bus obtains and installs a **byte-image** writer's session
 * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## Why a byte-image session is not in `SessionsByWriter`
 *
 * A live-session writer's session is a handle the supervisor holds between
 * commands. A byte-image writer's session **is the document's current bytes**,
 * which no component holds: `main`'s canonical image is what was opened —
 * finding OOOOO-1, measured 2026-08-30 — and the live engine's copy is behind a
 * pipe. So there is nothing for the supervisor to have put in the map, and a
 * map entry would have had to be refreshed after every live-session command,
 * which is the per-command serialise ADR-0032 rejected at 2.00×.
 *
 * ADR-0039's answer is that such a session is minted for one call and never
 * stored, which is also what makes *which bytes win* unaskable rather than
 * answered: a writer that holds nothing between commands cannot hold a
 * competing opinion about the document.
 *
 * ## `current` is the save pipeline's flush, and that is deliberate
 *
 * Composed from the same `DocumentFlush` a save uses, so there is one
 * implementation of *what this document currently is* rather than two (B3a).
 * The bus calls it **only** when the command it is running routes to a
 * byte-image writer — `writerShapes` decides, so an ordinary rotate pays
 * nothing.
 *
 * ## `adopt` is `CheckpointRestore`'s mechanism with a different subject
 *
 * Both mean *rebuild this document's session from bytes I will write*. Undo
 * writes a checkpoint; this writes what the command produced. They are separate
 * members rather than one because the two are wired to the same supervisor call
 * for different reasons, and collapsing them would make a future change to one
 * silently change the other.
 */
export interface ByteImageAccess {
  /** The document's current bytes. The live writer's `serialise`. */
  readonly current: () => Promise<ByteImage>;
  /**
   * Installs new document bytes: rebuilds the live session from them and makes
   * them `main`'s canonical image.
   *
   * Takes a {@link SnapshotWrite} for `CheckpointRestore`'s reason — the bytes
   * go from wherever they are to a granted directory without the supervisor
   * receiving them.
   */
  readonly adopt: (write: SnapshotWrite) => Promise<void>;
}

/**
 * How the bus obtains what a command's `apply` needs and cannot read for
 * itself (ADR-0040's 2026-09-05 extension).
 *
 * ## Why an accessor and not a resolved value
 *
 * {@link ByteImageAccess}' shape, for {@link ByteImageAccess}' reason. The bus
 * calls a member **only** when the command it is running declares it —
 * `spec.reads` decides, so an ordinary rotate pays nothing — and that
 * conditional is only available on this side: `redo` has no command until it
 * has read the log, so a caller resolving eagerly would read an outline for
 * every redo of every kind.
 *
 * ## It keeps `readDestinations` the one reader, and the bus does not learn to
 * read
 *
 * The ADR's constraint, and it is what the indirection buys. `documentCommands`
 * supplies a member that calls the module owning *what are this document's
 * bookmarks*; this file decides **whether** to call it, from the declaration it
 * already reads for the writer. A bus that walked `/Outlines` itself would be
 * the second opinion B3a is about.
 *
 * ## The members are the axis, so a new one cannot arrive unsupplied
 *
 * One member per non-`'none'` member of `CommandReads`, and `#preReadFor`
 * indexes this object with the declared value rather than switching on it. A
 * member added to `PreRead` therefore widens `CommandReads`, and this interface
 * stops being satisfied by every implementer until they supply it — which is
 * the direction that fails safe, against a `switch` whose new arm nothing asks
 * for.
 */
export interface PreReadAccess {
  /** The document's outline, flattened. `readDestinations`, in the lane. */
  readonly outline: () => Promise<PreRead['outline']>;
}

/**
 * Everything the bus may ask a caller to resolve about the document it is
 * running against.
 *
 * ## Two interfaces, intersected — `RegisteredWriter`'s shape and its reason
 *
 * {@link ByteImageAccess} answers to ADR-0039 and {@link PreReadAccess} to
 * ADR-0040's extension, so they are **declared separately** where their
 * arguments live, and intersected here because a caller missing either half is
 * a caller `execute` cannot serve. That is exactly what `commandRouting.ts`
 * says about `RegisteredWriter`: *"declared separately because they answer to
 * different documents … and intersected here because a registration missing
 * either half is a writer the bus cannot use."*
 *
 * ## It is one PARAMETER because the alternative churns every call site
 *
 * `execute` took `(sessions, context, command, bytes)` and the outline would
 * have made it five, editing 34 cases for a value 33 of them must never use —
 * and six more the next time an axis member arrives. A positional list forces
 * every caller to change when any resolver is added; a named bag does not.
 * Measured on `createShellDependencies` two commits ago, where the same shape
 * had been expiring a human-recorded probe once per feature.
 *
 * **`undo` deliberately keeps the narrower parameter.** It calls `invert`,
 * which takes no pre-read (`Invert` is given prior state and nothing else), so
 * widening it would hand a method access it has no way to use. Structural
 * typing means the caller passes the same object either way — the difference is
 * only what each method's signature admits it may reach for.
 */
export type CommandInputs = ByteImageAccess & PreReadAccess;

/**
 * What one execution did, for a caller that needs to know without reading the
 * log.
 *
 * **Generic in the kind**, for `CommandLog.record`'s reason: `LogEntryFor<K>`
 * with an unresolved `K` is assignable to no single member of `LogEntry`, so a
 * non-generic field here forces a cast at the one place that knows the kind.
 * With one command in the union the two were the same type and nothing said so;
 * the second command is what revealed it.
 *
 * The default keeps every existing reader unchanged — `Executed` still means
 * *an entry for some command* where a caller does not care which.
 */
export interface Executed<K extends CommandKind = CommandKind> {
  readonly entry: LogEntryFor<K>;
  /** The version this command produced (ADR-0009 §5). */
  readonly version: DocumentContext['version'];
  /**
   * What recording this entry cost the undo history, if anything (§4).
   *
   * **Required, never optional.** Invariant 18 obliges whoever receives this to
   * tell the user when history was shortened, and an optional field is one a
   * caller can satisfy by not looking. `{ droppedEntries: 0 }` is the ordinary
   * answer and it still has to be read.
   */
  readonly trimmed: LogTrim;
}

/**
 * What undo and redo report for {@link Executed.trimmed}.
 *
 * Neither grows the log: `record` is the only thing that adds an entry, and
 * undo *"never pops"* — it steps the cursor, so `retainedBytes` is identical
 * either side of it. There is therefore nothing to shed, and this is a fact
 * about those two operations rather than a placeholder.
 *
 * Named rather than written inline at both sites, so the claim is stated once
 * and a future operation that *does* grow the log cannot borrow it by copying a
 * literal that looked harmless.
 */
const NO_TRIM: LogTrim = { droppedEntries: 0, droppedBytes: 0 };

/** What one undo or redo did. */
export type Undone = Executed;

/**
 * The bus, and it holds **no per-document state** (ADR-0009's composition
 * decision).
 *
 * It used to own the log as an instance field, which forced a choice between
 * one bus per application — one log across every open document, so undo on one
 * walks another's entries — and one bus per document, which needs a
 * `Map<DocId, bus>` and is therefore get-or-create, minting a bus for a closed
 * `DocId`.
 *
 * Taking the log off it makes the choice unnecessary rather than making it
 * correctly: writers and routing are application-wide because they are the same
 * for every document, and the log arrives from the `DocumentContext` the lane
 * already hands in. One instance, no map, and the log's lifetime is the
 * record's.
 */
export class CommandBus {
  readonly #writers: WriterRegistry;

  constructor(writers: WriterRegistry) {
    this.#writers = writers;
  }

  /**
   * The writer a command routes to, narrowed to that command's kind.
   *
   * The refusal is the one three call sites used to make identically. It is
   * reachable from all of them and for different reasons — `execute` can be
   * handed a command whose writer has no adapter, and `undo`/`redo` can reach a
   * log entry that outlived a registration, since ADR-0009 puts the log on the
   * document's record and the registry on the bus.
   */
  #writerFor<K extends CommandKind>(kind: K, writer: WriterOf<K>): WriterFor<K> {
    const registered = this.#writers[writer];
    if (registered === undefined) throw new UnregisteredWriterError(kind, writer);
    // The one assertion, sound by construction: `writer` is `spec.writer` for
    // this `kind`, so the registry entry is that kind's writer. See
    // {@link WriterFor}.
    return registered as WriterFor<K>;
  }

  /**
   * The session a command runs against — **minted for a byte-image writer,
   * looked up for a live-session one**
   * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
   *
   * ## Why the two halves are not symmetric
   *
   * A live-session writer's session is a handle the supervisor is holding, so
   * absence is a real state and {@link MissingWriterSessionError} is the honest
   * answer. A byte-image writer's session is the document's current bytes,
   * which nobody holds between commands — so there is nothing to be absent, and
   * asking the supervisor for one would find `undefined` every time.
   *
   * ## It branches on the DECLARATION, never on what a session looks like
   *
   * `writerShapes` is the one table that says which shape a writer is, and
   * `WriterShapeOf` is derived from it. The alternative — deciding from the
   * value, since a `MupdfSession` and a `Uint8Array` are distinguishable — puts
   * a second opinion about a writer's shape next to the declaration, and the
   * two would agree until a writer changed shape.
   */
  async #sessionFor<K extends CommandKind>(
    kind: K,
    writer: WriterOf<K>,
    sessions: SessionsByWriter,
    bytes: ByteImageAccess,
  ): Promise<WriterSession[WriterOf<K>]> {
    if (writerShapes[writer] === 'byte-image') {
      // The cast is the same correlation `#writerFor` asserts: `writerShapes`
      // says this writer's session type IS `ByteImage`, and the checker cannot
      // carry that through a generic index.
      return (await bytes.current()) as WriterSession[WriterOf<K>];
    }
    const session = sessions[writer];
    if (session === undefined) throw new MissingWriterSessionError(kind, writer);
    return session;
  }

  /**
   * Installs what a byte-image `apply` produced, and does nothing for a
   * live-session one.
   *
   * ## The order is rebuild first, then replace, and it is invariant 18's
   *
   * `adopt` rebuilds the document's engine session from the new bytes and can
   * fail — a granted directory that cannot be created, an engine that cannot
   * parse what we just wrote. Replacing `main`'s canonical image first and
   * rebuilding after would leave a document whose renderer shows content its
   * engine does not have, which is the two-states failure ADR-0039 exists to
   * prevent. Replacing second means a failed rebuild costs the command and
   * nothing else.
   *
   * ## An `undefined` here is an adapter defect and says so
   *
   * A byte-image writer that returns nothing is the failure mode ADR-0039
   * rejected inferring the shape from: the command would succeed, the log would
   * record it, the version would bump, and the bytes would never move. The
   * declaration says an image was owed, so its absence is named rather than
   * silently treated as *nothing to install*.
   */
  async #install<K extends CommandKind>(
    kind: K,
    writer: WriterOf<K>,
    applied: ByteImage | undefined,
    context: DocumentContext,
    bytes: ByteImageAccess,
  ): Promise<void> {
    if (writerShapes[writer] !== 'byte-image') return;
    if (applied === undefined) {
      throw new Error(
        `${kind} is routed to ${writer}, which \`writerShapes\` declares a byte-image writer, ` +
          `so its \`apply\` owes a new document image and returned nothing. The command has run ` +
          `and its result has been discarded.`,
      );
    }
    await bytes.adopt((destination) => context.writeImage(COMMAND_WRITER, applied, destination));
    context.replaceCanonicalImage(COMMAND_WRITER, applied);
  }

  /**
   * What a command's `apply` is handed beyond its session and itself
   * (ADR-0040's 2026-09-05 extension).
   *
   * ## It INDEXES the access object with the declared value
   *
   * `access[reads]()` rather than `if (reads === 'outline')`. The axis's
   * members and {@link PreReadAccess}' members are the same names by
   * construction — `CommandReads` is derived from `PreRead`'s keys — so a
   * member added to the axis is a compile error at the access object and needs
   * no arm here. A `switch` would be the second routing place `commandSpecs.ts`
   * refuses for the same reason, one axis along.
   *
   * ## Resolved at APPLY time, inside the lane
   *
   * The ADR's constraint, and it is the whole reason this is a call rather than
   * a parameter the caller filled in: a table of contents is almost entirely
   * page numbers, so an outline read when a dialog opened is one taken before
   * whatever the user did next. Read here, it describes the document actually
   * being written.
   */
  async #preReadFor(reads: CommandReads, access: PreReadAccess): Promise<PreReadValue | undefined> {
    if (reads === 'none') return undefined;
    return access[reads]();
  }

  /**
   * Captures, applies, records, bumps — in that order, once.
   *
   * Runs inside the document's lane (§7); the caller supplies the
   * `DocumentContext` that proves it. The version is bumped **after** the
   * document has actually changed, so a failed apply leaves the counter alone
   * and the document is not marked dirty for work that did not happen.
   *
   * ## The SESSION SET is handed over, and the bus picks
   *
   * This took one session until 2026-09-04, resolved by the caller from
   * `declaredCommands[command.kind].writer`. That was a second reading of the
   * routing table in a component that has no other reason to hold one, and
   * `documentCommands.ts`'s own comment on it records that the second command
   * *"was RIGHT that a second command would break something and WRONG about
   * where"*.
   *
   * It is now `undo`'s shape, for `undo`'s stated reason: *"the session set is
   * handed over whole and the bus picks … it keeps the which-engine-owns-this
   * question in the one file that answers it."* That argument never depended on
   * undo having no command; it applied here too and the asymmetry was
   * historical. What made it load-bearing is a writer whose session is not in
   * the set at all — see {@link ByteImageAccess}.
   *
   * @template K
   */
  async execute<K extends CommandKind>(
    sessions: SessionsByWriter,
    context: DocumentContext,
    command: CommandOfKind<K>,
    inputs: CommandInputs,
  ): Promise<Executed> {
    const spec: DeclaredCommands[K] = declaredCommands[command.kind];
    const writer = this.#writerFor(command.kind, spec.writer);
    const session = await this.#sessionFor(command.kind, spec.writer, sessions, inputs);

    // Capture BEFORE apply. Not for tidiness: once `apply` has written, the
    // prior own-state is gone from the document and no later read recovers it.
    //
    // Through the WRITER, not through the spec (ADR-0023 Decision 10). The spec
    // is still where this command's capture is declared; calling it is the
    // writer's job, because a writer whose session lives in an engine host runs
    // it there and one whose session is here runs it here. Nothing about *when*
    // the capture happens moves — that is the line above, and it is §4's.
    const captured = await writer.capture(session, command);

    // What this execution will be recorded as, decided — and the checkpoint
    // taken — STRICTLY BEFORE apply. Deciding first is what keeps the
    // checkpoint in one place: there is no branch after the mutation where a
    // second path could reach for one, and none where a handler could hand one
    // over. Recording happens after, because an entry for work that threw is
    // not a record of anything.
    const entry: LogEntryFor<K> = captured.captured
      ? { kind: 'invertible', command, inverse: captured.prior }
      : {
          kind: 'terminal',
          command,
          // THE ONLY Checkpoint MINT IN THE KERNEL. Taken because capture said
          // prior state could not be recorded — never speculatively.
          checkpoint: asCheckpoint(await writer.serialise(session)),
          reason: captured.reason,
        };

    // RESOLVED AFTER THE CAPTURE AND THE CHECKPOINT, and before the apply. The
    // ordering is not arbitrary: the checkpoint above is the document as it
    // stands, and an outline read after `apply` would describe the document the
    // command produced rather than the one whose pages it is numbering.
    const preRead = await this.#preReadFor(spec.reads, inputs);

    const applied = await writer.apply(session, command, preRead);

    // A BYTE-IMAGE WRITER'S RESULT IS THE DOCUMENT, so installing it is part of
    // applying rather than something a caller does afterwards — and it happens
    // BEFORE the entry is recorded, for the reason the next comment gives about
    // work that threw. A rebuild that fails must leave no log entry behind.
    await this.#install(command.kind, spec.writer, applied, context, inputs);

    // Recorded and counted only after the document actually changed. An entry
    // for work that threw is worse than no entry — undo would reverse a change
    // the document never received.
    //
    // NOT COVERED BY A TEST, and said here rather than left to be assumed: an
    // `apply` that throws where `capture` succeeded is not constructible with
    // the one command that exists, because both validate the same page indices.
    // The reachable neighbour — a checkpoint that fails between them — is
    // covered. Revisit when a second command has an `apply` that can fail on
    // its own.
    context.commandLog(COMMAND_WRITER).record(entry);

    // ENFORCED HERE, because this is the only moment the log grows. §4's budget
    // was consulted at `open` and nowhere else, so checkpoints accumulated for
    // the whole life of a session and the only thing ever refused was the next
    // document — the accounting was right and nothing acted on it.
    //
    // AFTER `record`, deliberately: the entry that pushed the log over is the
    // one the ceiling has to be measured against, and trimming first would
    // leave the log over budget by exactly the checkpoint just taken. That is
    // the off-by-one that makes a cap a suggestion.
    //
    // The bus decides WHEN and never how much — the target is the service's,
    // computed from §9.17's ceiling.
    const trimmed = context.enforceRetention(COMMAND_WRITER);
    return { entry, trimmed, version: context.bumpVersion(COMMAND_WRITER) };
  }

  /**
   * Steps the cursor back and **restores prior state** (ADR-0009 §3).
   *
   * Returns `undefined` at the start of the log — "nothing to undo" is what a
   * UI asks constantly, not an error.
   *
   * Undo bumps the version (§5): it is an applied mutation like any other, and
   * a document undone back to its saved bytes is still marked dirty. That is
   * the conservative direction — `dirty` fails towards prompting rather than
   * towards losing work.
   *
   * ## A terminal entry is restored, and NOTHING is replayed
   *
   * §4 says undo *"restores the nearest checkpoint and replays forward minus
   * the undone command"*, which describes a log carrying **periodic**
   * checkpoints. This one does not carry any: {@link CommandBus.execute} holds
   * the only mint, takes a checkpoint strictly before `apply`, and stores it on
   * the entry for that command alone. `entries` is the applied prefix, so the
   * entry below is the last applied one and its checkpoint is the document's
   * bytes after entries `0 … n−1` and before this one — exactly the state
   * undoing it must produce. The replay set is empty, for every terminal entry,
   * always ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
   *
   * **That argument expires as a compile error rather than silently.**
   * `checkpoint` is a member of the `terminal` variant alone, so a checkpoint
   * stored anywhere else — a periodic one, at the head of a window — needs a
   * type change, and this line stops compiling with it. A mechanism may rest on
   * a property only when its falsification is loud.
   *
   * `sessions` is **not read** on the restore path and is stale afterwards: the
   * supervisor has replaced the session this was called with. Nothing here
   * touches it, and the caller re-reads on its next call.
   *
   * @param restore How the supervisor rebuilds from a checkpoint. Required, not
   *   optional — an optional one is a caller that keeps the old refusal by
   *   passing nothing.
   * @template W
   */
  async undo(
    sessions: SessionsByWriter,
    context: DocumentContext,
    restore: CheckpointRestore,
    bytes: ByteImageAccess,
  ): Promise<Undone | undefined> {
    const log = context.commandLog(COMMAND_WRITER);
    const entry = log.entries.at(-1);
    if (entry === undefined) return undefined;

    if (entry.kind === 'terminal') {
      // THE BYTES DO NOT PASS THROUGH THE SUPERVISOR. It receives a writer and
      // grants a destination; the service moves the checkpoint from the record
      // to that path. That is `writeCanonicalImage`'s property at open, kept
      // without an exception on the undo path.
      //
      // BEFORE the cursor moves, deliberately: a restore that throws must leave
      // the log exactly where it was, or the document and the log disagree
      // about which commands are applied — and the disagreement is silent.
      await restore((destination) =>
        context.writeCheckpoint(COMMAND_WRITER, entry.checkpoint, destination),
      );

      log.undo();
      return { entry, trimmed: NO_TRIM, version: context.bumpVersion(COMMAND_WRITER) };
    }

    const spec = declaredCommands[entry.command.kind];
    // THE WRITER AND THE SESSION ARE BOTH PICKED HERE, because here is where the
    // writer is known. The caller cannot pick either: finding the writer means
    // reading the log, and reading the log needs `COMMAND_WRITER`, which is
    // module-private. This used to take one session and cast it, which put the
    // type's guarantee on the caller having guessed right.
    const writer = this.#writerFor(entry.command.kind, spec.writer);
    const session = await this.#sessionFor(entry.command.kind, spec.writer, sessions, bytes);

    // Through the writer, for `execute`'s reason. The kind travels as its own
    // argument because a recorded inverse does not carry one — see
    // `CommandExecution.invert`.
    const inverted = await writer.invert(session, entry.command.kind, entry.inverse);
    // A BYTE-IMAGE WRITER'S INVERSE PRODUCES A DOCUMENT TOO, and this line has
    // no caller today: every command routed to a byte-image writer is
    // non-invertible, so a `pdf-lib` entry is always `terminal` and returns
    // above. It is here rather than omitted because the branch is reachable by
    // the TYPE — `CommandPrior` could gain a recordable prior state for a
    // byte-image command tomorrow — and the failure it would otherwise produce
    // is the silent one: an undo that runs, bumps the version and discards the
    // document it built.
    await this.#install(entry.command.kind, spec.writer, inverted, context, bytes);

    log.undo();
    return { entry, trimmed: NO_TRIM, version: context.bumpVersion(COMMAND_WRITER) };
  }

  /**
   * Steps the cursor forward and re-applies.
   *
   * **Which path this takes is §3a's declaration doing work**, for the first
   * time. `replay: 'reapply-intent'` re-runs the command, which is only sound
   * because re-running produces the same bytes. A command declaring
   * `replay: 'stored-effect'` — signing, OCR, anything minting random object
   * identifiers — must have its recorded effect re-applied instead, and that
   * path is refused by name rather than silently taking the wrong one.
   *
   * No such command exists yet. The refusal is here because the alternative is
   * a `redo` that quietly re-runs a signature and produces a different
   * document, which is exactly the failure §3a was added ahead of any command
   * to prevent.
   */
  async redo(
    sessions: SessionsByWriter,
    context: DocumentContext,
    inputs: CommandInputs,
  ): Promise<Undone | undefined> {
    const log = context.commandLog(COMMAND_WRITER);
    const entry = log.peekRedo();
    if (entry === undefined) return undefined;

    const spec = declaredCommands[entry.command.kind];

    // §3a's declaration, enforced at COMPILE time rather than by a branch that
    // cannot run. Every command declared today replays by re-running, so a
    // runtime `if (spec.replay !== 'reapply-intent')` is a guard with no
    // reachable caller — lint says so, and a check that cannot fail is the
    // vacuous shape this project keeps deleting.
    //
    // This assignment is the trigger instead: the day any spec declares
    // `replay: 'stored-effect'`, `spec.replay` widens and this line stops
    // compiling. That is the prompt to build stored-effect replay, arriving at
    // the moment the path becomes reachable and not before — the same shape as
    // the advisory register's expiry triggers.
    //
    // It matters because the silent failure is severe: re-running a signature
    // or an OCR pass produces different bytes, which is precisely what §3a was
    // added ahead of any command to prevent.
    const replay: 'reapply-intent' = spec.replay;
    void replay;

    // PICKED HERE, for `undo`'s reason: the writer comes from the log entry, so
    // the caller could not have chosen a session for it.
    const writer = this.#writerFor(entry.command.kind, spec.writer);
    const session = await this.#sessionFor(entry.command.kind, spec.writer, sessions, inputs);

    // RE-RESOLVED, never taken from the log entry, and that is what
    // `replay: 'reapply-intent'` above has just been checked to mean. The entry
    // stores the command's INTENT; the outline is state the document holds, and
    // storing the copy read at execute time would make a redo re-state page
    // numbers the undo in between may have moved. A command whose pre-read data
    // must be preserved verbatim is a `stored-effect` command, and this line
    // stops compiling for it at the assignment above.
    const preRead = await this.#preReadFor(spec.reads, inputs);

    const applied = await writer.apply(session, entry.command, preRead);
    // REACHABLE, unlike `undo`'s: redoing a watermark re-runs it — that is what
    // `replay: 'reapply-intent'` above has just been checked to mean — and the
    // document it produces has to be installed exactly as `execute` installs
    // it. The session it ran against was minted from the document's current
    // bytes a few lines up, so this is the same round trip and not a second
    // mechanism.
    await this.#install(entry.command.kind, spec.writer, applied, context, inputs);

    log.redo();
    return { entry, trimmed: NO_TRIM, version: context.bumpVersion(COMMAND_WRITER) };
  }
}
