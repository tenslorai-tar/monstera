import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { IncidentLog, isFollowable } from '@monstera/contract';
import { sweepCheckpointDirectories } from '@monstera/kernel';
import { BrowserWindow, app, clipboard, crashReporter, nativeImage, safeStorage, shell } from 'electron';

import { HOST_CALL_DEADLINE, HOST_MEMORY_SAMPLING } from './budget.js';
import { createShellDependencies } from './composition.js';
import {
  readAnnotationDataFile,
  readCsvFile,
  readFormDataFile,
  readImageFile,
  readMarkdownFile,
  readOfficeFile,
} from './pickedFileReads.js';
import { setNativeSource } from './nativeComponents.js';
import {
  createAnnotationDataPicker,
  createDestinationPicker,
  createFormDataPicker,
  createOfficePicker,
  createSnapshotPicker,
  createSettingsOpener,
  createSettingsPicker,
  createContactPicker,
  createTextPicker,
} from './destinationPicker.js';
import { createDocumentPicker } from './documentPicker.js';
import { createDocumentsPicker } from './documentsPicker.js';
import { createDirectoryPicker } from './directoryPicker.js';
import {
  createAnnotationDataOpenPicker,
  createCertificatePicker,
  createFormDataOpenPicker,
  createImagePicker,
  createSignaturePicturePicker,
  createImagesPicker,
  createAttachmentPicker,
  createCsvPicker,
  createMarkdownPicker,
  createOfficeImportPicker,
} from './imagePicker.js';
import {
  createComposeHostPlatform,
  createEngineHostPlatform,
  createLayoutTextPlatform,
  createOfficePlatform,
  createPdfaPlatform,
  createPdfiumHostPlatform,
} from './engineHostPlatform.js';
import { OFFICE_IMPORT_FORMATS } from './officeConversion.js';
import { describePackageDataCheck } from './packageDataLock.js';
import { removeRetiredCaches } from './retiredCaches.js';
import { readCloudClients } from './cloudClients.js';
import { RECENT_FILE, createRecentFiles } from './recentFiles.js';
import { knownRoots } from './displayLocation.js';
import { pictureDirectory } from './recentPictures.js';
import { BACKUP_LEDGER_FILE } from './backupLedger.js';
import { ENGAGEMENT_FILE } from './engagement.js';
import { UPDATE_RECORD_FILE } from './updateCheck.js';
import { PRINT_PIXELS } from './documentCommands.js';
import { documentPathsIn } from './launchDocuments.js';
import { pngSizeWithin } from './pngHeader.js';
import { STORE_URIS } from './webPages.js';
import { createChatHistory } from './chatHistory.js';
import { type SecretCipher, createSecretStore } from './secretStore.js';
import { createJsonFile, createSettingsFile } from './settingsFile.js';
import { WINDOW_STATE_FILE, windowMemory } from './windowState.js';
import { createShellLog } from './shellLog.js';
import { createCrashReports, crashReportsOn, logFilesIn } from './crashReports.js';
import { createWin32PrintSurface } from './win32PrintSurface.js';
import { createWin32ShareSurface } from './win32ShareSurface.js';
import { startShell } from './main.js';
import { nodeEditWatchSurface } from './nodeEditWatch.js';
import { isPdfPath } from './openExternalEditor.js';
import { windowsUserName } from './userName.js';

/**
 * The OS credential store, as the secrets and the saved conversations both take it. `safeStorage`
 * is Electron's and this is the only file that may ask it. `isEncryptionAvailable` is asked per call
 * rather than captured, because on Linux it becomes true once the keyring is ready and a value read
 * at startup would be a permanent *no* on a machine that can.
 */
const OS_CIPHER: SecretCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (cipher) => safeStorage.decryptString(cipher),
};

