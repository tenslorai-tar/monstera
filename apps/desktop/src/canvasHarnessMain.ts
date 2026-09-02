import { inspect } from 'node:util';

import { reportCanvasPixels } from './canvasHarness.js';

/**
 * Electron entry point for `proof:canvaspixels`, and nothing else.
 *
 * The reasoning for a `.ts` in `src/` rather than a `.mjs` beside the app, and
 * for Electron being handed the file directly, is `rendererHarnessMain.ts`'s and
 * is not repeated: a `.mjs` under `apps/desktop/` matches no lint configuration
 * at all, which is the hole invariant 26 names.
 *
 * This file is built into `dist/` and is not reachable from the package's
 * exports — `index.ts` does not re-export it, so nothing can import it by
 * accident and it is not part of the app.
 */

/**
 * ANY failure in the harness must become a MESSAGE, never a hang.
 *
 * Electron does not exit on an unhandled rejection in the main process, so a
 * throw anywhere in the harness would leave the app running with no window
 * activity until the proof's timeout killed it — and the proof then reports "no
 * marker line", which is true and says nothing about the cause. A hang that
 * reads as a timeout is impossible to miss and impossible to attribute.
 *
 * `util.inspect` rather than a rendering of our own: Node already defines how a
 * thrown value renders, it walks `cause`, and it prints the errno fields beside
 * it (B3a). `JSON.stringify` then puts the whole thing on one line, because the
 * reader's filter is per line — a stack written on the lines after the marker is
 * a diagnostic emitted onto a channel nobody subscribes to.
 */
/**
 * Declared `never` rather than `void`, and that is load-bearing for the argument
 * check below: `process.exit` does not return, so saying so lets the compiler
 * narrow the two arguments to `string` afterwards. The alternative was a cast,
 * which would assert exactly what this function already guarantees — and a cast
 * that happens to be true is indistinguishable from one that is not.
 */
function reportHarnessFailure(cause: unknown): never {
  const payload = JSON.stringify(inspect(cause, { depth: 4 }));
  process.stderr.write(`MONSTERA_CANVAS_HARNESS_FAILED ${payload}\n`);
  process.exit(70);
}

process.on('uncaughtException', (error) => {
  reportHarnessFailure(error);
});
process.on('unhandledRejection', (reason) => {
  reportHarnessFailure(reason);
});

/**
 * The fixture and the control's name arrive as arguments, and neither is spelt
 * here.
 *
 * The fixture is a path, and a path written into a file under `apps/desktop/` is
 * one nothing outside this package can see; the name is the message catalogue's,
 * and a second spelling of it here would be the drift this harness exists to
 * detect quietly passing. The proof owns both, reads the name from the catalogue
 * with a positive control, and hands them over.
 *
 * A missing argument is refused rather than defaulted: a default here would make
 * a mis-invoked harness report about some other document.
 */
const [fixture, openControlName, zoomControlName] = process.argv.slice(2);
if (fixture === undefined || openControlName === undefined || zoomControlName === undefined) {
  reportHarnessFailure(
    new Error(
      'usage: electron canvasHarnessMain.js <fixture-path> <open-control-name> ' +
        '<zoom-in-control-name>. All three are required; defaulting any would let this ' +
        'harness report about a document or a control the caller did not name.',
    ),
  );
}

reportCanvasPixels(fixture, openControlName, zoomControlName).catch(reportHarnessFailure);
