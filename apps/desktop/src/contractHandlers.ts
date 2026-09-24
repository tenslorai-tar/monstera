import {
  AI_PROVIDERS,
  CHAT_HISTORY_SETTING_ID,
  type AskSent,
  CLOUD_PROVIDER_IDS,
  MAX_ASK_CONTEXT,
  MAX_RASTER_BYTES,
  MAX_RASTER_PIXELS,
  SECRET_SETTING_IDS,
  type ChannelResult,
  type ContractHandlers,
  type DocumentAccess,
  type OcrLanguage,
  type SpellingLanguage,
} from '@monstera/contract';
import {
  type AskWindow,
  askInstruction,
  askPairInstruction,
  askPictureInstruction,
  type CapabilityRegistry,
  DocumentBusyError,
  DocumentNotOpenError,
  type DocumentService,
  EngineFormDataExportFailed,
  EngineAnnotationDataExportFailed,
  StaleTargetError,
  type WriteTargetVerdict,
  readDocumentRange,
} from '@monstera/kernel';
import { writeFile } from 'node:fs/promises';

import { type DocId, err, ok } from '@monstera/shared';

import { executeCommandHandler } from './commandHandlers.js';
import {
  type DocumentCommands,
  DocumentPoisonedError,
  EngineUnavailableError,
  type ComposeImportOutcome,
  type ImportFormat,
  InvalidSearchPatternError,
  MissingSessionError,
  PageTooLargeToPicture,
} from './documentCommands.js';
import type { Assistant } from './assistant.js';
import type { ChatHistory } from './chatHistory.js';
import { CloudOutcomeRefused, type CloudStorage } from './cloudSession.js';
import type { RecentFiles } from './recentFiles.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';
import type { DictionaryBytes } from './spellingDictionaries.js';
import type { WebPage } from './webPages.js';

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
  /** The recent-files list, which is also where the clean-exit marker lives. */
  readonly recent: RecentFiles;
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
  /**
   * Shows the diagnostics log.
   *
   * Takes no argument and answers a boolean, so nothing about *where* the log
   * is reaches this file — which is what keeps the handler unable to leak a
   * path even by accident (B5 over a rule at the call site).
   */
  readonly revealLog: () => Promise<boolean>;
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
   * Runs the browser's copy on the window's current selection (`webContents.copy()`), answering
   * whether a window took it. Injected and required for {@link titleBarOverlay}'s reason.
   */
  readonly copySelection: () => boolean;
  /** Writes text to the system clipboard; `false` where this graph has none to write to. */
  readonly copyText: (text: string) => boolean;
  /**
   * Opens one of this project's own pages in the person's browser, answering whether this build has
   * an address for it (ADR-0095). The **place** crosses the boundary and the address does not: this
   * function resolves the second from the first, in `main`, so no page can name a destination.
   */
  readonly openWebPage: (page: WebPage) => Promise<boolean>;
  /**
   * The renderer has subscribed to close requests. Answers whether the gate took it — `false`
   * where no window is attached, as its neighbours do.
   */
  readonly closeListening: () => boolean;
  /** Cloud storage (ADR-0091): sign-ins, listings, working copies and their links. REQUIRED, for `titleBarOverlay`'s reason. */
  readonly cloud: CloudStorage;
}): ContractHandlers {
  return {
    // `Promise.resolve`, not `async`: nothing here awaits, and the contract's
    // handler type is asynchronous because the real document channels are.
    'app.info': () => Promise.resolve(ok({ ...deps.appInfo })),
    // AN ARRAY COPY, because the answer crosses a boundary that serialises it and
    // the source is a `readonly` the composition root may hold on to.
    'app.ocrLanguages': async () => ok({ languages: [...(await deps.ocrLanguages())] }),
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
    'document.openRecent': openRecentHandler(deps),
    'document.close': closeHandler({ documents: deps.documents, recent: deps.recent }),
    'document.unsaved': unsavedHandler(deps.documents),
    'document.execute': executeCommandHandler(deps.commands),
    'document.undo': undoHandler(deps.commands),
    'document.redo': redoHandler(deps.commands),
    'document.save': saveHandler(deps.commands),
    'document.extract': extractHandler(deps.commands),
    'document.snapshotRegion': snapshotRegionHandler(deps.commands),
    'document.exportFormData': exportFormDataHandler(deps.commands),
    'document.exportAnnotations': exportAnnotationsHandler(deps.commands),
    'document.importAnnotations': importAnnotationsHandler(deps.commands),
    'document.copyAnnotations': copyAnnotationsHandler(deps.commands),
    'document.pasteAnnotations': pasteAnnotationsHandler(deps.commands),
    'document.importFormData': importFormDataHandler(deps.commands),
    'document.split': splitHandler(deps.commands),
    'document.exportPageImages': exportPageImagesHandler(deps.commands),
    'document.exportText': exportTextHandler(deps.commands),
    'document.exportWord': exportWordHandler(deps.commands),
    'document.exportPowerPoint': exportPowerPointHandler(deps.commands),
    'document.exportExcel': exportExcelHandler(deps.commands),
    'document.print': printHandler(deps.commands),
    'document.email': emailHandler(deps.commands),
    'document.exportPdfa': exportPdfaHandler(deps.commands),
    'document.optimizeMeasure': optimizeMeasureHandler(deps.commands),
    'document.optimize': optimizeHandler(deps.commands),
    'document.saveCopy': saveCopyHandler(deps.commands),
    'document.insertImage': insertImageHandler(deps.commands),
    'document.newFromMarkdown': newFromImportHandler(deps, 'markdown'),
    'document.newFromCsv': newFromImportHandler(deps, 'csv'),
    'document.newFromImages': newFromImagesHandler(deps),
    'document.newFromCapture': newFromCaptureHandler(deps),
    'document.appendMarkdown': appendMarkdownHandler(deps),
    'document.editPageExternally': editPageExternallyHandler(deps.commands),
    'document.awaitExternalEdit': awaitExternalEditHandler(deps.commands),
    'document.reimportExternalEdit': reimportExternalEditHandler(deps),
    'document.placeImage': placeImageHandler(deps.commands),
    'document.placeBarcode': placeBarcodeHandler(deps.commands),
    'document.pageBarcodes': pageBarcodesHandler(deps.commands),
    'document.accessibilityCheck': accessibilityCheckHandler(deps.commands),
    'document.sign': signHandler(deps.commands),
    'docusign.send': docusignSendHandler(deps.commands),
    'docusign.retrieve': docusignRetrieveHandler(deps.commands),
    'document.readRange': readRangeHandler(deps.documents),
    'document.viewModel': viewModelHandler(deps.commands),
    'document.searchPage': searchPageHandler(deps.commands),
    'document.pageTextLayer': pageTextLayerHandler(deps.commands),
    'document.pageWordCount': pageWordCountHandler(deps.commands),
    'document.pageStructure': pageStructureHandler(deps.commands),
    'document.pageTables': pageTablesHandler(deps.commands),
    'document.pageLinks': pageLinksHandler(deps.commands),
    'document.destinations': destinationsHandler(deps.commands),
    'document.layers': layersHandler(deps.commands),
    'document.signatures': signaturesHandler(deps.commands),
    'document.annotations': annotationsHandler(deps.commands),
    'document.formFields': formFieldsHandler(deps.commands),
    'document.flatFieldCandidates': flatFieldCandidatesHandler(deps.commands),
    'document.textBlocks': textBlocksHandler(deps.commands),
    'document.pageObjects': pageObjectsHandler(deps.commands),
    'document.renderPage': renderPageHandler(deps.commands),
    'document.duplicatePages': duplicatePagesHandler(deps.commands),
    // NEITHER OF THESE VALIDATES A STORED VALUE, and that is the boundary
    // deferring rather than the boundary being lax. `SettingsRegistry.read`
    // runs `migrate` and falls back per setting; a schema here would be this
    // build's opinion about last build's data, applied before the one component
    // that knows how to read it ever sees the value (B3a).
    'settings.load': () => Promise.resolve(ok({ stored: deps.settings.read() })),
    'settings.save': ({ values }) => {
      deps.settings.write(values);
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
    'ai.models': async ({ provider }) => {
      const list = await deps.assistant.models(provider);
      return ok({
        source: list.source,
        ...(list.problem === undefined ? {} : { problem: list.problem }),
        models: list.models.map((model) => ({
          id: model.id,
          label: model.label,
          capabilities: model.capabilities,
        })),
      });
    },
    'ai.checkKey': async ({ provider, key, endpoint }) => {
      // ASKED BEFORE THE CHECK, so a machine with no keyring is told so before a request is made
      // with a key that could not have been kept anyway.
      if (!deps.secrets.available()) return err({ code: 'secret-storage-unavailable' } as const);
      const listed = await deps.assistant.check(provider, key, endpoint ?? '');
      // A REFUSED KEY NEVER REACHES THE STORE: the key already stored, if any, is untouched.
      if (listed.problem !== undefined) return ok({ accepted: false, problem: listed.problem } as const);
      deps.secrets.write(AI_PROVIDERS[provider].keySetting, key);
      return ok({ accepted: true } as const);
    },
    // CHAT HISTORY (ADR-0093). `main` reads the setting ITSELF on every load and save: a renderer that
    // asked with the setting off gets nothing and stores nothing, whatever it believed.
    'ai.history.load': ({ docId }) => {
      const key = deps.documents.historyKeyOf(docId);
      if (key === undefined) return Promise.resolve(err({ code: 'document-not-open' } as const));
      const on = deps.settings.read()[CHAT_HISTORY_SETTING_ID] === true;
      return Promise.resolve(ok({ turns: on ? [...deps.chatHistory.load(key)] : [] }));
    },
    'ai.history.save': ({ docId, turns }) => {
      const key = deps.documents.historyKeyOf(docId);
      if (key === undefined) return Promise.resolve(err({ code: 'document-not-open' } as const));
      if (deps.settings.read()[CHAT_HISTORY_SETTING_ID] !== true) return Promise.resolve(ok({ saved: false }));
      if (!deps.chatHistory.available()) return Promise.resolve(err({ code: 'secret-storage-unavailable' } as const));
      deps.chatHistory.save(key, turns);
      return Promise.resolve(ok({ saved: true }));
    },
    'ai.history.clear': () => Promise.resolve(ok({ cleared: deps.chatHistory.clear() })),
    'ai.ask': async ({ subscription, provider, model, messages, about, alongside }) => {
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
      let window: AskWindow | null = null;
      let second: AskWindow | null = null;
      // A PICTURE ASK (ADR-0090): the page drawn in the host, sent with the last turn.
      let picture: { readonly png: Uint8Array | null; readonly sent: AskSent } | null = null;
      try {
        if (paired !== null) {
          const bound = Math.floor(MAX_ASK_CONTEXT / 2);
          window = await deps.commands.askWindow(paired.left, { side: 'left', bound });
          second = await deps.commands.askWindow(paired.right, { side: 'right', bound });
        } else if (about?.scope === 'page-image') {
          picture = await deps.commands.askPicture(about);
        } else if (about !== undefined) {
          window = await deps.commands.askWindow(about);
        }
      } catch (thrown) {
        if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
        if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
        if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
        if (thrown instanceof PageTooLargeToPicture) return err({ code: 'page-too-large' });
        throw thrown;
      }
      const system =
        paired !== null && window !== null && second !== null
          ? askPairInstruction(window, second, paired.scope)
          : picture?.png != null
            ? askPictureInstruction(picture.sent)
            : window !== null && about !== undefined && about.scope !== 'page-image'
              ? askInstruction(window, about.scope)
              : undefined;
      const started = deps.assistant.ask({
        subscription,
        provider,
        model,
        messages,
        ...(system === undefined ? {} : { system }),
        ...(picture?.png == null
          ? {}
          : { image: { mediaType: 'image/png' as const, base64: Buffer.from(picture.png).toString('base64') } }),
      });
      // A SUBSCRIPTION ALREADY STREAMING IS A DECLARED REFUSAL, not a quiet `false`: the
      // renderer must be able to say why nothing happened.
      return started.started
        ? ok({
            started: true,
            sent: picture?.sent ?? window?.sent ?? null,
            ...(second === null ? {} : { alongside: second.sent }),
          })
        : err({ code: 'subscription-in-use' });
    },
    'ai.stop': ({ subscription }) => Promise.resolve(ok(deps.assistant.stop(subscription))),
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
      return ok({ kind: 'written', settings: Object.keys(stored).length } as const);
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
    'window.titleBarOverlay': (overlay) => Promise.resolve(ok({ applied: deps.titleBarOverlay(overlay) })),
    'window.close': () => Promise.resolve(ok({ closing: deps.confirmClose() })),
    'window.copy': () => Promise.resolve(ok({ copied: deps.copySelection() })),
    'window.copyText': ({ text }) => Promise.resolve(ok({ copied: deps.copyText(text) })),
    'app.openWebPage': async ({ page }) => ok({ opened: await deps.openWebPage(page) }),
    'window.closeListening': () => Promise.resolve(ok({ acknowledged: deps.closeListening() })),
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
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.save']>>> => {
    try {
      const outcome = await commands.save(docId);
      if (outcome.kind === 'saved') return ok({ kind: 'saved', version: outcome.version } as const);
      if (outcome.kind === 'write-failed') return ok({ kind: 'write-failed' } as const);
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
      return ok((await openPath(deps, composed.destination)).outcome);
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
          source: outcome.docId,
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
  }): Promise<Awaited<ReturnType<ContractHandlers['document.placeImage']>>> => {
    try {
      const outcome = await commands.placeImage(docId, pages, rect);
      if (outcome.kind === 'cancelled') return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'unreadable') return ok({ kind: 'unreadable' } as const);
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

/** The barcode placement's handler: {@link placeImageHandler}'s body for its outcomes. */
function placeBarcodeHandler(commands: DocumentCommands): ContractHandlers['document.placeBarcode'] {
  return async ({
    docId,
    pages,
    rect,
    text,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.placeBarcode']>>> => {
    try {
      const outcome = await commands.placeBarcode(docId, pages, rect, text, format);
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
 * `docusign.retrieve`'s handler.
 *
 * The write's outcomes map exactly as `extractHandler` maps them — a dismissed picker
 * is `cancelled`, a contested destination carries how many other documents reach it —
 * and DocuSign's own outcomes cross unchanged.
 */
function docusignRetrieveHandler(commands: DocumentCommands): ContractHandlers['docusign.retrieve'] {
  return async ({ docId }) => {
    try {
      const outcome = await commands.docusignRetrieve(docId);
      if (outcome === undefined) return ok({ kind: 'cancelled' as const });
      if (outcome.kind === 'copied') return ok({ kind: 'copied' as const, bytes: outcome.bytes });
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
function extractHandler(commands: DocumentCommands): ContractHandlers['document.extract'] {
  return async ({
    docId,
    pages,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.extract']>>> => {
    try {
      const outcome = await commands.extract(docId, pages);
      // UNDEFINED IS THE USER DISMISSING THE DIALOG, exactly as it is next door.
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
): ContractHandlers['document.exportFormData'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportFormData']>>> => {
    try {
      const outcome = await commands.exportFormData(docId, format);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
): ContractHandlers['document.exportAnnotations'] {
  return async ({
    docId,
    format,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportAnnotations']>>> => {
    try {
      const outcome = await commands.exportAnnotations(docId, format);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
function splitHandler(commands: DocumentCommands): ContractHandlers['document.split'] {
  return async ({
    docId,
    groups,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.split']>>> => {
    try {
      const outcome = await commands.split(docId, groups);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'split') return ok({ kind: 'split', files: outcome.files } as const);
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
      if (outcome.kind === 'split') return ok({ kind: 'split', files: outcome.files } as const);
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
function exportTextHandler(commands: DocumentCommands): ContractHandlers['document.exportText'] {
  return async ({
    docId,
    mode,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportText']>>> => {
    try {
      const outcome = await commands.exportText(docId, mode);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
function exportWordHandler(commands: DocumentCommands): ContractHandlers['document.exportWord'] {
  return async ({
    docId,
    mode,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportWord']>>> => {
    try {
      const outcome = await commands.exportWord(docId, mode);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
function exportPowerPointHandler(commands: DocumentCommands): ContractHandlers['document.exportPowerPoint'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportPowerPoint']>>> => {
    try {
      const outcome = await commands.exportPowerPoint(docId);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
function exportPdfaHandler(commands: DocumentCommands): ContractHandlers['document.exportPdfa'] {
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.exportPdfa']>>> => {
    try {
      const outcome = await commands.exportPdfa(docId);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, removed: outcome.removed, tagsDropped: outcome.tagsDropped } as const);
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
function optimizeHandler(commands: DocumentCommands): ContractHandlers['document.optimize'] {
  return async ({ docId, setting, version }): Promise<Awaited<ReturnType<ContractHandlers['document.optimize']>>> => {
    try {
      const outcome = await commands.optimize(docId, setting, version);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      switch (outcome.kind) {
        case 'copied':
          return ok({ kind: 'copied', bytes: outcome.bytes, before: outcome.before } as const);
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
  return async ({ docId, dpi }): Promise<Awaited<ReturnType<ContractHandlers['document.print']>>> => {
    try {
      const outcome = await commands.print(docId, dpi);
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
function exportExcelHandler(commands: DocumentCommands): ContractHandlers['document.exportExcel'] {
  return async ({
    docId,
    layout,
    engine,
    version,
    edits,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.exportExcel']>>> => {
    try {
      const outcome = await commands.exportExcel(docId, layout, { version, edits }, engine);
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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

function saveCopyHandler(commands: DocumentCommands): ContractHandlers['document.saveCopy'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.saveCopy']>>> => {
    try {
      const outcome = await commands.saveCopy(docId);
      // UNDEFINED IS THE USER DISMISSING THE DIALOG, and it is an outcome. The
      // kernel returns no value at all for it rather than a fourth member,
      // because nothing ran — see `DocumentCommands.saveCopy`.
      if (outcome === undefined) return ok({ kind: 'cancelled' } as const);
      if (outcome.kind === 'copied') return ok({ kind: 'copied', bytes: outcome.bytes } as const);
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
      const { version, words, characters, charactersNoSpaces } = await commands.pageWordCount(
        docId,
        page,
      );
      return ok({ version, words, characters, charactersNoSpaces });
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
      return ok({ version, nodes, truncated, untaggedLines, images });
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
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageLinks']>>> => {
    try {
      const { version, links } = await commands.pageLinks(docId, page);
      return ok({ version, links });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentBusyError) return err({ code: 'document-busy' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      throw thrown;
    }
  };
}

/**
 * The document's outline, flattened.
 *
 * The three refusals are the two readers above's, and for the same reason: an
 * outline read needs an engine session.
 */
function destinationsHandler(
  commands: DocumentCommands,
): ContractHandlers['document.destinations'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.destinations']>>> => {
    try {
      const { version, destinations } = await commands.destinations(docId);
      return ok({ version, destinations });
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
  return async ({ docId }): Promise<Awaited<ReturnType<ContractHandlers['document.layers']>>> => {
    try {
      const { version, layers } = await commands.layers(docId);
      return ok({ version, layers });
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
  }): Promise<Awaited<ReturnType<ContractHandlers['document.annotations']>>> => {
    try {
      const { version, annotations, truncated } = await commands.annotations(docId);
      return ok({ version, annotations, truncated });
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
      const { version, candidates, truncated } = await commands.flatFieldCandidates(docId, page);
      return ok({ version, candidates, truncated });
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
  }): Promise<Awaited<ReturnType<ContractHandlers['document.textBlocks']>>> => {
    try {
      const { version, blocks, truncated, rotated, unaddressable } = await commands.textBlocks(docId, page);
      return ok({ version, blocks, truncated, rotated, unaddressable });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/** {@link textBlocksHandler}'s three refusals on the other PDFium read. */
function pageObjectsHandler(commands: DocumentCommands): ContractHandlers['document.pageObjects'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.pageObjects']>>> => {
    try {
      const { version, objects, truncated } = await commands.pageObjects(docId, page);
      return ok({ version, objects, truncated });
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

function formFieldsHandler(commands: DocumentCommands): ContractHandlers['document.formFields'] {
  return async ({
    docId,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.formFields']>>> => {
    try {
      const { version, fields, truncated } = await commands.formFields(docId);
      return ok({ version, fields, truncated });
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
 * ## THE HANDLE IS REVOKED ON EXACTLY TWO OUTCOMES, AND NOT ON THE THIRD
 *
 * `absent` and `at-capacity` leave nothing holding the handle: the service did
 * not take it, so without a revoke a user repeatedly picking missing files
 * would grow the registry once per distinct path, forever.
 *
 * `already-open` is the one that must **not** be revoked, and the reason is a
 * property of `mint` rather than of this function. Minting is *idempotent per
 * path* — deliberately, so that opening the same file twice does not mint twice
 * — which means the handle returned here for an already-open document **is the
 * live document's handle**. Revoking it would strip the capability out from
 * under a document that is open and working, and the failure would surface
 * later, somewhere else, as a resolve that throws.
 *
 * That is the whole finding: the tidy-up that looks symmetric across four
 * outcomes is correct on two, harmless on the one that took the handle, and
 * destructive on the one where two callers share it.
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

function openDocumentHandler(deps: OpenPathParts & { readonly pickDocument: PickDocument }): ContractHandlers['document.open'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.open']>>> => {
    const picked = await deps.pickDocument();
    if (picked === null) return ok({ kind: 'cancelled' } as const);
    return ok((await openPath(deps, picked)).outcome);
  };
}

/** What {@link openPath} opens a document through. */
interface OpenPathParts {
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly recent: RecentFiles;
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

  if (outcome.kind === 'absent' || outcome.kind === 'at-capacity') {
    deps.capabilities.revoke(handle);
  }

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
    return { outcome, sessions };
  }

  return { outcome, sessions: Promise.resolve() };
}

/** The recent list, with a handle per entry rather than a path. */
function recentHandler(deps: {
  readonly capabilities: CapabilityRegistry;
  readonly recent: RecentFiles;
}): ContractHandlers['document.recent'] {
  return () =>
    Promise.resolve(
      ok({
        // MINTED HERE, not stored. `mint` is idempotent per path, so the handle
        // an entry carries is the same one that document would have if opened —
        // and minting at the boundary rather than persisting the token means a
        // list written by a previous run cannot carry a capability into this
        // one.
        entries: deps.recent.list().map((entry) => ({
          handle: deps.capabilities.mint(entry.path),
          name: entry.name,
        })),
        lastExitClean: deps.recent.lastExitClean(),
        // THE SAME MINTING, for the same reason. These entries are paths the
        // previous run recorded as open; a handle minted here is one this run
        // can resolve, and a token persisted across runs would be a capability
        // surviving the process that granted it.
        lastSession: deps.recent.lastSession().map((entry) => ({
          handle: deps.capabilities.mint(entry.path),
          name: entry.name,
        })),
      }),
    );
}

/**
 * Opens a document the recent list named.
 *
 * The picker is skipped and nothing else is: the same service, the same
 * revocation rule, the same recording. What replaces the picker is a handle
 * main minted for a path main recorded, which is the whole of why a renderer
 * naming a file here is not a renderer choosing one.
 *
 * **A file that has gone is FORGOTTEN.** `absent` for a recent entry means the
 * document moved or was deleted since it was opened, and leaving it in the list
 * would offer the user the same dead file every launch.
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

    // WHAT THIS ROUTE ADDS: a file that has gone is FORGOTTEN, because leaving it
    // in the list would offer the user the same dead file every launch.
    if (outcome.kind === 'absent') deps.recent.forget(path);

    return ok(outcome);
  };
}

/** A refusal the cloud session named, as the channel carries it; anything else is a defect. */
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
  'cloud.status' | 'cloud.signIn' | 'cloud.signOut' | 'cloud.list' | 'cloud.open' | 'cloud.saveBack' | 'cloud.uploadCopy'
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
      const { outcome } = await openPath(deps, path);
      if (outcome.kind === 'opened' || outcome.kind === 'already-open') deps.cloud.link(outcome.docId, path);
      return ok(outcome);
    },
    'cloud.saveBack': async ({ docId }) => {
      if (deps.cloud.originOf(docId) === null) return ok({ kind: 'not-from-cloud' as const });
      try {
        const saved = await deps.commands.save(docId);
        if (saved.kind !== 'saved') return ok({ kind: 'save-failed' as const });
        // THE UPLOAD'S REFUSAL IS CAUGHT HERE, where the saved version is in scope, so a refusal
        // after the working copy was written still says which version it holds.
        try {
          await deps.cloud.saveBack(docId, await deps.commands.currentImage(docId));
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
