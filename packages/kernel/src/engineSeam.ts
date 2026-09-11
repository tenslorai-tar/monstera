import type { CommandKind, CommandOfKind, OutlineEntry } from '@monstera/contract';
import type { Brand } from '@monstera/shared';

import type { CaptureResult, CommandPrior } from './commandLog.js';
// TYPE-ONLY, and it has to be: `ocrRecognise.ts` instantiates a WASM engine on
// its first call, and a value import here would put 2.8 MB of Tesseract behind
// every module that reads this seam's types. The import is erased.
import type { RecognisedPage, RecognitionRequest } from './ocrRecognise.js';

/**
 * The seam between the kernel and the engines that write documents (ADR-0009
 * §8).
 *
 * ## It must express two writer shapes, and that is a claim about the TYPE
 *
 * §8's constraint is that the seam express **whole-byte-image writers, not only
 * index-based ops**, and the failure it names is *"a seam modelled only on
 * live-session operations"*. Both are statements about what the type can say,
 * not about how many adapters exist — three of the four writers of record
 * (`@cantoo/pdf-lib` field creation, PDFium text editing, `@signpdf`) consume
 * and produce whole byte images, and a seam that cannot describe them would be
 * a seam redesign underneath Stage 4's features.
 *
 * So: **both shapes live in the type.**
 *
 * **THIS PARAGRAPH SAID *exactly one adapter implements it* AND *the byte-image
 * side has nothing behind it*, AND BOTH WENT STALE WITHOUT ANY COMMIT OPENING
 * THIS FILE.** `pdfLibWriter.ts` put a byte-image writer behind the seam under
 * ADR-0039, and `pdfiumFfi.ts` put a second one there on 2026-09-09. Three
 * adapters now, one live-session and two byte-image. NNN-4's hole exactly: a
 * claim a range falsifies without touching the sentence, which no range-scoped
 * sweep can reach and no link check can see, because both readings parse.
 *
 * **AND IT WENT STALE AGAIN THE SAME DAY, ELEVEN LINES ABOVE AN EDIT IN THIS
 * FILE** (finding CCCCCC-2). The sentence above read *"a second live-session
 * one"* until ADR-0047 made PDFium a byte-image writer — in `63f10be`, which
 * changed `writerShapes` a few lines below and did not read up. So NNN-4's
 * compensation is narrower than it sounds: *sweep every other statement of the
 * relationship* was performed across the documents and skipped the file being
 * edited, because the edit was three lines long. **Read the whole comment of
 * anything you touch, starting above the change.**
 *
 * The control below is kept and is *not* the argument it was written as. It was
 * *an unimplemented variant nobody constructs is a vacuous check*, and the
 * variant is implemented now — so what the fixture proves is narrower and still
 * worth having: a **type-level fixture in `scripts/proofs/contract.proof.mjs`**
 * builds a byte-image writer and a byte-image `Apply`, satisfying these types
 * with no type assertion in it. If it ever needs an assertion to compile, the
 * type does not express the shape and that is the finding — not an obstacle to
 * route around.
 *
 * The precedent that was cited for a deliberately empty seam is ADR-0018's
 * `WebUpdateProvider`, registered with nothing behind it and explicitly not to
 * be deleted as dead code. **It no longer applies**, the seam having stopped
 * being empty, and it is recorded rather than deleted because the reason it was
 * reached for is the thing that expired: an empty registration is visible on
 * inspection and a type's expressiveness is not.
 *
 * ## §8's second constraint is ENABLED here, not satisfied
 *
 * §8 says `DocumentService` keeps the canonical bytes, so that killing an
 * engine process — ADR-0007's *designed* response to a memory breach — is a
 * re-open rather than a loss.
 *
 * What this seam does is keep that reachable: `open` takes bytes and
 * `serialise` returns them, so **nothing forces an engine to become
 * authoritative**. A live-session-first design drifts naturally into "the
 * session *is* the document", and this shape does not.
 *
 * **What it does NOT do is satisfy the constraint.** `DocumentService` holds no
 * bytes today — its record is `docId`, `handle`, `path`, `openedIdentity`,
 * `version`, `savedVersion`, and the lane. So killing an engine host right now
 * loses everything since the last save; the only bytes anywhere are the file on
 * disk. An earlier draft of this comment said the opposite, which would have
 * been read as a guarantee by exactly the code that depends on it.
 *
 * Retaining a full document image per open document is its own design unit with
 * ADR-0007 budget consequences, so it is sized rather than arriving as a field.
 * The obligation has a **trigger** rather than a place on a list:
 * `kernel-holds-canonical-bytes` in `docs/security/engine-advisories.json` turns
 * `check:advisories` red the day `documentService.ts` names `ByteImage` or
 * `Uint8Array` — which is the day a save pipeline or a recovery path first
 * assumes the bytes are there.
 */

