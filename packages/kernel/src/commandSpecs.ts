import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import {
  type Invertibility,
  type Reproducibility,
  type WriterOfRecord,
  declaredCommands,
} from './commandDeclarations.js';
// FOUR SPECIFIERS FEWER since the routing types moved: `ByteImage`,
// `EngineWriter`, `WriterSession` and `WriterShapeOf` were named only by
// `CommandExecution` and `RegisteredWriter`, which now live in
// `commandRouting.ts`. Their removal is what says the move was clean rather
// than a re-export with the old file still doing the work.
import type { Apply, Capture, Invert, MupdfSession } from './engineSeam.js';
import {
  applySetLayerVisibility,
  captureSetLayerVisibility,
  invertSetLayerVisibility,
} from './layers.js';
import {
  applyDeletePages,
  applyDuplicatePage,
  applyMovePage,
  captureDeletePages,
  captureDuplicatePage,
  captureMovePage,
  invertDeletePages,
  invertDuplicatePage,
  invertMovePage,
  applySwapPages,
  captureSwapPages,
  invertSwapPages,
  applyInsertBlankPage,
  captureInsertBlankPage,
  invertInsertBlankPage,
} from './pageOrder.js';
import { applyCropPages, captureCropPages, invertCropPages } from './pageCrop.js';
import type { CommandExecution } from './commandRouting.js';
import { pdfLibSpecs } from './pdfLibWriter.js';
import { applyRotatePages, captureRotatePages, invertRotatePages } from './rotatePages.js';

/**
 * What every command declares about itself, and the table that routes them.
 *
 * ADR-0009 §6 and §3a. Two things are made structural here:
 *
 * 1. **The table cannot be partial.** It is a mapped type over the command kind
 *    union, so omitting a kind does not compile and adding an unrouted one does
 *    not compile. The same mechanism that already makes the IPC `Handlers`
 *    exhaustive.
 * 2. **Neither axis can be left undeclared**, and neither can be declared
 *    without naming its consequence — see {@link Invertibility} and
 *    {@link Reproducibility}.
 *
 * §3a is explicit that the reproducibility axis exists **before any command
 * does**, because retrofitting it rewrites the log rather than extending it.
 * That is why this file lands ahead of anything that can execute.
 */

// `WriterOfRecord`, `Invertibility` and `Reproducibility` live in
// `commandDeclarations.ts` (ADR-0026) — they describe what a command IS, and
// this file is what it DOES. Re-exported at the bottom so one definition serves
// both.

/**
 * The writer and its `apply`, as **one indivisible choice**.
 *
 * §6 requires `apply` to be bound to the session type of its declared writer,
 * so a B3 violation is a type error where it is authored rather than a review
 * comment. A plain `{ writer: WriterOfRecord; apply: ... }` cannot express that
 * — the two fields would be independent, and a spec could declare `mupdf` and
 * supply an `apply` taking a PDFium session.
 *
 * A distributed mapped type collapsed to its own union is what binds them: for
 * each writer there is exactly one member, carrying that writer's literal type
 * and the `Apply` derived from it. Choosing the `writer` therefore chooses the
 * `apply` signature, including which **shape** it has — a byte-image writer's
 * `apply` returns bytes, a live-session writer's returns void (§8).
 */
export type WriterBinding<K extends CommandKind> = {
  readonly [W in WriterOfRecord]: {
    readonly writer: W;
    readonly apply: Apply<W, K>;
    readonly capture: Capture<W, K>;
    readonly invert: Invert<W, K>;
  };
}[WriterOfRecord];

/**
 * Everything one command kind declares about itself.
 *
 * **`capture` is deliberately absent**, and its absence is a decision rather
 * than an omission. ADR-0009's 2026-08-19 decision settles the *writer* — the
 * bus captures prior state before `apply`, never a handler — and leaves the
 * *type* to the log, because a capture's return shape is the inverse's shape
 * and that is §4's two-shape union. `captureRotatePages` is exported from its
 * own module for the bus to bind when it lands; a command added before then
 * must export one too.
 */
export type CommandSpec<K extends CommandKind> = {
  readonly kind: K;
} & WriterBinding<K> &
  Invertibility &
  Reproducibility;

/**
 * Re-exported, not re-declared.
 *
 * These three moved to `commandDeclarations.ts` with the table that uses them
 * (ADR-0026). They are named here because this file's own `CommandSpec` is
 * built from them and a reader arriving at a spec should not have to find them
 * — but there is exactly one definition, in the module that owns the
 * declaration.
 */
