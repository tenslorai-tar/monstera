import type { CommandKind, CommandOfKind, OutlineEntry } from '@monstera/contract';
import type { Brand } from '@monstera/shared';

import type { CaptureResult, CommandPrior } from './commandLog.js';

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
 * So: **both shapes live in the type; exactly one adapter implements it.** The
 * live-session one, because that is what the first command needs. The
 * byte-image side has nothing behind it, and that is deliberate.
 *
 * An unimplemented variant nobody constructs is a vacuous check, so its control
 * is a **type-level fixture in `scripts/proofs/contract.proof.mjs`** that builds
 * a byte-image writer and a byte-image `Apply`, satisfying these types with no
 * type assertion in it. If that fixture ever needs an assertion to compile, the
 * type does not express the shape and that is the finding — not an obstacle to
 * route around.
 *
 * The precedent for a deliberately empty seam is ADR-0018's
 * `WebUpdateProvider`, registered with nothing behind it and explicitly not to
 * be deleted as dead code. The difference is that an empty registration is
 * visible on inspection and a type's expressiveness is not, which is why this
 * one needs a fixture and that one does not.
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

/** A live PDFium session. Declared, with no adapter behind it yet. */
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
  readonly pdfium: PdfiumSession;
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
  pdfium: 'live-session',
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
  /** The canonical bytes for the session's current state. */
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
 */
export type CommandReads = 'none' | 'outline';

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
 */
export type Apply<
  W extends keyof WriterSession,
  K extends CommandKind,
  S extends CommandSources = 'none',
  R extends CommandReads = 'none',
> = WriterShapeOf[W] extends 'byte-image'
  ? S extends 'one'
    ? never
    : R extends 'outline'
      ? (
          image: WriterSession[W],
          command: CommandOfKind<K>,
          outline: readonly OutlineEntry[],
        ) => Promise<ByteImage>
      : (image: WriterSession[W], command: CommandOfKind<K>) => Promise<ByteImage>
  : S extends 'one'
    ? (
        session: WriterSession[W],
        command: CommandOfKind<K>,
        source: WriterSession[W],
      ) => Promise<void>
    : R extends 'outline'
      ? (
          session: WriterSession[W],
          command: CommandOfKind<K>,
          outline: readonly OutlineEntry[],
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
