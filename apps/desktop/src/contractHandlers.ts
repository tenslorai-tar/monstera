import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  ANNOTATIONS_PART,
  DESTINATIONS_PART,
  FORM_FIELDS_PART,
  LAYERS_PART,
  PAGE_LINKS_PART,
  PAGE_OBJECTS_PART,
  TEXT_BLOCKS_PART,
  type AiModelListAnswer,
  type AiProviderId,
  CHAT_HISTORY_STORED,
  storedSetting,
  type AskAmong,
  type AskSent,
  type ASK_UNREAD_REASONS,
  askShareOf,
  CLOUD_PROVIDER_IDS,
  MAX_ASK_ATTACHMENTS,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_PICKED_DOCUMENTS,
  servesVision,
  MAX_LIBRARY_ENTRIES,
  MAX_IMAGE_BYTES,
  MAX_LIBRARY_PICTURE_BYTES,
  MAX_RASTER_BYTES,
  MAX_RASTER_PIXELS,
  MAX_EDIT_TEXT,
  MAX_TRANSLATED_TEXT,
  blockEditOf,
  MAX_SETTINGS_FILE_BYTES,
  RECENT_CHECK_CAP_MS,
  type RecentAvailability,
  SECRET_SETTING_IDS,
  TRANSLATION_LANGUAGES,
  type ChannelResult,
  type ContractHandlers,
  type DocumentAccess,
  type MainHandlers,
  type PreloadHandlers,
  type OcrLanguage,
  type SpellingLanguage,
  type StorePage,
  type WindowEditAction,
  isFollowable,
  shownSchemeOf,
  withTargetVersion,
} from '@monstera/contract';
import {
  type AiModelList,
  type AskManyDocument,
  type AskWindow,
  type ChatImage,
  askFilesInstruction,
  askInstruction,
  askManyInstruction,
  askPairInstruction,
  askPictureInstruction,
  type CapabilityRegistry,
  DocumentBusyError,
  DocumentNotOpenError,
  type DocumentService,
  EngineFormDataExportFailed,
  EngineAnnotationDataExportFailed,
  type IdentityReader,
  StaleTargetError,
  type WriteTargetVerdict,
  readDocumentRange,
  readTranslation,
  translationInstruction,
  translationRequest,
} from '@monstera/kernel';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, win32 } from 'node:path';

import { type DocId, type FileHandle, err, lineText, ok, paragraphsOfLines } from '@monstera/shared';

import { executeCommandHandler } from './commandHandlers.js';
import { editRefusalOf, rewriteRefusalOf } from './editRefusals.js';
import {
  type DocumentCommands,
  DocumentPoisonedError,
  EngineUnavailableError,
  type ImageSource,
  type PickImage,
  type ComposeImportOutcome,
  type ImportFormat,
  InvalidSearchPatternError,
  MissingSessionError,
  PageTooLargeToPicture,
} from './documentCommands.js';
import type { Assistant } from './assistant.js';
import { type AttachmentReaders, classifyAttachments, readAttachments, textSourcesIn } from './askAttachments.js';
import type { ChatHistory } from './chatHistory.js';
import type { CrashReports } from './crashReports.js';
import type { LaunchDocuments } from './launchDocuments.js';
import type { UpdateCheck } from './updateCheck.js';
import { CloudOutcomeRefused, type CloudStorage } from './cloudSession.js';
import { type KnownRoot, displayLocationOf } from './displayLocation.js';
import type { RecentPictures } from './recentPictures.js';
import type { HeldPicture } from './heldPicture.js';
import type { PersonalLibrary } from './personalLibrary.js';
import { type SignaturePictureSource, pickSignaturePicture } from './signaturePicture.js';
import type { ReviewPrompt } from './engagement.js';
import type { ComponentStatus } from './componentStatus.js';
import type { RecentFiles } from './recentFiles.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';
import type { DictionaryBytes } from './spellingDictionaries.js';
import type { WebPage } from './webPages.js';
import { toldBlocks } from './officeConversion.js';

/**
 * Where a document comes from, as a value this module can be handed.
 *
 * **Injected rather than imported**, for the reason the whole file is: nothing
 * here may import Electron, and `dialog.showOpenDialog` is Electron's. The real
 * one lives in the composition root; a test hands a function that returns a
 * path, and every case about *what happens with what was picked* becomes
 * decidable in milliseconds with no window.
 *
 * `null` is the user dismissing the picker — an outcome, not a failure.
 *
 * **It returns a PATH and this is the only place in the renderer's reach where
 * one appears.** That is invariant 1 working rather than being bypassed: the
 * path exists on main's side of the boundary, is turned into a `FileHandle`
 * three lines later, and the renderer's request that started all this carried
 * no parameters at all.
 */
export type PickDocument = () => Promise<string | null>;

/**
 * {@link PickDocument}'s several-files form: the same dialog with a multiple selection, answering every path chosen in
 * the order the dialog listed them, and an empty list for a dismissal. The paths stay on main's side exactly as
 * `PickDocument`'s does.
 */
export type PickDocuments = () => Promise<readonly string[]>;

// `PickDestination` is `PickDocument`'s mirror and lives in
// `documentCommands.ts`, NOT here, and the asymmetry is the module graph rather
// than a preference: this file imports `DocumentCommands`, so anything that
// file needs cannot come from here without a cycle. `PickDocument` is used by
// the open handler, which is this file; `PickDestination` is used by
// `CopySource`, which is that one. Each lives with its consumer.

/**
 * What happens the moment a document becomes open, before anything else can.
 *
 * ## Why the handler calls this rather than the service raising it
 *
 * `DocumentService` already has a teardown seam for the other end of a
 * document's life, and the symmetry is tempting. It is wrong here: giving a
 * session to a document needs a **contained host**, which is Win32 work in
 * `apps/desktop`, and `packages/kernel` may not reach it. A seam on the service
 * would either import that or take it as a second injected surface, and the
 * service would then own a lifetime it cannot fulfil.
 *
 * ## It returns nothing, and that is the ordering
 *
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9c queues the session's creation in the document's own lane before
 * it yields, so a command issued next sits behind it. A handler that awaited
 * the session would make every open as slow as a host build and would buy
 * nothing the lane does not already guarantee.
 */
/**
 * Gives a just-opened document its engine sessions, answering when that has
 * settled — sessioned or poisoned.
 *
 * A PROMISE, and most callers do not await it: a document opens whether or not an
 * engine is available. The caller that does is one about to use the document's
 * sessions next, such as a merge naming it as a source (ADR-0060's correction).
 */
export type OpenedDocument = (docId: DocId) => Promise<void>;

/**
 * One password attempt against an open document the supervisor recorded as
 * locked
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * An arrow rather than the supervisor itself, for {@link OpenedDocument}'s
 * reason: this module may not name `EngineSessions`, and the handler needs
 * exactly one call. What it deliberately cannot express is *unlock without a
 * password* and *read the password back*.
 */
export type UnlockDocument = (
  docId: DocId,
  password: string,
) => Promise<
  | { readonly kind: 'unlocked'; readonly access: DocumentAccess }
  | { readonly kind: 'wrong-password' }
  | { readonly kind: 'not-locked' }
>;

/**
 * What the application reports about itself.
 *
 * Both fields are **baked at build time** (E4) rather than detected at runtime.
 * `installChannel` decides which update provider is active and the Store build
 * must never self-update, so it is a property of the artifact: a value read at
 * runtime could differ between two launches of the same package, which is
 * exactly what an update decision must not do.
 */
export interface AppInfo {
  readonly version: string;
  readonly installChannel: 'store' | 'web' | 'development';
  /** The signed-in Windows user's name — `windowsUserName()` (ADR-0103). */
  readonly userName: string;
}

/** What `window.titleBarOverlay` carries, already validated: two `#rrggbb` colours and a whole-pixel height. */
export interface TitleBarOverlay {
  readonly color: string;
  readonly symbolColor: string;
  readonly height: number;
}

/**
 * The main-process side of the contract, assembled once and completely.
 *
 * ## Why this file exists, and the finding it closes
 *
 * `channels.ts` states the rule this discharges: *"A channel is added here only
 * when a real handler for it exists… a declared channel with nothing behind it
 * is a call that hangs, which is worse than a call that is absent."* That was
 * **false for `app.info` from the day it was declared** — its only
 * implementations were test fixtures and `contract.proof.mjs`, and no assembled
 * `ContractHandlers` existed anywhere. Recorded as audit finding CC-2; this is
 * the half of the fix that supplies the handler, and `registerHandlers.ts` is
 * the half that makes it reachable.
 *
 * ## Annotated, not inferred
 *
 * The return type is `ContractHandlers`, so **adding a channel to the registry
 * breaks this file until it is answered here.** That is the same mechanism the
 * browser shim relies on, on the other side of the boundary, and it is the whole
 * reason the four surfaces are derived rather than written: an unimplemented
 * channel is a compile error rather than a call that hangs at runtime.
 *
 * ## Dependencies are injected, so this is testable without Electron
 *
 * Nothing here imports Electron. `AppInfo` arrives as a value rather than being
 * read from `app.getVersion()`, which keeps the assembly unit-testable in
 * milliseconds and keeps the Electron import confined to the entry point that
 * genuinely needs it. The kernel boundary makes the same trade for the same
 * reason (§1).
 *
 * @param deps the document command bus, and what the app reports about itself
 */