export type { Invertibility, Reproducibility, WriterOfRecord };

/**
 * The routing table, as a **mapped type over the command kind union**.
 *
 * Not a `Record<string, CommandSpec>` and not an array: both would accept a
 * table missing a kind, which is a command that dispatches nowhere at runtime.
 * Here the compiler is the check, and `scripts/proofs/contract.proof.mjs`
 * proves it by compiling code that must be rejected.
 */
export type CommandSpecs = { readonly [K in CommandKind]: CommandSpec<K> };

/**
 * The declarations, typed **narrowly** — `satisfies` rather than an annotation.
 *
 * An annotation would widen every `writer` to the whole union, and then nothing
 * downstream could tell which session a given command's `apply` wants: the
 * routing table would type-check and the bus would need a cast to call through
 * it. `satisfies` keeps `'mupdf'` as `'mupdf'` while still checking the table
 * against `CommandSpecs`, so a missing kind and an unrouted kind stay compile
 * errors.
 */
const declared = {
  rotatePages: {
    // SPREAD, never restated. `commandDeclarations.ts` is where a command is
    // declared; this layer adds the doing of it. Retyping `kind`, `writer` or
    // either axis here would make this a second declaration, which is the one
    // thing the split must not become (ADR-0026, and B3's own rule about a
    // second table).
    ...declaredCommands.rotatePages,
    // Bound to `mupdf` by WriterBinding, so this must take a MupdfSession and
    // return void. Handing it a byte-image writer's apply does not compile.
    apply: applyRotatePages,
    // Run BEFORE apply, in one code path, never by a handler (ADR-0009,
    // 2026-08-19). It reports own-state or states why it could not, and the bus
    // answers the second with a checkpoint. Since ADR-0023 Decision 10 the bus
    // reaches it through the registered writer rather than through this table —
    // *when* it runs is still the bus's, which is the half §4 is about.
    capture: captureRotatePages,
    // Takes the prior state and nothing else — see `Invert`. An inverse that
    // could see the command could compute a reversing rotation, which is the
    // one implementation §3 forbids.
    invert: invertRotatePages,
  },
  setLayerVisibility: {
    ...declaredCommands.setLayerVisibility,
    apply: applySetLayerVisibility,
    capture: captureSetLayerVisibility,
    invert: invertSetLayerVisibility,
  },
  movePage: {
    ...declaredCommands.movePage,
    apply: applyMovePage,
    capture: captureMovePage,
    invert: invertMovePage,
  },
  deletePages: {
    ...declaredCommands.deletePages,
    apply: applyDeletePages,
    capture: captureDeletePages,
    // UNREACHABLE BY THE TYPE and required by this table's shape. See
    // `invertDeletePages` — `CommandPrior['deletePages']` is `never`, so
    // nothing can build an argument for it.
    invert: invertDeletePages,
  },
  duplicatePage: {
    ...declaredCommands.duplicatePage,
    apply: applyDuplicatePage,
    capture: captureDuplicatePage,
    invert: invertDuplicatePage,
  },
  swapPages: {
    ...declaredCommands.swapPages,
    apply: applySwapPages,
    capture: captureSwapPages,
    invert: invertSwapPages,
  },
  insertBlankPage: {
    ...declaredCommands.insertBlankPage,
    apply: applyInsertBlankPage,
    capture: captureInsertBlankPage,
    invert: invertInsertBlankPage,
  },
  cropPages: {
    ...declaredCommands.cropPages,
    apply: applyCropPages,
    capture: captureCropPages,
    invert: invertCropPages,
  },
  // SPREAD FROM `pdfLibWriter.ts`, which is where a pdf-lib command is declared
  // — one declaration, and this table is the view that makes the set of them
  // exhaustive over `CommandKind` (ADR-0039). It is imported rather than
  // restated because a copy here would be a second declaration, which is the
  // one thing this table must not become.
  //
  // The edge runs THIS way and cannot run the other. `pdfLibWriter.ts` is
  // importable from `main`, and this file is not: it reaches `rotatePages.ts` →
  // `mupdfWriter.ts` → the native library.
  ...pdfLibSpecs,
} satisfies CommandSpecs;

/** The table as declared, with each writer's literal type intact. */
export type DeclaredSpecs = typeof declared;

/** Which writer of record a given command kind is routed to. */
export type WriterOf<K extends CommandKind> = DeclaredSpecs[K]['writer'];

export const commandSpecs: CommandSpecs = declared;