/**
 * The Electron entry point, and the only file that both builds the graph and
 * starts it.
 *
 * ## Two lines, on purpose
 *
 * Everything else is in `composition.ts`, which imports no Electron and can be
 * built and inspected in a plain Node test. An entry point that also assembled
 * would make the graph unreachable without a runtime — the same trade
 * `windowPolicy.ts` makes against `window.ts`, one layer up.
 *
 * ## Why `package.json` names this in `main` and not in `exports`
 *
 * Electron reads `main` to find the app; Node reads `exports` to resolve
 * `@monstera/desktop`. Pointing both at this file would mean **importing the
 * package launches the application**, which is the shape that had a unit test
 * downloading Electron a commit ago. They are separate fields naming separate
 * things: `main` is the app, `exports` is the module surface, and nothing
 * imports the package today anyway.
 *
 * ## What it reports about itself
 *
 * `version` from Electron's own `app.getVersion()`, which reads the packaged
 * `package.json` — the artifact's version rather than a constant that can
 * disagree with it. `installChannel` is `store` in a package and `development`
 * otherwise (ADR-0123), and it is **baked rather than detected** (E4): it decides
 * which update provider is active, and a value that could differ between two
 * launches of one package is exactly what an update decision must not be —
 * `app.isPackaged` cannot.
 *
 * ## Why the graph is a lambda and not an argument
 *
 * `startShell` takes the single-instance lock and quits without one, and
 * everything below reads that lock as *this process owns the session root*.
 * Passing the graph as an argument evaluated every constructor first — so a
 * losing second launch created the session root and wrote its negative probe
 * into the winner's directory before finding out it had to quit. The lambda is
 * what makes "after the lock" a property of the code rather than of the reading
 * order.
 */
