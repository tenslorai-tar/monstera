import {
  MIN_SNAPSHOT_SCALE,
  type AnnotationDataFormat,
  type AnnotationRect,
  type AnnotationStamp,
  type LibraryEntry,
  MAX_ANNOTATION_DATA_BYTES,
  type Command,
  type CommandKind,
  type CommandOfKind,
  targetVersionOf,
  type FormDataFormat,
  type FormDataImportFormat,
  MAX_FORM_DATA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_LIBRARY_PICTURE_BYTES,
  MAX_MARKDOWN_BYTES,
  MAX_CSV_BYTES,
  MAX_OFFICE_IMPORT_BYTES,
  MAX_IMPORT_IMAGES,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_IMPORT_IMAGE_PIXELS,
  MAX_STRUCTURE_NAME,
  MAX_STRUCTURE_NODES,
  MAX_SERVICE_DETAIL,
  type PageSet,
  type PowerPointMode,
  pageSetOf,
  type AskAbout,
  type AskSent,
  type AskLabel,
  MAX_ASK_CONTEXT,
  MAX_TABLE_CELL_TEXT,
  MAX_TABLE_CELLS,
  type SERVICE_REFUSALS,
  type TABLE_ENGINES,
  type OptimizeSetting,
  MAX_TEXT_LAYER_LINE,
  type PageImageFormat,
  type BoxedCharacter,
  type ComposeRefusal,
  type UrlFetchRefusal,
  type RequestedSignatureMark,
  type SignaturePlacement,
  type DocusignRefusalKind,
  type SignRefusal,
  type TimestampAuthority,
  type TextBlockStyle,
  type WordMode,
  type SaveWriteCause,
  type FileAccess,
  type FormFieldHandle,
  type FormFieldRead,
  type ImportSkipped,
  keptLookOf,
  placedMarkOf,
  sourceIdsOf,
  type BoxedInEditEntry,
  cappedBoxes,
} from '@monstera/contract';
// DECLARATIONS, not specs. This reads `spec.writer` and calls nothing on it, so
// importing the spec table would bind the MuPDF native library **in main** —
// which invariant 20 forbids by name and §9.17's budget is argued against
// (ADR-0026). The kernel's barrel is now free of that edge too.
import {
  type PageContent,
  type PageTables,
  type PresentationPage,
  type Raster,
  type ReviewGrid,
  type SheetLayout,
  type SpreadsheetPage,
  type TableEdit,
  editsFit,
  reviewGridOf,
  spreadsheetParts,
  ooxmlPackage,
  pictureScale,
  presentationParts,
  slideSize,
  rasterScale,
  type ByteImage,
  type AccessibilityReportOnWire,
  barcodeRect,
  copyNames,
  type CommandBus,
  type FlatFieldCandidate,
  type RemoteImportPlan,
  type FoundBarcode,
  DocumentNotOpenError,
  type DocumentContext,
  type DocumentService,
  type PageGeometry,
  type Destination,
  type ListedDestinations,
  type DuplicatePageGroup,
  type ListedAnnotation,
  type ListedField,
  type Layer,
  type ListedLayers,
  type LinkAddress,
  type ListedPageLinks,
  type PageLink,
  type PageStructure,
  type PageText,
  type StructureOutline,
  type RecognitionRequest,
  type RecognisedPage,
  type PageRewrite,
  type PageRuns,
  type SaveDependencies,
  type CopyOutcome,
  type CopyTargetVerdict,
  type SaveOutcome,
  type SearchOptions,
  type CommandInputs,
  type SessionsByWriter,
  type RegionRequest,
  type PageImageRequest,
  type SnapshotWrite,
  type PageKind,
  type TextLayerLine,
  type TextMatch,
  contactCardFileText,
  countPageWords,
  findInPages,
  plainTextOf,
  type AskWindow,
  carriedWindow,
  commentsWindow,
  pictureSent,
  readAskWindow,
  structureOutlineOf,
  textLayerOf,
  saveDocument,
  placeStaged,
  type StagedImage,
  stagedBytes,
  type SplitOutcome,
  type MupdfSession,
  type NextSave,
  type ReadSignature,
  SignatureAppearanceRefusedError,
  SignatureCredentialRefusedError,
  SignatureProtectedDocumentError,
  SignatureTooLargeError,
  TimestampRefusedError,
  TimestampUnreachableError,
  type DocusignSigner,
  type EditableBlock,
  EngineCallFailed,
  writeDocumentCopy,
  writeDocumentSplit,
  writeStreamedDocument,
  clearBackups as clearStoredBackups,
  listStoredBackups,
  storedBackupPath,
  writeBackupNote,
  UrlFetchRefused,
  checkedUrl,
  PngPixelsRefused,
  AzureRecognitionRefused,
  ClaudeRecognitionRefused,
  NoTablesToWrite,
  type RecognisedTable,
  RecognisedTableRefused,
  type PageWordBoxes,
  pagesOf,
  breaksSignatures,
  StaleTargetError,
  saveWriteCause,
  type SaveBackups,
  type LogEntry,
} from '@monstera/kernel';
import type { BarcodeWriteFormat } from '@monstera/kernel/barcode';
import type { ProtectionTerms } from './documentPasswords.js';
import {
  type DocId,
  type DocVersion,
  type HeldPassword,
  type QueryProblem,
  type WordCount,
  compileQuery,
} from '@monstera/shared';
// THE ONE PATH JOIN IN THIS FILE, and it is not invariant L2's concern: the
// directory came from a picker in this process and never crosses to the
// renderer, exactly as a destination does. What L2 forbids is a path in a
// renderer-facing type.
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { BackupProvenance } from './backupLedger.js';
import { moveLegacyBackups, scanLegacyBackups } from './legacyBackups.js';
import { type EditableSources, editablePages, emptyReport } from './editablePowerPoint.js';
import { DocusignOutcomeRefused, type DocusignSession } from './docusignSession.js';
import {
  EXTERNAL_EDIT_WAIT_MS,
  type EditWait,
  type EditWatch,
  type EditWatchSurface,
  watchEdits,
} from './externalEditWatch.js';
import { type LayoutTextSource, LayoutTextFailedError } from './layoutText.js';
import {
  type OfficeConversion,
  type OfficeSource,
  type WorkbookBlock,
  OfficeConversionFailedError,
  officeImportFormatOf,
} from './officeConversion.js';
import { type PdfaSource, PdfaFailedError } from './pdfaConversion.js';
import type { HeldPicture } from './heldPicture.js';
import { type SignaturePictureSource, pickSignaturePicture } from './signaturePicture.js';
import type { PersonalLibrary } from './personalLibrary.js';
import { type PrintDestination, PrintFailedError } from './printing.js';
import type { RecentPictures } from './recentPictures.js';
import { type ShareDestination, ShareFailedError, shareTitle } from './sharing.js';
import { type OpenExternalEditor, isPdfPath } from './openExternalEditor.js';

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
  /**
   * Whether this document's file opens only with a password — the supervisor's one answer, read before anything is
   * kept of the document that anyone could open (`EngineSessions.opensOnlyWithPassword`).
   */
  readonly opensOnlyWithPassword: (docId: DocId) => boolean;
  /**
   * The key this document's file opens with, unrevealed, or `undefined` when it needs none (`EngineSessions.opensWith`,
   * ADR-0171). Read by everything that opens the document's bytes in a host of its own: a PDFium command and Optimize.
   */
  readonly opensWith: (docId: DocId) => HeldPassword | undefined;
  /**
   * A protect ran on this document: it opens and stands as `terms` leave it, and `step`, the protect's log entry, keeps
   * where it was (`EngineSessions.protected`, ADR-0171 Decision 8). Required, so a supervisor that does not follow a
   * protect is a compile error rather than every later reopen trying the password the document no longer has.
   */
  readonly protected: (docId: DocId, step: object, terms: ProtectionTerms) => void;
  /** The protect `step` is being undone (`before`) or redone (`after`): `EngineSessions.protectionStepped`. */
  readonly protectionStepped: (docId: DocId, step: object, to: 'before' | 'after') => void;
  /**
   * The looping-command ledger (ADR-0221): which command kind the host is running for a document, and whether one has
   * looped the engine often enough to be refused. The bound stays with the supervisor, for `poisoned`'s reason.
   */
  readonly commandBegan: (docId: DocId, kind: string) => void;
  readonly commandEnded: (docId: DocId, kind: string, succeeded: boolean) => void;
  readonly commandBarred: (docId: DocId, kind: string) => boolean;
}

/**
 * How a protect replaces a document's plaintext copies with ones encrypted under its terms
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8).
 * Composed where the engine host is, because only a host may open a document's bytes.
 */
export interface ProtectedCopies {
  /**
   * Rewrites the file at `path` encrypted under `command`, in a host session of its own, when it opens with no key and
   * carries no encryption at all; answers its new length, or `undefined` for a copy left as it was. An encrypted copy
   * is left: it is protected already, and rewriting it would replace an owner password main never saw.
   */
  readonly seal: (docId: DocId, path: string, command: CommandOfKind<'setDocumentProtection'>) => Promise<number | undefined>;
  /** Rewrites the live session's snapshot from the canonical image, which a protect has just made encrypted. */
  readonly refreshSnapshot: (docId: DocId) => Promise<void>;
}

/** The terms the holder follows, for a protect; `undefined` for every other command. */
function protectionTermsOf(command: Command): ProtectionTerms | undefined {
  if (command.kind !== 'setDocumentProtection') return undefined;
  return { encryption: command.encryption, userPassword: command.userPassword };
}

/** Whether a log entry is a protect's, so its undo or redo moves the holder. */
function isProtectStep(entry: LogEntry | undefined): entry is LogEntry {
  return entry?.command.kind === 'setDocumentProtection';
}

/**
 * A command the document will not run again: it ended the engine on three attempts (ADR-0221). The document is open,
 * its edits are safe, and every other command still works.
 */
export class CommandLoopedError extends Error {
  override readonly name = 'CommandLoopedError';
  constructor(
    readonly docId: DocId,
    readonly command: string,
  ) {
    super(`Command ${command} on document ${docId.slice(0, 8)}… ended the engine three times and is not run again.`);
  }
}

/**
 * Runs `run` under the looping-command ledger (ADR-0221): a command barred after three endings is refused before the host
 * is asked, and the ending of this one is recorded however it ends, the third naming itself at once.
 */
async function ledgered<T>(engine: EngineSessionSource, docId: DocId, kind: string, run: () => Promise<T>): Promise<T> {
  if (engine.commandBarred(docId, kind)) throw new CommandLoopedError(docId, kind);
  engine.commandBegan(docId, kind);
  try {
    const result = await run();
    engine.commandEnded(docId, kind, true);
    return result;
  } catch (error) {
    engine.commandEnded(docId, kind, false);
    // The ending that made this call fail may be the third: say so now rather than on the next attempt.
    if (engine.commandBarred(docId, kind)) throw new CommandLoopedError(docId, kind);
    throw error;
  }
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
 * Opens one document's sessions again from the bytes `write` puts down, keeping the old ones until the new exist
 * (`EngineSessions.renew`), and answers `locked` when those bytes open only with a password, the old sessions kept.
 * Composed at the root for {@link DocumentRestore}'s reason, and because the class a locked open throws is the host
 * opener's, in scope there and nowhere here.
 */
export type DocumentRenew = (docId: DocId, write: SnapshotWrite) => Promise<'renewed' | 'locked'>;

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
 * Where several documents go.
 *
 * {@link PickDestination}'s sibling and **not its parameterisation**: it
 * suggests nothing, because a folder has no name this application could
 * propose, and it answers the directory the files are derived into rather than
 * a file the user named.
 *
 * That asymmetry is the whole reason split needs its own seam. A save dialog
 * names one file; a split writes several, so the user chooses the place and
 * this build chooses the names — which is what makes the contested check
 * load-bearing rather than a formality, since the platform's own overwrite
 * confirmation cannot fire for a name the user never typed.
 *
 * `null` is the user dismissing the dialog — an outcome, not a failure. The
 * path never crosses to the renderer.
 */
export type PickDirectory = () => Promise<string | null>;

/**
 * Which image becomes a page.
 *
 * `PickDocument`'s shape rather than `PickDestination`'s: nothing is suggested,
 * because a picker for a file that already exists has nothing to name. The
 * answer is a path this process reads and never sends anywhere — the renderer
 * asked for *an image at page 3* and is told a version, exactly as opening
 * answers with a `DocId`.
 *
 * `null` is the user dismissing the dialog: an outcome, not a failure.
 */
export type PickImage = () => Promise<string | null>;

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
  return suffixed(name, 'copy');
}

/**
 * Whether a write of this document's content backs up the file it replaces: `none` while a removal is pending, for the
 * document's own save ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md))
 * and for every copy or export to a file a person picked
 * ([ADR-0164](../../../docs/DECISIONS/0164-a-removals-save-also-renews-the-hosts-copy-and-the-recent-picture.md)) —
 * one rule, read from the document's fact, so no writer spells its own.
 */
function backupsFor(context: DocumentContext): SaveBackups {
  return context.removedSinceSave ? 'none' : 'keep';
}

/**
 * The page every composed Markdown document is set at: US Letter, in points.
 *
 * See {@link DocumentCommands.composeMarkdownFile} for why it is one size.
 */
export const COMPOSED_PAGE = { width: 612, height: 792 } as const;

/**
 * The name the destination picker opens with for a composed Markdown file: the
 * source's own name with `.pdf` in place of its extension.
 *
 * The file NAME only, taken after the last separator of either kind, because the
 * picker is given a filename and a path would suggest a folder. A source whose name
 * is only an extension keeps it — `.md` becomes `.md.pdf` — rather than suggesting a
 * file called `.pdf`, which Windows hides.
 */
export function suggestedComposedName(source: string): string {
  const name = fileNameOf(source);
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.pdf`;
}

/**
 * The name an extract's picker opens with.
 *
 * *pages* rather than *copy*, because the two files are different things and a
 * destination folder holding both would otherwise offer no way to tell them
 * apart. It shares {@link suffixed} with the copy above rather than repeating
 * the extension arithmetic — the rule *"insert before the last dot, and append
 * when there is no extension"* is one rule, and the second caller is what makes
 * writing it twice a second opinion (B3a).
 */
export function suggestedExtractName(name: string): string {
  return suffixed(name, 'pages');
}

/**
 * The name a snapshot's picker opens with.
 *
 * **The EXTENSION changes, which is what makes this different from its two
 * neighbours** rather than a third suffix. `report.pdf` becomes
 * `report snapshot.png`: {@link suffixed} inserts before the last dot, so the
 * suffix lands correctly and the stem is then re-extended — a snapshot named
 * `.pdf` is a file the platform opens with the wrong application and the user
 * cannot see why.
 */
/**
 * What each export format is called on disk and in a dialog's filter.
 *
 * **One table for both**, so the suggested name and the filter cannot name
 * different extensions — which is the failure a save dialog produces silently,
 * by appending the filter's extension to a name that already had another one.
 */
export const FORM_DATA_FILES: Readonly<
  Record<FormDataFormat, { readonly extension: string; readonly label: string }>
> = {
  json: { extension: 'json', label: 'JSON form data' },
  xfdf: { extension: 'xfdf', label: 'XFDF form data' },
  fdf: { extension: 'fdf', label: 'FDF form data' },
};

/**
 * The name a form-data export's picker opens with.
 *
 * {@link suggestedSnapshotName}'s shape — suffix, then re-extend — and its
 * reason: a file the platform opens with the wrong application is one the user
 * cannot see the cause of. *data* rather than *copy* because the two files are
 * different things and a folder holding both would otherwise offer no way to
 * tell them apart.
 */
export function suggestedFormDataName(name: string, format: FormDataFormat): string {
  const suffixed_ = suffixed(name, 'data');
  const dot = suffixed_.lastIndexOf('.');
  const stem = dot <= 0 ? suffixed_ : suffixed_.slice(0, dot);
  return `${stem}.${FORM_DATA_FILES[format].extension}`;
}

/**
 * The name a text export's picker opens with: `report.pdf` becomes `report.txt`.
 *
 * **No suffix, unlike its two neighbours.** A snapshot and a form-data file sit
 * beside the document and are different things from it; a text export is the
 * same document's words, and `report text.txt` says nothing the extension does
 * not. The extension is REPLACED for {@link pageImageName}'s reason.
 */
export function suggestedTextName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot <= 0 ? name : name.slice(0, dot)}.txt`;
}

/**
 * The name a barcode's contact card is offered under: `report.pdf` becomes `report contact.vcf`.
 *
 * **Suffixed, unlike a text export**, for the snapshot's and the form-data file's reason: a contact card is something the
 * document carries, not the document's words, and a bare `report.vcf` would look like a conversion of the whole file. The
 * extension is replaced for {@link pageImageName}'s reason.
 */
export function suggestedContactName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot <= 0 ? name : name.slice(0, dot)} contact.vcf`;
}

/** The Office formats an export writes (ADR-0072). The format IS the extension. */
export type OfficeFormat = 'docx' | 'pptx' | 'xlsx';

/** Each format's label in the save dialog's filter, as a record so a new format owes one. */
export const OFFICE_FILES: Readonly<Record<OfficeFormat, { readonly label: string }>> = {
  docx: { label: 'Word document' },
  pptx: { label: 'PowerPoint presentation' },
  xlsx: { label: 'Excel workbook' },
};

/** Where an Office export goes: the save dialog narrowed to `format`, or `null` when dismissed. */
export type PickOffice = (sourceName: string, format: OfficeFormat) => Promise<string | null>;

/** The name an Office export is offered under: the document's extension replaced, `suggestedTextName`'s rule. */
export function suggestedOfficeName(name: string, format: OfficeFormat): string {
  const dot = name.lastIndexOf('.');
  return `${dot <= 0 ? name : name.slice(0, dot)}.${format}`;
}

export function suggestedSnapshotName(name: string): string {
  const suffixed_ = suffixed(name, 'snapshot');
  const dot = suffixed_.lastIndexOf('.');
  return dot <= 0 ? `${suffixed_}.png` : `${suffixed_.slice(0, dot)}.png`;
}

/**
 * The filename one part of a split gets.
 *
 * **The PAGES name it, not a sequence number**, and that is the decision: a
 * reader looking at the folder afterwards wants to know which pages are where,
 * and `<stem> 3.pdf` tells them only which order the split ran in. So it is
 * `<stem> 4-9.pdf`, in the numbering a person counts in — 1-based, converted
 * here, which is the one place this file does that arithmetic.
 *
 * A single-page group is `<stem> 4.pdf` rather than `<stem> 4-4.pdf`, because
 * the second reads as a mistake.
 *
 * **Non-contiguous groups are named by their ENDS**, so `1, 5, 9` becomes
 * `<stem> 1-9.pdf` — which is imprecise, and the alternative is a filename
 * carrying an arbitrary number of parts. That is a real limitation and it is
 * bounded: the split surface only ever produces contiguous groups, so the
 * imprecise name is unreachable from it. It is written down because the method
 * takes any grouping and a later caller could reach it.
 */
export function splitPartName(name: string, pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  // NOT REACHABLE from the split surface, which refuses an empty group before
  // it gets here — and the type cannot say so, since `readonly number[]` admits
  // one. Naming the file after nothing would be worse than saying so.
  if (first === undefined || last === undefined) return suffixed(name, 'part');
  const span = first === last ? String(first + 1) : `${String(first + 1)}-${String(last + 1)}`;
  return suffixed(name, span);
}

/**
 * `<stem> <word><ext>`, or `<name> <word>` when there is no extension.
 *
 * `dot <= 0` rather than `dot === -1`, so a dotfile — a name whose only dot is
 * at index 0 — is treated as having no extension. Splitting it would produce a
 * file whose whole name is an extension.
 */
/**
 * Each annotation format's extension and the words its dialog filter shows (ADR-0077).
 * {@link FORM_DATA_FILES}' shape, with its own words: the same extension holds a different kind
 * of file, and a filter saying *form data* over a comments file would name the wrong one.
 */
export const ANNOTATION_DATA_FILES: Readonly<
  Record<AnnotationDataFormat, { readonly extension: string; readonly label: string }>
> = {
  json: { extension: 'json', label: 'JSON comments' },
  xfdf: { extension: 'xfdf', label: 'XFDF comments' },
  fdf: { extension: 'fdf', label: 'FDF comments' },
};

/** The name an annotation export's picker opens with: `report.pdf` becomes `report comments.xfdf`. */
export function suggestedAnnotationDataName(name: string, format: AnnotationDataFormat): string {
  const withWord = suffixed(name, 'comments');
  const dot = withWord.lastIndexOf('.');
  const stem = dot <= 0 ? withWord : withWord.slice(0, dot);
  return `${stem}.${ANNOTATION_DATA_FILES[format].extension}`;
}

/**
 * What exchanging annotations needs from the platform — {@link FormDataSource}'s four members,
 * for the annotations (ADR-0077). The read answers {@link FormDataRead}'s shape against
 * `MAX_ANNOTATION_DATA_BYTES`.
 */
export interface AnnotationDataSource {
  readonly pick: (sourceName: string, format: AnnotationDataFormat) => Promise<string | null>;
  readonly encode: (docId: DocId, sessions: DocumentSessions, format: AnnotationDataFormat) => Promise<ByteImage>;
  readonly open: (format: AnnotationDataFormat) => Promise<string | null>;
  readonly read: (path: string) => Promise<FormDataRead>;
}

/** What {@link DocumentCommands.importAnnotations} answers. */
export type ImportAnnotationsOutcome =
  | ({ readonly kind: 'imported' } & Applied)
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-large'; readonly limitBytes: number };

function suffixed(name: string, word: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} ${word}`;
  return `${name.slice(0, dot)} ${word}${name.slice(dot)}`;
}

export interface CopySource {
  /** Runs the platform's save dialog. See {@link PickDestination}. */
  readonly pick: PickDestination;
  /** Whether another open document reaches the chosen path. */
  readonly checkTarget: (destination: string) => Promise<CopyTargetVerdict>;
}

/** Where the saved-over versions are kept, and how a file's identity is read for the folder's hint (ADR-0198). */
export interface BackupStore {
  /** The data folder's `backups` directory. */
  readonly root: string;
  /** The file's identity now, for the hint a moved file is found by; `undefined` reads nothing. */
  readonly identity?: ((path: string) => Promise<{ readonly dev: number | null; readonly ino: number | null } | null>) | undefined;
}

/** One kept version, as the application names it: an opaque id, when it was saved over, and how big it is. */
export interface KeptVersion {
  readonly id: string;
  readonly savedAt: string;
  readonly bytes: number;
}

/**
 * What inserting an image needs, bundled for {@link CopySource}'s reason.
 *
 * One parameter for two dependencies, because the composition root's own
 * comment says a list of twelve becoming fourteen moves it further from the
 * options object it owes — and `ShellComposition` now IS that object, which
 * makes bundling a choice about this surface rather than a workaround for a
 * parameter list.
 */
/** What {@link DocumentCommands.insertImage} answers. */
export type InsertImageOutcome =
  | ({ readonly kind: 'inserted' } & Applied)
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-large'; readonly limitBytes: number }
  | { readonly kind: 'too-many-pixels'; readonly limitPixels: number };

/**
 * What {@link DocumentCommands.placeImage} answers.
 *
 * {@link InsertImageOutcome}'s members with one renamed: `placed` rather than
 * `inserted`, because the two operations differ in what happens to the page
 * count and a caller that treated them alike would be wrong about that.
 */
export type PlaceImageOutcome =
  | ({ readonly kind: 'placed' } & Applied)
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-large'; readonly limitBytes: number }
  /** The library picture named is no longer kept. */
  | { readonly kind: 'absent' };

/** What a save came to: the pipeline's outcomes, or a save held back because it would break signatures. */
export type SaveRequestOutcome =
  /**
   * Saved — and, where the save was a removal's, which older copies it deleted and which it kept; and, for every save,
   * the older copies still owed a deletion because another program holds them (CR-DOC-10).
   */
  | (Extract<SaveOutcome, { kind: 'saved' }> & {
      readonly cleared: ClearedCopies | null;
      readonly held: readonly string[];
    })
  | Exclude<SaveOutcome, { kind: 'saved' | 'write-failed' }>
  /** Not written, and why, from the failure and the file's access read just after it (`saveWriteCause`). */
  | (Extract<SaveOutcome, { kind: 'write-failed' }> & { readonly cause: SaveWriteCause })
  | { readonly kind: 'breaks-signatures'; readonly signatures: number };

/**
 * What a redaction's, Sanitize's or flatten's save deleted, permanently, because it may still have held what was
 * removed ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)): the backups
 * beside the file that Monstera made, by count, and the document's undo copies — and, BY NAME, the files with a
 * backup's name that Monstera did not make, which are kept for the person to decide.
 */
export interface ClearedCopies {
  readonly backups: number;
  readonly undoCopies: number;
  readonly kept: readonly string[];
}

/**
 * What placing and signing need from the person's library (`personalLibrary.ts`): a kept picture's bytes, and a kept
 * entry. Its own narrow surface, so this module reaches the library to READ it and never to change it.
 */
export interface LibraryReader {
  picture(id: string): { readonly mediaType: 'image/png' | 'image/jpeg'; readonly bytes: Uint8Array } | null;
  lookup(id: string): LibraryEntry | undefined;
}

/**
 * What placing a signature writes to the library (ADR-0133): a typed or drawn mark as it was made, or a picked picture
 * as a signature picture. The store's own two writes, narrowed to the ones a placement needs.
 */
export type LibraryKeeper = Pick<PersonalLibrary, 'keepSignature' | 'addPicture'>;

/** What placing a plain signature came to. */
export type PlaceSignatureOutcome =
  | ({ readonly kind: 'placed'; readonly kept: 'kept' | 'not-asked' | 'library-full' | 'not-keepable' } & Applied)
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-large'; readonly limitBytes: number }
  /** The kept signature named is no longer kept. */
  | { readonly kind: 'absent' }
  /** A scanned signature PDF picked at the click: its first page carries no ink, or it needs a password. */
  | { readonly kind: 'scan-blank' | 'scan-locked' };

/** Why a requested signature look did not resolve to a mark: the outcomes both routes share, named once. */
type NoSignatureMark =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'image-unreadable' }
  | { readonly kind: 'image-too-large' }
  | { readonly kind: 'saved-signature-missing' }
  | { readonly kind: 'scan-blank' }
  | { readonly kind: 'scan-locked' };

/**
 * Which decoder an extension routes to, or `null` for one this build has none for.
 *
 * Lower-cased because a user's filesystem does not care and Windows does not
 * either; `.JPG` is the same picture. The suffix is read from the path rather
 * than the bytes for the reason `insertImage` states: this is routing, and the
 * decoder is the validation.
 */
function imageMediaType(path: string): 'image/jpeg' | 'image/png' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

/**
 * What editing a page in another application needs from the platform, bundled for
 * {@link CopySource}'s reason (ADR-0062). Every member is a parameter: the launcher needs
 * Electron's `shell` and the watch needs Node's `fs`, and this file imports neither.
 */
export interface ExternalEditSource {
  /** Runs the platform's save dialog. See {@link PickDestination}. */
  readonly pick: PickDestination;
  /** Opens a `.pdf` in the operating system's handler. See {@link OpenExternalEditor}. */
  readonly open: OpenExternalEditor;
  /** The watch on a page sent out. See {@link EditWatchSurface}. */
  readonly watch: EditWatchSurface;
}

export interface ImageSource {
  /** Runs the platform's open dialog, narrowed to images. See {@link PickImage}. */
  readonly pick: PickImage;
  /**
   * The bytes at a path, and how big they are, **without reading them first**.
   *
   * Two answers from one call because the size decides whether the read
   * happens: a picked file past the bound is refused as a decided outcome, and
   * refusing it *after* loading it into memory would be a bound that costs
   * exactly what it exists to avoid.
   */
  readonly read: (path: string) => Promise<ImageRead>;
}

