import { type CommandKind, type CommandOfKind } from '@monstera/contract';

import { type Checkpoint, type LogEntry, type LogEntryFor } from './commandLog.js';
import {
  type DeclaredSpecs,
  type RegisteredWriter,
  type WriterOf,
  declaredSpecs,
} from './commandSpecs.js';
import { type CommandWriter, type DocumentContext } from './documentService.js';
import { type ByteImage, type WriterSession } from './engineSeam.js';

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
 * Undo reached a terminal entry, whose reversal is a checkpoint restore.
 *
 * Named rather than attempted. §4's answer — restore the nearest checkpoint and
 * replay forward minus the undone command — means **opening a new session from
 * those bytes**, and who then owns the old session is `DocumentService`'s
 * question, not this bus's. Returning a wrong document quietly would be the
 * worse half of that choice.
 */
export class CheckpointRestoreNotBuiltError extends Error {
  override readonly name = 'CheckpointRestoreNotBuiltError';

  constructor(kind: string, reason: string) {
    super(
      `Undoing ${kind} needs a checkpoint restore, which is not built. The entry is terminal ` +
        `because prior state could not be recorded: ${reason}. Nothing was changed.`,
    );
  }
}

/** What one execution did, for a caller that needs to know without reading the log. */
export interface Executed {
  readonly entry: LogEntry;
  /** The version this command produced (ADR-0009 §5). */
  readonly version: DocumentContext['version'];
}

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
    const spec: DeclaredSpecs[K] = declaredSpecs[command.kind];
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
    return { entry, version: context.bumpVersion(COMMAND_WRITER) };
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
   * @template W
   */
  async undo(
    session: WriterSession[keyof WriterSession],
    context: DocumentContext,
  ): Promise<Undone | undefined> {
    const log = context.commandLog(COMMAND_WRITER);
    const entry = log.entries.at(-1);
    if (entry === undefined) return undefined;

    if (entry.kind === 'terminal') {
      // Refused rather than half-done. §4's answer is to restore the nearest
      // checkpoint and replay forward, and restoring means opening a NEW
      // session from those bytes — which is a question about who owns the
      // session, not about this bus. Named, so the gap is a message rather
      // than a wrong document.
      throw new CheckpointRestoreNotBuiltError(entry.command.kind, entry.reason);
    }

    const spec = declaredSpecs[entry.command.kind];
    const writer = this.#writers[spec.writer];
    if (writer === undefined) {
      // The same refusal `execute` gives, and it is reachable independently: a
      // log can outlive the registration that produced it, since ADR-0009 puts
      // the log on the document's record and the registry on the bus. Undo
      // through a writer that is no longer registered would otherwise be a
      // property access on `undefined` at the moment a user asked to undo.
      throw new UnregisteredWriterError(entry.command.kind, spec.writer);
    }

    // Through the writer, for `execute`'s reason. The kind travels as its own
    // argument because a recorded inverse does not carry one — see
    // `CommandExecution.invert`.
    await writer.invert(
      session as WriterSession[WriterOf<typeof entry.command.kind>],
      entry.command.kind,
      entry.inverse,
    );

    log.undo();
    return { entry, version: context.bumpVersion(COMMAND_WRITER) };
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
    session: WriterSession[keyof WriterSession],
    context: DocumentContext,
  ): Promise<Undone | undefined> {
    const log = context.commandLog(COMMAND_WRITER);
    const entry = log.peekRedo();
    if (entry === undefined) return undefined;

    const spec = declaredSpecs[entry.command.kind];

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

    await writer.apply(
      session as WriterSession[WriterOf<typeof entry.command.kind>],
      entry.command,
    );

    log.redo();
    return { entry, version: context.bumpVersion(COMMAND_WRITER) };
  }
}
