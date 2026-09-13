import {
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
  type CapabilityRegistry,
  DocumentBusyError,
  DownloadRefused,
  DocumentNotOpenError,
  type DocumentService,
  EngineFormDataExportFailed,
  type WriteTargetVerdict,
  readDocumentRange,
} from '@monstera/kernel';
import { type DocId, err, ok } from '@monstera/shared';

import { executeCommandHandler } from './commandHandlers.js';
import {
  type DocumentCommands,
  DocumentPoisonedError,
  EngineUnavailableError,
  InvalidSearchPatternError,
  MissingSessionError,
} from './documentCommands.js';
import type { HandwritingCache } from './handwritingCache.js';
import type { RecentFiles } from './recentFiles.js';
import type { SecretStoreSurface } from './secretStore.js';
import type { SettingsSurface } from './settingsFile.js';
import type { DictionaryBytes } from './spellingDictionaries.js';

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
export type OpenedDocument = (docId: DocId) => void;

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
   * The handwriting engine's downloaded stack, or absent.
   *
   * Optional because a build without one is a real state: no cache surface, no
   * handwriting recognition, and `available: false` is what the renderer's
   * `when` predicate reads — the same shape `settings.loadSecrets` uses for a
   * machine with no keyring.
   */
  readonly handwriting?: HandwritingCache;
}): ContractHandlers {
  return {
    // `Promise.resolve`, not `async`: nothing here awaits, and the contract's
    // handler type is asynchronous because the real document channels are.
    'app.info': () => Promise.resolve(ok({ ...deps.appInfo })),
    // AN ARRAY COPY, because the answer crosses a boundary that serialises it and
    // the source is a `readonly` the composition root may hold on to.
    'app.ocrLanguages': async () => ok({ languages: [...(await deps.ocrLanguages())] }),
    // NOT DOWNLOADED IS A STATE, not a refusal, and neither is *this build has
    // no cache*. Both answer `ready: false` with a different `available`, so a
    // surface can tell "press to fetch 67 MB" from "this build cannot".
    'app.handwritingCache': async ({ size }) => {
      if (deps.handwriting === undefined) {
        return ok({ available: false, ready: false, bytesToFetch: 0 });
      }
      const report = await deps.handwriting.report(size);
      return ok({
        available: true,
        ready: report.missing.length === 0,
        bytesToFetch: report.bytesToFetch,
      });
    },
    'app.fetchHandwritingModel': async ({ size }) => {
      if (deps.handwriting === undefined) return err({ code: 'no-handwriting-cache' });
      try {
        const report = await deps.handwriting.fetch(size);
        return ok({ ready: report.missing.length === 0, bytesToFetch: report.bytesToFetch });
      } catch (cause) {
        // A REFUSED DOWNLOAD IS AN ANSWER ABOUT THE NETWORK AND THE ARTEFACT,
        // and a reader can act on it. `DownloadRefused` carries WHICH rule
        // stopped it on a field, so nothing here reads a message to find out —
        // and anything else is a defect in this build and goes to the internal
        // path, where it arrives with an incident id.
        if (cause instanceof DownloadRefused) return err({ code: 'download-refused' });
        throw cause;
      }
    },
    'app.clearHandwritingCache': async () => {
      if (deps.handwriting === undefined) return err({ code: 'no-handwriting-cache' });
      return ok({ bytesRemoved: await deps.handwriting.clear() });
    },
    'document.open': openDocumentHandler(deps),
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
    'document.execute': executeCommandHandler(deps.commands),
    'document.undo': undoHandler(deps.commands),
    'document.save': saveHandler(deps.commands),
    'document.extract': extractHandler(deps.commands),
    'document.snapshotRegion': snapshotRegionHandler(deps.commands),
    'document.exportFormData': exportFormDataHandler(deps.commands),
    'document.importFormData': importFormDataHandler(deps.commands),
    'document.split': splitHandler(deps.commands),
    'document.saveCopy': saveCopyHandler(deps.commands),
    'document.insertImage': insertImageHandler(deps.commands),
    'document.placeImage': placeImageHandler(deps.commands),
    'document.sign': signHandler(deps.commands),
    'docusign.send': docusignSendHandler(deps.commands),
    'docusign.retrieve': docusignRetrieveHandler(deps.commands),
    'document.readRange': readRangeHandler(deps.documents),
    'document.viewModel': viewModelHandler(deps.commands),
    'document.searchPage': searchPageHandler(deps.commands),
    'document.pageTextLayer': pageTextLayerHandler(deps.commands),
    'document.pageWordCount': pageWordCountHandler(deps.commands),
    'document.pageLinks': pageLinksHandler(deps.commands),
    'document.destinations': destinationsHandler(deps.commands),
    'document.layers': layersHandler(deps.commands),
    'document.signatures': signaturesHandler(deps.commands),
    'document.annotations': annotationsHandler(deps.commands),
    'document.formFields': formFieldsHandler(deps.commands),
    'document.flatFieldCandidates': flatFieldCandidatesHandler(deps.commands),
    'document.textLines': textLinesHandler(deps.commands),
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
function textLinesHandler(commands: DocumentCommands): ContractHandlers['document.textLines'] {
  return async ({
    docId,
    page,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.textLines']>>> => {
    try {
      const { version, lines, truncated, unaddressable } = await commands.textLines(docId, page);
      return ok({ version, lines, truncated, unaddressable });
    } catch (thrown) {
      if (thrown instanceof DocumentNotOpenError) return err({ code: 'document-not-open' });
      if (thrown instanceof DocumentPoisonedError) return err({ code: 'document-poisoned' });
      if (thrown instanceof EngineUnavailableError) return err({ code: 'engine-unavailable' });
      throw thrown;
    }
  };
}

/** {@link textLinesHandler}'s three refusals on the other PDFium read. */
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
function openDocumentHandler(deps: {
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly pickDocument: PickDocument;
  readonly recent: RecentFiles;
}): ContractHandlers['document.open'] {
  return async (): Promise<Awaited<ReturnType<ContractHandlers['document.open']>>> => {
    const picked = await deps.pickDocument();
    if (picked === null) return ok({ kind: 'cancelled' } as const);

    const handle = deps.capabilities.mint(picked);
    const outcome: ChannelResult<'document.open'> = await deps.documents.open(handle);

    if (outcome.kind === 'absent' || outcome.kind === 'at-capacity') {
      deps.capabilities.revoke(handle);
    }

    // ONLY FOR A DOCUMENT THIS CALL OPENED, and `already-open` is the outcome
    // that makes the distinction load-bearing rather than pedantic: that
    // document has a session or is poisoned already, and a second entry for it
    // would spend Decision 9a's failure bound a second time on a document that
    // never failed.
    if (outcome.kind === 'opened') {
      deps.openedDocument(outcome.docId);
      // RECORDED HERE, where the path and the name are both in hand. Recording
      // in the service would put a list of paths inside the thing that holds
      // documents; recording in the renderer is impossible, which is L2 doing
      // its job.
      deps.recent.record({ path: picked, name: outcome.name });
      // AND RECORDED AS OPEN. The recent list is *what this user has looked
      // at*; the session is *what is on screen now*, which is what a crash
      // recovery has to offer once several documents can be.
      deps.recent.opened(outcome.docId, { path: picked, name: outcome.name });
    }

    return ok(outcome);
  };
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
function openRecentHandler(deps: {
  readonly documents: DocumentService;
  readonly capabilities: CapabilityRegistry;
  readonly openedDocument: OpenedDocument;
  readonly recent: RecentFiles;
}): ContractHandlers['document.openRecent'] {
  return async ({
    handle,
  }): Promise<Awaited<ReturnType<ContractHandlers['document.openRecent']>>> => {
    const path = deps.capabilities.resolve(handle);
    // A HANDLE THIS RUN DOES NOT KNOW. The registry is per-run and a renderer
    // may hold a list from before a reload, so this is an outcome a surface
    // acts on by asking for the list again — not a defect.
    if (path === undefined) return err({ code: 'unknown-handle' });

    const outcome: ChannelResult<'document.openRecent'> = await deps.documents.open(handle);

    if (outcome.kind === 'absent') {
      deps.capabilities.revoke(handle);
      deps.recent.forget(path);
    }
    if (outcome.kind === 'at-capacity') deps.capabilities.revoke(handle);

    if (outcome.kind === 'opened') {
      deps.openedDocument(outcome.docId);
      deps.recent.record({ path, name: outcome.name });
      // BOTH ROUTES RECORD THE SESSION, and this one is the route a recovery
      // itself takes: reopening after a crash puts the documents back on
      // screen, and a run that recorded only picker-opened documents would
      // lose them all to a second crash.
      deps.recent.opened(outcome.docId, { path, name: outcome.name });
    }

    return ok(outcome);
  };
}
