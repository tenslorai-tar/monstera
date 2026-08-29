import { inspect } from 'node:util';

import { reportPickerProbe } from './pickerProbe.js';

/**
 * Electron entry point for `npm run probe:picker`, and nothing else.
 *
 * The reasoning for a `.ts` in `src/` rather than a `.mjs` beside the app is
 * `rendererHarnessMain.ts`'s and is not repeated: a `.mjs` under `apps/desktop/`
 * matches no lint configuration at all, which is the hole invariant 26 names.
 *
 * Built into `dist/` and not reachable from the package's exports, so nothing
 * can import it by accident and it is not part of the app.
 */

/**
 * ANY failure becomes a MESSAGE, never a hang.
 *
 * Electron does not exit on an unhandled rejection in the main process, so a
 * throw here would leave a window on somebody's screen with nothing telling them
 * why. Declared `never` because `process.exit` does not return, which is what
 * lets this be used as the last statement of a guard.
 */
function reportProbeFailure(cause: unknown): never {
  const payload = JSON.stringify(inspect(cause, { depth: 4 }));
  process.stderr.write(`MONSTERA_PICKER_PROBE_FAILED ${payload}\n`);
  process.exit(70);
}

process.on('uncaughtException', (error) => {
  reportProbeFailure(error);
});
process.on('unhandledRejection', (reason) => {
  reportProbeFailure(reason);
});

reportPickerProbe().catch(reportProbeFailure);
