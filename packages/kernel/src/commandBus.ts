// VALUE IMPORTS FROM THE CONTRACT, and the only ones here. `sourceIdsOf`
// answers which documents a payload names and `targetVersionOf` which version
// it was composed against — both questions about the payload, which is the
// contract's and not this file's (ADR-0040 Decision 4, ADR-0041 Decision 3). The
// contract imports nothing but `zod` and `@monstera/shared`, so this reaches no
// engine.
import {
  type CommandKind,
  type CommandOfKind,
  sourceIdsOf,
  targetVersionOf,
} from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

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
  type CommandDeclaration,
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
  type CommandTargets,
  type PreReadAccess,
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
    // BOTH OPTIONAL AND IN `Apply`'S ORDER, mirroring `CommandExecution.apply`
    // — this type is the narrowed view of the same member and cannot be
    // narrower than it. What the bus is obliged to pass is decided by
    // `spec.sources` and `spec.reads` at the call site, not here: `K` is
    // generic in this interface, so the declaration a command made is not
    // available to the signature.
    //
    // The order matters more than the optionality does. Two optional parameters
    // of different types, absent for almost every command, are exactly the pair
    // a transposition hides in — so every declaration of this member spells
    // them `(source, reads)` and nothing anywhere reorders them.
    source?: WriterSession[WriterOf<K>],
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
 * One member per non-`'none'` member of `CommandReads`. **The type and its
 * members moved to `engineSeam.ts` on 2026-09-11** (ADR-0051): a pre-read may
 * now take an argument, so the expression that builds that argument lives on the
 * command's declaration — and `commandDeclarations.ts` needs this type to
 * declare one, while the seam cannot import the declarations back.
 *
 * What the move does not change is the property this section was written for: a
 * member added to `PreReadKinds` widens `CommandReads` and stops every
 * implementer of the access object compiling until it supplies one, which is the
 * direction that fails safe against a `switch` whose new arm nothing asks for.
 *
 * What it does change is who indexes. `#preReadFor` used to index this object
 * with the declared value; the declaration's own `read` expression does it now,
 * and the bus still decides only **whether** to call it. A member's signature is
 * its own, so `access.outline(page)` and `access.ocr()` are both compile errors —
 * which is why the indexing could not stay here: an indexed call over a union of
 * members with different arguments is one TypeScript cannot correlate, and the
 * spellings that make it compile are a cast or a widened parameter.
 */
/**
 * The sessions of the other documents a command names, resolved by the caller
 * (ADR-0040 Decision 3).
 *
 * ## A MAP, and deliberately not a lookup function
 *
 * The ADR is explicit: *"The bus does not gain a document index … a lookup
 * function here would be that index arriving through a callback."* The bus has
 * never been able to find a document, and that is what keeps it a router rather
 * than a second `DocumentService`.
 *
 * This is the one place that reasoning differs from {@link PreReadAccess}'
 * next door, and the difference is real rather than an inconsistency: a
 * pre-read is a *value about the document the bus is already holding*, so an
 * accessor costs nothing and buys laziness. A source session is *a different
 * document*, and being handed one resolved is exactly what stops this file
 * learning to resolve documents at all.
 *
 * ## Keyed by `DocId`, so a transposition is a lookup miss and not a wrong merge
 *
 * Both sessions in a merge are `MupdfSession`, so nothing in the type system
 * separates target from source — `engineSeam.ts` says so at `Apply`. Keying by
 * id rather than by role means the bus never has to decide which is which: it
 * looks up the id the command named and passes the answer positionally.
 */
export type CommandSources = ReadonlyMap<DocId, SessionsByWriter>;

/**
 * A command named a document whose sessions were not handed over.
 *
 * ADR-0040 Decision 3: *"An id the map does not carry is
 * `MissingWriterSessionError`'s sibling and is refused by name, for the same
 * reason: a command naming a document that closed between dispatch and
 * execution is an ordinary race, not a defect."*
 *
 * So this is a refusal rather than a throw at a cast, and it names the id — a
 * merge against a tab the user closed mid-dialog is the reachable path, and the
 * message has to let someone tell that apart from a routing mistake.
 */