/**
 * Canonical document bytes.
 *
 * Owned by the kernel, handed to engines. A byte-image writer's "session" is
 * one of these, which is what lets both shapes share a lifecycle.
 */
export type ByteImage = Uint8Array;

/** How a writer of record applies a command. */
export type WriterShape = 'live-session' | 'byte-image';

/**
 * A live MuPDF session.
 *
 * Opaque on purpose: the kernel passes it back to the adapter and to the
 * command that declared MuPDF as its writer, and nothing else may reach into
 * it. The concrete document lives in the adapter module.
 *
 * **Branded, for the same reason `CanonicalPath` is.** Unbranded this was
 * `{ readonly engine: 'mupdf' }`, which any object literal satisfies
 * structurally — so a fabricated session type-checked and the adapter's
 * `WeakMap` caught it at runtime, on its way to a native call. The hazard is
 * strictly worse than the one branding already covers for paths (a wrong string
 * comparison), so leaving this one to a runtime check would have been an
 * asymmetry with no argument behind it.
 *
 * The brand and the `WeakMap` do different jobs and both are needed: the brand
 * makes fabrication a **compile error**, and the `WeakMap` covers what a brand
 * cannot — a genuinely-minted session that has already been closed, or one
 * minted by a different adapter instance.
 */
export type MupdfSession = Brand<{ readonly engine: 'mupdf' }, 'MupdfSession'>;

/**
 * A live PDFium session. `pdfiumFfi.ts` is behind it, as of 2026-09-09.
 *
 * **It is NOT `WriterSession['pdfium']`, and that stopped being the same thing
 * on 2026-09-09**
 * ([ADR-0047](../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)).
 * PDFium is a byte-image writer of record, so what the **bus** hands its writer
 * is the document's bytes; this brand names the handle `pdfiumFfi.ts` holds
 * *inside one command*, between its own `open` and `close`, which is where a
 * live PDFium document exists and the only place it does.
 *
 * The distinction is worth the paragraph because the two used to coincide and
 * a reader who assumes they still do will look for a session table that is
 * deliberately absent: a writer that holds nothing between commands is what
 * keeps *which bytes win* unaskable.
 */
export type PdfiumSession = Brand<{ readonly engine: 'pdfium' }, 'PdfiumSession'>;

/**
 * What each writer of record works on.
 *
 * A mapped lookup rather than a per-command declaration, so a command that
 * names `mupdf` cannot be handed a PDFium session — a B3 violation becomes a
 * type error at the point of authoring rather than a review comment (§6).
 */
export interface WriterSession {
  readonly mupdf: MupdfSession;
  /**
   * The document's **bytes**, not a handle — ADR-0047, 2026-09-09.
   *
   * This read `PdfiumSession` from Stage 0, when nothing was behind either. An
   * in-place text edit is a byte-image command, so the bus mints this for one
   * call from the live writer's `serialise` and never stores it. The live
   * PDFium handle exists only inside `pdfiumFfi.ts`, between its own `open` and
   * `close`, and never reaches this table.
   */
  readonly pdfium: ByteImage;
  readonly 'pdf-lib': ByteImage;
  readonly signpdf: ByteImage;
}

/**
 * The sessions one open document has, keyed by writer of record.
 *
 * Partial because a document acquires a session per engine **lazily** — the one
 * that opened it, plus any a later command needs — so "no session for this
 * writer" is an ordinary state rather than a gap.
 *
 * Declared here rather than beside the component that holds one, because
 * `CommandBus.undo` takes it: undo reads the log to find which writer the last
 * entry routes to, and only then knows which session it needs. A caller cannot
 * pick that session in advance — reading the log needs a token the bus holds —
 * so handing over one session forced a cast at the point the bus already knew
 * the answer, and a cast is where the type stops carrying the property.
 */
