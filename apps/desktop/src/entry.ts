import { join } from 'node:path';

import { app } from 'electron';

import { createShellDependencies } from './composition.js';
import { createDocumentPicker } from './documentPicker.js';
import { createEngineHostPlatform } from './engineHostPlatform.js';
import { createSettingsFile } from './settingsFile.js';
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
 */
startShell(
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
    // `userData` and not `sessionData` or `temp`: settings outlive every
    // document and every session, and the two other directories are ones the
    // application and the OS respectively are entitled to empty. Resolved here
    // because only this file may ask Electron where the user's data lives.
    createSettingsFile(app.getPath('userData')),
    // Same trade, one layer along. The platform's own module may not import
    // Electron either, so *where the app may write* — which is Electron's
    // question and nobody else's — is resolved here and handed down. Under
    // `sessionData` rather than `temp`: a directory the OS may empty underneath
    // a live host is not one to hand a granted DACL to.
    createEngineHostPlatform(join(app.getPath('sessionData'), 'engine-sessions')),
  ),
);
