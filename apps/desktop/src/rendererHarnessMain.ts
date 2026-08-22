import { toStructuredError } from '@monstera/shared';

import { reportRendererPolicy } from './rendererHarness.js';

/**
 * Electron entry point for `proof:rendererpolicy`, and nothing else.
 *
 * ## Why a `.ts` in `src/` rather than a `.mjs` beside the app
 *
 * A `.mjs` under `apps/desktop/` would match **no lint configuration at all** —
 * the package globs end `.ts,.tsx` and the plain-Node globs stop at `scripts/`.
 * That is precisely the hole invariant 26 names, and putting a file into it,
 * even a harmless one, is how the hole acquires residents. Compiled from `src/`,
 * it is covered by the same rules as the rest of the shell.
 *
 * ## Why Electron is handed this file directly
 *
 * A directory with its own `package.json` would be a second package inside
 * `apps/desktop`, which `npm ci` and the workspace globs would then have an
 * opinion about. Electron accepts a path to a script, so the proof spawns
 * `electron <path-to-this>` and nothing needs to be declared anywhere.
 *
 * This file is built into `dist/` and is not reachable from the package's
 * exports — `index.ts` does not re-export it, so nothing can import it by
 * accident and it is not part of the app.
 */
/**
 * ANY failure in the harness must become a MESSAGE, never a hang.
 *
 * `void reportRendererPolicy()` discarded the rejection. Electron does not exit
 * on an unhandled rejection in the main process, so a throw anywhere in the
 * harness left the app running with no window activity until the proof's 120 s
 * timeout killed it — and the proof then reported "no marker line", which is
 * true and says nothing about the cause. A hang that reads as a timeout is the
 * failure mode FF-2 named: impossible to miss, impossible to attribute.
 *
 * The marker is reused for the failure so the proof can distinguish "the harness
 * ran and reported a problem" from "the harness never spoke".
 */
process.on('uncaughtException', (error) => {
  reportHarnessFailure(error);
});
process.on('unhandledRejection', (reason) => {
  reportHarnessFailure(reason);
});

/**
 * ONE line, and the whole chain on it.
 *
 * This wrote `${name}: ${message}` on the marker line and the stack on the lines
 * after it. The reader keeps only lines that START with the marker, so the stack
 * was written and then dropped by the one thing that reads it — a diagnostic
 * emitted onto a channel nobody subscribes to.
 *
 * `toStructuredError` is the writer of record for carrying a thrown value across
 * a boundary on this side (B3): it recurses into `cause`, which the removed form
 * discarded, and JSON gives the whole chain on a single line without a second
 * opinion about how an error renders.
 */
function reportHarnessFailure(cause: unknown): void {
  const payload = JSON.stringify(toStructuredError(cause));
  process.stderr.write(`MONSTERA_RENDERER_HARNESS_FAILED ${payload}\n`);
  process.exit(70);
}

reportRendererPolicy().catch(reportHarnessFailure);
