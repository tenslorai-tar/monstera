import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { app } from 'electron';

/**
 * Electron entry point for `proof:workermode`, and nothing else.
 *
 * ## The question
 *
 * The engine host's reader is a `worker_threads` Worker inside the Electron main
 * process. CLAUDE.md's placement rule turns on which MODE such a thread runs in,
 * and its own record says the `apps/desktop/src/` proxy for *runs inside
 * Electron* has failed three times. So the premise is measured here rather than
 * cited, and it is measured on both sides:
 *
 *   MAIN imports Electron and uses it — the control. Without it, "the worker
 *   could not" is indistinguishable from "this harness cannot import Electron
 *   at all", which is the negative-probe rule CLAUDE.md item 4b states: build
 *   the input from something that would SUCCEED if the property were absent.
 *
 *   THE WORKER tries the same import and reports what it got.
 *
 * ## Why a `.ts` in `src/` rather than a `.mjs` beside the app
 *
 * The same reason `rendererHarnessMain.ts` gives: a `.mjs` under
 * `apps/desktop/` matches no lint configuration at all, which is the hole
 * invariant 26 names, and putting even a harmless file there is how the hole
 * acquires residents.
 *
 * ANY failure becomes a MESSAGE, never a hang. Electron does not exit on an
 * unhandled rejection in main, so a throw here would leave the app running until
 * the probe's timeout and the probe would report "no marker line" — true, and
 * silent about the cause.
 */
const MARKER = 'MONSTERA_WORKER_MODE ';

function say(payload: Record<string, unknown>): void {
  process.stdout.write(`${MARKER}${JSON.stringify(payload)}\n`);
}

process.on('uncaughtException', (error) => {
  say({ harness: 'threw', detail: error instanceof Error ? error.message : String(error) });
  app.exit(1);
});

async function run(): Promise<void> {
  await app.whenReady();

  // THE CONTROL, taken in main and not asserted: this process demonstrably has a
  // usable Electron module. `app.whenReady()` above has already resolved, which
  // no string path could do.
  const mainHasApp = typeof app.getVersion === 'function';

  // `import.meta.url` and NOT `__dirname`: this package is `"type": "module"`
  // and the build emits ESM, where `__dirname` does not exist. Written the other
  // way first, and the harness rejected with exactly that message — which is the
  // same ESM-versus-CommonJS surprise that left the preload never executing,
  // one artefact along.
  const here = dirname(fileURLToPath(import.meta.url));
  const worker = new Worker(join(here, 'workerModeHarnessWorker.js'));
  const report = await new Promise<Record<string, unknown>>((done) => {
    // Every ending is a value. A worker that dies without messaging would
    // otherwise leave this promise pending and the probe reading a timeout.
    worker.once('message', (message: Record<string, unknown>) => done(message));
    worker.once('error', (error: Error) => done({ workerThrew: error.message }));
    worker.once('exit', (code: number) => done({ workerExited: code }));
  });
  await worker.terminate();

  say({ mainHasApp, mainProcessType: process.type, worker: report });
  app.exit(0);
}

void run().catch((error: unknown) => {
  say({ harness: 'rejected', detail: error instanceof Error ? error.message : String(error) });
  app.exit(1);
});
