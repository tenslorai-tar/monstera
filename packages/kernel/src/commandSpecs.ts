import type { CommandKind } from '@monstera/contract';

import type { Invertibility, Reproducibility, WriterOfRecord } from './commandDeclarations.js';
// FOUR SPECIFIERS FEWER since the routing types moved: `ByteImage`,
// `EngineWriter`, `WriterSession` and `WriterShapeOf` were named only by
// `CommandExecution` and `RegisteredWriter`, which now live in
// `commandRouting.ts`. Their removal is what says the move was clean rather
// than a re-export with the old file still doing the work.
import type { Apply, Capture, CommandReads, CommandSources, Invert } from './engineSeam.js';
import { mupdfSpecs } from './mupdfSpecs.js';
import { pdfLibSpecs } from './pdfLibWriter.js';
import { signpdfSpecs } from './signpdfWriter.js';
import { pdfiumSpecs } from './pdfiumSpecs.js';

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
 *
 * ## A CROSS PRODUCT since ADR-0040, and this is where its axis is bound
 *
 * The union now runs over writers **and** {@link CommandSources}, so choosing
 * both `writer` and `sources` chooses the `apply` — a `sources: 'one'` command
 * must supply an apply taking a second session, and a `'none'` one must not.
 *
 * This file is where that binding can happen and `engineSeam.ts` is not:
 * `commandDeclarations.ts` imports `WriterSession` from the seam, so the seam
 * cannot import the declarations back to read what a command declared. `Apply`
 * therefore takes the axis as a type parameter and this table supplies it, from
 * the spread declaration — exactly how `W` has always been bound.
 *
 * **The byte-image × `'one'` member is `never`-typed by `Apply` itself**, so it
 * is not a combination this table refuses; it is one that cannot be written.
 */
export type WriterBinding<K extends CommandKind> = {
  readonly [W in WriterOfRecord]: {
    readonly [S in CommandSources]: {
      readonly [R in CommandReads]: {
        readonly writer: W;
        readonly sources: S;
        readonly reads: R;
        readonly apply: Apply<W, K, S, R>;
        readonly capture: Capture<W, K>;
        readonly invert: Invert<W, K>;
      };
    }[CommandReads];
  }[CommandSources];
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
  // SPREAD FROM `mupdfSpecs.ts`, for `pdfiumSpecs`' reason below with the hazard pointing
  // the other way: the contained MuPDF host must reach MuPDF's table WITHOUT this one,
  // because this one spreads every other writer's and so loads their libraries. The host
  // imports `mupdfSpecs.js`; `proof:hostload` fails when its graph reaches another writer's
  // table, which going through this file does.
  ...mupdfSpecs,
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
  // AND SPREAD FROM `pdfiumSpecs.ts`, for `pdfLibSpecs`' reason with the
  // direction of the hazard reversed. That file must be reachable WITHOUT a
  // native library, because it runs in `main`; this one must be reachable
  // without **MuPDF**, because it runs in the contained PDFium host and this
  // file reaches `rotatePages.ts` → `mupdfWriter.ts`. So the edge runs this way
  // and cannot run the other, and the PDFium host imports `pdfiumSpecs.js`
  // directly rather than reaching for this table.
  ...pdfiumSpecs,
  // AND SPREAD FROM `signpdfWriter.ts`, for `pdfLibSpecs`' reason exactly: that
  // file runs in `main` and must be reachable without a native library, and
  // this one reaches `rotatePages.ts` → `mupdfWriter.ts`.
  ...signpdfSpecs,
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
export type {
  ApplyRequest,
  CommandExecution,
  KindsRoutedTo,
  RegisteredWriter,
} from './commandRouting.js';

/**
 * Executing MuPDF commands in this process moved to `mupdfSpecs.ts` with MuPDF's table,
 * and is re-exported here so main's importers did not change. The contained MuPDF host
 * takes it from `mupdfSpecs.js` directly — see that file for why.
 */
export { localMupdfExecution } from './mupdfSpecs.js';