export function createContractHandlers(deps: {
  readonly commands: DocumentCommands;
  /** The assistant, which holds the keys and pushes its answers (ADR-0081, ADR-0082). */
  readonly assistant: Assistant;
  readonly appInfo: AppInfo;
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  /** One password attempt against an open encrypted document (ADR-0055). */
  readonly unlockDocument: UnlockDocument;
  readonly pickDocument: PickDocument;
  /**
   * The Open dialog with a multiple selection. Optional: a harness that supplies only `pickDocument` is offered one
   * file at a time, which is what its one-file picker can answer — see {@link severalPickerOf}.
   */
  readonly pickDocuments?: PickDocuments;
  /** The recent-files list, which is also where the clean-exit marker lives. */
  readonly recent: RecentFiles;
  /**
   * The folders a recent file's location is named by (ADR-0100). REQUIRED, for `titleBarOverlay`'s reason:
   * an optional one defaulting to none would show every file as *under no known folder* and look correct.
   */
  readonly recentRoots: readonly KnownRoot[];
  /** The recent list's pictures of first pages (ADR-0100). REQUIRED, for `recentRoots`' reason. */
  readonly recentPictures: RecentPictures;
  /**
   * Whether a path names a file now: the kernel's `readFileIdentity`, the rule `DocumentService.open` answers `absent`
   * by, so a recent entry's `available` and an open of it cannot disagree (B3a,
   * [ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)).
   * REQUIRED, for `recentRoots`' reason: a default answering *there* would draw every missing file as one that opens.
   */
  readonly fileIdentity: IdentityReader;
  /**
   * The person's stamp and signature library, and how a picture reaches it: the image picker, a size taken before any
   * read, and the bounded read. REQUIRED, for `recentRoots`' reason.
   */
  readonly library: {
    readonly store: PersonalLibrary;
    readonly pick: PickImage;
    readonly size: (path: string) => Promise<number | null>;
    readonly read: ImageSource['read'];
    /** The plain Signature's previewed picture, the slot `DocumentCommands.placeSignature` places from. */
    readonly held: HeldPicture;
    /** Where Upload picks a signature picture from: a PNG, a JPEG or a scanned PDF. */
    readonly signaturePicture: SignaturePictureSource;
  };
  /** The Store rating prompt (E3). REQUIRED, for `recentRoots`' reason. */
  readonly reviewPrompt: ReviewPrompt;
  readonly settings: SettingsSurface;
  /**
   * Where a `secret` setting lives, which is not the settings file.
   *
   * Its own surface rather than a third method on `settings`, because the two
   * documents have different rules: one is read leniently and rewritten whole,
   * and one refuses to be written at all where the machine cannot encrypt.
   */
  readonly secrets: SecretStoreSurface;
  /** Saved assistant conversations (ADR-0093), encrypted with the secrets' cipher. */
  readonly chatHistory: ChatHistory;
  /** Where a settings export goes, or `null` when the person cancelled the picker. */
  readonly pickSettingsFile: () => Promise<string | null>;
  /** The settings file a person chose to import, or `null` when they cancelled the picker. */
  readonly openSettingsFile: () => Promise<string | null>;
  /**
   * Shows the diagnostics log.
   *
   * Takes no argument and answers a boolean, so nothing about *where* the log
   * is reaches this file — which is what keeps the handler unable to leak a
   * path even by accident (B5 over a rule at the call site).
   */
  readonly revealLog: () => Promise<boolean>;
  /**
   * Shows a path a write produced in the file manager — a file selected in its folder, a folder opened — answering
   * whether there was anything to show. `file.reveal` resolves the renderer's handle to the path; this does the
   * showing, at the boundary entitled to know Electron's `shell`.
   */
  readonly revealPath: (path: string) => Promise<boolean>;
  /**
   * The crash reports this computer keeps (ADR-0109). Named by a report's file NAME, never a path; `null` where the
   * shell has none to offer — a build with the setting off. Optional for the composition's `log` reason: a graph built
   * without a dumps folder, every unit test's, has no report to offer, and absent answers exactly that.
   */
  readonly crashReports?: CrashReports | null;
  /**
   * This start's update check (ADR-0110). Optional for `crashReports`' reason: a graph with no check has nothing to
   * report, and absent answers `none` — the channel with no provider behind it — and records nothing.
   */
  readonly updateCheck?: UpdateCheck;
  /**
   * The documents launches named on their command line, waiting for the page to ask (`launchDocuments.ts`). Optional
   * for `crashReports`' reason: a graph built without a launch — every unit test's — has none, and absent answers none.
   */
  readonly launchDocuments?: LaunchDocuments;
  /**
   * Reads a spelling dictionary's two files. `readSpellingDictionary`.
   *
   * Injected for the file's own reason: it resolves a package out of
   * `node_modules`, so a case that wanted to exercise the handler would
   * otherwise need the dependency installed and the real bytes on disk to say
   * anything about the shape of the answer.
   */
  readonly readDictionary: (language: SpellingLanguage) => Promise<DictionaryBytes | null>;
  /**
   * Which OCR models this machine has. `provisionedOcrLanguages`.
   *
   * Injected for {@link readDictionary}'s reason: it reads a directory the
   * launcher passed down, so a case about the handler's shape would otherwise
   * need a provisioned `.tools/` tree to say anything.
   */
  readonly ocrLanguages: () => Promise<readonly OcrLanguage[]>;
  /** The native components and their states (ADR-0122). `componentStatuses`, where the source is the resolver's. */
  readonly components: (verify: boolean) => Promise<readonly ComponentStatus[]>;
  /**
   * Paints the window controls over the title bar, answering whether a window took it.
   *
   * Injected for the file's reason — `setTitleBarOverlay` is Electron's — and REQUIRED, so an assembly that
   * forgot it is a compile error rather than a title bar whose buttons keep the system's colours. `false` is
   * the declared answer where no window is attached.
   */
  readonly titleBarOverlay: (overlay: TitleBarOverlay) => boolean;
  /**
   * Lets the window's next close through and closes it — the renderer has resolved every
   * document with unsaved changes (`windowClose.ts`). `false` where no window is attached.
   */
  readonly confirmClose: () => boolean;
  /**
   * Runs one of the browser's edit commands on what has focus in the window (`webContents.cut()`,
   * `copy()`, `paste()` or `selectAll()`), answering whether a window took it. Injected and required
   * for {@link titleBarOverlay}'s reason.
   */
  readonly edit: (action: WindowEditAction) => boolean;
  /** Writes text to the system clipboard; `false` where this graph has none to write to. */
  readonly copyText: (text: string) => boolean;
  /**
   * Opens one of this project's own pages in the person's browser, answering whether this build has
   * an address for it (ADR-0095). The **place** crosses the boundary and the address does not: this
   * function resolves the second from the first, in `main`, so no page can name a destination.
   */
  readonly openWebPage: (page: WebPage) => Promise<boolean>;
  /**
   * Opens an address a document holds in the person's browser or mail program, once they asked for that link
   * (ADR-0167), answering whether the system opened it. Only ever handed an address `main` read from the document
   * and `isFollowable` allowed; it checks the scheme again itself, at the edge where the address leaves.
   */
  readonly openLink: (address: string) => Promise<boolean>;
  /** Opens one of the Store application's pages (ADR-0107), answering whether this build can reach the Store. */
  readonly openStore: (page: StorePage) => Promise<boolean>;
  /**
   * The renderer has subscribed to close requests. Answers whether the gate took it — `false`
   * where no window is attached, as its neighbours do.
   */
  readonly closeListening: () => boolean;
  /** Cloud storage (ADR-0091): sign-ins, listings, working copies and their links. REQUIRED, for `titleBarOverlay`'s reason. */
  readonly cloud: CloudStorage;
  /**
   * Files attached to a question (ADR-0135): the picker, which answers paths, and the contained readers each family
   * goes to — each `null` where this build has none. REQUIRED, for `titleBarOverlay`'s reason: a composition that
   * forgot it would answer every file *cannot be read here*, which reads as a fact about the machine.
   */
  readonly attachments: { readonly pick: () => Promise<readonly string[]>; readonly readers: AttachmentReaders };
}): MainHandlers {
  // THE HANDLE EVERY WRITE ANSWERS for what it wrote (`WRITTEN`), from the registry that mints every other: a path
  // this process wrote becomes a capability the renderer may name and cannot read.
  const mintWritten: MintWritten = (destination) => deps.capabilities.mint(destination);
  return {
    // THE PRELOAD'S CHANNEL (ADR-0099). The page cannot send it — the bridge's `invoke` refuses its id —
    // so the path here is one `webUtils.getPathForFile` resolved from a file the operating system handed
    // to a drop.
    'document.openDropped': openDroppedHandler(deps),
    // THE COMMAND LINE'S DOCUMENTS, held since their launch and opened here in the order given, each through the same
    // `openPath` a drop takes — so a file association mints its handle, dedupes, and is recorded exactly as a drop is.
    'document.openWaiting': async () => ok({ opened: await openNamed(deps, deps.launchDocuments?.take() ?? []) }),
    'document.openSeveral': openSeveralHandler(deps),
    // `Promise.resolve`, not `async`: nothing here awaits, and the contract's
    // handler type is asynchronous because the real document channels are.
    'app.info': () => Promise.resolve(ok({ ...deps.appInfo })),
    // AN ARRAY COPY, because the answer crosses a boundary that serialises it and
    // the source is a `readonly` the composition root may hold on to.
    'app.ocrLanguages': async () => ok({ languages: [...(await deps.ocrLanguages())] }),
    // AN ARRAY COPY, for `app.ocrLanguages`' reason (ADR-0122).
    'app.components': async ({ verify }) => ok({ components: [...(await deps.components(verify))] }),
    'document.open': openDocumentHandler(deps),
    'document.openFromUrl': openFromUrlHandler(deps),
    'document.unlock': async ({ docId, password }) => {
      try {
        return ok(await deps.unlockDocument(docId, password));
      } catch (thrown) {
        // MATCHED ON THE CLASS, never on the message, like every other
        // per-document handler here. A document closed while somebody was
        // typing is an outcome the renderer acts on by forgetting the prompt.
        if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
        throw thrown;
      }
    },
    'document.recent': recentHandler(deps),
    // A LISTED FILE'S PICTURE, by the handle the list minted, and never a file parsed to draw it (ADR-0100).
    // A handle this run did not mint, or one for a file no longer listed, answers `none`.
    'document.recentPreview': ({ handle }) => {
      const path = deps.capabilities.resolve(handle);
      const jpeg = path !== undefined && deps.recent.has(path) ? deps.recentPictures.read(path) : null;
      return Promise.resolve(ok(jpeg === null ? ({ kind: 'none' } as const) : ({ kind: 'picture', jpeg } as const)));
    },
    // THE LIST'S OWN *Clear list*: the store empties itself and tells the pictures which paths left.
    'document.clearRecent': () => Promise.resolve(ok({ cleared: deps.recent.clear() })),
    // THE STORE RATING PROMPT (E3): main's record decides, and an answer is recorded there alone.
    'app.reviewPrompt': () => Promise.resolve(ok({ due: deps.reviewPrompt.due() })),
    'app.review': async ({ action }) => ok({ opened: await deps.reviewPrompt.answer(action) }),
    'document.openRecent': openRecentHandler(deps),
    'document.close': closeHandler({ documents: deps.documents, recent: deps.recent }),
    'document.unsaved': unsavedHandler(deps.documents),
    'document.execute': executeCommandHandler(deps.commands),
    'document.undo': undoHandler(deps.commands),
    'document.redo': redoHandler(deps.commands),
    'document.save': saveHandler(deps.commands),
    'document.deleteHeldCopies': async ({ docId }) => {
      try {
        return ok({ held: [...(await deps.commands.deleteHeldCopies(docId))] });
      } catch (thrown) {
        // THE LANE'S OWN REFUSALS, as `document.save` answers them; anything else is `internal`.
        if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' } as const);
        if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' } as const);
        throw thrown;
      }
    },
    'document.extract': extractHandler(deps.commands, mintWritten),
    'document.snapshotRegion': snapshotRegionHandler(deps.commands, mintWritten),
    'document.exportFormData': exportFormDataHandler(deps.commands, mintWritten),
    'document.exportAnnotations': exportAnnotationsHandler(deps.commands, mintWritten),
    'document.importAnnotations': importAnnotationsHandler(deps.commands),
    'document.copyAnnotations': copyAnnotationsHandler(deps.commands),
    'document.annotationWords': annotationWordsHandler(deps.commands),
    'document.openLink': openLinkHandler(deps.commands, deps.openLink),
    'document.pasteAnnotations': pasteAnnotationsHandler(deps.commands),
    'document.importFormData': importFormDataHandler(deps.commands),
    'document.split': splitHandler(deps.commands, mintWritten),
    'document.exportPageImages': exportPageImagesHandler(deps.commands, mintWritten),
    'document.exportText': exportTextHandler(deps.commands, mintWritten),
    'document.exportWord': exportWordHandler(deps.commands, mintWritten),
    'document.exportPowerPoint': exportPowerPointHandler(deps.commands, mintWritten),
    'document.exportExcel': exportExcelHandler(deps.commands, mintWritten),
    // NOT IN THE LANE (ADR-0202 Decision 5): the export holds it for its whole length, so a count or a stop that queued
    // behind it would be answered when there was nothing left to report. Plain reads and a flag of a map main keeps.
    'document.exportProgress': ({ docId }) => Promise.resolve(ok(deps.commands.exportProgress(docId))),
    'document.cancelExport': ({ docId }) => Promise.resolve(ok({ cancelled: deps.commands.cancelExport(docId) })),
    'document.print': printHandler(deps.commands),
    'document.email': emailHandler(deps.commands),
    'document.exportPdfa': exportPdfaHandler(deps.commands, mintWritten),
    'document.optimizeMeasure': optimizeMeasureHandler(deps.commands),
    'document.optimize': optimizeHandler(deps.commands, mintWritten),
    'document.saveCopy': saveCopyHandler(deps.commands, mintWritten),
    'document.editCopy': editCopyHandler(deps),
    'document.workOnCopy': workOnCopyHandler(deps),
    // THE VERSIONS A SAVE REPLACED (ADR-0198): listed by opaque id, restored as a copy, and the old `.bak` files beside a
    // file offered a move once per folder; Clear is Settings › Privacy's.
    'document.listBackups': listBackupsHandler(deps.commands),
    'document.restoreBackup': restoreBackupHandler(deps),
    'document.legacyBackups': legacyBackupsHandler(deps.commands),
    'document.moveLegacyBackups': moveLegacyBackupsHandler(deps.commands),
    'app.clearBackups': async () => ok({ kind: 'cleared', removed: await deps.commands.clearBackups() } as const),
    // WHICH FILE IS NEWER, from the times main holds for each open document; no time crosses (cloud-4 8a).
    'document.newerOf': ({ first, second }) => {
      try {
        return Promise.resolve(ok({ newer: deps.documents.newerOf(first, second) }));
      } catch (thrown) {
        if (thrown instanceof DocumentNotOpenError) return Promise.resolve(err({ code: 'document-not-open' as const }));
        throw thrown;
      }
    },
    // ASKED OF THE FILE AT EACH CALL (cloud-4 7b): the answer is something to tell a person, never kept.
    'document.fileAccess': async ({ docId }) => {
      try {
        return ok({ access: await deps.commands.fileAccess(docId) });
      } catch (thrown) {
        if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
        throw thrown;
      }
    },
    'document.insertImage': insertImageHandler(deps.commands),
    'document.newFromMarkdown': newFromImportHandler(deps, 'markdown'),
    'document.newFromCsv': newFromImportHandler(deps, 'csv'),
    'document.newFromOffice': newFromOfficeHandler(deps),
    'document.newFromImages': newFromImagesHandler(deps),
    'document.newFromCapture': newFromCaptureHandler(deps),
    'document.appendMarkdown': appendMarkdownHandler(deps),
    'document.editPageExternally': editPageExternallyHandler(deps.commands),
    'document.awaitExternalEdit': awaitExternalEditHandler(deps.commands),
    'document.reimportExternalEdit': reimportExternalEditHandler(deps),
    'document.placeImage': placeImageHandler(deps.commands),
    'document.placeSignature': placeSignatureHandler(deps.commands),
    'library.list': ({ kind }) => Promise.resolve(ok({ entries: deps.library.store.list(kind) })),
    'library.picture': ({ id }) => {
      const kept = deps.library.store.picture(id);
      return Promise.resolve(
        ok(kept === null ? ({ kind: 'absent' } as const) : ({ kind: 'found', mediaType: kept.mediaType, bytes: kept.bytes } as const)),
      );
    },
    'library.addPicture': addLibraryPictureHandler(deps.library),
    'signature.pickPicture': pickSignaturePictureHandler(deps.library, deps.capabilities),
    'library.keepSignature': ({ mark }) => Promise.resolve(ok(deps.library.store.keepSignature(mark))),
    'library.remove': ({ id }) => Promise.resolve(ok({ removed: deps.library.store.remove(id) })),
    'document.placeBarcode': placeBarcodeHandler(deps.commands),
    'document.pageBarcodes': pageBarcodesHandler(deps.commands),
    'document.openBarcodeLink': openBarcodeLinkHandler(deps.commands, deps.openLink),
    'document.saveBarcodeContact': saveBarcodeContactHandler(deps.commands, mintWritten),
    'document.accessibilityCheck': accessibilityCheckHandler(deps.commands),
    'document.sign': signHandler(deps.commands),
    'docusign.send': docusignSendHandler(deps.commands),
    'docusign.retrieve': docusignRetrieveHandler(deps.commands, mintWritten),
    'document.readRange': readRangeHandler(deps.documents),
    'document.viewModel': viewModelHandler(deps.commands),
    'document.searchPage': searchPageHandler(deps.commands),
    'document.pageTextLayer': pageTextLayerHandler(deps.commands),
    'document.pageWordCount': pageWordCountHandler(deps.commands),
    'document.pageStructure': pageStructureHandler(deps.commands),
    'document.pageTables': pageTablesHandler(deps.commands),
    'document.pageLinks': pageLinksHandler(deps.commands),
    'document.pageWordBoxes': pageWordBoxesHandler(deps.commands),
    'document.destinations': destinationsHandler(deps.commands),
    'document.layers': layersHandler(deps.commands),
    'document.signatures': signaturesHandler(deps.commands),
    'document.annotations': annotationsHandler(deps.commands),
    'document.formFields': formFieldsHandler(deps.commands),
    'document.flatFieldCandidates': flatFieldCandidatesHandler(deps.commands),
    'document.formFieldProperties': formFieldPropertiesHandler(deps.commands),
    'document.textBlocks': textBlocksHandler(deps.commands),
    'document.pageObjects': pageObjectsHandler(deps.commands),
    'document.renderPage': renderPageHandler(deps.commands),
    'document.runFonts': runFontsHandler(deps.commands),
    'document.duplicatePages': duplicatePagesHandler(deps.commands),
    // NEITHER OF THESE VALIDATES A STORED VALUE, and that is the boundary
    // deferring rather than the boundary being lax. `SettingsRegistry.read`
    // runs `migrate` and falls back per setting; a schema here would be this
    // build's opinion about last build's data, applied before the one component
    // that knows how to read it ever sees the value (B3a).
    'settings.load': () => Promise.resolve(ok({ stored: deps.settings.read() })),
    'settings.save': ({ values }) => {
      deps.settings.write(values);
      // THE PRIVACY SETTING TAKES EFFECT HERE (ADR-0100): turned off, every recent picture is deleted with the
      // write that turned it off, not at some later start screen.
      deps.recentPictures.settingsWritten();
      // ANSWERED AFTER THE WRITE RETURNS, so `stored: true` is a statement about
      // the filesystem rather than about the call having been made. The surface
      // renames a temporary file into place, so a caller that has this answer
      // has a complete document on disk — which is the whole difference between
      // proving persistence and asserting a write.
      return Promise.resolve(ok({ stored: true } as const));
    },
    // THE SECRETS ARE A SEPARATE PAIR, and the pair alone was NOT the mechanism,
    // measured 2026-09-12: `settings.save` accepted any record and the renderer
    // sent `all()`, so a key set in its store reached the plain document through
    // the handler above. What holds the separation is the schema —
    // `settings.save` refuses a `SECRET_SETTING_IDS` member before this runs,
    // and `settings.saveSecret` accepts nothing else.
    // THE ASSISTANT (ADR-0081, ADR-0082). `ai.ask` answers that the request started; the
    // answer itself arrives on the event channels, so nothing here awaits it.
    'ai.models': async ({ provider }) => ok(listAnswer(await deps.assistant.models(provider))),
    // ASKS NO PROVIDER: the Settings dialog opens on this, and a dialog held on the network is the defect
    // ADR-0117's correction records.
    'ai.models.held': () =>
      Promise.resolve(
        ok(
          Object.fromEntries(AI_PROVIDER_IDS.map((provider) => [provider, listAnswer(deps.assistant.held(provider))])) as Record<
            AiProviderId,
            AiModelListAnswer
          >,
        ),
      ),
    'ai.checkKey': async ({ provider, key, endpoint }) => {
      // ASKED BEFORE THE CHECK, so a machine with no keyring is told so before a request is made
      // with a key that could not have been kept anyway.
      if (!deps.secrets.available()) return err({ code: 'secret-storage-unavailable' } as const);
      const listed = await deps.assistant.check(provider, key, endpoint ?? '');
      // A REFUSED KEY NEVER REACHES THE STORE: the key already stored, if any, is untouched.
      if (listed.problem !== undefined) return ok({ accepted: false, problem: listed.problem } as const);
      deps.secrets.write(AI_PROVIDERS[provider].keySetting, key);
      // CHECKED ONLY WHERE THE PROVIDER ANSWERED A LIST: with nothing to ask, the key is kept on trust.
      return ok({ accepted: true, checked: listed.source === 'fetched' } as const);
    },
    // CHAT HISTORY (ADR-0093). `main` reads the setting ITSELF on every load and save: a renderer that
    // asked with the setting off gets nothing and stores nothing, whatever it believed.
    'ai.history.load': ({ docId }) => {
      const key = deps.documents.historyKeyOf(docId);
      if (key === undefined) return Promise.resolve(err({ code: 'document-not-open' } as const));
      const on = storedSetting(deps.settings.read(), CHAT_HISTORY_STORED);
      return Promise.resolve(ok({ turns: on ? [...deps.chatHistory.load(key)] : [] }));
    },
    'ai.history.save': ({ docId, turns }) => {
      const key = deps.documents.historyKeyOf(docId);
      if (key === undefined) return Promise.resolve(err({ code: 'document-not-open' } as const));
      if (!storedSetting(deps.settings.read(), CHAT_HISTORY_STORED)) return Promise.resolve(ok({ saved: false }));
      if (!deps.chatHistory.available()) return Promise.resolve(err({ code: 'secret-storage-unavailable' } as const));
      // THE FILE'S NAME AND THE MOMENT go into the entry (ADR-0192): main's own reads, so the History says which file a
      // conversation was about and when, and the renderer supplies neither.
      deps.chatHistory.save(key, turns, deps.commands.nameOf(docId) ?? null, new Date());
      return Promise.resolve(ok({ saved: true }));
    },
    // THE HISTORY (ADR-0192): listed, read and removed by the digest, which names no path, and NOT behind the setting —
    // what was saved while it was on stays readable and removable while it is off, as clearing already does.
    'ai.history.list': () =>
      Promise.resolve(
        ok({ conversations: [...deps.chatHistory.list()] }),
      ),
    'ai.history.read': ({ key }) => {
      const found = deps.chatHistory.read(key);
      return Promise.resolve(ok({ conversation: found === null ? null : { ...found, turns: [...found.turns] } }));
    },
    'ai.history.remove': ({ key }) => Promise.resolve(ok({ removed: deps.chatHistory.remove(key) })),
    'ai.history.clear': () => Promise.resolve(ok({ cleared: deps.chatHistory.clear() })),
    // THE PAPERCLIP (ADR-0135): main runs the picker, mints a handle per path and answers what a chip draws. The handle
    // is the only thing the renderer can name the file by, and only an ask turns it back into a path.
    'ai.attach': async () => {
      const picked = await deps.attachments.pick();
      const kept = picked.slice(0, MAX_ASK_ATTACHMENTS);
      const files = [];
      for (const path of kept) {
        files.push({ handle: deps.capabilities.mint(path), name: basename(path), bytes: (await deps.attachments.readers.size(path)) ?? 0 });
      }
      return ok({ files, dropped: picked.length - kept.length });
    },
    'ai.ask': async ({ subscription, provider, model, messages, about, alongside, web, attachments = [] }) => {
      // THE WINDOW IS READ HERE, INSIDE THE ASK THAT SENDS IT (ADR-0088 Decision 5): nothing
      // about a document is read until a person asks, and what was read is answered so the
      // turn can say which pages went.
      //
      // TWO DOCUMENTS READ HALF THE BOUND EACH, one lane after the other (ADR-0089), so what is
      // resident is still one window's worth. The schema has already refused every pairing but
      // a second document in the same page or document scope; the scope test below only
      // narrows the type.
      const paired =
        alongside !== undefined &&
        about !== undefined &&
        (about.scope === 'page' || about.scope === 'document') &&
        (alongside.scope === 'page' || alongside.scope === 'document')
          ? { scope: about.scope, left: about, right: alongside }
          : null;
      // ATTACHED FILES (ADR-0135): each file's family first, from its first bytes, so the share is known before any
      // document or file is windowed. A handle this run never minted names no file, and is said as not found.
      const attached = await classifyAttachments(
        attachments.map((handle) => {
          const path = deps.capabilities.resolve(handle) ?? null;
          return { name: path === null ? 'a file that could not be found' : basename(path), path };
        }),
        deps.attachments.readers,
      );
      const fileSources = textSourcesIn(attached);
      // EVERY TEXT SOURCE AN EQUAL SHARE OF THE ONE BOUND (Decision 5): each document window and each file that is not
      // a picture. A carried selection or comment stays whole — it has its own, smaller bound — and the rest is shared.
      const windows =
        about === undefined || about.scope === 'page-image' || about.scope === 'selection' || about.scope === 'comment'
          ? 0
          : about.scope === 'documents'
            ? about.docIds.length
            : paired !== null
              ? 2
              : 1;
      const carried = about?.scope === 'selection' || about?.scope === 'comment' ? about.text.length : 0;
      const share = askShareOf(Math.max(1, windows + fileSources), carried);
      const divided = fileSources > 0;
      let window: AskWindow | null = null;
      let second: AskWindow | null = null;
      // A PICTURE ASK (ADR-0090): the page drawn in the host, sent with the last turn.
      let picture: { readonly png: Uint8Array | null; readonly sent: AskSent } | null = null;
      // EVERY OPEN DOCUMENT (ADR-0134): each read as its own whole-document window, an equal share of the one bound, in
      // its own lane, one after another — so what is resident is still one window's worth. A document that cannot be
      // read is NAMED AND SKIPPED, and the rest go on; only an ask in which none could be read is refused, with the
      // first one's reason, since it would ask about nothing.
      let many: { readonly system: string; readonly among: AskAmong[] } | null = null;
      if (about?.scope === 'documents') {
        const read: (AskManyDocument & { readonly place: number })[] = [];
        const unread: string[] = [];
        const among: AskAmong[] = [];
        for (const [place, docId] of about.docIds.entries()) {
          // A CLOSED DOCUMENT HAS NO NAME HERE ANY MORE, and its id means nothing to a model, so it is described instead.
          const name = deps.commands.nameOf(docId) ?? 'a document that closed before it could be read';
          try {
            const each = await deps.commands.askWindow({ scope: 'document', docId }, { label: place, bound: share });
            read.push({ name, window: each, place });
            among.push({ docId, sent: each.sent });
          } catch (thrown) {
            const code = askUnreadCode(thrown);
            if (code === undefined) throw thrown;
            unread.push(name);
            among.push({ docId, unread: code });
          }
        }
        const first = among[0];
        if (read.length === 0) return err({ code: first !== undefined && 'unread' in first ? first.unread : 'document-not-open' });
        many = { system: askManyInstruction(read, unread, share, web), among };
      }
      try {
        if (many !== null) {
          // READ ABOVE, where each document's failure is its own rather than the ask's.
        } else if (paired !== null) {
          window = await deps.commands.askWindow(paired.left, { label: 'left', bound: share });
          second = await deps.commands.askWindow(paired.right, { label: 'right', bound: share });
        } else if (about?.scope === 'page-image') {
          picture = await deps.commands.askPicture(about);
        } else if (about !== undefined && about.scope !== 'documents') {
          // ALONE IT TAKES THE WHOLE BOUND; beside files, its share.
          window = divided ? await deps.commands.askWindow(about, { bound: share }) : await deps.commands.askWindow(about);
        }
      } catch (thrown) {
        const code = askUnreadCode(thrown);
        if (code !== undefined) return err({ code });
        throw thrown;
      }
      // NO COMMENTS AND NOTHING ELSE TO SEND is a question about nothing: refused by name before a provider is reached,
      // so the panel says what is missing rather than posting a turn whose answer could only be invented. The count is
      // the window's own, `commentsWindow`'s, so this asks the reader that decides what a comment is (B3a).
      if (about?.scope === 'comments' && window?.sent.comments === 0 && attached.length === 0) {
        return err({ code: 'no-comments' });
      }
      const context =
        many !== null
          ? many.system
          : paired !== null && window !== null && second !== null
            ? askPairInstruction(window, second, paired.scope, web)
            : picture?.png != null
              ? askPictureInstruction(picture.sent, web)
              : window !== null && about !== undefined && about.scope !== 'page-image'
                ? askInstruction(window, about.scope, web)
                : undefined;
      // THE FILES, read after the documents and one at a time, each by its contained reader; a file that is not read
      // is named in the instruction and the answer, and never refuses the question (Decision 6).
      const listedModel = deps.assistant.held(provider).models.find((each) => each.id === model);
      const read =
        attached.length === 0
          ? null
          : await readAttachments(attached, deps.attachments.readers, share, listedModel === undefined || servesVision(listedModel));
      const files = read === null ? undefined : askFilesInstruction(read.listed, share, web, context === undefined);
      const system = context === undefined ? files : files === undefined ? context : `${context}\n\n${files}`;
      const images: ChatImage[] = [
        ...(picture?.png == null ? [] : [{ mediaType: 'image/png' as const, base64: Buffer.from(picture.png).toString('base64') }]),
        ...(read?.images ?? []),
      ];
      const started = deps.assistant.ask({
        subscription,
        provider,
        model,
        messages,
        web,
        ...(system === undefined ? {} : { system }),
        ...(images.length === 0 ? {} : { images }),
      });
      // A SUBSCRIPTION ALREADY STREAMING IS A DECLARED REFUSAL, not a quiet `false`: the
      // renderer must be able to say why nothing happened.
      return started.started
        ? ok({
            started: true,
            sent: picture?.sent ?? window?.sent ?? null,
            ...(second === null ? {} : { alongside: second.sent }),
            ...(many === null ? {} : { among: many.among }),
            ...(read === null ? {} : { files: [...read.files] }),
            // THE SHARE MAIN APPLIED, whenever it divided the bound, so the turn states the number that was used.
            ...(many !== null || divided ? { share } : {}),
          })
        : err({ code: 'subscription-in-use' });
    },
    'ai.stop': ({ subscription }) => Promise.resolve(ok(deps.assistant.stop(subscription))),
    'ai.openSource': async ({ answer, index }) => ok(await deps.assistant.openSource(answer, index)),
    'ai.translatePage': translatePageHandler(deps),
    'ai.translateText': translateTextHandler(deps),
    ...cloudHandlers(deps),

    'settings.loadSecrets': () => {
      // WHICH ARE STORED, AND NO VALUE (ADR-0056). The store decrypts to answer
      // this, and the plaintext ends in this frame: what crosses is the list.
      const held = deps.secrets.read();
      return Promise.resolve(
        ok({
          stored: SECRET_SETTING_IDS.filter((id) => (held[id] ?? '') !== ''),
          available: deps.secrets.available(),
        }),
      );
    },
    'settings.export': async () => {
      const path = await deps.pickSettingsFile();
      if (path === null) return ok({ kind: 'cancelled' } as const);
      // WHAT THE PLAIN DOCUMENT HOLDS, which is every setting except a secret — those live in their
      // own encrypted file (ADR-0056), so nothing here has to remember to leave them out.
      const stored = deps.settings.read();
      try {
        await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      } catch {
        return ok({ kind: 'write-failed' } as const);
      }
      return ok({ kind: 'written', settings: Object.keys(stored).length, written: mintWritten(path) } as const);
    },
    'settings.import': async () => {
      const path = await deps.openSettingsFile();
      if (path === null) return ok({ kind: 'cancelled' } as const);
      // THE SIZE BEFORE THE BYTES, so a file that is not a settings file is refused without being read. A file that
      // cannot be read or parsed is the declared `unreadable`, which the renderer says in words — the outcome the
      // export's `write-failed` is on the other side.
      let parsed: unknown;
      try {
        if ((await stat(path)).size > MAX_SETTINGS_FILE_BYTES) return ok({ kind: 'unreadable' } as const);
        parsed = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return ok({ kind: 'unreadable' } as const);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return ok({ kind: 'unreadable' } as const);
      }
      // A SECRET NEVER ARRIVES BY A FILE. An export carries none; a file that names one was written by hand, and
      // `settings.save` would refuse the whole write that carried it.
      const secret = new Set<string>(SECRET_SETTING_IDS);
      const values = Object.fromEntries(Object.entries(parsed).filter(([id]) => !secret.has(id)));
      return ok({ kind: 'read', values } as const);
    },
    'settings.saveSecret': ({ id, value }) => {
      // ASKED BEFORE WRITING rather than caught after. The store throws for the
      // same condition, and this turns it into the DECLARED refusal a renderer
      // switches on — a thrown error would surface as `internal` plus an
      // incident id for a machine that simply has no keyring.
      if (!deps.secrets.available()) {
        return Promise.resolve(err({ code: 'secret-storage-unavailable' } as const));
      }
      deps.secrets.write(id, value);
      return Promise.resolve(ok({ stored: true } as const));
    },
    'spelling.dictionary': async ({ language }) => {
      const read = await deps.readDictionary(language);
      // A DECLARED LANGUAGE WITH NO PACKAGE is a refusal, not a failure: the
      // request schema already narrowed `language` to one this build declares,
      // so reaching here means the dependency is missing rather than that a
      // caller asked for something impossible.
      if (read === null) return ok({ kind: 'unknown-dictionary' } as const);
      return ok({
        kind: 'dictionary',
        language,
        affix: read.affix,
        words: read.words,
      } as const);
    },
    'log.reveal': async () => ok({ revealed: await deps.revealLog() }),
    // A HANDLE THIS PROCESS DID NOT MINT shows nothing: `resolve` answers no path, and there is nothing to reveal.
    'file.reveal': async ({ handle }) => {
      const path = deps.capabilities.resolve(handle);
      return ok({ revealed: path === undefined ? false : await deps.revealPath(path) });
    },
    'crashReport.pending': async () => ok({ report: (await deps.crashReports?.pending()) ?? null }),
    'crashReport.share': async ({ id }) => ok({ outcome: (await deps.crashReports?.share(id)) ?? ('gone' as const) }),
    'crashReport.dismiss': async ({ id }) => {
      if (deps.crashReports == null) return ok({ dismissed: false });
      await deps.crashReports.dismiss(id);
      return ok({ dismissed: true });
    },
    'window.titleBarOverlay': (overlay) => Promise.resolve(ok({ applied: deps.titleBarOverlay(overlay) })),
    'window.close': () => Promise.resolve(ok({ closing: deps.confirmClose() })),
    'window.edit': ({ action }) => Promise.resolve(ok({ done: deps.edit(action) })),
    'window.copyText': ({ text }) => Promise.resolve(ok({ copied: deps.copyText(text) })),
    'app.openWebPage': async ({ page }) => ok({ opened: await deps.openWebPage(page) }),
    'app.openStore': async ({ page }) => ok({ opened: await deps.openStore(page) }),
    'app.updateStatus': async () => ok({ status: (await deps.updateCheck?.status()) ?? { kind: 'none' as const } }),
    'app.acknowledgeSecurityUpdate': async () => ok({ acknowledged: (await deps.updateCheck?.acknowledge()) ?? false }),
    'window.closeListening': () => Promise.resolve(ok({ acknowledged: deps.closeListening() })),
  };
}