startShell(() => {
  // CRASH REPORTS, FIRST (ADR-0109): kept on this computer, never uploaded — no submit address, nothing added to a
  // report. Started before the first window so the renderer is watched, and inside the lambda so a losing second
  // launch starts nothing. Off in Settings › Privacy: not started, and the reports already written are deleted. A
  // started reporter cannot be stopped, so the setting takes effect at the next start, which its text says.
  const crashDumps = app.getPath('crashDumps');
  // ONE SURFACE OVER THE SETTINGS DOCUMENT, for the crash check here, the graph, and the recent list's length below.
  // `userData` and not `sessionData` or `temp`: settings outlive every document and every session, and the two other
  // directories are ones the application and the OS respectively are entitled to empty. Resolved here because only
  // this file may ask Electron where the user's data lives.
  const settings = createSettingsFile(app.getPath('userData'));
  const reportsOn = crashReportsOn(settings.read());
  if (reportsOn) crashReporter.start({ uploadToServer: false });

  // WHERE THE NATIVE COMPONENTS ARE (ADR-0122), told to the one resolver before anything resolves one: the package's
  // `resources/native` folder, read-only, when packaged — the one file that may ask Electron that — and otherwise the
  // launcher's variables, which is the resolver's own default.
  if (app.isPackaged) setNativeSource({ kind: 'packaged', folder: join(process.resourcesPath, 'native') });

  // WHERE A DIAGNOSTIC GOES WHEN NOBODY IS WATCHING STDERR, which is every
  // packaged run: a Store application has no terminal attached, so until this
  // existed every failure this repository takes care to describe went to a
  // handle that discards it.
  //
  // `userData` for the reason settings use it, one step stronger: a log the
  // OS may empty is a log that is missing exactly when somebody goes looking
  // for it after a crash.
  //
  // `openPath` and not `showItemInFolder`: the directory is what is wanted,
  // there being up to five rotated files and no single one of them *the* log.
  // Its answer is an error STRING — empty on success — which is the shape
  // `RevealDirectory`'s boolean is derived from here, at the only boundary
  // entitled to know what Electron's convention is.
  const log = createShellLog(app.getPath('userData'), async (directory) => {
    const problem = await shell.openPath(directory);
    return problem === '';
  });

  // A REJECTION NOTHING HANDLED IS NAMED IN THE LOG (CR-COR-02). Each one is a defect in this build, and without a
  // listener it is either a crash of `main` with every open document in it or a line on a stderr a packaged run does
  // not have, depending on the runtime's default; neither says which promise it was. Registered as soon as there is
  // a log to write to, so a rejection anywhere after this line lands there. RECORDED AS AN INCIDENT, through the one
  // place a thrown value becomes a diagnostic (`IncidentLog`, ADR-0009 §9): the full value, its stack and its causes,
  // in the log beside every other incident, and nothing in this package builds a diagnostic of its own.
  const rejections = new IncidentLog(log.incidents);
  process.on('unhandledRejection', (reason) => {
    rejections.record('process:unhandledRejection', reason);
  });

  // NAMED, BECAUSE PDFIUM'S PLATFORM IS DERIVED FROM IT. `createPdfiumHostPlatform`
  // takes MuPDF's rather than building a second one from scratch, so that the
  // session root, the directory surface and the containment negative are
  // established exactly once — see that function for why a second build is a
  // second writer of a concern this process establishes on the way in.
  //
  // Evaluated inside the lambda, which is the whole of what the lambda is for:
  // everything here reads the single-instance lock as *this process owns the
  // session root*, and `createEngineHostPlatform` sweeps that root.
  //
  // THE PACKAGE-DATA CHECK REPORTS INTO THE LOG, which is why the log is built first (ADR-0023 Decision 17): one line
  // on every packaged start, naming any folder this start had to lock — the first start of an install, or something
  // that undid a lock since.
  const enginePlatform = createEngineHostPlatform(join(app.getPath('sessionData'), 'engine-sessions'), {
    report: (outcome) => {
      const line = describePackageDataCheck(outcome);
      if (line.kind === 'failure') log.failures({ event: 'package-data-unlocked', detail: line.detail });
      else log.write('package-data', line.detail);
    },
  });
  // X2T'S PLATFORM, `null` on Ghostscript's roads: no Win32 platform, no `x2t` handed down by the
  // launcher, or no container SID (ADR-0120).
  const officePlatform = enginePlatform === null ? null : createOfficePlatform(enginePlatform);

  // THE SHARE SHEET (ADR-0080): the window's handle is Electron's, and so is the
  // temporary directory the shared file is written under — one folder per share, in a
  // directory this application owns. Built once, for Email and for a crash report (ADR-0109).
  const share =
    process.platform === 'win32'
      ? createWin32ShareSurface(join(app.getPath('temp'), 'Monstera shares'), () => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (window === undefined) throw new Error('there is no window for the share sheet to belong to');
          return window.getNativeWindowHandle().readBigUInt64LE(0);
        })
      : null;

  // THE REPORTS THIS COMPUTER KEEPS, offered at the start after a crash (ADR-0109). Off, there is nothing to offer:
  // the folder is emptied here, not waited on — nothing depends on it being gone.
  const crashReports = reportsOn
    ? createCrashReports({
        folder: crashDumps,
        offeredFile: join(app.getPath('userData'), 'crash-reports-offered.json'),
        share,
        logFiles: () => logFilesIn(log.directory),
      })
    : null;
  if (!reportsOn) {
    void createCrashReports({
      folder: crashDumps,
      offeredFile: join(app.getPath('userData'), 'crash-reports-offered.json'),
      share: null,
      logFiles: () => Promise.resolve([]),
    }).clear();
  }

  // INSIDE THE LAMBDA, so after the single-instance lock: a losing second launch
  // must not delete anything in the winner's profile. Not awaited — nothing the
  // application does depends on the directory being gone (ADR-0085).
  void removeRetiredCaches(app.getPath('userData'), (detail) => {
    log.write('retired-cache', detail);
  });

  // WHERE CLOUD WORKING COPIES GO, named once: cloud storage writes there, and a recent file under it is
  // shown as its cloud rather than as an internal folder id (ADR-0100).
  const cloudWorkingDirectory = join(app.getPath('userData'), 'cloud');

  // UNDO CHECKPOINTS (ADR-0121), beside the engine's session root so a host's output moves in by a rename, and
  // swept HERE — synchronously, after the single-instance lock and before the graph exists, so what a crash left
  // goes and nothing open can meet the sweep.
  const checkpointDirectory = join(app.getPath('sessionData'), 'checkpoints');
  sweepCheckpointDirectories(checkpointDirectory);

  return createShellDependencies({
    checkpointDirectory,
    appInfo: {
      version: app.getVersion(),
      // PACKAGED IS THE STORE PACKAGE (ADR-0123 Decision 7): fixed for a package, so still baked rather than detected
      // between launches. The web flavour ADR-0018 keeps has no build; when it gets one it bakes its own.
      installChannel: app.isPackaged ? 'store' : 'development',
      userName: windowsUserName(),
    },
    // Built here, for the same reason `AppInfo` is: this is the only file that
    // may hold both Electron and the graph. `composition.ts` takes the picker
    // as a value so that everything opening does with what was picked stays
    // decidable without a runtime.
    //
    // THIS IS THE FILE A NEW SURFACE LANDS IN, and it is deliberately not a
    // digested one: `ShellComposition` names its fields so that adding one is
    // an edit here, in `composition.ts` and in `harnessComposition.ts` — never
    // in `pickerProbe.ts`, whose bytes certify what a person saw.
    pickDocument: createDocumentPicker(),
    // The same dialog with a multiple selection, for the Open command (ADR-0182).
    pickDocuments: createDocumentsPicker(),
    // Its mirror, built here for the same reason and on the line after it, so
    // the Electron dialogs this application opens are visible together.
    pickDestination: createDestinationPicker(),
    // Its sibling, on the line after it for the reason the line above gives:
    // every Electron dialog this application opens is visible in one place.
    pickSnapshot: createSnapshotPicker(),
    // The fourth save dialog, on the line after its siblings for the reason
    // above: every Electron dialog this application opens is visible together.
    pickFormData: createFormDataPicker(),
    // The fifth save dialog, beside its siblings for the reason above.
    pickText: createTextPicker(),
    // The contact card a barcode carries, saved as `.vcf`: beside the text dialog it is narrowed from.
    pickContact: createContactPicker(),
    pickSettingsFile: createSettingsPicker(),
    // AND ITS OPEN DIALOG, for *Import settings…*, beside it.
    openSettingsFile: createSettingsOpener(),
    // The Office exports' save dialog, narrowed per format (ADR-0072).
    pickOffice: createOfficePicker(),
    // The fifth, and the first OPEN dialog added since the image picker.
    openFormData: createFormDataOpenPicker(),
    // THE ANNOTATION FILES' TWO DIALOGS, beside the form data's (ADR-0077).
    pickAnnotationData: createAnnotationDataPicker(),
    openAnnotationData: createAnnotationDataOpenPicker(),
    // The third dialog, beside the two above so all of them are visible
    // together — and the first surface added since composition became an
    // object, which is why `pickerProbe.ts` is absent from this commit.
    pickImage: createImagePicker(),
    // A SIGNATURE PICTURE, beside it: the same dialog with `.pdf` offered, a scanned signature.
    pickSignaturePicture: createSignaturePicturePicker(),
    // A MARKDOWN FILE TO IMPORT, beside the image picker because both open a file a
    // person chose so that main can make pages of it (ADR-0060).
    pickMarkdown: createMarkdownPicker(),
    // A CSV FILE TO IMPORT, beside the Markdown picker for its reason.
    pickCsv: createCsvPicker(),
    // IMAGES TO MAKE A NEW PDF FROM, several at once, beside the other import pickers.
    pickImages: createImagesPicker(),
    // THE SECOND SURFACE ADDED SINCE COMPOSITION BECAME AN OBJECT, and
    // `pickerProbe.ts` is absent from this commit too — which is the churn fix
    // holding rather than being claimed.
    pickDirectory: createDirectoryPicker(),
    // SIGNING'S CERTIFICATE, and the surface is added through this object for
    // the reason the two above record — `pickerProbe.ts` is untouched again.
    pickCertificate: createCertificatePicker(),
    // THE PERSON'S OWN BROWSER, for a sign-in (ADR-0059 Decision 3) — the one route
    // by which this application opens a URL outside itself, and it is `main`'s: the
    // renderer's window policy denies `shell.openExternal` with no allowlist, and
    // this is not that. The only caller passes an authorization URL `main` built;
    // anything but HTTPS is refused all the same, so a mistake here cannot hand the
    // operating system a `file:` or a custom scheme.
    openInBrowser: async (url: string) => {
      if (new URL(url).protocol !== 'https:') {
        throw new Error('only an HTTPS URL may be opened in the browser');
      }
      await shell.openExternal(url);
    },
    // THE OPERATING SYSTEM'S PDF HANDLER, for a page sent out to be edited (ADR-0062 Decision
    // 2) — `openInBrowser`'s shape: its only caller passes a path `main` just wrote, and
    // anything not ending `.pdf` is refused all the same, so a mistake here cannot hand the
    // operating system a program to run.
    openExternalEditor: async (path: string) => {
      if (!isPdfPath(path)) {
        throw new Error('only a .pdf may be opened in the operating system’s PDF handler');
      }
      // `shell.openPath` RESOLVES with an error message, or an empty string when it opened.
      const failure = await shell.openPath(path);
      return failure === '' ? null : failure;
    },
    // A TOAST'S *SHOW IN FOLDER*: a path a write just produced, which `file.reveal` resolved from a handle this
    // process minted. A file is shown selected in its folder; a folder (a split, the pages as images) is opened, and
    // `shell.openPath` resolves with an error message, or an empty string when it opened. A path no longer there
    // answers `false`, nothing shown, rather than an error: the person moved it.
    revealPath: async (path: string) => {
      const found = await stat(path).catch(() => null);
      if (found === null) return false;
      if (found.isDirectory()) return (await shell.openPath(path)) === '';
      shell.showItemInFolder(path);
      return true;
    },
    editWatch: nodeEditWatchSurface,
    // EVERY PICKED FILE IS SIZED BEFORE IT IS READ, in `pickedFileReads.ts`, where a case reaches it; each read names
    // its own bound there. This is where Node's filesystem enters, for the same reason the pickers are where Electron
    // does: `composition.ts` imports neither.
    readImage: (path: string) => readImageFile(path),
    // NO BOUND, and that is the decision `composition.ts` records: a file
    // picked through a dialog filtered to `.p12` is a few kilobytes or it is
    // not a certificate, and the signer's own parse is what says so. A number
    // here would be a second opinion about what a PKCS#12 is.
    readCertificate: async (path: string) => {
      try {
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        // `readImage`'s reason: *deleted since you picked it* and *permission
        // denied* are one situation from where the user stands.
        return { kind: 'unreadable' as const };
      }
    },
    // `readImage`'s rule, each against its own bound (`pickedFileReads.ts` says why the bounds are five decisions).
    readFormData: (path: string) => readFormDataFile(path),
    readAnnotationData: (path: string) => readAnnotationDataFile(path),
    readMarkdown: (path: string) => readMarkdownFile(path),
    readCsv: (path: string) => readCsvFile(path),
    // A SIZE AND NOTHING READ, so an image import's bounds are decided before any
    // picked byte is in memory. `null` for a file that cannot be stated — `readImage`'s
    // reason: gone and forbidden are one situation from where the person stands.
    sizeImage: async (path: string) => {
      try {
        return (await stat(path)).size;
      } catch {
        return null;
      }
    },
    // FILES ATTACHED TO A QUESTION (ADR-0135): any file, several at once, and a read of at most the bytes asked for —
    // the family needs eight, a text file four for every character of its share — so a large file is never read whole
    // to decide anything. A file that went between the pick and the ask reads as `null`, said as not found.
    pickAttachments: createAttachmentPicker(),
    readAttachment: async (path: string, limit: number) => {
      try {
        const file = await open(path, 'r');
        try {
          const buffer = new Uint8Array(limit);
          const { bytesRead } = await file.read(buffer, 0, limit, 0);
          return buffer.subarray(0, bytesRead);
        } finally {
          await file.close();
        }
      } catch {
        return null;
      }
    },
    settings,
    // THE SECRETS, in their own document beside the settings and encrypted by
    // the OS through `OS_CIPHER` — the same trade `nativeImage` makes below.
    secrets: createSecretStore(app.getPath('userData'), OS_CIPHER),
    // SAVED CONVERSATIONS (ADR-0093), under the same cipher as the keys — beside them and never in them.
    chatHistory: createChatHistory(app.getPath('userData'), OS_CIPHER),
    // THE CLIPBOARD'S WRITER, Electron's, for `window.copyText`: the renderer holds no clipboard
    // permission (§2), so the assistant's Copy is written here.
    writeClipboardText: (text) => {
      clipboard.writeText(text);
    },
    // CLOUD STORAGE (ADR-0091): client values from the environment. THE PACKAGED FILE IS NOT READ
    // YET, and that is Stage 10's: it lives in the package's resources, and `no-install-root-writes`
    // refuses `process.resourcesPath` because a rule cannot tell that read from a write — the
    // packaging row owes both the file and how it is reached. Working copies under `userData`. No
    // value is logged here or anywhere: `readCloudClients` answers values or `null`, and says nothing.
    cloud: {
      clients: readCloudClients(process.env, null),
      workingDirectory: cloudWorkingDirectory,
    },
    // The recent list, beside the settings and in its own document. Not IN the
    // settings file, and that is invariant L2 rather than tidiness:
    // `settings.load` hands the renderer everything that file holds, so a path
    // stored there would be a path in the renderer with nothing having decided
    // to send it.
    // TEN ENTRIES, the contract's `MAX_RECENT_ENTRIES` (ADR-0143); not a setting since 2026-10-01.
    recent: createRecentFiles(createJsonFile(app.getPath('userData'), RECENT_FILE)),
    // WHERE a recent file is, for display (ADR-0100): the known folders are Electron's answers and the
    // environment's, resolved here for the working directory's reason.
    recentRoots: knownRoots({
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      desktop: app.getPath('desktop'),
      env: process.env,
      cloudWorkingDirectory,
    }),
    // THE RECENT CARDS' PICTURES (ADR-0100), beside the recent list under `userData`: they are about
    // the same entries and go with them.
    recentPictureFiles: pictureDirectory(join(app.getPath('userData'), 'recent-pictures')),
    // THE PERSON'S STAMP AND SIGNATURE LIBRARY, in its own folder beside it: pictures named by UUID and one index.
    libraryFiles: pictureDirectory(join(app.getPath('userData'), 'library')),
    // THE RATING PROMPT'S RECORD (E3), in its own document under `userData`, and this build's one way to the
    // Store application's pages: `shell.openExternal` of a constant from `STORE_URIS`, never of anything a page
    // supplied — a page names `review` or `updates`, and the table is the only place a URI is.
    engagementFile: createJsonFile(app.getPath('userData'), ENGAGEMENT_FILE),
    // WHICH BACKUPS BESIDE A PERSON'S DOCUMENTS MONSTERA MADE (ADR-0139), so a removal's save deletes those and no
    // other file. Under `userData` with the other records.
    backupLedgerFile: createJsonFile(app.getPath('userData'), BACKUP_LEDGER_FILE),
    // THE VERSIONS A SAVE REPLACES (ADR-0198): Monstera's own folder under `userData`, never beside a person's file.
    backupDirectory: join(app.getPath('userData'), 'backups'),
    // WHICH SECURITY RELEASE THE PERSON ACKNOWLEDGED (ADR-0110), in its own document beside the rating record. The
    // manifest's GET is the composition's own default; its address is the contract's, dormant in this build.
    updateRecordFile: createJsonFile(app.getPath('userData'), UPDATE_RECORD_FILE),
    openStore: async (page) => {
      await shell.openExternal(STORE_URIS[page]);
      return true;
    },
    // A DOCUMENT'S LINK, once the person asked for it (ADR-0167), and the scheme is checked AGAIN here, where the
    // address leaves for the operating system: the only caller passes what `isFollowable` allowed, and a mistake
    // upstream still cannot hand Windows a `file:` or a registered handler. A system with nothing to open the address
    // rejects; that is the answer *not opened*, which the person is told, not a failure of this process.
    openLink: async (address) => {
      if (!isFollowable(address)) throw new Error('only an https, http or mailto address is opened from a document');
      return shell.openExternal(address).then(
        () => true,
        () => false,
      );
    },
    // Same trade, one layer along. The platform's own module may not import
    // Electron either, so *where the app may write* — which is Electron's
    // question and nobody else's — is resolved above and handed down. Under
    // `sessionData` rather than `temp`: a directory the OS may empty underneath
    // a live host is not one to hand a granted DACL to.
    enginePlatform,
    // HOW LONG A HOST CALL MAY GO UNANSWERED before the host is killed and rebuilt (ADR-0023 §3, corrected 2026-10-03).
    hostCallDeadline: HOST_CALL_DEADLINE,
    // AND HOW EACH HOST'S MEMORY IS WATCHED below the job's limit (the same correction).
    hostMemorySampling: HOST_MEMORY_SAMPLING,
    // THE SECOND ENGINE'S PLATFORM, and `null` on three separate roads: no
    // Win32 surfaces at all, no `pdfium.dll` path supplied, or a container SID
    // that could not be derived. All three end the same way and that is
    // deliberate — no PDFium host is created, and a command routed to `pdfium`
    // is refused by name at the registry rather than reaching a native call.
    pdfiumPlatform: enginePlatform === null ? null : createPdfiumHostPlatform(enginePlatform),
    // THE COMPOSE HOST'S PLATFORM, derived the same way and `null` on the same
    // roads but one: it needs no provisioned library, so only a missing Win32
    // platform or an underivable container SID leaves it absent (ADR-0060).
    composePlatform: enginePlatform === null ? null : createComposeHostPlatform(enginePlatform),
    // THE LAYOUT-TEXT CONVERTER'S PLATFORM, `null` on the PDFium roads: no Win32
    // platform, no `pdftotext` handed down by the launcher, or no container SID (ADR-0071).
    layoutTextPlatform: enginePlatform === null ? null : createLayoutTextPlatform(enginePlatform),
    // GHOSTSCRIPT'S PLATFORM, `null` on the same roads: no Win32 platform, no `gswin64c`
    // handed down by the launcher, or no container SID (ADR-0075).
    pdfaPlatform: enginePlatform === null ? null : createPdfaPlatform(enginePlatform),
    // OFFICE IMPORT: x2t's platform, its picker, and the read bounded by the contract's figure before
    // any byte is in memory — `readCsv`'s shape against its own bound (ADR-0120).
    officeImport:
      officePlatform === null
        ? null
        : {
            platform: officePlatform,
            source: {
              pick: createOfficeImportPicker(OFFICE_IMPORT_FORMATS),
              read: (path: string) => readOfficeFile(path),
            },
          },
    // THE ENCODER, and it is here because `nativeImage` is Electron's.
    //
    // `composition.ts` imports no Electron — which is what lets
    // `compositionHost.test.ts` exercise the whole wiring in vitest in
    // milliseconds — so the one line that turns a PDFium raster into PNG bytes
    // arrives as a surface, exactly as every picker above it does.
    //
    // `createFromBitmap` takes BGRA, which is what PDFium produces, so nothing
    // on the path from the rasteriser to here converts. `scaleFactor: 1` because
    // the caller already stated the size in DEVICE pixels: telling Electron the
    // image is 2× would make it report half the dimensions to anything that
    // asked, and the renderer compares what it got against what it requested.
    encodePng: (bitmap, width, height) =>
      new Uint8Array(
        nativeImage
          .createFromBitmap(Buffer.from(bitmap), { width, height, scaleFactor: 1 })
          .toPNG(),
      ),
    // THE PRINT DIALOG AND PRINTER, here for the encoder's reason: the decoder and the
    // window are Electron's (ADR-0074). `toBitmap` answers BGRA, the order a 32-bit DIB
    // is drawn in. The dialog must have an owner — `PrintDlgExW` refuses none — so it
    // is the focused window, or the first one, which is the window the command came from.
    print:
      process.platform === 'win32'
        ? createWin32PrintSurface(
            (png) => {
              // THE DECLARED SIZE IS READ BEFORE THE DECODER IS ASKED (CR-SEC-21): the host that produced these bytes is
              // hostile by premise, and a header can declare far more than the bytes hold. The bound is the one the print
              // itself draws to, so no page this application asks for is refused.
              pngSizeWithin(png, PRINT_PIXELS);
              const image = nativeImage.createFromBuffer(Buffer.from(png));
              const { width, height } = image.getSize();
              return { width, height, bgra: new Uint8Array(image.toBitmap()) };
            },
            () => {
              const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
              if (window === undefined) throw new Error('there is no window for the print dialog to belong to');
              return window.getNativeWindowHandle().readBigUInt64LE(0);
            },
          )
        : null,
    // THE ASSISTANT'S EVENTS (ADR-0082): `webContents` is Electron's, so the push arrives
    // from here like every other runtime surface. It goes to the focused window, or the
    // first one — the window the ask came from — and to nothing at all when there is none,
    // which is a closing application rather than a state to report.
    sendEvent: (event, payload) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      window?.webContents.send(event, payload);
    },
    share,
    crashReports,
    // THE DOCUMENTS THIS LAUNCH WAS GIVEN — a file association, *Open with*, a PDF dropped on the icon — held for the
    // page to ask for. A later launch's arrive through `documentsLaunched` (`main.ts`).
    launchDocuments: documentPathsIn(process.argv, app.isPackaged),
    // WHERE A DIAGNOSTIC GOES WHEN NOBODY IS WATCHING STDERR, which is every
    // packaged run: a Store application has no terminal attached, so until this
    // existed every failure this repository takes care to describe went to a
    // handle that discards it.
    //
    // Built above, beside the platform, because the retired-cache removal writes to it too.
    log,
  });
}, windowMemory(createJsonFile(app.getPath('userData'), WINDOW_STATE_FILE)));
