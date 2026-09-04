import type { CommandKind, CommandOfKind } from '@monstera/contract';
// DECLARATIONS, not specs. This reads `spec.writer` and calls nothing on it, so
// importing the spec table would bind the MuPDF native library **in main** —
// which invariant 20 forbids by name and §9.17's budget is argued against
// (ADR-0026). The kernel's barrel is now free of that edge too.
import {
  type ByteImage,
  type CommandBus,
  DocumentNotOpenError,
  type DocumentService,
  type PageGeometry,
  type Destination,
  type DuplicatePageGroup,
  type Layer,
  type PageLink,
  type PageText,
  type SaveDependencies,
  type CopyOutcome,
  type CopyTargetVerdict,
  type SaveOutcome,
  type SearchOptions,
  type ByteImageAccess,
  type SessionsByWriter,
  type SnapshotWrite,
  type TextMatch,
  findInPages,
  saveDocument,
  writeDocumentCopy,
} from '@monstera/kernel';
import { type DocId, type DocVersion, type QueryProblem, compileQuery } from '@monstera/shared';

/**
 * The composition point (ADR-0009, 2026-08-19): the one place that owns
 * `DocumentService.run → CommandBus.execute`.
 *
 * ## Why one, and why here
 *
 * §7 fixes the lane, §4 fixes the log, §6 fixes routing, and nothing said who
 * assembles them. If every handler assembled it, a handler that forgets the lane
 * is a race — and there would be **a second place where a feature is wired**,
 * which is the thing the command registry exists to forbid.
 *
 * It lives under `apps/desktop/src` and imports no Electron, and the location is
 * a constraint rather than a convenience: the reachability trigger in
 * `docs/security/engine-advisories.json` scans every `src` tree under `apps/`,
 * so handlers put anywhere else would leave that verdict green through the whole
 * unit it was armed for. The repository map's rule is that `apps/desktop` is the
 * *only* package that **may** import Electron, not that everything in it must.
 *
 * ## What it deliberately does not own
 *
 * **Engine session lifetime.** Sessions are looked up, never created here — see
 * {@link SessionLookup}.
 *
 * **Who owns them is settled, and this comment used to say it was not.**
 * `docs/ARCHITECTURE.md` §2 states that per document `DocumentService` owns
 * "canonical bytes, lazily-created engine handles (invalidated together on any
 * mutation), the command log and checkpoints, and the originating `FileHandle`",
 * and §3.2 restates the handle half. That is the answer to *who opens a session
 * and from which bytes*: `DocumentService`, lazily, from its own canonical
 * image, as a cache that may be thrown away and rebuilt.
 *
 * The earlier text read ADR-0009 §8's silence as the project's. §8 is silent —
 * it says only that the kernel keeps the bytes — but the **living law is not**,
 * and `CLAUDE.md`'s document table puts `ARCHITECTURE.md` above an ADR wherever
 * they diverge. The advisory register agreed with the law rather than with this
 * comment: its entry called itself "a prompt to decide", and a prompt to decide
 * is not a change-control stop. Widening a source's silence into the project's
 * is how three lines of work acquire a ruling-sized question (EE-7's shape).
 *
 * What is genuinely open is the **policy**, not the ownership: how many images
 * are resident, what happens at ADR-0007's ceiling, and whether a killed host
 * actually recovers. The first two are answered in
 * [ADR-0021](../../../docs/DECISIONS/0021-the-canonical-image-is-retained.md).
 *
 * **The third is now two claims, and only one of them is still owed.** Its
 * *policy* is decided —
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9: the rebuild is bounded per document and poisons at two consecutive
 * failures, a death is reported on `ShellFailureSink`, and other documents are
 * neither drained nor failed because the supervisor enters their lanes rather
 * than creating at the lookup below. That last part is why {@link SessionLookup}
 * is unchanged: widening it to create would be bending this seam to fit a
 * feature, which is B4.
 *
 * What remains owed is the *measurement* — that a killed host actually recovers,
 * against a running one — and it is a `docs/FEATURES.md` row.
 */

/**
 * The engine sessions one open document currently has, keyed by writer of
 * record.
 *
 * **Partial by construction**, the same shape and the same reason as the bus's
 * `WriterRegistry`: four writers of record are declared and one has an adapter,
 * so a total map could not be built today and pretending otherwise would mean a
 * placeholder that fails at a native call instead of at lookup.
 *
 * **The type moved to `packages/kernel` on 2026-08-28 and this is an alias.**
 * `CommandBus.undo` takes one: undo reads the log to find which writer its last
 * entry routes to, and only then knows which session it needs — so the bus
 * takes the set and picks. Two declarations of the same mapped type, one on
 * each side of a call that passes it, is the shape where they agree until they
 * do not (B3a). The name stays because this is the vocabulary the module's
 * seams are written in.
 */
export type DocumentSessions = SessionsByWriter;

/**
 * How this finds a document's sessions — **get-or-miss, never get-or-create**.
 *
 * The same rule the lane and the log follow, for the same reason: a lookup that
 * creates would mint a session for a closed `DocId` and run a command against a
 * torn-down document. A miss here is a **defect**, not an outcome — an open
 * document without its session is an inconsistency in whoever holds them, and it
 * is reported as {@link MissingSessionError} so it reaches the renderer as
 * `internal` with a diagnostic recorded rather than as something a user is asked
 * to act on.
 */
export type SessionLookup = (docId: DocId) => DocumentSessions | undefined;

