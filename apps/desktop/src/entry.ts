import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { MAX_FORM_DATA_BYTES, MAX_IMAGE_BYTES } from '@monstera/contract';
import { app, nativeImage, shell } from 'electron';

import { createShellDependencies } from './composition.js';
import {
  createDestinationPicker,
  createFormDataPicker,
  createSnapshotPicker,
} from './destinationPicker.js';
import { createDocumentPicker } from './documentPicker.js';
import { createDirectoryPicker } from './directoryPicker.js';
import { createFormDataOpenPicker, createImagePicker } from './imagePicker.js';
import { createEngineHostPlatform, createPdfiumHostPlatform } from './engineHostPlatform.js';
import { RECENT_FILE, createRecentFiles } from './recentFiles.js';
import { createJsonFile, createSettingsFile } from './settingsFile.js';
import { createShellLog } from './shellLog.js';
import { startShell } from './main.js';

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

  return createShellDependencies({
    appInfo: {
      version: app.getVersion(),
      installChannel: 'development',
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
    // The fifth, and the first OPEN dialog added since the image picker.
    openFormData: createFormDataOpenPicker(),
    // The third dialog, beside the two above so all of them are visible
    // together — and the first surface added since composition became an
    // object, which is why `pickerProbe.ts` is absent from this commit.
    pickImage: createImagePicker(),
    // THE SECOND SURFACE ADDED SINCE COMPOSITION BECAME AN OBJECT, and
    // `pickerProbe.ts` is absent from this commit too — which is the churn fix
    // holding rather than being claimed.
    pickDirectory: createDirectoryPicker(),
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
    // `userData` and not `sessionData` or `temp`: settings outlive every
    // document and every session, and the two other directories are ones the
    // application and the OS respectively are entitled to empty. Resolved here
    // because only this file may ask Electron where the user's data lives.
    settings: createSettingsFile(app.getPath('userData')),
    // The recent list, beside the settings and in its own document. Not IN the
    // settings file, and that is invariant L2 rather than tidiness:
    // `settings.load` hands the renderer everything that file holds, so a path
    // stored there would be a path in the renderer with nothing having decided
    // to send it.
    recent: createRecentFiles(createJsonFile(app.getPath('userData'), RECENT_FILE)),
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
    log: createShellLog(app.getPath('userData'), async (directory) => {
      const problem = await shell.openPath(directory);
      return problem === '';
    }),
  });
});