/** A model list as it crosses: the channel's fields, and nothing else the kernel's list carries. */
function listAnswer(list: AiModelList): AiModelListAnswer {
  return {
    source: list.source,
    ...(list.problem === undefined ? {} : { problem: list.problem }),
    models: list.models.map((model) => ({ id: model.id, label: model.label, capabilities: model.capabilities })),
  };
}

/**
 * Serves one byte range to the renderer.
 *
 * ## Not `async`, and one consequence of that is asserted rather than assumed
 *
 * `readDocumentRange` is synchronous precisely so that the version it reports
 * and the bytes it slices cannot belong to two different versions — the lane
 * mutates a record only at an `await`, and there is none. `async` on a body with
 * no `await` is a lint error here, so this handler is the one that is not.
 *
 * **The consequence is that a rethrow leaves SYNCHRONOUSLY**, where every
 * sibling's arrives as a rejected promise. That is safe for the only caller that
 * matters — `wrapHandler` awaits the call inside its `try`, so the catch is the
 * same one either way — and it is a real difference, so
 * `contractHandlers.test.ts` asserts it in that form rather than in the one the
 * neighbours have. A future move to `async` then shows up as a failing case
 * instead of as a behaviour change nothing observes.
 *
 * ## Only `document-not-open`, and the others are not omissions
 *
 * `document-busy` cannot happen: the read does not enter the lane, so there is
 * no queue to be full. `document-poisoned` cannot either — poisoning is about
 * engine sessions, and this reads the canonical image main already holds, which
 * is exactly the state a poisoned document still has and the reason invariant 18
 * can recover from one. A poisoned document must stay readable or the user
 * cannot look at the thing they are being told they cannot edit.
 *
 * A `RangeError` is rethrown and becomes `internal`. The boundary already
 * refused a range larger than `MAX_RANGE_BYTES` and one whose end precedes its
 * begin, so what is left is a caller asking past the end of the document — a
 * defect in the transport, not something a user did.
 */
function readRangeHandler(documents: DocumentService): ContractHandlers['document.readRange'] {
  return ({ docId, version, begin, end }) => {
    try {
      return Promise.resolve(ok(readDocumentRange(documents, docId, version, begin, end)));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) {
        return Promise.resolve(err({ code: 'document-not-open' } as const));
      }
      throw thrown;
    }
  };
}

/**
 * Save, and the whole of it is keeping three outcomes out of the failure
 * channel.
 *
 * `refused` and `write-failed` are things that happened to a document that is
 * still intact, still dirty, and whose command log is untouched. Invariant 18's
 * sentence — *"never by a dialog whose only option discards their edits"* — is a
 * statement about what the renderer must be able to say, and it can only say it
 * if the two arrive as outcomes rather than as error codes beside
 * `document-not-open`.
 *
 * ## The verdict is narrowed EXHAUSTIVELY, on purpose
 *
 * `sole-writer` cannot appear: the pipeline returns `refused` only for verdicts
 * that are not it. That is unrepresentable on the wire — the enum has four
 * members — so the impossible case is handled by the compiler refusing a switch
 * that does not cover the four, rather than by a default branch that would
 * silently absorb a fifth verdict the kernel grows later.
 */