export type SessionsByWriter = {
  readonly [W in keyof WriterSession]?: WriterSession[W];
};

/**
 * Which shape each writer of record is — **the value, from which the type is
 * derived** ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## Why a value, when this was an interface
 *
 * `CommandBus.execute` has to branch: a byte-image `apply` **returns** the new
 * document and a live-session one returns nothing, so what the bus does with
 * the result differs by writer. The shape was expressible only in the type
 * system, and a type cannot be read at the moment a decision is made.
 *
 * The rejected alternative is the one that needs no table — branch on
 * `applied !== undefined`. That infers a writer's shape from what an adapter
 * happened to return, so an adapter that forgets its `return` becomes a
 * document that silently stops updating: the command succeeds, the log records
 * it, the version bumps, and the bytes never move. Reading the declaration
 * makes that a `TypeError` at the writer rather than a wrong document.
 *
 * ## One declaration, so the two cannot disagree
 *
 * `WriterShapeOf` is `typeof this`, not a sibling interface checked against it
 * with `satisfies`. A `satisfies` pair is two declarations that a checker keeps
 * equal, which is the shape B3 spends its time on; deriving the type leaves
 * exactly one place a writer's shape is stated.
 *
 * This module is the right home because it is where the shape asymmetry is
 * defined ({@link Apply}, {@link Invert}) and because it is **import-free at
 * runtime** — every import in this file is `import type`, so a value here costs
 * an importer nothing but the object literal.
 */
export const writerShapes = {
  mupdf: 'live-session',
  // 'live-session' FROM STAGE 0 UNTIL 2026-09-09, declared with nothing behind
  // it and changed on the first evidence (ADR-0047). An edit that mutated a
  // session inside a host would be sound, undoable, savable and invisible: the
  // renderer reads main's canonical image and the view model carries only
  // rotations, so the bytes must come back either way.
  //
  // A live session would still save the INPUT serialise `#sessionFor` takes
  // from `ByteImageAccess.current`, which for an invertible command — a text
  // replacement is one — is not a checkpoint the bus was taking anyway. That is
  // bounded and available inside this shape, since `adopt` makes the new bytes
  // main's canonical image. What the live session costs is not a number:
  // savePipeline.ts's *which bytes win* rule, a session table inside a
  // contained host, and staleness in both directions. Holding nothing between
  // commands keeps that question unaskable rather than answered under a
  // feature.
  pdfium: 'byte-image',
  'pdf-lib': 'byte-image',
  signpdf: 'byte-image',
} as const satisfies Readonly<Record<keyof WriterSession, WriterShape>>;

/** Which shape each writer of record is. Derived — see {@link writerShapes}. */
export type WriterShapeOf = typeof writerShapes;

/**
 * Session lifecycle, shared by both shapes.
 *
 * `open` takes the bytes and `serialise` gives them back, which is what keeps
 * the kernel the owner of canonical state. For a byte-image writer `TSession`
 * *is* the byte image and both are identity — the shape difference shows up in
 * {@link Apply}, not here.
 */
export interface EngineWriter<TSession> {
  /** Parses `image` into a session. The image is not retained by the engine. */
  open(image: ByteImage): Promise<TSession>;
  /**
   * The canonical bytes for the session's current state.
   *
   * **No purpose parameter, deliberately** — see {@link SavePurpose}. A removal
   * is a fact about what has been applied to the session, not about the moment
   * somebody asks for its bytes, so the adapter that owns the session carries
   * it and no caller can forget to. A parameter here would have to be supplied
   * correctly by the checkpoint mint, the save flush, save-a-copy, extract and
   * export, which is five chances to get one rule wrong (B5 over a rule).
   */
  serialise(session: TSession): Promise<ByteImage>;
  /** Releases native resources. Safe to call once per session. */
  close(session: TSession): Promise<void>;
}

