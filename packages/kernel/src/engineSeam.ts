import { type CommandKind, type CommandOfKind } from '@monstera/contract';

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
 * ## `DocumentService` keeps the canonical bytes
 *
 * Every session is **opened from bytes the kernel holds** and serialises back
 * to bytes; nothing here lets an engine become the owner of authoritative
 * state. That is §8's second constraint and it is the easier one to lose — a
 * live-session-first design drifts naturally into "the session *is* the
 * document", which forecloses the recovery path ADR-0007 makes the designed
 * response to a memory breach: killing the engine process. With the bytes on
 * this side, that is a re-open rather than a loss.
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
 * Opaque here on purpose: the kernel passes it back to the adapter and to the
 * command that declared MuPDF as its writer, and nothing else may reach into
 * it. The concrete type lives in the adapter module.
 */
export interface MupdfSession {
  readonly engine: 'mupdf';
}

/** A live PDFium session. Declared, with no adapter behind it yet. */
export interface PdfiumSession {
  readonly engine: 'pdfium';
}

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

/** Which shape each writer of record is. */
export interface WriterShapeOf {
  readonly mupdf: 'live-session';
  readonly pdfium: 'live-session';
  readonly 'pdf-lib': 'byte-image';
  readonly signpdf: 'byte-image';
}

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
export type Apply<W extends keyof WriterSession, K extends CommandKind> =
  WriterShapeOf[W] extends 'byte-image'
    ? (image: WriterSession[W], command: CommandOfKind<K>) => Promise<ByteImage>
    : (session: WriterSession[W], command: CommandOfKind<K>) => Promise<void>;