/**
 * What the engine session supervisor exposes to this composition point.
 *
 * ## Why two questions and not one
 *
 * {@link SessionLookup}'s `undefined` means **three** things — never opened, a
 * session awaiting a rebuild, and a document the supervisor has decided to stop
 * rebuilding for. Only the last is an outcome the user can be told about; the
 * others are a defect and a transient. Overloading one return value with all
 * three would make the difference unrecoverable at the only place that has to
 * act on it, so the decided state is asked for by name.
 *
 * ## Why ONE parameter carrying both
 *
 * They are two answers from one authority — the supervisor holds a single
 * per-document entry, by [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9a's DDDD-16 correction, precisely so the count and the sessions
 * cannot acquire separate owners. Handed over as two independent parameters,
 * nothing would stop a caller wiring them from two places, which is the second
 * opinion B3a is about. One object makes that unrepresentable rather than
 * discouraged.
 *
 * {@link SessionLookup} itself is unchanged, and that is the point: this
 * registers a second question beside it rather than widening it, which would be
 * B4 for the reason its own comment gives.
 */
export interface EngineSessionSource {
  /** Get-or-miss. See {@link SessionLookup}. */
  readonly sessions: SessionLookup;
  /**
   * The consecutive engine-host failure count that poisoned this document, or
   * `undefined` if it is not poisoned (Decision 9a). A document the supervisor
   * has never seen is not poisoned.
   *
   * **The count rather than a boolean, and the bound stays with the
   * supervisor.** This module must not re-derive *how many is too many* — that
   * would be a second opinion about a rule Decision 9a owns, and the two would
   * agree right up until the bound moved (B3a). It reports the number it was
   * handed, which is also what stops the diagnostic below carrying a figure
   * somebody recalled (B6).
   */
  readonly poisoned: (docId: DocId) => number | undefined;
}

/**
 * Rebuilds one document's engine sessions from a checkpoint, inside its lane.
 *
 * ## Why this is composed here and NOT on {@link EngineSessionSource}
 *
 * `SaveSource`'s reason, one method along, and the same composition order
 * refuses it: `EngineSessions` is built **before** the engine host exists, so
 * it cannot be handed anything that opens a session at construction. What it
 * *does* own is `recycle` — release this document's sessions, then reopen them,
 * keeping its entry and therefore its failure count — and a restore is exactly
 * that operation with the bytes coming from a checkpoint rather than from the
 * canonical image. So this is composed at the root where the host's opener and
 * the supervisor are both in scope, and it reuses `recycle` rather than adding
 * a second way to swap a document's session (B3a).
 *
 * The bytes do not travel through it. `CommandBus` hands over a
 * {@link SnapshotWrite}, which puts the checkpoint straight from
 * `DocumentService`'s record into the granted directory
 * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
 */
export type DocumentRestore = (docId: DocId, write: SnapshotWrite) => Promise<void>;

/**
 * What a save needs that the engine session source does not provide.
 *
 * ## Why `flush` is here and NOT on {@link EngineSessionSource}
 *
 * It was there first, and the composition order refused it: `EngineSessions` is
 * built **before** the engine host exists, and the host is what yields the
 * registered writer — so the supervisor cannot be handed a flush at
 * construction without a cycle, and holding one it could be given later would
 * make its answers mutable after the fact. That class's `implements` clause is
 * what keeps its two answers honest, and widening the interface it satisfies to
 * something it cannot satisfy would have cost exactly that.
 *
 * So the flush travels with the save's other dependencies, composed at the root
 * where the writer and the session are both in scope — which is the only place
 * they are known to be correlated. This module therefore names no writer of
 * record and holds no second routing table (B3a), which matters because a save
 * has no command to route from and so cannot ask `CommandBus` the way undo
 * does.
 *
 * §4's *"flush each writer of record once"* is unambiguous at one adapter and
 * one session per document. The day a second writer holds a session for one
 * document, two live-session writers each return the WHOLE document from
 * `serialise` and nothing in the law says which bytes win. That is a B4
 * question, answered where this is composed rather than by picking one here.
 */
/**
 * What writing a copy needs that a save does not.
 *
 * Two members rather than two parameters, for the reason the constructor gives
 * at the point it takes this. They belong together by subject: one asks the
 * user where, the other asks this application whether that answer is safe, and
 * neither is any use without the other.
 *
 * `checkTarget` is `DocumentService.checkCopyTarget` bound at the composition
 * root, for `SaveSource.flush`'s reason — the service is the only thing that
 * can answer it, and this module names no writer of record.
 */
/**
 * How a destination is chosen — `PickDocument`'s mirror, declared here because
 * {@link CopySource} is what needs it and `contractHandlers.ts` imports this
 * module.
 *
 * It **takes a suggested filename and returns a path**, which is the one
 * asymmetry with `PickDocument` and is where the boundary sits: a caller may
 * name a file because a filename is not a location, and only the answer is a
 * path. `null` is the user dismissing the dialog — an outcome, not a failure.
 *
 * The path never crosses to the renderer. It is consumed by the atomic write
 * and answered with a byte count, exactly as `PickDocument`'s is consumed by a
 * `FileHandle` mint and answered with a `DocId`.
 */
export type PickDestination = (suggestedName: string) => Promise<string | null>;