/**
 * How a command mutates its writer's session — **the shape difference, in the
 * type**.
 *
 * - A **live-session** writer is mutated in place and returns nothing. §8:
 *   "the writing engine's session is mutated in place and version-stamped;
 *   every non-writing engine's handle is invalidated." Returning a new session
 *   here would force the writer to re-parse its own output on every command,
 *   which is the reading §8 was amended to reject.
 * - A **byte-image** writer consumes an image and produces a new one. It cannot
 *   mutate in place, so a signature demanding it would make three of the four
 *   writers of record inexpressible.
 *
 * Conditional on the writer, so a spec cannot declare `pdf-lib` and then write
 * a mutate-in-place `apply`.
 */
/**
 * How the bus reads a command's prior state — **the same session binding as
 * {@link Apply}, and the same shape for both writer kinds.**
 *
 * Capture only ever reads, so there is no live-session/byte-image asymmetry
 * here: it takes whatever the writer's session is and returns a result. The
 * binding to `WriterSession[W]` is what stops a spec declaring one writer and
 * capturing through another's session.
 *
 * It cannot return a `Checkpoint`. That is one of the three doors ADR-0009 §4's
 * "never by a handler" is held shut by.
 */
export type Capture<W extends keyof WriterSession, K extends CommandKind> = (
  session: WriterSession[W],
  command: CommandOfKind<K>,
) => Promise<CaptureResult<CommandPrior[K]>>;

/**
 * How many OTHER documents a command's apply is given sessions for
 * ([ADR-0040](../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)
 * Decision 4).
 *
 * `'none' | 'one'` and not a count. Nothing in D2 merges three documents at
 * once, and a list would make *how many* a runtime question at every call site
 * for a capability nothing asks for. The day a command needs two sources this
 * widens, and the widening is a **compile error at every `apply`** — which is
 * the direction that fails safe.
 *
 * It lives here rather than beside the declarations for a module-graph reason
 * that is worth stating, because the ADR's *"`Apply` is conditional on it
 * exactly as it is already conditional on the writer's shape"* reads as though
 * it could be: `commandDeclarations.ts` imports `WriterSession` from this file,
 * so this file cannot import the declarations back. {@link Apply} therefore
 * takes the axis as a **third type parameter**, and `commandSpecs.ts` — which
 * sees both — is where it is bound to what a command declared. That is exactly
 * how `W` already works, so the mechanism is the existing one rather than a new
 * one.
 */
export type CommandSources = 'none' | 'one';

/**
 * What existing state a command NAMES, and therefore what makes it stale
 * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 * Decision 3).
 *
 * ## It does not touch `Apply`, and that is the difference from `CommandSources`
 *
 * The sources axis changes what an apply is HANDED, so it is a type parameter
 * of {@link Apply} and binds at the spec. This one changes what the bus does
 * BEFORE it applies anything: an apply receives the same session and the same
 * command either way, and never learns that a version was compared. So it is a
 * declaration the bus branches on and nothing else, and no signature moves.
 *
 * Worth stating because the two axes look alike in the table and are not the
 * same kind of thing. If a future member of this needs the apply to know, that
 * is the day it gains a type parameter — and the widening will be a compile
 * error at the bus rather than a silent second meaning here.
 *
 * ## `'annotation'` rather than `'versioned'`
 *
 * The value names WHAT is named, not the mechanism for checking it. A member
 * called `'versioned'` would answer *how* and leave every reader to work out
 * *what*, which is the shape that lets a second unrelated command declare it
 * because the mechanism happens to fit.
 *
 * ## `'field'` ARRIVED, 2026-09-07, and it is the paragraph above cashed
 *
 * The sentence here read *a form field named by index will want its own member,
 * and the two refusals will not be the same sentence*. Both halves held. The
 * walks are disjoint — measured, a page carrying seven widgets answers zero
 * annotations — so an index means a different thing under each member, and the
 * refusals are written separately in `pageAnnotations.ts` and `formFields.ts`
 * because *there is no annotation there* and *there is no widget there* are
 * different facts about the same page.
 *
 * What the bus does with them is identical, and that is the axis working rather
 * than a missed abstraction: staleness is one comparison, and the member is
 * what says which answer the payload's index points into.
 *
 * ## `'text-object'` ARRIVED, 2026-09-09, and it is the first member from a
 * SECOND ENGINE
 *
 * The two members above are two of MuPDF's walks. This one is PDFium's page
 * objects, and the gap between them is wider than the gap between the first
 * two: annotations and widgets are disjoint lists produced by one parser, where
 * a page-object index is a **different engine's numbering of the same page**.
 * Nothing joins them, and nothing here should ever try — `docs/FEATURES.md`'s
 * find-and-replace row names that join as the row's real work, and
 * `SHOWN_PAGE`'s lesson says where the correspondence would have to live if one
 * were ever built.
 *
 * So the member says *this index came from PDFium's read of this page at this
 * version*, and the refusal it enables is that the document has moved since.
 * What it does NOT do — and this is the paragraph above cashed a second time —
 * is make the three index spaces comparable.
 */