/**
 * How a PKCS#12 certificate reaches the signer.
 *
 * {@link ImageSource}'s shape, and it exists as its own surface for the reason
 * that one does: the picker's filters differ, and a single *pick a file*
 * surface would be one whose caller decides what the dialog offers — which is
 * the second opinion about a question each row already answers.
 *
 * **The bytes are a private key**, so the one thing this surface must never do
 * is put them anywhere but the command it was read for. `documentCommands.ts`
 * holds them in a local, hands them to `execute`, and lets the frame end
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)'s
 * rule, applied to the other kind of secret this build touches).
 */
export interface CertificateSource {
  /** Runs the platform's open dialog, narrowed to `.p12` and `.pfx`. */
  readonly pick: () => Promise<string | null>;
  /** The bytes at a path, or why they could not be read. */
  readonly read: (path: string) => Promise<CertificateRead>;
}

/** What {@link CertificateSource.read} answers. */
export type CertificateRead =
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'unreadable' };

/** What signing produced. */
export type SignOutcome =
  | {
      readonly kind: 'signed';
      readonly version: DocVersion;
      readonly byteLength: number;
      readonly historyDropped: number;
    }
  | { readonly kind: 'cancelled' }
  // THE CONTRACT'S LIST, not five literals beside it: main answers the channel's
  // refusals and nothing else, and a kind added to `SIGN_REFUSALS` is one main
  // must be able to return.
  | { readonly kind: SignRefusal };

/** The source formats an import composes into a new PDF (ADR-0060). */
export type ImportFormat = 'markdown' | 'csv';

/**
 * Each import format's byte bound, checked before its read — the contract's
 * constants, one per format, because each was measured on its own composer.
 */
export const IMPORT_BYTE_LIMITS: Readonly<Record<ImportFormat, number>> = {
  markdown: MAX_MARKDOWN_BYTES,
  csv: MAX_CSV_BYTES,
};

/**
 * Which file an import reads.
 *
 * {@link PickImage}'s shape: nothing is suggested, and `null` is the user
 * dismissing the dialog.
 */
export type PickImportFile = () => Promise<string | null>;

/** What {@link ImportSource.read} answers. {@link ImageRead}'s shape. */
export type ImportRead =
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large'; readonly byteLength: number }
  | { readonly kind: 'unreadable' };

/**
 * What importing one format needs from outside this module.
 *
 * {@link ImageSource}'s bundling, for its reason: the picker needs Electron and the
 * bounded read needs Node's filesystem, and neither may be imported here.
 */
export interface ImportSource {
  /** Runs the platform's open dialog, narrowed to the format. */
  readonly pick: PickImportFile;
  /** The bytes at a path, bound-checked against the format's byte limit before the read. */
  readonly read: (path: string) => Promise<ImportRead>;
}

/**
 * What the compose host answers for one source
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * Declared here, where it is consumed, and the composition root's binding answers
 * this type rather than a second one beside it.
 */
export type ComposedImport =
  | {
      readonly kind: 'composed';
      readonly pdf: Uint8Array;
      /** Every place a character is drawn as the missing-character box, the first named and the rest counted (ADR-0172). */
      readonly boxed: readonly BoxedCharacter[];
      readonly more: number;
    }
  | {
      readonly kind: 'refused';
      readonly reason: ComposeRefusal;
      /** The one-based source line the refusal is about, where there is one. */
      readonly line: number | null;
      /** The one-based position of the image the refusal is about, for an image import. */
      readonly item: number | null;
    };

/**
 * How a source becomes a PDF, through the compose host — or `null` where no compose
 * host can exist, which is refused as {@link EngineUnavailableError} rather than
 * composed in `main`.
 */
export type ComposeImport =
  | ((
      format: ImportFormat,
      source: Uint8Array,
      page: { readonly width: number; readonly height: number },
    ) => Promise<ComposedImport>)
  | null;

/**
 * What composing a picked file into a file on disk answers.
 *
 * `written` carries the destination, which is a **path** and never crosses to the
 * renderer: the handler opens it through the one route a document is opened by, and
 * what crosses is that open's outcome.
 */
export type ComposeImportOutcome =
  /** Written — and `boxed` names any characters drawn as the missing-character box; empty for none (ADR-0172). */
  | {
      readonly kind: 'written';
      readonly destination: string;
      readonly boxed: readonly BoxedCharacter[];
      readonly more: number;
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'too-large'; readonly limitBytes: number }
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'composition-refused';
      readonly reason: ComposeRefusal;
      readonly line: number | null;
      /** The picked file's NAME, where the import took several — never its path. */
      readonly file: string | null;
    }
  | { readonly kind: 'destination-contested'; readonly openElsewhere: number }
  | { readonly kind: 'write-failed' };

/**
 * Office import (ADR-0120): the picker and bounded read, and x2t's conversion in its container.
 * {@link ImportSource}'s bundling, for its reason.
 */
export interface OfficeImport {
  readonly source: ImportSource;
  readonly convert: OfficeSource;
}

/** What converting a picked Office file into a file on disk answers. {@link ComposeImportOutcome}'s shape. */
export type OfficeImportOutcome =
  /** Written — and `missing` names any rows of a workbook the PDF does not hold (decision C); empty otherwise. */
  | { readonly kind: 'written'; readonly destination: string; readonly missing: readonly WorkbookBlock[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'too-large'; readonly limitBytes: number }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'conversion-failed' }
  | { readonly kind: 'destination-contested'; readonly openElsewhere: number }
  | { readonly kind: 'write-failed' };

/**
 * Which images an import reads, or `null` for the person dismissing the dialog.
 *
 * {@link PickImportFile}'s shape with a list: one import makes one page per file.
 */
export type PickImportFiles = () => Promise<readonly string[] | null>;

/**
 * What importing several images needs from outside this module.
 *
 * `size` is asked of every file BEFORE any is read, so the set's byte bound is decided
 * with nothing in memory; `read` is `ImageSource`'s bounded read, reached one file at a
 * time when the composition takes that file.
 */
export interface ImageFilesSource {
  readonly pick: PickImportFiles;
  /** A file's size in bytes without reading it, or `null` where it cannot be stated. */
  readonly size: (path: string) => Promise<number | null>;
  readonly read: ImageSource['read'];
}

/** One picked image as the compose host binding takes it: its decoder, and its read. */
export interface ComposeImageItem {
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly read: () => Promise<ImageRead>;
}

/**
 * How picked images become a PDF, through the compose host — or `null` where no compose
 * host can exist. {@link ComposeImport}'s shape; `unreadable` is a file whose bounded
 * read failed when its turn came, which the binding meets and this module did not.
 */
export type ComposeImages =
  | ((images: readonly ComposeImageItem[]) => Promise<ComposedImport | { readonly kind: 'unreadable' }>)
  | null;

/** What importing several images answers: an import's outcomes, and the set's two bounds. */
export type ImageImportOutcome =
  | ComposeImportOutcome
  | { readonly kind: 'too-many-images'; readonly limit: number }
  | { readonly kind: 'images-too-large'; readonly limitBytes: number };

/**
 * The order picked images become pages in: by file name, with digits compared as
 * numbers, so `scan 2` comes before `scan 10`.
 *
 * A STATED ORDER rather than the dialog's, because the order an open dialog returns a
 * multiple selection in is the platform's and is not the order the files are listed in,
 * so it is not an order a person can predict. English collation, pinned, so the pages
 * of one set of files come out the same on every machine.
 */
const IMAGE_PAGE_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * How a document is fetched from a URL a person gave: the kernel's SSRF guard, bounded,
 * in production (ADR-0061). A failure of the guard is a `UrlFetchRefused`, thrown when
 * the fetch starts or while its body is read.
 */
export type FetchUrl = (url: string) => Promise<AsyncIterable<Uint8Array>>;

/** What opening from a URL answers before the open. `written` carries a path, which never crosses. */
export type UrlOpenOutcome =
  | { readonly kind: 'written'; readonly destination: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'url-refused'; readonly reason: UrlFetchRefusal }
  | { readonly kind: 'destination-contested'; readonly openElsewhere: number }
  | { readonly kind: 'write-failed' };

/**
 * The name the save dialog opens with for a document fetched from a URL: the path's last
 * segment, decoded, as a PDF name — or the host, for an address with no path.
 *
 * A separator a segment decodes to is replaced, because the dialog is given a file name
 * and `%2F` would otherwise suggest a folder.
 */
export function suggestedUrlName(url: URL): string {
  const segment = url.pathname.split('/').filter((part) => part !== '').at(-1);
  // THE HOST WHOLE, never through the extension rule below: `example.com` is a name,
  // and treating `.com` as its extension would suggest `example.pdf`.
  if (segment === undefined) return `${url.hostname}.pdf`;
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch (error) {
    // A MALFORMED ESCAPE is the address's own spelling, and the segment as written is
    // still a usable name. Anything other than that one error is not this case.
    if (!(error instanceof URIError)) throw error;
    name = segment;
  }
  const safe = name.replace(/[\\/]/gu, '_');
  return /\.pdf$/iu.test(safe) ? safe : suggestedComposedName(safe);
}

/** A path's file name: what follows the last separator of either kind. */
function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/** What {@link ImageSource.read} answers. */
export type ImageRead =
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large'; readonly byteLength: number }
  | { readonly kind: 'unreadable' };

export interface SaveSource {
  /** The write-target check and the filesystem the atomic ordering runs on. */
  readonly deps: SaveDependencies;
  /** A document's current bytes. */
  readonly flush: DocumentFlush;
  /**
   * The same bytes, staged where the engine wrote them and never read into `main` — what a save, a copy of the
   * document and a refreshed image are made from
   * ([ADR-0121](../../../docs/DECISIONS/0121-main-never-holds-two-images.md) Decision 2 and its addendum).
   */
  readonly stage: DocumentStage;
  /**
   * Which backups Monstera made, recorded as each save makes one and asked before a removal's save deletes one
   * ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)). REQUIRED, so no
   * composition can save without a record of what it may later delete.
   */
  readonly provenance: BackupProvenance;
}

/** {@link DocumentFlush}, staged. Composed in the same place, for the same reason. */
export type DocumentStage = (docId: DocId, sessions: DocumentSessions) => Promise<StagedImage>;

/**
 * The document as a Word package, composed where its pictures are drawn and staged there for `main` to move — never
 * read into `main` ([ADR-0072](../../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)'s
 * amendment of 2026-10-01). {@link DocumentStage}'s shape with a mode.
 */
export type DocumentWordExport = (
  docId: DocId,
  sessions: DocumentSessions,
  mode: WordMode,
  pages: PageSet,
) => Promise<StagedImage>;

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

/**
 * An edit that would break a signed document's signatures, refused before anything changed
 * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)).
 *
 * Not a fault: it is the question the person is asked, and the handler answers it as the declared
 * `breaks-signatures`. The count is a main-side diagnostic.
 */
export class SignaturesWouldBreakError extends Error {
  override readonly name = 'SignaturesWouldBreakError';

  constructor(kind: CommandKind, signatures: number) {
    super(
      `${kind} would rewrite a document carrying ${String(signatures)} signature(s) whole, which breaks them; ` +
        'nothing was changed, and the person is asked first (ADR-0149).',
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
 * Reads one page's tagged structure.
 *
 * Injected for {@link DocumentPageText}'s reason, and one page for the same one. It
 * answers a PARSED structure, so this module holds no reader of MuPDF's format:
 * `parsePageStructure` runs where `parsePageText` does, over the same walk
 * ([ADR-0065](../../../docs/DECISIONS/0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md)).
 */
export type DocumentPageStructure = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<PageStructure>;

/**
 * Reads the tables MuPDF finds on one page.
 *
 * Injected and one page for {@link DocumentPageText}'s reasons, and parsed where it
 * is composed, for {@link DocumentPageStructure}'s — the `table` read
 * ([ADR-0073](../../../docs/DECISIONS/0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)).
 */
export type DocumentPageTables = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<PageTables>;

/**
 * What an Excel export did: a copy's outcomes, or — before any file was picked —
 * that no page holds a table, with how many pages are a picture with no text.
 */
export type ExcelOutcome =
  | CopyOutcome
  | { readonly kind: 'no-tables'; readonly picturePages: number }
  | { readonly kind: 'changed' }
  | ServiceRefusal;

/** The services a table export may be read by (ADR-0086). */
export type NetworkTableEngine = Exclude<(typeof TABLE_ENGINES)[number], 'automatic'>;

/** A network engine that did not read a page, with the page it was reading. */
export interface ServiceRefusal {
  readonly kind: 'service-refused';
  readonly engine: NetworkTableEngine;
  readonly page: number;
  readonly reason: (typeof SERVICE_REFUSALS)[number];
  readonly detail: string;
}

/**
 * How one page's tables are read by a service (ADR-0086): the page rasterised in the engine host
 * within the service's byte limit, and sent from `main`. Composed where the credentials and the
 * host are, which is `composition.ts`.
 *
 * @throws the service's own refusal — `AzureRecognitionRefused`, `ClaudeRecognitionRefused` or
 *   `RecognisedTableRefused` — or `NetworkKeyMissing` where no key is stored
 */
export type NetworkTableReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  engine: NetworkTableEngine,
) => Promise<readonly RecognisedTable[]>;

/**
 * A picture of one page for a vision ask (ADR-0090): drawn in the engine host within the image
 * limits every provider shape accepts, weighed in `main` and retaken smaller while it is over.
 * Composed beside {@link NetworkTableReader}, whose route it is.
 *
 * @throws {@link PageTooLargeToPicture} when even the whole page's floor scale is over the limits
 */
export type AskPictureReader = (docId: DocId, sessions: DocumentSessions, page: number) => Promise<Uint8Array>;

/** A page too large to picture within the image limits even at `MIN_PAGE_PICTURE_SCALE`, which no page PDF allows is. */
export class PageTooLargeToPicture extends Error {
  constructor(readonly page: number) {
    super(`page ${String(page + 1)} is too large to picture within the image limits`);
    this.name = 'PageTooLargeToPicture';
  }
}

/** No key is stored for the engine the export was asked to use. */
export class NetworkKeyMissing extends Error {
  constructor(readonly engine: NetworkTableEngine) {
    super(`no ${engine === 'azure' ? 'Azure Document Intelligence endpoint and key are' : 'Anthropic key is'} stored`);
    this.name = 'NetworkKeyMissing';
  }
}

/**
 * A page's refusal as the channel carries it: the service's own kind where it gave one, and the
 * sentence main built — bounded, because the service's words in it are the peer's.
 *
 * A thrown value that is none of the four known refusals is NOT turned into one: it is a defect,
 * and rethrowing it sends it to the incident log rather than dressing it as a service's answer.
 */
function serviceRefusal(engine: NetworkTableEngine, page: number, thrown: unknown): ServiceRefusal {
  const reason = serviceReasonOf(thrown);
  if (reason === undefined) throw thrown;
  return {
    kind: 'service-refused',
    engine,
    page,
    reason,
    detail: (thrown as Error).message.slice(0, MAX_SERVICE_DETAIL),
  };
}

/**
 * Which service refusal a thrown value is, or `undefined` where it is none of the four known
 * ones — and then a defect, which the caller rethrows.
 *
 * The one place a network engine's refusal is classified: the tables export reports it as
 * `service-refused`, and `commandHandlers.ts` as a region recognition's declared code, and two
 * lists of the four classes would be two opinions about which of them is a person's situation.
 */
export function serviceReasonOf(thrown: unknown): ServiceRefusal['reason'] | undefined {
  if (thrown instanceof AzureRecognitionRefused || thrown instanceof ClaudeRecognitionRefused) return thrown.reason;
  if (thrown instanceof RecognisedTableRefused) return 'unplaceable';
  if (thrown instanceof NetworkKeyMissing) return 'no-key';
  return undefined;
}

/** A page's refusal while the workbook streams, carrying which page, so it can be answered. */
class PageRefused extends Error {
  constructor(
    readonly page: number,
    readonly original: unknown,
  ) {
    super(`page ${String(page + 1)} was not read`, { cause: original });
    this.name = 'PageRefused';
  }
}

/** The person asked a service-read export to stop (ADR-0202 Decision 5): thrown between pages, answered as a cancelled picker. */
class ExportCancelled extends Error {
  constructor() {
    super('the export was cancelled between pages');
    this.name = 'ExportCancelled';
  }
}

/** The resolutions a print may be asked for, in dots per inch. */
/**
 * The JPEG quality of a recent card's picture (ADR-0100). Measured 2026-09-25 by
 * `scripts/research/recentPreviewSize.mjs` over the 11-file corpus, page 1 at one pixel per point: quality 60
 * is a median of 67,321 bytes and a maximum of 73,186; 75 is 83,269 and 90,200; 90 is 118,772 and 129,919.
 * The lowest of the three, because the card draws the picture smaller than it is made; how it looks there is
 * judged by eye in the side-by-side captures, not measured.
 */
export const RECENT_PREVIEW_QUALITY = 60;

export const PRINT_DPIS = [150, 300, 600] as const;

export type PrintDpi = (typeof PRINT_DPIS)[number];

/**
 * A print's pixel budget: thirty megapixels a page, just under the engine's own
 * 32-megapixel bound, so a large page is drawn at a lower scale rather than refused —
 * this export's choice, not a copy of that bound. **600 dpi is not reached on US
 * Letter**: 612×792 pt at 600 dpi is 33,671,701 pixels, so it prints at about 566 dpi
 * (computed 2026-09-17 from `rasterScale`), and the dialog's label says *up to*.
 */
export const PRINT_PIXELS = 30_000_000;

/** What a print did. */
/** What emailing did: the sheet opened, there is none here, or a step before it refused. */
export type EmailOutcome =
  | { readonly kind: 'offered' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export type PrintOutcome =
  | { readonly kind: 'printed'; readonly pages: number }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

/** What the review grid hands an Excel export: the version it read, and the cells changed. */
export interface ExcelReview {
  readonly version: DocVersion;
  readonly edits: readonly (TableEdit & { readonly page: number })[];
  /** The pages whose tables are written (ADR-0161); the review itself may have looked at any. */
  readonly pages: PageSet;
}

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
) => Promise<ListedPageLinks>;

/** One link's whole address, read in the engine host by its place on its page (ADR-0167). */
export type DocumentLinkAddressReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  index: number,
) => Promise<LinkAddress>;

/** What {@link DocumentCommands.linkAddress} answers: the link's address, why there is none, or that it moved. */
export type LinkAddressOutcome = LinkAddress | { readonly kind: 'stale' };

/** One page's links, stamped with the version the lane read them at, and whether the walk stopped at its bound. */
export interface DocumentPageLinks {
  readonly version: DocVersion;
  readonly links: readonly PageLink[];
  readonly truncated: boolean;
}

/** Reads one page's word boxes (ADR-0137), injected for {@link DocumentPageLinksReader}'s reason. */
export type DocumentWordBoxesReader = (docId: DocId, sessions: DocumentSessions, page: number) => Promise<PageWordBoxes>;

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
) => Promise<ListedDestinations>;

/**
 * Recognises one page's text, through the engine host.
 *
 * Injected for {@link DocumentPageText}'s reason, and it TAKES A PAGE — which is
 * the difference ADR-0051 is about. An outline is a property of the document; a
 * recognition is a property of a page, and the request is the pre-read's `needs`
 * arriving from the command's own declaration.
 *
 * **Where the models live is not in the request.** That is main's answer and the
 * composition root supplies it, which is ADR-0014's constraint 1 in the direction
 * it cares about: nothing a renderer sends can name a datadir.
 */
export type DocumentOcrReader = (
  docId: DocId,
  sessions: DocumentSessions,
  request: RecognitionRequest,
) => Promise<RecognisedPage>;

/**
 * One page's joined runs with their members, through the PDFium host: `editTextOperators`' pre-read
 * ([ADR-0176](../../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)'s
 * correction). {@link DocumentOcrReader}'s shape, per page for its reason, and read from the bytes the bus is about to
 * apply to, so the runs it names are the ones on the page the edit writes.
 */
export type DocumentPageRunsReader = (docId: DocId, sessions: DocumentSessions, page: number) => Promise<PageRuns>;

/** The outline, stamped with the version the lane read it at. */
export interface DocumentDestinations {
  readonly version: DocVersion;
  readonly destinations: readonly Destination[];
  /** Whether the walk stopped at its bound, which no real outline reaches (ADR-0130 Decision 3). */
  readonly truncated: boolean;
}

/**
 * Builds a NEW document from the named pages, through whichever host is live.
 *
 * Injected for {@link DocumentPageText}'s reason and shaped like the readers
 * beside it, and it is **not** a read: it produces a second document's bytes
 * rather than answering a question about this one. Named accordingly so the
 * next person adding to this list does not assume the family is uniform.
 */
export type DocumentExtractReader = (
  docId: DocId,
  sessions: DocumentSessions,
  /** A page set, listed against the document where the engine is (JOURNAL, *No document-size refusals*). */
  pages: PageSet,
) => Promise<ByteImage>;

/**
 * Encodes one page as an image, through whichever host is live.
 *
 * {@link DocumentExtractReader}'s sibling and not a read either: it produces a
 * file's bytes. It runs in the host because rasterising reaches MuPDF.
 */
export type DocumentPageImageReader = (
  docId: DocId,
  sessions: DocumentSessions,
  request: PageImageRequest,
) => Promise<ByteImage>;

/**
 * The filename a page's image is written under: page 3 of `report.pdf` as a
 * JPEG is `report 3.jpg`.
 *
 * **The document's extension is REPLACED, not kept**, which is where this
 * differs from {@link splitPartName}: `report 3.pdf.png` would be a file whose
 * name says it is two things. `.jpg` rather than `.jpeg`, because that is the
 * spelling people and the platform's own file associations expect.
 *
 * One-based, as every page number a person reads is; `page` arrives zero-based.
 */
export function pageImageName(name: string, page: number, format: PageImageFormat): string {
  const dot = name.lastIndexOf('.');
  // `dot <= 0` for `suffixed`'s reason: a dotfile has no extension to replace.
  const stem = dot <= 0 ? name : name.slice(0, dot);
  return `${stem} ${String(page + 1)}.${PAGE_IMAGE_EXTENSIONS[format]}`;
}

/**
 * Each format's file extension, as a RECORD over the format union.
 *
 * This was a ternary, `format === 'jpeg' ? 'jpg' : 'png'`, which named every
 * format that is not JPEG a PNG — correct while there were two, and the day WebP
 * joined the union it would have written WebP bytes under `.png` and compiled.
 * A record keyed by the union is a compile error for a format with no extension.
 */
const PAGE_IMAGE_EXTENSIONS: Readonly<Record<PageImageFormat, string>> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

/**
 * Rasterises a region of a page, through whichever host is live.
 *
 * {@link DocumentExtractReader}'s sibling and not a read either: it produces a
 * PNG rather than answering a question about the document. Injected for the
 * same reason — main holds no engine, and every one of these is how a question
 * reaches the process that does.
 */
export type DocumentSnapshotReader = (
  docId: DocId,
  sessions: DocumentSessions,
  request: RegionRequest,
) => Promise<ByteImage>;

/**
 * What snapshotting a region needs, bundled for {@link CopySource}'s reason.
 *
 * **A SECOND PICKER RATHER THAN A PARAMETER ON THE FIRST**, which is
 * `destinationPicker.ts`'s own argument taken at its word: the two dialogs
 * differ in the filter they offer and in the name they suggest, and a shared
 * picker taking a format would be a branch on *which dialog* wearing the shape
 * of an abstraction. The contested-destination check is NOT duplicated — a PNG
 * written over an open document is the same hazard whatever its extension, so
 * the snapshot takes `CopySource`'s `checkTarget` and the whole atomic write
 * behind it.
 */
export interface SnapshotSource {
  /** Runs the platform's save dialog, narrowed to a PNG. */
  readonly pick: PickDestination;
  /** How a region becomes PNG bytes. */
  readonly region: DocumentSnapshotReader;
}

/**
 * Encodes the form's data, through whichever host is live.
 *
 * {@link DocumentSnapshotReader}'s sibling and not a read either: it produces a
 * file rather than answering a question. It runs in the host because reading
 * the fields reaches MuPDF, and because `document.formFields` is bounded for a
 * panel a reader looks at — an export built from that answer would be
 * truncated at both bounds without saying so.
 */
export type DocumentFormDataReader = (
  docId: DocId,
  sessions: DocumentSessions,
  format: FormDataFormat,
) => Promise<ByteImage>;

/**
 * What exporting form data needs, bundled for {@link SnapshotSource}'s reason.
 *
 * **The picker takes the FORMAT rather than a suggested name**, which is the
 * one place this departs from `destinationPicker.ts`' *a sibling rather than a
 * parameter*. That argument is about two different dialogs — a copy and a
 * snapshot — sharing one function; this is ONE dialog whose filter and
 * suggested extension are both the user's own choice of format, and they come
 * from a single table, so the pair cannot disagree. Three sibling pickers
 * differing in one literal each would be the same table written three times.
 */
export interface FormDataSource {
  /** Runs the platform's save dialog, narrowed to the chosen format. */
  readonly pick: (sourceName: string, format: FormDataFormat) => Promise<string | null>;
  /** How the form's data becomes bytes. */
  readonly encode: DocumentFormDataReader;
  /** Runs the platform's open dialog, narrowed to the chosen format. */
  readonly open: PickFormDataFile;
  /**
   * The bytes at a path, and how big they are, **without reading them first**.
   *
   * `ImageSource.read`'s shape and its reason: the size decides whether the
   * read happens, and refusing a picked file after loading it into memory is a
   * bound that costs exactly what it exists to avoid.
   */
  readonly read: (path: string) => Promise<FormDataRead>;
}

/**
 * The open dialog for a data file to import.
 *
 * `PickImage`'s shape with the format added, for the reason
 * {@link FormDataSource.pick} takes one: it decides the filter, and it is the
 * user's own choice rather than a branch between two dialogs.
 */
export type PickFormDataFile = (format: FormDataImportFormat) => Promise<string | null>;

/** What {@link FormDataSource.read} answers. {@link ImageRead}'s shape. */
export type FormDataRead =
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large'; readonly byteLength: number }
  | { readonly kind: 'unreadable' };

/** What {@link DocumentCommands.importFormData} answers. */
export type ImportFormDataOutcome =
  | ({
      readonly kind: 'imported';
      /** How many fields it filled, and the fields it left alone with a reason each (ADR-0193's neighbour). */
      readonly filled: number;
      readonly skipped: readonly ImportSkipped[];
      readonly more: number;
    } & Applied)
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'matched-nothing'; readonly named: number }
  | { readonly kind: 'too-large'; readonly limitBytes: number };

/**
 * Proposes fields on one flat page, through whichever host is live.
 *
 * Per page, unlike every reader beside it, because what it feeds is a review of
 * the page in front of the reader rather than a description of the document.
 */
export type DocumentFlatFieldsReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<{
  readonly candidates: readonly FlatFieldCandidate[];
  readonly truncated: boolean;
  readonly alreadyFields: number;
}>;

/** How one page's barcodes are read: `DocumentFlatFieldsReader`'s shape, in the engine host. */
export type DocumentBarcodesReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<{ readonly barcodes: readonly FoundBarcode[]; readonly truncated: boolean }>;

/** The barcodes, stamped with the version the lane read them at. */
export interface DocumentBarcodes {
  readonly version: DocVersion;
  readonly barcodes: readonly FoundBarcode[];
  readonly truncated: boolean;
}

/** How a document's accessibility check is read: in the engine host, whole (ADR-0078). */
export type DocumentAccessibilityReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<AccessibilityReportOnWire>;

/** The symbologies a person may generate. A type import, which loads nothing. */
export type BarcodeFormat = BarcodeWriteFormat;

