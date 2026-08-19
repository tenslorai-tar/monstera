import { type CommandKind, type CommandOfKind } from '@monstera/contract';

import { type Checkpoint, CommandLog, type LogEntry, type LogEntryFor } from './commandLog.js';
import { type DeclaredSpecs, type WriterOf, declaredSpecs } from './commandSpecs.js';
import { type DocumentContext } from './documentService.js';
import { type ByteImage, type EngineWriter, type WriterSession } from './engineSeam.js';

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
 * The engine adapters available to take a checkpoint.
 *
 * **Partial by construction, not by oversight.** The seam declares four writers
 * of record and one has an adapter; a total map could not be built today, and
 * pretending otherwise would mean a placeholder adapter that fails at the native
 * call instead of at registration. A command routed to an unregistered writer is
 * refused by name — see {@link UnregisteredWriterError} — which is the same
 * shape as ADR-0018's update provider registered with nothing behind it.
 */
export type WriterRegistry = {
  readonly [W in keyof WriterSession]?: EngineWriter<WriterSession[W]>;
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

/** What one execution did, for a caller that needs to know without reading the log. */
export interface Executed {
  readonly entry: LogEntry;
  /** The version this command produced (ADR-0009 §5). */
  readonly version: DocumentContext['version'];
}

export class CommandBus {
  readonly #writers: WriterRegistry;
  readonly #log = new CommandLog();

  constructor(writers: WriterRegistry) {
    this.#writers = writers;
  }

  get log(): CommandLog {
    return this.#log;
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
    const captured = await spec.capture(session, command);

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

    await spec.apply(session, command);

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
    this.#log.record(entry);
    return { entry, version: context.bumpVersion() };
  }
}