/**
 * The same table, narrowly typed, for callers that must reach a specific
 * command's `apply` or `capture`.
 *
 * Both exports name one object. `commandSpecs` is the §6 view — the mapped type
 * that makes the table exhaustive — and this is the view that keeps `'mupdf'`
 * meaning `'mupdf'`. A second table would be a second declaration; a second
 * *view* of one table is not.
 */
export const declaredSpecs: DeclaredSpecs = declared;

/**
 * `KindsRoutedTo`, `CommandExecution` and `RegisteredWriter` **moved to
 * `commandRouting.ts`** and are re-exported here so no importer had to change.
 *
 * They are types about routing and this file is a table of implementations; the
 * split is ADR-0026's, one layer along. What forced it is the second writer of
 * record: `pdfLibWriter.ts` runs in `main` and needs `CommandExecution` to say
 * what it is, and taking it from this file — which imports `rotatePages.ts` →
 * `mupdfWriter.ts` — would have been `commandSpecs → pdfLibWriter →
 * commandSpecs`, a cycle `import-x/no-cycle` fails the build for at any depth.
 *
 * `export type { … } from`, NOT `export { type … } from`. The second spelling
 * keeps the statement and emits `export {} from './commandRouting.js'`, which
 * is a side-effect import — harmless from a types-only module and exactly the
 * habit ADR-0026 was written about, so it is spelt the way that stays right
 * when the module it names stops being types-only.
 */
export type { CommandExecution, KindsRoutedTo, RegisteredWriter } from './commandRouting.js';

/**
 * Executing MuPDF commands **in this process**.
 *
 * Written out for `mupdf` rather than produced by a generic factory, because
 * `mupdf` is the one writer of record with an adapter (B7: the second one is
 * what would show whether a factory abstracts anything real). It is also the
 * implementation an engine host runs: `packages/kernel` is the host body, so
 * the same object serves main's tests today and the host's dispatch later.
 *
 * Every member is a lookup in {@link declaredSpecs} and a call. There is no
 * second table and no switch — §6's routing does the dispatch.
 */
/**
 * One spec, narrowed to the command it was declared for.
 *
 * ## The correlated-union limit, and why the answer is not a switch
 *
 * `declaredSpecs[command.kind].apply(session, command)` compiled while there
 * was one command and stops the moment there are two: TypeScript resolves the
 * indexed access over the whole union, so the parameter type becomes the
 * INTERSECTION of every member's — and two commands with different `kind`
 * literals intersect to `never`. The lookup is correct and the checker cannot
 * see that the index and the argument came from the same value.
 *
 * The obvious repair is an exhaustive `switch`, and this file forbids it in its
 * own words: *"There is no second table and no switch — §6's routing does the
 * dispatch."* A switch would be a second routing place, which is the thing the
 * table exists to prevent — and it would need a new arm per command, which is
 * exactly the maintenance the mapped type removes.
 *
 * So the correlation is asserted **once**, here, rather than at each of the
 * three call sites below. It is sound by construction: `spec` is looked up by
 * `command.kind` and `command` is that same value, so the pair always agrees.
 */
function specFor(command: Command): DeclaredSpecs[CommandKind] {
  return declaredSpecs[command.kind];
}

export const localMupdfExecution: CommandExecution<'mupdf'> = {
  // METHOD SYNTAX, so `K` is in scope for the assertion. An arrow would put the
  // cast at `CommandKind` — the whole union — which widens `capture`'s prior
  // state to a union too and stops being assignable to `CommandPrior[K]`. The
  // narrowing has to name the instantiation it is claiming.
  apply<K extends CommandKind>(session: MupdfSession, command: CommandOfKind<K>): Promise<void> {
    return (specFor(command).apply as Apply<'mupdf', K>)(session, command);
  },
  capture<K extends CommandKind>(
    session: MupdfSession,
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>> {
    return (specFor(command).capture as Capture<'mupdf', K>)(session, command);
  },
  // `invert` LOOKS like it needs no narrowing — the kind arrives separately, so
  // there is no `command.kind` for the checker to resolve independently. It
  // needs one anyway, and for the mirror-image reason: `declaredSpecs[kind]`
  // over a generic `kind` gives the union of specs, whose `invert` parameter is
  // the INTERSECTION of every prior-state type. Same limit, other direction.
  invert<K extends CommandKind>(
    session: MupdfSession,
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<void> {
    return (declaredSpecs[kind].invert as Invert<'mupdf', K>)(session, inverse);
  },
};
