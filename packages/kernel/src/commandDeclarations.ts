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
  movePage: {
    kind: 'movePage',
    // Invariant L6, and this is the command that measured it. ADR-0006: MuPDF's
    // own `rearrangePages` drops `/AcroForm` EVEN FOR THE IDENTITY PERMUTATION,
    // and the widget annotations survive on their pages — so the fields still
    // render while the field tree is orphaned, and the document silently stops
    // being a valid AcroForm. The `/Kids` rewrite through the PDFObject API is
    // what preserves all four catalog entries.
    writer: 'mupdf',
    // The inverse of a move is a move, and it is NOT `{ from: to, to: from }`.
    // Moving 0→2 in `0 1 2 3` gives `1 2 0 3`; moving 2→0 from there gives
    // `0 1 2 3` — correct here and only because a single move's inverse happens
    // to be the transposed move when nothing else shifted. `invertMovePage`
    // derives it rather than transposing, because the transposition is right
    // for a reason that does not generalise and a reader would copy it.
    invertible: true,
    undo: 'inverse',
    // A move rewrites `/Kids` to a derived order. Re-running it from the same
    // document produces the same tree, so the log stores intent.
    reproducible: true,
    replay: 'reapply-intent',
  },
  deletePages: {
    kind: 'deletePages',
    // Invariant L6 and `movePage`'s measurement: the same `/Kids` rewrite, with
    // a keep-set instead of a permutation. `rearrangePages` would express a
    // delete natively and is banned for the reason ADR-0006 measured — it drops
    // `/AcroForm` even for the identity permutation.
    writer: 'mupdf',
    // THE FIRST COMMAND TO DECLARE THIS, and the type has named it since the
    // day `Invertibility` was written. A deleted page's prior state is its
    // object graph, which has no serialisable form and is document-scaled —
    // `CommandPrior['deletePages']` is `never` so that an invertible delete
    // cannot be constructed at all.
    invertible: false,
    undo: 'checkpoint',
    // Deleting is a rewrite of `/Kids` to a derived order, exactly as a move
    // is. Re-running it against the same document produces the same tree, so
    // the log stores intent — invertibility and reproducibility are orthogonal
    // (§3a) and this is the first command in the build where they differ.
    reproducible: true,
    replay: 'reapply-intent',
  },
  duplicatePage: {
    kind: 'duplicatePage',
    // Invariant L6 again, and the copy is MuPDF's own `graftObject` rather than
    // a dictionary walk written here — measured 2026-09-04: a new indirect
    // object, dictionaries that diverge, and a shared `/Contents`.
    writer: 'mupdf',
    // The inverse removes the page the copy occupies, and the capture stores
    // that index rather than re-deriving it from *"after the source"*. The
    // placement is a rule the contract states and could change; a re-deriving
    // inverse would then remove the wrong page for every entry already logged.
    invertible: true,
    undo: 'inverse',
    // A graft of the same source into the same document produces the same tree.
    // The copy's object NUMBER is not part of what the document says, and a
    // full-rewrite save renumbers everything anyway (ADR-0008).
    reproducible: true,
    replay: 'reapply-intent',
  },
  swapPages: {
    kind: 'swapPages',
    // Invariant L6 and `movePage`'s measurement, a third time: the same
    // `/Kids` rewrite with a symmetric permutation.
    writer: 'mupdf',
    // The only command here whose inverse is the command itself, and the one
    // place a transposition is legitimate: `swapPermutation` is symmetric in
    // its two arguments and shifts nothing between them, so applying it twice
    // is the identity. `movePage`'s note two entries up warns against the same
    // reasoning, because there the property is a coincidence.
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
  },
  insertBlankPage: {
    kind: 'insertBlankPage',
    // Invariant L6 and the same `/Kids` rewrite. MuPDF's `addPage` +
    // `insertPage` would build the page AND put it in the tree, which is a
    // second writer for `/Kids` — the thing `pageOrder.ts` routes every
    // operation through one function to avoid (B3).
    writer: 'mupdf',
    // `duplicatePage`'s shape: the inverse removes the page the command added,
    // and the capture stores the index rather than re-deriving it.
    invertible: true,
    undo: 'inverse',
    // The page's geometry is read off a neighbour that does not move, so
    // re-running against the same document builds the same page.
    reproducible: true,
    replay: 'reapply-intent',
  },
  cropPages: {
    kind: 'cropPages',
    // A page attribute written in place, exactly as a rotation is. Invariant
    // L6's argument for MuPDF applies unchanged: a rebuild to change one key
    // drops the four catalog entries ADR-0006 measured.
    writer: 'mupdf',
    // ADR-0009 §3 on a second key: the inverse restores the page's own
    // `/CropBox` verbatim INCLUDING absence, because a page that displayed its
    // media box must come back declaring no crop box. Writing the box in
    // renders identically and is a different document.
    invertible: true,
    undo: 'inverse',
    // The inset is arithmetic on the box the page resolves to, so re-running it
    // against the same document writes the same numbers.
    reproducible: true,
    replay: 'reapply-intent',
  },
  watermarkPages: {
    kind: 'watermarkPages',
    // THE FIRST COMMAND THAT IS NOT `mupdf`, and the writer is not a choice
    // made here: §3's matrix at ARCHITECTURE.md:381 assigns "drawing onto pages
    // (watermark, headers/footers, Bates, OCR text layer)" to @cantoo/pdf-lib
    // by name. What ADR-0039 settles is how a byte-image writer's session is
    // obtained and what becomes of its result, not which engine draws.
    writer: 'pdf-lib',
    // NOT INVERTIBLE, and the reason is the same one `deletePages` gives from
    // the other direction: the prior state of a page that has been drawn on is
    // its whole content stream, which cannot ride in a serialisable inverse.
    // §4 reserves checkpoints for the exception and this is one — the entry
    // records `terminal` and undo restores the bytes (ADR-0037).
    //
    // The checkpoint is not an extra cost here. It IS the input image: a
    // byte-image `apply` consumes the document's current bytes, and the
    // serialise that produces them is the one the bus already performs for
    // every terminal entry (ADR-0039).
    invertible: false,
    undo: 'checkpoint',
    // AND THAT `false` IS WHAT ADR-0039'S COST ARGUMENT RESTS ON, which the ADR
    // originally stated backwards. The serialise is paid by
    // `CommandBus.#sessionFor` for every byte-image command; the checkpoint is
    // free because `pdfLibWriter.serialise` is the identity on an image already
    // in hand. So a non-invertible byte-image command pays nothing the bus was
    // not going to pay, and an invertible one would.
    //
    // `commandDeclarations.test.ts` is the trigger, not this comment.
    // Deliberately NOT a type constraint: §3's matrix assigns form-field
    // creation to pdf-lib, and that is plausibly invertible.
    // writes the same content stream. Nothing here mints an identifier, reads a
    // clock or asks an engine whose version could move — which is the list §3a
    // names, and each of those is what makes a command `stored-effect`.
    //
    // pdf-lib embeds a standard-14 font by name rather than subsetting a file,
    // so there is no font program whose bytes could differ between runs.
    reproducible: true,
    replay: 'reapply-intent',
  },
  headerFooterPages: {
    kind: 'headerFooterPages',
    // §3's matrix at ARCHITECTURE.md:381 names "drawing onto pages (watermark,
    // headers/footers, Bates, OCR text layer)" for @cantoo/pdf-lib, so this is
    // the same assignment `watermarkPages` reads, on the next item in the list.
    writer: 'pdf-lib',
    // `watermarkPages`' reason unchanged: the prior state of a page that has
    // been drawn on is its whole content stream. Every command routed to a
    // byte-image writer is a checkpoint command, and the checkpoint is the
    // input image the apply already consumes (ADR-0039).
    invertible: false,
    undo: 'checkpoint',
    // Drawing the same slots at the same size onto the same pages writes the
    // same content stream. The page-number tokens resolve from the document's
    // own page count and each page's index, so nothing here reads a clock or
    // mints an identifier — the two things §3a spends this axis on.
    reproducible: true,
    replay: 'reapply-intent',
  },
  batesNumberPages: {
    kind: 'batesNumberPages',
    // §3's matrix at ARCHITECTURE.md:381 names Bates in the same clause as the
    // watermark and the headers.
    writer: 'pdf-lib',
    // Drawn content, so `watermarkPages`' reason unchanged: the prior state is
    // the page's whole content stream, and the checkpoint is the input image
    // the apply already consumes (ADR-0039).
    invertible: false,
    undo: 'checkpoint',
    // The sequence is a function of `start` and each page's POSITION in the
    // resolved scope, so re-running it against the same document writes the
    // same identifiers. Nothing here reads a clock or a counter that outlives
    // the call — which is what would make a numbering command `stored-effect`,
    // and is worth stating because "sequential" sounds like it should be.
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
