import type { CommandKind } from '@monstera/contract';

import type { WriterSession } from './engineSeam.js';

/**
 * What every command **is** — and nothing about how it is performed
 * ([ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)).
 *
 * ## Why this is a module of its own
 *
 * `commandSpecs.ts` used to hold both halves, and every consumer that wanted
 * **routing** got **execution**, because they were properties of one object.
 * That is not a stylistic point: `apply` reaches `rotatePages.ts` →
 * `mupdfWriter.ts` → `import * as mupdf`, so a value import of the spec table
 * binds the MuPDF native library. Measured 2026-08-27 in a bare Node process,
 * peak RSS over bare: `commandBus.js` **+40.1 MB**, the kernel barrel
 * **+41.7 MB**, against **+46.0 MB** for the adapter itself.
 *
 * `main` paid that at startup, while invariant 20 says native faults are
 * uncatchable and §9.17 argues `main`'s budget from *"main holds canonical
 * bytes and never parses"*.
 *
 * **And every routing consumer reads `writer` and nothing else.** Read from
 * source rather than assumed: `commandBus.ts` twice, `documentCommands.ts`
 * once, plus one compile-time read of `replay`. None of them calls `apply`,
 * `capture` or `invert` — those have gone through the **registered writer**
 * since [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 10 moved them there. So the edge outlived the reason for it, and
 * nothing about the code looked wrong afterwards.
 *
 * ## One declaration in two layers, NEVER two tables
 *
 * `commandSpecs.ts` builds each entry by spreading its declaration here and
 * adding the functions. A command is therefore declared in exactly one place,
 * and a kind declared here without an implementation there does not compile.
 * The rule `commandSpecs.ts` already states about itself — *"a second table
 * would be a second declaration; a second view of one table is not"* — is what
 * this follows, rather than something it evades.
 *
 * ## Nothing here may import an implementation
 *
 * That is the whole property, and it is checkable by reading the import block:
 * one type from the contract, one type from the seam. `engineSeam.ts` is
 * types-only, so neither edge reaches a value. **A value import added to this
 * file re-creates the defect in full**, because everything that routes imports
 * this module.
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
 * The writer, carrying its own literal type.
 *
 * A distributed mapped type collapsed to its own union, for the same reason
 * `WriterBinding` in `commandSpecs.ts` is one: it keeps `'mupdf'` meaning
 * `'mupdf'` per entry rather than widening to the whole union, which is what
 * lets `WriterOf<K>` resolve to a single writer and a session type downstream.
 *
 * The **binding** of `apply` to that writer's session stays in `commandSpecs.ts`
 * with the functions it binds — it is a statement about an implementation, and
 * this file has none.
 */
export type WriterRouting = {
  readonly [W in WriterOfRecord]: { readonly writer: W };
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

/** Everything one command kind declares about itself, minus the doing of it. */
export type CommandDeclaration<K extends CommandKind> = {
  readonly kind: K;
} & WriterRouting &
  Invertibility &
  Reproducibility;

/**
 * The declaration table, as a **mapped type over the command kind union**.
 *
 * Not a `Record<string, …>` and not an array: both would accept a table missing
 * a kind, which is a command that dispatches nowhere at runtime. Here the
 * compiler is the check, and `scripts/proofs/contract.proof.mjs` proves it by
 * compiling code that must be rejected.
 */
export type CommandDeclarations = { readonly [K in CommandKind]: CommandDeclaration<K> };

/**
 * The declarations, typed **narrowly** — `satisfies` rather than an annotation.
 *
 * An annotation would widen every `writer` to the whole union, and then nothing
 * downstream could tell which session a given command wants: routing would
 * type-check and the bus would need a cast to call through it. `satisfies`
 * keeps `'mupdf'` as `'mupdf'` while still checking the table against
 * `CommandDeclarations`, so a missing kind and an unrouted kind stay compile
 * errors.
 */
const declarations = {
  rotatePages: {
    kind: 'rotatePages',
    // Invariant L6: page-tree work rewrites in place through MuPDF's own
    // PDFObject API. Rebuilding into a new document drops /AcroForm, /Outlines,
    // /Names and /OCProperties — measured, not assumed (ADR-0006).
    writer: 'mupdf',
    // ADR-0009 §3: the inverse restores prior state verbatim, including
    // ABSENCE. A page that inherited its rotation is restored by DELETING the
    // key, not by writing back the value that was showing — both render
    // identically and only one of them restores the same document.
    invertible: true,
    undo: 'inverse',
    // Rotation is a value written to a key. Re-running it produces the same
    // bytes, so the log stores intent.
    reproducible: true,
    replay: 'reapply-intent',
  },
  setLayerVisibility: {
    kind: 'setLayerVisibility',
    // `/OCProperties` is part of the document's structure, and invariant L6's
    // argument applies to it directly: ADR-0006 measured a rebuild DROPPING
    // /OCProperties, so this is written in place, for the same reason a
    // rotation is. Through MuPDF's OBJECT api and not its layer api — the
    // latter writes session state that a save does not carry (`layers.ts`,
    // measured 2026-09-03).
    writer: 'mupdf',
    // ADR-0009 §3: the inverse restores prior state verbatim. A layer's prior
    // visibility is a boolean the document already carried, so the inverse is
    // the command with that boolean — and it must be the state CAPTURED rather
    // than the negation of what was asked for, because a command that set a
    // layer to the value it already had must invert to a no-op rather than to
    // a flip.
    invertible: true,
    undo: 'inverse',
    // Visibility is a value written to a key. Re-running it produces the same
    // bytes, so the log stores intent.
    reproducible: true,
    replay: 'reapply-intent',
  },
} satisfies CommandDeclarations;

/** The declarations as declared, with each writer's literal type intact. */
export type DeclaredCommands = typeof declarations;

/** The table every routing consumer reads. */
export const declaredCommands: DeclaredCommands = declarations;

/** Which writer of record a given command kind is routed to. */
export type WriterOf<K extends CommandKind> = DeclaredCommands[K]['writer'];
