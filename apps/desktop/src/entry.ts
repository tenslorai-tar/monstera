import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MAX_ANNOTATION_DATA_BYTES,
  MAX_CSV_BYTES,
  MAX_FORM_DATA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_MARKDOWN_BYTES,
} from '@monstera/contract';
import { BrowserWindow, app, clipboard, nativeImage, safeStorage, shell } from 'electron';

import { createShellDependencies } from './composition.js';
import {
  createAnnotationDataPicker,
  createDestinationPicker,
  createFormDataPicker,
  createOfficePicker,
  createSnapshotPicker,
  createSettingsPicker,
  createTextPicker,
} from './destinationPicker.js';
import { createDocumentPicker } from './documentPicker.js';
import { createDirectoryPicker } from './directoryPicker.js';
import {
  createAnnotationDataOpenPicker,
  createCertificatePicker,
  createFormDataOpenPicker,
  createImagePicker,
  createImagesPicker,
  createCsvPicker,
  createMarkdownPicker,
} from './imagePicker.js';
import {
  createComposeHostPlatform,
  createEngineHostPlatform,
  createLayoutTextPlatform,
  createPdfaPlatform,
  createPdfiumHostPlatform,
} from './engineHostPlatform.js';
import { removeRetiredCaches } from './retiredCaches.js';
import { readCloudClients } from './cloudClients.js';
import { RECENT_FILE, createRecentFiles } from './recentFiles.js';
import { knownRoots } from './displayLocation.js';
import { pictureDirectory } from './recentPictures.js';
import { createChatHistory } from './chatHistory.js';
import { type SecretCipher, createSecretStore } from './secretStore.js';
import { createJsonFile, createSettingsFile } from './settingsFile.js';
import { createShellLog } from './shellLog.js';
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
 * disagree with it. `installChannel` is `development` because nothing packages
 * this yet, and it is **baked rather than detected** (E4): it decides which
 * update provider is active, and a value that could differ between two launches
 * of one package is exactly what an update decision must not be.
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
  // NAMED, BECAUSE PDFIUM'S PLATFORM IS DERIVED FROM IT. `createPdfiumHostPlatform`
  // takes MuPDF's rather than building a second one from scratch, so that the
  // session root, the directory surface and the containment negative are
  // established exactly once — see that function for why a second build is a
  // second writer of a concern this process establishes on the way in.
  //
  // Evaluated inside the lambda, which is the whole of what the lambda is for:
  // everything here reads the single-instance lock as *this process owns the
  // session root*, and `createEngineHostPlatform` sweeps that root.
  const enginePlatform = createEngineHostPlatform(
    join(app.getPath('sessionData'), 'engine-sessions'),
  );

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

  // INSIDE THE LAMBDA, so after the single-instance lock: a losing second launch
  // must not delete anything in the winner's profile. Not awaited — nothing the
  // application does depends on the directory being gone (ADR-0085).
  void removeRetiredCaches(app.getPath('userData'), (detail) => {
    log.write('retired-cache', detail);
  });

  // WHERE CLOUD WORKING COPIES GO, named once: cloud storage writes there, and a recent file under it is
  // shown as its cloud rather than as an internal folder id (ADR-0100).
  const cloudWorkingDirectory = join(app.getPath('userData'), 'cloud');

  return createShellDependencies({
    appInfo: {
      version: app.getVersion(),
      installChannel: 'development',
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
    pickSettingsFile: createSettingsPicker(),
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
    editWatch: nodeEditWatchSurface,
    // THE BOUND IS CHECKED BEFORE THE READ, which is the whole reason this is a
    // function here rather than a `readFile` at the call site: `stat` costs
    // nothing and a 4 GB file a user picked by mistake is refused as a decided
    // outcome instead of being loaded to find out.
    //
    // `readImage` is where Node's filesystem enters, for the same reason the
    // pickers are where Electron does: `composition.ts` imports neither.
    readImage: async (path: string) => {
      try {
        const { size } = await stat(path);
        if (size > MAX_IMAGE_BYTES) return { kind: 'too-large' as const, byteLength: size };
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        // A FILE THAT VANISHED OR CANNOT BE OPENED reads as unreadable, which is
        // what the user sees either way. The distinction between *deleted since
        // you picked it* and *permission denied* is one this build cannot act on
        // differently, so inventing two outcomes would be two sentences for one
        // situation.
        return { kind: 'unreadable' as const };
      }
    },
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
    // THE SAME SHAPE AGAINST A DIFFERENT BOUND, written out rather than shared
    // with a size parameter: the two bounds are separate decisions about
    // separate risks — an image is large because images are, a form-data file
    // large enough to notice is one somebody built — and a helper taking a
    // number would make them look like one rule with two settings.
    readFormData: async (path: string) => {
      try {
        const { size } = await stat(path);
        if (size > MAX_FORM_DATA_BYTES) return { kind: 'too-large' as const, byteLength: size };
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        return { kind: 'unreadable' as const };
      }
    },
    // `readFormData`'s shape against the annotation bound, written out for the reason above:
    // `MAX_ANNOTATION_DATA_BYTES` is its own decision, equal today (ADR-0077).
    readAnnotationData: async (path: string) => {
      try {
        const { size } = await stat(path);
        if (size > MAX_ANNOTATION_DATA_BYTES) return { kind: 'too-large' as const, byteLength: size };
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        return { kind: 'unreadable' as const };
      }
    },
    // `readFormData`'s shape against the Markdown bound, and written out for its
    // reason: `MAX_MARKDOWN_BYTES` was set from what composing costs in the host
    // (ADR-0060), which is a different decision from either bound above.
    readMarkdown: async (path: string) => {
      try {
        const { size } = await stat(path);
        if (size > MAX_MARKDOWN_BYTES) return { kind: 'too-large' as const, byteLength: size };
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        return { kind: 'unreadable' as const };
      }
    },
    // THE SAME SHAPE AGAINST THE CSV BOUND, written out for `readFormData`'s reason:
    // `MAX_CSV_BYTES` was measured on the CSV composer, not Markdown's.
    readCsv: async (path: string) => {
      try {
        const { size } = await stat(path);
        if (size > MAX_CSV_BYTES) return { kind: 'too-large' as const, byteLength: size };
        return { kind: 'read' as const, bytes: new Uint8Array(await readFile(path)) };
      } catch {
        return { kind: 'unreadable' as const };
      }
    },
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
    // `userData` and not `sessionData` or `temp`: settings outlive every
    // document and every session, and the two other directories are ones the
    // application and the OS respectively are entitled to empty. Resolved here
    // because only this file may ask Electron where the user's data lives.
    settings: createSettingsFile(app.getPath('userData')),
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
    // Same trade, one layer along. The platform's own module may not import
    // Electron either, so *where the app may write* — which is Electron's
    // question and nobody else's — is resolved above and handed down. Under
    // `sessionData` rather than `temp`: a directory the OS may empty underneath
    // a live host is not one to hand a granted DACL to.
    enginePlatform,
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
    // THE SHARE SHEET (ADR-0080): the window's handle is Electron's, and so is the
    // temporary directory the shared file is written under — one folder per share, in a
    // directory this application owns.
    share:
      process.platform === 'win32'
        ? createWin32ShareSurface(join(app.getPath('temp'), 'Monstera shares'), () => {
            const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
            if (window === undefined) throw new Error('there is no window for the share sheet to belong to');
            return window.getNativeWindowHandle().readBigUInt64LE(0);
          })
        : null,
    // WHERE A DIAGNOSTIC GOES WHEN NOBODY IS WATCHING STDERR, which is every
    // packaged run: a Store application has no terminal attached, so until this
    // existed every failure this repository takes care to describe went to a
    // handle that discards it.
    //
    // Built above, beside the platform, because the retired-cache removal writes to it too.
    log,
  });
});