/**
 * How a barcode is written for placement: the PNG and its size, or zxing-cpp's refusal. The
 * refusal carries no words: zxing-cpp's are English and the renderer shows message keys (B9).
 *
 * A refusal is an ANSWER rather than a throw, because the composition point is where the writer's
 * error class is in reach — it is loaded by a dynamic import there — and matching it anywhere
 * else would be matching a name across a module boundary.
 */
export type BarcodeWriter = (
  text: string,
  format: BarcodeFormat,
) => Promise<
  | { readonly kind: 'written'; readonly png: Uint8Array; readonly width: number; readonly height: number }
  | { readonly kind: 'refused' }
>;

/**
 * The production {@link BarcodeWriter}: zxing-cpp's writer, reached by a dynamic import the first
 * time a person places a barcode, so its glue is never part of `main`'s startup graph. Its input
 * is text a person typed, not a document, which is why it may run in `main` at all (ADR-0076).
 */
export const lazyBarcodeWriter: BarcodeWriter = async (text, format) => {
  const { BarcodeTextRefusedError, writeBarcodePng } = await import('@monstera/kernel/barcode');
  try {
    return { kind: 'written', ...(await writeBarcodePng(text, format)) };
  } catch (error) {
    if (error instanceof BarcodeTextRefusedError) return { kind: 'refused' };
    throw error;
  }
};

/** What {@link DocumentCommands.placeBarcode} answers. */
export type PlaceBarcodeOutcome =
  | ({ readonly kind: 'placed' } & Applied)
  | { readonly kind: 'refused' };

/** Plans an import of a data file against the document's form, through whichever host is live. */
export type DocumentFormImportPlanner = (
  docId: DocId,
  sessions: DocumentSessions,
  bytes: Uint8Array,
  format: FormDataImportFormat,
) => Promise<RemoteImportPlan>;

/** The named fields' properties, through whichever host is live (ADR-0193). */
export type DocumentFieldPropertiesReader = (
  docId: DocId,
  sessions: DocumentSessions,
  handles: readonly FormFieldHandle[],
) => Promise<readonly (FormFieldRead | null)[]>;

/** The named fields' properties, stamped with the version the lane read them at. */
export interface DocumentFieldProperties {
  readonly version: DocVersion;
  readonly fields: readonly (FormFieldRead | null)[];
}

/** The candidates, stamped with the version the lane read them at. */
export interface DocumentFlatFields {
  readonly version: DocVersion;
  readonly candidates: readonly FlatFieldCandidate[];
  readonly truncated: boolean;
  readonly alreadyFields: number;
}

/**
 * An engine this installation does not have was asked for.
 *
 * ## Why it is a class here and not `UnregisteredWriterError`
 *
 * That one is `CommandBus`' and means *no adapter is registered for this
 * command's writer of record*. This is a READ, so no command and no writer are
 * involved — the editing engine is simply absent, which is a state the shipped
 * product is deliberately in wherever PDFium was not provisioned. Constructing
 * the bus's error about a command that does not exist would be a lie with a
 * matching type.
 *
 * Both become `engine-unavailable` at the boundary, and that is one code for two
 * causes on the axis that matters — *can this installation do it at all* — which
 * is the same reasoning `engine-refused` carries on the host wire.
 *
 * **The message names no engine**, because more than one reaches here: PDFium where
 * it was not provisioned, and the compose host where no platform exists to create
 * it (ADR-0060). A sentence naming PDFium would tell a person importing Markdown
 * about the wrong engine; `what` says which operation it was.
 */
export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';

  constructor(what: string) {
    super(
      `${what} needs an engine this installation does not have. Nothing has changed, and ` +
        'nothing was asked of a host that was never created.',
    );
  }
}

/**
 * A page's editable text as visual lines, in the EDITING engine's numbering.
 *
 * `DocumentFlatFieldsReader`'s shape and its per-page reason, against the other
 * engine — and it may be absent, which is what the `null`-returning composition
 * point turns into {@link EngineUnavailableError}. The indices are PDFium's own
 * and are never joined to MuPDF's structured text: `commandDeclarations.ts`
 * gives `replaceTextObject` `targets: 'text-object'` precisely because that is a
 * third index space.
 *
 * The grouping into blocks happens at the composition point rather than here
 * or in the host — ADR-0049 permits it only while its output reaches the
 * in-place editor a person answers (ADR-0096), and one call site is what makes
 * that readable.
 */
export type DocumentTextBlocksReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<Omit<DocumentTextBlocks, 'version'>>;

/** The blocks, stamped with the version the lane read them at. */
export interface DocumentTextBlocks {
  readonly version: DocVersion;
  readonly blocks: readonly EditableBlock<TextBlockStyle>[];
  readonly truncated: boolean;
  /**
   * Characters on this page set at an angle, which are not offered for editing
   * in place: an editor cannot be placed along an axis the page is not set on.
   */
  readonly rotated: number;
  /** `rotated` by kind, so the editor can say which text is not offered and why (ADR-0181 Decision 7). */
  readonly angled: {
    readonly turned: number;
    readonly vertical: number;
    readonly slanted: number;
    readonly mirrored: number;
  };
  /**
   * Characters on this page no command can name — text inside a Form XObject.
   *
   * See `PageText.unaddressable`. A surface owes the reader a sentence when
   * this is non-zero, because the alternative is a page that looks half
   * editable with nothing saying why.
   */
  readonly unaddressable: number;
  /**
   * Which writer rewrites this page's text (ADR-0176 Decision 1): `objects` for `editTextBlock`, `operators` for
   * `editTextOperators`, where the page shows text in a Type 3 font.
   */
  readonly rewrite: PageRewrite;
}

/** One of a page's objects, as the editing engine describes it. */
export interface DocumentPageObject {
  readonly index: number;
  readonly kind: 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
  readonly fill: {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
  } | null;
}

/**
 * Every object on a page, in the EDITING engine's numbering.
 *
 * {@link DocumentTextBlocksReader}'s shape on the other read, and it groups
 * nothing: an object is what the engine answered.
 */
export type DocumentPageObjectsReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
) => Promise<{ readonly objects: readonly DocumentPageObject[]; readonly truncated: boolean }>;

/** The objects, stamped with the version the lane read them at. */
export interface DocumentPageObjects {
  readonly version: DocVersion;
  readonly objects: readonly DocumentPageObject[];
  readonly truncated: boolean;
}

/**
 * The fonts the editor draws a block's runs in, rebuilt by the PDFium host from the runs' own programs, each once, with
 * each run's place among them or `null` for none (ADR-0175). The third sanctioned byte crossing; the document's own
 * program never leaves the host.
 *
 * `Uint8Array<ArrayBuffer>`, {@link DocumentPageRasteriser}'s `png` reason: structured clone sends a view's WHOLE
 * buffer, so a view onto a shared one would hand the renderer whatever else shares it — here the block's other fonts,
 * which arrive cut from one file. The composition copies each into a buffer of its own, so the narrower type is true
 * rather than asserted.
 */
export type DocumentRunFontsReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  indices: readonly number[],
) => Promise<{ readonly fonts: readonly Uint8Array<ArrayBuffer>[]; readonly runs: readonly (number | null)[] }>;

/**
 * What the editable PowerPoint export reads of a page, in the editing engine (ADR-0210): the page's own content, and the
 * page rendered at a stated pixel size with its text or without it. Both are read from the document's CURRENT bytes, as
 * every other PDFium read is, so the words a scan was just recognised into are the words the slide gets.
 */
export interface DocumentPresentationReader {
  readonly content: (docId: DocId, sessions: DocumentSessions, page: number) => Promise<PageContent>;
  readonly render: (
    docId: DocId,
    sessions: DocumentSessions,
    page: number,
    width: number,
    height: number,
    withoutText: boolean,
  ) => Promise<Raster>;
}

/**
 * One page rasterised by the EDITING engine, as PNG bytes.
 *
 * §6.1's setting, amended 2026-09-10: a second opinion about how a page looks
 * rather than a better one. The size is the caller's — the renderer knows its
 * canvas's device size and nothing else does — which is ADR-0031's sanctioned
 * crossing rather than a snapshot.
 */
export type DocumentPageRasteriser = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  width: number,
  height: number,
) => Promise<{
  readonly width: number;
  readonly height: number;
  /**
   * `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`, and it
   * is `RangeOutcome`'s type for `RangeOutcome`'s reason: a
   * `SharedArrayBuffer`-backed view is exactly the thing that would hand the
   * renderer a window onto memory main still owns. The encoder answers a fresh
   * buffer, so the narrower type is true rather than asserted.
   */
  readonly png: Uint8Array<ArrayBuffer>;
}>;

/** The raster, stamped with the version the lane rendered it at. */
export interface DocumentPageRaster {
  readonly version: DocVersion;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array<ArrayBuffer>;
}

/** Reads the document's layers. Injected for {@link DocumentPageText}'s reason. */
export type DocumentLayersReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<ListedLayers>;

/** The layers, stamped with the version the lane read them at, and whether the walk stopped at its bound. */
export interface DocumentLayers {
  readonly version: DocVersion;
  readonly layers: readonly Layer[];
  readonly truncated: boolean;
}

/**
 * Lists every annotation, and says whether the bound stopped the walk.
 *
 * `DocumentDuplicatesReader`'s shape and its reason — the flag rides with the
 * list because it is computed where the document was walked.
 *
 * **The first reader added since this became an options object**, and the one
 * CCCCCC-3's trigger was written for: its answer is a list of objects carrying
 * a page, which is close enough to `PageLink` that a positional list would have
 * been a transposition nothing caught.
 */
export type DocumentAnnotationsReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<{ readonly annotations: readonly ListedAnnotation[]; readonly truncated: boolean }>;

/**
 * Serialises one page's named marks for the clipboard, in the engine host — `copyAnnotationData`.
 * Throws `RangeError` for an index the walk does not have, local or remote alike.
 */
export type DocumentAnnotationCopyReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  indices: readonly number[],
) => Promise<{ readonly json: string; readonly copyable: readonly boolean[] }>;

/** One mark's whole words, read in the host. Throws `RangeError` for a handle past the walk. */
export type DocumentAnnotationWordsReader = (
  docId: DocId,
  sessions: DocumentSessions,
  page: number,
  index: number,
) => Promise<{ readonly text: string; readonly whole: boolean }>;

/** What {@link DocumentCommands.annotationWords} answers. */
export type AnnotationWordsOutcome =
  | { readonly kind: 'words'; readonly text: string; readonly whole: boolean }
  | { readonly kind: 'stale' };

/** What {@link DocumentCommands.copyAnnotations} answers. */
export type CopyAnnotationsOutcome =
  /** The clipboard now holds `copied` marks; `skipped` were of kinds this build does not exchange. */
  | { readonly kind: 'copied'; readonly copied: number; readonly skipped: number }
  /** Every mark asked about is of a kind this build does not exchange. The clipboard is unchanged. */
  | { readonly kind: 'nothing-copyable' }
  /** The document moved since the selection was read, so the handles name other marks. */
  | { readonly kind: 'stale' };

/** What {@link DocumentCommands.pasteAnnotations} answers. */
export type PasteAnnotationsOutcome =
  | ({ readonly kind: 'pasted' } & Applied)
  /** Nothing has been copied in this run of the application. */
  | { readonly kind: 'empty' }
  /** The importer refused — the page is gone, most likely. Nothing was added. */
  | { readonly kind: 'refused' };

/** The annotations, stamped with the version the lane read them at. */
export interface DocumentAnnotations {
  readonly version: DocVersion;
  readonly annotations: readonly ListedAnnotation[];
  readonly truncated: boolean;
}

/**
 * Lists every AcroForm field, and says whether the bound stopped the walk.
 *
 * {@link DocumentAnnotationsReader}'s shape for its reason — and this is the
 * first reader added since that one whose answer really does share a shape with
 * a neighbour, which is what the named-keys move was for: `{ page, index, rect }`
 * describes an entry in either walk, and a positional list would have made the
 * transposition compile.
 */
export type DocumentFormFieldsReader = (
  docId: DocId,
  sessions: DocumentSessions,
) => Promise<{ readonly fields: readonly ListedField[]; readonly truncated: boolean }>;

/** The form fields, stamped with the version the lane read them at. */
export interface DocumentFormFields {
  readonly version: DocVersion;
  readonly fields: readonly ListedField[];
  readonly truncated: boolean;
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

/** One page's counts, stamped with the version the lane read them at. */
export interface PageWordCountResult extends WordCount {
  readonly version: DocVersion;
}

/** One page's tagged structure, bounded, stamped with the version the lane read it at. */
export interface PageStructureResult extends StructureOutline {
  readonly version: DocVersion;
}

/** One page's selectable text, stamped with the version the lane read it at. */
export interface PageTextLayerResult {
  readonly version: DocVersion;
  readonly lines: readonly TextLayerLine[];
  /**
   * Whether either bound left something out.
   *
   * Carried rather than derived, for `PageSearchResult.truncated`'s reason —
   * and covering both bounds, because a clipped line is invisible in a length.
   */
  readonly truncated: boolean;
  /** What the page is made of, so an empty layer can say why. See `pageKindOf`. */
  readonly kind: PageKind;
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
  /** The characters it drew as boxes, each with its page, capped for the boundary (ADR-0174). */
  readonly boxed: BoxedInEditEntry[];
  /** How many boxes past the named ones. */
  readonly more: number;
  /**
   * The older copies a protect could not encrypt, by name (ADR-0178), empty for every other command and for a protect
   * that sealed every copy. A protect that applied is not failed by a copy another program holds; the person is told.
   */
  readonly unsealedCopies: readonly string[];
}

/**
 * Everything `DocumentCommands` is built from — CCCCCC-3's options object,
 * taken 2026-09-06.
 *
 * ## What it replaces, and why the count was the finding
 *
 * Fifteen positional parameters, appended one at a time, with a comment at each
 * of the last five saying the options object was owed and that the next
 * addition would make the case stronger. Five of them are READERS with the same
 * signature — `(docId, sessions) => Promise<readonly T[]>` — and CCCCCC-3 named
 * the trigger exactly: *the day two of these answer the same shape*, a
 * transposition compiles and a panel shows the wrong list. The trigger had not
 * fired, because `Layer`, `Destination`, `PageLink`, `PageGeometry` and
 * `{ groups, truncated }` are still mutually incompatible.
 *
 * It was going to. The sixteenth dependency is an annotations reader, whose
 * answer is a list of objects carrying a page and a rectangle — which is
 * `PageLink`'s shape closely enough that nobody should be relying on the
 * difference. So the move happens **before** the reader rather than after,
 * which is what B4 means one layer down from architecture: the seam changes
 * first, in its own commit.
 *
 * ## Named keys make the mis-slot unrepresentable rather than unlikely
 *
 * A positional list is safe exactly as long as no two entries share a type, and
 * that is a property of the current set rather than of the design. With names,
 * two readers answering the same shape is no longer a hazard at all — the
 * compiler pairs each with the key it was written for, and a missing one is an
 * error naming the thing that is missing.
 *
 * `ShellComposition` made this move one layer out and is the precedent; the
 * three bundles below — `SaveSource`, `CopySource`, `ImageSource` — are the
 * same idea applied to pairs of dependencies that belong together, and they
 * stay as they are.
 */
export interface DocumentCommandsParts {
  readonly documents: DocumentService;
  readonly bus: CommandBus;
  readonly engine: EngineSessionSource;
  readonly save: SaveSource;
  readonly geometry: DocumentGeometry;
  readonly pageText: DocumentPageText;
  /** The `structure` read of one page — `pageStructure`'s (ADR-0065). */
  readonly pageStructure: DocumentPageStructure;
  /** The `table` read of one page — `exportExcel`'s (ADR-0073). */
  readonly pageTables: DocumentPageTables;
  /** One page's tables read by a service — `exportExcel`'s network engines (ADR-0086). */
  readonly networkTables: NetworkTableReader;
  /** One page as a picture for a vision ask (ADR-0090). */
  readonly askPicture: AskPictureReader;
  readonly pageLinks: DocumentPageLinksReader;
  /** One page's word boxes, for Side by Side's marks (ADR-0137). */
  readonly wordBoxes: DocumentWordBoxesReader;
  readonly destinations: DocumentDestinationsReader;
  /** How a page becomes characters — `ocrPage`'s pre-read (ADR-0051). */
  readonly ocr: DocumentOcrReader;
  /** Which objects a page's runs are, through the PDFium host — `editTextOperators`' pre-read (ADR-0176). */
  readonly pageRuns: DocumentPageRunsReader;
  readonly layers: DocumentLayersReader;
  /**
   * Reads and verifies the document's signatures, in the contained host.
   *
   * Takes a session and not a `DocId`, unlike `layers`: the host serialises its
   * own session for the bytes a `/ByteRange` indexes into, so nothing on this
   * side has to hold or send them.
   */
  readonly signatures: (session: MupdfSession) => Promise<readonly ReadSignature[]>;
  /** How many signatures, and whether the next save keeps them — the writer's own decision. See {@link save}. */
  readonly signaturesKept: (session: MupdfSession) => Promise<NextSave>;
  readonly restore: DocumentRestore;
  /** How a removal's save opens the document's sessions again from the file it wrote (ADR-0164). */
  readonly renew: DocumentRenew;
  /** The Recent card's picture of a document, which a removal's save takes again (ADR-0164). */
  readonly recentPicture: Pick<RecentPictures, 'retake'>;
  /**
   * THE SIXTEENTH DEPENDENCY, and the first added since this became an options
   * object — which is what the move was for: a named key, in one place, with
   * nothing else moving.
   */
  readonly annotations: DocumentAnnotationsReader;
  /** Named marks serialised for the clipboard, in the engine host. */
  readonly annotationCopy: DocumentAnnotationCopyReader;
  readonly annotationWords: DocumentAnnotationWordsReader;
  /** One link's whole address, for a person following it (ADR-0167). */
  readonly linkAddress: DocumentLinkAddressReader;
  readonly formFields: DocumentFormFieldsReader;
  readonly flatFields: DocumentFlatFieldsReader;
  /** The named fields' properties, read in the engine host (ADR-0193). */
  readonly fieldProperties: DocumentFieldPropertiesReader;
  /** What importing a data file would do to the form, planned in the engine host. */
  readonly formImportPlan: DocumentFormImportPlanner;
  /** One page's barcodes, read in the engine host (ADR-0076). */
  readonly barcodes: DocumentBarcodesReader;
  /** How a protect replaces the document's plaintext copies with encrypted ones (ADR-0171 Decision 8). */
  readonly copies: ProtectedCopies;
  /** The accessibility check, read in the engine host (ADR-0078). */
  readonly accessibility: DocumentAccessibilityReader;
  /** Writes a barcode for placement. See {@link BarcodeWriter}. */
  readonly writeBarcode: BarcodeWriter;
  /**
   * The editing engine's reading of a page's text, or a thrower.
   *
   * Required and undefaulted like every other reader here: an installation with
   * no PDFium supplies one that raises {@link EngineUnavailableError}, which is
   * a decided answer, and a default of `undefined` would make *this build cannot
   * edit text* a state a caller reaches by saying nothing.
   */
  readonly textBlocks: DocumentTextBlocksReader;
  /** The editing engine's reading of a page's objects, or a thrower. */
  readonly pageObjects: DocumentPageObjectsReader;
  /** The editing engine's raster of a page, or a thrower. */
  readonly renderPage: DocumentPageRasteriser;
  /** A block's run fonts rebuilt by the editing engine's host, each once (ADR-0175). */
  readonly runFonts: DocumentRunFontsReader;
  /** The editable PowerPoint export's reads of a page, or a thrower (ADR-0210). */
  readonly presentation: DocumentPresentationReader;
  readonly duplicates: DocumentDuplicatesReader;
  /** A picker and a contested-destination check, bundled — see {@link CopySource}. */
  readonly copy: CopySource;
  /**
   * Where the versions a save replaces are kept (ADR-0198): Monstera's own data folder. Absent where a harness has none,
   * and then no version is listed and none can be restored — a state, never a fallback to writing beside the file.
   */
  readonly backups?: BackupStore | undefined;
  readonly image: ImageSource;
  /**
   * The person's library, read when a kept picture is placed or a kept signature signs, and written when a placed
   * signature is kept. See {@link LibraryReader} and {@link LibraryKeeper}.
   */
  readonly library: LibraryReader & LibraryKeeper;
  /** The picture the plain Signature's dialog previewed, placed from here and released once it is (ADR-0133). */
  readonly heldPicture: HeldPicture;
  /** Where a signature picture is picked from at the click: a PNG, a JPEG or a scanned PDF. See {@link SignaturePictureSource}. */
  readonly signaturePicture: SignaturePictureSource;
  /** Each import format's picker and bounded read. See {@link ImportSource}. */
  readonly imports: Readonly<Record<ImportFormat, ImportSource>>;
  /**
   * The compose host, or `null` where none can exist. Required and undefaulted for
   * `textBlocks`' reason: *this build cannot import* is a decided answer, not a state a
   * caller reaches by saying nothing.
   */
  readonly compose: ComposeImport;
  /** The image import's picker, sizes and bounded read. See {@link ImageFilesSource}. */
  readonly imageFiles: ImageFilesSource;
  /** The compose host's image composition, or `null` where none can exist — `compose`'s reason. */
  readonly composeImages: ComposeImages;
  /** How a document is fetched from a URL a person gave. See {@link FetchUrl}. */
  readonly fetchUrl: FetchUrl;
  /** Where a signing certificate comes from. See {@link CertificateSource}. */
  readonly certificate: CertificateSource;
  /**
   * DocuSign, as `main` holds it — the sign-in, its tokens and the envelopes this
   * session sent ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
   * The document's bytes reach it through the save's own flush, never a second read.
   */
  readonly docusign: DocusignSession;
  readonly extract: DocumentExtractReader;
  readonly snapshot: SnapshotSource;
  readonly formData: FormDataSource;
  /** Where annotations are exchanged with. See {@link AnnotationDataSource}. */
  readonly annotationData: AnnotationDataSource;
  /** How a page becomes an image file's bytes. See {@link DocumentPageImageReader}. */
  readonly pageImage: DocumentPageImageReader;
  /** How the document becomes a Word file. See {@link DocumentWordExport}. */
  readonly word: DocumentWordExport;
  /**
   * Where a text export goes: the save dialog narrowed to plain text, given the
   * document's name so the suggested one and the filter share an extension.
   */
  readonly pickText: (sourceName: string) => Promise<string | null>;
  /** Where a contact card read from a barcode goes: the save dialog narrowed to `.vcf`, given the document's name. */
  readonly pickContact: (sourceName: string) => Promise<string | null>;
  /**
   * Layout-preserving text: the document's current bytes in, text chunks out,
   * from the contained `pdftotext` (ADR-0071) — or `null` where none can run, and
   * the layout export then answers `unavailable` before any dialog.
   */
  readonly layoutText: LayoutTextSource | null;
  /**
   * The PDF/A-2b conversion, from the contained Ghostscript (ADR-0075) — or `null` where
   * none can run, and the export then answers `unavailable` before any dialog.
   */
  readonly pdfa: PdfaSource | null;
  /**
   * Office import through the contained `x2t` (ADR-0120) — or `null` where none can run, and the
   * import is refused as unavailable before any dialog. Required for `compose`'s reason.
   */
  readonly officeImport: OfficeImport | null;
  /**
   * MuPDF's image rewriter in the compose host (ADR-0087) — or `null` where there is no compose
   * host at all, and Optimize then answers `unavailable` before any work. A host without the
   * native library answers `unavailable` itself.
   */
  readonly optimizer: OptimizeSource | null;
  /**
   * The system print dialog and the printer it answers (ADR-0074) — or `null` where
   * there is none, and a print then answers `unavailable` before any dialog.
   */
  readonly print: PrintDestination | null;
  /**
   * The Windows Share sheet (ADR-0080) — or `null` where there is none, and emailing
   * then answers `unavailable` before any bytes are taken.
   */
  readonly share: ShareDestination | null;
  /** Where an Office export goes. See {@link PickOffice}. */
  readonly pickOffice: PickOffice;
  readonly directory: PickDirectory;
  /** A page edited in another application. See {@link ExternalEditSource}. */
  readonly externalEdit: ExternalEditSource;
}

/** What saving a barcode's contact card produced: a copy's outcomes, and the three ways there was nothing to save. */
export type SaveContactOutcome =
  | CopyOutcome
  | { readonly kind: 'stale' }
  | { readonly kind: 'no-such-barcode' }
  | { readonly kind: 'not-a-contact' };

/** One chunk as the async source a streamed write takes. */
async function* oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}

/**
 * What a text export produced: a copy's outcomes, plus the two only the layout
 * mode has — no converter on this machine, and a converter that ran and wrote
 * nothing usable.
 */
export type ExportTextOutcome =
  | CopyOutcome
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly detail: string };

/**
 * How an optimized copy is made (ADR-0087): the document's bytes and one setting in, the copy's
 * size and a stream of it out — or MuPDF's refusal to open the document.
 *
 * The copy lives in the compose host's area until it is streamed or discarded; the caller does one
 * or the other, and the stream removes the file once read, so no copy outlives the call that made
 * it. Composed where the host is, which is `composition.ts`.
 */
export type OptimizeSource = (
  pdf: Uint8Array,
  setting: OptimizeSetting,
  // THE KEY `pdf` OPENS WITH, required so no caller leaves it out: without it the rewriter read an encrypted document
  // undecrypted and wrote a copy with no page (ADR-0171's addendum, measured 2026-10-05).
  opensWith: HeldPassword | undefined,
) => Promise<
  | {
      readonly kind: 'optimized';
      readonly bytes: number;
      readonly output: AsyncIterable<Uint8Array>;
      readonly discard: () => Promise<void>;
    }
  | { readonly kind: 'unreadable' }
  // THE HOST'S OWN ANSWER when it was started without the native library. Passed on rather than
  // decided here: the host's command line is the one reading of whether the library was
  // provisioned, and a second reading in `main` could disagree with it.
  | { readonly kind: 'unavailable' }
>;

/** What measuring an optimized copy answered. */
export type OptimizeMeasurement =
  | { readonly kind: 'measured'; readonly version: DocVersion; readonly before: number; readonly after: number }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unavailable' };

/**
 * What writing a PowerPoint deck did: a copy's outcomes, and on success the one-based pages written as Exact look because
 * they could not be written editable (ADR-0210). Empty for Exact look, which is what every page falls back to.
 */
export type PowerPointOutcome =
  | (Extract<CopyOutcome, { readonly kind: 'copied' }> & { readonly fellBack: readonly number[] })
  | Exclude<CopyOutcome, { readonly kind: 'copied' }>;