export type CommandTargets = 'none' | 'annotation' | 'field' | 'text-object';

/**
 * What a command's bytes are FOR, which decides how they are serialised.
 *
 * [ADR-0045](../../../docs/DECISIONS/0045-a-removals-garbage-collection-belongs-to-the-command.md),
 * and `docs/ARCHITECTURE.md` §4's removal row given somewhere to live. A
 * command whose purpose is removal must produce bytes that no longer contain
 * what it removed, and MuPDF's plain save does not: measured 2026-09-07,
 * `bake(false, true)` unlinks nine widgets and `saveToBuffer('')` writes all
 * nine out again, with the object count **growing** 49 to 55.
 *
 * ## Two members where §4's table has three rows
 *
 * *Never incremental for removal* and *always incremental to preserve a
 * signature* are both in that table, and only the first is a property of what a
 * command's bytes CONTAIN. The second is a property of how a **file is
 * written** — a full rewrite changes the byte ranges a PKCS#7 signature covers
 * — and nothing here writes files. It arrives when Stage 7 has a signature to
 * preserve; declaring a member nothing can produce is the shape `kindOf`'s
 * unreachable `'other'` already cost this build a reading of.
 *
 * ## A purpose, not a mechanism
 *
 * `'ordinary'` rather than a boolean called `collectsGarbage`, because the
 * mechanism is the adapter's business and the purpose is the command's. A
 * boolean would put *does MuPDF need its `garbage` option* at every declaration
 * site, where the answer depends on which engine the command happens to be
 * routed to — and a command's purpose does not change when its writer does.
 *
 * ## This is a DECLARATION, and {@link EngineWriter.serialise} does not take it
 *
 * The obvious wiring is a parameter on `serialise`, and it is wrong for a
 * reason that only shows up in the code: a live-session command produces no
 * bytes of its own. `CommandBus.execute` serialises **before** apply, to mint
 * the checkpoint, so the flatten's own execution never asks for bytes at all —
 * and MuPDF has no in-session collection, so the orphans it unlinks sit in the
 * session until it closes.
 *
 * The removal is therefore a fact about the **session**, and the adapter that
 * owns the session is what remembers it. A parameter would have to be supplied
 * correctly at five call sites — the next checkpoint, the save flush,
 * save-a-copy, extract, export — which is a rule five callers apply rather than
 * a state one component holds.
 *
 * What this type is for is §4's sentence: *"A command whose purpose is removal
 * cannot be added without classifying it."* The classification is read by the
 * apply that marks the session, and by the test roster that requires every
 * command declaring `'removal'` to produce bytes its removal is gone from.
 */
export type SavePurpose = 'ordinary' | 'removal';

/**
 * Does this command carry BYTES that cannot travel on the wire the writer is
 * reached over
 * ([ADR-0044](../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md))?
 *
 * ## It touches neither `Apply` nor the bus, and that is the point
 *
 * {@link CommandSources} changes what an apply is handed; {@link CommandTargets}
 * changes what the bus does before applying. This one changes neither. An
 * `apply` receives the whole command, bytes included, exactly as it always has,
 * and every kernel caller is unmoved — the field leaves the payload in the
 * **transport** and is put back before the handler calls anything.
 *
 * So the axis is read by two modules that already are the transport, and by
 * nothing else. Declaring it here rather than inferring it from a payload that
 * happens to hold a `Uint8Array` is {@link CommandSources}' argument one axis
 * along: a command that carries bytes is not the same statement as a command
 * whose bytes must leave the wire, and reading one off the other is the partial
 * reimplementation B3a is about. `insertImagePage` is the proof of that
 * distinction — it carries an image and declares `'none'`, because a byte-image
 * writer runs in main and its wire is a function call.
 *
 * ## Conditional on the command, so the illegal state cannot be written
 *
 * A kind whose payload has no `bytes` field cannot declare `'bytes'`: there is
 * no member of this union for it but `'none'`. That is B5 over a rule the
 * transport would otherwise have to enforce at runtime, where the failure is a
 * command whose asset the handler looks for and does not find — after the
 * frame has been sent.
 *
 * ## The member was spelt `'image'` until 2026-09-08
 *
 * ADR-0044 named it after the payload that needed it first, and the paragraph
 * at the top of this comment is the argument that it was wrong from that day:
 * the question is about the WIRE, and an image is a content type. Nothing ever
 * branched on the member — the transport tests `asset === 'none'` — so an FDF
 * declared as an image would have worked and been a lie, which is why the
 * correction is a rename rather than a second member beside it.
 */