/**
 * A command named existing state at a version the document has moved past.
 *
 * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 * Decision 2, and the range transport's rule at `docs/ARCHITECTURE.md:305` on a
 * different noun: a stale offset answered from new bytes builds a document out
 * of two versions, and a stale index answered from a new walk removes an
 * annotation out of two of them.
 *
 * **An ordinary race, not a defect** — `MissingSourceSessionError`'s framing.
 * A renderer holding a list from before an undo is exactly the reachable path,
 * and the surface's answer is to re-read and let the person look again. So both
 * versions are named: without them the message cannot tell *the document moved*
 * from *this renderer never held a version at all*.
 */
export class StaleTargetError extends Error {
  constructor(
    readonly kind: CommandKind,
    readonly named: DocVersion,
    readonly current: DocVersion,
  ) {
    super(
      `${kind} names state read at version ${String(named)} and this document is at ` +
        `${String(current)}. The answer it points into has been replaced, so the index in its ` +
        `payload is arithmetic that would still land somewhere. Re-read and try again.`,
    );
    this.name = 'StaleTargetError';
  }
}

export class MissingSourceSessionError extends Error {
  constructor(
    readonly kind: CommandKind,
    readonly source: DocId,
  ) {
    super(
      `${kind} names document ${source} as a source, and no sessions for it were handed to the ` +
        `bus. Either that document was closed between dispatch and execution, or its caller did ` +
        `not resolve it.`,
    );
    this.name = 'MissingSourceSessionError';
  }
}

/**
 * Everything the bus may ask a caller to resolve about the document it is
 * running against.
 *
 * ## Two interfaces, intersected — `RegisteredWriter`'s shape and its reason
 *
 * {@link ByteImageAccess} answers to ADR-0039, {@link PreReadAccess} to
 * ADR-0040's extension and {@link SourceSessions} to ADR-0040 Decision 3, so
 * they are **declared separately** where their arguments live, and intersected
 * here because a caller missing any of them is a caller `execute` cannot serve.
 * That is exactly what `commandRouting.ts` says about `RegisteredWriter`:
 * *"declared separately because they answer to different documents … and
 * intersected here because a registration missing either half is a writer the
 * bus cannot use."*
 *
 * **The third member is the one that proved the shape.** It arrived one commit
 * after the second, and it cost no call site anything: a caller that already
 * built this bag gains a field, where a fourth positional parameter would have
 * edited every `execute` in the tree again. That is the measured prediction
 * below coming true rather than a claim about it.
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
export type CommandInputs = ByteImageAccess & PreReadAccess & SourceSessions;

/**
 * The other documents' sessions, resolved (ADR-0040 Decision 3).
 *
 * Its own interface rather than a bare field on {@link CommandInputs}, so the
 * three things a caller resolves each name the document that asked for them.
 */
