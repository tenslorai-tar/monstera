import { join } from 'node:path';

import { app, shell } from 'electron';

import { createShellDependencies } from './composition.js';
import { createDestinationPicker } from './destinationPicker.js';
import { createDocumentPicker } from './documentPicker.js';
import { createEngineHostPlatform } from './engineHostPlatform.js';
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
startShell(() =>
  createShellDependencies(
    {
      version: app.getVersion(),
      installChannel: 'development',
    },
    // Built here, for the same reason `AppInfo` is: this is the only file that
    // may hold both Electron and the graph. `composition.ts` takes the picker
    // as a value so that everything opening does with what was picked stays
    // decidable without a runtime.
    createDocumentPicker(),
    // Its mirror, built here for the same reason and on the line after it, so
    // the two Electron dialogs this application opens are visible together.
    createDestinationPicker(),
    // `userData` and not `sessionData` or `temp`: settings outlive every
    // document and every session, and the two other directories are ones the
    // application and the OS respectively are entitled to empty. Resolved here
    // because only this file may ask Electron where the user's data lives.
    createSettingsFile(app.getPath('userData')),
    // The recent list, beside the settings and in its own document. Not IN the
    // settings file, and that is invariant L2 rather than tidiness:
    // `settings.load` hands the renderer everything that file holds, so a path
    // stored there would be a path in the renderer with nothing having decided
    // to send it.
    createRecentFiles(createJsonFile(app.getPath('userData'), RECENT_FILE)),
    // Same trade, one layer along. The platform's own module may not import
    // Electron either, so *where the app may write* — which is Electron's
    // question and nobody else's — is resolved here and handed down. Under
    // `sessionData` rather than `temp`: a directory the OS may empty underneath
    // a live host is not one to hand a granted DACL to.
    createEngineHostPlatform(join(app.getPath('sessionData'), 'engine-sessions')),
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
    createShellLog(app.getPath('userData'), async (directory) => {
      const problem = await shell.openPath(directory);
      return problem === '';
    }),
  ),
);