function saveHandler(commands: DocumentCommands): ContractHandlers['document.save'] {
  return async ({ docId, breakSignatures }): Promise<Awaited<ReturnType<ContractHandlers['document.save']>>> => {
    try {
      const outcome = await commands.save(docId, { breakSignatures });
      if (outcome.kind === 'saved') {
        const cleared = outcome.cleared;
        return ok({
          kind: 'saved',
          version: outcome.version,
          cleared: cleared === null ? null : { backups: cleared.backups, undoCopies: cleared.undoCopies, kept: [...cleared.kept] },
          held: [...outcome.held],
        } as const);
      }
      if (outcome.kind === 'breaks-signatures') {
        return ok({ kind: 'breaks-signatures', signatures: outcome.signatures } as const);
      }
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed', cause: outcome.cause } as const);
      return ok({ kind: 'refused', reason: refusalReason(outcome.verdict) } as const);
    } catch (thrown) {
      // MATCHED ON THE CLASS, exactly as undo and execute do. Everything else
      // is rethrown and becomes `internal` with the diagnostic recorded
      // main-side — including `MissingSessionError`, which is a supervisor
      // inconsistency rather than something a user can act on.
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Writing a copy, and the whole of it is turning four kernel outcomes into four
 * wire ones.
 *
 * The suggested filename is not passed in. `DocumentCommands.saveCopy` derives
 * it from the service's own record, because that is where the document's name
 * is; a name round-tripped through this handler would be a filename main
 * accepted from its own caller for no reason.
 *
 * ## `refused` sends a COUNT, not the ids
 *
 * The channel's own note: a `DocId` means nothing to a person, and a renderer
 * holding other documents' ids for a sentence it renders once is a capability
 * it did not need.
 */
/**
 * Inserting an image, and the four outcomes it can answer with.
 *
 * `saveCopyHandler`'s shape. The kernel's outcome union and the wire's are the
 * same four here, and each member is still rebuilt field by field rather than
 * passed through — the comment below `saveCopyHandler` states why: two types
 * that happen to agree today are not one type, and passing the object through
 * would put a fifth kernel member on a wire that declares four the day one is
 * added.
 */
function insertImageHandler(commands: DocumentCommands): ContractHandlers['document.insertImage'] {
  return async ({
    docId,
    at,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.insertImage']>>> => {
    try {
      const outcome = await commands.insertImage(docId, at);
      if (outcome.kind === 'cancelled') return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'unreadable') return ok({ kind: 'unreadable' } as const);
      if (outcome.kind === 'too-large') {
        return ok({ kind: 'too-large', limitBytes: outcome.limitBytes } as const);
      }
      if (outcome.kind === 'too-many-pixels') {
        return ok({ kind: 'too-many-pixels', limitPixels: outcome.limitPixels } as const);
      }
      return ok({
        kind: 'inserted',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The import's own outcomes, which both Markdown channels answer alike. */
type ComposeRefusalAnswer = Extract<
  ChannelResult<'document.appendMarkdown'>,
  { readonly kind: Exclude<ComposeImportOutcome['kind'], 'written'> }
>;

/**
 * An import that wrote nothing, as the wire states it.
 *
 * Member by member, for `saveCopyHandler`'s reason: two unions that agree today are
 * not one type, and passing the object through would put a new command-side member
 * on a wire that does not declare it.
 */
function composeRefusal(
  outcome: Exclude<ComposeImportOutcome, { readonly kind: 'written' }>,
): ComposeRefusalAnswer {
  switch (outcome.kind) {
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'too-large':
      return { kind: 'too-large', limitBytes: outcome.limitBytes };
    case 'unreadable':
      return { kind: 'unreadable' };
    case 'composition-refused':
      return {
        kind: 'composition-refused',
        reason: outcome.reason,
        line: outcome.line,
        file: outcome.file,
      };
    case 'destination-contested':
      return { kind: 'destination-contested', openElsewhere: outcome.openElsewhere };
    case 'write-failed':
      return { kind: 'write-failed' };
  }
}

/**
 * Composes a picked Markdown file into a PDF on disk, and opens it
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * The file opens through {@link openPath}, so a composed document is opened exactly
 * as a picked one is — the same handle, the same recent-list entry and the same
 * session — and the answer is that open's outcome.
 */
function newFromImportHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
  format: ImportFormat,
): ContractHandlers['document.newFromMarkdown'] {
  // ONE HANDLER FOR BOTH CHANNELS, which answer one declared union: a copy per format
  // would be two opinions about how an import is opened and answered.
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.newFromMarkdown']>>> => {
    try {
      const composed = await deps.commands.composeImportFile(format);
      if (composed.kind !== 'written') return ok(composeRefusal(composed));
      const opened = (await openPath(deps, composed.destination)).outcome;
      // THE BOXED CHARACTERS RIDE WITH THE OPEN (ADR-0172), the Office import's rule for rows it lacks: a document
      // that opened is told which characters it draws as the box, and an open that answered anything else answers
      // that — the file on disk is the same either way.
      if (opened.kind !== 'opened' || composed.boxed.length === 0) return ok(opened);
      return ok({ ...opened, kind: 'opened-with-boxes', boxed: [...composed.boxed], more: composed.more });
    } catch (thrown) {
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * Makes a PDF from pictures taken with the camera, and opens it.
 *
 * {@link newFromImportHandler}'s route: the composed file opens through {@link openPath},
 * and everything before the open is the shared import union.
 */
function newFromCaptureHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.newFromCapture'] {
  return async ({ frames }): Promise<Awaited<ReturnType<ContractHandlers['document.newFromCapture']>>> => {
    try {
      const composed = await deps.commands.composeCapturedFrames(frames);
      if (composed.kind !== 'written') return ok(composeRefusal(composed));
      return ok((await openPath(deps, composed.destination)).outcome);
    } catch (thrown) {
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * Makes a PDF from picked images, and opens it.
 *
 * {@link newFromImportHandler}'s route exactly, with the two outcomes only a set of files
 * has answered first and member by member, for `composeRefusal`'s reason.
 */
function newFromImagesHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.newFromImages'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.newFromImages']>>> => {
    try {
      const composed = await deps.commands.composeImageFiles();
      if (composed.kind === 'too-many-images') {
        return ok({ kind: 'too-many-images', limit: composed.limit });
      }
      if (composed.kind === 'images-too-large') {
        return ok({ kind: 'images-too-large', limitBytes: composed.limitBytes });
      }
      if (composed.kind !== 'written') return ok(composeRefusal(composed));
      return ok((await openPath(deps, composed.destination)).outcome);
    } catch (thrown) {
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * Composes a picked Markdown file, opens it as a tab, and merges it into `docId`.
 *
 * ## A visible tab, then the existing merge
 *
 * ADR-0040 Decision 2 refuses a hidden transient open, so the composed file is opened
 * by {@link openPath} like any other and merged with `mergeDocument`, whose source
 * must be an open document. The SESSIONS are awaited first: the merge reads the
 * source through its engine session, and a merge that reached the bus before the
 * session existed would be refused for a document that is about to have one.
 *
 * ## A refused merge closes the tab it opened
 *
 * The renderer learns of the composed document only from `appended`. A merge that
 * throws answers a failure code instead, so a document left open here would be held
 * in `main` with no tab anywhere — counted against the resident ceiling, and closable
 * by nobody. It is closed through the service and dropped from the session list, as
 * `document.close` does; the file stays on disk where the person saved it.
 *
 * ## `already-open` cannot happen, and it is a fault if it does
 *
 * The write refuses a destination any open document reaches, so the file just
 * written cannot be open already. Merging from whatever document answered would
 * merge the wrong bytes, so it is thrown rather than handled.
 */
function appendMarkdownHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.appendMarkdown'] {
  return async ({
    docId,
    at,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.appendMarkdown']>>> => {
    try {
      const composed = await deps.commands.composeImportFile('markdown', docId);
      if (composed.kind !== 'written') return ok(composeRefusal(composed));

      const { outcome, sessions } = await openPath(deps, composed.destination);
      if (outcome.kind === 'absent') return ok({ kind: 'absent' });
      // A FILE THIS BUILD JUST WROTE CAN STILL BE HELD: a scanner opening it the moment it lands holds it as any
      // program does, so the refusal is the person's to hear rather than a defect to throw.
      if (outcome.kind === 'busy' || outcome.kind === 'denied') return ok({ kind: outcome.kind });
      if (outcome.kind === 'at-capacity') {
        return ok({ kind: 'at-capacity', wouldHold: outcome.wouldHold, ceiling: outcome.ceiling });
      }
      if (outcome.kind !== 'opened') {
        throw new Error(
          `the composed file answered ${outcome.kind} on open, and the write that preceded it refuses ` +
            'a destination an open document reaches',
        );
      }

      await sessions;
      let applied: Awaited<ReturnType<DocumentCommands['execute']>>;
      try {
        applied = await deps.commands.execute(docId, {
          kind: 'mergeDocument',
          // EVERY PAGE THE MARKDOWN BECAME: the file was composed for this append alone.
          documents: [{ source: outcome.docId, sourcePages: 'all' }],
          at,
        });
      } catch (thrown) {
        await deps.documents.close(outcome.docId);
        deps.recent.closed(outcome.docId);
        throw thrown;
      }

      return ok({
        kind: 'appended',
        version: applied.version,
        byteLength: applied.byteLength,
        historyDropped: applied.historyDropped,
        opened: {
          docId: outcome.docId,
          version: outcome.version,
          byteLength: outcome.byteLength,
          name: outcome.name,
        },
        // THE BOXED CHARACTERS, `newFromImportHandler`'s rule: the merged pages draw them as the composed tab does.
        boxed: [...composed.boxed],
        more: composed.more,
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * Sends one page out to be edited elsewhere (ADR-0062).
 *
 * {@link extractHandler}'s mapping for the copy's outcomes, written out for the reason that
 * one gives, plus the three a page handed to the operating system adds.
 */
function editPageExternallyHandler(
  commands: DocumentCommands,
): ContractHandlers['document.editPageExternally'] {
  return async ({
    docId,
    page,
    version,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.editPageExternally']>>> => {
    try {
      const outcome = await commands.editPageExternally(docId, page, version);
      switch (outcome.kind) {
        case 'refused':
          return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
        case 'write-failed':
          return ok({ kind: 'write-failed' } as const);
        case 'sent':
        case 'cancelled':
        case 'not-pdf':
        case 'not-watchable':
        case 'launch-failed':
          return ok({ kind: outcome.kind } as const);
      }
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** Waits a bounded time for the page this document sent out to be saved (ADR-0062 Decision 4). */
function awaitExternalEditHandler(
  commands: DocumentCommands,
): ContractHandlers['document.awaitExternalEdit'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.awaitExternalEdit']>>> => {
    try {
      return ok({ kind: await commands.awaitExternalEdit(docId) } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      throw thrown;
    }
  };
}

/**
 * Puts a page edited elsewhere back — ADR-0062 Decision 5 and its 2026-09-14 correction.
 *
 * {@link appendMarkdownHandler}'s shape: the file opens through {@link openPath} as a visible
 * tab, the command waits for its sessions, and a replace that is refused closes that tab
 * again, because nobody asked for it without its page going back.
 *
 * ## `already-open` is `open-elsewhere`, never a tab reused
 *
 * A tab of the edited file holds the bytes from when it was opened, not the save: the service
 * finds the open record by the file's identity and does not reload it. Replacing from that tab
 * would put back an older page than the one the person just saved.
 *
 * ## A moved document is `document-changed`
 *
 * The replace carries the version recorded when the page left, so `StaleTargetError` from the
 * bus is exactly *the document moved*, and nothing was replaced.
 */
function reimportExternalEditHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.reimportExternalEdit'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.reimportExternalEdit']>>> => {
    try {
      const path = deps.commands.externalEditToReimport(docId);
      if (path === undefined) return ok({ kind: 'no-edit' });

      const { outcome, sessions } = await openPath(deps, path);
      if (outcome.kind === 'absent') return ok({ kind: 'absent' });
      if (outcome.kind === 'busy' || outcome.kind === 'denied') return ok({ kind: outcome.kind });
      if (outcome.kind === 'at-capacity') {
        return ok({ kind: 'at-capacity', wouldHold: outcome.wouldHold, ceiling: outcome.ceiling });
      }
      if (outcome.kind === 'already-open') return ok({ kind: 'open-elsewhere' });

      await sessions;
      let applied: Awaited<ReturnType<DocumentCommands['reimportExternalEdit']>>;
      try {
        applied = await deps.commands.reimportExternalEdit(docId, outcome.docId);
      } catch (thrown) {
        await deps.documents.close(outcome.docId);
        deps.recent.closed(outcome.docId);
        if (thrown instanceof StaleTargetError) return ok({ kind: 'document-changed' });
        throw thrown;
      }

      return ok({
        kind: 'reimported',
        version: applied.version,
        byteLength: applied.byteLength,
        historyDropped: applied.historyDropped,
        opened: {
          docId: outcome.docId,
          version: outcome.version,
          byteLength: outcome.byteLength,
          name: outcome.name,
        },
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * The place-image handler.
 *
 * {@link insertImageHandler}'s body with one call and one member name changed,
 * and written out rather than shared with it for the reason the extract's
 * comment below gives at greater length: the two map the same shape today, and
 * a helper over both is a single point at which a future divergence becomes a
 * change to the other path too.
 */
function placeImageHandler(commands: DocumentCommands): ContractHandlers['document.placeImage'] {
  return async ({
    docId,
    pages,
    rect,
    stamp,
    picture,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.placeImage']>>> => {
    try {
      const outcome = await commands.placeImage(docId, { pages, rect, stamp, picture });
      if (outcome.kind === 'cancelled') return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'unreadable') return ok({ kind: 'unreadable' } as const);
      if (outcome.kind === 'absent') return ok({ kind: 'absent' } as const);
      if (outcome.kind === 'too-large') {
        return ok({ kind: 'too-large', limitBytes: outcome.limitBytes } as const);
      }
      return ok({
        kind: 'placed',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** A plain signature's handler (ADR-0133): {@link placeImageHandler}'s body, the outcome passed through as main named it. */
function placeSignatureHandler(commands: DocumentCommands): ContractHandlers['document.placeSignature'] {
  return async ({ docId, page, rect, mark, keep, stamp }) => {
    try {
      return ok(await commands.placeSignature(docId, { page, rect, mark, keep, stamp }));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Keeps a picture in the person's library: the picker, then the SIZE before any read — a picture past the library's
 * bound is refused without loading it — then the bounded read, and the store decides from the bytes whether it is a
 * picture at all. Only the file's own name reaches the store, never its folder.
 */
function addLibraryPictureHandler(library: {
  readonly store: PersonalLibrary;
  readonly pick: PickImage;
  readonly size: (path: string) => Promise<number | null>;
  readonly read: ImageSource['read'];
}): ContractHandlers['library.addPicture'] {
  return async ({ kind }) => {
    if (library.store.list(kind).length >= MAX_LIBRARY_ENTRIES) {
      return ok({ kind: 'full', limit: MAX_LIBRARY_ENTRIES } as const);
    }
    const picked = await library.pick();
    if (picked === null) return ok({ kind: 'cancelled' } as const);
    const size = await library.size(picked);
    if (size === null) return ok({ kind: 'unreadable' } as const);
    if (size > MAX_LIBRARY_PICTURE_BYTES) return ok({ kind: 'too-large', limitBytes: MAX_LIBRARY_PICTURE_BYTES } as const);
    const read = await library.read(picked);
    if (read.kind !== 'read' || read.bytes.byteLength > MAX_LIBRARY_PICTURE_BYTES) {
      return ok(
        read.kind === 'unreadable'
          ? ({ kind: 'unreadable' } as const)
          : ({ kind: 'too-large', limitBytes: MAX_LIBRARY_PICTURE_BYTES } as const),
      );
    }
    return ok(library.store.addPicture(kind, basename(picked), read.bytes));
  };
}

/**
 * Picks a picture for the plain Signature and HOLDS what it read (ADR-0133's second correction): the bounded read,
 * which sizes a file before reading it, then the type from the bytes by the library's own resolver — so a file that is
 * not a picture is refused here, where the person is looking, rather than after the click. The bytes answered are the
 * bytes held, so the preview is of exactly what will be placed.
 *
 * The picture is `pickSignaturePicture`'s, the one resolver *Sign with certificate* takes too: a PNG or a JPEG, or a
 * scanned PDF the compose host made a picture of — and then what is held and previewed is that PNG, never the PDF.
 */
function pickSignaturePictureHandler(
  library: { readonly signaturePicture: SignaturePictureSource; readonly held: HeldPicture },
  capabilities: CapabilityRegistry,
): ContractHandlers['signature.pickPicture'] {
  return async () => {
    const picked = await pickSignaturePicture(library.signaturePicture);
    if (picked.kind === 'too-large') return ok({ kind: 'too-large', limitBytes: MAX_IMAGE_BYTES } as const);
    if (picked.kind !== 'picture') return ok({ kind: picked.kind });
    const { bytes, mediaType, name } = picked;
    const handle = capabilities.mint(picked.path);
    library.held.hold(handle, { name, mediaType, bytes });
    return ok({ kind: 'picked', handle, name, mediaType, bytes } as const);
  };
}

/** The barcode placement's handler: {@link placeImageHandler}'s body for its outcomes. */
function placeBarcodeHandler(commands: DocumentCommands): ContractHandlers['document.placeBarcode'] {
  return async ({
    docId,
    pages,
    rect,
    text,
    format,
    stamp,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.placeBarcode']>>> => {
    try {
      const outcome = await commands.placeBarcode(docId, pages, rect, text, format, stamp);
      if (outcome.kind === 'refused') return ok({ kind: 'refused' } as const);
      return ok({
        kind: 'placed',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The accessibility check: {@link flatFieldCandidatesHandler}'s body and its refusals (ADR-0078). */
function accessibilityCheckHandler(commands: DocumentCommands): ContractHandlers['document.accessibilityCheck'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.accessibilityCheck']>>> => {
    try {
      const { version, rules, humanChecks } = await commands.accessibilityCheck(docId);
      return ok({ version, rules, humanChecks });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** One page's barcodes: {@link flatFieldCandidatesHandler}'s body and its refusals. */
function pageBarcodesHandler(commands: DocumentCommands): ContractHandlers['document.pageBarcodes'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageBarcodes']>>> => {
    try {
      const { version, barcodes, truncated } = await commands.pageBarcodes(docId, page);
      return ok({ version, barcodes, truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * A barcode's web address opened, read by main from the page and refused unless its scheme is one that is followed
 * (`openLinkHandler`'s rule for a symbol). The version and the position name the barcode; the text never crosses from the
 * renderer, so what is opened is what the document says.
 */
function openBarcodeLinkHandler(
  commands: DocumentCommands,
  openLink: (address: string) => Promise<boolean>,
): ContractHandlers['document.openBarcodeLink'] {
  return async ({
    docId,
    version,
    page,
    index,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.openBarcodeLink']>>> => {
    try {
      const read = await commands.pageBarcodes(docId, page);
      if (read.version !== version) return ok({ kind: 'stale' } as const);
      const address = read.barcodes[index]?.text.trim();
      if (address === undefined || address === '') return ok({ kind: 'no-such-link' } as const);
      if (!isFollowable(address)) return ok({ kind: 'scheme-refused', scheme: shownSchemeOf(address) } as const);
      return ok({ kind: (await openLink(address)) ? 'opened' : 'not-opened' } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * A barcode's contact card saved: {@link exportTextHandler}'s outcomes, plus the three ways there was nothing to save. The
 * text is read by main from the page and never arrives from the renderer.
 */
function saveBarcodeContactHandler(
  commands: DocumentCommands,
  mint: MintWritten,
): ContractHandlers['document.saveBarcodeContact'] {
  return async ({
    docId,
    version,
    page,
    index,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.saveBarcodeContact']>>> => {
    try {
      const outcome = await commands.saveBarcodeContact(docId, version, page, index);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
        case 'write-failed':
          return ok({ kind: 'write-failed' } as const);
        case 'refused':
          return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
        case 'stale':
        case 'no-such-barcode':
        case 'not-a-contact':
          return ok({ kind: outcome.kind } as const);
      }
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The signing handler.
 *
 * `placeImageHandler`'s body with one call changed, and written out for the
 * reason `extractHandler`'s header gives: four lines of agreement is cheaper
 * than a shared function two rows must not diverge inside.
 */
function signHandler(commands: DocumentCommands): ContractHandlers['document.sign'] {
  return async (params): Promise<Awaited<ReturnType<ContractHandlers['document.sign']>>> => {
    try {
      // THE PASSPHRASE IS FORWARDED AND NOT LOGGED, and this handler is the one
      // place a diagnostic would be easy to add. The catch below matches on
      // classes and never renders the params (ADR-0055).
      const outcome = await commands.sign(params.docId, {
        passphrase: params.passphrase,
        ...(params.name === undefined ? {} : { name: params.name }),
        ...(params.reason === undefined ? {} : { reason: params.reason }),
        ...(params.location === undefined ? {} : { location: params.location }),
        ...(params.contactInfo === undefined ? {} : { contactInfo: params.contactInfo }),
        ...(params.certify === undefined ? {} : { certify: params.certify }),
        ...(params.appearance === undefined ? {} : { appearance: params.appearance }),
        ...(params.timestamp === undefined ? {} : { timestamp: params.timestamp }),
      });
      // EVERY REFUSAL IS A KIND WITH NO FIELDS, so each is answered by its own
      // name. A refusal that grew a field would be a compile error on this line,
      // because the wire member it names has none to receive it.
      if (outcome.kind !== 'signed') return ok({ kind: outcome.kind });
      return ok({
        kind: 'signed',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * `docusign.send`'s handler.
 *
 * The subject and the signers are forwarded as the channel validated them, and the
 * outcome crosses as the command answered it: `sent` with the envelope's id, or one
 * of the contract's refusal kinds, each already named where the knowledge was. The
 * document-state classes are answered by name, and anything else propagates.
 */
function docusignSendHandler(commands: DocumentCommands): ContractHandlers['docusign.send'] {
  return async ({ docId, emailSubject, signers }) => {
    try {
      return ok(await commands.docusignSend(docId, { emailSubject, signers }));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Mints the handle a write's answer carries for the path it wrote (the contract's `WRITTEN`). Every file-writing
 * handler takes this one function rather than the registry, so none can do anything with it but name its own file.
 */
type MintWritten = (destination: string) => FileHandle;

/**
 * `docusign.retrieve`'s handler.
 *
 * The write's outcomes map exactly as `extractHandler` maps them — a dismissed picker
 * is `cancelled`, a contested destination carries how many other documents reach it —
 * and DocuSign's own outcomes cross unchanged.
 */
function docusignRetrieveHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['docusign.retrieve'] {
  return async ({ docId }) => {
    try {
      const outcome = await commands.docusignRetrieve(docId);
      if (outcome === undefined) return ok({ kind: 'cancelled' as const });
      if (outcome.kind === 'copied') return ok({ kind: 'copied' as const, bytes: outcome.bytes, written: mint(outcome.destination) });
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' as const });
      if (outcome.kind === 'refused') {
        return ok({ kind: 'refused' as const, openElsewhere: outcome.others.length });
      }
      return ok(outcome);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The extract's handler.
 *
 * `saveCopyHandler`'s body with one call changed, and written out rather than
 * shared with it: the two map the SAME kernel outcome to the same wire members,
 * and a helper over both would be a single point at which a future divergence —
 * an extract-only refusal, say — becomes a change to the copy path too. Four
 * lines of agreement is cheaper than one shared function that must not
 * diverge.
 */
function extractHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.extract'] {
  return async ({
    docId,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.extract']>>> => {
    try {
      const outcome = await commands.extract(docId, pages);
      // UNDEFINED IS THE USER DISMISSING THE DIALOG, exactly as it is next door.
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      // A RangeError from the kernel — a page this document does not have —
      // falls through to `internal` with its diagnostic kept main-side, which
      // is right: the renderer bounds the list against the page count it holds,
      // so reaching here means the two disagree, and that is a defect rather
      // than something to tell the user about.
      throw thrown;
    }
  };
}

/**
 * The snapshot's handler.
 *
 * {@link extractHandler} with a different request and the same four outcomes,
 * written out for the reason that one is: they map the same kernel outcome to
 * the same wire members today, and a helper over the three would make a future
 * snapshot-only refusal a change to the copy path.
 *
 * A `RangeError` from the kernel — a region with no extent, a scale outside its
 * bounds — falls through to `internal` for `extract`'s reason: the renderer's
 * tool refuses a drag that did not travel and the contract's schema refuses a
 * negative scale, so reaching here means two sides disagree, which is a defect
 * rather than news for the user.
 */
function snapshotRegionHandler(
  commands: DocumentCommands,
  mint: MintWritten,
): ContractHandlers['document.snapshotRegion'] {
  return async ({
    docId,
    page,
    rect,
    scale,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.snapshotRegion']>>> => {
    try {
      const outcome = await commands.snapshot(docId, { page, rect, scale });
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The form-data import's handler.
 *
 * {@link placeImageHandler}'s shape with a different success member, because it
 * is the same route: a picker, a bound-checked read, and a command minted in
 * main carrying bytes the renderer never held.
 */
function importFormDataHandler(
  commands: DocumentCommands,
): ContractHandlers['document.importFormData'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.importFormData']>>> => {
    try {
      const outcome = await commands.importFormData(docId, format);
      if (outcome.kind === 'cancelled') return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'unreadable') return ok({ kind: 'unreadable' } as const);
      if (outcome.kind === 'matched-nothing') return ok({ kind: 'matched-nothing', named: outcome.named } as const);
      if (outcome.kind === 'too-large') {
        return ok({ kind: 'too-large', limitBytes: outcome.limitBytes } as const);
      }
      return ok({
        kind: 'imported',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
        filled: outcome.filled,
        skipped: outcome.skipped,
        more: outcome.more,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The form-data export's handler.
 *
 * {@link snapshotRegionHandler} with one more outcome, and the extra one is
 * why this is written out rather than folded into a shared helper: XFDF cannot
 * carry a control character and the other two formats can, so *this format
 * refused* is a different message from *the write failed* and the only one a
 * person can act on. The kernel throws it as its own class through the host's
 * own code; a widened catch here would report every failure as the format's.
 */
function exportFormDataHandler(
  commands: DocumentCommands,
  mint: MintWritten,
): ContractHandlers['document.exportFormData'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportFormData']>>> => {
    try {
      const outcome = await commands.exportFormData(docId, format);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      // THE ONE REFUSAL WITH AN ACTION ATTACHED, matched on the host's own code
      // rather than on a message: `EngineFormDataExportFailed` carries what the
      // host answered, and `unrepresentable` is the code the export handler
      // returns for a value XML has no escape for.
      if (thrown instanceof EngineFormDataExportFailed && thrown.detail === 'unrepresentable') {
        return ok({ kind: 'unrepresentable' } as const);
      }
      throw thrown;
    }
  };
}

/** The annotation export's handler: {@link exportFormDataHandler}'s body for its outcomes (ADR-0077). */
function exportAnnotationsHandler(
  commands: DocumentCommands,
  mint: MintWritten,
): ContractHandlers['document.exportAnnotations'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportAnnotations']>>> => {
    try {
      const outcome = await commands.exportAnnotations(docId, format);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineAnnotationDataExportFailed && thrown.detail === 'unrepresentable') {
        return ok({ kind: 'unrepresentable' } as const);
      }
      throw thrown;
    }
  };
}

/**
 * The clipboard's copy. The outcome crosses as it is — counts, never marks — and the three
 * document states map to their codes, {@link importAnnotationsHandler}'s shape.
 */
function copyAnnotationsHandler(commands: DocumentCommands): ContractHandlers['document.copyAnnotations'] {
  return async ({
    docId,
    page,
    indices,
    version,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.copyAnnotations']>>> => {
    try {
      return ok(await commands.copyAnnotations(docId, page, indices, version));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** One mark's whole words for an editor, mapped as the clipboard's copy is: both name marks by the walk's handle. */
function annotationWordsHandler(commands: DocumentCommands): ContractHandlers['document.annotationWords'] {
  return async ({
    docId,
    page,
    index,
    version,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.annotationWords']>>> => {
    try {
      return ok(await commands.annotationWords(docId, page, index, version));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Follows one of a document's web links (ADR-0167 Decision 3): the address is read from the document by the link's
 * place, at the version the renderer saw, and opened only when its scheme is one a person may follow. The renderer
 * named a link, never an address, so nothing it holds can widen what is opened.
 */
function openLinkHandler(
  commands: DocumentCommands,
  openLink: (address: string) => Promise<boolean>,
): ContractHandlers['document.openLink'] {
  return async ({ docId, version, page, index }): Promise<Awaited<ReturnType<ContractHandlers['document.openLink']>>> => {
    try {
      const read = await commands.linkAddress(docId, page, index, version);
      if (read.kind !== 'address') return ok({ kind: read.kind });
      if (!isFollowable(read.uri)) {
        return ok({ kind: 'scheme-refused', scheme: shownSchemeOf(read.uri) });
      }
      return ok({ kind: (await openLink(read.uri)) ? 'opened' : 'not-opened' });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The clipboard's paste — main mints the import — mapped as the import is. */
function pasteAnnotationsHandler(commands: DocumentCommands): ContractHandlers['document.pasteAnnotations'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pasteAnnotations']>>> => {
    try {
      const outcome = await commands.pasteAnnotations(docId, page);
      if (outcome.kind !== 'pasted') return ok({ kind: outcome.kind } as const);
      return ok({
        kind: 'pasted',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The annotation import's handler: {@link importFormDataHandler}'s body for its outcomes. */
function importAnnotationsHandler(
  commands: DocumentCommands,
): ContractHandlers['document.importAnnotations'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.importAnnotations']>>> => {
    try {
      const outcome = await commands.importAnnotations(docId, format);
      if (outcome.kind === 'cancelled') return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'unreadable') return ok({ kind: 'unreadable' } as const);
      if (outcome.kind === 'too-large') {
        return ok({ kind: 'too-large', limitBytes: outcome.limitBytes } as const);
      }
      return ok({
        kind: 'imported',
        version: outcome.version,
        byteLength: outcome.byteLength,
        historyDropped: outcome.historyDropped,
      } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The split's handler.
 *
 * {@link extractHandler}'s shape with a different success member — `files`
 * rather than `bytes` — and the same three refusals, because it is the same
 * destination path run several times.
 */
function splitHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.split'] {
  return async ({
    docId,
    split,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.split']>>> => {
    try {
      const outcome = await commands.split(docId, split);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'split') return ok({ kind: 'split', files: outcome.files, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The page-image export's handler: {@link splitHandler} word for word, because it
 * is the same folder write with an image where a document was.
 */
function exportPageImagesHandler(
  commands: DocumentCommands,
  mint: MintWritten,
): ContractHandlers['document.exportPageImages'] {
  return async ({
    docId,
    pages,
    format,
    dpi,
    quality,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportPageImages']>>> => {
    try {
      const outcome = await commands.exportPageImages(docId, { pages, format, dpi, quality });
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'split') return ok({ kind: 'split', files: outcome.files, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The text export's handler: {@link saveCopyHandler}'s outcomes, because it is the
 * same single-file destination path with the document's text where its bytes were.
 */
function exportTextHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.exportText'] {
  return async ({
    docId,
    mode,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportText']>>> => {
    try {
      const outcome = await commands.exportText(docId, mode, pages);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
        case 'write-failed':
          return ok({ kind: 'write-failed' } as const);
        case 'refused':
          return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
        case 'unavailable':
          return ok({ kind: 'unavailable' } as const);
        case 'failed':
          // THE DETAIL STAYS IN MAIN: it names a converter's stderr and paths in a
          // session area, which is diagnostic text the renderer has no use for.
          return ok({ kind: 'failed' } as const);
      }
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The Word export's handler: {@link saveCopyHandler}'s outcomes, a Word file where the bytes were. */
function exportWordHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.exportWord'] {
  return async ({
    docId,
    mode,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportWord']>>> => {
    try {
      const outcome = await commands.exportWord(docId, mode, pages);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The PowerPoint export's handler: {@link saveCopyHandler}'s outcomes, a deck where the bytes were. */
function exportPowerPointHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.exportPowerPoint'] {
  return async ({
    docId,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportPowerPoint']>>> => {
    try {
      const outcome = await commands.exportPowerPoint(docId, pages);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The PDF/A export's handler: a copy's outcomes with the removals, and the converter's two refusals. */
function exportPdfaHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.exportPdfa'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.exportPdfa']>>> => {
    try {
      const outcome = await commands.exportPdfa(docId);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, removed: outcome.removed, tagsDropped: outcome.tagsDropped, written: mint(outcome.destination) } as const);
        case 'refused':
          return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
        case 'write-failed':
        case 'unavailable':
        case 'failed':
          return ok({ kind: outcome.kind });
      }
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** Optimize's measurement (ADR-0087): the command's three answers as they are. */
function optimizeMeasureHandler(commands: DocumentCommands): ContractHandlers['document.optimizeMeasure'] {
  return async ({ docId, setting }): Promise<Awaited<ReturnType<ContractHandlers['document.optimizeMeasure']>>> => {
    try {
      const measured = await commands.optimizeMeasure(docId, setting);
      if (measured.kind === 'measured') {
        return ok({ kind: 'measured', version: measured.version, before: measured.before, after: measured.after } as const);
      }
      return ok({ kind: measured.kind });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** Optimize's copy (ADR-0087): a copy's outcomes, plus not-smaller, changed, unreadable and unavailable. */
function optimizeHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.optimize'] {
  return async ({ docId, setting, version }): Promise<Awaited<ReturnType<ContractHandlers['document.optimize']>>> => {
    try {
      const outcome = await commands.optimize(docId, setting, version);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, before: outcome.before, written: mint(outcome.destination) } as const);
        case 'refused':
          return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
        case 'not-smaller':
          return ok({ kind: 'not-smaller', before: outcome.before, after: outcome.after } as const);
        case 'write-failed':
        case 'changed':
        case 'unreadable':
        case 'unavailable':
          return ok({ kind: outcome.kind });
      }
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** Emailing's handler: the command's three outcomes as they are. */
function emailHandler(commands: DocumentCommands): ContractHandlers['document.email'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.email']>>> => {
    try {
      return ok({ kind: (await commands.email(docId)).kind });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The print's handler: the command's outcomes as they are, and a dismissed dialog as `cancelled`. */
function printHandler(commands: DocumentCommands): ContractHandlers['document.print'] {
  return async ({ docId, dpi, pages }): Promise<Awaited<ReturnType<ContractHandlers['document.print']>>> => {
    try {
      const outcome = await commands.print(docId, dpi, pages);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'printed') return ok({ kind: 'printed', pages: outcome.pages } as const);
      return ok({ kind: outcome.kind });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The Excel export's handler: a copy's outcomes, and `no-tables` before any picker. */
function exportExcelHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.exportExcel'] {
  return async ({
    docId,
    layout,
    engine,
    version,
    edits,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportExcel']>>> => {
    try {
      const outcome = await commands.exportExcel(docId, layout, { version, edits, pages }, engine);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      if (outcome.kind === 'changed') return ok({ kind: 'changed' } as const);
      if (outcome.kind === 'service-refused') return ok({ ...outcome });
      if (outcome.kind === 'no-tables') {
        return ok({ kind: 'no-tables', picturePages: outcome.picturePages } as const);
      }
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

function saveCopyHandler(commands: DocumentCommands, mint: MintWritten): ContractHandlers['document.saveCopy'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.saveCopy']>>> => {
    try {
      const outcome = await commands.saveCopy(docId);
      // UNDEFINED IS THE USER DISMISSING THE DIALOG, and it is an outcome. The
      // kernel returns no value at all for it rather than a fourth member,
      // because nothing ran — see `DocumentCommands.saveCopy`.
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes, written: mint(outcome.destination) } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
      return ok({ kind: 'refused', openElsewhere: outcome.others.length } as const);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * An edit made on a copy, so a signed original keeps its signatures
 * ([ADR-0149](../../../docs/DECISIONS/0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)
 * Decision 5): `saveCopy`'s picker and write, the one open route ({@link openPath}), then the command applied to the
 * copy once its sessions exist, with the version it names re-bound to the copy's.
 *
 * ## The copy stays open whatever its edit does, unless nothing can say why
 *
 * A refusal the person can act on answers `edit-refused` beside the open copy. Anything else is a defect, and it is
 * rethrown so the boundary records it — after the copy is CLOSED, because an answer that is not `edited` or
 * `edit-refused` carries no document, and a document open in `main` that no tab shows is one nobody can close. The
 * copy's file stays where the person put it.
 */
/**
 * A copy to work on, for a document whose own file cannot be written over (cloud-4 7b): {@link editCopyHandler}'s
 * picker, write and the one open route, with no edit. The copy opens as its own document; the original is left as it
 * was.
 */
function workOnCopyHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.workOnCopy'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.workOnCopy']>>> => {
    let copied;
    try {
      copied = await deps.commands.copyToWorkOn(docId);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
    if (copied === undefined) return ok({ kind: 'cancelled' } as const);
    if (copied.outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
    if (copied.outcome.kind === 'refused') {
      return ok({ kind: 'destination-contested', openElsewhere: copied.outcome.others.length } as const);
    }

    const { outcome } = await openPath(deps, copied.destination);
    // UNREACHABLE BY `saveCopy`'s OWN RULE, for `editCopyHandler`'s reason: a destination another open document reaches
    // is refused before anything is written, so the file just written cannot already be open.
    if (outcome.kind === 'already-open') {
      throw new Error('a copy written to work on opened as "already-open", which its write refuses');
    }
    return ok(outcome);
  };
}

/** `workOnCopyHandler`'s mapping of a lane's refusals, once, for the four channels of the versions a save replaced. */
function backupFailure(thrown: unknown): ReturnType<typeof err<{ readonly code: 'document-not-open' | 'document-busy' | 'document-poisoned' }>> {
  if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
  if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
  if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
  throw thrown;
}

function listBackupsHandler(commands: DocumentCommands): ContractHandlers['document.listBackups'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.listBackups']>>> => {
    try {
      return ok({ kind: 'listed', versions: [...(await commands.listBackups(docId))] } as const);
    } catch (thrown) {
      return backupFailure(thrown);
    }
  };
}

function legacyBackupsHandler(commands: DocumentCommands): ContractHandlers['document.legacyBackups'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.legacyBackups']>>> => {
    try {
      const found = await commands.legacyBackups(docId);
      return ok(found === undefined ? ({ kind: 'none' } as const) : ({ kind: 'found', ...found } as const));
    } catch (thrown) {
      return backupFailure(thrown);
    }
  };
}

function moveLegacyBackupsHandler(commands: DocumentCommands): ContractHandlers['document.moveLegacyBackups'] {
  return async ({ docId, move }): Promise<Awaited<ReturnType<ContractHandlers['document.moveLegacyBackups']>>> => {
    try {
      return ok({ kind: 'answered', ...(await commands.moveLegacyBackups(docId, move)) } as const);
    } catch (thrown) {
      return backupFailure(thrown);
    }
  };
}

/**
 * An earlier version written as a copy and opened: {@link workOnCopyHandler}'s route with the version's bytes, and `gone`
 * where the folder no longer holds the id.
 */
function restoreBackupHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.restoreBackup'] {
  return async ({ docId, id }): Promise<Awaited<ReturnType<ContractHandlers['document.restoreBackup']>>> => {
    let copied;
    try {
      copied = await deps.commands.restoreBackup(docId, id);
    } catch (thrown) {
      return backupFailure(thrown);
    }
    if (copied === undefined) return ok({ kind: 'cancelled' } as const);
    if (copied === 'gone') return ok({ kind: 'gone' } as const);
    if (copied.outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
    if (copied.outcome.kind === 'refused') {
      return ok({ kind: 'destination-contested', openElsewhere: copied.outcome.others.length } as const);
    }
    const { outcome } = await openPath(deps, copied.destination);
    // UNREACHABLE FOR THE COPY ROUTE'S OWN REASON: a destination another open document reaches is refused before anything is written.
    if (outcome.kind === 'already-open') {
      throw new Error('an earlier version written as a copy opened as "already-open", which its write refuses');
    }
    return ok(outcome);
  };
}

function editCopyHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.editCopy'] {
  return async ({ docId, command }): Promise<Awaited<ReturnType<ContractHandlers['document.editCopy']>>> => {
    let copied;
    try {
      copied = await deps.commands.copyForEditing(docId, command);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof StaleTargetError) return err({ code: 'stale-target' });
      throw thrown;
    }
    if (copied === undefined) return ok({ kind: 'cancelled' } as const);
    if (copied.outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
    if (copied.outcome.kind === 'refused') {
      return ok({ kind: 'destination-contested', openElsewhere: copied.outcome.others.length } as const);
    }

    const { outcome: opened, sessions } = await openPath(deps, copied.destination);
    // A REFUSED READ TOO, for `appendMarkdownHandler`'s reason: a file this build just wrote can still be held.
    if (opened.kind === 'absent' || opened.kind === 'at-capacity' || opened.kind === 'busy' || opened.kind === 'denied') {
      return ok(opened);
    }
    if (opened.kind !== 'opened') {
      // UNREACHABLE BY `saveCopy`'s OWN RULE: a destination another open document reaches is refused before anything
      // is written, so the file just written cannot already be open.
      throw new Error(`a copy written for editing opened as "${opened.kind}", which its write refuses`);
    }

    // THE COPY'S SESSIONS FIRST, as a merge waits for a source it just opened: the edit runs in them.
    await sessions;
    try {
      const applied = await deps.commands.execute(opened.docId, withTargetVersion(command, opened.version), {
        breakSignatures: true,
      });
      return ok({ ...opened, kind: 'edited', ...applied } as const);
    } catch (thrown) {
      const problem =
        editRefusalOf(thrown) ?? (thrown instanceof DocumentPoisonedError ? ({ code: 'document-poisoned' } as const) : undefined);
      if (problem !== undefined) return ok({ ...opened, kind: 'edit-refused', problem } as const);
      await deps.documents.close(opened.docId);
      deps.recent.closed(opened.docId);
      throw thrown;
    }
  };
}

/**
 * The verdict's kind, and nothing else it carries.
 *
 * Written as an exhaustive narrowing rather than `verdict.kind`, because the
 * two types are not the same set: the kernel's has five members and the wire's
 * has four. Passing the field through would compile today and would silently
 * put a fifth kernel verdict on a wire that does not declare it — a schema
 * failure at the boundary, in production, for a case nobody wrote.
 */
function refusalReason(
  verdict: Exclude<WriteTargetVerdict, { kind: 'sole-writer' }>,
): 'contested' | 'replaced' | 'target-absent' | 'unverifiable' {
  switch (verdict.kind) {
    case 'contested':
      return 'contested';
    case 'replaced':
      return 'replaced';
    case 'target-absent':
      return 'target-absent';
    case 'unverifiable':
      return 'unverifiable';
  }
}

/**
 * Undo, and the whole of it is turning `undefined` into an outcome.
 *
 * `DocumentCommands.undo` answers `undefined` for a log with nothing left,
 * which is a state every document starts in and every document reaches by
 * undoing to the beginning. The channel says `nothing-to-undo` rather than
 * failing, because the renderer's response to it — leave the control alone —
 * is not the response to a defect, and a failure code would make the ordinary
 * end of undoing indistinguishable from one.
 *
 * Everything that IS a failure travels the way `document.execute`'s does:
 * thrown by class and matched by `wrapHandler`. A **terminal** entry is no
 * longer among them — it is restored from its own checkpoint and answers
 * `undone` like any other
 * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
 */
/**
 * Reads the view model, and refuses in exactly the cases a command refuses.
 *
 * ## The same three codes, and the reason is the asymmetry it prevents
 *
 * A read that answered while every command was refused would draw a document
 * nobody can act on — and worse, a *plausible* one: a model is a small array of
 * small numbers, and there is no reading of it a caller can tell from a current
 * one. So `document-poisoned` reaches the renderer here for the same reason it
 * reaches it for a rotate.
 *
 */
function viewModelHandler(commands: DocumentCommands): ContractHandlers['document.viewModel'] {
  return async ({
    docId,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.viewModel']>>> => {
    try {
      return ok(await commands.viewModel(docId, pages));
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Searches one page, refusing in exactly the cases a command refuses.
 *
 * The same three codes and the same reason {@link viewModelHandler} gives, and
 * the asymmetry it prevents is sharper here: a search that answered while every
 * command was refused would tell the user their word is **not in the
 * document**. There is no reading of an empty result list a caller can tell
 * from a real one.
 *
 * **The matches are stripped of their `page` on the way out.** The kernel stamps
 * each with the page it searched; the channel's caller named that page in the
 * request and gets it back unchanged, so carrying it per match would put the
 * same number on the wire once per hit — small, and still a payload growing
 * with the result set for no information (L11's habit, if not its letter).
 */
function searchPageHandler(commands: DocumentCommands): ContractHandlers['document.searchPage'] {
  return async ({
    docId,
    page,
    query,
    limit,
    ...options
  }): Promise<Awaited<ReturnType<ContractHandlers['document.searchPage']>>> => {
    try {
      const { version, matches, truncated } = await commands.searchPage(
        docId,
        page,
        query,
        limit,
        // SPREAD, not four named fields. The schema's optional flags arrive as
        // absent-or-set and the matching rule's defaults live in one module;
        // naming them here would be a place to write `?? false` a second time.
        options,
      );
      return ok({
        version,
        matches: matches.map(({ line, offset, endLine, endOffset, text }) => ({
          line,
          offset,
          endLine,
          endOffset,
          text,
        })),
        truncated,
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof InvalidSearchPatternError) {
        return err({ code: 'search-pattern-invalid' });
      }
      throw thrown;
    }
  };
}

/**
 * One page's text as a selectable layer.
 *
 * The three refusals are `searchPageHandler`'s minus the fourth, and the
 * omission is the point: a search can be asked an unparseable question and this
 * cannot. There is no query here, so `search-pattern-invalid` is not among the
 * codes this channel declares — and a renderer switches on what is declared.
 */
function pageTextLayerHandler(
  commands: DocumentCommands,
): ContractHandlers['document.pageTextLayer'] {
  return async ({
    docId,
    page,
    limit,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageTextLayer']>>> => {
    try {
      const { version, lines, truncated, kind } = await commands.pageTextLayer(docId, page, limit);
      // REBUILT FIELD BY FIELD, as `searchPageHandler` rebuilds a match: the
      // kernel's shape and the channel's are two declarations that happen to
      // agree today, and spreading one into the other is how a field added
      // kernel-side crosses without anyone deciding it should.
      return ok({
        version,
        lines: lines.map(({ text, box }) => ({
          text,
          box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
        })),
        truncated,
        kind,
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * One page's word and character counts.
 *
 * The same three refusals `pageTextLayerHandler` declares, and for the same
 * reason: both read a page's text through an engine session, so a document
 * without one refuses identically. Sharing the shape rather than the code is
 * deliberate — a helper over four lines of `catch` would hide which codes each
 * channel actually declares, and the declaration is what a renderer switches on.
 */
function pageWordCountHandler(
  commands: DocumentCommands,
): ContractHandlers['document.pageWordCount'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageWordCount']>>> => {
    try {
      const { version, words, characters, charactersNoSpaces, lines, cjkCharacters } = await commands.pageWordCount(
        docId,
        page,
      );
      return ok({ version, words, characters, charactersNoSpaces, lines, cjkCharacters });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * One page's tagged structure.
 *
 * Its own four lines of `catch` for `pageWordCountHandler`'s reason. The fields are
 * named rather than spread, so a field the lane adds later is a compile error here
 * rather than something that crosses without the schema having been read.
 */
/** One page's tables for the review grid; a structure read's refusals. */
function pageTablesHandler(commands: DocumentCommands): ContractHandlers['document.pageTables'] {
  return async ({ docId, page }): Promise<Awaited<ReturnType<ContractHandlers['document.pageTables']>>> => {
    try {
      const { version, pageCount, tables, truncated } = await commands.pageTables(docId, page);
      return ok({ version, pageCount, tables, truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

function pageStructureHandler(
  commands: DocumentCommands,
): ContractHandlers['document.pageStructure'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageStructure']>>> => {
    try {
      const { version, nodes, truncated, untaggedLines, images } = await commands.pageStructure(
        docId,
        page,
      );
      // NAMED FIELD BY FIELD: the document's own name for an element (`raw`) is held by the kernel and never sent, so a
      // field added to a node there is not on the wire until somebody decides it should be (ADR-0183).
      return ok({
        version,
        nodes: nodes.map(({ role, depth, lines, box }) => ({ role, depth, lines, box })),
        truncated,
        untaggedLines,
        images,
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * One page's links, with internal destinations already resolved.
 *
 * The three refusals are `searchPageHandler`'s, for the same reason: a link
 * read needs an engine session, so a document that has none refuses in exactly
 * the ways a search does. Sharing the shape rather than the code is deliberate
 * — a helper over four lines of `catch` would hide which codes each channel
 * actually declares, and the declaration is what a renderer switches on.
 */
function pageLinksHandler(commands: DocumentCommands): ContractHandlers['document.pageLinks'] {
  return async ({
    docId,
    page,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageLinks']>>> => {
    try {
      const read = await commands.pageLinks(docId, page);
      const part = listPart(read.links, read.truncated, from, PAGE_LINKS_PART);
      return ok({ version: read.version, links: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** One page's word boxes (ADR-0137), with the link read's three refusals for its reason. */
function pageWordBoxesHandler(commands: DocumentCommands): ContractHandlers['document.pageWordBoxes'] {
  return async ({ docId, page }): Promise<Awaited<ReturnType<ContractHandlers['document.pageWordBoxes']>>> => {
    try {
      const { version, lines, truncated } = await commands.pageWordBoxes(docId, page);
      return ok({ version, lines: lines.map((line) => ({ text: line.text, box: { ...line.box }, boxes: [...line.boxes] })), truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * One part of a list that grows with the document: at most `size` items beginning at `from`, where the next part
 * begins, and the walk's `truncated` on the LAST part only
 * ([ADR-0130](../../../docs/DECISIONS/0130-a-documents-size-never-refuses-an-action.md) Decision 2).
 *
 * The one place a part is cut, for every channel that answers in parts — a second slicing would be a second
 * opinion about where a part ends (B3a). The whole list is read for each part; the read is the one that already
 * crossed whole, and caching it per version is an economy, not a correctness question. A `from` past the end answers
 * an empty last part rather than a refusal: the list is shorter than the caller thought, which is an answer.
 */
export function listPart<T>(
  whole: readonly T[],
  truncated: boolean,
  from: number,
  size: number,
): { readonly items: readonly T[]; readonly next: number | null; readonly truncated: boolean } {
  const end = from + size;
  const next = end < whole.length ? end : null;
  return { items: whole.slice(from, end), next, truncated: next === null && truncated };
}

/**
 * The document's outline, flattened, a part at a time.
 *
 * The three refusals are the two readers above's, and for the same reason: an
 * outline read needs an engine session.
 */
function destinationsHandler(
  commands: DocumentCommands,
): ContractHandlers['document.destinations'] {
  return async ({
    docId,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.destinations']>>> => {
    try {
      const read = await commands.destinations(docId);
      const part = listPart(read.destinations, read.truncated, from, DESTINATIONS_PART);
      return ok({ version: read.version, destinations: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The document's layers. A READ — the toggle is a command through
 * `document.execute`, so there is no mutating handler here.
 */
function layersHandler(commands: DocumentCommands): ContractHandlers['document.layers'] {
  return async ({ docId, from }): Promise<Awaited<ReturnType<ContractHandlers['document.layers']>>> => {
    try {
      const read = await commands.layers(docId);
      const part = listPart(read.layers, read.truncated, from, LAYERS_PART);
      return ok({ version: read.version, layers: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The document's signatures. `layersHandler`'s shape, with one code more:
 * `engine-unavailable` for a build with no host, which is what a `read`
 * needing a session answers when there is none.
 */
function signaturesHandler(
  commands: DocumentCommands,
): ContractHandlers['document.signatures'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.signatures']>>> => {
    try {
      const { signatures, unreadable } = await commands.signatures(docId);
      return ok({ signatures: signatures.map((signature) => ({ ...signature })), unreadable });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof MissingSessionError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * The document's duplicate pages. A READ, for `layersHandler`'s reason: what a
 * person does with the list is delete pages, and deleting is a command.
 */
function annotationsHandler(
  commands: DocumentCommands,
): ContractHandlers['document.annotations'] {
  return async ({
    docId,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.annotations']>>> => {
    try {
      const read = await commands.annotations(docId);
      const part = listPart(read.annotations, read.truncated, from, ANNOTATIONS_PART);
      return ok({ version: read.version, annotations: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The document's form fields. A READ, for `annotationsHandler`'s reason: what a
 * person does with a field is fill it, and filling is a command.
 */
/**
 * The candidate proposal's handler.
 *
 * {@link formFieldsHandler} with a page and one refusal fewer: the channel
 * declares no `document-busy`, because a read that mutates nothing has no
 * reason to queue behind a command — `document.searchPage`'s argument. A busy
 * error reaching here would therefore be a defect, and it is left to throw.
 */
function flatFieldCandidatesHandler(
  commands: DocumentCommands,
): ContractHandlers['document.flatFieldCandidates'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.flatFieldCandidates']>>> => {
    try {
      const { version, candidates, truncated, alreadyFields } = await commands.flatFieldCandidates(docId, page);
      return ok({ version, candidates, truncated, alreadyFields });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/** The named fields' properties: {@link flatFieldCandidatesHandler}'s body and its refusals (ADR-0193). */
function formFieldPropertiesHandler(commands: DocumentCommands): ContractHandlers['document.formFieldProperties'] {
  return async ({ docId, fields }): Promise<Awaited<ReturnType<ContractHandlers['document.formFieldProperties']>>> => {
    try {
      const { version, fields: read } = await commands.formFieldProperties(docId, fields);
      return ok({ version, fields: read });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The editing engine's text-object list.
 *
 * {@link flatFieldCandidatesHandler} against the other engine, plus the one
 * refusal only this pair of channels has: an installation without PDFium
 * answers `engine-unavailable` rather than throwing into `internal`. That is
 * the read half of what `executeCommandHandler` does for the command half, and
 * it matters MORE here — a surface asks this first, so it is where a person
 * finds out before being offered anything.
 */
function textBlocksHandler(commands: DocumentCommands): ContractHandlers['document.textBlocks'] {
  return async ({
    docId,
    page,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.textBlocks']>>> => {
    try {
      const { version, blocks, truncated, rotated, angled, unaddressable, rewrite } = await commands.textBlocks(docId, page);
      // A PART AT A TIME (ADR-0130): a dense page is thousands of blocks, and answered whole it was refused by the
      // contract's bound as `internal` (AAAAAAA-1). The page's counts and its writer ride on every part; they are the
      // page's.
      const part = listPart(blocks, truncated, from, TEXT_BLOCKS_PART);
      return ok({ version, blocks: part.items, next: part.next, truncated: part.truncated, rotated, angled, unaddressable, rewrite });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * A page's translation (ADR-0097): read the page's blocks as `document.textBlocks` reads them, ask
 * once, answer the blocks that changed as `editTextBlock` names them.
 *
 * ## Each block's text is its PARAGRAPHS: `lineText` per line, soft wraps joined
 *
 * Lines are read with `lineText`, the rule the kernel diffs with, and joined by `paragraphsOfLines` on the
 * `soft` the read answered for each: where the next line's first word would not have fitted, the break was the
 * typesetter's and becomes a space; otherwise it stays a line break (ADR-0097 4c, ADR-0179). The words are the
 * editor's own words for the same block, from the same join, and the answer carries the same soft ends, so
 * the kernel writes each translated paragraph over its own and re-wraps what no longer fits. An unchanged block is not answered:
 * rewriting it would regenerate content for nothing, and a translation that changed nothing is
 * `nothing-to-translate`.
 *
 * ## An answer longer than a page's edit may carry is unreadable, not cut
 *
 * `MAX_EDIT_TEXT` bounds what one block edit writes, every block's words together (ADR-0142); a
 * translation past it would have to be cut to fit, and a translation cut mid-sentence is a wrong one.
 * So the whole answer is refused. A single block is bounded by nothing smaller.
 */
function translatePageHandler(deps: {
  readonly commands: DocumentCommands;
  readonly assistant: Assistant;
}): ContractHandlers['ai.translatePage'] {
  return async ({ docId, page, provider, model, language, only }) => {
    let read: Awaited<ReturnType<DocumentCommands['textBlocks']>>;
    try {
      read = await deps.commands.textBlocks(docId, page);
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
    // A PARAGRAPH, not its lines (ADR-0097 4c): soft wraps joined, hard breaks kept, so the kernel
    // re-wraps the translation as one paragraph instead of keeping each old line's break.
    const allTexts = read.blocks.map((block) =>
      paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft }))),
    );
    // A SELECTION TRANSLATES THE BLOCKS THAT HOLD IT and no others: the words are matched with the whitespace collapsed
    // (a selection crosses the soft wraps the paragraph joined), and a block that does not hold them is not sent to the
    // provider and not written. The write is the page's own per-page command, so no writer is touched.
    const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();
    const selected = only === undefined ? undefined : squash(only);
    const texts = allTexts.map((text) => (selected === undefined || squash(text).includes(selected) ? text : ''));
    if (texts.every((text) => text.trim() === '')) return ok({ kind: 'nothing-to-translate' } as const);

    // ASKED AT MOST TWICE, and only again when the answer could not be READ. Measured 2026-09-24 over
    // the corpus's five first pages with text, twice each: one answer in ten was not valid JSON — a
    // model's slip, not the page — and a second ask read cleanly. A provider's refusal is never
    // asked again: it would be refused again, and paid for again.
    let translated: readonly string[] | undefined;
    for (let attempt = 0; attempt < 2 && translated === undefined; attempt += 1) {
      const answer = await deps.assistant.complete({
        provider,
        model,
        system: translationInstruction(TRANSLATION_LANGUAGES[language]),
        messages: [{ role: 'user', text: translationRequest(texts) }],
      });
      if (answer.refusal !== undefined) return ok({ kind: 'refused', problem: answer.refusal } as const);
      translated = readTranslation(answer.text, texts.length);
    }
    if (translated === undefined) return ok({ kind: 'refused', problem: 'unreadable' } as const);
    const blocks = read.blocks.flatMap((block, at) => {
      const text = translated[at];
      // A BLOCK THAT WAS NOT ASKED ABOUT (blank, or not holding the selection) is never written, whatever the provider
      // answered for its empty slot.
      return text === undefined || text === texts[at] || (texts[at] ?? '').trim() === ''
        ? []
        : [{ lines: block.lines.map((line) => line.runs.map((run) => run.index)), soft: block.lines.map((line) => line.soft), text }];
    });
    if (blocks.length === 0) return ok({ kind: 'nothing-to-translate' } as const);
    // A BLOCK'S WORDS ARE BOUNDED ONLY BY THE PAGE'S (ADR-0142): a translated paragraph past 4,096 characters was
    // refused here as an answer that could not be read, blaming the provider for an ordinary page (table A row 10).
    // The page's text past `MAX_EDIT_TEXT` is a model that wrote far more than it was given, which that refusal names.
    const edit = blockEditOf(blocks);
    if (edit.text.length > MAX_EDIT_TEXT) return ok({ kind: 'refused', problem: 'unreadable' } as const);
    return ok({ kind: 'translated', version: read.version, edit, rewrite: read.rewrite } as const);
  };
}

/**
 * A selection's words translated through the page translation's own instruction and reading of the answer, so the two
 * cannot differ about what a translation is (B3a). One block, one ask, asked again only when the answer could not be read.
 */
function translateTextHandler(deps: { readonly assistant: Assistant }): ContractHandlers['ai.translateText'] {
  return async ({ text, provider, model, language }) => {
    let translated: readonly string[] | undefined;
    for (let attempt = 0; attempt < 2 && translated === undefined; attempt += 1) {
      const answer = await deps.assistant.complete({
        provider,
        model,
        system: translationInstruction(TRANSLATION_LANGUAGES[language]),
        messages: [{ role: 'user', text: translationRequest([text]) }],
      });
      if (answer.refusal !== undefined) return ok({ kind: 'refused', problem: answer.refusal } as const);
      translated = readTranslation(answer.text, 1);
    }
    const first = translated?.[0];
    if (first === undefined) return ok({ kind: 'refused', problem: 'unreadable' } as const);
    return ok({ kind: 'translated', text: first.slice(0, MAX_TRANSLATED_TEXT) } as const);
  };
}

/** {@link textBlocksHandler}'s three refusals on the other PDFium read. */
function pageObjectsHandler(commands: DocumentCommands): ContractHandlers['document.pageObjects'] {
  return async ({
    docId,
    page,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageObjects']>>> => {
    try {
      const { version, objects, truncated } = await commands.pageObjects(docId, page);
      // A PART AT A TIME, `textBlocksHandler`'s reason: a page drawn one glyph per object is thousands of objects.
      const part = listPart(objects, truncated, from, PAGE_OBJECTS_PART);
      return ok({ version, objects: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * One page drawn by the editing engine, with BOTH bounds enforced here.
 *
 * ## The pixel cap is checked BEFORE the engine is asked
 *
 * A raster this boundary would refuse costs nothing to refuse early and costs a
 * rasterisation to refuse late. That ordering is also what makes the two bounds
 * mean different things: `MAX_RASTER_PIXELS` bounds the WORK and is a property
 * of the request, `MAX_RASTER_BYTES` bounds the ANSWER and is a property of what
 * the page turned out to be.
 *
 * ## And the byte cap is checked here rather than left to the schema
 *
 * The result schema refuses an over-long buffer, and a refusal there is a
 * boundary VIOLATION — `internal` plus an incident id, the shape reserved for a
 * defect. A page that compresses badly at a legal size is not a defect; it is an
 * outcome a person can act on by zooming out. So it is refused by name, and the
 * schema's own bound stays as the thing that catches a handler which forgot.
 */
function renderPageHandler(commands: DocumentCommands): ContractHandlers['document.renderPage'] {
  return async ({
    docId,
    page,
    width,
    height,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.renderPage']>>> => {
    if (width * height > MAX_RASTER_PIXELS) return err({ code: 'raster-too-large' });
    try {
      const raster = await commands.renderPage(docId, page, width, height);
      if (raster.png.length > MAX_RASTER_BYTES) return err({ code: 'raster-too-large' });
      return ok({
        version: raster.version,
        width: raster.width,
        height: raster.height,
        png: raster.png,
      });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/**
 * A block's run fonts (ADR-0175). The caps are held where the bytes are made and where they cross — the host's channel
 * and this channel's own schema — so nothing is checked here twice; the lane's refusals are named, and anything else is
 * a defect that is recorded as one.
 */
function runFontsHandler(commands: DocumentCommands): ContractHandlers['document.runFonts'] {
  return async ({ docId, page, indices }): Promise<Awaited<ReturnType<ContractHandlers['document.runFonts']>>> => {
    try {
      const { version, fonts, runs } = await commands.runFonts(docId, page, indices);
      return ok({ version, fonts, runs });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

function formFieldsHandler(commands: DocumentCommands): ContractHandlers['document.formFields'] {
  return async ({
    docId,
    from,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.formFields']>>> => {
    try {
      const read = await commands.formFields(docId);
      const part = listPart(read.fields, read.truncated, from, FORM_FIELDS_PART);
      return ok({ version: read.version, fields: part.items, next: part.next, truncated: part.truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

function duplicatePagesHandler(
  commands: DocumentCommands,
): ContractHandlers['document.duplicatePages'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.duplicatePages']>>> => {
    try {
      const { version, groups, truncated } = await commands.duplicates(docId);
      return ok({ version, groups, truncated });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * Closes a document, and deliberately does NOT revoke its handle.
 *
 * `mint` is idempotent per path, and `document.recent` mints one for every
 * entry it answers with — so the handle for a document that has just closed is
 * the same token the recent list hands the renderer for that file. Revoking it
 * here would invalidate a capability the renderer is holding and did nothing
 * wrong to obtain, and the failure would surface later as an `unknown-handle`
 * on a row the user clicked.
 *
 * That is `openDocumentHandler`'s finding read the other way round: the tidy-up
 * that looks symmetric is wrong wherever two callers share a token. The
 * registry is per-run, so nothing accumulates across restarts, and a path a
 * user opened once is a path main already keeps in the recent list.
 *
 * **The boolean is decided BEFORE the close**, because `close` returns `void`
 * for a document that was never open and for one it tore down alike.
 */
function closeHandler(deps: {
  readonly documents: DocumentService;
  readonly recent: RecentFiles;
}): ContractHandlers['document.close'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.close']>>> => {
    const wasOpen = deps.documents.openDocIds().includes(docId);
    await deps.documents.close(docId);
    // AFTER the close rather than before it: this list is what a crash would
    // leave behind, and a document dropped from it while main still held it
    // would be one a recovery never offered.
    deps.recent.closed(docId);
    return ok({ closed: wasOpen });
  };
}

/**
 * Whether a document has changes its file does not, read IN ITS LANE.
 *
 * `DocumentContext.isDirty` is the one reader of `savedVersion !== version`, and the lane is
 * what keeps a command that is bumping from producing a stale **clean** — the answer that
 * closes without asking. Matched on the class for the two declared codes, like every other
 * per-document handler here.
 */
function unsavedHandler(documents: DocumentService): ContractHandlers['document.unsaved'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.unsaved']>>> => {
    try {
      const { value } = await documents.run(docId, (context) => Promise.resolve(context.isDirty()));
      return ok({ unsaved: value });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      throw thrown;
    }
  };
}

function undoHandler(commands: DocumentCommands): ContractHandlers['document.undo'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.undo']>>> => {
    try {
      const applied = await commands.undo(docId);
      return ok(
        applied === undefined
          ? ({ kind: 'nothing-to-undo' } as const)
          : ({ kind: 'undone', ...applied } as const),
      );
    } catch (thrown) {
      // MATCHED ON THE CLASS, never on the message — the reason
      // `DocumentNotOpenError` exists as a class at all. Each of these is an
      // outcome the renderer can act on; everything else is rethrown and
      // becomes `internal` with the diagnostic recorded main-side.
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      // AN UNDO RUNS THE SAME REWRITE as the edit it reverses, read back the same way (ADR-0169), so it is refused the
      // same way, and the person reads the same sentence.
      const refusal = rewriteRefusalOf(thrown);
      if (refusal !== undefined) return err(refusal);
      throw thrown;
    }
  };
}

/** Redo: {@link undoHandler} one direction along — `undefined` is `nothing-to-redo`, the rest by class. */
function redoHandler(commands: DocumentCommands): ContractHandlers['document.redo'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.redo']>>> => {
    try {
      const applied = await commands.redo(docId);
      return ok(
        applied === undefined
          ? ({ kind: 'nothing-to-redo' } as const)
          : ({ kind: 'redone', version: applied.version, byteLength: applied.byteLength } as const),
      );
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      const refusal = rewriteRefusalOf(thrown);
      if (refusal !== undefined) return err(refusal);
      throw thrown;
    }
  };
}

/**
 * Picker → mint → open, and the handle's lifetime around the outcomes.
 *
 * ## The order is the invariant
 *
 * Main picks, main mints, the kernel opens. Nothing in this sequence is
 * reachable from the renderer's request, which carried no parameters, so
 * "opened the wrong file" is not a state a renderer can steer into.
 *
 * ## THE HANDLE IS REVOKED ON EVERY OUTCOME THAT HOLDS NO DOCUMENT, AND NOT ON `already-open`
 *
 * `absent`, `at-capacity`, `busy` and `denied` leave nothing holding the handle:
 * the service did not take it, so without a revoke a user repeatedly picking
 * missing files would grow the registry once per distinct path, forever.
 * {@link HOLDS_NO_DOCUMENT} names every outcome, so one the service gains
 * decides there whether its handle stays.
 *
 * `already-open` is the one that must **not** be revoked, and the reason is a
 * property of `mint` rather than of this function. Minting is *idempotent per
 * path* — deliberately, so that opening the same file twice does not mint twice
 * — which means the handle returned here for an already-open document **is the
 * live document's handle**. Revoking it would strip the capability out from
 * under a document that is open and working, and the failure would surface
 * later, somewhere else, as a resolve that throws.
 *
 * That is the whole finding: the tidy-up that looks symmetric across every
 * outcome is correct on the refusals, harmless on the one that took the handle,
 * and destructive on the one where two callers share it.
 */
/**
 * Fetches a PDF from a URL through the SSRF guard, and opens the file it wrote
 * ([ADR-0061](../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
 *
 * The file opens through {@link openPath}, `newFromImportHandler`'s route: a fetched
 * document is opened exactly as a picked one is. The outcomes before the open are
 * answered member by member, for `composeRefusal`'s reason.
 */
function openFromUrlHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.openFromUrl'] {
  return async ({ url }): Promise<Awaited<ReturnType<ContractHandlers['document.openFromUrl']>>> => {
    const fetched = await deps.commands.openFromUrl(url);
    switch (fetched.kind) {
      case 'cancelled':
        return ok({ kind: 'cancelled' });
      case 'url-refused':
        return ok({ kind: 'url-refused', reason: fetched.reason });
      case 'destination-contested':
        return ok({ kind: 'destination-contested', openElsewhere: fetched.openElsewhere });
      case 'write-failed':
        return ok({ kind: 'write-failed' });
      case 'written':
        return ok((await openPath(deps, fetched.destination)).outcome);
    }
  };
}

/**
 * Converts a picked Office file to a PDF on disk with the contained `x2t`, and opens it
 * ([ADR-0120](../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * {@link openFromUrlHandler}'s route: the written file opens through {@link openPath}, and every
 * outcome before the open is answered member by member.
 */
function newFromOfficeHandler(
  deps: OpenPathParts & { readonly commands: DocumentCommands },
): ContractHandlers['document.newFromOffice'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.newFromOffice']>>> => {
    let converted: Awaited<ReturnType<DocumentCommands['convertOfficeFile']>>;
    try {
      converted = await deps.commands.convertOfficeFile();
    } catch (thrown) {
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
    switch (converted.kind) {
      case 'cancelled':
        return ok({ kind: 'cancelled' });
      case 'too-large':
        return ok({ kind: 'too-large', limitBytes: converted.limitBytes });
      case 'unreadable':
        return ok({ kind: 'unreadable' });
      case 'conversion-failed':
        return ok({ kind: 'conversion-failed' });
      case 'destination-contested':
        return ok({ kind: 'destination-contested', openElsewhere: converted.openElsewhere });
      case 'write-failed':
        return ok({ kind: 'write-failed' });
      case 'written': {
        const opened = (await openPath(deps, converted.destination)).outcome;
        // THE ROWS NOT IN IT RIDE WITH THE OPEN (decision C): a document that opened is told which rows it lacks, and
        // an open that answered anything else answers that — the file on disk is the same either way.
        if (opened.kind !== 'opened' || converted.missing.length === 0) return ok(opened);
        const told = toldBlocks(converted.missing);
        return ok({ ...opened, kind: 'opened-incomplete', missing: [...told.missing], more: told.more });
      }
    }
  };
}

function openDocumentHandler(deps: OpenPathParts & { readonly pickDocument: PickDocument }): ContractHandlers['document.open'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.open']>>> => {
    const picked = await deps.pickDocument();
    if (picked === null) return ok({ kind: 'cancelled' } as const);
    return ok((await openPath(deps, picked)).outcome);
  };
}

/**
 * The several-files picker a harness without one is offered: its one-file picker, read as a list of at most one.
 * The shipped build supplies the real multiple-selection dialog, so this is the one place the two shapes meet.
 */
function severalPickerOf(deps: { readonly pickDocument: PickDocument; readonly pickDocuments?: PickDocuments }): PickDocuments {
  if (deps.pickDocuments !== undefined) return deps.pickDocuments;
  return async () => {
    const one = await deps.pickDocument();
    return one === null ? [] : [one];
  };
}

/**
 * Opens each path through {@link openPath}, in the order given, and answers one outcome per file BY NAME.
 *
 * ## ONE FILE'S FAILURE IS THAT FILE'S
 *
 * Each open is its own awaited call, and an outcome that is not `opened` — `absent`, `denied`, `busy`, `at-capacity` —
 * is an entry like any other, so the files after it still open. The paths are main's own — a dialog's, or
 * `documentPathsIn`'s, which has already kept only absolute ones — so none is checked again here. **One at a time**, as
 * a drop is: each open takes the byte ceiling the next one is measured against, and the tabs arrive in the order the
 * files were listed.
 *
 * The name is the file's own, never its path (L2), cut to the contract's bound.
 */
async function openNamed(
  deps: OpenPathParts,
  paths: readonly string[],
): Promise<ChannelResult<'document.openSeveral'>['opened']> {
  const opened: ChannelResult<'document.openSeveral'>['opened'] = [];
  for (const path of paths) {
    const name = win32.basename(path).slice(0, MAX_DOCUMENT_NAME_LENGTH) || 'a file';
    opened.push({ name, outcome: (await openPath(deps, path)).outcome });
  }
  return opened;
}

/** The Open dialog with a multiple selection: main picks, and each file opens as its own document. */
function openSeveralHandler(
  deps: OpenPathParts & { readonly pickDocument: PickDocument; readonly pickDocuments?: PickDocuments },
): ContractHandlers['document.openSeveral'] {
  const pick = severalPickerOf(deps);
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.openSeveral']>>> => {
    const picked = await pick();
    return ok({ opened: await openNamed(deps, picked.slice(0, MAX_PICKED_DOCUMENTS)) });
  };
}

/**
 * Opens a dropped file through {@link openPath}, the one route every open takes.
 *
 * **An empty or relative path is refused by name** (`no-path`), before anything is minted or read.
 * `getPathForFile` answers an empty string for a `File` that did not come from the operating system — one
 * a page built, or an item dragged out of another program that is not a file here — and a relative path
 * would resolve against whatever main's working directory happens to be, which is nothing a person chose.
 */
function openDroppedHandler(deps: OpenPathParts): PreloadHandlers['document.openDropped'] {
  return async ({ path }) => {
    if (path === '' || !isAbsolute(path)) return ok({ kind: 'no-path' } as const);
    return ok((await openPath(deps, path)).outcome);
  };
}

/**
 * Whether an open's outcome left the handle it was given held by nothing, so {@link openPath} revokes it — the open
 * handler's header has why `already-open` must not be. A `Record`, so an outcome the service gains is a compile error
 * here until somebody decides.
 */
const HOLDS_NO_DOCUMENT: Readonly<Record<Awaited<ReturnType<DocumentService['open']>>['kind'], boolean>> = {
  opened: false,
  'already-open': false,
  absent: true,
  'at-capacity': true,
  busy: true,
  denied: true,
};

/** What {@link openPath} opens a document through. */
interface OpenPathParts {
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly recent: RecentFiles;
  readonly recentPictures: RecentPictures;
  /** Links a document opened from a cloud working copy to its cloud file, by the copy's path; a no-op for any other. */
  readonly cloud: Pick<CloudStorage, 'link'>;
}

/**
 * Opens the file at a path main already holds as a document on screen, answering
 * the channel's outcome and — for a document this call opened — the promise that
 * settles when its engine sessions exist.
 *
 * ## ONE WAY TO OPEN A DOCUMENT, and this is it
 *
 * ADR-0040 Decision 2 refuses a hidden transient open because a second route would
 * answer identity, dedup, the handle, the byte ceiling and the session again. So
 * picking a file, and composing one from Markdown
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)
 * and its correction), reach the document through this one sequence rather than two
 * copies of it.
 *
 * ## The sessions promise is RETURNED, and `document.open` ignores it
 *
 * `onDocumentOpened` says a caller that wants to know may wait: a document opens
 * whether or not an engine is available. The picker path does not wait, as before.
 * A caller that must use the document's sessions next — a merge naming it as a
 * source — waits, or the merge can reach the bus first and be refused.
 */
async function openPath(
  deps: OpenPathParts,
  path: string,
): Promise<{
  // THE SERVICE'S OWN OUTCOME, not a channel's: `document.open` adds `cancelled`
  // and this never produces it, while `document.openRecent` answers exactly this.
  readonly outcome: Awaited<ReturnType<DocumentService['open']>>;
  readonly sessions: Promise<void>;
}> {
  const handle = deps.capabilities.mint(path);
  const outcome = await deps.documents.open(handle);

  if (HOLDS_NO_DOCUMENT[outcome.kind]) deps.capabilities.revoke(handle);

  // A WORKING COPY IS ITS CLOUD FILE HOWEVER IT IS OPENED (CR-DOC-02). Linked here, the one way to open a document,
  // rather than in the two cloud channels alone: a copy reopened from Recent, the last session or the picker opened as
  // a local file, so its Save back said not-from-cloud and its edits stayed on this disk. `link` answers by the
  // copy's path and does nothing for any other.
  if (outcome.kind === 'opened' || outcome.kind === 'already-open') deps.cloud.link(outcome.docId, path);

  // ONLY FOR A DOCUMENT THIS CALL OPENED, and `already-open` is the outcome
  // that makes the distinction load-bearing rather than pedantic: that
  // document has a session or is poisoned already, and a second entry for it
  // would spend Decision 9a's failure bound a second time on a document that
  // never failed.
  if (outcome.kind === 'opened') {
    const sessions = deps.openedDocument(outcome.docId);
    // RECORDED HERE, where the path and the name are both in hand. Recording
    // in the service would put a list of paths inside the thing that holds
    // documents; recording in the renderer is impossible, which is L2 doing
    // its job.
    deps.recent.record({ path, name: outcome.name });
    // AND RECORDED AS OPEN. The recent list is *what this user has looked
    // at*; the session is *what is on screen now*, which is what a crash
    // recovery has to offer once several documents can be.
    deps.recent.opened(outcome.docId, { path, name: outcome.name });
    // AND ITS PICTURE, once the session a person's own open created exists (ADR-0100). Not awaited: the
    // document is on screen already, and the card needs the picture only on the next start screen. The
    // sessions promise settles either way, and a capture reports its own failure.
    const opened = outcome.docId;
    void sessions.then(() => deps.recentPictures.capture(opened, path));
    return { outcome, sessions };
  }

  return { outcome, sessions: Promise.resolve() };
}

/** The recent list, with a handle per entry rather than a path. */
function recentHandler(deps: {
  readonly capabilities: CapabilityRegistry;
  readonly recent: RecentFiles;
  readonly recentRoots: readonly KnownRoot[];
  readonly fileIdentity: IdentityReader;
}): ContractHandlers['document.recent'] {
  /**
   * Whether an open of this path would find a file (ADR-0143). `null` is the open's own `absent`; a read that THROWS is
   * unavailable too, because an open would fail on it as well, and drawing it as one that opens is the fail-open.
   */
  const available = async (path: string): Promise<boolean> => {
    try {
      return (await deps.fileIdentity(path)) !== null;
    } catch {
      return false;
    }
  };

  /**
   * THE CHECKS STILL OWED AN ASK, one per path. A check still running is shared by every read that arrives while it
   * runs, so a network drive that has gone costs one `stat` and not one per read. A check that answers is the answer to
   * the reads that were waiting on it and to the FIRST read after it lands, and is then dropped — so nothing is stored
   * past the question it answers, the next read asks the disk again (ADR-0143: *read at each ask*), and a check slower
   * than every read's wait still reaches the view that keeps asking.
   */
  interface Check {
    done: Promise<boolean>;
    answer: boolean | null;
  }
  const checks = new Map<string, Check>();
  const checkOf = (path: string): Check => {
    const held = checks.get(path);
    if (held !== undefined) return held;
    // THE ANSWER IS RECORDED INSIDE THE PROMISE every read awaits, so a read that saw it settle reads it recorded.
    const fresh: Check = { done: Promise.resolve(false), answer: null };
    fresh.done = available(path).then((value) => {
      fresh.answer = value;
      return value;
    });
    checks.set(path, fresh);
    return fresh;
  };
  /** What a check says to this read; an answered one is dropped here, having answered. */
  const readOf = (path: string, check: Check): RecentAvailability => {
    if (check.answer === null) return 'checking';
    if (checks.get(path) === check) checks.delete(path);
    return check.answer ? 'available' : 'unavailable';
  };
  return async () => {
    const listed = deps.recent.list();
    const session = deps.recent.lastSession();
    // ALL AT ONCE, off the event loop: each is a `stat` and a `realpath` on the thread pool, so ten entries cost the
    // slowest one rather than the sum — and that slowest one is waited for at most RECENT_CHECK_CAP_MS, so the list
    // shows at once and a file still being looked for says `checking` (the owner's answer, cloud-4 7d).
    // EACH ENTRY PAIRED WITH ITS CHECK, so the answer read back is the one asked for that entry. A file in both lists
    // shares one check, and each list reads it from the object it holds.
    const entries = listed.map((entry) => ({ entry, check: checkOf(entry.path) }));
    const sessions = session.map((entry) => ({ entry, check: checkOf(entry.path) }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...entries, ...sessions].map(({ check }) => check.done)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RECENT_CHECK_CAP_MS);
      }),
    ]);
    clearTimeout(timer);
    return ok({
      // MINTED HERE, not stored. `mint` is idempotent per path, so the handle
      // an entry carries is the same one that document would have if opened —
      // and minting at the boundary rather than persisting the token means a
      // list written by a previous run cannot carry a capability into this
      // one.
      entries: entries.map(({ entry, check }) => ({
        handle: deps.capabilities.mint(entry.path),
        name: entry.name,
        // DERIVED HERE, from the path that never crosses: a known folder and one folder's name (ADR-0100).
        location: displayLocationOf(entry.path, deps.recentRoots),
        openedAt: entry.openedAt,
        availability: readOf(entry.path, check),
      })),
      lastExitClean: deps.recent.lastExitClean(),
      // THE SAME MINTING, for the same reason. These entries are paths the
      // previous run recorded as open; a handle minted here is one this run
      // can resolve, and a token persisted across runs would be a capability
      // surviving the process that granted it.
      lastSession: sessions.map(({ entry, check }) => ({
        handle: deps.capabilities.mint(entry.path),
        name: entry.name,
        availability: readOf(entry.path, check),
      })),
    });
  };
}

/**
 * Opens a document the recent list named.
 *
 * The picker is skipped and nothing else is: the same service, the same
 * revocation rule, the same recording. What replaces the picker is a handle
 * main minted for a path main recorded, which is the whole of why a renderer
 * naming a file here is not a renderer choosing one.
 *
 * **A file that has gone is KEPT** ([ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)).
 * `absent` here answers this open and nothing more: the entry stays, and the next read of the list carries it as
 * unavailable, drawn disabled and saying so. Until 2026-10-03 it was forgotten, which lost a file on a drive that was
 * only disconnected — and the owner's rule for the list is *never hidden*.
 */
function openRecentHandler(deps: OpenPathParts): ContractHandlers['document.openRecent'] {
  return async ({
    handle,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.openRecent']>>> => {
    const path = deps.capabilities.resolve(handle);
    // A HANDLE THIS RUN DOES NOT KNOW. The registry is per-run and a renderer
    // may hold a list from before a reload, so this is an outcome a surface
    // acts on by asking for the list again — not a defect.
    if (path === undefined) return err({ code: 'unknown-handle' });

    // THROUGH `openPath`, the one way to open a document. `mint` is idempotent
    // per path, so the handle it mints IS the one the recent list handed out, and
    // its revocation and recording are this route's exactly — including recording
    // the session, which is the route a recovery itself takes: reopening after a
    // crash puts the documents back on screen, and a run that recorded only
    // picker-opened documents would lose them all to a second crash.
    const { outcome } = await openPath(deps, path);
    return ok(outcome);
  };
}

/** A refusal the cloud session named, as the channel carries it; anything else is a defect. */
/**
 * Why a document could not be read for an ask — THE ONE MAPPING from the lane's refusals to the contract's reasons, so
 * a one-document ask's refusal and an *All Open Docs* ask's skipped document say the same thing for the same cause
 * (ADR-0134). `undefined` for anything else, which the caller rethrows.
 */
function askUnreadCode(thrown: unknown): (typeof ASK_UNREAD_REASONS)[number] | undefined {
  if (thrown instanceof DocumentNotOpenError) return 'document-not-open';
  if (thrown instanceof DocumentBusyError) return 'document-busy';
  if (thrown instanceof DocumentPoisonedError) return 'document-poisoned';
  if (thrown instanceof PageTooLargeToPicture) return 'page-too-large';
  return undefined;
}

function cloudRefusal(thrown: unknown): { readonly kind: 'refused'; readonly reason: CloudOutcomeRefused['reason'] } {
  if (thrown instanceof CloudOutcomeRefused) return { kind: 'refused', reason: thrown.reason };
  throw thrown;
}

/**
 * Cloud storage's seven channels (ADR-0091).
 *
 * ## Opening goes through `openPath`, the one way a document opens
 *
 * The session downloads the working copy and answers its path; this opens that path exactly as a
 * picked file is opened — identity, dedup, the ceiling, the sessions, the recent list — and only
 * then links the document to its cloud file, so a link exists only for a document that opened.
 *
 * ## Save back saves FIRST
 *
 * The working copy is saved through the ordinary save, then the same flushed image is sent. A save
 * that failed sends nothing, so the cloud never holds what the person's own disk does not.
 */
function cloudHandlers(
  deps: OpenPathParts & { readonly cloud: CloudStorage; readonly commands: DocumentCommands },
): Pick<
  ContractHandlers,
  | 'cloud.status'
  | 'cloud.signIn'
  | 'cloud.signOut'
  | 'cloud.list'
  | 'cloud.open'
  | 'cloud.pick'
  | 'cloud.saveBack'
  | 'cloud.access'
  | 'cloud.uploadCopy'
> {
  /** The document refusals every per-document cloud channel declares, by class. */
  const documentRefusal = (thrown: unknown) => {
    if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' as const });
    if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' as const });
    if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' as const });
    return null;
  };

  return {
    'cloud.status': () =>
      Promise.resolve(
        ok({ providers: CLOUD_PROVIDER_IDS.map((provider) => ({ provider, state: deps.cloud.state(provider) })) }),
      ),
    'cloud.signIn': async ({ provider }) => {
      try {
        await deps.cloud.signIn(provider);
        return ok({ kind: 'done' as const });
      } catch (thrown) {
        return ok(cloudRefusal(thrown));
      }
    },
    'cloud.signOut': ({ provider }) => {
      deps.cloud.signOut(provider);
      return Promise.resolve(ok({ state: deps.cloud.state(provider) }));
    },
    'cloud.list': async ({ provider }) => {
      try {
        return ok({ kind: 'listed' as const, files: [...(await deps.cloud.list(provider))] });
      } catch (thrown) {
        return ok(cloudRefusal(thrown));
      }
    },
    'cloud.open': async ({ provider, fileId }) => {
      let path: string;
      try {
        path = await deps.cloud.download(provider, fileId);
      } catch (thrown) {
        return ok(cloudRefusal(thrown));
      }
      // LINKED BY THE OPEN, as every working copy is (`openPath`).
      const { outcome } = await openPath(deps, path);
      return ok(outcome);
    },
    // THE PICKER'S FILE opens as a listed one does: the same working copy, the same open, the same link.
    'cloud.pick': async ({ provider }) => {
      let path: string;
      try {
        path = await deps.cloud.pick(provider);
      } catch (thrown) {
        return ok(cloudRefusal(thrown));
      }
      const { outcome } = await openPath(deps, path);
      return ok(outcome);
    },
    'cloud.saveBack': async ({ docId }) => {
      if (deps.cloud.originOf(docId) === null) return ok({ kind: 'not-from-cloud' as const });
      try {
        // NEVER BREAKING A SIGNATURE UNASKED: a save-back is not the place a person is told, so a save that would break
        // one is not written and the save-back answers that it failed.
        // THE IMAGE IS TAKEN WITH THE SAVE, in its lane entry (CR-DOC-04): asked for afterwards, it was whatever the
        // document held by then, and a command landing between the two was uploaded under the version saved here.
        const { outcome: saved, image } = await deps.commands.saveAndTake(docId, { breakSignatures: false });
        if (saved.kind !== 'saved' || image === null) return ok({ kind: 'save-failed' as const });
        // THE UPLOAD'S REFUSAL IS CAUGHT HERE, where the saved version is in scope, so a refusal
        // after the working copy was written still says which version it holds.
        try {
          await deps.cloud.saveBack(docId, image);
        } catch (thrown) {
          return ok({ ...cloudRefusal(thrown), version: saved.version });
        }
        return ok({ kind: 'saved-back' as const, version: saved.version });
      } catch (thrown) {
        const refused = documentRefusal(thrown);
        if (refused !== null) return refused;
        throw thrown;
      }
    },
    'cloud.access': ({ docId }) => {
      const provider = deps.cloud.originOf(docId);
      const canEdit = deps.cloud.canEdit(docId);
      return Promise.resolve(
        ok(
          provider === null || canEdit === undefined
            ? { kind: 'not-from-cloud' as const }
            : { kind: 'from-cloud' as const, provider, canEdit },
        ),
      );
    },
    'cloud.uploadCopy': async ({ docId, provider }) => {
      const name = deps.commands.nameOf(docId);
      if (name === undefined) return err({ code: 'document-not-open' as const });
      try {
        await deps.cloud.uploadCopy(docId, provider, name, await deps.commands.currentImage(docId));
        return ok({ kind: 'done' as const });
      } catch (thrown) {
        const refused = documentRefusal(thrown);
        if (refused !== null) return refused;
        return ok(cloudRefusal(thrown));
      }
    },
  };
}
