import type { CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import type { WriterOf, WriterOfRecord } from './commandDeclarations.js';
import type {
  ByteImage,
  EngineWriter,
  PreReadValue,
  WriterSession,
  WriterShapeOf,
} from './engineSeam.js';

/**
 * **How a command reaches a writer** — the types, with no table and no
 * implementation.
 *
 * ## Why this is a module of its own, and it is ADR-0026's split again
 *
 * These three lived in `commandSpecs.ts`, whose own note explained the choice:
 * *"Declared in this file rather than beside the registry that holds it, so
 * `commandBus.ts` imports from here and nothing imports back: the routing table
 * is what binds a command to a writer, so the type of a usable writer is a
 * statement about routing."* That reasoning is unchanged and this module is
 * where it now lives — a statement about routing, in the file that holds
 * nothing else.
 *
 * What moved them is the second writer of record.
 * [ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)
 * puts `@cantoo/pdf-lib` in `main`, so `pdfLibWriter.ts` must be importable
 * without binding a native library — and it needs {@link CommandExecution} to
 * say what it is. Taking it from `commandSpecs.ts` would have made
 * `commandSpecs → pdfLibWriter → commandSpecs`, which `import-x/no-cycle` fails
 * the build for at any depth, and correctly: the alternative to a cycle is
 * never a suppression.
 *
 * ## Every import here is `import type`, and that is the property
 *
 * `commandDeclarations.ts` states the same rule about itself in stronger terms
 * — *"A value import added to this file re-creates the defect in full"* — and
 * it applies here for the same reason: everything that routes reaches this
 * module, so a value edge from it would be a value edge from all of them. There
 * is nothing to run in this file, which is what makes that easy to keep.
 */

/**
 * The command kinds routed to one writer of record.
 *
 * Derived from the declarations rather than listed beside them, so a command
 * re-routed to a different writer moves in exactly one place. The distributed
 * conditional is what makes it a union of kinds rather than `never`.
 *
 * **Against `commandDeclarations.ts`'s `WriterOf` and not `commandSpecs.ts`'s.**
 * The two resolve to the same literal for every kind — the spec table builds
 * each entry by spreading its declaration — and only one of them is reachable
 * without the native library. Two spellings of one question is the shape B3a is
 * about, and this is the half that is not going to acquire an opinion of its
 * own, since a declaration cannot route differently from itself.
 */
export type KindsRoutedTo<W extends WriterOfRecord> = {
  [K in CommandKind]: WriterOf<K> extends W ? K : never;
}[CommandKind];

/**
 * How a command is executed **against a writer**, rather than by the bus
 * itself (ADR-0023 Decision 10).
 *
 * ## Why this exists at all
 *
 * `CommandBus` used to call `spec.apply(session, command)` directly. That works
 * for exactly as long as the session is in this process. `rotatePages.ts` calls
 * `withDocument(session, work)` whose `work` is a **synchronous**
 * `(document: mupdf.PDFDocument) => T`, and a synchronous callback holding a
 * live native handle cannot be made an RPC — so the moment the session lives in
 * an engine host, a bus that calls the spec has nothing to call it against.
 *
 * Moving the *call* out of the bus leaves the *declaration* where it was: the
 * spec table is still the one place a command's `apply`, `capture` and `invert`
 * are named, and ADR-0009 §6's binding of a spec's `apply` to its declared
 * writer's session type is untouched. A remote implementation sends the command
 * and the host's own local implementation performs the same lookup against its
 * live session — one implementation per command, executed where the session is,
 * rather than two opinions about what a command means (B3a).
 *
 * ## What did NOT move
 *
 * ADR-0009 §4's one code path. The bus still captures before it applies, still
 * decides what the entry will be, and still holds the only `Checkpoint` mint.
 * This interface is *how* a call reaches a session, never *when*.
 *
 * @template W the writer of record. Every member is bound to the kinds routed
 *   to it, so a `pdf-lib` command cannot be executed through the MuPDF writer.
 */
export interface CommandExecution<W extends WriterOfRecord> {
  /**
   * Runs the declared `apply` for `command.kind`.
   *
   * The shape asymmetry is `Apply`'s, restated at the writer because a
   * byte-image writer produces a new image where a live-session writer mutates
   * in place and returns nothing.
   *
   * ## THE ORDER IS `Apply`'S, and that is load-bearing rather than tidy
   *
   * `(session, command, source, reads)` — the same positions `Apply` gives
   * them, so an execution forwards its arguments straight through. `reads`
   * landed first and sat third; `source` arriving one commit later moved it,
   * because the alternative was an execution that TRANSPOSES two optional
   * parameters on the way past.
   *
   * That transposition would have been the one place a silent swap could live.
   * Both values are optional, both are absent for eleven of thirteen commands,
   * and for the twelfth a swapped pair is `undefined` reaching an apply that
   * declared it needed something — a runtime failure a long way from its cause.
   * Keeping one order everywhere makes the question unaskable (B5).
   *
   * ## `reads` and `source` are OPTIONAL here and required by the `Apply` they
   * reach
   *
   * ADR-0040's 2026-09-05 extension: a command declaring `reads: 'outline'`
   * has a three-parameter `Apply`, and the bus resolves the value before
   * calling. This interface cannot say *which* commands those are — `K` is the
   * kinds routed to `W`, not one kind — so the parameter is optional and the
   * obligation to supply it lives at the one place that knows: the bus reads
   * `spec.reads` and resolves exactly when the declaration says to.
   *
   * **The optionality is what makes this a one-line change rather than four.**
   * A function that ignores a parameter is assignable to a signature that
   * passes one, so `remoteMupdfExecution`, the host's dispatch and
   * `composition.ts`' live writer keep compiling untouched — the same
   * bivariance ADR-0040's correction records as the `sources` axis's limit,
   * here working for us rather than against us.
   *
   * It is also why this parameter is **not** a guard. Nothing stops a writer
   * dropping it; what makes a TOC's numbers right is `pageToc.test.ts`, which
   * is where the wired-tools rule already puts the burden.
   */
  apply<K extends KindsRoutedTo<W>>(
    session: WriterSession[W],
    command: CommandOfKind<K>,
    source?: WriterSession[W],
    reads?: PreReadValue,
  ): WriterShapeOf[W] extends 'byte-image' ? Promise<ByteImage> : Promise<void>;

  /** Runs the declared `capture` for `command.kind`, before any apply. */
  capture<K extends KindsRoutedTo<W>>(
    session: WriterSession[W],
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>>;

  /**
   * Runs the declared `invert` for `kind`.
   *
   * Takes the kind explicitly, and that asymmetry with {@link apply} is real
   * rather than an oversight: a command carries its own `kind` and a recorded
   * inverse does not, so the kind has to travel separately — over a pipe as
   * much as across this call.
   */
  invert<K extends KindsRoutedTo<W>>(
    session: WriterSession[W],
    kind: K,
    inverse: CommandPrior[K],
  ): WriterShapeOf[W] extends 'byte-image' ? Promise<ByteImage> : Promise<void>;
}

/**
 * One writer of record, **as `CommandBus` actually calls it**: run a command
 * against a session, and produce that session's bytes for a checkpoint.
 *
 * The two halves are declared separately because they answer to different
 * documents — `EngineWriter` is ADR-0009 §8's seam, {@link CommandExecution} is
 * ADR-0023 Decision 10's — and intersected here because a registration missing
 * either half is a writer the bus cannot use.
 *
 * ## Why this is `Pick<…, 'serialise'>` and not the whole of `EngineWriter`
 *
 * It was the whole of it, and the excess is what made the one writer that has
 * to be remote unregistrable
 * ([ADR-0030](../../../docs/DECISIONS/0030-a-remote-writer-does-not-open-from-an-image.md)
 * Decision 1). `open(image)` takes the document's bytes; the route the engine
 * host opens through takes a **path**, decided twice in ADR-0023 (Decisions 10
 * and 14). So the intersection demanded a member no remote writer can honour —
 * and demanded it for nothing, because the bus never calls it.
 *
 * The bus calls `capture`, `apply`, `invert` and — on the terminal branch,
 * when prior state cannot be recorded — `serialise`. That is this type.
 *
 * `open` and `close` did not move anywhere: they are still `EngineWriter`'s,
 * still right for a byte-image writer whose `TSession` *is* the image, and
 * still the supervisor's business for a live-session one. What changed is that
 * a **registration** stopped requiring a session's whole life from a component
 * that only runs commands against one.
 */
export type RegisteredWriter<W extends WriterOfRecord> = Pick<
  EngineWriter<WriterSession[W]>,
  'serialise'
> &
  CommandExecution<W>;
