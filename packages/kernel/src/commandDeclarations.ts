import type { CommandKind } from '@monstera/contract';

import type {
  CommandAsset,
  CommandSources,
  CommandTargets,
  PreRead,
  ReadPreRead,
  SavePurpose,
  WriterSession,
} from './engineSeam.js';

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
 * Does this command name a second document?
 *
 * [ADR-0040](../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)
 * Decision 4, and it is a **declaration rather than an inference from the
 * payload**. A command whose params happen to contain a `DocId` is not the same
 * statement as a command that needs a second session, and reading one off the
 * other is the partial reimplementation of a rule something else owns that B3a
 * is about: the payload is the contract's, the session requirement is the
 * seam's.
 *
 * Every command declares it, including the twelve that answer `'none'`. A field
 * defaulted to `'none'` would be a choice nobody makes and nobody reads, and
 * the point of this table is that each axis is answered once per command where
 * a reviewer meets it — the same argument {@link Invertibility} makes about a
 * consequence travelling with its choice.
 */
export interface SourceRouting {
  readonly sources: CommandSources;
}

/**
 * Does this command name state that already exists, and can therefore be stale?
 *
 * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 * Decision 3, and a **declaration rather than an inference from the payload**,
 * for {@link SourceRouting}'s reason one axis along: a command carrying a field
 * called `version` is not the same statement as a command whose meaning depends
 * on the document not having moved, and reading one off the other is the partial
 * reimplementation B3a is about.
 *
 * Every command declares it, including the sixteen that answer `'none'`.
 *
 * **This is the axis that separates the two kinds of command in the table.**
 * Everything else here is self-contained: it carries the whole of its intent, and
 * applying it twice gives the same result or a second annotation, never the
 * wrong one. A command declaring anything but `'none'` is only meaningful
 * against one version, and the bus refuses it against any other.
 */
export interface TargetRouting {
  readonly targets: CommandTargets;
}

/**
 * Does this command need a value read through another engine?
 *
 * ADR-0040's 2026-09-05 extension, and {@link SourceRouting}'s sibling rather
 * than a widening of it: that axis counts **documents**, this one names
 * **pre-read data**, and they combine independently. Declared on every command
 * for the same reason — an axis defaulted to `'none'` is a choice nobody makes
 * and nobody reads.
 *
 * ## IT CARRIES A FUNCTION, WHICH IS THE FIRST ONE IN THIS FILE
 *
 * ADR-0051, and the cost is taken deliberately rather than slipped in. This
 * file's property is that it holds no implementation — ADR-0026 put the
 * declarations here so that nothing could value-import an engine by asking what
 * a command *is* — and `read` keeps that property: it imports nothing, names two
 * members and copies two fields.
 *
 * What it buys is the only spelling in which a command's **kind** and a
 * pre-read's **needs** are correlated by the checker. A pre-read that takes an
 * argument has to get it from the command, and the places that could do the
 * extraction are: here, per kind and type-checked; a `switch` in the composition
 * root, which is the second routing place §6's mapped types exist to prevent; or
 * an access member taking the whole command union and narrowing by kind, which is
 * a runtime refusal for a state this table makes unreachable.
 *
 * **`reads` and `read` are one arm of a union**, so neither can be written
 * without the other and a `reads: 'none'` command cannot carry a resolver — the
 * `read?: never` arm is what says so, rather than a comment asking nobody to.
 */
export type ReadRouting<K extends CommandKind> =
  | { readonly reads: 'none'; readonly read?: never }
  | {
      readonly [R in keyof PreRead]: {
        readonly reads: R;
        readonly read: ReadPreRead<K, R>;
      };
    }[keyof PreRead];

/**
 * Does this command carry bytes the writer's wire cannot express?
 *
 * [ADR-0044](../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md),
 * and {@link SourceRouting}'s argument a third axis along: declared rather than
 * inferred from a payload that happens to hold a `Uint8Array`, because those are
 * different statements and `insertImagePage` is the pair that proves it — an
 * image in the payload, `asset: 'none'`, because a byte-image writer's wire is
 * a function call.
 *
 * Generic where the other three are not, and that is {@link CommandAsset}'s
 * doing: a kind with no `bytes` field has no member of that union but `'none'`,
 * so declaring an asset on a command that has none is a compile error rather
 * than a transport looking for a file at run time.
 *
 * Every command declares it, including the twenty-three that answer `'none'`.
 */
export interface AssetRouting<K extends CommandKind> {
  readonly asset: CommandAsset<K>;
}

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
 * What are this command's bytes for?
 *
 * `docs/ARCHITECTURE.md` §4: *"Every command that reaches the save pipeline
 * declares which row it falls under. A command whose purpose is removal cannot
 * be added without classifying it."* That sentence has stood since 2026-08-16
 * with nowhere to write the classification, because until `flattenFormFields`
 * no command's purpose was removal
 * ([ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)).
 *
 * Every command declares it, including the twenty-five that answer
 * `'ordinary'` — {@link SourceRouting}'s argument a fifth axis along. An axis
 * defaulted to the safe value is a choice nobody makes and nobody reads, and
 * here the unsafe direction is the quiet one: a removal that forgot to declare
 * itself produces a document that still contains what it removed, and every
 * check on it passes.
 *
 * **It is not derivable from `undo: 'checkpoint'`**, which is the inference
 * somebody will reach for. `deletePages`, `addLink` and `deleteFormFields` all
 * take checkpoints and none of them is a removal in §4's sense: a checkpoint
 * says *the prior state cannot be serialised*, and a purpose says *the prior
 * state must not survive in the output*. Those are different claims and
 * `deleteFormFields` is the pair that proves it — it removes a widget and its
 * bytes are ordinary, because the person deleting a field is editing a form
 * rather than redacting one.
 */
