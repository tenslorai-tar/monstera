import type { CommandKind, CommandOfKind } from '@monstera/contract';

import type { Checkpoint, LogEntryFor, LogTrim } from './commandLog.js';
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
import type { ByteImage, SessionsByWriter, WriterSession } from './engineSeam.js';

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
   * Captures, applies, records, bumps — in that order, once.
   *
   * Runs inside the document's lane (§7); the caller supplies the
   * `DocumentContext` that proves it. The version is bumped **after** the
   * document has actually changed, so a failed apply leaves the counter alone
   * and the document is not marked dirty for work that did not happen.
   *
   * @template W
   */
  async execute<K extends CommandKind>(
    session: WriterSession[WriterOf<K>],
    context: DocumentContext,
    command: CommandOfKind<K>,
  ): Promise<Executed> {
    const spec: DeclaredCommands[K] = declaredCommands[command.kind];
    const writer = this.#writers[spec.writer];
    if (writer === undefined) {
      throw new UnregisteredWriterError(command.kind, spec.writer);
    }

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

    await writer.apply(session, command);

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
    const writer = this.#writers[spec.writer];
    if (writer === undefined) {
      // The same refusal `execute` gives, and it is reachable independently: a
      // log can outlive the registration that produced it, since ADR-0009 puts
      // the log on the document's record and the registry on the bus. Undo
      // through a writer that is no longer registered would otherwise be a
      // property access on `undefined` at the moment a user asked to undo.
      throw new UnregisteredWriterError(entry.command.kind, spec.writer);
    }

    // THE SESSION IS PICKED HERE, because here is where the writer is known.
    // The caller cannot pick it: finding the writer means reading the log, and
    // reading the log needs `COMMAND_WRITER`, which is module-private. This
    // used to take one session and cast it, which put the type's guarantee on
    // the caller having guessed right.
    const session = sessions[spec.writer];
    if (session === undefined) {
      // The same shape `MissingSessionError` names one layer up, reachable
      // independently: a document can hold a session for the writer that opened
      // it and not for the one its last command routed to.
      throw new MissingWriterSessionError(entry.command.kind, spec.writer);
    }

    // Through the writer, for `execute`'s reason. The kind travels as its own
    // argument because a recorded inverse does not carry one — see
    // `CommandExecution.invert`.
    //
    // NO CAST. There was one here, and lint now reports it as unnecessary,
    // which is the type change of 2026-08-28 confirming itself: picking the
    // session out of the set at the point the writer is known produces the
    // right type, where taking one session and asserting it was the type's
    // guarantee being delegated to whoever called.
    await writer.invert(session, entry.command.kind, entry.inverse);

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

    const writer = this.#writers[spec.writer];
    if (writer === undefined) {
      throw new UnregisteredWriterError(entry.command.kind, spec.writer);
    }

    // PICKED HERE, for `undo`'s reason: the writer comes from the log entry, so
    // the caller could not have chosen a session for it.
    const session = sessions[spec.writer];
    if (session === undefined) {
      throw new MissingWriterSessionError(entry.command.kind, spec.writer);
    }

    // No cast, for `undo`'s reason.
    await writer.apply(session, entry.command);

    log.redo();
    return { entry, trimmed: NO_TRIM, version: context.bumpVersion(COMMAND_WRITER) };
  }
}
