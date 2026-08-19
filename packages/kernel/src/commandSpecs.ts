import { type CommandKind } from '@monstera/contract';

import { type Apply, type Capture, type WriterSession } from './engineSeam.js';
import { applyRotatePages, captureRotatePages } from './rotatePages.js';

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

/**
 * Which component is permitted to write this command's effect (rule B3).
 *
 * One writer per concern. Two writers is how a codebase acquires sidecar hacks,
 * and for a document it is how one engine's idea of the page tree overwrites
 * another's.
 *
 * Derived from the seam rather than listed, so the set of writers has one
 * declaration. A writer added to `WriterSession` without an adapter is a
 * compile error at every spec that names it, which is the direction that fails
 * safe.
 */
export type WriterOfRecord = keyof WriterSession;

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
  };
}[WriterOfRecord];

/**
 * Can this be undone, and what does undoing it cost?
 *
 * The consequence is part of the declaration because §4 spends it: a log entry
 * is either `{ command, inverse }` or `{ command, checkpoint }`, and a
 * non-invertible command without a checkpoint is unrepresentable. Declaring
 * `invertible: false` without acknowledging that it forces a checkpoint is how
 * checkpoints quietly become optional.
 *
 * `deletePages` is the shape that makes this real: restoring a deleted page
 * needs its objects, which cannot ride in a serialisable inverse, so it falls
 * to `checkpoint` — while §4 reserves checkpoints for redaction, flatten,
 * encryption and OCR precisely because they are the exception.
 */
export type Invertibility =
  | { readonly invertible: true; readonly undo: 'inverse' }
  | { readonly invertible: false; readonly undo: 'checkpoint' };

/**
 * Does repeating this produce the same bytes, and what does replay do?
 *
 * **Independent of invertibility** (§3a), which is the whole reason it is a
 * separate axis. Signing stamps a timestamp and signs over an exact byte range;
 * OCR output moves with the engine version; AI is nondeterministic by design;
 * anything minting random PDF object identifiers cannot reproduce itself.
 *
 * A command that is not reproducible **records its effect rather than its
 * intent**, and replay re-applies the stored effect instead of re-running the
 * operation. That sentence is the type: `reproducible: false` cannot be written
 * without `replay: 'stored-effect'`, so the consequence travels with the
 * declaration rather than living in a comment somebody has to find.
 */
export type Reproducibility =
  | { readonly reproducible: true; readonly replay: 'reapply-intent' }
  | { readonly reproducible: false; readonly replay: 'stored-effect' };

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
    kind: 'rotatePages',
    // Invariant L6: page-tree work rewrites in place through MuPDF's own
    // PDFObject API. Rebuilding into a new document drops /AcroForm, /Outlines,
    // /Names and /OCProperties — measured, not assumed (ADR-0006).
    writer: 'mupdf',
    // Bound to `mupdf` by WriterBinding, so this must take a MupdfSession and
    // return void. Handing it a byte-image writer's apply does not compile.
    apply: applyRotatePages,
    // The bus calls this BEFORE apply, in one code path, never a handler
    // (ADR-0009, 2026-08-19). It reports own-state or states why it could not,
    // and the bus answers the second with a checkpoint.
    capture: captureRotatePages,
    // §3: the inverse restores prior state verbatim, including ABSENCE. A page
    // that inherited its rotation is restored by DELETING the key, not by
    // writing back the value that was showing — both render identically and
    // only one of them restores the same document.
    invertible: true,
    undo: 'inverse',
    // Rotation is a value written to a key. Re-running it produces the same
    // bytes, so the log stores intent.
    reproducible: true,
    replay: 'reapply-intent',
  },
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