export interface PurposeRouting {
  readonly purpose: SavePurpose;
}

/** Everything one command kind declares about itself, minus the doing of it. */
export type CommandDeclaration<K extends CommandKind> = {
  readonly kind: K;
} & WriterRouting &
  SourceRouting &
  TargetRouting &
  ReadRouting<K> &
  AssetRouting<K> &
  PurposeRouting &
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
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
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  setPageTransition: {
    kind: 'setPageTransition',
    // A PAGE ATTRIBUTE WRITTEN IN PLACE, exactly as `cropPages` writes
    // `/CropBox` and `rotatePages` writes `/Rotate`. Invariant L6's argument
    // for MuPDF applies unchanged, and nothing here is drawn — so this is not
    // content composition and does not route to pdf-lib, however much
    // *transitions* sounds like presentation.
    writer: 'mupdf',
    // ADR-0009 §3 on a third key, and the same shape both siblings have:
    // **absence is a value**. A page that declared no `/Trans` must come back
    // declaring none, because a page carrying `/S /R` and a page carrying
    // nothing are different documents even though a reader sees the same
    // thing — the first says *replace*, the second says the producer never
    // considered it.
    invertible: true,
    undo: 'inverse',
    // Writing two dictionary entries from the command's own two fields, with
    // nothing read from a clock or minted.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  setPageBackground: {
    kind: 'setPageBackground',
    // Content composition — §3's matrix at ARCHITECTURE.md:381 — and unlike
    // `setPageTransition` next door this one really does write a content
    // stream, which is what puts it on the byte-image writer rather than on
    // MuPDF.
    writer: 'pdf-lib',
    // `watermarkPages`' reason: the prior state of a page whose content stream
    // has been changed is that whole stream.
    invertible: false,
    undo: 'checkpoint',
    // A fill of the page's own box in three given components, with nothing read
    // from a clock and nothing minted.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  resizePages: {
    kind: 'resizePages',
    // `docs/ARCHITECTURE.md:382` names resize on the page-tree-ops row. It
    // touches a content stream, which every pdf-lib command here also does —
    // and the row below is *drawing onto pages*, where this draws nothing: the
    // stream it adds changes the coordinate system the existing marks are read
    // in and puts no marks of its own on the page.
    writer: 'mupdf',
    // THE ONLY CONTENT-STREAM COMMAND HERE THAT IS INVERTIBLE, and the reason
    // is that it appends to no stream. It adds two and rewrites `/Contents` to
    // `[transform, ...original, restore]`, so the originals are untouched and
    // the prior state is the array's shape — two numbers and a boolean per
    // page, whatever the document weighs. `watermarkPages`' argument for a
    // checkpoint is *drawing appends to the stream, so the prior state is the
    // stream*; the premise is false here, so the conclusion does not follow.
    invertible: true,
    undo: 'inverse',
    // A scale and a translation computed from the page's own box and the
    // command's two numbers, with nothing read from a clock and nothing minted.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  deskewPages: {
    kind: 'deskewPages',
    // The same write `resizePages` makes, for the same reason: it wraps the
    // page's existing content in a transform and puts no marks of its own on
    // the page. `docs/ARCHITECTURE.md:382`'s page-tree-ops row is MuPDF's, and
    // the row below it — content composition — is *drawing onto pages*, which
    // this does not do. It also RASTERISES to decide the angle, and that is
    // MuPDF's by the matrix's print-and-export rasterisation row, so both
    // halves of this command name the same engine.
    writer: 'mupdf',
    // `resizePages`' argument, unchanged: it appends to no existing stream, so
    // the prior state is the shape of the `/Contents` array rather than the
    // streams themselves — two numbers and a boolean per page, whatever the
    // document weighs. `pageContentWrap.ts` is the one implementation of it.
    invertible: true,
    undo: 'inverse',
    // MEASURED FROM THE PAGE, which is what makes this `reapply-intent` and not
    // `stored-effect`: nothing is read from a clock and nothing is minted, and
    // re-running against the same document rasterises the same ink and finds
    // the same angle. `generateToc`'s shape — the intent is re-executed and
    // reads the document again.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document, so its `apply` takes one session and is
    // unmoved by ADR-0040's axis existing.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // NEEDS NOTHING READ THROUGH ANOTHER ENGINE, which is the axis this command
    // is most likely to be misfiled on. It reads the document — a raster of it
    // — but through the engine that is about to write, inside the same session.
    // `reads` counts a pre-read from a DIFFERENT writer, and there is none.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  enhancePages: {
    kind: 'enhancePages',
    // `docs/ARCHITECTURE.md:372`'s page-tree row and the object surgery beside it:
    // this replaces an image XObject's stream and restates its dictionary, in
    // place, in the session. It is NOT content composition — nothing is drawn onto
    // the page, and the page's content stream is untouched.
    writer: 'mupdf',
    // The prior state is the image streams themselves, which is document-scaled and
    // exactly what an invertible entry may not retain. §4's reserved list again.
    invertible: false,
    undo: 'checkpoint',
    // DERIVED FROM EACH IMAGE'S OWN HISTOGRAM — Otsu's two class means — so the
    // same document levels to the same bytes. Nothing is read from a clock and
    // nothing is minted. It is NOT idempotent, which is a different property: the
    // second run levels an already-levelled image, and `reproducible` asks whether
    // re-running against the SAME document produces the same result.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // Self-contained: a page list is the user's own selection, not an answer read
    // earlier that the document could have moved past.
    targets: 'none',
    // Needs nothing read through another engine: it decodes, levels and re-encodes
    // inside the session it is writing.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  ocrPage: {
    kind: 'ocrPage',
    // §3's matrix puts content composition on `@cantoo/pdf-lib`, and a text layer
    // is drawing onto a page. The RECOGNITION is MuPDF's — it rasterises, by the
    // print-and-export row — which is exactly why this command needs a pre-read
    // rather than a second writer: two engines, one of them writing.
    writer: 'pdf-lib',
    // `generateToc`'s argument: a byte-image writer's prior state is the document
    // before the write, and there is no serialisable description of "this page
    // without the content stream I am about to append" that pdf-lib can restore
    // from. §4 reserves checkpoints for redaction, flatten, encryption and OCR,
    // and this is the fourth of those four arriving.
    invertible: false,
    undo: 'checkpoint',
    // §3a NAMES THIS CASE: *"OCR output moves with the engine version"*. A redo
    // that re-recognised would pay 3.8–4.4 s per page again and, after a model or
    // engine upgrade between the undo and the redo, would write text the undone
    // document never carried. So the effect is recorded and replayed
    // (ADR-0051 Decision 2) — and this declaration is what fired the trigger
    // `CommandBus.redo` had carried since 2026-09-04.
    reproducible: false,
    replay: 'stored-effect',
    // Names no second document: the page it reads and the page it writes are the
    // same page of the same document.
    sources: 'none',
    // Self-contained. A page index is not state read from an earlier answer — it
    // is the page the reader is looking at — so there is nothing to be stale
    // against. The detector's attribution is the SURFACE's reason for offering
    // the command, not a value this payload carries.
    targets: 'none',
    // THE SECOND COMMAND TO DECLARE A PRE-READ, and the one that made the axis
    // take an argument (ADR-0051). The write is pdf-lib's and the recognition is
    // MuPDF's raster read through Tesseract inside the engine host, so a pdf-lib
    // apply could not reach it: a byte-image apply holds no session at all.
    reads: 'ocr',
    // The resolution, beside the axis. It needs a PAGE, which is the whole reason
    // the member takes an argument — and the language travels with it because the
    // model is chosen per recognition rather than per document.
    read: (access, command) => access.ocr({ page: command.page, language: command.language }),
    asset: 'none',
    purpose: 'ordinary',
  },
  insertImagePage: {
    kind: 'insertImagePage',
    // §3's matrix at ARCHITECTURE.md:381 names *image-to-PDF* on the
    // content-composition row. pdf-lib embeds JPEG and PNG directly; MuPDF
    // would need a decoder and an encoder this build does not have.
    writer: 'pdf-lib',
    // `deletePages`' argument arriving from the opposite side: an insert's
    // inverse is a delete, and a delete's prior state is the page and
    // everything it reaches. `CommandPrior` types it `never`.
    invertible: false,
    undo: 'checkpoint',
    // The image and the index are both in the command, so re-running it against
    // the same document writes the same bytes. Nothing is read from a clock and
    // nothing is minted.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second DOCUMENT. It carries an image, which is not one — the
    // axis counts open documents whose sessions the apply is handed, and this
    // one's picture arrives in its own payload.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Needs nothing read through another engine; its `apply` takes what the
    // command carries and nothing else.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  generateToc: {
    kind: 'generateToc',
    // §3's matrix at ARCHITECTURE.md:381 names "new document generation
    // (markdown/CSV/TOC/image-to-PDF)" on the content-composition row. Routing
    // it to MuPDF instead would put the read and the write in one session and
    // need no `reads` axis at all — rejected in ADR-0040's extension, because
    // moving one command off that row for convenience is how a matrix stops
    // being evidence.
    writer: 'pdf-lib',
    // `insertImagePage`'s argument: this adds pages, and the prior state of a
    // document that gained pages is the document without them — which is
    // `deletePages`' entry read backwards. `CommandPrior` types it `never`.
    invertible: false,
    undo: 'checkpoint',
    // The outline is read from the document at apply time and the layout is a
    // function of it, so re-running against the same document writes the same
    // page. Nothing is read from a clock and nothing is minted — and the
    // re-read is what makes this `reapply-intent` rather than `stored-effect`:
    // a redo after an undo that moved pages must state the numbers the document
    // has THEN, not the ones it had when the command first ran.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document. Everything it composes comes from the one it
    // is writing into.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // THE FIRST COMMAND TO DECLARE THIS, and the axis was built ahead of it
    // (ADR-0040's 2026-09-05 extension). A byte-image `apply` has no session,
    // so a pdf-lib TOC would have to walk `/Outlines` itself — a second opinion
    // about a question `destinations.ts` owns (B3a), agreeing with it on every
    // ordinary outline and differing on the ones that matter: a cycle, a
    // destination resolved through the name tree, an entry with no reachable
    // page.
    reads: 'outline',
    // THE RESOLUTION, beside the axis it belongs to (ADR-0051). It takes no
    // argument because an outline is a property of the document, and this is
    // what says so where the checker can see it — the member's own signature
    // refuses a page.
    read: (access) => access.outline(),
    asset: 'none',
    purpose: 'ordinary',
  },
  mergeDocument: {
    kind: 'mergeDocument',
    // `docs/ARCHITECTURE.md:372` puts "Page tree ops:
    // delete/insert/extract/MERGE/split/crop/resize" on MuPDF, so the writer is
    // assigned rather than chosen — and this is the row that ADR-0040 was
    // written for.
    writer: 'mupdf',
    // `deletePages`' argument from the target's side: the prior state of a
    // document that gained another document's pages is its whole page tree.
    // ADR-0040's *what this does not do* says the same and adds the half that
    // matters — the checkpoint is of the TARGET, and the source is not modified
    // and needs no entry.
    invertible: false,
    undo: 'checkpoint',
    // Grafting the same source into the same target produces the same tree. The
    // copies' object NUMBERS are not part of what the document says, and a
    // full-rewrite save renumbers everything anyway (ADR-0008) — the same
    // argument `duplicatePage` makes one writer along.
    reproducible: true,
    replay: 'reapply-intent',
    // THE FIRST COMMAND TO DECLARE THIS, and the axis was built ahead of it
    // (ADR-0040 Decision 4). Its `apply` takes the source's session as a third
    // argument it cannot be called without — and note what the type does NOT
    // do: an apply that ignored that argument would still compile, which
    // ADR-0040's correction records as the axis's stated limit. What guards it
    // is `pageMerge.test.ts`, named in the proof's own allow case.
    sources: 'one',
    // Self-contained: it names another DOCUMENT, which is a different axis, and
    // nothing in its payload points into an answer this document gave.
    targets: 'none',
    // Needs nothing read through another engine. Both sessions are MuPDF's, and
    // everything this composes is in the two page trees it already holds.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  replacePage: {
    kind: 'replacePage',
    // `docs/ARCHITECTURE.md:372`'s page-tree row, and this one touches both
    // halves of it — a delete and an insert.
    writer: 'mupdf',
    // `deletePages`' argument and `mergeDocument`'s in one command: the prior
    // state is the replaced page's object graph AND the absence of what
    // arrived. Neither has a serialisable form.
    invertible: false,
    undo: 'checkpoint',
    // The same source into the same target at the same index produces the same
    // tree. Nothing is read from a clock and nothing is minted.
    reproducible: true,
    replay: 'reapply-intent',
    // ADR-0040's axis, second command to declare it.
    sources: 'one',
    // Self-contained: it names another DOCUMENT, which is a different axis, and
    // nothing in its payload points into an answer this document gave.
    targets: 'none',
    // Nothing read through another engine.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  addAnnotation: {
    kind: 'addAnnotation',
    // `docs/ARCHITECTURE.md:386` puts "Annotations (all types), appearance
    // streams" on MuPDF. That is a CLASSIFICATION, not a preference: an
    // annotation is an object in `/Annots` carrying its own appearance stream,
    // which is what makes it selectable and erasable later. Drawing the same
    // rectangle into `/Contents` through the byte-image writer would produce a
    // document that renders identically and has no annotation in it — the
    // `setPageTransition` row's argument, on the other side of the matrix.
    writer: 'mupdf',
    // `commandLog.ts`' entry says why, and it is the one `never` there that is
    // a *not yet*: the operation that removes an annotation exists, and the
    // handle naming WHICH one does not. An inverse spelt "the last annotation
    // on the page" would depend on the log's ordering rather than on captured
    // state.
    invertible: false,
    undo: 'checkpoint',
    // MEASURED rather than reasoned, because the obvious guess is wrong.
    // Annotation dictionaries commonly carry `/M` and `/CreationDate`, which
    // would put a clock in the effect and force `stored-effect` — the
    // watermark's `/ModDate` hazard one layer down. MuPDF 1.28.0 writes
    // neither: two runs of the same command against the same bytes produced
    // byte-identical documents (2026-09-05), and a case holds that so a version
    // that starts stamping a date is a red build rather than a silent change of
    // meaning.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document. The rectangle is in its own payload.
    sources: 'none',
    // Self-contained: it carries the whole of its intent, so there is no
    // earlier answer it could be stale against and nothing for the bus to
    // compare a version with.
    targets: 'none',
    // Reads nothing through another engine. The page's boxes and rotation come
    // from the session this apply is already holding.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  removeAnnotation: {
    kind: 'removeAnnotation',
    // The same classification the row above carries, from the other direction:
    // an annotation is an object in `/Annots`, so removing one is a page-tree
    // write and MuPDF owns it. Nothing a content-stream writer could do would
    // remove an annotation — it would draw over the appearance and leave the
    // object, which is the redaction row's distinction and the reason that row
    // says the marks remove nothing.
    writer: 'mupdf',
    // TERMINAL, and NOT for `addAnnotation`'s reason. That one says *not yet*
    // because the handle did not exist; this one has the handle and still
    // cannot record an inverse, because the prior state of a removed annotation
    // is its whole object graph — a dictionary that may reference an appearance
    // stream, which references fonts and images. `deletePages`' argument on a
    // smaller noun: unbounded and unserialisable without inventing a format for
    // arbitrary PDF objects, and a log whose `retainedBytes` counts checkpoints
    // only would under-report it.
    invertible: false,
    undo: 'checkpoint',
    // Removing an object writes no date and consults no clock. The same two
    // runs the row above measures, in the other direction.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document.
    sources: 'none',
    // THE FIRST COMMAND TO DECLARE THIS, and the axis was built with it rather
    // than ahead of it — ADR-0041 Decision 3. Its payload points into an answer
    // `document.annotations` gave at a particular version, and the walk is a
    // total order over a fixed set for that version only. The bus refuses it
    // against any other; nothing in the apply below learns that a comparison
    // happened.
    targets: 'annotation',
    // Reads nothing through another engine. The walk it resolves against is the
    // session's own.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  placeAnnotation: {
    kind: 'placeAnnotation',
    // The two rows above, from the third direction: moving an annotation
    // rewrites an object in `/Annots` and its appearance stream. A content
    // writer could draw the shape somewhere else and would leave the original
    // object exactly where it was.
    writer: 'mupdf',
    // NOT `addAnnotation`'s *not yet* and not `removeAnnotation`'s *never*. The
    // prior state is expressible — the geometry the annotation carried — and
    // what stops it is that a RECTANGLE is not that geometry: for the four
    // subtypes whose box is derived, placing the old box back maps the points
    // through a second affine and the reported box carries a border outset that
    // does not scale with it. The round trip is close and not equal.
    // `capturePlaceAnnotation` names the trigger.
    invertible: false,
    undo: 'checkpoint',
    // The same measurement `addAnnotation` records: MuPDF 1.28.0 writes no `/M`
    // and no `/CreationDate`, so two runs of the same placement against the same
    // bytes agree. A version that starts stamping a date turns the case red
    // rather than moving what `reproducible` means here.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document.
    sources: 'none',
    // Its payload points into an answer `document.annotations` gave at one
    // version, exactly as `removeAnnotation`'s does. The bus refuses a stale
    // one before this apply is reached.
    targets: 'annotation',
    // Reads nothing through another engine.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  placeImage: {
    kind: 'placeImage',
    // `addAnnotation`'s classification and its exact argument: a `/Stamp` is an
    // object in `/Annots` carrying its own appearance stream, and that is what
    // makes it selectable, movable and erasable afterwards. Drawing the image
    // into `/Contents` through the byte-image writer produces a page that
    // renders identically and has no annotation in it, which is the whole of
    // what this row asks for.
    //
    // The pdf-lib route was EXECUTED before this was written and it works —
    // ADR-0044 records five readings. It loses on cost, not capability.
    writer: 'mupdf',
    // `addAnnotation`'s reason, unchanged: the operation that removes an
    // annotation exists, and an inverse spelt "the last stamp on the page"
    // would depend on the log's ordering rather than on captured state.
    invertible: false,
    undo: 'checkpoint',
    // MEASURED, not assumed, for `addAnnotation`'s reason — and this one has a
    // second way to fail that the others do not. The image XObject is written
    // by `addImage`, so a name or an object identifier minted per call would
    // put randomness in the bytes where the annotation rows have none.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document. The image is in its own payload.
    sources: 'none',
    // Self-contained. It names pages by index and nothing that a walk answered,
    // so there is no earlier answer it could be stale against — the same reason
    // `addAnnotation` declares `'none'` where `placeAnnotation` cannot.
    targets: 'none',
    // Reads nothing through another engine.
    reads: 'none',
    // THE ONE COMMAND THAT ANSWERS ANYTHING ELSE (ADR-0044). Its bytes cannot
    // cross the engine host's wire, which is JSON: a `Uint8Array` arrives as an
    // object of numeric keys and this command's own schema refines it away. So
    // the transport writes them into the directory `engine/open` already grants
    // the host READ on, and puts them back before the apply is called.
    asset: 'bytes',
    purpose: 'ordinary',
  },
  styleAnnotation: {
    kind: 'styleAnnotation',
    // The annotation rows' classification: `/C`, `/CA` and `/BS` are keys on an
    // object in `/Annots`, and the appearance stream MuPDF regenerates is that
    // object's. A content writer could draw the shape again in another colour
    // and would leave the original exactly where it was.
    writer: 'mupdf',
    // The prior is three numbers per annotation and is entirely expressible —
    // the first of the four annotation commands where the format is not what
    // stops it. What stops it is that `CommandPrior` carries one value per
    // command and this names several. `captureStyleAnnotation` has the trigger.
    invertible: false,
    undo: 'checkpoint',
    // Three keys and an appearance stream, and no clock — the same measurement
    // `addAnnotation` records for the object it creates.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // Its payload points into an answer `document.annotations` gave at one
    // version, as `removeAnnotation`'s and `placeAnnotation`'s do.
    targets: 'annotation',
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  addLink: {
    kind: 'addLink',
    // A `/Link` is an entry in `/Annots` and a page-tree write, so MuPDF owns it
    // for the annotation rows' reason. It is also NOT an annotation in MuPDF's
    // model — `getAnnotations()` does not return one — which is what put its
    // apply in `pageLinks.ts` rather than beside them.
    writer: 'mupdf',
    // `addAnnotation`'s *not yet*, on a weaker footing: that one waits for a
    // handle that now exists, and this one waits for a handle nothing has
    // proposed. `document.pageLinks` answers with bounds and a target and no
    // identity at all, which is where the annotations read was before ADR-0041.
    invertible: false,
    undo: 'checkpoint',
    // `createLink` writes `/Rect`, `/BS` and `/A` and no date — the same
    // measurement `addAnnotation` records, on the object beside it.
    reproducible: true,
    replay: 'reapply-intent',
    // Names no second document. A page target is an index into THIS one.
    sources: 'none',
    // Self-contained: the rectangle and the target are its whole intent, and a
    // page index is not a position in an answer somebody was given.
    targets: 'none',
    // Reads nothing through another engine.
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  fillFormField: {
    kind: 'fillFormField',
    // `docs/ARCHITECTURE.md`:385 assigns *"Form fields: fill"* to MuPDF by
    // name, so the writer of record was settled before this row existed and
    // none of it is a B4. The classification holds on its own terms: a field's
    // value is `/V` on an object in `/AcroForm` and the appearance MuPDF
    // regenerates is that object's — measured, 7708 marked pixels before a
    // longer text value and 8701 after.
    writer: 'mupdf',
    // THE FIRST INVERTIBLE COMMAND ON EITHER WALK, and the reason is the shape
    // of the payload rather than anything about forms: a fill names ONE widget,
    // so its prior is one value, which is what `CommandPrior` has always been
    // able to hold. `styleAnnotation` refused for exactly the missing half —
    // it names several annotations and would need a list.
    invertible: true,
    undo: 'inverse',
    // `setTextValue`, `setChoiceValue` and `toggle()` write a value and the
    // appearance stream that displays it. No clock, no identifier: the same
    // measurement `addAnnotation` records for the object beside it.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // THE SECOND MEMBER OF THIS AXIS, and the one `engineSeam.ts` anticipated
    // by name. Its payload points into an answer `document.formFields` gave at
    // one version — a different walk from the annotation one, which is why it
    // is a different member rather than the same word.
    targets: 'field',
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  deleteFormFields: {
    kind: 'deleteFormFields',
    // A widget is an object in `/Annots` and an entry in `/AcroForm`'s tree, so
    // removing one is a page-tree and catalog write — `removeAnnotation`'s
    // classification with a second structure attached. Nothing a content-stream
    // writer could do would remove a field; it would paint over the appearance
    // and leave the object fillable.
    writer: 'mupdf',
    // TERMINAL, and it is `removeAnnotation`'s reason strictly larger rather
    // than a new one: the prior state is the widget's whole object graph — a
    // dictionary that may reference an appearance stream, which references
    // fonts and images — plus the field dictionary that held it and every
    // ancestor pruned with it. Unbounded, unserialisable here, and a log whose
    // `retainedBytes` counts checkpoints only would under-report it. ADR-0041's
    // handle does not unblock this: naming the field was never the difficulty.
    invertible: false,
    undo: 'checkpoint',
    // Removing objects writes no date and consults no clock.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // Its payload points into an answer `document.formFields` gave at one
    // version, as `fillFormField`'s does.
    targets: 'field',
    reads: 'none',
    asset: 'none',
    // ORDINARY, beside a command whose purpose is removal, and the pair is what
    // makes the axis worth having. Deleting a field is editing a form; the
    // widget goes and the person is not asserting that its value must not
    // survive in the bytes. §4's removal row is about redaction, sanitize,
    // flatten, encryption and metadata — a different claim from *this object is
    // gone from the page*.
    purpose: 'ordinary',
  },
  flattenFormFields: {
    kind: 'flattenFormFields',
    // `docs/ARCHITECTURE.md` §3 names the call: *"Form fields: flatten —
    // MuPDF, `bake(false, true)`"*. Settled before this row existed, so no B4
    // on the routing. The one that WAS owed is ADR-0045's, on the save.
    writer: 'mupdf',
    // TERMINAL, and larger than `deleteFormFields`' reason rather than a new
    // one: this loses every widget in the document AND rewrites the content
    // stream of every page one sat on. There is no bounded prior state.
    invertible: false,
    undo: 'checkpoint',
    // Measured 2026-09-07 across a deliberate 1.1s gap, so the byte comparison
    // straddles a clock tick: two bakes of the same input produce identical
    // bytes, and the output's `/ModDate` is the INPUT's. MuPDF stamps nothing.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // NAMES NOTHING, unlike the two form commands above it. `bake` takes no
    // page and no field list, so there is no answer this could be stale
    // against — which is also why its payload carries no version.
    targets: 'none',
    reads: 'none',
    asset: 'none',
    // THE FIRST COMMAND ON THIS AXIS THAT IS NOT `'ordinary'`, and the reason
    // the axis exists at all. §4 puts flatten on the removal row by name, and
    // the measurement says what that costs if it is not honoured: the bake
    // unlinks nine widgets and a plain save writes all nine back out, the
    // object count growing 49 to 55.
    purpose: 'removal',
  },
  createFormField: {
    kind: 'createFormField',
    // `docs/ARCHITECTURE.md`:388 names the writer and the reason in one line:
    // "@cantoo/pdf-lib — the one concern MuPDF has no API for". So the three
    // form commands above route to the structural writer of record and this one
    // does not, which is the matrix splitting a concern by OPERATION — its own
    // granularity, not an exception to B3.
    writer: 'pdf-lib',
    // NOT INVERTIBLE, and the reason is NOT the byte-image family's. A drawn-on
    // page has no bounded prior state; a create's prior state is *this field did
    // not exist*, which would fit in four words. What rules it out is measured:
    // a create on a document with no `/AcroForm` MINTS one, so removing the
    // field afterwards leaves a document that is not the one handed in. An undo
    // that restores almost the prior state is worse than none.
    //
    // `watermarkPages` anticipated exactly this entry in prose — "deliberately
    // NOT a type constraint: §3's matrix assigns form-field creation to pdf-lib,
    // and that is plausibly invertible". Plausible, and not free; the checkpoint
    // the bus already holds costs nothing (ADR-0039).
    invertible: false,
    undo: 'checkpoint',
    // `openForWriting` pins `updateMetadata: false`, which is what makes this
    // true rather than a hope — an unpinned load rewrites `/ModDate` on save and
    // the defect surfaces only as a flake, when two applies straddle a second.
    // `monstera/no-unpinned-pdf-load` is the mechanism; this line is the claim
    // that mechanism supports.
    //
    // Nothing else here mints an identifier or reads a clock: the font is a
    // standard-14 embedded by name, so there is no font program whose bytes
    // could differ between runs.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // SELF-CONTAINED, like `addAnnotation` and unlike the fill and delete above.
    // It carries a page, a rectangle, a name and a kind — there is no earlier
    // answer it could be stale against, which is also why its payload carries no
    // version. The one collision it can have is with an existing field of the
    // same name, and that is a refusal at apply: the document is the only thing
    // that knows, exactly as it is for every type rule on the fill.
    targets: 'none',
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  importFormData: {
    kind: 'importFormData',
    // MuPDF, and for two reasons rather than one. It WRITES values, which §3's
    // matrix puts on MuPDF; and it READS an FDF, which is PDF syntax and has no
    // API of its own — measured 2026-09-08, `fdf` appears zero times in
    // `mupdf.d.ts`. Both halves happen where the engine is.
    writer: 'mupdf',
    // NOT INVERTIBLE. The prior is every value of every field the file happens
    // to name — a set the command cannot know until it has parsed, spread
    // across the whole document. `flattenFormFields`' reason at a smaller
    // scale: the checkpoint restores it exactly and an inverse would have to
    // carry a second whole form.
    invertible: false,
    undo: 'checkpoint',
    // The values in the file decide the writes, and `setTextValue`,
    // `setChoiceValue` and the bounded toggle are the same three calls the fill
    // row makes — none of which mints an identifier or stamps a date.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // MATCHES BY NAME, so it names nothing a walk answered. `flattenFormFields`'
    // reason, which is also why the payload carries no version.
    targets: 'none',
    reads: 'none',
    // THE SECOND COMMAND ON THIS AXIS, and the one that made the member's name
    // wrong out loud (ADR-0044's 2026-09-08 correction). A picked file's bytes
    // cannot cross a JSON wire, so they travel the granted directory the
    // document itself arrives through.
    asset: 'bytes',
    // IT REMOVES NOTHING. Every write here replaces a value in place; no object
    // is unlinked, so there is nothing for a collecting save to sweep.
    purpose: 'ordinary',
  },
  replaceTextObject: {
    kind: 'replaceTextObject',
    // THE FIRST COMMAND ROUTED TO PDFIUM, which is what makes the second host
    // buildable at all: `KindsRoutedTo<'pdfium'>` was `never` until this line,
    // and a zod union of zero options cannot be built. `BUILD-PROMPT.md`:257
    // assigns in-place text editing to PDFium in both columns and ADR-0006 kept
    // that row; MuPDF's text API is extraction, so this is a classification
    // rather than a preference.
    writer: 'pdfium',
    // INVERTIBLE, and it is the first byte-image command that is — which
    // `commandDeclarations.test.ts` carried a trigger for and
    // [ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)'s
    // addition of 2026-09-09 priced before this landed.
    //
    // The comparison that decides it is invertible-against-terminal with the
    // writer held fixed, not against a live-session equivalent: `#sessionFor`
    // calls `ByteImageAccess.current()` for every byte-image command whatever
    // its invertibility, so the serialise is common to both and the whole
    // difference is RETENTION. `CommandLog.trimTo`: *an invertible entry
    // retains no document-scaled bytes*, against one whole document image per
    // terminal entry. Text editing is many small commands against one document,
    // and §4 reserves checkpoints for redaction, flatten, encryption and OCR
    // because they are the exception.
    invertible: true,
    undo: 'inverse',
    // The prior is one object's string put back into the object it came from.
    // Nothing here mints an identifier, stamps a date or asks a model — setting
    // the same text twice produces the same content stream.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // PDFIUM'S PAGE-OBJECT WALK, which is a third index space and not a widening
    // of either MuPDF one — `CommandTargets`' own note says why the two engines'
    // numberings must never be assumed comparable.
    targets: 'text-object',
    reads: 'none',
    // The replacement is a bounded string in the payload. Nothing about a text
    // edit carries bytes a JSON wire cannot express.
    asset: 'none',
    // IT REMOVES NOTHING. `FPDFText_SetText` replaces an object's string in
    // place and `FPDFPage_GenerateContent` rewrites the page's content stream;
    // no object is unlinked, so there is nothing for a collecting save to
    // sweep. **The old glyphs do not survive** — the content stream is
    // regenerated whole — which is the question a reader of `SavePurpose`
    // should be asking here and is a fact about the regeneration rather than
    // about the classification.
    purpose: 'ordinary',
  },
  placePageObject: {
    kind: 'placePageObject',
    writer: 'pdfium',
    // INVERTIBLE FROM THE OBJECT'S OWN MATRIX, and that is measured rather than
    // reasoned: `FPDFPageObj_SetMatrix` of the matrix read before a transform
    // returns the object's bounds to exactly what they were (2026-09-10). So
    // the inverse RESTORES rather than applying the opposite transform — which
    // matters beyond ADR-0009 §3's rule, because an opposite transform composed
    // repeatedly drifts and a restored matrix does not.
    invertible: true,
    undo: 'inverse',
    // Six floats set on an object. Nothing mints an identifier or reads a clock.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    targets: 'text-object',
    reads: 'none',
    asset: 'none',
    // A transform rewrites the page's content stream and unlinks nothing.
    purpose: 'ordinary',
  },
  recolorPageObjects: {
    kind: 'recolorPageObjects',
    writer: 'pdfium',
    // INVERTIBLE FROM THE PRIOR FILLS, one per named object — `fillFormField`'s
    // shape on a third walk. The prior is four small integers per object and is
    // bounded by the page, so the entry retains no document-scaled bytes.
    invertible: true,
    undo: 'inverse',
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    targets: 'text-object',
    reads: 'none',
    asset: 'none',
    purpose: 'ordinary',
  },
  deletePageObjects: {
    kind: 'deletePageObjects',
    writer: 'pdfium',
    // NOT INVERTIBLE, AND IT IS THE LIBRARY THAT SAYS SO. PDFium offers no way
    // to reconstruct a page object from a description, so there is no prior
    // state a capture could hold — a removed object is gone. This is the same
    // classification `flattenFormFields` has and it arrives for a different
    // reason: there the prior is document-scaled, here there is no prior at all.
    //
    // So undo takes a checkpoint, which costs one whole document image per
    // entry (`CommandLog.trimTo`). That is the price of the row rather than a
    // choice inside it.
    invertible: false,
    undo: 'checkpoint',
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    targets: 'text-object',
    reads: 'none',
    asset: 'none',
    // NOT `'removal'`, and the distinction is the AXIS's mechanism rather than
    // the word. `purpose: 'removal'` selects MuPDF's collecting save
    // ([ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md)):
    // `withDocumentRemoving` marks the session and `serialise` collects from
    // then on. This command's writer of record is PDFium, whose
    // `FPDF_SaveAsCopy` has no garbage-collection option at all — so there is
    // nothing here for the axis to select, and declaring `'removal'` would name
    // a mechanism that cannot run.
    //
    // What that leaves open is whether an unlinked object survives in PDFium's
    // saved bytes, and `proof:pdfiumobject` measures it rather than this
    // comment asserting it. **Measured 2026-09-10, and the first reading was
    // misleading**: removing two objects from a 1,170-byte fixture answered
    // 1,613 bytes, +38%, which reads as orphans. It is not. A PDFium save with
    // NO EDIT AT ALL answers 1,664 — +42% — because `FPDF_SaveAsCopy` is a full
    // rewrite with its own object layout and pdf-lib's output is unusually
    // compact. Against that control the removal is 3.1% SMALLER, so the growth
    // belongs to the save and nothing here is accumulating.
    //
    // The control is what makes the figure mean anything, and it is kept in the
    // proof rather than only here: size against the original would have been a
    // symptom recorded as a cause.
    purpose: 'ordinary',
  },
  replaceAllText: {
    kind: 'replaceAllText',
    writer: 'pdfium',
    // NOT INVERTIBLE, AND THE PRIOR IS WHY — which is a different reason from
    // `deletePageObjects`' beside it. A prior exists here: every object this
    // changed, with the string it held. It is **document-scaled**, and
    // `CommandLog.trimTo`'s rule is that an invertible entry retains no
    // document-scaled bytes — a replace-all over a thousand pages would keep a
    // thousand pages' worth of strings in the log for ever.
    //
    // So undo takes a checkpoint, which is one whole document image. That is
    // the cheaper of the two and it is bounded by the document rather than by
    // how much of it the command touched.
    invertible: false,
    undo: 'checkpoint',
    // The same two strings against the same bytes produce the same edit. Nothing
    // mints an identifier, stamps a date or asks a model.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // NAMES NOTHING, `flattenFormFields`' shape: there is no answer this could
    // be stale against, which is also why its payload carries no version. A
    // replace-all is *change these words wherever they are*, and a document that
    // moved since the box was typed into has not made that a different request.
    targets: 'none',
    reads: 'none',
    asset: 'none',
    // IT REMOVES NOTHING. Every write replaces an object's string in place and
    // the page's content stream is regenerated whole; no object is unlinked.
    purpose: 'ordinary',
  },
  promoteFormObjects: {
    kind: 'promoteFormObjects',
    writer: 'pdfium',
    // NOT INVERTIBLE, AND IT IS THE FOURTH DISTINCT REASON — the first one's,
    // reached from the other end. `deletePageObjects` cannot be undone because
    // PDFium can describe an object and not rebuild one; this cannot because
    // PDFium can take a Form XObject apart (`FPDFFormObj_RemoveObject`) and
    // offers nothing that builds one. Every piece is still on the page; the
    // container has no constructor.
    invertible: false,
    undo: 'checkpoint',
    // THE SAME PAGE PROMOTES THE SAME WAY. The matrices come off the objects
    // and the composition is arithmetic — nothing mints an identifier or asks
    // the clock. A second run finds no form and does nothing, which is the same
    // bytes rather than a different edit.
    reproducible: true,
    replay: 'reapply-intent',
    sources: 'none',
    // NAMES NO INDEX, `replaceAllText`'s shape. It names a page and every form
    // on it, so there is no walk for a version to be stale against — which is
    // also why its payload carries none. That tie is asserted in
    // `commandDeclarations.test.ts` rather than left to two files agreeing.
    targets: 'none',
    reads: 'none',
    asset: 'none',
    // IT UNLINKS THE EMPTIED FORM, and `'removal'` is still wrong for
    // `deletePageObjects`' reason: that axis selects MuPDF's collecting save,
    // and this command's writer is PDFium, whose `FPDF_SaveAsCopy` has no
    // equivalent. Declaring it would name a mechanism that cannot run.
    purpose: 'ordinary',
  },
} satisfies CommandDeclarations;

/** The declarations as declared, with each writer's literal type intact. */
export type DeclaredCommands = typeof declarations;

/** The table every routing consumer reads. */
export const declaredCommands: DeclaredCommands = declarations;

/** Which writer of record a given command kind is routed to. */
export type WriterOf<K extends CommandKind> = DeclaredCommands[K]['writer'];