export type CommandAsset<K extends CommandKind> =
  | 'none'
  | (CommandOfKind<K> extends { readonly bytes: Uint8Array } ? 'bytes' : never);

/**
 * What a command's apply is handed that it could not read for itself.
 *
 * ADR-0040's 2026-09-05 extension. Decision 3 established the shape — *the bus
 * resolves what an apply needs and hands it in* — and named one instance, a
 * second document's sessions. This is the second: a value read through a
 * **different engine** than the one doing the writing.
 *
 * `generateToc` is what asked for it. §3's matrix puts TOC generation on
 * `@cantoo/pdf-lib` and outline reading on MuPDF, and a byte-image `Apply` is
 * `(image, command)` with **no session** — so a pdf-lib TOC would have to walk
 * `/Outlines` itself, which is a second opinion about a question
 * `destinations.ts`' `readDestinations` owns (B3a). It would agree with that
 * module for every ordinary outline and differ on the ones that matter: a
 * cycle, a destination resolved through the name tree, an entry with no
 * reachable page.
 *
 * **A separate axis from {@link CommandSources}, not a widening of it.** They
 * answer *which documents* and *what pre-read data*, they combine independently
 * — a merge that regenerated the target's TOC would be both — and folding them
 * would make `sources: 'outline'` read as a document called outline.
 *
 * **Derived from {@link PreRead} rather than listed beside it**, so the axis's
 * members and the values they name have one declaration. A member added there
 * widens this, becomes a compile error at every implementation of
 * {@link CommandBus}' access object, and cannot be declared without saying what
 * it resolves to — where a hand-kept union would accept a member nothing can
 * supply.
 */
export type CommandReads = 'none' | keyof PreRead;

/**
 * What each member of {@link CommandReads} names, other than `'none'` — **what it
 * answers, and what it must be told to answer it**
 * ([ADR-0051](../../../docs/DECISIONS/0051-a-pre-read-may-be-parameterised-and-a-stored-effect-replays-it.md)).
 *
 * One member per readable value, and the member's **name is the axis's
 * member** — `reads: 'outline'` means *hand me `PreRead['outline']`*. Everything
 * downstream is derived from here: {@link CommandReads}, {@link PreRead} and
 * {@link PreReadAccess}. So a member added to this interface widens the axis,
 * stops every implementer of the access object compiling until it supplies one,
 * and **cannot be declared without saying both halves** — where a hand-kept
 * union would accept a member nothing can supply and a second interface beside
 * this one could drift from it.
 *
 * ## `needs` is `never` for a member that needs nothing, and that is the B5
 *
 * A pre-read took no argument until 2026-09-11, because an outline is a property
 * of the **document**. A recognition is a property of a **page**. The shape that
 * expresses both is a per-member argument type, so `access.outline(page)` and
 * `access.ocr()` are each a compile error — against an optional argument on every
 * member, which makes both of those legal and leaves the rule in a comment
 * somebody has to read and reject (QQQ-3).
 *
 * `'none'` is deliberately not a member. A command reading nothing is handed
 * nothing, and a `none: undefined` entry here would be a value somebody could
 * ask for.
 */