/** What writing an optimized copy did. */
export type OptimizeOutcome =
  | { readonly kind: 'copied'; readonly bytes: number; readonly before: number; readonly destination: string }
  | Exclude<CopyOutcome, { readonly kind: 'copied' }>
  | { readonly kind: 'not-smaller'; readonly before: number; readonly after: number }
  | { readonly kind: 'changed' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unavailable' };

/**
 * What a write of many files did — a split, the pages as images: the kernel's `SplitOutcome`, its success naming the
 * FOLDER the person chose, main's only as `CopyOutcome`'s destination is. The folder and not a file in it, because a
 * person asked for a folder and looks for the files there.
 */
export type FolderOutcome =
  | (Extract<SplitOutcome, { readonly kind: 'split' }> & { readonly destination: string })
  | Exclude<SplitOutcome, { readonly kind: 'split' }>;

/** The kernel's split answer with its folder, for {@link FolderOutcome}. */
function inFolder(outcome: SplitOutcome, directory: string): FolderOutcome {
  return outcome.kind === 'split' ? { ...outcome, destination: directory } : outcome;
}

/** What a PDF/A-2b export did: a copy's outcomes, with what the conversion removed; or no converter; or no PDF/A. */
export type ExportPdfaOutcome =
  | {
      readonly kind: 'copied';
      readonly bytes: number;
      readonly removed: readonly string[];
      /** The document was tagged, and the PDF/A file carries no structure tree. */
      readonly tagsDropped: boolean;
      /** Where the copy went: main's only, as `CopyOutcome`'s is. */
      readonly destination: string;
    }
  | Exclude<CopyOutcome, { readonly kind: 'copied' }>
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export class DocumentCommands {
  readonly #documents: DocumentService;
  readonly #bus: CommandBus;
  readonly #engine: EngineSessionSource;
  readonly #save: SaveSource;
  readonly #geometry: DocumentGeometry;
  readonly #pageText: DocumentPageText;
  readonly #pageStructure: DocumentPageStructure;
  readonly #pageTables: DocumentPageTables;
  readonly #networkTables: NetworkTableReader;
  readonly #askPicture: AskPictureReader;
  readonly #pageLinks: DocumentPageLinksReader;
  readonly #wordBoxes: DocumentWordBoxesReader;
  readonly #destinations: DocumentDestinationsReader;
  readonly #ocr: DocumentOcrReader;
  readonly #pageRuns: DocumentPageRunsReader;
  readonly #layers: DocumentLayersReader;
  readonly #signatures: (session: MupdfSession) => Promise<readonly ReadSignature[]>;
  readonly #signaturesKept: (session: MupdfSession) => Promise<NextSave>;
  readonly #restore: DocumentRestore;
  readonly #renew: DocumentRenew;
  readonly #recentPicture: Pick<RecentPictures, 'retake'>;
  readonly #annotations: DocumentAnnotationsReader;
  readonly #annotationCopy: DocumentAnnotationCopyReader;
  readonly #annotationWords: DocumentAnnotationWordsReader;
  readonly #linkAddress: DocumentLinkAddressReader;
  /**
   * The annotation clipboard: interchange JSON, held here and never sent to the renderer.
   *
   * Here because a paste is an `importAnnotations`, which carries bytes and is withheld from the
   * renderer (B5), so main is the only process that may mint one. Application-wide rather than per
   * document, which is what makes copying from one document and pasting into another work — the
   * text names no document, only pages and entries. Empty until the first copy of this run; a
   * clipboard that survived a restart would paste marks from a session nobody remembers.
   *
   * `from` is kept because the records cannot say it: a paste is nudged only back onto the page it
   * came from IN THE DOCUMENT it came from, and a record names a page, never a document.
   */
  #clipboard: { readonly json: string; readonly from: { readonly docId: DocId; readonly page: number } } | null =
    null;
  readonly #formFields: DocumentFormFieldsReader;
  readonly #flatFields: DocumentFlatFieldsReader;
  readonly #fieldProperties: DocumentFieldPropertiesReader;
  readonly #formImportPlan: DocumentFormImportPlanner;
  readonly #barcodes: DocumentBarcodesReader;
  readonly #copies: ProtectedCopies;
  readonly #accessibility: DocumentAccessibilityReader;
  readonly #writeBarcode: BarcodeWriter;
  readonly #textBlocks: DocumentTextBlocksReader;
  readonly #pageObjects: DocumentPageObjectsReader;
  readonly #renderPage: DocumentPageRasteriser;
  readonly #runFonts: DocumentRunFontsReader;
  readonly #presentation: DocumentPresentationReader;
  readonly #duplicates: DocumentDuplicatesReader;
  readonly #copy: CopySource;
  readonly #backups: BackupStore | undefined;
  readonly #image: ImageSource;
  readonly #library: LibraryReader & LibraryKeeper;
  readonly #heldPicture: HeldPicture;
  readonly #signaturePicture: SignaturePictureSource;
  readonly #imports: Readonly<Record<ImportFormat, ImportSource>>;
  readonly #compose: ComposeImport;
  readonly #imageFiles: ImageFilesSource;
  readonly #composeImages: ComposeImages;
  readonly #fetchUrl: FetchUrl;
  readonly #certificate: CertificateSource;
  readonly #docusign: DocusignSession;
  readonly #extract: DocumentExtractReader;
  readonly #snapshot: SnapshotSource;
  readonly #formData: FormDataSource;
  readonly #annotationData: AnnotationDataSource;
  readonly #pageImage: DocumentPageImageReader;
  readonly #word: DocumentWordExport;
  readonly #pickText: (sourceName: string) => Promise<string | null>;
  readonly #pickContact: (sourceName: string) => Promise<string | null>;
  /**
   * The service-read exports in flight, by document (ADR-0202 Decision 5): pages read of pages asked, and whether the person
   * asked it to stop. Counts and a flag — never text — and one entry per document at most, since the export holds the lane.
   */
  readonly #reading = new Map<DocId, { done: number; total: number; stop: boolean }>();
  readonly #layoutText: LayoutTextSource | null;
  readonly #pdfa: PdfaSource | null;
  readonly #officeImport: OfficeImport | null;
  readonly #optimizer: OptimizeSource | null;
  readonly #print: PrintDestination | null;
  readonly #share: ShareDestination | null;
  readonly #pickOffice: PickOffice;
  readonly #directory: PickDirectory;
  readonly #externalEdit: ExternalEditSource;
  /**
   * The page out for editing, per document — one each (ADR-0062 Decision 3). Its version is
   * the one the index was read at, which the reimport's `replacePage` carries.
   */
  readonly #outs = new Map<
    DocId,
    {
      readonly path: string;
      readonly page: number;
      readonly version: DocVersion;
      readonly watch: EditWatch;
    }
  >();

  constructor(parts: DocumentCommandsParts) {
    this.#documents = parts.documents;
    this.#bus = parts.bus;
    this.#engine = parts.engine;
    this.#save = parts.save;
    this.#geometry = parts.geometry;
    this.#pageText = parts.pageText;
    this.#pageStructure = parts.pageStructure;
    this.#pageTables = parts.pageTables;
    this.#networkTables = parts.networkTables;
    this.#askPicture = parts.askPicture;
    this.#pageLinks = parts.pageLinks;
    this.#wordBoxes = parts.wordBoxes;
    this.#destinations = parts.destinations;
    this.#ocr = parts.ocr;
    this.#pageRuns = parts.pageRuns;
    this.#layers = parts.layers;
    this.#signatures = parts.signatures;
    this.#signaturesKept = parts.signaturesKept;
    this.#restore = parts.restore;
    this.#renew = parts.renew;
    this.#recentPicture = parts.recentPicture;
    this.#annotations = parts.annotations;
    this.#annotationCopy = parts.annotationCopy;
    this.#annotationWords = parts.annotationWords;
    this.#linkAddress = parts.linkAddress;
    this.#formFields = parts.formFields;
    this.#flatFields = parts.flatFields;
    this.#fieldProperties = parts.fieldProperties;
    this.#formImportPlan = parts.formImportPlan;
    this.#barcodes = parts.barcodes;
    this.#copies = parts.copies;
    this.#accessibility = parts.accessibility;
    this.#writeBarcode = parts.writeBarcode;
    this.#textBlocks = parts.textBlocks;
    this.#pageObjects = parts.pageObjects;
    this.#renderPage = parts.renderPage;
    this.#runFonts = parts.runFonts;
    this.#presentation = parts.presentation;
    this.#duplicates = parts.duplicates;
    this.#copy = parts.copy;
    this.#backups = parts.backups;
    this.#image = parts.image;
    this.#library = parts.library;
    this.#heldPicture = parts.heldPicture;
    this.#signaturePicture = parts.signaturePicture;
    this.#imports = parts.imports;
    this.#compose = parts.compose;
    this.#imageFiles = parts.imageFiles;
    this.#composeImages = parts.composeImages;
    this.#fetchUrl = parts.fetchUrl;
    this.#certificate = parts.certificate;
    this.#docusign = parts.docusign;
    this.#extract = parts.extract;
    this.#snapshot = parts.snapshot;
    this.#formData = parts.formData;
    this.#annotationData = parts.annotationData;
    this.#pageImage = parts.pageImage;
    this.#word = parts.word;
    this.#pickText = parts.pickText;
    this.#pickContact = parts.pickContact;
    this.#layoutText = parts.layoutText;
    this.#pdfa = parts.pdfa;
    this.#officeImport = parts.officeImport;
    this.#optimizer = parts.optimizer;
    this.#print = parts.print;
    this.#share = parts.share;
    this.#pickOffice = parts.pickOffice;
    this.#directory = parts.directory;
    this.#externalEdit = parts.externalEdit;
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
   * One page's text as a selectable layer.
   *
   * ## In the LANE, and reading the same value the search reads
   *
   * `#pageText` is the call `searchPage` makes, so a layer and a search taken at
   * the same version describe the same page — which is the whole point of taking
   * the text from the substrate rather than from PDF.js. Two readers of one
   * value, not two extractions.
   *
   * The version comes back with the answer for `searchPage`'s reason: a renderer
   * must be able to discard a layer that describes a document it is no longer
   * showing, and a text layer left over a mutated page is a selection that
   * copies text the document no longer has.
   *
   * ## The bounds are the channel's, passed through
   *
   * `limit` is the caller's, capped by the schema. The per-line cap is this
   * layer's own and is not a parameter: it is a property of what may cross,
   * which the renderer has no business choosing per call.
   *
   * @param page the zero-based index, as every page index crossing the contract is
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async pageTextLayer(
    docId: DocId,
    page: number,
    limit: number,
  ): Promise<PageTextLayerResult> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const text = await this.#pageText(docId, sessions, page);
      return textLayerOf(text, limit, MAX_TEXT_LAYER_LINE);
    });

    return { version, ...value };
  }

  /**
   * One page's word and character counts.
   *
   * ## In the LANE, and the text is dropped inside it
   *
   * `#pageText` is the same read `searchPage` and `pageTextLayer` make. What
   * differs is what leaves: three numbers rather than the text, so nothing here
   * holds a page's text beyond the call and nothing accumulates across pages —
   * which is what lets a caller count a document ADR-0035 says must never be
   * resident in main.
   *
   * @param page the zero-based index, as every page index crossing the contract is
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async pageWordCount(docId: DocId, page: number): Promise<PageWordCountResult> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return countPageWords(await this.#pageText(docId, sessions, page));
    });

    return { version, ...value };
  }

  /**
   * The window of text an assistant ask carries about this document (ADR-0088).
   *
   * ## In the LANE, page by page, through the read search takes
   *
   * `#pageText` is the call `searchPage` and `pageTextLayer` make, so the words a person asks
   * about are the words they can search and select. Each page's text is appended to a window of
   * a constant size and dropped — ADR-0035's *"bounded window, not a resident document"* — and
   * `readAskWindow` stops reading once the window is full, so a long document costs the pages
   * that fit rather than all of them.
   *
   * A selection reads nothing: its text came from the text layer this class already answered,
   * and the page count is the one fact it needs from the document.
   *
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async askWindow(
    // A PICTURE IS NOT A WINDOW: `askPicture` answers that scope, so this one cannot be handed it. NOR IS EVERY OPEN
    // DOCUMENT: the handler reads each of those as its own `document` window (ADR-0134), so this reads one document.
    about: Exclude<AskAbout, { readonly scope: 'page-image' | 'documents' }>,
    /** One of several: its share of the bound, and its side or place where it has one (a lone window beside files has none). */
    pair?: { readonly label?: AskLabel; readonly bound: number },
  ): Promise<AskWindow> {
    const { docId } = about;
    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const { pageCount } = await this.#geometry(docId, sessions, []);
      if (about.scope === 'selection' || about.scope === 'comment') {
        return carriedWindow(about.page, about.text, pageCount);
      }
      // THE COMMENTS PANEL'S OWN LIST, read in the same lane: what the provider summarises is the
      // list a person can see, bounded by the list's bound and then by the window's.
      if (about.scope === 'comments') {
        const { annotations, truncated } = await this.#annotations(docId, sessions);
        return await commentsWindow(
          annotations.map((entry) => ({
            page: entry.page,
            kind: entry.kind,
            contents: entry.contents,
            reply: entry.inReplyTo !== null,
          })),
          pageCount,
          truncated,
          pair?.bound ?? MAX_ASK_CONTEXT,
        );
      }
      // A PAGE PAST THE END READS NOTHING rather than asking the engine for a page it does not
      // have: the document may have lost pages between the menu and the ask.
      const pages =
        about.scope === 'page'
          ? about.page < pageCount
            ? [about.page]
            : []
          : Array.from({ length: pageCount }, (_unused, page) => page);
      return await readAskWindow(
        pages,
        pageCount,
        async (page) => plainTextOf(await this.#pageText(docId, sessions, page)),
        // ONE OF SEVERAL reads its share of the bound and names its side or its place in every marker (ADR-0089,
        // ADR-0134); alone, the whole bound and the plain marker.
        pair?.bound ?? MAX_ASK_CONTEXT,
        pair?.label,
      );
    });
    return value;
  }

  /**
   * A picture of one page for a vision ask, and what it covers (ADR-0090).
   *
   * In the LANE, for `renderPage`'s reason: a picture drawn while an `apply` runs would show a
   * page that is neither the one before the command nor the one after it. A page past the end
   * draws NOTHING and answers `png: null` with nothing sent, as `askWindow` reads nothing for one —
   * the document may have lost pages between the menu and the ask.
   *
   * @throws the set `askWindow` throws, and {@link PageTooLargeToPicture}
   */
  async askPicture(about: { readonly docId: DocId; readonly page: number }): Promise<{
    readonly png: Uint8Array | null;
    readonly sent: AskSent;
  }> {
    const { docId, page } = about;
    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const { pageCount } = await this.#geometry(docId, sessions, []);
      if (page >= pageCount) {
        return {
          png: null,
          sent: { firstPage: null, lastPage: null, pageCount, characters: 0, truncated: false },
        };
      }
      return { png: await this.#askPicture(docId, sessions, page), sent: pictureSent(page, pageCount) };
    });
    return value;
  }

  /**
   * Page 1 as a small JPEG, for the recent list's card
   * ([ADR-0100](../../../docs/DECISIONS/0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md)).
   *
   * At `MIN_SNAPSHOT_SCALE`, one pixel per point — the smallest the host draws, and already larger than the
   * card — so nothing bigger than the card needs is made. In the LANE, for `askPicture`'s reason.
   *
   * @throws the set `askPicture` throws when the document has no usable session
   */
  async firstPagePicture(docId: DocId): Promise<Uint8Array | 'none'> {
    const { value } = await this.#documents.run(docId, async (): Promise<Uint8Array | 'none'> => {
      // A FILE THAT OPENS ONLY WITH A PASSWORD KEEPS NO PICTURE of its page, which would be a copy anyone can open of
      // what the password protects (the owner, CR-DOC-11). Asked before the session, since a locked document has none.
      if (this.#engine.opensOnlyWithPassword(docId)) return 'none';
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#pageImage(docId, sessions, {
        page: 0,
        format: 'jpeg',
        scale: MIN_SNAPSHOT_SCALE,
        quality: RECENT_PREVIEW_QUALITY,
      });
    });
    return value;
  }

  /**
   * One page's tagged structure, bounded.
   *
   * ## In the LANE, through the host's second named read of the same page
   *
   * `#pageStructure` asks the host for the `structure` read — the shared option set
   * plus `structured` — where `#pageText` asks for the shared one
   * ([ADR-0065](../../../docs/DECISIONS/0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md)).
   * Same channel, same walk; what leaves the lane is a role, a name, a depth and a
   * count per element, and the page's words are dropped inside it.
   *
   * The version comes back with the answer for `pageTextLayer`'s reason: an
   * outline of a page the document no longer has is one a renderer must discard.
   *
   * @param page the zero-based index, as every page index crossing the contract is
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async pageStructure(docId: DocId, page: number): Promise<PageStructureResult> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return structureOutlineOf(
        await this.#pageStructure(docId, sessions, page),
        MAX_STRUCTURE_NODES,
        MAX_STRUCTURE_NAME,
      );
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

    return { version, links: value.links, truncated: value.truncated };
  }

  /**
   * One page's word boxes (ADR-0137), in the lane and stamped with the version for {@link pageLinks}' reason: Side by
   * Side pairs them with a text layer read at a version, and boxes of another version would mark the wrong words.
   *
   * @throws the same set `viewModel` throws, for the same reasons.
   */
  async pageWordBoxes(docId: DocId, page: number): Promise<{ readonly version: DocVersion } & PageWordBoxes> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#wordBoxes(docId, sessions, page);
    });

    return { version, ...value };
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

    return { version, destinations: value.destinations, truncated: value.truncated };
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
  /**
   * The document's signatures, verified, inside its lane.
   *
   * `layers`' guards in `layers`' order. The lane matters more here than for
   * most reads: the host serialises its own session to get the bytes a
   * `/ByteRange` indexes into, so a command landing between the walk and the
   * serialise would verify one document's signatures against another's bytes —
   * and answer *this signature no longer covers the document*, which is the
   * one wrong answer a person acts on.
   */
  async signatures(
    docId: DocId,
  ): Promise<{ readonly signatures: readonly ReadSignature[]; readonly unreadable: boolean }> {
    return this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      const session = sessions.mupdf;
      if (session === undefined) throw new MissingSessionError(docId, 'mupdf');

      try {
        return { signatures: await this.#signatures(session), unreadable: false };
      } catch (error) {
        // A SIGNATURE THIS BUILD CANNOT PARSE is an outcome rather than a
        // defect: the document is a stranger's and its PKCS#7 may be anything.
        // Reported as a flag beside an empty list, because *no signatures* and
        // *a signature nobody could read* are different sentences and only one
        // of them is reassuring.
        //
        // THAT ONE REFUSAL AND NO OTHER (GGGGGG-1). This caught everything until
        // 2026-09-13, so a dead host, a lost session or a failed serialise all
        // told a reader *a signature could not be read* — a sentence about the
        // document, answering a fault in the engine. Everything else propagates
        // and is reported as the failure it is.
        if (error instanceof EngineCallFailed && error.code === 'signatures-unreadable') {
          return { signatures: [], unreadable: true };
        }
        throw error;
      }
    }).then(({ value }) => value);
  }

  async layers(docId: DocId): Promise<DocumentLayers> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#layers(docId, sessions);
    });

    return { version, layers: value.layers, truncated: value.truncated };
  }

  /**
   * Lists every annotation, inside the document's lane.
   *
   * `duplicates`' guards in `duplicates`' order, and the lane matters for the
   * same reason: this walks every page's `/Annots`, and a walk interleaved with
   * an `apply` would describe neither the document before the command nor the
   * one after it — which for a panel means a row pointing at a page that has
   * just moved.
   */
  async annotations(docId: DocId): Promise<DocumentAnnotations> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#annotations(docId, sessions);
    });

    return { version, annotations: value.annotations, truncated: value.truncated };
  }

  /**
   * Lists every AcroForm field, inside the document's lane.
   *
   * `annotations`' guards in `annotations`' order, and the lane matters for the
   * same reason: this walks every page's widgets, and a walk interleaved with
   * an `apply` would describe neither the document before the command nor the
   * one after it — which for a form panel means a row pointing at a field whose
   * index has just moved.
   */
  async formFields(docId: DocId): Promise<DocumentFormFields> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#formFields(docId, sessions);
    });

    return { version, fields: value.fields, truncated: value.truncated };
  }

  /**
   * Where one page's fields probably are, on a page that has none.
   *
   * {@link formFields}' body with a page, and in the lane for its reason: the
   * walk reads the document the adapter holds, which a command mutates in
   * place. The version comes back with the answer, which is what lets a
   * proposal be discarded when the page it describes has moved.
   */
  async flatFieldCandidates(docId: DocId, page: number): Promise<DocumentFlatFields> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#flatFields(docId, sessions, page);
    });

    return {
      version,
      candidates: value.candidates,
      truncated: value.truncated,
      alreadyFields: value.alreadyFields,
    };
  }

  /**
   * What the named fields' properties are (ADR-0193).
   *
   * {@link flatFieldCandidates}' body and its lane, for its reason: the walk reads the document the adapter holds, which
   * a command mutates in place. The version comes back with the answer, so a pane built from it can tell when the
   * document has moved on.
   */
  async formFieldProperties(docId: DocId, handles: readonly FormFieldHandle[]): Promise<DocumentFieldProperties> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#fieldProperties(docId, sessions, handles);
    });
    return { version, fields: value };
  }

  /**
   * The barcodes on one page.
   *
   * {@link flatFieldCandidates}' body and its lane: the raster is made from the document the
   * session holds, which a command mutates in place.
   */
  async pageBarcodes(docId: DocId, page: number): Promise<DocumentBarcodes> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#barcodes(docId, sessions, page);
    });

    return { version, barcodes: value.barcodes, truncated: value.truncated };
  }

  /**
   * A contact card read from one barcode, written to a `.vcf` the person picks.
   *
   * ## The renderer names the barcode, and main reads the text from the document
   *
   * `document.openBarcodeLink`'s rule: the version and the place identify the symbol, the text never crosses from the
   * renderer, so what is written is what the document says. A version that has moved is `stale` and nothing is asked or
   * written; a symbol that is not a complete vCard is `not-a-contact`, said before the dialog so a person is not asked to
   * name a file for something that cannot be saved.
   *
   * It touches no document state: no command, no version, no log entry.
   *
   * @throws `DocumentNotOpenError` before any dialog, for `saveCopy`'s reason.
   */
  async saveBarcodeContact(
    docId: DocId,
    version: DocVersion,
    page: number,
    index: number,
  ): Promise<SaveContactOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'save a contact');

    const read = await this.pageBarcodes(docId, page);
    if (read.version !== version) return { kind: 'stale' };
    const text = read.barcodes[index]?.text;
    if (text === undefined) return { kind: 'no-such-barcode' };
    const file = contactCardFileText(text);
    if (file === undefined) return { kind: 'not-a-contact' };

    const destination = await this.#pickContact(suggest);
    if (destination === null) return undefined;
    return writeStreamedDocument(
      this.#save.deps,
      this.#copy.checkTarget,
      () => Promise.resolve(oneChunk(new TextEncoder().encode(file))),
      destination,
    );
  }

  /**
   * The document's accessibility check (ADR-0078), in the lane for {@link pageBarcodes}' reason and
   * stamped with the version it describes.
   */
  async accessibilityCheck(docId: DocId): Promise<{ readonly version: DocVersion } & AccessibilityReportOnWire> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#accessibility(docId, sessions);
    });
    return { version, ...value };
  }

  /**
   * Places a barcode a person typed, in the box they dragged, as a `/Stamp`.
   *
   * {@link placeImage}' command — the barcode IS an image once written, so it is placed by the
   * command that already places images, survives the save, and undoes as one entry
   * (ADR-0076). What differs is where the bytes come from and the box: the writer makes them
   * here from text, which is not a document and so needs no containment, and the box is
   * narrowed to the symbol's proportions by {@link barcodeRect}.
   */
  async placeBarcode(
    docId: DocId,
    pages: PageSet,
    rect: AnnotationRect,
    text: string,
    format: BarcodeFormat,
    stamp: AnnotationStamp,
  ): Promise<PlaceBarcodeOutcome> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'place a barcode');
    }
    const written = await this.#writeBarcode(text, format);
    if (written.kind === 'refused') return written;
    const applied = await this.execute(docId, {
      kind: 'placeImage',
      pages,
      rect: barcodeRect(rect, written.width, written.height),
      bytes: written.png,
      stamp,
    });
    return { kind: 'placed', ...applied };
  }

  /**
   * Which of a page's objects the editing engine calls text objects.
   *
   * {@link flatFieldCandidates}' body against the other engine, and IN THE LANE
   * for a reason that is stronger here than there: this read serialises the
   * document to hand PDFium its bytes, so a read interleaved with an `apply`
   * would answer indices for a page that no longer exists. The version comes
   * back with the answer, and it is what `replaceTextObject` carries — a chooser
   * built on a stale list would name an object the document has moved past, and
   * `#refuseIfStale` is what catches that.
   *
   * The poison guard comes first, as everywhere. The **session** guard is here
   * too and names `mupdf` deliberately: the bytes this read hands PDFium come
   * from the live MuPDF session, so a document with none has nothing to ask
   * about — the missing engine is a different state and {@link
   * EngineUnavailableError} is the one that says so.
   */
  async textBlocks(docId: DocId, page: number): Promise<DocumentTextBlocks> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#textBlocks(docId, sessions, page);
    });

    return { version, ...value };
  }

  /**
   * Every object on a page, inside the document's lane.
   *
   * {@link textBlocks}' guards in its order and for its reasons: the poison
   * guard first, then a session guard naming `mupdf` because the bytes this
   * read hands PDFium come from the live MuPDF session. The version comes back
   * with the answer, and it is what the three object commands carry — a chooser
   * built on a stale list would name an object the document has moved past.
   */
  async pageObjects(docId: DocId, page: number): Promise<DocumentPageObjects> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#pageObjects(docId, sessions, page);
    });

    return { version, objects: value.objects, truncated: value.truncated };
  }

  /**
   * One page rasterised by the editing engine, inside the document's lane.
   *
   * {@link pageObjects}' guards in its order and for its reasons. The lane
   * matters here for one it does not share: this read serialises the document to
   * hand PDFium its bytes, and a render interleaved with an `apply` would draw a
   * page that is neither the one before the command nor the one after it — a
   * picture of a document that never existed, which is worse than a stale one
   * because nothing about it looks wrong.
   *
   * The version comes back so a caller can drop a raster the document has moved
   * past. It is not a staleness CHECK — a read answers with whatever is there
   * now and cannot be stale (`document.execute`'s note) — it is what lets the
   * renderer notice.
   */
  async renderPage(
    docId: DocId,
    page: number,
    width: number,
    height: number,
  ): Promise<DocumentPageRaster> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#renderPage(docId, sessions, page, width, height);
    });

    return { version, width: value.width, height: value.height, png: value.png };
  }

  /**
   * A block's run fonts, inside the document's lane: {@link renderPage}'s guards in its order and for its reason, since
   * this read too hands PDFium the document's bytes, and a font read interleaved with an apply could check a run against
   * a page that is neither. The version comes back so the editor drops fonts for a page that has moved.
   */
  async runFonts(
    docId: DocId,
    page: number,
    indices: readonly number[],
  ): Promise<{
    readonly version: DocVersion;
    readonly fonts: readonly Uint8Array<ArrayBuffer>[];
    readonly runs: readonly (number | null)[];
  }> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return this.#runFonts(docId, sessions, page, indices);
    });
    return { version, fonts: value.fonts, runs: value.runs };
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
    /**
     * `breakSignatures`: the person agreed this edit may break the document's signatures (ADR-0149). Absent is not
     * agreed, so a command `main` mints itself is asked about like any other — none of them breaks one today.
     */
    options: {
      readonly breakSignatures?: boolean;
      /** The version the previous command of this command's undo step produced (ADR-0200). Absent, a step of its own. */
      readonly joinsStep?: DocVersion;
    } = {},
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
    //
    // HELD ON AN OBJECT, `undo`'s idiom: where a protect ran, its file's path, so the Recent picture is retaken after
    // the lane, whose capture enters the lane itself.
    const protectedAt: { path: string | undefined } = { path: undefined };
    // THE COPIES A PROTECT COULD NOT SEAL, held across the lane like `protectedAt`: a protect that applied names them
    // rather than failing (ADR-0178). Empty for every other command, and for a protect that sealed every copy.
    const unsealed: { copies: readonly string[] } = { copies: [] };
    const { version, value: byteLength } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      // A DOCUMENT WITH NO SESSIONS AT ALL is still this module's refusal to
      // make: the supervisor knows nothing about it, which is a different state
      // from *this writer has no session*, and only the bus can tell the second
      // one apart from a byte-image writer that never has a stored session.
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // A SIGNED DOCUMENT IS ASKED ABOUT BEFORE THE EDIT, never at the save after it (ADR-0149). A command that
      // rewrites the document whole breaks every signature in it, and by the save the image is already rewritten —
      // MuPDF then reopens it, finds the signature dictionaries, will append, and answers *kept*. So the question is
      // asked here, inside the lane, before the bus has touched anything, of the document's own session.
      if (breaksSignatures(command.kind) && !context.signaturesBreakAgreed) {
        if (options.breakSignatures === true) {
          context.agreeToBreakSignatures();
        } else {
          const session = sessions.mupdf;
          if (session === undefined) throw new MissingSessionError(docId, 'mupdf');
          const { signatures } = await this.#signaturesKept(session);
          if (signatures > 0) throw new SignaturesWouldBreakError(command.kind, signatures);
        }
      }

      // A COMMAND THAT HAS ENDED THE ENGINE THREE TIMES IS NOT SENT AGAIN (ADR-0221), and the refusal is decided here,
      // before the host, so the fourth attempt costs nothing. Read inside the lane for the poison check's reason.
      const { trimmed, entry, drawn } = await ledgered(this.#engine, docId, command.kind, () =>
        this.#bus.execute<K>(
          sessions,
          context,
          command,
          // THE IDS COME FROM THE CONTRACT, not from a field read here.
          // `sourceIdsOf` is the one answer to *which documents does this payload
          // name*, and the payload is the contract's (ADR-0040 Decision 4).
          this.#byteImage(docId, sourceIdsOf(command)),
          options.joinsStep,
        ),
      );
      // A PROTECT MOVES THE HOLDER, in the lane and after the bus recorded it, so every later open of a copy has the
      // key the document opens with now (ADR-0171 Decision 8).
      const terms = protectionTermsOf(command);
      if (terms !== undefined) {
        this.#engine.protected(docId, entry, terms);
        const protect = this.#bus.protectOf(entry);
        if (protect !== undefined) unsealed.copies = await this.#sealPlaintextCopies(docId, context, protect);
        protectedAt.path = context.path;
      }
      // READ AFTER THE BUS, INSIDE THE LANE, for the reason `Versioned` reads
      // the version there: the command rewrote the canonical image, and the
      // length the renderer needs is the new one. Reading it outside the lane
      // would be a second command's length attributed to this one.
      //
      // The trim travels with the length for the same reason: it is what THIS
      // command cost, and a second command's trim attributed to this one would
      // tell the user their history shrank at the wrong moment.
      // AND WHAT IT DREW AS BOXES (ADR-0174), for the trim's reason: this command's, through the one cap. AND THE
      // COPIES A PROTECT COULD NOT SEAL (ADR-0178), empty for every other command: the person is owed them.
      return {
        byteLength: context.byteLength,
        historyDropped: trimmed.droppedEntries,
        ...cappedBoxes(drawn),
        unsealedCopies: unsealed.copies,
      };
    });

    // A PICTURE OF A PROTECTED PAGE cannot be encrypted, so it is retaken: deleted, and kept again only if the document
    // still opens with no password (ADR-0171 Decision 8, `firstPagePicture`'s rule).
    if (protectedAt.path !== undefined) void this.#recentPicture.retake(docId, protectedAt.path);
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

      // A PROTECT'S UNDO MOVES THE HOLDER FIRST, since a protect undone by its checkpoint reopens that copy, and the
      // reopen must be given where the document stood before it (ADR-0171 Decision 8). Moved back if the undo throws,
      // so the holder and the log never disagree about which protect is applied.
      const last = context.log.entries.at(-1);
      const protect = isProtectStep(last) ? last : undefined;
      if (protect !== undefined) this.#engine.protectionStepped(docId, protect, 'before');
      try {
        stepped.yes =
          (await this.#bus.undo(
            sessions,
            context,
            (write) => this.#restore(docId, write),
            this.#byteImage(docId),
          )) !== undefined;
      } catch (thrown) {
        if (protect !== undefined) this.#engine.protectionStepped(docId, protect, 'after');
        throw thrown;
      }
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
    // NO BOXES, the bus's `TOLD_AT_THE_EDIT` at the boundary (ADR-0174 Decision 3).
    // NO UNSEALED COPIES: undo and redo seal nothing — a protect's seal pass is its own and runs at apply, not here
    // (ADR-0178). A field omitted here would make the renderer's obligation optional on one path, `historyDropped`'s reason.
    return stepped.yes ? { version, byteLength, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] } : undefined;
  }

  /**
   * Steps one entry forward, inside the document's lane — {@link undo}'s guards, in its order.
   *
   * ## The second documents are asked for before they can be resolved
   *
   * A redo of *Merge PDFs* re-runs against the source document's session, and which document that
   * is lives in the log entry, not in anything this method was handed. `pendingRedoSources` is the
   * bus saying what it is about to re-apply, so the byte images are resolved here and the bus still
   * finds nothing itself (ADR-0040 Decision 3). Read inside the lane, where no other command can
   * move the cursor between the question and the redo.
   *
   * `historyDropped: 0` for undo's reason: redo does not grow the log.
   *
   * @throws `DocumentNotOpenError`, `DocumentBusyError`, {@link DocumentPoisonedError},
   *   {@link MissingSessionError}.
   */
  /**
   * The rebuild's second half after an engine host died, run by the supervisor INSIDE the lane entry that reopened
   * the document ([ADR-0115](../../../docs/DECISIONS/0115-a-rebuilt-session-replays-what-the-image-does-not-hold.md),
   * invariant 18 clause (ii)) — so it takes the lane's context rather than entering the lane, which would wait on
   * itself.
   *
   * The reopened session is the canonical image; this re-applies every applied entry that image does not include,
   * with `redo`'s inputs for them. No version moves: the renderer's image never changed.
   *
   * @returns how many entries were re-applied
   * @throws {@link MissingSessionError} when the reopen held nothing, and whatever an entry's apply throws — the
   *   supervisor's clause (i)
   */
  async replayAfterRebuild(docId: DocId, context: DocumentContext): Promise<number> {
    const sessions = this.#engine.sessions(docId);
    if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
    return this.#bus.replayPastImage(sessions, context, this.#byteImage(docId, this.#bus.pendingReplaySources(context)));
  }

  async redo(docId: DocId): Promise<Applied | undefined> {
    const stepped = { yes: false };
    const protectedAt: { path: string | undefined } = { path: undefined };

    const { version, value: byteLength } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // A PROTECT'S REDO MOVES THE HOLDER FIRST, for undo's reason in the other direction.
      const next = context.log.peekRedo();
      const protect = isProtectStep(next) ? next : undefined;
      if (protect !== undefined) this.#engine.protectionStepped(docId, protect, 'after');
      try {
        stepped.yes =
          (await this.#bus.redo(sessions, context, this.#byteImage(docId, this.#bus.pendingRedoSources(context)))) !==
          undefined;
      } catch (thrown) {
        if (protect !== undefined) this.#engine.protectionStepped(docId, protect, 'before');
        throw thrown;
      }
      // A REDONE PROTECT SEALS AGAIN, for a copy written while it was undone.
      const redone = protect === undefined ? undefined : this.#bus.protectOf(protect);
      if (redone !== undefined) {
        await this.#sealPlaintextCopies(docId, context, redone);
        protectedAt.path = context.path;
      }
      return context.byteLength;
    });

    // `execute`'s retake, for a redone protect.
    if (protectedAt.path !== undefined) void this.#recentPicture.retake(docId, protectedAt.path);
    // NO BOXES, the bus's `TOLD_AT_THE_EDIT` at the boundary (ADR-0174 Decision 3).
    // NO UNSEALED COPIES: undo and redo seal nothing — a protect's seal pass is its own and runs at apply, not here
    // (ADR-0178). A field omitted here would make the renderer's obligation optional on one path, `historyDropped`'s reason.
    return stepped.yes ? { version, byteLength, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] } : undefined;
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
  /**
   * ## `outline` is ADR-0040's extension, and the reader is `destinations`'
   *
   * `#destinations` is `readDestinations` — the module that owns *what are this
   * document's bookmarks*. The alternative that ADR rejects is a pdf-lib apply
   * walking `/Outlines` for itself, which would agree with this reader on every
   * ordinary outline and differ on a cycle, a name-tree destination, or an
   * entry with no reachable page (B3a).
   *
   * It is here rather than in a second accessor object for the reason
   * `CommandInputs` gives: a fifth positional parameter would have edited every
   * call site of `execute` for a value almost none of them may use, and again
   * for the next resolver. **The declaration is not read on this side** —
   * `execute`'s note records why the routing table left this module, and
   * reading `reads` here could not serve `redo` anyway, since a redo has no
   * command until the bus has read the log.
   */
  /**
   * ## Every member reads the document's sessions WHEN CALLED, never when built
   *
   * A restore replaces the sessions (`recycle`), and the bus calls `current` AFTER one:
   * undoing a terminal entry restores its checkpoint and then makes main's image the
   * session's bytes (ADR-0084). A set captured when this was built is the one the
   * restore released, and flushing it answered *"This session token was not adopted by
   * this registry, or it has already been released"* — measured 2026-09-18, undoing a
   * drawn rectangle in the running application. So no set is taken as a parameter: there
   * is nothing stale to hand in.
   */
  #byteImage(docId: DocId, named: readonly DocId[] = []): CommandInputs {
    const live = (): DocumentSessions => {
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      return sessions;
    };
    return {
      current: () => this.#save.flush(docId, live()),
      // THE KEY THOSE BYTES OPEN WITH (ADR-0171's addendum): a document opened with its password flushes to its own
      // encrypted form, which a byte-image writer cannot open without it.
      opensWith: () => this.#engine.opensWith(docId),
      // THE REFRESH'S ROUTE (ADR-0121 Decision 2): the session's bytes placed in the file the service names.
      currentInto: async (destination) => placeStaged(await this.#save.stage(docId, live()), destination),
      adopt: (write) => this.#restore(docId, write),
      // THE LIST, not the flag: a table of contents is built from the entries there are, and the walk's bound is one
      // no real outline reaches (ADR-0130 Decision 3).
      outline: async () => (await this.#destinations(docId, live())).destinations,
      // ADR-0051's member, and the one that takes an argument. The request is the
      // command's own — the declaration builds it — and this closure adds the
      // document, which is what the bus cannot name.
      ocr: (request) => this.#ocr(docId, live(), request),
      // ADR-0176's member: the page the command names, and this closure adds the document, as `ocr`'s does.
      pageRuns: ({ page }) => this.#pageRuns(docId, live(), page),
      sources: this.#sourcesFor(named),
    };
  }

  /**
   * Sessions for the other documents a command names (ADR-0040 Decision 3).
   *
   * ## Resolved HERE because this is the component that can find a document
   *
   * The bus is a router and has never held a document index. `#engine.sessions`
   * is the same call `execute` makes for the target, so a source is resolved by
   * the one mechanism that resolves anything — there is no second lookup path.
   *
   * ## A document with no sessions is simply ABSENT from the map
   *
   * Not an entry mapping to `undefined`, and not a throw here. The bus refuses
   * by name with {@link MissingSourceSessionError}, which is where that refusal
   * belongs: it knows which command named the id and can say so. Throwing here
   * would report *a document is missing* without being able to say what wanted
   * it.
   *
   * That covers the reachable race — the user closes the source tab between
   * pressing merge and the command reaching the lane. ADR-0040 calls it *"an
   * ordinary race, not a defect"*, and an absent key is how it stays one.
   *
   * ## The source's LANE is not taken, deliberately
   *
   * A merge reads the source and writes the target, so only the target's lane
   * is entered. Taking both would be two lanes held at once by one command,
   * which is a deadlock the moment two merges run in opposite directions — and
   * it would buy nothing, because the source is not modified.
   *
   * What that costs is stated rather than hidden: a command running against the
   * source concurrently could change it mid-graft. The pages already copied
   * stay copied. That is the same weakness any cross-document read has, and the
   * alternative is the deadlock.
   */
  #sourcesFor(named: readonly DocId[]): ReadonlyMap<DocId, DocumentSessions> {
    const resolved = new Map<DocId, DocumentSessions>();
    for (const id of named) {
      const sessions = this.#engine.sessions(id);
      if (sessions !== undefined) resolved.set(id, sessions);
    }
    return resolved;
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
  /**
   * The document as it is now, through the flush a save uses — what *Save back* and *Upload a
   * copy* send to a cloud provider (ADR-0091). In the lane, for `saveCopy`'s reason below, and it
   * stamps nothing: sending a copy somewhere does not make this document clean.
   */
  async currentImage(docId: DocId): Promise<Uint8Array> {
    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await this.#save.flush(docId, sessions);
    });
    return value;
  }

  /** The document's name, as the service records it — the name a copy is uploaded under. */
  nameOf(docId: DocId): string | undefined {
    return this.#documents.nameOf(docId);
  }

  async saveCopy(docId: DocId): Promise<CopyOutcome | undefined> {
    return (await this.#writeCopy(docId, () => undefined))?.outcome;
  }

  /**
   * A copy of the document to make an edit on, written where the person chooses, so the original keeps the
   * signatures that edit would break
   * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)
   * Decision 5). {@link saveCopy}'s picker and write exactly, and the path the copy went to, which the handler opens.
   *
   * **A command composed against a version the document has moved past is stale here too**, checked inside the lane
   * against the version the copy is written at: the copy holds the document as it is now, so an edit named against an
   * older one would land on content it was not composed for, as it would on the original.
   */
  /**
   * A copy of the document to WORK ON, written where the person chooses (cloud-4 7b): {@link saveCopy}'s picker and
   * write exactly, and the path the copy went to, which the handler opens.
   */
  async copyToWorkOn(docId: DocId): Promise<{ readonly outcome: CopyOutcome; readonly destination: string } | undefined> {
    return this.#writeCopy(docId, () => undefined);
  }

  /**
   * The earlier versions kept for this document's file, newest first (ADR-0198) — each as an opaque id, never a path.
   * Empty where the document has no file, no folder is kept, or the file was never saved over.
   */
  async listBackups(docId: DocId): Promise<readonly KeptVersion[]> {
    if (this.#documents.nameOf(docId) === undefined) throw new DocumentNotOpenError(docId, 'list its earlier versions');
    const store = this.#backups;
    if (store === undefined) return [];
    const { value: path } = await this.#documents.run(docId, (context) => Promise.resolve(context.path));
    const kept = await listStoredBackups(store.root, path);
    return kept.map((backup) => ({ id: backup.id, savedAt: backup.savedAt.toISOString(), bytes: backup.bytes }));
  }

  /**
   * An earlier version, written as a COPY where the person chooses and opened by the handler: `saveCopy`'s picker and its
   * atomic write, with the version's bytes in place of the document's. The version is never opened itself, so saving cannot
   * overwrite it. `gone` where this folder no longer holds the id (a clear, a newer save rotated it away).
   */
  async restoreBackup(
    docId: DocId,
    id: string,
  ): Promise<{ readonly outcome: CopyOutcome; readonly destination: string } | 'gone' | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'restore an earlier version');
    const store = this.#backups;
    if (store === undefined) return 'gone';
    const { value: path } = await this.#documents.run(docId, (context) => Promise.resolve(context.path));
    const source = await storedBackupPath(store.root, path, id);
    if (source === undefined) return 'gone';

    const destination = await this.#copy.pick(suffixed(suggest, 'previous version'));
    if (destination === null) return undefined;
    const bytes = new Uint8Array(await readFile(source));
    const { value } = await this.#documents.run(docId, (context) =>
      writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        () => Promise.resolve(stagedBytes(bytes)),
        destination,
        backupsFor(context),
      ),
    );
    return { outcome: value, destination };
  }

  /**
   * Moves the old `.bak` files beside this document that Monstera can PROVE it made into its own backups folder, with no
   * question (ADR-0198 Decision 5, corrected 2026-10-09). Only a file the provenance record names is moved — another
   * program's `.bak` is the person's (ADR-0139) — and a move that fails leaves the file where it is, silently. Run at every
   * open: once nothing proven is left beside the file the scan finds nothing, so no memory of "already done" is kept.
   * @returns how many moved
   */
  async adoptOldBackups(docId: DocId): Promise<number> {
    if (this.#documents.nameOf(docId) === undefined) throw new DocumentNotOpenError(docId, 'move old backups');
    const store = this.#backups;
    if (store === undefined) return 0;
    try {
      const { value: path } = await this.#documents.run(docId, (context) => Promise.resolve(context.path));
      const scan = await scanLegacyBackups(path, this.#save.provenance);
      if (scan.proven.length === 0) return 0;
      return (await moveLegacyBackups(store.root, path, scan, this.#save.provenance)).moved;
    } catch {
      // NOTHING IS SAID: a folder that cannot be read or written keeps its files, and the next open tries again.
      return 0;
    }
  }

  /** Deletes every kept version in Monstera's own folder (Settings › Privacy › Clear backups); how many went. */
  async clearBackups(): Promise<number> {
    const store = this.#backups;
    return store === undefined ? 0 : await clearStoredBackups(store.root);
  }

  /** Whether the document's own file could be written over now — the service's answer, asked at each call. */
  fileAccess(docId: DocId): Promise<FileAccess> {
    return this.#documents.fileAccess(docId);
  }

  async copyForEditing(
    docId: DocId,
    command: Command,
  ): Promise<{ readonly outcome: CopyOutcome; readonly destination: string } | undefined> {
    return this.#writeCopy(docId, (version) => {
      const named = targetVersionOf(command);
      if (named !== undefined && named !== version) throw new StaleTargetError(command.kind, named, version);
    });
  }

  /** {@link saveCopy}'s pick and write, with `inLane` run first inside the lane against the version being copied. */
  async #writeCopy(
    docId: DocId,
    inLane: (version: DocVersion) => void,
  ): Promise<{ readonly outcome: CopyOutcome; readonly destination: string } | undefined> {
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

    // THE CONTEXT IS READ FOR ITS VERSION AND NOTHING ELSE, and the write is
    // never handed it: a context is what a stamp is made through, and a copy
    // must not stamp. The lane is entered so the flush is serialised against
    // every other operation on this document, and so the version `inLane`
    // checks is the version the copy is written at.
    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      inLane(context.version);

      // THE SAME FLUSH A SAVE USES, so a copy and a save cannot disagree about
      // what this document currently is (B3a). `writeDocumentCopy` is handed no
      // `DocumentContext`, so it cannot stamp the document clean.
      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        () => this.#save.stage(docId, sessions),
        destination,
        backupsFor(context),
      );
    });

    return { outcome: value, destination };
  }

  /**
   * Sends this document to DocuSign for signature, signing in first if needed
   * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
   *
   * ## The bytes are the SAVE'S flush, taken inside the lane
   *
   * So what DocuSign receives is exactly what a save would write now — the same flush
   * `saveCopy` hands its destination (B3a) — and a document edited mid-send cannot
   * be half of each.
   *
   * ## The send is OUTSIDE the lane, deliberately
   *
   * A sign-in waits for a person, and a person may take minutes. Holding this
   * document's lane that long would refuse every edit to it meanwhile. The bytes are
   * already taken, so nothing the send does touches the document.
   */
  async docusignSend(
    docId: DocId,
    request: { readonly emailSubject: string; readonly signers: readonly DocusignSigner[] },
  ): Promise<{ readonly kind: 'sent'; readonly envelopeId: string } | { readonly kind: DocusignRefusalKind }> {
    const documentName = this.#documents.nameOf(docId);
    if (documentName === undefined) throw new DocumentNotOpenError(docId, 'send to DocuSign');

    const { value: pdf } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      return await this.#save.flush(docId, sessions);
    });

    try {
      const envelopeId = await this.#docusign.send({
        docId,
        pdf,
        documentName,
        emailSubject: request.emailSubject,
        signers: request.signers,
      });
      return { kind: 'sent', envelopeId };
    } catch (error) {
      // NAMED BY THE SESSION, where the knowledge is. Anything it did not name is not
      // a person's situation and reaches the handler as a defect.
      if (error instanceof DocusignOutcomeRefused) return { kind: error.kind };
      throw error;
    }
  }

  /**
   * Saves the signed copy of the envelope this document was last sent as.
   *
   * ## No dialog opens until there is a signed copy to save
   *
   * An envelope not yet completed, or a document this session sent nothing for, is
   * answered before the destination picker — a person asked where to save something
   * that does not exist yet would pick a file for nothing.
   *
   * ## The write is `extract`'s
   *
   * `writeDocumentCopy`, handed a flush that answers DocuSign's combined document
   * rather than this document's bytes: the same contested-destination check, the
   * same temporary and backup naming, the same atomic write.
   */
  async docusignRetrieve(
    docId: DocId,
  ): Promise<
    | CopyOutcome
    | undefined
    | { readonly kind: 'nothing-sent' }
    | { readonly kind: 'not-completed'; readonly status: string }
    | { readonly kind: DocusignRefusalKind }
  > {
    const documentName = this.#documents.nameOf(docId);
    if (documentName === undefined) throw new DocumentNotOpenError(docId, 'retrieve from DocuSign');

    let retrieved: Awaited<ReturnType<DocusignSession['retrieve']>>;
    try {
      retrieved = await this.#docusign.retrieve(docId);
    } catch (error) {
      if (error instanceof DocusignOutcomeRefused) return { kind: error.kind };
      throw error;
    }
    if (retrieved.kind !== 'completed') return retrieved;
    const signed = retrieved.bytes;

    const destination = await this.#copy.pick(suggestedCopyName(documentName));
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) =>
      writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        () => Promise.resolve(stagedBytes(signed)),
        destination,
        backupsFor(context),
      ),
    );
    return value;
  }

  /**
   * Writes the named pages to a NEW document at a destination the user picks.
   *
   * ## The SECOND CALLER of the destination path, and that is the whole design
   *
   * `saveCopy`'s shape line for line: read the name before the lane, pick
   * outside it, then enter the lane and hand `writeDocumentCopy` a flush. What
   * differs is one argument — the flush produces the EXTRACT's bytes instead of
   * the document's — and that is exactly what that function's `flush` parameter
   * is for. No new write path, no second atomic-write ordering, no second
   * opinion about what a contested destination is.
   *
   * ## The extracted bytes are built in the HOST and never in main
   *
   * `extractPages` reaches MuPDF, which invariant 20 keeps out of `main`
   * (ADR-0026). So `engine/extract` builds them there and writes them into the
   * granted output directory, and main reads that file — the same round trip a
   * serialise makes. What crosses the pipe is a page list and a count.
   *
   * ## It does NOT stamp the document clean, and it does not re-point it
   *
   * `writeDocumentCopy` cannot: it is given no `DocumentContext`, which is B5
   * over a comment. An extract leaves the source exactly as it was — still
   * dirty if it was dirty, still at its own path — because the pages were
   * copied out rather than moved.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   * reason: a document this service does not hold has no name to offer.
   */
  async extract(docId: DocId, pages: PageSet): Promise<CopyOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'extract pages');

    const destination = await this.#copy.pick(suggestedExtractName(suggest));
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        // THE ONE DIFFERENCE FROM `saveCopy`. Everything downstream — the
        // contested-destination check, the temporary and backup naming, the
        // atomic write — is the same code on the same terms.
        async () => stagedBytes(await this.#extract(docId, sessions, pages)),
        destination,
        backupsFor(context),
      );
    });

    return value;
  }

  /**
   * Writes one page to a file the person names, opens it in the operating system's PDF
   * handler, and watches it for saves
   * ([ADR-0062](../../../docs/DECISIONS/0062-a-page-edited-in-another-application-leaves-as-a-named-file-and-returns-by-the-one-open-route.md)).
   *
   * ## `extract`'s route for one page, and `.pdf` is refused BEFORE the write
   *
   * The picker runs before the lane, for `saveCopy`'s reason. A destination not ending
   * `.pdf` is refused before anything is written, so no page's bytes sit under a name the
   * operating system would run as a program (`openExternalEditor.ts`).
   *
   * ## The version recorded is the one the RENDERER read the index at
   *
   * The reimport's `replacePage` carries it, so the bus refuses a document that moved at any
   * point after that read — including between the read and this write. The window in which
   * a stale index could extract a different page is therefore one whose reimport cannot land
   * (ADR-0062's 2026-09-14 correction).
   *
   * ## Watched before it is opened
   *
   * The watch starts before the handler launches, so a save an editor makes at once is not
   * missed, and a launch that fails closes it again.
   */
  async editPageExternally(
    docId: DocId,
    page: number,
    version: DocVersion,
  ): Promise<
    | { readonly kind: 'sent' }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'not-pdf' }
    | { readonly kind: 'not-watchable' }
    | { readonly kind: 'launch-failed' }
    | Exclude<CopyOutcome, { readonly kind: 'copied' }>
  > {
    const name = this.#documents.nameOf(docId);
    if (name === undefined) throw new DocumentNotOpenError(docId, 'edit a page in another application');

    // A PERSON COUNTS PAGES FROM ONE, so the suggested file name does; the index stays zero-based.
    const destination = await this.#externalEdit.pick(suffixed(name, `page ${String(page + 1)}`));
    if (destination === null) return { kind: 'cancelled' };
    if (!isPdfPath(destination)) return { kind: 'not-pdf' };

    const { value: written } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        async () => stagedBytes(await this.#extract(docId, sessions, [page])),
        destination,
        backupsFor(context),
      );
    });
    if (written.kind !== 'copied') return written;

    // THE BASELINE IS WHAT IS ON DISK, read back rather than taken from the bytes the copy
    // path held, so the watch compares against exactly the file the editor opens.
    const baseline = await this.#externalEdit.watch.digest(destination);
    if (baseline === null) {
      throw new Error('the page was written and could not be read back to start its watch');
    }
    const watch = watchEdits(this.#externalEdit.watch, destination, baseline);
    if (watch === null) return { kind: 'not-watchable' };

    const failure = await this.#externalEdit.open(destination);
    if (failure !== null) {
      watch.close();
      return { kind: 'launch-failed' };
    }

    // ONE PAGE OUT PER DOCUMENT (Decision 3): a second send-out ends the first's watch.
    this.#outs.get(docId)?.watch.close();
    this.#outs.set(docId, { path: destination, page, version, watch });
    return { kind: 'sent' };
  }

  /**
   * Waits a bounded time for the page this document sent out to be saved (Decision 4).
   *
   * `ended` where no page is out, so a renderer that asks after a close or before a send-out
   * is answered rather than left waiting.
   */
  awaitExternalEdit(docId: DocId, boundMs: number = EXTERNAL_EDIT_WAIT_MS): Promise<EditWait> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'wait for an edit made in another application');
    }
    const out = this.#outs.get(docId);
    if (out === undefined) return Promise.resolve('ended');
    return out.watch.wait(boundMs);
  }

  /**
   * The file to open for a reimport, when a save of the page sent out is waiting.
   *
   * The path is for the handler alone, which opens it by the one open route; it never
   * crosses to the renderer (invariant 2).
   */
  externalEditToReimport(docId: DocId): string | undefined {
    const out = this.#outs.get(docId);
    if (out === undefined) return undefined;
    return out.watch.pending() === null ? undefined : out.path;
  }

  /**
   * Puts the edited page back: `replacePage` at the index sent out, carrying the version
   * recorded then, so the bus refuses a document that moved (ADR-0062's correction).
   *
   * The edit is accepted only once the replace has landed, and the recorded version moves
   * to the new one, so the NEXT save of the same page can come back too.
   *
   * @throws StaleTargetError where the document moved; the handler answers `document-changed`.
   */
  async reimportExternalEdit(docId: DocId, source: DocId): Promise<Applied> {
    const out = this.#outs.get(docId);
    if (out === undefined) {
      throw new Error('reimportExternalEdit was called with no page out; its handler checks first');
    }
    if (out.watch.pending() === null) {
      throw new Error('reimportExternalEdit was called with no edit pending; its handler checks first');
    }
    const applied = await this.execute(docId, {
      kind: 'replacePage',
      source,
      // THE PAGE THAT WENT OUT, replaced by everything the other application saved: an edit that split it into two
      // pages comes back as two.
      pages: [out.page],
      sourcePages: 'all',
      version: out.version,
    });
    out.watch.accept();
    // ONLY IF THIS PAGE-OUT IS STILL THE CURRENT ONE: a close during the replace ended it, and
    // writing it back would resurrect a watch that has already stopped.
    if (this.#outs.get(docId) === out) this.#outs.set(docId, { ...out, version: applied.version });
    return applied;
  }

  /**
   * Ends a document's page-out watch. The composition registers it on `DocumentTeardown`, so a
   * close ends it without any close path having to remember to (finding FFFF-1's rule).
   */
  endExternalEdit(docId: DocId): void {
    const out = this.#outs.get(docId);
    if (out === undefined) return;
    this.#outs.delete(docId);
    out.watch.close();
  }

  /**
   * Writes a region of one page to a PNG at a destination the user picks.
   *
   * ## The THIRD caller of the destination path, and it changes nothing about it
   *
   * `extract`'s body with two substitutions — a different picker and a
   * different flush — which is the argument for that function's shape rather
   * than a coincidence. The contested check, the temporary and backup naming
   * and the atomic write are the same code on the same terms, and they should
   * be: a PNG written over a document somebody has open destroys it exactly as
   * a PDF would.
   *
   * ## The raster is built in the HOST and never in main
   *
   * Invariant 20 keeps MuPDF out of main, and §9.17's gate keeps a raster off
   * the boundary. Both are satisfied by the same route: `engine/snapshot`
   * writes the PNG into the granted output directory and main reads that file,
   * so what crosses the pipe is a rectangle and a count.
   *
   * ## It does NOT touch the document
   *
   * A snapshot is a picture of a page, so there is no command, no log entry and
   * no version bump — and `writeDocumentCopy` is given no `DocumentContext`,
   * which is what makes that structural rather than a promise.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   *   reason: a document this service does not hold has no name to offer.
   */
  async snapshot(
    docId: DocId,
    request: RegionRequest,
  ): Promise<CopyOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'snapshot a region');

    const destination = await this.#snapshot.pick(suggestedSnapshotName(suggest));
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        async () => stagedBytes(await this.#snapshot.region(docId, sessions, request)),
        destination,
        backupsFor(context),
      );
    });

    return value;
  }

  /**
   * Writes the form's data to a destination the user picks.
   *
   * ## The FOURTH caller of the destination path, and it changes nothing about
   * it
   *
   * {@link snapshot}'s body with a different picker and a different flush. The
   * contested check, the temporary and backup naming and the atomic write are
   * the same code on the same terms — a form-data file written over a document
   * somebody has open destroys it exactly as a PDF would.
   *
   * ## It does NOT touch the document
   *
   * An export is a reading written out, so there is no command, no log entry
   * and no version bump — and `writeDocumentCopy` is given no
   * `DocumentContext`, which is what makes that structural rather than a
   * promise.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   *   reason: a document this service does not hold has no name to offer.
   */
  async exportFormData(docId: DocId, format: FormDataFormat): Promise<CopyOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export form data');

    const destination = await this.#formData.pick(suggest, format);
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        async () => stagedBytes(await this.#formData.encode(docId, sessions, format)),
        destination,
        backupsFor(context),
      );
    });

    return value;
  }

  /**
   * Fills the form from a data file the user picks.
   *
   * ## `placeImage`'s body and every one of its reasons
   *
   * The picker runs before the lane, because a dialog can be up for as long as
   * a person takes; the bytes exist in this process and cross nothing, because
   * the renderer asked with a `DocId` and an enum member; and the bound is
   * checked before the read, because refusing a file after loading it costs
   * exactly what the bound exists to avoid.
   *
   * ## `unreadable` covers three refusals and the catch is deliberately wide
   *
   * The file may not be form data, may name no field this document has, or may
   * hold a value the field's type rules reject. All three are the **apply**
   * refusing, and an apply's refusal reason does not cross the engine host's
   * boundary — it arrives as `internal` with its diagnostic withheld, by
   * design. So this catch is wide on purpose, and the outcomes it must not
   * swallow are named individually above it, exactly as `placeImage`'s are.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   *   reason.
   */
  async importFormData(
    docId: DocId,
    format: FormDataImportFormat,
  ): Promise<ImportFormDataOutcome> {
    // READ BEFORE THE DIALOG, `insertImage`'s ordering and its reason.
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'import form data');
    }

    const picked = await this.#formData.open(format);
    if (picked === null) return { kind: 'cancelled' };

    const read = await this.#formData.read(picked);
    if (read.kind === 'too-large') return { kind: 'too-large', limitBytes: MAX_FORM_DATA_BYTES };
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    try {
      // WHAT IT WOULD DO, PLANNED FIRST (ADR-0193's neighbour): the same plan the fill follows, in the host that holds the
      // form, so a person is told which fields were filled and which were left and why, and a file that names nothing
      // this form has is the wrong file and not a reason that never crossed the host boundary.
      const { value: plan } = await this.#documents.run(docId, async () => {
        const failures = this.#engine.poisoned(docId);
        if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
        const sessions = this.#engine.sessions(docId);
        if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
        return this.#formImportPlan(docId, sessions, read.bytes, format);
      });
      if (plan === 'unreadable') return { kind: 'unreadable' };
      if (plan.matched === 0) return { kind: 'matched-nothing', named: plan.named };

      const applied = await this.execute(docId, {
        kind: 'importFormData',
        format,
        bytes: read.bytes,
      });
      return { kind: 'imported', ...applied, filled: plan.filled, skipped: plan.skipped, more: plan.more };
    } catch (error) {
      // `placeImage`'s catch and its reason: the classes the handler already
      // turns into declared codes are rethrown, and everything else is this
      // file refusing to import.
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) {
        throw error;
      }
      if (error instanceof DocumentNotOpenError) throw error;
      return { kind: 'unreadable' };
    }
  }

  /**
   * Writes the document's annotations to a file the user picks (ADR-0077).
   *
   * {@link exportFormData}'s body and its reasons: the picker before the lane, the encoding in the
   * host, and the write by the one atomic copy route.
   */
  async exportAnnotations(docId: DocId, format: AnnotationDataFormat): Promise<CopyOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export annotations');

    const destination = await this.#annotationData.pick(suggest, format);
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        async () => stagedBytes(await this.#annotationData.encode(docId, sessions, format)),
        destination,
        backupsFor(context),
      );
    });

    return value;
  }

  /**
   * Adds the annotations a file the user picks carries (ADR-0077).
   *
   * {@link importFormData}'s body and every one of its reasons, the wide catch included: a file
   * that is not annotation data, carries nothing this build exchanges, or names a page this
   * document lacks is the apply refusing, and that reason does not cross the host's boundary.
   */
  async importAnnotations(docId: DocId, format: AnnotationDataFormat): Promise<ImportAnnotationsOutcome> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'import annotations');
    }

    const picked = await this.#annotationData.open(format);
    if (picked === null) return { kind: 'cancelled' };

    const read = await this.#annotationData.read(picked);
    if (read.kind === 'too-large') return { kind: 'too-large', limitBytes: MAX_ANNOTATION_DATA_BYTES };
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    try {
      const applied = await this.execute(docId, { kind: 'importAnnotations', format, bytes: read.bytes });
      return { kind: 'imported', ...applied };
    } catch (error) {
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) {
        throw error;
      }
      if (error instanceof DocumentNotOpenError) throw error;
      return { kind: 'unreadable' };
    }
  }

  /**
   * Copies named marks on one page into the clipboard this object holds.
   *
   * ## The version is checked against the LANE'S, after the read
   *
   * `version` is the one the renderer's selection was read at. The handles are positions in that
   * walk, so if the document has moved they name other marks — and a copy that went ahead would put
   * a stranger's annotation on the clipboard under the name of the one the person selected. The
   * read happens inside the lane and the lane reports the version it ran at, so comparing the two
   * afterwards is exact; the text read at a stale version is dropped rather than kept.
   *
   * A handle past the walk is the same staleness arriving a different way, and answers the same.
   */
  async copyAnnotations(
    docId: DocId,
    page: number,
    indices: readonly number[],
    version: DocVersion,
  ): Promise<CopyAnnotationsOutcome> {
    const { version: ranAt, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      try {
        return await this.#annotationCopy(docId, sessions, page, indices);
      } catch (thrown) {
        // A HANDLE PAST THE WALK answers `undefined`, which is the one way this lane can produce no
        // value — so it and a version mismatch meet in the same `stale` below.
        if (!(thrown instanceof RangeError)) throw thrown;
        return undefined;
      }
    });
    if (value === undefined || ranAt !== version) return { kind: 'stale' };
    const copied = value.copyable.filter(Boolean).length;
    // THE CLIPBOARD IS LEFT ALONE when nothing was copyable, rather than emptied: a person who
    // tries to copy a stamp this build does not exchange has not asked to lose what they copied
    // a moment ago.
    if (copied === 0) return { kind: 'nothing-copyable' };
    this.#clipboard = { json: value.json, from: { docId, page } };
    return { kind: 'copied', copied, skipped: value.copyable.length - copied };
  }

  /**
   * One mark's own words, whole, for an editor whose listing was cut.
   *
   * {@link copyAnnotations}' version rule and its reason: the handle is a position in the walk read at `version`, so
   * the read happens inside the lane and the lane's version is compared afterwards; a moved document or a handle past
   * the walk answers `stale` rather than another mark's words.
   */
  async annotationWords(docId: DocId, page: number, index: number, version: DocVersion): Promise<AnnotationWordsOutcome> {
    const { version: ranAt, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      try {
        return await this.#annotationWords(docId, sessions, page, index);
      } catch (thrown) {
        if (!(thrown instanceof RangeError)) throw thrown;
        return undefined;
      }
    });
    if (value === undefined || ranAt !== version) return { kind: 'stale' };
    return { kind: 'words', text: value.text, whole: value.whole };
  }

  /**
   * One link's whole address, for a person who asked to follow it (ADR-0167 Decision 3).
   *
   * {@link annotationWords}' version rule and its reason: the place is a position in the page's links at `version`,
   * so the read happens inside the lane and the lane's version is compared afterwards; a moved document answers
   * `stale` rather than another link's address.
   */
  async linkAddress(docId: DocId, page: number, index: number, version: DocVersion): Promise<LinkAddressOutcome> {
    const { version: ranAt, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      return this.#linkAddress(docId, sessions, page, index);
    });
    return ranAt === version ? value : { kind: 'stale' };
  }

  /**
   * Pastes the clipboard onto one page of a document — `importAnnotations`, minted here.
   *
   * The importer's own command with `onPage` set, never a second writer: the kernel moves every
   * record to that page and nudges it where it is the page it came from. {@link importAnnotations}'
   * catch and its reason, because a paste can be refused by exactly the apply that refuses a file.
   */
  async pasteAnnotations(docId: DocId, page: number): Promise<PasteAnnotationsOutcome> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'paste annotations');
    }
    const held = this.#clipboard;
    if (held === null) return { kind: 'empty' };
    try {
      const applied = await this.execute(docId, {
        kind: 'importAnnotations',
        format: 'json',
        bytes: new TextEncoder().encode(held.json),
        // NUDGED ONLY BACK ONTO ITS OWN PAGE OF ITS OWN DOCUMENT, which only this object can tell.
        paste: { page, nudge: held.from.docId === docId && held.from.page === page },
      });
      return { kind: 'pasted', ...applied };
    } catch (error) {
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) throw error;
      if (error instanceof DocumentNotOpenError) throw error;
      return { kind: 'refused' };
    }
  }

  /**
   * Writes each group of pages to its own document in a directory the user
   * picks.
   *
   * ## `extract` repeated, and the differences are all in the naming
   *
   * The build and the write are the same two steps; what a split adds is that
   * this build chooses the filenames, because the user chose a folder. So the
   * contested check runs over every derived path BEFORE the first is written —
   * `writeDocumentSplit` does that — and the operation refuses having touched
   * nothing.
   *
   * ## The names are derived from the SOURCE and the pages
   *
   * `<stem> 1-3.pdf` rather than `<stem> 1.pdf`, `<stem> 2.pdf`: a reader
   * looking at the folder afterwards wants to know which pages are in which
   * file, and a sequence number tells them only the order the split ran in.
   * One-page groups get `<stem> 4.pdf`, because `4-4` reads as a mistake.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   * reason.
   */
  async split(
    docId: DocId,
    /** The ranges a person wrote, or one file for each page of a set (JOURNAL, *No document-size refusals*). */
    split: { readonly groups: readonly PageSet[] } | { readonly each: PageSet },
  ): Promise<FolderOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'split');

    const directory = await this.#directory();
    if (directory === null) return undefined;

    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // THE GROUPS LISTED AGAINST THIS VERSION'S PAGE COUNT, inside the lane, by the one expander: a page past the
      // document is refused before any file is named. `each` is one file per page of its set.
      const { pageCount } = await this.#geometry(docId, sessions, []);
      const groups =
        'each' in split
          ? pagesOf(split.each, pageCount).map((page) => [page])
          : split.groups.map((group) => pagesOf(group, pageCount));

      return await writeDocumentSplit(
        this.#save.deps,
        this.#copy.checkTarget,
        (pages) => this.#extract(docId, sessions, pageSetOf(pages)),
        groups.map((pages) => ({
          destination: join(directory, splitPartName(suggest, pages)),
          pages,
        })),
      );
    });

    return inFolder(value, directory);
  }

  /**
   * Writes the document's text to a plain-text file the user picks — D10's
   * *text extraction*, its plain half.
   *
   * ## The text is STREAMED, one page at a time, and that is ADR-0035
   *
   * *"`main` never holds a document's extracted text, transiently or otherwise"*:
   * a document's text is 3.59× its bytes against `main`'s 1.5× budget, and the
   * budget is a peak. So each page is read, encoded and handed to the file before
   * the next is read — {@link #textChunks} is a generator, and
   * `writeStreamedDocument` pulls from it as it writes — so what is resident is
   * bounded by the largest page, which is the ADR's own bound.
   *
   * ## One extraction path
   *
   * `#pageText` is the read search, the text layer and word count already make,
   * and `plainTextOf` is the substrate's own rendering of it. A second path is
   * Part E2's K.0 regression and BUILD-PROMPT's *text extraction ×3*.
   *
   * ## The LANE is held for the whole document, `split`'s choice
   *
   * The pages come from one version. Releasing the lane between pages would let
   * a command land mid-export and write a file whose pages describe two documents.
   *
   * ## It does NOT touch the document
   *
   * No command, no log entry, no version bump, and no `DocumentContext`.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   *   reason.
   */
  async exportText(docId: DocId, mode: 'plain' | 'layout', pages: PageSet): Promise<ExportTextOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export text');

    // UNAVAILABLE BEFORE THE DIALOG: a person asked to pick a file for an export
    // that cannot run would be asked a question whose answer changes nothing.
    const layoutText = this.#layoutText;
    if (mode === 'layout' && layoutText === null) return { kind: 'unavailable' };

    const destination = await this.#pickText(suggest);
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (): Promise<ExportTextOutcome> => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // THE CHOSEN PAGES (ADR-0161), listed against this version before any file is written.
      const { pageCount } = await this.#geometry(docId, sessions, []);
      const chosen = pagesOf(pages, pageCount);

      // `open` is called only once the destination is known to be free, so a
      // contested file reads no page and runs no converter.
      const open =
        mode === 'plain' || layoutText === null
          ? (): Promise<AsyncIterable<Uint8Array>> => Promise.resolve(this.#textChunks(docId, sessions, chosen))
          : // THE SAVE'S OWN FLUSH, `saveCopy`'s reason: the converter reads what
            // this document currently is, and a copy, a save and a layout export
            // cannot disagree about that (B3a).
            async (): Promise<AsyncIterable<Uint8Array>> =>
              await layoutText(await this.#save.flush(docId, sessions), chosen);

      try {
        return await writeStreamedDocument(this.#save.deps, this.#copy.checkTarget, open, destination);
      } catch (thrown) {
        if (thrown instanceof LayoutTextFailedError) return { kind: 'failed', detail: thrown.message };
        throw thrown;
      }
    });

    return value;
  }

  /**
   * Writes the document as PDF/A-2b to a file the user picks — D10's *PDF/A-2b export*,
   * Ghostscript's `pdfwrite` in a contained process (ADR-0075).
   *
   * ## `exportText`'s layout path with a PDF where the text was
   *
   * Unavailable before the dialog; the picker; the lane; the save's own flush handed to
   * the converter once the destination is known to be free; the output streamed to the
   * file. What the conversion removed comes back with the outcome, because Ghostscript's
   * exit code does not say (ADR-0075 reading 5).
   *
   * It does NOT touch the document.
   */
  async exportPdfa(docId: DocId): Promise<ExportPdfaOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export PDF/A');

    const pdfa = this.#pdfa;
    if (pdfa === null) return { kind: 'unavailable' };

    const destination = await this.#copy.pick(suggest);
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (): Promise<ExportPdfaOutcome> => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      let removed: readonly string[] = [];
      let tagsDropped = false;
      try {
        const outcome = await writeStreamedDocument(
          this.#save.deps,
          this.#copy.checkTarget,
          async () => {
            // TAGS ARE READ BEFORE CONVERTING, because Ghostscript drops the structure
            // tree and does not say so: measured 2026-09-17, 4 of 4 tagged corpus
            // documents lost it under the export's own arguments.
            tagsDropped = await this.#anyPageTagged(docId, sessions);
            const converted = await pdfa(await this.#save.flush(docId, sessions));
            removed = converted.removed;
            return converted.output;
          },
          destination,
        );
        return outcome.kind === 'copied' ? { kind: 'copied', bytes: outcome.bytes, removed, tagsDropped, destination } : outcome;
      } catch (thrown) {
        if (thrown instanceof PdfaFailedError) return { kind: 'failed' };
        throw thrown;
      }
    });

    return value;
  }

  /**
   * What an optimized copy at `setting` would weigh, against the document's bytes now
   * (ADR-0087). Keeps nothing: the copy is discarded once its size is read.
   *
   * `before` is the size of the bytes a save would write — `flush`'s — not of the file on disk,
   * because those are what is rewritten, and a document edited since it was opened would
   * otherwise be compared with a file that no longer describes it.
   */
  async optimizeMeasure(docId: DocId, setting: OptimizeSetting): Promise<OptimizeMeasurement> {
    if (this.#documents.nameOf(docId) === undefined) throw new DocumentNotOpenError(docId, 'optimize');
    const optimizer = this.#optimizer;
    if (optimizer === null) return { kind: 'unavailable' };

    const { value } = await this.#documents.run(docId, async (context): Promise<OptimizeMeasurement> => {
      const pdf = await this.#currentBytes(docId);
      const copy = await optimizer(pdf, setting, this.#engine.opensWith(docId));
      if (copy.kind !== 'optimized') return copy;
      await copy.discard();
      return { kind: 'measured', version: context.version, before: pdf.length, after: copy.bytes };
    });
    return value;
  }

  /**
   * Writes an optimized copy at `setting`, rewriting again, when the document is still at the
   * `version` it was measured at and the copy is smaller (ADR-0087 Decision 1).
   *
   * ## The version is checked twice, and the size once more
   *
   * Before the picker, so a document that moved since the sizes were shown asks for no file; and
   * inside the lane, because it can move while the save dialog is open. The size is compared
   * again on the copy this call made, because that copy is the one written — a measurement is
   * about the bytes it was taken of, and *a result larger than the input is never saved* is a
   * rule about what is written.
   *
   * It does NOT touch the document: no command, no log entry, no version bump.
   */
  async optimize(docId: DocId, setting: OptimizeSetting, version: DocVersion): Promise<OptimizeOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'optimize');
    const optimizer = this.#optimizer;
    if (optimizer === null) return { kind: 'unavailable' };

    const moved = await this.#documents.run(docId, (context) => Promise.resolve(context.version !== version));
    if (moved.value) return { kind: 'changed' };

    const destination = await this.#copy.pick(suggest);
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context): Promise<OptimizeOutcome> => {
      if (context.version !== version) return { kind: 'changed' };
      const pdf = await this.#currentBytes(docId);
      const copy = await optimizer(pdf, setting, this.#engine.opensWith(docId));
      if (copy.kind !== 'optimized') return copy;
      // DISCARDED WHATEVER HAPPENS, not only on the not-smaller branch: a contested destination
      // answers before the stream is opened, and a copy of the person's document would otherwise
      // stay in a directory a contained process can read. `discard` is idempotent.
      try {
        if (copy.bytes >= pdf.length) return { kind: 'not-smaller', before: pdf.length, after: copy.bytes };
        const outcome = await writeStreamedDocument(
          this.#save.deps,
          this.#copy.checkTarget,
          () => Promise.resolve(copy.output),
          destination,
        );
        return outcome.kind === 'copied' ? { kind: 'copied', bytes: outcome.bytes, before: pdf.length, destination } : outcome;
      } finally {
        await copy.discard();
      }
    });
    return value;
  }

  /**
   * The bytes a save would write now, inside a lane the caller already holds: the poisoned and
   * missing-session checks every export makes, then `flush`.
   */
  async #currentBytes(docId: DocId): Promise<Uint8Array> {
    const failures = this.#engine.poisoned(docId);
    if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
    const sessions = this.#engine.sessions(docId);
    if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
    return this.#save.flush(docId, sessions);
  }

  /**
   * Whether any page carries tagged structure, by the structure read ADR-0065 owns —
   * stopping at the first that does, so a tagged document pays for one page.
   */
  async #anyPageTagged(docId: DocId, sessions: DocumentSessions): Promise<boolean> {
    const { pageCount } = await this.#geometry(docId, sessions, []);
    for (let page = 0; page < pageCount; page += 1) {
      if ((await this.#pageStructure(docId, sessions, page)).nodes.length > 0) return true;
    }
    return false;
  }

  /**
   * Writes the document as a Word file — D10's *Word (rich / layout / text)*,
   * written by this build over `fflate` (ADR-0072), with the page's pictures.
   *
   * ## A copy's path with the host as the producer
   *
   * `saveCopy`'s order: the destination is checked first, so a contested file
   * composes nothing; the MuPDF host then composes the package into its output
   * directory, drawing the pictures where the page is; and the atomic write moves
   * it into place. `main` never reads it — composed here, every picture would
   * cross the pipe only to be zipped (ADR-0072's amendment of 2026-10-01).
   *
   * It does NOT touch the document: no command, no log entry, no version bump.
   */
  async exportWord(docId: DocId, mode: WordMode, pages: PageSet): Promise<CopyOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export to Word');

    const destination = await this.#pickOffice(suggest, 'docx');
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // LISTED AGAINST THIS VERSION, `exportPageImages`' rule: a page past the document is refused before any file
      // is written. The host walks the same set (ADR-0161).
      const { pageCount } = await this.#geometry(docId, sessions, []);
      pagesOf(pages, pageCount);

      return await writeDocumentCopy(
        this.#save.deps,
        this.#copy.checkTarget,
        // Called only once the destination is free, so a contested file composes nothing.
        () => this.#word(docId, sessions, mode, pages),
        destination,
        backupsFor(context),
      );
    });

    return value;
  }

  /**
   * Writes the document as a PowerPoint deck — one slide per page, each slide the
   * page as MuPDF's export rasteriser draws it (ADR-0072).
   *
   * `exportWord`'s path with pictures where the text was: the page-image read the
   * image export already makes, one page at a time as the zip pulls it, so `main`
   * holds one page's picture. It does NOT touch the document.
   */
  async exportPowerPoint(docId: DocId, pages: PageSet, mode: PowerPointMode): Promise<PowerPointOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export to PowerPoint');

    const destination = await this.#pickOffice(suggest, 'pptx');
    if (destination === null) return undefined;

    // FILLED AS THE ZIP PULLS PAGES and read once the write has finished (ADR-0210): which pages could not be written editable.
    const report = emptyReport();
    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeStreamedDocument(
        this.#save.deps,
        this.#copy.checkTarget,
        async () => {
          // THE CHOSEN PAGES (ADR-0161), listed against this version; the deck takes the first chosen page's size.
          const { pageCount } = await this.#geometry(docId, sessions, []);
          const chosen = pagesOf(pages, pageCount);
          const [lead] = chosen;
          const first =
            lead === undefined
              ? { width: 612, height: 792 }
              : ((await this.#geometry(docId, sessions, [lead])).sizes[0] ?? { width: 612, height: 792 });
          // EXACT LOOK IS TODAY'S EXPORT, byte for byte: the same pages and no option (ADR-0210).
          if (mode === 'exact') {
            return ooxmlPackage(presentationParts(this.#slidePages(docId, sessions, chosen), first, chosen.length));
          }
          return ooxmlPackage(
            presentationParts(
              editablePages(chosen, slideSize(first), this.#editableSources(docId, sessions), report),
              first,
              chosen.length,
              { editable: true },
            ),
          );
        },
        destination,
      );
    });

    return value.kind === 'copied' ? { ...value, fellBack: report.fellBack } : value;
  }

  /** What one editable page asks of the engines (ADR-0210), bound to this document's sessions. */
  #editableSources(docId: DocId, sessions: DocumentSessions): EditableSources {
    const sizeOf = async (page: number): Promise<{ readonly width: number; readonly height: number }> => {
      const [size] = (await this.#geometry(docId, sessions, [page])).sizes;
      if (size === undefined) throw new Error(`the geometry read named no size for page ${String(page)}`);
      return size;
    };
    return {
      sizeOf,
      content: (page) => this.#presentation.content(docId, sessions, page),
      render: (page, width, height, withoutText) => this.#presentation.render(docId, sessions, page, width, height, withoutText),
      pagePicture: async (page) =>
        await this.#pageImage(docId, sessions, {
          page,
          format: 'png',
          scale: pictureScale(await sizeOf(page)),
          quality: 90,
        }),
    };
  }

  /**
   * Writes the tables MuPDF finds as an Excel workbook — D10's *Excel*, the
   * automatic engine: the page's text as it is (ADR-0072, ADR-0073).
   *
   * ## Asked BEFORE a file is picked
   *
   * A workbook of no tables is not an export of anything, so the pages are read
   * until one holds a table, and a document with none answers `no-tables` without
   * opening a picker — saying how many pages are pictures with no text, which is the case where
   * recognising them first is the remedy. A document whose first page holds a table
   * pays for one page.
   *
   * Then `exportWord`'s path: the picker, the lane, and the table read again a page
   * at a time as the zip pulls it, so `main` holds one page's tables. The first
   * pass keeps nothing — holding what it read to write it later is the document's
   * text in `main`, which ADR-0035 forbids. It does NOT touch the document.
   *
   * ## The review's edits are checked in the same first pass
   *
   * They correct the tables read at `review.version`. A document at another version,
   * or an edit naming a cell its page does not have — or one longer than the grid
   * showed — answers `changed` before any picker, and the write checks the version
   * again, since the document can move while the save dialog is open.
   */
  async exportExcel(
    docId: DocId,
    layout: SheetLayout,
    review: ExcelReview,
    engine: (typeof TABLE_ENGINES)[number] = 'automatic',
  ): Promise<ExcelOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export to Excel');
    if (engine !== 'automatic') {
      return this.#exportExcelThroughService(docId, suggest, layout, review.version, engine, review.pages);
    }

    const byPage = new Map<number, TableEdit[]>();
    for (const { page, ...edit } of review.edits) byPage.set(page, [...(byPage.get(page) ?? []), edit]);

    const { value: found } = await this.#documents.run(docId, async (context) => {
      if (context.version !== review.version) return { kind: 'changed' as const };
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const { pageCount } = await this.#geometry(docId, sessions, []);
      for (const [page, edits] of byPage) {
        if (page >= pageCount) return { kind: 'changed' as const };
        const { tables } = await this.#pageTables(docId, sessions, page);
        if (!editsFit(tables, edits, MAX_TABLE_CELL_TEXT)) return { kind: 'changed' as const };
      }
      let picturePages = 0;
      // THE CHOSEN PAGES only (ADR-0161): a table on a page not chosen is not one this export writes.
      for (const page of pagesOf(review.pages, pageCount)) {
        const tables = await this.#pageTables(docId, sessions, page);
        if (tables.tables.length > 0) return { kind: 'found' as const };
        // A PICTURE AND NO TEXT, not merely no text: a blank page is not one that
        // recognising would give a table to.
        if (tables.lines === 0 && tables.images > 0) picturePages += 1;
      }
      return { kind: 'no-tables' as const, picturePages };
    });
    if (found.kind !== 'found') return found;

    const destination = await this.#pickOffice(suggest, 'xlsx');
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context) => {
      if (context.version !== review.version) return { kind: 'changed' as const };
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      return await writeStreamedDocument(
        this.#save.deps,
        this.#copy.checkTarget,
        () => Promise.resolve(ooxmlPackage(spreadsheetParts(this.#tablePages(docId, sessions, byPage, review.pages), layout))),
        destination,
      );
    });

    return value;
  }

  /**
   * The Excel export through a SERVICE that reads each page's raster (ADR-0086).
   *
   * ## The file is picked FIRST, and that is the one difference in order from the automatic engine
   *
   * The automatic engine reads every page before any picker to answer *no tables* early, because
   * reading is free. Here each page is a request to a service a person pays for, and the tables
   * cannot be held to write later — the document's text in `main` is what ADR-0035 forbids — so
   * the pages are read AS the workbook streams, after the destination is known. A document with
   * no table answers `no-tables` after the picker, with nothing written: the stream fails and
   * `atomicWrite` removes its temporary file.
   *
   * ## A refusal names its page, and writes nothing
   *
   * The first page a service does not read stops the export, as `service-refused` with the page,
   * the reason and main's sentence. Nothing after it is sent.
   */
  async #exportExcelThroughService(
    docId: DocId,
    suggest: string,
    layout: SheetLayout,
    version: DocVersion,
    engine: NetworkTableEngine,
    pages: PageSet,
  ): Promise<ExcelOutcome | undefined> {
    const current = await this.#documents.run(docId, (context) => Promise.resolve(context.version));
    if (current.value !== version) return { kind: 'changed' };

    const destination = await this.#pickOffice(suggest, 'xlsx');
    if (destination === null) return undefined;

    const { value } = await this.#documents.run(docId, async (context): Promise<ExcelOutcome | undefined> => {
      if (context.version !== version) return { kind: 'changed' };
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // THE READ IS REPORTED AND CAN BE STOPPED while it runs (ADR-0202 Decision 5): two small facts kept in a map main owns,
      // dropped when the export ends however it ends, so a later export of the same document starts from nothing.
      this.#reading.set(docId, { done: 0, total: pagesOf(pages, (await this.#geometry(docId, sessions, [])).pageCount).length, stop: false });
      try {
        return await writeStreamedDocument(
          this.#save.deps,
          this.#copy.checkTarget,
          () => Promise.resolve(ooxmlPackage(spreadsheetParts(this.#servicePages(docId, sessions, engine, pages), layout))),
          destination,
        );
      } catch (thrown) {
        if (thrown instanceof NoTablesToWrite) return { kind: 'no-tables', picturePages: 0 };
        if (thrown instanceof PageRefused) return serviceRefusal(engine, thrown.page, thrown.original);
        // A STOPPED READ WRITES NOTHING: the temporary file is already removed, and the person asked, so it is a cancelled
        // picker's answer (`undefined`) and not a fault.
        if (thrown instanceof ExportCancelled) return undefined;
        throw thrown;
      } finally {
        this.#reading.delete(docId);
      }
    });
    return value;
  }

  /**
   * How far a service-read export has got, for the renderer's polling (ADR-0202 Decision 5). Not in the lane, which the
   * export holds: a count that waited for it would answer when there was nothing left to count.
   */
  exportProgress(docId: DocId): { readonly kind: 'idle' } | { readonly kind: 'reading'; readonly done: number; readonly total: number } {
    const reading = this.#reading.get(docId);
    return reading === undefined ? { kind: 'idle' } : { kind: 'reading', done: reading.done, total: reading.total };
  }

  /**
   * Asks the service-read export of this document to stop after the page it is on. `false` says none was reading — the
   * cancel raced the end — which is an answer. Not in the lane, for {@link exportProgress}' reason.
   */
  cancelExport(docId: DocId): boolean {
    const reading = this.#reading.get(docId);
    if (reading === undefined) return false;
    reading.stop = true;
    return true;
  }

  /** Each page's tables as the service reads them, one request per page, as the zip pulls them. */
  async *#servicePages(
    docId: DocId,
    sessions: DocumentSessions,
    engine: NetworkTableEngine,
    pages: PageSet,
  ): AsyncIterable<SpreadsheetPage> {
    const { pageCount } = await this.#geometry(docId, sessions, []);
    for (const page of pagesOf(pages, pageCount)) {
      // CHECKED BETWEEN PAGES, before a request is paid for: a stop the person asked for costs at most the page in hand.
      const reading = this.#reading.get(docId);
      if (reading?.stop === true) throw new ExportCancelled();
      let tables: readonly RecognisedTable[];
      try {
        tables = await this.#networkTables(docId, sessions, page, engine);
      } catch (thrown) {
        throw new PageRefused(page, thrown);
      }
      if (reading !== undefined) reading.done += 1;
      yield { page, tables, edits: [] };
    }
  }

  /** Each page's tables with its edits, read as the zip pulls them. */
  async *#tablePages(
    docId: DocId,
    sessions: DocumentSessions,
    edits: ReadonlyMap<number, readonly TableEdit[]>,
    pages: PageSet,
  ): AsyncIterable<SpreadsheetPage> {
    const { pageCount } = await this.#geometry(docId, sessions, []);
    for (const page of pagesOf(pages, pageCount)) {
      yield { page, tables: (await this.#pageTables(docId, sessions, page)).tables, edits: edits.get(page) ?? [] };
    }
  }

  /**
   * One page's tables for the review grid — each cell's text, at most
   * `MAX_TABLE_CELLS` cells and `MAX_TABLE_CELL_TEXT` characters a cell, with the
   * document's page count so the grid can move between pages.
   *
   * One page, for ADR-0035's reason; in the lane, for `searchPage`'s.
   */
  async pageTables(
    docId: DocId,
    page: number,
  ): Promise<ReviewGrid & { readonly version: DocVersion; readonly pageCount: number }> {
    const { version, value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      const { pageCount } = await this.#geometry(docId, sessions, []);
      if (page >= pageCount) return { pageCount, tables: [], truncated: false };
      const { tables } = await this.#pageTables(docId, sessions, page);
      return { pageCount, ...reviewGridOf(tables, MAX_TABLE_CELLS, MAX_TABLE_CELL_TEXT) };
    });
    return { version, ...value };
  }

  /**
   * Emails the document — D10's *email document*: its current bytes offered to the
   * Windows Share sheet as a file named as the document is, where the person picks the
   * mail application (ADR-0080, the owner's route).
   *
   * ## The bytes are the SAVE'S flush, taken inside the lane
   *
   * `docusignSend`'s reason: what is attached is exactly what a save would write now
   * (B3a), and an edit mid-share cannot be half of each. The sheet opens outside the
   * lane — it waits on a person.
   *
   * ## `offered` says the sheet opened, not that anything was sent
   *
   * What the person does in the sheet is theirs and the operating system's; nothing
   * comes back to this build, so no answer here claims an email.
   *
   * It does NOT touch the document.
   */
  async email(docId: DocId): Promise<EmailOutcome> {
    const fileName = this.#documents.nameOf(docId);
    if (fileName === undefined) throw new DocumentNotOpenError(docId, 'email');
    if (this.#share === null) return { kind: 'unavailable' };

    const { value: bytes } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      return await this.#save.flush(docId, sessions);
    });

    try {
      await this.#share.offer({ title: shareTitle(fileName), files: [{ fileName, bytes }] });
      return { kind: 'offered' };
    } catch (thrown) {
      if (thrown instanceof ShareFailedError) return { kind: 'failed' };
      throw thrown;
    }
  }

  /**
   * Prints the document — D10's *print*: MuPDF's raster of each page the person
   * chooses in the system print dialog, at `dpi`, drawn onto the printer they chose
   * (ADR-0074). Never the DOM.
   *
   * ## The dialog is outside the lane, the pages inside it
   *
   * The dialog waits on a person, and a lane held across that would stall every
   * other command on the document. The page count it is shown is read first; the
   * pages are rasterised and drawn in the lane, one at a time, so `main` holds one
   * page's picture — and a document that lost pages meanwhile is refused by the
   * engine by page number rather than printed from a stale count.
   *
   * ## A raster past the print's pixel budget is drawn at a lower scale
   *
   * `rasterScale`'s rule, the slide picture's: the DPI asked for, or less where a
   * large page would pass {@link PRINT_PIXELS}, never below the engine's floor.
   *
   * It does NOT touch the document.
   */
  async print(docId: DocId, dpi: PrintDpi, pages: PageSet): Promise<PrintOutcome | undefined> {
    const name = this.#documents.nameOf(docId);
    if (name === undefined) throw new DocumentNotOpenError(docId, 'print');
    if (this.#print === null) return { kind: 'unavailable' };

    const { value: listed } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');
      const { pageCount } = await this.#geometry(docId, sessions, []);
      // THE ROW'S PAGES, listed against this version: where the system dialog's own *Pages* starts (ADR-0161).
      return { pageCount, start: pagesOf(pages, pageCount) };
    });

    const choice = this.#print.choose(listed.pageCount, listed.start);
    if (choice === null) return undefined;
    try {
      const { value } = await this.#documents.run(docId, async (): Promise<PrintOutcome> => {
        const failures = this.#engine.poisoned(docId);
        if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);
        const sessions = this.#engine.sessions(docId);
        if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

        let job;
        try {
          job = choice.start(name);
        } catch (thrown) {
          if (thrown instanceof PrintFailedError) return { kind: 'failed' };
          throw thrown;
        }
        try {
          for (const page of choice.pages) {
            const [size] = (await this.#geometry(docId, sessions, [page])).sizes;
            if (size === undefined) throw new Error(`the geometry read named no size for page ${String(page)}`);
            const png = await this.#pageImage(docId, sessions, {
              page,
              format: 'png',
              scale: rasterScale(size, dpi, PRINT_PIXELS),
              quality: 90,
            });
            job.page(png);
          }
          job.finish();
        } catch (thrown) {
          // ABANDONED, so the printer receives no half a document.
          job.abort();
          if (thrown instanceof PrintFailedError) return { kind: 'failed' };
          throw thrown;
        }
        return { kind: 'printed', pages: choice.pages.length };
      });
      return value;
    } finally {
      choice.release();
    }
  }

  /** Each chosen page as a slide picture, rendered as the zip pulls it. */
  async *#slidePages(docId: DocId, sessions: DocumentSessions, chosen: readonly number[]): AsyncIterable<PresentationPage> {
    for (const page of chosen) {
      const [size] = (await this.#geometry(docId, sessions, [page])).sizes;
      if (size === undefined) throw new Error(`the geometry read named no size for page ${String(page)}`);
      const png = await this.#pageImage(docId, sessions, {
        page,
        format: 'png',
        scale: pictureScale(size),
        quality: 90,
      });
      yield { png, size };
    }
  }

  /**
   * The document's text as UTF-8, one chunk per page.
   *
   * **A FORM FEED between pages**, `pdftotext`'s convention, so a reader can find
   * page boundaries in a file that otherwise has none. No byte-order mark: UTF-8
   * needs none, and one is a stray character at the head of the file for every
   * tool that reads it as text.
   *
   * The pages are the caller's, listed against the document's count by `pagesOf`, so a page past the document is
   * refused before any is read.
   */
  async *#textChunks(docId: DocId, sessions: DocumentSessions, chosen: readonly number[]): AsyncIterable<Uint8Array> {
    const encoder = new TextEncoder();
    // THE CHOSEN PAGES (ADR-0161), a form feed between each and the next, so the file's pages are the ones chosen.
    for (const [at, page] of chosen.entries()) {
      const text = plainTextOf(await this.#pageText(docId, sessions, page));
      yield encoder.encode(at === 0 ? text : `\f${text}`);
    }
  }

  /**
   * Writes each named page as an image file in a folder the user picks.
   *
   * ## `split`'s body, with an image where a document was
   *
   * One file per page in a folder, with names this build derives — so the
   * contested check runs over every derived path before the first is written,
   * which is `writeDocumentSplit`'s whole contract, and each page is rasterised
   * and written before the next is rasterised, which is its other one. A part is
   * a single page; the extract it is handed is the host's page image.
   *
   * ## It does NOT touch the document
   *
   * An export is a picture of pages. No command, no log entry, no version bump,
   * and `writeDocumentSplit` is given no `DocumentContext`.
   *
   * @throws `DocumentNotOpenError` before any dialog appears, for `saveCopy`'s
   *   reason.
   */
  async exportPageImages(
    docId: DocId,
    request: {
      /** A page set: *every page* of a document of any length is one run (JOURNAL, *No document-size refusals*). */
      readonly pages: PageSet;
      readonly format: PageImageFormat;
      readonly dpi: number;
      readonly quality: number;
    },
  ): Promise<FolderOutcome | undefined> {
    const suggest = this.#documents.nameOf(docId);
    if (suggest === undefined) throw new DocumentNotOpenError(docId, 'export pages as images');

    const directory = await this.#directory();
    if (directory === null) return undefined;

    const { value } = await this.#documents.run(docId, async () => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // LISTED AGAINST THIS VERSION, `split`'s rule: a page past the document is refused before any file is named.
      const { pageCount } = await this.#geometry(docId, sessions, []);
      const pages = pagesOf(request.pages, pageCount);

      return await writeDocumentSplit(
        this.#save.deps,
        this.#copy.checkTarget,
        (pages) => {
          const [page] = pages;
          // NOT REACHABLE: every part below is built with exactly one page, and
          // the type cannot say so. A file named after no page is refused rather
          // than written.
          if (page === undefined) throw new RangeError('a page image part named no page');
          return this.#pageImage(docId, sessions, {
            page,
            format: request.format,
            // A PDF point is 1/72 inch, and the host's bounds are in points.
            scale: request.dpi / 72,
            quality: request.quality,
          });
        },
        pages.map((page) => ({
          destination: join(directory, pageImageName(suggest, page, request.format)),
          pages: [page],
        })),
      );
    });

    return inFolder(value, directory);
  }

  /**
   * Inserts an image as a new page, from a file the user picks.
   *
   * ## THE PICKER RUNS BEFORE THE LANE, exactly as `saveCopy`'s does
   *
   * A dialog can be up for as long as a person takes, and holding a document's
   * lane for that would block every other operation on it — including the ones
   * a user reaches for while deciding. The document may close while the dialog
   * is up, and that is fine: `execute` refuses a closed document, so the
   * outcome is the same refusal it would have been before the dialog appeared.
   *
   * ## The bytes exist in this process and cross nothing
   *
   * The renderer asked with two numbers. Main picks, reads, and mints the
   * command here — so the image is in exactly one process, and
   * `renderableCommandSchema` makes the alternative unrepresentable rather than
   * merely unused.
   *
   * ## The media type comes from the EXTENSION, and that is routing not validation
   *
   * It chooses which pdf-lib decoder runs. Whether the bytes are what the
   * extension claims is decided by that decoder failing, which arrives here as
   * a thrown error and leaves as `unreadable` — `documentPicker.ts`' rule that
   * a filter is a hint to a human, applied one layer along.
   */
  async insertImage(docId: DocId, at: number): Promise<InsertImageOutcome> {
    // READ BEFORE THE DIALOG, so a document that is not open is refused before
    // a person is asked to choose a file — `saveCopy`'s ordering and its reason.
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'insert an image');
    }

    const picked = await this.#image.pick();
    if (picked === null) return { kind: 'cancelled' };

    const mediaType = imageMediaType(picked);
    // AN EXTENSION THIS BUILD HAS NO DECODER FOR IS `unreadable`, decided before
    // the read rather than after: the filter is a hint, so a user may reach here
    // with a `.gif`, and loading it to discover that costs the memory the bound
    // above exists to refuse.
    if (mediaType === null) return { kind: 'unreadable' };

    const read = await this.#image.read(picked);
    if (read.kind === 'too-large') return { kind: 'too-large', limitBytes: MAX_IMAGE_BYTES };
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    try {
      const applied = await this.execute(docId, {
        kind: 'insertImagePage',
        at,
        bytes: read.bytes,
        mediaType,
      });
      return { kind: 'inserted', ...applied };
    } catch (error) {
      // A DECODER REFUSING IS AN OUTCOME, and only that one. Every other failure
      // — a poisoned document, a missing session — is a class the handler
      // already turns into a declared code, so widening this catch would turn
      // those into `unreadable` and tell the user their picture was the problem.
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) {
        throw error;
      }
      if (error instanceof DocumentNotOpenError) throw error;
      // A PNG PAST THE PIXEL BOUND is its own outcome, and refused before `embedPng`
      // runs in this process: *too many pixels* names a thing a person can change,
      // where *unreadable* would blame a picture that is perfectly valid.
      if (error instanceof PngPixelsRefused && error.reason === 'too-many-pixels') {
        return { kind: 'too-many-pixels', limitPixels: MAX_IMPORT_IMAGE_PIXELS };
      }
      return { kind: 'unreadable' };
    }
  }

  /**
   * Composes a file the person picks — Markdown or CSV — as a new PDF, in the compose
   * host, and writes it where they choose
   * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
   *
   * ## It answers a PATH, and the path does not cross
   *
   * Both import routes open what this writes through the one route a document is
   * opened by, which the handler holds — so this ends at the file on disk, and
   * `written` carries the destination for the handler alone.
   *
   * ## Refused BEFORE the picker where nothing can compose
   *
   * `null` means no compose host can exist on this installation, and a person asked
   * to choose a file for an import that cannot happen would choose it for nothing.
   * The source is never parsed in `main` instead: threat model §2 keeps parsing of
   * any kind out of it.
   *
   * ## `target`, for append
   *
   * Checked before the picker for `insertImage`'s reason. Nothing is merged here —
   * the composed document is opened as a tab first (ADR-0060's correction) — so the
   * check is only that the person is not asked to pick a file for a document that
   * has already closed.
   *
   * ## US Letter
   *
   * The geometry main reads carries rotations and a page count, not page sizes, so
   * there is no size of the target to set a composition at. A reader for sizes is a
   * row of its own; until then both routes compose at US Letter, and the row says so.
   */
  async composeImportFile(format: ImportFormat, target?: DocId): Promise<ComposeImportOutcome> {
    if (target !== undefined && this.#documents.nameOf(target) === undefined) {
      throw new DocumentNotOpenError(target, `append an imported ${format} file`);
    }
    const compose = this.#compose;
    if (compose === null) {
      throw new EngineUnavailableError(format === 'csv' ? 'Importing CSV' : 'Importing Markdown');
    }

    const source = this.#imports[format];
    const picked = await source.pick();
    if (picked === null) return { kind: 'cancelled' };

    const read = await source.read(picked);
    if (read.kind === 'too-large') {
      return { kind: 'too-large', limitBytes: IMPORT_BYTE_LIMITS[format] };
    }
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    const composed = await compose(format, read.bytes, COMPOSED_PAGE);
    if (composed.kind === 'refused') {
      return { kind: 'composition-refused', reason: composed.reason, line: composed.line, file: null };
    }
    return this.#writeComposed(composed, picked);
  }

  /**
   * Makes a new PDF with one page per image the person picks, in the compose host, and
   * writes it where they choose.
   *
   * {@link composeImportFile}'s shape and its reasons — refused before the picker where
   * nothing can compose, a path answered and never crossing — over a list of files.
   *
   * ## Every bound this process can decide is decided before ANY file is read
   *
   * The count, each file's decoder, each file's size and the set's size are all known
   * from the list and a `stat`, so a set that breaks one is refused with no picked byte
   * in memory. What only the bytes can say — a PNG's pixel count, whether a decoder
   * takes the file — is the compose host's, because reading it is parsing.
   *
   * ## A refusal names the FILE
   *
   * The host answers a position in the list it was sent; this method sent that list,
   * so it is where a position becomes the name the person knows the file by.
   */
  async composeImageFiles(): Promise<ImageImportOutcome> {
    const compose = this.#composeImages;
    if (compose === null) throw new EngineUnavailableError('Importing images');

    const picked = await this.#imageFiles.pick();
    if (picked === null || picked.length === 0) return { kind: 'cancelled' };
    if (picked.length > MAX_IMPORT_IMAGES) return { kind: 'too-many-images', limit: MAX_IMPORT_IMAGES };

    const ordered = [...picked].sort((one, other) =>
      IMAGE_PAGE_ORDER.compare(fileNameOf(one), fileNameOf(other)),
    );

    const items: ComposeImageItem[] = [];
    let totalBytes = 0;
    for (const path of ordered) {
      // `insertImage`'s routing, decided before any read for its reason.
      const mediaType = imageMediaType(path);
      if (mediaType === null) {
        return { kind: 'composition-refused', reason: 'image-unreadable', line: null, file: fileNameOf(path) };
      }
      const size = await this.#imageFiles.size(path);
      if (size === null) return { kind: 'unreadable' };
      if (size > MAX_IMAGE_BYTES) return { kind: 'too-large', limitBytes: MAX_IMAGE_BYTES };
      totalBytes += size;
      if (totalBytes > MAX_IMPORT_IMAGE_BYTES) {
        return { kind: 'images-too-large', limitBytes: MAX_IMPORT_IMAGE_BYTES };
      }
      items.push({ mediaType, read: () => this.#imageFiles.read(path) });
    }

    const composed = await compose(items);
    if (composed.kind === 'unreadable') return { kind: 'unreadable' };
    if (composed.kind === 'refused') {
      let file: string | null = null;
      if (composed.item !== null) {
        const named = ordered[composed.item - 1];
        // A POSITION PAST THE LIST IS THE HOST CONTRADICTING WHAT IT WAS SENT, not a
        // fact about a person's file, so it is thrown rather than told to them.
        if (named === undefined) {
          throw new Error(
            `the compose host refused image ${String(composed.item)} of ${String(ordered.length)} sent`,
          );
        }
        file = fileNameOf(named);
      }
      return { kind: 'composition-refused', reason: composed.reason, line: composed.line, file };
    }

    // `ordered` is not empty: an empty pick answered `cancelled` above.
    return this.#writeComposed(composed, ordered[0] ?? 'images');
  }

  /**
   * Makes a new PDF from pictures taken with the camera, in the compose host, and writes
   * it where the person chooses.
   *
   * {@link composeImageFiles}' route from the composition on: the frames go to the same
   * binding as picked JPEGs, so `main` writes them into the area and never decodes one.
   * Their bounds were the channel's schema, so nothing is counted here. A refusal names
   * no file, because a frame has no name the person knows it by.
   */
  async composeCapturedFrames(frames: readonly Uint8Array[]): Promise<ComposeImportOutcome> {
    const compose = this.#composeImages;
    if (compose === null) throw new EngineUnavailableError('Making a PDF from the camera');

    const composed = await compose(
      frames.map((bytes) => ({
        mediaType: 'image/jpeg' as const,
        read: () => Promise.resolve({ kind: 'read' as const, bytes }),
      })),
    );
    if (composed.kind === 'unreadable') return { kind: 'unreadable' };
    if (composed.kind === 'refused') {
      return { kind: 'composition-refused', reason: composed.reason, line: composed.line, file: null };
    }
    return this.#writeComposed(composed, 'camera.jpg');
  }

  /**
   * Converts a Word, Excel or PowerPoint file the person picks to a PDF with the contained `x2t`,
   * and writes it where they choose ([ADR-0120](../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
   *
   * {@link composeImportFile}'s shape: refused before the picker where nothing can convert, the
   * file bounded before its read, and a path answered that never crosses.
   *
   * ## Converted BEFORE the save dialog
   *
   * A file x2t cannot read is told to the person without asking them to name a PDF that will not
   * exist. The converted PDF waits in the converter's own area and streams to the destination, so
   * `main` holds one read buffer of it — and a dialog cancelled, or a destination refused before
   * the stream is read, removes that area unread.
   */
  async convertOfficeFile(): Promise<OfficeImportOutcome> {
    const office = this.#officeImport;
    if (office === null) throw new EngineUnavailableError('Importing Office files');

    const picked = await office.source.pick();
    if (picked === null) return { kind: 'cancelled' };
    // THE DIALOG'S FILTER IS NOT A CHECK: a typed name reaches here with any extension, and the
    // extension is what names x2t's input.
    const format = officeImportFormatOf(picked);
    if (format === null) return { kind: 'unreadable' };

    const read = await office.source.read(picked);
    if (read.kind === 'too-large') return { kind: 'too-large', limitBytes: MAX_OFFICE_IMPORT_BYTES };
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    let converted: OfficeConversion;
    try {
      converted = await office.convert(format, read.bytes);
    } catch (error) {
      // ONLY THE CONVERTER'S REFUSAL IS AN ANSWER — `openFromUrl`'s rule. The reason is in the shell log.
      if (error instanceof OfficeConversionFailedError) return { kind: 'conversion-failed' };
      throw error;
    }

    try {
      const destination = await this.#copy.pick(suggestedComposedName(picked));
      if (destination === null) return { kind: 'cancelled' };
      const written = await writeStreamedDocument(
        this.#save.deps,
        this.#copy.checkTarget,
        () => Promise.resolve(converted.output),
        destination,
      );
      if (written.kind === 'refused') return { kind: 'destination-contested', openElsewhere: written.others.length };
      if (written.kind === 'write-failed') return { kind: 'write-failed' };
      return { kind: 'written', destination, missing: converted.missing };
    } finally {
      // A STREAM READ TO ITS END HAS REMOVED THE AREA ALREADY; every other path has not.
      converted.discard();
    }
  }

  /**
   * Fetches a PDF from a URL a person gave, through the SSRF guard, and writes it where
   * they choose ([ADR-0061](../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
   *
   * ## The address is judged BEFORE the save dialog
   *
   * A scheme, a credential or a blocked literal host is refused from the text alone, and
   * a person asked to choose a file name for an address that could never be fetched
   * would choose it for nothing. What only the network can say — a name's resolution, a
   * redirect, the body — is the guard's, once a destination is known to be free.
   *
   * ## The body never sits whole in `main`
   *
   * `writeStreamedDocument` streams it through the save pipeline's temporary file, and
   * a refusal met while it arrives removes that file and leaves the destination as it
   * was. It answers a path, which only the handler opens.
   */
  async openFromUrl(url: string): Promise<UrlOpenOutcome> {
    let checked: URL;
    try {
      checked = checkedUrl(url);
    } catch (error) {
      if (error instanceof UrlFetchRefused) return { kind: 'url-refused', reason: error.reason };
      throw error;
    }

    const destination = await this.#copy.pick(suggestedUrlName(checked));
    if (destination === null) return { kind: 'cancelled' };

    try {
      const written = await writeStreamedDocument(
        this.#save.deps,
        this.#copy.checkTarget,
        () => this.#fetchUrl(checked.href),
        destination,
      );
      if (written.kind === 'refused') {
        return { kind: 'destination-contested', openElsewhere: written.others.length };
      }
      if (written.kind === 'write-failed') return { kind: 'write-failed' };
      return { kind: 'written', destination };
    } catch (error) {
      // ONLY THE GUARD'S REFUSAL IS AN ANSWER. Anything else is a defect in this build
      // and propagates, rather than telling a person their address was the problem.
      if (error instanceof UrlFetchRefused) return { kind: 'url-refused', reason: error.reason };
      throw error;
    }
  }

  /**
   * Asks where a composed PDF goes and writes it there.
   *
   * One tail for every import, because where a composition is written and which
   * destinations are refused are one decision whatever the source was.
   */
  async #writeComposed(
    { pdf, boxed, more }: Extract<ComposedImport, { readonly kind: 'composed' }>,
    picked: string,
  ): Promise<ComposeImportOutcome> {
    const destination = await this.#copy.pick(suggestedComposedName(picked));
    if (destination === null) return { kind: 'cancelled' };

    // NO LANE: no open document is read or changed. The contested-destination check
    // is the copy's own, so a destination another open document holds is refused
    // exactly as a copy onto it would be.
    const written = await writeDocumentCopy(
      this.#save.deps,
      this.#copy.checkTarget,
      () => Promise.resolve(stagedBytes(pdf)),
      destination,
      // A NEW DOCUMENT, composed from a picked file: no open document's removal can be pending in it.
      'keep',
    );
    if (written.kind === 'refused') {
      return { kind: 'destination-contested', openElsewhere: written.others.length };
    }
    if (written.kind === 'write-failed') return { kind: 'write-failed' };
    return { kind: 'written', destination, boxed, more };
  }

  /**
   * Places a picked image on pages, as a `/Stamp` the user can then move.
   *
   * {@link insertImage}' shape and, for the most part, its reasons: the ask
   * carries no bytes, the picker runs here, and `renderableCommandSchema`
   * withholds the command so the renderer cannot express one.
   *
   * **Two differences, and both are the row rather than the plumbing.**
   *
   * The media type is not read from the extension, because MuPDF's `Image`
   * decodes by reading the bytes and a second answer here would be the weaker
   * of two (B3a). So a file this build cannot decode arrives as a throw from
   * the engine and leaves as `unreadable`, where `insertImage` can answer that
   * before the read — this one pays the read to find out, which is what the
   * bound above is for.
   *
   * And the pages are a list: stamping ten is one decision, one log entry and
   * one undo.
   */
  async placeImage(
    docId: DocId,
    /**
     * ONE NAMED REQUEST, every field required — `picture` included, as `string | undefined` — so a delegate that
     * forwards this cannot drop the library's id and compile (ADR-0069's lesson: a function ignoring a trailing
     * argument is assignable to one that passes it). `picture` names a kept stamp; `undefined` opens the picker.
     */
    request: {
      /** A page set: *every page* is one run (JOURNAL, *No document-size refusals*). */
      readonly pages: PageSet;
      readonly rect: AnnotationRect;
      readonly stamp: AnnotationStamp;
      readonly picture: string | undefined;
    },
  ): Promise<PlaceImageOutcome> {
    const { pages, rect, stamp, picture } = request;
    // READ BEFORE THE DIALOG, `insertImage`'s ordering and its reason.
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'place an image');
    }

    let bytes: Uint8Array;
    if (picture === undefined) {
      const picked = await this.#image.pick();
      if (picked === null) return { kind: 'cancelled' };

      const read = await this.#image.read(picked);
      if (read.kind === 'too-large') return { kind: 'too-large', limitBytes: MAX_IMAGE_BYTES };
      if (read.kind === 'unreadable') return { kind: 'unreadable' };
      bytes = read.bytes;
    } else {
      // A KEPT PICTURE, read from the library rather than picked: it was checked and bounded when it was kept.
      const kept = this.#library.picture(picture);
      if (kept === null) return { kind: 'absent' };
      bytes = kept.bytes;
    }

    try {
      const applied = await this.execute(docId, { kind: 'placeImage', pages, rect, bytes, stamp });
      return { kind: 'placed', ...applied };
    } catch (error) {
      // `insertImage`'s catch and its reason: a decoder refusing is an outcome,
      // and every other failure is a class the handler already turns into a
      // declared code. A page index the document does not have and a rectangle
      // off the page throw from the apply and arrive here as `unreadable`,
      // which would be a lie — but neither is reachable from the surface that
      // sends this, because the tool draws the rectangle on a page it is
      // displaying. The day something else sends one, that is a second outcome
      // rather than a widened catch.
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) {
        throw error;
      }
      if (error instanceof DocumentNotOpenError) throw error;
      return { kind: 'unreadable' };
    }
  }

  /**
   * Signs the document with a certificate the user picks.
   *
   * `placeImage`'s shape and its ordering — the document is checked before the
   * dialog opens, so a closed document does not put a picker on screen.
   *
   * ## Two outcomes for what is sometimes one failure, stated rather than hidden
   *
   * A PKCS#12's MAC check fails the same way for a wrong passphrase and for a
   * truncated file, so the two cannot always be told apart. The rule is which
   * stage failed: a **read** that could not produce bytes is `unreadable`, and
   * anything the signer refuses afterwards is `wrong-passphrase`. That is the
   * honest split — the first is a file the user picked wrongly and the second
   * is a credential they typed wrongly — and it is why the catch does not try
   * to read the engine's message.
   *
   * ## The bytes and the passphrase end with this frame
   *
   * Both are locals. Nothing on this class holds either, and the command's own
   * payload is the only place they exist, for the length of one `execute`: the
   * entry the bus records for a `stored-result` command keeps its kind and the
   * signed file, and has no field a credential could be put in (ADR-0162). Until
   * 2026-10-04 this said `CommandPrior['signDocument']` being `never` was why,
   * which named the inverse and not the entry, and the entry kept the command
   * whole (CR-SEC-19).
   */
  async sign(
    docId: DocId,
    options: {
      readonly passphrase: string;
      readonly name?: string;
      readonly reason?: string;
      readonly location?: string;
      readonly contactInfo?: string;
      readonly certify?: 'no-changes' | 'form-fill' | 'form-fill-and-annotate';
      readonly appearance?: SignaturePlacement & { readonly mark: RequestedSignatureMark };
      /** The timestamp authority, by id; absent signs without a timestamp (ADR-0058). */
      readonly timestamp?: TimestampAuthority;
    },
  ): Promise<SignOutcome> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'sign');
    }

    // THE PICTURE BEFORE THE CERTIFICATE, and the order is a decision: a person
    // who chose *use a picture of my signature* meets that dialog first, and one
    // who cancels it — or picks a file this build cannot read — is never asked
    // for a credential they would then have typed for nothing.
    const appearance = await this.#appearanceFor(options.appearance);
    if (appearance.kind !== 'ready') return appearance;

    const picked = await this.#certificate.pick();
    if (picked === null) return { kind: 'cancelled' };

    const read = await this.#certificate.read(picked);
    if (read.kind === 'unreadable') return { kind: 'unreadable' };

    try {
      const applied = await this.execute(docId, {
        kind: 'signDocument',
        bytes: read.bytes,
        passphrase: options.passphrase,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.location === undefined ? {} : { location: options.location }),
        ...(options.contactInfo === undefined ? {} : { contactInfo: options.contactInfo }),
        ...(options.certify === undefined ? {} : { certify: options.certify }),
        ...(appearance.value === undefined ? {} : { appearance: appearance.value }),
        ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
      });
      return { kind: 'signed', ...applied };
    } catch (error) {
      // EVERY OUTCOME HERE IS CHOSEN BY THE CLASS THAT WAS THROWN, never by
      // elimination. This catch used to end in *anything else is a wrong
      // password*, and measured it was not: a harness whose flush refused
      // reached that line and answered `wrong-passphrase` for a document that
      // never got as far as the signer. The kernel names the credential's
      // refusal and the appearance's where each happens; anything else is not a
      // person's mistake, and propagates to the handler, which turns an
      // unmapped class into `internal` with the diagnostic kept main-side.
      // THE APPEARANCE'S ONE REFUSAL is a picture its decoder would not read: a typed name arrives as its outline, so
      // which characters it can draw was answered in the renderer (ADR-0150).
      if (error instanceof SignatureAppearanceRefusedError) return { kind: 'image-unreadable' };
      // A SIGNATURE PICTURE PAST THE PIXEL BOUND, refused before `embedPng` decodes it
      // in the MuPDF host, which answers it under its own code so it arrives here as
      // this class (ADR-0148). `image-too-large` is the sentence a picture past the
      // byte bound already gets, and both mean *choose a smaller picture*.
      if (error instanceof PngPixelsRefused && error.reason === 'too-many-pixels') {
        return { kind: 'image-too-large' };
      }
      if (error instanceof SignatureCredentialRefusedError) return { kind: 'wrong-passphrase' };
      if (error instanceof SignatureTooLargeError) return { kind: 'signature-too-large' };
      // A PROTECTED DOCUMENT, refused by the host before anything is written (ADR-0220): the sentence says what to do about
      // the password, where it used to be an incident id.
      if (error instanceof SignatureProtectedDocumentError) return { kind: 'document-protected' };
      // THE AUTHORITY'S FAILURES, three sentences rather than one: unreachable is
      // *try again or choose another*, refused is *that service will not do this*,
      // and unverifiable is *it answered with something this build would not
      // embed*. Folding them would tell a person to retry a service that refused.
      if (error instanceof TimestampUnreachableError) return { kind: 'timestamp-unreachable' };
      if (error instanceof TimestampRefusedError) {
        return {
          kind: error.reason === 'refused' ? 'timestamp-refused' : 'timestamp-unverifiable',
        };
      }
      throw error;
    }
  }

  /**
   * The command's appearance, with a picked picture attached — or why not. {@link #markFor}'s answer, placed.
   */
  async #appearanceFor(
    requested: (SignaturePlacement & { readonly mark: RequestedSignatureMark }) | undefined,
  ): Promise<
    | {
        readonly kind: 'ready';
        readonly value: CommandOfKind<'signDocument'>['appearance'];
      }
    | NoSignatureMark
  > {
    if (requested === undefined) return { kind: 'ready', value: undefined };
    const { mark, page, rect } = requested;
    const resolved = await this.#markFor(mark);
    if (resolved.kind !== 'ready') return resolved;
    return { kind: 'ready', value: { page, rect, mark: resolved.mark } };
  }

  /**
   * A requested signature look as a command carries it — **the one resolver for both routes** (ADR-0133 Decision 3):
   * *Sign with certificate* and the plain *Signature* ask the same question and take this answer.
   *
   * **A picture picked at the click is `pickSignaturePicture`'s**, the resolver `signature.pickPicture` takes too
   * (B3a): a PNG or a JPEG typed by its bytes, or a scanned PDF made a picture in the compose host — so what *Sign with
   * certificate* places from a file is what the Signature dialog would have previewed from it.
   */
  async #markFor(mark: RequestedSignatureMark): Promise<
    | {
        readonly kind: 'ready';
        readonly mark: NonNullable<CommandOfKind<'signDocument'>['appearance']>['mark'];
        readonly picked: string | undefined;
      }
    | NoSignatureMark
  > {
    if (mark.kind === 'saved') {
      // A KEPT SIGNATURE, looked up by id: a typed or drawn one is its own look, and a picture's bytes come from the
      // library — so a kept picture never travels to the page and back. Gone since the dialog opened is its own
      // refusal rather than a picture that would not decode.
      const entry = this.#library.lookup(mark.id);
      if (entry?.kind !== 'signature') return { kind: 'saved-signature-missing' };
      // A KEPT TYPED NAME IS NEVER NAMED BY ITS ID: main holds its name and face and no outline to draw, so the renderer
      // sends it as the outline it makes (ADR-0150). Reaching here is the renderer's defect, not a person's doing, and
      // the handler answers it as `internal`.
      if (entry.look.kind === 'typed') {
        throw new Error('a kept typed signature is placed by its outline, which the renderer makes, never by its id');
      }
      if (entry.look.kind === 'drawn') return { kind: 'ready', mark: entry.look, picked: undefined };
      const kept = this.#library.picture(mark.id);
      if (kept === null) return { kind: 'saved-signature-missing' };
      return { kind: 'ready', mark: { kind: 'image', bytes: kept.bytes, mediaType: kept.mediaType }, picked: undefined };
    }
    if (mark.kind !== 'image') return { kind: 'ready', mark, picked: undefined };
    if (mark.picked !== undefined) {
      // THE PICTURE THE DIALOG PREVIEWED: its held bytes, never a fresh read of its path and never a picker in its place
      // — a handle not held (another pick replaced it, or it was placed) is a signature no longer there.
      const held = this.#heldPicture.held(mark.picked);
      if (held === undefined) return { kind: 'saved-signature-missing' };
      return { kind: 'ready', mark: { kind: 'image', bytes: held.bytes, mediaType: held.mediaType }, picked: held.name };
    }

    const picked = await pickSignaturePicture(this.#signaturePicture);
    switch (picked.kind) {
      case 'picture':
        return { kind: 'ready', mark: { kind: 'image', bytes: picked.bytes, mediaType: picked.mediaType }, picked: picked.name };
      case 'unreadable':
        return { kind: 'image-unreadable' };
      case 'too-large':
        return { kind: 'image-too-large' };
      case 'cancelled':
      case 'scan-blank':
      case 'scan-locked':
        return { kind: picked.kind };
    }
  }

  /**
   * Places a plain signature, with no certificate, and keeps it when asked (ADR-0133).
   *
   * The look is resolved by {@link #markFor}, as a certificate signature's is, so a kept look and a picked picture mean
   * exactly what they mean there. A typed name arrives as its outline (ADR-0150), so whether its face can draw it was
   * answered in the renderer, where the person can still change it, and nothing here asks again.
   *
   * ## Keeping comes after the mark is on the page
   *
   * A placement the engine refused keeps nothing. A typed mark is kept as its name and face, its outline being derived
   * (`keptLookOf`), and a drawn one as it was made; a picked picture as a
   * signature picture, with the bytes this call already read — bounded by the library's own bound, which is smaller than
   * a placed picture's, so a larger one is placed and answered `not-keepable`. A full library is a placed mark that was
   * not kept, never a refused placement.
   */
  async placeSignature(
    docId: DocId,
    request: {
      readonly page: number;
      readonly rect: AnnotationRect;
      readonly mark: RequestedSignatureMark;
      readonly keep: boolean;
      readonly stamp: AnnotationStamp;
    },
  ): Promise<PlaceSignatureOutcome> {
    if (this.#documents.nameOf(docId) === undefined) {
      throw new DocumentNotOpenError(docId, 'place a signature');
    }
    const resolved = await this.#markFor(request.mark);
    if (resolved.kind === 'cancelled') return { kind: 'cancelled' };
    if (resolved.kind === 'image-unreadable') return { kind: 'unreadable' };
    if (resolved.kind === 'image-too-large') return { kind: 'too-large', limitBytes: MAX_IMAGE_BYTES };
    if (resolved.kind === 'saved-signature-missing') return { kind: 'absent' };
    if (resolved.kind === 'scan-blank' || resolved.kind === 'scan-locked') return { kind: resolved.kind };

    const { page, rect, stamp } = request;
    const { mark } = resolved;
    let applied: Applied;
    try {
      applied = await this.execute(
        docId,
        mark.kind === 'image'
          ? { kind: 'placeSignaturePicture', page, rect, bytes: mark.bytes, mediaType: mark.mediaType, stamp }
          : // A DRAWING IS FITTED TO THE HOST'S FRAME HERE, by the contract's one fitting (`placedMarkOf`): thinned if it is
            // longer than a frame carries, never refused (finding DDDDDDD-1).
            { kind: 'placeSignatureMark', page, rect, mark: placedMarkOf(mark), stamp },
      );
    } catch (error) {
      // `placeImage`'s catch and its reason, for a PICTURE only: the decoder refusing the picked bytes is an outcome.
      // A typed or drawn mark has no such outcome left — its one refusal was answered above — so anything thrown for
      // one propagates and the handler turns it into a declared code.
      if (mark.kind !== 'image') throw error;
      if (error instanceof DocumentPoisonedError || error instanceof MissingSessionError) throw error;
      if (error instanceof DocumentNotOpenError) throw error;
      return { kind: 'unreadable' };
    }
    // PLACED, so the previewed picture has done its one job: released, and the bytes resident in main go with it.
    if (request.mark.kind === 'image' && request.mark.picked !== undefined) this.#heldPicture.release(request.mark.picked);

    if (!request.keep || request.mark.kind === 'saved') return { kind: 'placed', ...applied, kept: 'not-asked' };
    if (mark.kind !== 'image') {
      const kept = this.#library.keepSignature(keptLookOf(mark));
      return { kind: 'placed', ...applied, kept: kept.kind === 'added' ? 'kept' : 'library-full' };
    }
    if (mark.bytes.byteLength > MAX_LIBRARY_PICTURE_BYTES || resolved.picked === undefined) {
      return { kind: 'placed', ...applied, kept: 'not-keepable' };
    }
    const kept = this.#library.addPicture('signature', resolved.picked, mark.bytes);
    return {
      kind: 'placed',
      ...applied,
      kept: kept.kind === 'added' ? 'kept' : kept.kind === 'full' ? 'library-full' : 'not-keepable',
    };
  }

  /**
   * Saves the document to its own file.
   *
   * **A save that would break a signature is ASKED, not written** (Part F's *warn before signature-breaking save*):
   * unless the request says the person agreed, the writer is asked first whether its next save keeps the document's
   * signatures — the same decision that save then takes (`signaturesKeptBySave`) — and a *no* answers
   * `breaks-signatures` with nothing written. In the lane, so no command can land between the question and the write.
   */
  async save(docId: DocId, request: { readonly breakSignatures: boolean }): Promise<SaveRequestOutcome> {
    return (await this.#saveThen(docId, request, false)).outcome;
  }

  /**
   * Saves as {@link save} does and, where the save landed, answers the document's image TAKEN IN THE SAME LANE ENTRY:
   * what a cloud save-back uploads (CR-DOC-04). Taken as a second lane entry it was whatever the document held when
   * that entry ran, so a command landing between the two was uploaded under the version the save answered.
   */
  async saveAndTake(
    docId: DocId,
    request: { readonly breakSignatures: boolean },
  ): Promise<{ readonly outcome: SaveRequestOutcome; readonly image: Uint8Array | null }> {
    return this.#saveThen(docId, request, true);
  }

  async #saveThen(
    docId: DocId,
    request: { readonly breakSignatures: boolean },
    take: boolean,
  ): Promise<{ readonly outcome: SaveRequestOutcome; readonly image: Uint8Array | null }> {
    // LISTS AND NOT NULLABLE LOCALS: the lane writes them from a closure, which control-flow analysis cannot see.
    const removalSavedAt: string[] = [];
    const taken: Uint8Array[] = [];
    const { value } = await this.#documents.run(docId, async (context): Promise<SaveRequestOutcome> => {
      const failures = this.#engine.poisoned(docId);
      if (failures !== undefined) throw new DocumentPoisonedError(docId, failures);

      const sessions = this.#engine.sessions(docId);
      if (sessions === undefined) throw new MissingSessionError(docId, 'mupdf');

      // THE WRITER'S OWN DECISION about its signatures, asked once.
      const session = sessions.mupdf;
      if (session === undefined) throw new MissingSessionError(docId, 'mupdf');
      const next = await this.#signaturesKept(session);
      // ASKED ONCE PER DOCUMENT: a person who answered *edit this document* before a breaking edit has given this
      // document's signatures up, and its save would otherwise ask the same question again (ADR-0149 Decision 6).
      if (!request.breakSignatures && !next.kept && !context.signaturesBreakAgreed) {
        return { kind: 'breaks-signatures', signatures: next.signatures };
      }

      // THE DOCUMENT'S FACT, read before the save clears it: whether a removal ran since the file was written
      // (ADR-0139). Never the engine session's mark, which an undo's restore, an adopt or a host restart drops — the
      // route by which a redaction's save backed up the unredacted file in 0.1.9.0.
      const removal = context.removedSinceSave;
      // STAGED, so the document's bytes go from the host to the temporary file and never through `main`
      // (ADR-0121's addendum).
      const saved = await saveDocument(
        this.#save.deps,
        context,
        () => this.#save.stage(docId, sessions),
        backupsFor(context),
      );
      // WHY IT WAS NOT WRITTEN, asked of the file now, inside the lane, so the person is told the remedy that fits.
      if (saved.kind === 'write-failed') {
        return { ...saved, cause: saveWriteCause(saved.failure, await this.#documents.fileAccess(docId)) };
      }
      if (saved.kind !== 'saved') return saved;
      // THE COPY THIS SAVE MADE, wherever `atomicWrite` left it: the newest backup, or the copy-aside where moving it into
      // the backups was refused, which is still a copy of the person's document a removal's save must find (QQQQQQQ-8).
      if (saved.previousKeptAt !== null) await this.#save.provenance.made(saved.previousKeptAt);
      // THE FOLDER'S HINT (ADR-0198): the identity of the file just written, so a file moved outside Monstera can still be
      // matched to its versions. Best effort — a note that cannot be written loses a hint, never a backup.
      if (this.#backups !== undefined && saved.previousKeptAt !== null) {
        const store = this.#backups;
        const identity = await store.identity?.(context.path).catch(() => null);
        await writeBackupNote(store.root, context.path, { dev: identity?.dev ?? null, ino: identity?.ino ?? null }).catch(() => undefined);
      }
      // A REMOVAL'S SAVE has just tried each copy, so what it could not delete is its answer; any other save tries the
      // copies this document still owes again, which is what keeps a held copy from being kept for ever.
      let outcome: SaveRequestOutcome;
      if (removal) {
        const cleared = await this.#clearCopies(context);
        await this.#renewSessions(docId, context.path, saved.bytes);
        removalSavedAt.push(context.path);
        outcome = { ...saved, cleared: cleared.copies, held: cleared.held };
      } else {
        outcome = { ...saved, cleared: null, held: await this.#retryHeld(context) };
      }
      // THE IMAGE OF THE VERSION JUST SAVED, before this entry ends and the next command can run. From the sessions
      // as they are now: a removal's save has just renewed them from the file it wrote.
      if (take) taken.push(await this.#save.flush(docId, this.#engine.sessions(docId) ?? sessions));
      return outcome;
    });

    // THE RECENT PICTURE IS RETAKEN after the lane, which drawing page 1 needs (ADR-0164): the one kept at open shows
    // the page as it was. Not awaited, as at open: the save has answered, and a retake reports its own failure.
    for (const path of removalSavedAt) void this.#recentPicture.retake(docId, path);
    return { outcome: value, image: taken[0] ?? null };
  }

  /**
   * Rebuilds the document's engine sessions from the file a removal's save just wrote
   * ([ADR-0164](../../../docs/DECISIONS/0164-a-removals-save-also-renews-the-hosts-copy-and-the-recent-picture.md)):
   * a session is opened from a snapshot of the document as it was opened, and that file, beside the host, still held
   * what the removal took out. The new sessions are opened BEFORE the old pair is released, so a file that cannot be
   * opened leaves the document as it was rather than with no session.
   *
   * **A saved file that opens only with a password keeps the old session**, the renewal answering `locked`: protecting
   * a document is a removal, a document a password opened is saved encrypted, and the password is not kept
   * (ADR-0055). Its snapshot stays until the document closes, which ADR-0164's correction names as the case this
   * does not reach.
   */
  async #renewSessions(docId: DocId, path: string, bytes: number): Promise<void> {
    await this.#renew(docId, async (destination) => {
      await this.#save.deps.surface.copy(path, destination);
      return bytes;
    });
  }

  /**
   * Tries again to delete the older copies of this document that a save could not delete because another program held
   * them (CR-DOC-10), and answers the names of those still held. In the document's lane, so no save lands between.
   */
  async deleteHeldCopies(docId: DocId): Promise<readonly string[]> {
    const { value } = await this.#documents.run(docId, (context) => this.#retryHeld(context));
    return value;
  }

  /**
   * Replaces every plaintext copy of this document with one encrypted under `command`, before the protect answers
   * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8):
   * the host's snapshot, every checkpoint and result the history holds, and every backup beside the file that Monstera
   * made. The canonical image needs nothing here, since the protect draws. In the protect's own lane entry, so nothing
   * lands between. An encrypted copy is left as it was (`ProtectedCopies.seal`).
   *
   * **A copy that CANNOT be written now does not fail the protect**
   * ([ADR-0178](../../../docs/DECISIONS/0178-a-protect-that-applied-is-not-failed-by-a-copy-it-could-not-seal.md)):
   * the protect has already applied and been recorded by the time this runs, so a copy another program holds, or that
   * cannot be written, is the person's to be told of — not a reason to reject the command and report the applied
   * protect as failed. A thrown seal is mapped to `'unsealed'` at this boundary, where the throw happens; `seal`
   * answering `undefined` is a copy deliberately **left** (already encrypted) and is NOT named. The basenames of the
   * copies left unsealed come back for the renderer to name. The snapshot refresh is not one of these copies — it is
   * rewritten from the new canonical image main holds, with no external file to be held — so its failure is a host
   * fault that still throws.
   *
   * @returns the basenames of the copies this could not seal, empty when every copy was sealed or left encrypted.
   */
  async #sealPlaintextCopies(
    docId: DocId,
    context: DocumentContext,
    command: CommandOfKind<'setDocumentProtection'>,
  ): Promise<readonly string[]> {
    await this.#copies.refreshSnapshot(docId);
    // A SEAL THAT THROWS IS `'unsealed'`, never a thrown command: the copy another program holds is named, not fatal.
    const trySeal = async (path: string): Promise<number | undefined | 'unsealed'> => {
      try {
        return await this.#copies.seal(docId, path, command);
      } catch {
        return 'unsealed';
      }
    };
    const unsealed: string[] = [];
    const { unsealed: checkpoints } = await this.#bus.resealCopies(context, trySeal);
    for (const path of checkpoints) unsealed.push(basename(path));
    for (const path of copyNames(this.#save.deps.names(context.path))) {
      await this.#save.provenance.rewriteIfMade(path, async (made) => {
        const sealed = await trySeal(made);
        if (sealed === 'unsealed') unsealed.push(basename(path));
        // REWRITTEN is a number; LEFT (`undefined`) and UNSEALED are both "not rewritten" to the ledger, which records
        // a rewrite only. The unsealed one is named above; the left one is already encrypted and needs no record.
        return typeof sealed === 'number';
      });
    }
    return unsealed;
  }

  /** The owed copies among this document's backup names, tried again; the names still held. */
  async #retryHeld(context: DocumentContext): Promise<readonly string[]> {
    const mine = new Set(copyNames(this.#save.deps.names(context.path)));
    const owed = this.#save.provenance.owed().filter((path) => mine.has(path));
    if (owed.length === 0) return [];
    return (await this.#save.provenance.retryOwed(owed)).map((path) => basename(path));
  }

  /**
   * Deletes, PERMANENTLY and unasked, every older copy Monstera made that may still hold what a removal took out
   * ([ADR-0139](../../../docs/DECISIONS/0139-a-removals-save-deletes-the-backups-monstera-made.md)): each copy beside
   * the file — every name one can have, a backup kept or retired or the copy-aside (`copyNames`) — that the ledger shows
   * Monstera wrote and nothing has changed since, and every undo copy of the document with the history that needs them.
   * A file with one of those names that Monstera did not make is kept and named. One Monstera made that another program holds is **held**: owed a
   * deletion and named, never thrown past a save that has written (CR-DOC-10). In the save's own lane entry, so
   * nothing lands between.
   */
  async #clearCopies(context: DocumentContext): Promise<{ readonly copies: ClearedCopies; readonly held: readonly string[] }> {
    let backups = 0;
    const kept: string[] = [];
    const held: string[] = [];
    for (const path of copyNames(this.#save.deps.names(context.path))) {
      const outcome = await this.#save.provenance.deleteIfMade(path);
      if (outcome === 'deleted') backups += 1;
      else if (outcome === 'not-made') kept.push(basename(path));
      else if (outcome === 'held') held.push(basename(path));
    }
    const before = this.#bus.undoCopies(context);
    this.#bus.forgetUndoCopies(context);
    return { copies: { backups, undoCopies: before - this.#bus.undoCopies(context), kept }, held };
  }
}