/**
 * The filename a copy is offered under: `report.pdf` becomes `report copy.pdf`.
 *
 * **A NAME, never a path**, which is what {@link PickDestination} takes — the
 * dialog opens where the platform last left the user rather than beside the
 * original, and this has nothing to give it even if that were wanted.
 *
 * The extension is preserved by splitting at the LAST dot, so `a.b.pdf` becomes
 * `a.b copy.pdf`, and a name with no dot gets the suffix appended whole. A name
 * that is nothing but an extension — `.pdf` — has no stem to suffix, so its dot
 * is not treated as a separator and it becomes `.pdf copy`. That is a file
 * almost nobody has, and the alternative produces ` copy.pdf`, which silently
 * drops what the user's file was called.
 */
export function suggestedCopyName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} copy`;
  return `${name.slice(0, dot)} copy${name.slice(dot)}`;
}

export interface CopySource {
  /** Runs the platform's save dialog. See {@link PickDestination}. */
  readonly pick: PickDestination;
  /** Whether another open document reaches the chosen path. */
  readonly checkTarget: (destination: string) => Promise<CopyTargetVerdict>;
}

export interface SaveSource {
  /** The write-target check and the filesystem the atomic ordering runs on. */
  readonly deps: SaveDependencies;
  /** A document's current bytes. */
  readonly flush: DocumentFlush;
}

/**
 * The query itself could not be compiled.
 *
 * An **outcome**, not a defect, and the class is what carries that distinction
 * to the handler — matched on the class rather than on the message, for
 * `DocumentPoisonedError`'s reason. It is the only refusal here that says
 * nothing about the document: the user typed a pattern, and a person typing one
 * passes through several that do not parse.
 */
export class InvalidSearchPatternError extends Error {
  override readonly name = 'InvalidSearchPatternError';

  constructor(query: string, reason: QueryProblem) {
    super(
      `A search query was refused before any page was read (${reason}): ${JSON.stringify(query)}. ` +
        'An empty query matches every position and an unparseable pattern matches nothing, so ' +
        'neither can be answered with a result list.',
    );
  }
}

/** An open document had no session for the writer its command routes to. */
export class MissingSessionError extends Error {
  override readonly name = 'MissingSessionError';

  constructor(docId: DocId, writer: string) {
    super(
      `No '${writer}' session for a document that is open. Session lookup is get-or-miss: ` +
        'nothing is created here, so this means the holder of sessions and the open-document ' +
        `index have diverged. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * The supervisor has stopped rebuilding an engine session for this document.
 *
 * An **outcome**, not a defect, and the class is what carries that distinction
 * to `commandHandlers.ts` — matched on the class rather than on the message, for
 * the reason that file states: wording changes silently, and the direction this
 * fails in turns a decided outcome into an unexplained internal error.
 *
 * The message is a main-side diagnostic and never crosses. It names the count
 * because *how many* is the whole of the decision, and a reader meeting this in
 * a log needs the bound rather than the word.
 */
export class DocumentPoisonedError extends Error {
  override readonly name = 'DocumentPoisonedError';