export interface PreReadKinds {
  /**
   * The document's outline, flattened — `destinations.ts`' `readDestinations`.
   *
   * Named as the **contract's** `OutlineEntry` rather than the kernel's
   * `Destination`, because this shape crosses to the renderer as well and the
   * contract is where a crossing shape is declared. `Destination` is now an
   * alias of it, so the two names are one type and neither can drift from the
   * other.
   *
   * A property of the whole document, so it needs nothing — which is what
   * `needs: never` says: {@link PreReadAccess} resolves an uninhabited `needs` to
   * a member that takes **no parameter at all**, so calling it with one is a
   * compile error rather than a value nobody reads.
   */
  readonly outline: { readonly needs: never; readonly value: readonly OutlineEntry[] };
  /**
   * One page's or one region's recognised text, inside the engine host.
   *
   * **The request names which engine answers** (ADR-0052 Decision 1), and the
   * two arms of that union do not carry the same fields — so the member cannot
   * be called with a handwriting request that names no region, and the branch
   * that picks a model directory lives in the composition root alone.
   *
   * **Per page, never per document**, and that is ADR-0035 rather than a choice:
   * extracted text measured at 3.59× a document's bytes and is never resident in
   * `main`. A scope here would hold every page's recognition at once.
   *
   * The boxes are already in PDF user space, converted once by the module that
   * rasterised and holds both frames — so nothing on this path converts a second
   * time.
   */
  readonly ocr: { readonly needs: RecognitionRequest; readonly value: RecognisedPage };
}

/**
 * What each member of {@link PreReadKinds} answers, by member name.
 *
 * Derived, so `PreRead['outline']` still means what it meant before ADR-0051 and
 * every consumer of the value type is unmoved.
 */
export type PreRead = { readonly [K in keyof PreReadKinds]: PreReadKinds[K]['value'] };

/** What one member of {@link PreReadKinds} must be told. `never` is *nothing*. */
export type PreReadNeeds<K extends keyof PreReadKinds> = PreReadKinds[K]['needs'];

/**
 * How the bus obtains a pre-read, supplied by the caller that can resolve one.
 *
 * **Here rather than in `commandBus.ts`**, where it lived until ADR-0051:
 * `commandDeclarations.ts` now declares the expression that calls one of these
 * members, and the seam cannot import the declarations back — which is ADR-0040's
 * own correction, one type along.
 *
 * A mapped type over {@link PreReadKinds} rather than an interface, so the member
 * set and each member's argument come from the one declaration. An interface here
 * would be a second list to keep in step.
 */
export type PreReadAccess = {
  // `[…] extends [never]` RATHER THAN `extends never`, because a naked `never` in
  // a conditional distributes over nothing and answers `never` for the whole
  // type — the tuple is what makes this a test of the member's `needs` instead of
  // a silent collapse. A member needing nothing gets a signature with **no
  // parameter**; one needing a page cannot be called without it.
  readonly [K in keyof PreReadKinds]: [PreReadNeeds<K>] extends [never]
    ? () => Promise<PreRead[K]>
    : (needs: PreReadNeeds<K>) => Promise<PreRead[K]>;
};

/**
 * The one expression that turns a command into the pre-read its apply needs.
 *
 * Declared per command beside `reads`, which is the only place the command's kind
 * and the member's `needs` are both known — see `commandDeclarations.ts`'
 * {@link ReadRouting} for why that file carries a function at all.
 */
export type ReadPreRead<K extends CommandKind, R extends keyof PreRead> = (
  access: PreReadAccess,
  command: CommandOfKind<K>,
) => Promise<PreRead[R]>;

/**
 * Any pre-read value, as a caller that does not know the command's kind sees
 * it.
 *
 * A union over {@link PreRead}'s members rather than a widening to `unknown`:
 * the bus resolves one of these without knowing which, and an `unknown` here
 * would let it hand an `apply` something no axis member names. **The second
 * member arrived 2026-09-11** and this line is where it widened: two members, so
 * this is `readonly OutlineEntry[] | RecognisedPage`, and the bus still resolves
 * one without knowing which.
 */
export type PreReadValue = PreRead[keyof PreRead];