export interface SourceSessions {
  /**
   * Sessions for every document the command names, keyed by `DocId`.
   *
   * **Empty for all but one command**, and required anyway. An optional field
   * is one a caller satisfies by not looking, which for a merge means the
   * refusal arrives as `undefined` reaching an apply rather than as
   * {@link MissingSourceSessionError} naming the id.
   */
  readonly sources: CommandSources;
}

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
   * ## IT CALLS THE DECLARATION'S OWN EXPRESSION, and indexes nothing
   *
   * `access[reads]()` until 2026-09-11, which was right while every member took
   * no argument. A pre-read may now be parameterised by the command (ADR-0051),
   * and the expression that turns one into the other is declared beside `reads` —
   * so this method decides **whether** a pre-read is resolved and never what it
   * is, which is the same division the indexing enforced.
   *
   * The branch is on `read`, not on `reads === 'none'`, and they are the same
   * question by construction: `ReadRouting`'s two arms are *`'none'` with no
   * resolver* and *a member with one*, so neither can be written without the
   * other.
   *
   * ## Resolved at APPLY time, inside the lane
   *
   * The ADR's constraint, and it is the whole reason this is a call rather than
   * a parameter the caller filled in: a table of contents is almost entirely
   * page numbers, so an outline read when a dialog opened is one taken before
   * whatever the user did next. Read here, it describes the document actually
   * being written. Sharper for a page-level pre-read than for a document-level
   * one — a recognition read before the lane was entered would describe a page
   * another command may since have rotated.
   */
  async #preReadFor<K extends CommandKind>(
    spec: DeclaredCommands[K],
    command: CommandOfKind<K>,
    access: PreReadAccess,
  ): Promise<PreReadValue | undefined> {
    // THE CAST NAMES A CORRELATION THE CHECKER CANNOT CARRY, and it is
    // `localPdfLibExecution`'s cast one type along — the same shape, for the same
    // reason, at the one place the two views of the table meet.
    //
    // At a DECLARATION the resolver's parameter is `CommandOfKind<K>` for that
    // command's own kind, which is the whole point: the author writes
    // `command.page` and the checker holds them to it. A reader holding an
    // unresolved `K` sees the table as a union over 36 kinds, and TypeScript
    // cannot correlate the member it indexed with the command it was given — the
    // limit ADR-0040's correction already recorded for `Apply`, one type along.
    //
    // It is sound because of the line that produced `spec`: the declaration was
    // looked up with **this command's own kind**, in `execute` and in `redo`
    // alike. A guard here would be a check that cannot fail; what would make it
    // fail is a lookup by some other kind, and there is no such lookup.
    const resolve = spec as CommandDeclaration<CommandKind>;
    if (resolve.read === undefined) return undefined;
    return resolve.read(access, command);
  }

  /**
   * The session a command's `apply` receives for the OTHER document it names
   * (ADR-0040 Decisions 3 and 4).
   *
   * ## It branches on the DECLARATION, never on the payload
   *
   * `#sessionFor`'s rule one axis along. `declaredCommands[kind].sources` is
   * what says a command needs a second session; the presence of a `DocId` in
   * the payload is a different statement, and Decision 4 is explicit that
   * inferring one from the other is the partial reimplementation B3a is about.
   *
   * So a `'none'` command resolves nothing even if its payload happens to carry
   * an id, and a `'one'` command whose payload names none is a defect that
   * surfaces here rather than as an `undefined` handed to an apply.
   *
   * ## `sourceIdsOf` is the CONTRACT's answer
   *
   * Which ids a payload names is a question about the payload, and the payload
   * is the contract's. This file asks it rather than reading the fields, so a
   * command that gains a second-document field is added in one place.
   */
  /**
   * Refuses a command whose payload names state from an earlier version.
   *
   * ## It branches on the DECLARATION, never on the payload
   *
   * `#sourceSessionFor`'s rule on the third axis, and the same argument:
   * `declaredCommands[kind].targets` is what says a command's meaning depends on
   * the document not having moved. A payload that happens to carry a field
   * called `version` is a different statement — one could carry a version it
   * means to *write*, and inferring the rule from the field is the partial
   * reimplementation B3a is about.
   *
   * So a `'none'` command is not checked even if its payload has a version, and
   * a command declaring `'annotation'` whose payload carries none is a
   * registration defect that surfaces here rather than as an `undefined`
   * silently comparing equal to nothing.
   *
   * ## `targetVersionOf` is the CONTRACT's answer
   *
   * Which version a payload names is a question about the payload, and the
   * payload is the contract's. This file asks rather than reading the field, so
   * the second command to name existing state is added in one place.
   */
  #refuseIfStale<K extends CommandKind>(
    command: CommandOfKind<K>,
    targets: CommandTargets,
    current: DocVersion,
  ): void {
    if (targets === 'none') return;

    const named = targetVersionOf(command);
    if (named === undefined) {
      throw new Error(
        `${command.kind} declares targets: '${targets}' and its payload names no version. The ` +
          `declaration and the contract's targetVersionOf disagree, which is a registration ` +
          `defect rather than a race.`,
      );
    }
    if (named !== current) throw new StaleTargetError(command.kind, named, current);
  }

  #sourceSessionFor<K extends CommandKind>(
    command: CommandOfKind<K>,
    sources: CommandSources,
  ): WriterSession[WriterOf<K>] | undefined {
    const kind: CommandKind = command.kind;
    if (declaredCommands[kind].sources === 'none') return undefined;

    const named = sourceIdsOf(command);
    const source = named[0];
    if (source === undefined) {
      throw new Error(
        `${kind} declares sources: 'one' and its payload names no document. The declaration and ` +
          `the contract's sourceIdsOf disagree, which is a registration defect rather than a race.`,
      );
    }

    const held = sources.get(source);
    const session = held?.[declaredCommands[kind].writer];
    if (session === undefined) throw new MissingSourceSessionError(kind, source);

    // The same correlation `#sessionFor` asserts and for the same reason: the
    // session was looked up under this command's own declared writer, and the
    // checker cannot carry that through a generic index.
    return session as WriterSession[WriterOf<K>];
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

    // REFUSED FIRST, BEFORE ANYTHING IS OBTAINED OR READ (ADR-0041 Decision 2).
    //
    // Ordering is the whole of it. The capture below serialises the document for
    // a terminal entry, so a check placed after it would pay a full checkpoint
    // to refuse — and worse, a check placed after `apply` would not be a check
    // at all. This is the first line for the same reason the capture is before
    // the apply: once the next step has run, the thing being protected is gone.
    this.#refuseIfStale(command, spec.targets, context.version);

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

    // RESOLVED AFTER THE CAPTURE AND BEFORE THE APPLY. The ordering that matters
    // is *before the apply*: a pre-read taken afterwards would describe the
    // document the command produced rather than the one it is reading.
    //
    // It sits AHEAD of the entry below — it was after it until 2026-09-11 — so
    // the entry can carry it (ADR-0051 Decision 2). Nothing about the checkpoint
    // moves by that: a pre-read is a read, so the document it serialises is the
    // same document either way.
    const preRead = await this.#preReadFor(spec, command, inputs);

    // What this execution will be recorded as, decided — and the checkpoint
    // taken — STRICTLY BEFORE apply. Deciding first is what keeps the
    // checkpoint in one place: there is no branch after the mutation where a
    // second path could reach for one, and none where a handler could hand one
    // over. Recording happens after, because an entry for work that threw is
    // not a record of anything.
    //
    // `read` IS THE EFFECT A STORED-EFFECT REPLAY RE-APPLIES, and it is stored
    // only for a command whose replay may not read again (ADR-0051 Decision 2).
    // For a `reapply-intent` command it is `undefined`, which is the truthful
    // value rather than a saving: `generateToc`'s outline is document-scaled, and
    // a copy of every bookmark per entry for a value redo must re-read anyway is
    // the retention rule read backwards.
    const stored = spec.replay === 'stored-effect' ? preRead : undefined;
    const entry: LogEntryFor<K> = captured.captured
      ? { kind: 'invertible', command, inverse: captured.prior, read: stored }
      : {
          kind: 'terminal',
          command,
          // THE ONLY Checkpoint MINT IN THE KERNEL. Taken because capture said
          // prior state could not be recorded — never speculatively.
          checkpoint: asCheckpoint(await writer.serialise(session)),
          reason: captured.reason,
          read: stored,
        };

    // RESOLVED BEFORE THE APPLY AND AFTER THE CHECKPOINT, for the same reason
    // the pre-read is: the checkpoint has to be the target as it stands. It is
    // a map lookup rather than a read, so nothing about the source can change
    // between here and the call.
    const source = this.#sourceSessionFor(command, inputs.sources);

    const applied = await writer.apply(session, command, source, preRead);

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
  /**
   * Which documents the next redo would name, so its caller can resolve them.
   *
   * ## Why this exists, and why it is not the index ADR-0040 refuses
   *
   * Decision 3 has the caller resolve sessions and hand them over, which works
   * for `execute` because the caller holds the command. **`redo` does not** —
   * the bus reads the log to find what to re-apply, so at the moment the caller
   * must build the map it does not know which ids to build it for. The ADR did
   * not consider redo, and this is the gap being closed rather than a decision
   * being reinterpreted.
   *
   * The two available shapes are: hand the bus a lookup function, or have the
   * bus say what it is about to do. The first is precisely what Decision 3
   * rejects — *"a lookup function here would be that index arriving through a
   * callback"*. This is the second, and it moves nothing: the bus still cannot
   * find a document, and resolution still happens in the one component that
   * can.
   *
   * ## It answers ids, never sessions
   *
   * A `DocId` is a name the renderer already holds. Answering `SessionsByWriter`
   * would mean the bus had resolved something, which is the line this keeps.
   *
   * Empty when there is nothing to redo, and empty for every command that names
   * no second document — so a caller may pass its answer straight to
   * {@link redo} without asking whether it needed to.
   */
  pendingRedoSources(context: DocumentContext): readonly DocId[] {
    const entry = context.commandLog(COMMAND_WRITER).peekRedo();
    if (entry === undefined) return [];
    return sourceIdsOf(entry.command);
  }

  async redo(
    sessions: SessionsByWriter,
    context: DocumentContext,
    inputs: CommandInputs,
  ): Promise<Undone | undefined> {
    const log = context.commandLog(COMMAND_WRITER);
    const entry = log.peekRedo();
    if (entry === undefined) return undefined;

    const spec = declaredCommands[entry.command.kind];

    // PICKED HERE, for `undo`'s reason: the writer comes from the log entry, so
    // the caller could not have chosen a session for it.
    const writer = this.#writerFor(entry.command.kind, spec.writer);
    const session = await this.#sessionFor(entry.command.kind, spec.writer, sessions, inputs);

    // §3a's DECLARATION DECIDING, and this is the branch that replaced the
    // compile-time trigger that produced it (ADR-0051 Decision 2).
    //
    // Until 2026-09-11 this read `const replay: 'reapply-intent' = spec.replay`,
    // a guard written in 2026-09-04 with its own instructions: *the day any spec
    // declares `replay: 'stored-effect'`, this line stops compiling. That is the
    // prompt to build stored-effect replay, arriving at the moment the path
    // becomes reachable and not before.* `ocrPage` declared it and the line
    // stopped compiling, which is the first expiring claim in this repository to
    // fire as designed rather than be found stale.
    //
    // `reapply-intent` RE-RESOLVES, and that is the axis doing work: the entry
    // stores the command's INTENT, an outline is state the document holds, and a
    // stored copy would make a redo re-state page numbers the undo in between may
    // have moved.
    //
    // `stored-effect` re-applies the value the entry kept, because re-reading it
    // is exactly what a non-reproducible command may not do: recognition costs
    // 3.8–4.4 s per page again, and after a model or engine upgrade between the
    // undo and the redo it answers differently — a redone document that differs
    // from the one that was undone, which §3a exists ahead of any command to
    // prevent.
    const preRead =
      spec.replay === 'stored-effect'
        ? entry.read
        : await this.#preReadFor(spec, entry.command, inputs);
    // RE-RESOLVED like the pre-read, and for a sharper version of its reason:
    // the log entry holds the source's `DocId`, not its session, so a redo runs
    // against whatever session that document has NOW. A stored session handle
    // would be one for a document that may have been closed and reopened, which
    // is the stale-handle failure `documentCommands` resolves inside the lane
    // to avoid.
    const source = this.#sourceSessionFor(entry.command, inputs.sources);

    const applied = await writer.apply(session, entry.command, source, preRead);
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