  constructor(docId: DocId, failures: number) {
    super(
      `Engine work refused: ${String(failures)} consecutive engine-host failures with no success in ` +
        'between, so no session is rebuilt for this document (ADR-0023 Decision 9a). The ' +
        'canonical bytes and the command log stay in main, intact and unappliable — refusing ' +
        'STRANDS the work where closing would destroy it, which is the whole of why this is a ' +
        `refusal. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/*
 * THE SECOND-COMMAND TRIGGER FIRED ON 2026-09-03, and this is what it produced.
 *
 * A type-level guard stood here that failed to compile the day a second command
 * kind existed. It said exactly what would break — *with two kinds a caller
 * holding the wire union infers `K` as the union, and `DeclaredSpecs[K]`
 * becomes a union of specs; `spec.writer` is then a union of writers, and
 * TypeScript cannot correlate the session it selects with the `apply` that will
 * receive it* — and named the fix: a narrowing step from `Command` to
 * `CommandOfKind<K>`.
 *
 * `setLayerVisibility` arrived and every word of that happened. The narrowing
 * is in {@link DocumentCommands.execute}, one line, with the claim stated where
 * it is made.
 *
 * The guard is REMOVED rather than kept, because a trigger that has fired and
 * been acted on is a permanently red build. What it was for is recorded here:
 * it is the shape worth copying, not the line. `CommandBus.redo` still carries
 * one for `replay: 'stored-effect'`, and it has not fired.
 *
 * One thing the guard did NOT predict, and it is the more interesting half: the
 * same limit appeared in four other places at once — `CommandLog.record`,
 * `localMupdfExecution`'s dispatch, the capture handler's tagged prior, and the
 * remote capture's tag check. A trigger sited where somebody expected the
 * problem found its own site correctly and said nothing about the other four.
 */

/**
 * How a document's current bytes are obtained for a save.
 *
 * **Composed where the writer and the session were created together**, which is
 * the only place they are known to be correlated — so this module names no
 * writer of record and holds no second routing table (B3a). `CommandBus` owns
 * the registry; a save has no command to route from, so it cannot ask the bus
 * the way undo does, and the honest answer is to be handed the flush rather
 * than to re-derive it.
 */
export type DocumentFlush = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<ByteImage>;

/**
 * How a document's page geometry is obtained for the view model.
 *
 * The same shape as {@link DocumentFlush} and for the same reason: it is
 * composed where the geometry reader and the session were created together, so
 * this module names no writer of record. A view-model read has no command to
 * route from — it is a query (§2, *"reads are queries"*) — so it cannot ask
 * `CommandBus` the way undo does, and being handed the reader is the honest
 * answer rather than picking an engine here.
 */
export type DocumentGeometry = (
  docId: DocId,
  sessions: DocumentSessions,
  pages: readonly number[],
) => Promise<PageGeometry>;

/**
 * The view model a renderer holds for one version of one document.
 *
 * ## Why the version is on it, and is not decoration
 *
 * A rotation and a byte offset are the same class of thing: both are meaningless
 * outside the version that produced them. `document.readRange` already refuses a
 * range for any other version (ADR-0031) because a stale offset answered from
 * new bytes assembles a document from two of them; a stale rotation drawn over a
 * current page is the same defect with no exception thrown. The stamp is what
 * lets the renderer drop a late answer, which is not hypothetical — a command
 * can bump the version while this read is in flight.
 */
export interface DocumentViewModel extends PageGeometry {
  readonly version: DocVersion;
}

/**
 * Reads one page's text, for the search that consumes it.
 *
 * The sibling of {@link DocumentGeometry} and injected for the same reason: a
 * handler proof must be able to drive the channel without a parsed document, so
 * this module names no engine.
 *
 * **One page, and the signature is where that is enforced.** Taking an array
 * would put the whole of [ADR-0035](../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)
 * back at each call site: a document's extracted text is 3.59× its bytes, which
 * `main` may not hold even transiently. A parameter that cannot express *every
 * page* is B5 over a rule somebody has to remember.
 */
export type DocumentPageText = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<PageText>;

/**
 * Reads one page's links.
 *
 * Injected for {@link DocumentPageText}'s reason: this module names no engine,
 * so a handler proof can drive the channel with no parsed document.
 *
 * One page, and the signature enforces it — not because links are large, but
 * because a document-wide read is an answer that scales with the document,
 * which invariant 11 forbids per operation.
 */
export type DocumentPageLinksReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<readonly PageLink[]>;

/** One page's links, stamped with the version the lane read them at. */
export interface DocumentPageLinks {
  readonly version: DocVersion;
  readonly links: readonly PageLink[];
}

/**
 * Reads the document's outline.
 *
 * Injected for {@link DocumentPageText}'s reason. Takes NO page: an outline is
 * a property of the document, and a page parameter would be a signature
 * inviting a question this has no answer to.
 */
export type DocumentDestinationsReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<readonly Destination[]>;

/** The outline, stamped with the version the lane read it at. */
export interface DocumentDestinations {
  readonly version: DocVersion;
  readonly destinations: readonly Destination[];
}

/** Reads the document's layers. Injected for {@link DocumentPageText}'s reason. */
export type DocumentLayersReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<readonly Layer[]>;

/** The layers, stamped with the version the lane read them at. */
export interface DocumentLayers {
  readonly version: DocVersion;
  readonly layers: readonly Layer[];
}

/**
 * Groups identical pages, and says whether the bound stopped the report.
 *
 * **The truncation flag rides with the groups**, rather than being a second
 * question. It is computed where the document was walked, and a caller that
 * inferred it from the list's length would be inferring it from the bound it
 * already knows — which answers *you asked for that many* every time.
 */
export type DocumentDuplicatesReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<{ readonly groups: readonly DuplicatePageGroup[]; readonly truncated: boolean }>;

/** The duplicate groups, stamped with the version the lane read them at. */
export interface DocumentDuplicates {
  readonly version: DocVersion;
  readonly groups: readonly DuplicatePageGroup[];
  readonly truncated: boolean;
}

/** One page's matches, stamped with the version the lane read them at. */
export interface PageSearchResult {
  readonly version: DocVersion;
  readonly matches: readonly TextMatch[];
  /**
   * Whether the limit stopped the search rather than the page running out.
   *
   * Carried rather than derived from `matches.length === limit`, which is the
   * off-by-one that makes a page holding exactly `limit` matches look truncated
   * for ever and a results surface page past the end of the document.
   */
  readonly truncated: boolean;
}

/**
 * What an applied mutation produced: the two scalars that describe the document
 * it left behind.
 *
 * ## Why they travel together and neither is optional
 *
 * The version says a renderer's view is stale. The byte length is what it needs
 * to build the replacement — PDF.js is driven through a transport bound to a
 * total size, and a command rewrites the canonical image. A caller given only
 * the version rebinds to the previous image's length, which is a `RangeError`
 * past the end or a truncated parse short of it.
 *
 * Read at one moment inside the lane, so they describe one document rather than
 * two. That is `Versioned`'s own argument, applied to the second value the same
 * caller needs.
 */
export interface Applied {
  readonly version: DocVersion;
  readonly byteLength: number;
  /** Undo steps this command cost to the checkpoint budget (§4, invariant 18). */
  readonly historyDropped: number;
}

export class DocumentCommands {
  readonly #documents: DocumentService;
  readonly #bus: CommandBus;
  readonly #engine: EngineSessionSource;
  readonly #save: SaveSource;
  readonly #geometry: DocumentGeometry;
  readonly #pageText: DocumentPageText;
  readonly #pageLinks: DocumentPageLinksReader;
  readonly #destinations: DocumentDestinationsReader;
  readonly #layers: DocumentLayersReader;
  readonly #restore: DocumentRestore;
  readonly #duplicates: DocumentDuplicatesReader;
  readonly #copy: CopySource;

  constructor(
    documents: DocumentService,
    bus: CommandBus,
    engine: EngineSessionSource,
    save: SaveSource,
    geometry: DocumentGeometry,
    pageText: DocumentPageText,
    pageLinks: DocumentPageLinksReader,
    destinations: DocumentDestinationsReader,
    layers: DocumentLayersReader,
    // APPENDED rather than placed beside `engine`, which is where it belongs by
    // subject. Inserting a parameter into a positional list of nine shifts eight
    // arguments at every call site, and this build has already shipped one such
    // shift: a `recent` parameter added fourth, into which a harness passed a
    // `platform`, through a `Promise<any>` that erased the signature. The
    // signature here is distinct — `(DocId, SnapshotWrite)` against every
    // reader's `(DocId, DocumentSessions, …)` — so a mis-slot is a type error
    // either way; appending is what keeps the *other* eight from moving.
    restore: DocumentRestore,
    // THE ELEVENTH POSITIONAL PARAMETER, and the fifth reader taking
    // `(docId, sessions)`. Finding CCCCCC-3 recorded the class and named its
    // trigger precisely — *the day two of these readers answer the same
    // shape*, when a transposition compiles and a panel shows the wrong list.
    // Checked rather than inherited: `Layer`, `Destination`, `PageLink`,
    // `PageGeometry` and this one's `{ groups, truncated }` are still mutually
    // incompatible, so the trigger has not fired. The options object that
    // removes the class remains owed.
    duplicates: DocumentDuplicatesReader,
    // ONE PARAMETER FOR TWO DEPENDENCIES, and that is this list's own comment
    // being acted on rather than restated. Writing a copy needs a picker and a
    // contested-destination check; appending them separately would make a list
    // of twelve into fourteen and move the class one step further from the
    // options object it says is owed. `SaveSource` is the precedent — it
    // bundles a filesystem and a flush for the same reason — so this follows a
    // shape already here instead of inventing a second one.
    copy: CopySource,
  ) {
    this.#documents = documents;
    this.#bus = bus;
    this.#engine = engine;
    this.#save = save;
    this.#geometry = geometry;
    this.#pageText = pageText;
    this.#pageLinks = pageLinks;
    this.#destinations = destinations;
    this.#layers = layers;
    this.#restore = restore;
    this.#duplicates = duplicates;
    this.#copy = copy;
  }

  /**
   * Reads the view model for a document, inside its lane.
   *
   * ## Why this exists, and it is not a convenience
   *
   * Finding OOOOO-1: a command's effect lands in the engine session and main's
   * canonical image is never replaced, so the bytes the renderer reads through
   * `document.readRange` are the ones the document was opened with. A rotation
   * therefore cannot reach the screen through bytes at all — it reaches it
   * through the view model `docs/ARCHITECTURE.md` §2 names beside them, which
   * had never been built.
   *
   * ## Every guard is `execute`'s, in the same order, and that is deliberate
   *
   * Poison, then session, then the work. A query is not a mutation and does not
   * bump — but a document the supervisor has stopped rebuilding for has no
   * session to read a page tree from, and answering a **read** with a plausible
   * empty model while refusing every command would be the worse half of that
   * pair: the renderer would draw a document with no pages and report nothing.
   *
   * The lane matters here for the reason it matters for a command. A geometry
   * read outside it can interleave with an `apply`, and MuPDF's page tree is
   * mutated in place — so the answer would describe neither the document before
   * the command nor the one after it.
   *
   * @param pages the zero-based indices the caller is about to draw. Named
   *   rather than *all*, which is invariant L11: one rotation per page scales
   *   with the document, and a renderer re-reading after every command would
   *   make that a per-operation payload.
   * @returns the geometry, stamped with the version the lane read it at. `run`
   *   stamps after the work, so for a query the stamp is the version the
   *   reading describes.
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError} — the same set
   *   `execute` throws, for the same reasons.
   */
  async viewModel(docId: DocId, pages: readonly number[]): Promise<DocumentViewModel> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#geometry(docId, sessions, pages);
    });

    return { version, ...value };
  }

  /**
   * Searches one page, inside the document's lane.
   *
   * ## Every guard is `viewModel`'s, in the same order, and for its reasons
   *
   * Poison, then session, then the work. A search is a query and does not bump.
   * A document the supervisor has stopped rebuilding for has no session to read
   * text from, and answering a search with a plausible **empty result list**
   * while refusing every command is the worse half of that pair: the user would
   * be told their word is not in the document.
   *
   * The lane matters for the reason it matters for geometry. MuPDF's page tree
   * is mutated in place, so a text read outside the lane can interleave with an
   * `apply` and describe neither the document before the command nor the one
   * after it.
   *
   * ## ONE PAGE, AND THE TEXT IS DROPPED WHEN THIS RETURNS
   *
   * ADR-0035: a document's extracted text is **3.59× its bytes**, measured, so
   * `main` may not hold it — and the budget is a peak, so *transiently* is not
   * an escape. The page's text lives for the length of this call and only the
   * matches survive it. A document-wide search is the renderer calling this per
   * page, which is also the grain the row's *cancellable background indexing*
   * needs to cancel at.
   *
   * @param page the zero-based index, as every page index crossing the contract
   *   is. PDF.js numbers from 1 and this build has already sent the wrong one
   *   once; `SHOWN_PAGE` is where the two meet.
   * ## THE PATTERN IS COMPILED BEFORE THE LANE, and that is not tidiness
   *
   * Under `regex` the query is the user's, and a pattern that does not parse is
   * something a person types on the way to one that does. Compiling first means
   * a half-written pattern never occupies the document's lane behind a queue of
   * real work — and it is the only refusal here that is about the QUERY rather
   * than about the document, so it is the only one that can be decided without
   * reading anything.
   *
   * @param limit the caller's own bound. Stated rather than defaulted, so
   *   `truncated` can separate *the page ran out* from *you asked for this many*.
   * @throws {InvalidSearchPatternError} when `regex` is set and the query does
   *   not compile.
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async searchPage(
    docId: DocId,
    page: number,
    query: string,
    limit: number,
    options: SearchOptions = {},
  ): Promise<PageSearchResult> {
    const compiled = compileQuery(query, options);
    if (!compiled.ok) throw new InvalidSearchPatternError(query, compiled.error);

    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const text = await this.#pageText(docId, sessions, page);
      // ASKED FOR ONE MORE THAN THE LIMIT, which is what makes `truncated`
      // honest: a page holding exactly `limit` matches is not truncated, and
      // `matches.length === limit` cannot tell that from a page holding more.
      const found = findInPages([text], query, { ...options, limit: limit + 1 });
      // The refusal was decided above, so this cannot be reached — and it is a
      // throw rather than an empty list, because a search that answered nothing
      // here would report the reassuring answer for a query it never ran.
      if (!found.ok) throw new InvalidSearchPatternError(query, found.error);
      return {
        matches: found.value.slice(0, limit).map((match) => ({ ...match, page })),
        truncated: found.value.length > limit,
      };
    });

    return { version, ...value };
  }

  /**
   * One page's links.
   *
   * ## In the LANE, for `searchPage`'s reason
   *
   * A link read walks the document the adapter holds, and that document is
   * mutated in place — so a read outside the lane can interleave with an
   * `apply` and describe neither the document before the command nor the one
   * after it. The version comes back with the answer, which is what lets a
   * renderer discard links that describe a document it is no longer showing.
   *
   * ## Nothing is dropped on the way through
   *
   * Unlike the text beside it, a page's links are already small and already
   * bounded — the whole answer is what the caller asked for, and there is no
   * intermediate that must not survive the call.
   *
   * @param page the zero-based index, as every page index crossing the contract
   *   is. `pageNumbering.ts` is where that and PDF.js's numbering meet.
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async pageLinks(docId: DocId, page: number): Promise<DocumentPageLinks> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#pageLinks(docId, sessions, page);
    });

    return { version, links: value };
  }

  /**
   * The document's outline, flattened.
   *
   * In the lane for the two reads above's reason, and stamped with the version
   * for the same one: a renderer holding an outline can tell whether it
   * describes the document it is showing.
   *
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async destinations(docId: DocId): Promise<DocumentDestinations> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#destinations(docId, sessions);
    });

    return { version, destinations: value };
  }

  /**
   * The document's layers.
   *
   * A READ, in the lane for the other reads' reason. The toggle is a command
   * and goes through {@link execute} — there is no mutating method here,
   * because a second path that changed a layer would be one no undo could
   * reach.
   *
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async layers(docId: DocId): Promise<DocumentLayers> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#layers(docId, sessions);
    });

    return { version, layers: value };
  }

  /**
   * Groups identical pages, inside the document's lane.
   *
   * `layers`' guards in `layers`' order, and the lane matters for the reason it
   * matters for the view model: this walks every page's content, and a walk
   * interleaved with an `apply` would describe neither the document before the
   * command nor the one after it.
   *
   * A READ. What a person does with the answer is delete pages, and that goes
   * through `execute` like every other mutation — so this returns a list and
   * changes nothing.
   */
  async duplicates(docId: DocId): Promise<DocumentDuplicates> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#duplicates(docId, sessions);
    });

    return { version, groups: value.groups, truncated: value.truncated };
  }

  /**
   * Runs one command through the lane and returns the version it produced.
   *
   * **The ordering is the whole of this method**, and every part of it is
   * load-bearing:
   *
   * - the bus runs **inside** `run`'s callback, so a command queues behind
   *   whatever else that document is doing (§7). Outside it, two concurrent
   *   commands would both capture prior state before either applied, and the
   *   second entry's inverse would record the state the *first* replaced —
   *   undo would then restore a document to something it was never in;
   * - the session is resolved **inside** the lane too, so a session torn down
   *   between queueing and running is a miss rather than a stale handle;
   * - the **poison** is read inside the lane, before the session, for both
   *   halves of that same reason. A document poisoned while this command sat in
   *   the queue is refused rather than run — and reading it first is what stops
   *   the decided outcome arriving as {@link MissingSessionError}, since a
   *   poisoned document has no session and the miss would otherwise win;
   * - the version returned is the one `run` stamps **after** the work, not the
   *   one it handed in. For a command those are two different numbers, and the
   *   pre-work value is the version the command *replaced*.
   *
   * `Executed` is deliberately dropped. It carries the log entry, and a log
   * entry holds an inverse or a checkpoint — a whole byte image — which must not
   * leave the main process (L11) and has no renderer-side use.
   *
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link DocumentPoisonedError}
   * — outcomes the handler reports as declared codes.
   * @throws {@link MissingSessionError} and anything the engine throws — defects,
   * which the boundary turns into `internal` with the diagnostic kept main-side.
   */
  async execute<K extends CommandKind>(
    docId: DocId,
    command: CommandOfKind<K>,
  ): Promise<Applied> {
    // THE ROUTING TABLE IS NO LONGER READ HERE, and the note that used to stand
    // in its place is worth keeping because it was half right. It read: *the
    // guard was RIGHT that a second command would break something and WRONG
    // about where.* A second **writer of record** arrived on 2026-09-04 and
    // broke it here after all — `declaredCommands[command.kind].writer` stopped
    // resolving to one literal, so indexing the session set with it stopped
    // type-checking.
    //
    // The repair is not a narrowing. This module had no business resolving a
    // session by writer at all: `undo` next door hands the whole set over and
    // says why — *"it keeps the which-engine-owns-this question in the one file
    // that answers it"* — and that argument never depended on undo lacking a
    // command. `execute` now does the same, so the only routing table in this
    // process is the bus's (B3a).
    const { version, value: byteLength } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      // A DOCUMENT WITH NO SESSIONS AT ALL is still this module's refusal to
      // make: the supervisor knows nothing about it, which is a different state
      // from *this writer has no session*, and only the bus can tell the second
      // one apart from a byte-image writer that never has a stored session.
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const { trimmed } = await this.#bus.execute<K>(
        sessions,
        context,
        command,
        this.#byteImage(docId, sessions),
      );
      // READ AFTER THE BUS, INSIDE THE LANE, for the reason `Versioned` reads
      // the version there: the command rewrote the canonical image, and the
      // length the renderer needs is the new one. Reading it outside the lane
      // would be a second command's length attributed to this one.
      //
      // The trim travels with the length for the same reason: it is what THIS
      // command cost, and a second command's trim attributed to this one would
      // tell the user their history shrank at the wrong moment.
      return { byteLength: context.byteLength, historyDropped: trimmed.droppedEntries };
    });

    return { version, ...byteLength };
  }

  /**
   * Steps one entry back, inside the document's lane.
   *
   * ## Every guard is `execute`'s, in the same order, and that is the point
   *
   * Poison, then session, then the lane's work. An undo is a mutation — §4
   * bumps the version for it *"including undo and redo"* — so a document that
   * cannot be executed against cannot be undone against either, and the two
   * paths agreeing is what stops one acquiring an exemption the other does not
   * have.
   *
   * ## Which writer, when the caller names no command
   *
   * `execute` reads `spec.writer` from the command it was handed. Undo has no
   * command: the bus reads the log's last entry and routes from **that**. So
   * this cannot resolve a session before entering the lane, and asking for the
   * one writer that has an adapter would be a routing table in a second place
   * (B3a).
   *
   * The session set is handed over whole and the bus picks. That is the same
   * shape `WriterSession` already has — a mapped lookup keyed by writer — and
   * it keeps the *"which engine owns this command"* question in the one file
   * that answers it.
   *
   * @returns the version the lane stamped, or `undefined` when the log had
   *   nothing left. **Not an error**: an empty log is where every document
   *   starts and where undoing to the beginning ends.
   * ## A terminal entry is restored, and the sessions read below go stale
   *
   * `CommandBus.undo` reaches for {@link DocumentRestore} when the entry it is
   * reversing carries a checkpoint, and the supervisor's `recycle` then replaces
   * this document's sessions. The set read a few lines down is the one that was
   * just released. Nothing here touches it afterwards, and the next call reads
   * again — which is why this stays a get-or-miss lookup per call rather than a
   * field.
   *
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError}.
   */
  async undo(docId: DocId): Promise<Applied | undefined> {
    // HELD ON AN OBJECT rather than in a `let`, which is the idiom
    // `engineHostConnection.ts` records for the same reason: the assignment
    // happens inside a closure, so the compiler narrows the `let` to its single
    // visible value and calls the read below unreachable.
    const stepped = { yes: false };

    const { version, value: byteLength } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      stepped.yes =
        (await this.#bus.undo(
          sessions,
          context,
          (write) => this.#restore(docId, write),
          this.#byteImage(docId, sessions),
        )) !== undefined;
      return context.byteLength;
    });

    // THE VERSION IS READ FROM THE LANE EITHER WAY and returned only when
    // something moved. `run` stamps a version for every entry, so returning it
    // unconditionally would report a bump for an undo that did nothing — and
    // the renderer would show a document as changed because the user pressed a
    // key that was already exhausted.
    //
    // The byte length rides with it and never alone, for the same reason: it is
    // half of *what to rebuild the view against*, and a length with no version
    // is a number nothing can act on.
    // `historyDropped: 0` and not a carried value: undo does not grow the log,
    // so nothing is ever shed for it — `CommandBus` names that fact `NO_TRIM`
    // and this is the same statement at the boundary. A field omitted here
    // would make the renderer's obligation optional on one path.
    return stepped.yes ? { version, byteLength, historyDropped: 0 } : undefined;
  }

  /**
   * §4's save pipeline, inside the document's lane.
   *
   * ## Every guard is `execute`'s, in the same order — and here the ORDER is
   * consistency rather than a mechanism, which is worth saying precisely
   *
   * Poison, then session, then the lane's work. A save calls into the contained
   * host — `serialise` is an engine call — so a document that cannot be
   * executed against cannot be saved either, and the three paths agreeing is
   * what stops one acquiring an exemption the others do not have.
   *
   * But the order carries weight in `execute` that it does not carry here, and
   * the difference was found by mutating it and watching nothing go red.
   * `execute` reads `sessions?.[spec.writer]`, so a poisoned document — whose
   * entry holds an empty session set from `begin` — misses on the writer and
   * would report {@link MissingSessionError} if poison were read second. This
   * reads `sessions === undefined`, which is true only for a document with no
   * entry at all; against the real supervisor a document with no entry is also
   * a document with no failure count, so the two guards are **mutually
   * exclusive** and neither order can be observed.
   *
   * It is kept in `execute`'s order anyway, and that is not superstition: the
   * day this check becomes per-writer — which is what a second registered
   * adapter forces — the order starts mattering, and nobody revisits an
   * ordering that has never been wrong.
   *
   * ## THE WHOLE SAVE IS ONE LANE ENTRY, and that is not an optimisation
   *
   * The flush and the stamp must not be split across two entries. `markSaved`
   * records *the current version*, so a command landing between them would mark
   * the document clean at a version whose bytes were never written — the user
   * closes it, nothing prompts, and the work is gone. One entry makes that
   * unrepresentable rather than unlikely.
   *
   * ## Which writer is flushed
   *
   * The session set holds one entry today and the flush is composed here, where
   * the writer and the session are known to be correlated. §4's *"flush each
   * writer of record once"* is unambiguous at one adapter; the day a second
   * writer holds a session for one document, two live-session writers each
   * return the whole document from `serialise` and nothing in the law says
   * which bytes win. That is a B4 question, and it is not answered by picking
   * one here.
   *
   * @returns what the save did — `saved`, `refused` or `write-failed`. None of
   *   the three is an error: in all of them the document is intact and its log
   *   untouched, which is invariant 18.
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError}, and anything the
   *   engine throws.
   */
  /**
   * How the bus obtains and installs a byte-image writer's session for this
   * document
   * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
   *
   * ## Both halves are functions this module already holds
   *
   * `current` is the **save's own flush** — the one implementation of *what
   * this document currently is*, so a watermark and a save cannot end up with
   * two answers (B3a). `adopt` is the **checkpoint restore**, whose whole
   * parameterisation is *which bytes*, and which already rebuilds a document's
   * session from a file main wrote.
   *
   * So nothing is built here. What this method does is name the pair, which is
   * what stops the bus reaching for two unrelated dependencies and stops this
   * module deciding when either runs.
   *
   * ## Built per call, and cheap because it is lazy
   *
   * The bus calls neither member unless the command it is running routes to a
   * byte-image writer, so an ordinary rotate constructs two closures and
   * invokes nothing. Making it a field would need the sessions, which are
   * resolved inside the lane per call — see `execute`'s note on why.
   */
  #byteImage(docId: DocId, sessions: DocumentSessions): ByteImageAccess {
    return {
      current: () => this.#save.flush(docId, sessions),
      adopt: (write) => this.#restore(docId, write),
    };
  }

  /**
   * Writes a copy of the document to a destination the user picks.
   *
   * ## THE PICKER RUNS OUTSIDE THE LANE, and that ordering is the decision
   *
   * A save dialog is open for as long as a person takes to think, and the lane
   * is what serialises every operation on this document. Picking inside it
   * would hold the document hostage to a modal window — no rotate, no undo, no
   * save, and `MAX_QUEUED` filling behind it — and a user who wandered off
   * would leave the document frozen with nothing on screen to explain why.
   *
   * So the destination is chosen first, and the lane is entered only once there
   * is work to do. What that costs is a window in which the document can close
   * or be poisoned while the dialog is up; both are caught inside the lane by
   * the same guards every other method runs, in the same order, and the answer
   * is the ordinary refusal rather than a special case.
   *
   * ## Cancellation short-circuits before the lane, not inside it
   *
   * `undefined` here means the user dismissed the dialog. It is returned
   * without entering the lane at all, because there is nothing to serialise:
   * no bytes were read, no version was stamped, and a lane entry that does
   * nothing is a lane entry that can still queue behind something slow.
   *
   * @param docId the open document
   * @returns what happened, or `undefined` when the user dismissed the picker.
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link
   *   DocumentPoisonedError}, {@link MissingSessionError}.
   */
  async saveCopy(docId: DocId): Promise<CopyOutcome | undefined> {
    // THE NAME IS READ BEFORE THE LANE and the document may close while the
    // dialog is up — which is fine, because a filename is all that was taken
    // and the guards inside the lane below refuse a closed document anyway. A
    // document this service does not hold has no name to offer, and that is
    // `DocumentNotOpenError` before a dialog appears rather than after the user
    // has chosen a file.
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'write a copy');

    const destination = await this.#copy.pick(suggestedCopyName(suggest));
    if (destination === null) return undefined;

    // THE LANE ENTRY TAKES NO CONTEXT, and that is `writeDocumentCopy`'s own
    // argument arriving one layer out: a context is what a stamp is made
    // through, this must not stamp, so it is not given one. The lane is still
    // entered — the flush must be serialised against every other operation on
    // this document — and what it cannot do is mark the document clean.
    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // THE SAME FLUSH A SAVE USES, so a copy and a save cannot disagree about
      // what this document currently is (B3a). `writeDocumentCopy` is handed no
      // `DocumentContext`, so it cannot stamp the document clean.
      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        () => this.#save.flush(docId, sessions),
        destination,
      );
    });

    return value;
  }

  async save(docId: DocId): Promise<SaveOutcome> {
    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await saveDocument(this.#save.deps, context, () =>
        this.#save.flush(docId, sessions),
      );
    });

    return value;
  }
}