/**
 * How a command mutates its writer's session.
 *
 * Conditional on the writer's shape and on {@link CommandSources}, and the two
 * conditions are not independent:
 *
 * - **byte-image + `'one'` is `never`**, so the combination cannot be written
 *   at all. A byte-image writer consumes an image and produces one; there is no
 *   session to hand it a second of, and a spec claiming both would have to
 *   supply an `apply` of type `never`, which nothing satisfies. B5 rather than a
 *   comment saying *don't do this* — ADR-0040's three rows are all MuPDF's, and
 *   the day one is not, this is a deliberate type change rather than an
 *   accident.
 * - **live-session + `'one'`** takes the source's session as a third argument
 *   it cannot be called without. The target is still the first parameter, so a
 *   transposition is a type error only where the two sessions differ in type —
 *   they do not, both being `MupdfSession` — which is why the bus passes them
 *   positionally from a map keyed by `DocId` rather than by role.
 *
 * ## THE TWO AXES COMPOSE, and they did not until 2026-09-05
 *
 * `sources: 'one'` used to end the conditional, so a command declaring **both**
 * got the source and silently lost the outline — the `reads` branch was
 * unreachable underneath it. That is exactly the combination ADR-0040's
 * extension names as the reason the axes are separate: *"a merge that
 * regenerated the target's TOC would be both"*. The type contradicted the
 * document that introduced it.
 *
 * Nothing was wrong in the tree, because no command declared both — which is
 * why it is worth stating how it was found rather than only that it was fixed.
 * It was not found by a check and could not have been: every declaration
 * type-checks, and a dropped parameter on a combination nobody has written
 * produces no error anywhere. It was found by **building the second axis's
 * first caller** and reading what the first axis would hand it.
 *
 * The order is `(session, command, source, read)`, so each parameter's
 * position is fixed by its axis rather than by which combination is in play —
 * an ordering that varied would make a two-axis apply's signature depend on
 * something the author has to remember.
 *
 * ## The `reads` branch names the AXIS, and it named one member until 2026-09-11
 *
 * It read `R extends 'outline'` — correct while the axis had one member, and a
 * silent dropper the moment it had two: a command declaring the second would have
 * had its pre-read resolved by the bus and then fall into the branch that passes
 * nothing. `R extends keyof PreRead` is the same test written over the axis, and
 * the apply is handed `PreRead[R]`. Found the same way the composition above was,
 * by building the next caller (ADR-0051).
 */
export type Apply<
  W extends keyof WriterSession,
  K extends CommandKind,
  S extends CommandSources = 'none',
  R extends CommandReads = 'none',
> = WriterShapeOf[W] extends 'byte-image'
  ? S extends 'one'
    ? never
    : R extends keyof PreRead
      ? (
          image: WriterSession[W],
          command: CommandOfKind<K>,
          read: PreRead[R],
        ) => Promise<ByteImage>
      : (image: WriterSession[W], command: CommandOfKind<K>) => Promise<ByteImage>
  : S extends 'one'
    ? R extends keyof PreRead
      ? (
          session: WriterSession[W],
          command: CommandOfKind<K>,
          source: WriterSession[W],
          read: PreRead[R],
        ) => Promise<void>
      : (
          session: WriterSession[W],
          command: CommandOfKind<K>,
          source: WriterSession[W],
        ) => Promise<void>
    : R extends keyof PreRead
      ? (
          session: WriterSession[W],
          command: CommandOfKind<K>,
          read: PreRead[R],
        ) => Promise<void>
      : (session: WriterSession[W], command: CommandOfKind<K>) => Promise<void>;

/**
 * How a command is **undone** — the same shape asymmetry as {@link Apply}, and
 * deliberately **not** given the command.
 *
 * §3's finding is that an inverse is defined entirely by prior state. Passing
 * the command as well would make it possible — and eventually tempting — to
 * compute a reversing operation from the intent instead: rotate back by the
 * same quarter turns. That is the defect §3 exists to forbid. A page that
 * inherited its rotation is restored by **deleting** the key, and no amount of
 * rotating backwards reaches that state; a page carrying a raw `45` is restored
 * to `45`, and a reversing rotation would leave a normalised value.
 *
 * So the signature carries exactly what §3 says the log stores, and nothing the
 * defect needs. *An inverse that restores the rendering is not an inverse.*
 */
export type Invert<W extends keyof WriterSession, K extends CommandKind> =
  WriterShapeOf[W] extends 'byte-image'
    ? (image: WriterSession[W], inverse: CommandPrior[K]) => Promise<ByteImage>
    : (session: WriterSession[W], inverse: CommandPrior[K]) => Promise<void>;
