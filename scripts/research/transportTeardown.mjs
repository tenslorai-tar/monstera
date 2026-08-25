// @ts-check
/**
 * Can the transport's reader thread be stopped without interrupting a syscall?
 *
 * ## Why this is measured before the adapter exists
 *
 * `HostRuntimeTransport` declares `terminate(reason)` as a first-class
 * operation, separate from `write` on purpose, and ADR-0023 Decision 8 kills the
 * host rather than resuming it. So the transport must come down cleanly at an
 * arbitrary moment — and that is the property neither candidate design's
 * description covered.
 *
 * Overlapped-polled-from-main needs no measurement to reject: a poll loop in the
 * process that must stay responsive is a latency floor on every frame, paid
 * whether or not anything is in flight. What is left is a worker thread, and the
 * question is how it stops. Blocking inside `ReadFile` and unwedging with
 * `CancelIoEx` from another thread, or by closing the handle underneath it, is
 * teardown that works on one machine and hangs on another. Waiting on the
 * operation's completion event **and** a stop event turns a stop into a wait
 * returning.
 *
 * **Termination is the half that cannot be retrofitted.** A transport that
 * carries bytes correctly and cannot be torn down has to be rewritten, and by
 * then there is a runtime loop on top of it.
 *
 * ## TWO CELLS, because a reader has two waits
 *
 * The first version of this probe had one, issued `ReadFile` immediately and got
 * `ERROR_PIPE_LISTENING`: a server instance cannot be read before a client
 * connects. So a reader waits for a client, then waits for bytes, and a design
 * stoppable only in the second would be stoppable only in the case that does not
 * matter — a host that never connects is exactly what Decision 8 kills for.
 *
 *   waiting for a client   nothing connects; main signals
 *   waiting for bytes      a client connects and stays silent; main signals
 *
 * ## What the cases separate
 *
 * The reassuring answer is *the worker stopped*, and a worker that never started
 * produces it just as well — so each cell requires the worker to REPORT that its
 * wait is entered, at the stage that cell is about, before anything is
 * signalled.
 *
 * Usage: node scripts/research/transportTeardown.mjs
 */

import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import koffi from 'koffi';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';

const ROOT = repoRoot();

/** How long main waits for the worker to exit after signalling. */
const TEARDOWN_BUDGET_MS = 2000;
/** How long main waits for the worker to report the wait this cell is about. */
const SETUP_BUDGET_MS = 10000;

if (process.platform !== 'win32') {
  process.stdout.write(
    'UNVERIFIABLE: this measures Win32 overlapped I/O and a Win32 wait. Nothing here can be ' +
      'read on another platform, and a pass on one would be a claim about a mechanism that was ' +
      'not exercised.\n',
  );
  process.exit(0);
}

const BUILT_PIPE_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js');
const BUILT_PIPE_FACTORY = join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js');
for (const built of [BUILT_PIPE_SURFACE, BUILT_PIPE_FACTORY]) {
  if (!existsSync(built)) {
    process.stdout.write(
      `UNVERIFIABLE: ${built} is not built. This drives the SHIPPED pipe rather than a copy, so ` +
        `without the build there is nothing to measure. Run \`npm run build\`.\n`,
    );
    process.exit(0);
  }
}

const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
  pathToFileURL(BUILT_PIPE_SURFACE).href
);
const { createHostPipe } = await import(pathToFileURL(BUILT_PIPE_FACTORY).href);

const kernel = koffi.load('kernel32.dll');
const CreateEventW = kernel.func(
  'void *CreateEventW(void *attrs, bool manualReset, bool initial, const char16_t *name)',
);
const SetEvent = kernel.func('bool SetEvent(void *event)');
const CloseHandle = kernel.func('bool CloseHandle(void *handle)');

/** @type {string[]} */
const failures = [];
/** Three per cell — setup, the stop, the exit — plus the one handle fact. */
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const CONTAINER = 'monstera-transport-teardown-probe';
const surface = createWin32PipeSurface();

const user = currentUserSid();
const container = hostContainerSid(CONTAINER);
if (!user.ok || !container.ok) {
  process.stderr.write(
    `the SIDs could not be resolved, so no pipe can be built: ` +
      `${user.ok ? '' : user.error}${container.ok ? '' : container.error}\n`,
  );
  process.exit(1);
}

/** @param {() => boolean} until @param {number} budget @returns {Promise<number>} */
function waitFor(until, budget) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (until() || Date.now() - started > budget) {
        clearInterval(tick);
        resolve(Date.now() - started);
      }
    }, 20);
  });
}

/**
 * One cell: start a reader, let it reach the named wait, signal, watch it go.
 *
 * @param {string} label @param {'connect' | 'read'} stage
 * @param {boolean} withClient whether a client connects before the signal
 * @returns {Promise<{ said: Array<{ outcome: string, stage: string, detail: string }>, entered: number, code: number | null, took: number, wedged: boolean }>}
 */
async function runCell(label, stage, withClient) {
  const pipeName = '\\\\.\\pipe\\' + `${CONTAINER}-${String(process.pid)}-${label}`;
  const built = createHostPipe(surface, pipeName, user.value, container.value, 1);
  if (!built.ok) {
    throw new Error(`the shipped factory refused at stage '${built.error.stage}': ${built.error.detail}`);
  }

  // MANUAL RESET, because a stop is permanent. An auto-reset event consumed by
  // one waiter would leave a second reader — if there is ever one — waiting on a
  // transport that has already been told to stop.
  const stopEvent = CreateEventW(null, true, false, null);

  /** @type {Array<{ outcome: string, stage: string, detail: string }>} */
  const said = [];
  const worker = new Worker(join(ROOT, 'scripts', 'research', 'transportTeardownWorker.mjs'), {
    workerData: {
      pipeAddress: String(koffi.address(built.value.instances[0])),
      stopAddress: String(koffi.address(stopEvent)),
    },
  });
  worker.on('message', (message) => said.push(message));

  const client = withClient ? connect(pipeName) : null;
  client?.on('error', () => undefined);

  const entered = await waitFor(
    () => said.some((m) => m.outcome === 'waiting' && m.stage === stage),
    SETUP_BUDGET_MS,
  );

  const exited = new Promise((resolve) => {
    const started = Date.now();
    worker.on('exit', (code) => resolve({ code, took: Date.now() - started }));
    setTimeout(() => resolve({ code: null, took: Date.now() - started }), TEARDOWN_BUDGET_MS);
  });

  SetEvent(stopEvent);
  const gone = /** @type {{ code: number | null, took: number }} */ (await exited);

  client?.destroy();

  // A WEDGED READER IS REPORTED, NEVER TIDIED UP AFTER (finding CCCC-3).
  //
  // Measured 2026-08-25 by removing `FILE_FLAG_OVERLAPPED` from the shipped
  // surface — the mutation this probe's whole argument rests on. With a
  // synchronous handle the worker blocks inside `ConnectNamedPipe`, which is the
  // failure being demonstrated; but `CloseHandle` on that instance then blocks
  // TOO, and the probe hung for ten minutes instead of failing. A probe whose
  // failure mode is a hang cannot report the failure it exists to detect, and on
  // CI that arrives as a job timeout rather than as a named case.
  //
  // So the cleanup is skipped when the worker is still alive. The handles leak
  // into a process that is about to exit non-zero, which is the right trade: the
  // point of this run is the diagnosis, and a tidy exit that never happens is
  // worth nothing.
  if (gone.code === null) {
    anyWedged = true;
    process.stderr.write(
      `\nThe reader did not exit within ${String(TEARDOWN_BUDGET_MS)}ms of the stop, so its ` +
        `handles are deliberately NOT closed: a thread blocked in a synchronous pipe call blocks ` +
        `CloseHandle as well, and this probe hanging is a worse outcome than a leak in a process ` +
        `that is about to die. Cell: ${label}. It said ${JSON.stringify(said)}.\n`,
    );
    return { said, entered, ...gone, wedged: true };
  }

  for (const instance of built.value.instances) surface.close(instance);
  CloseHandle(stopEvent);
  return { said, entered, ...gone, wedged: false };
}

/**
 * @param {string} what @param {'connect' | 'read'} stage
 * @param {{ said: Array<{ outcome: string, stage: string, detail: string }>, entered: number, code: number | null, took: number, wedged: boolean }} cell
 */
function assertCell(what, stage, cell) {
  const reached = cell.said.some((m) => m.outcome === 'waiting' && m.stage === stage);
  check(
    `SETUP: the reader entered the ${what} wait before anything was signalled`,
    reached,
    `after ${String(cell.entered)}ms it had said ${JSON.stringify(cell.said)}. Everything below ` +
      `is about a wait RETURNING, so a stop that arrives before the wait exists measures ` +
      `nothing — and "the worker stopped" is what a worker that never started also reports.`,
  );
  check(
    `the ${what} wait returned on the STOP event`,
    cell.said.some((m) => m.outcome === 'stopped' && m.stage === stage),
    `it said ${JSON.stringify(cell.said)}. Only 'stopped' at this stage is the property: main ` +
      `signalled and the reader came back from a wait rather than being interrupted inside a ` +
      `syscall. An 'error' outcome carries its own reason; a 'read' means bytes arrived and this ` +
      `measured the wrong handle.`,
  );
  check(
    `the reader exited cleanly and within ${String(TEARDOWN_BUDGET_MS)}ms after a ${what} stop`,
    cell.code === 0 && cell.took < TEARDOWN_BUDGET_MS,
    `exit code ${String(cell.code)} after ${String(cell.took)}ms. A null code is the budget ` +
      `expiring with the thread alive, which is the failure this design exists to avoid: a ` +
      `reader wedged where terminate() cannot reach it. terminate() runs on a path that kills ` +
      `the host, so an unbounded teardown is a shutdown that hangs rather than one that fails.`,
  );
}

/** Set when a reader outlived its budget, which changes how this process ends. */
let anyWedged = false;

/**
 * Prints what failed and stops. Never returns.
 *
 * ## `process.exit` IS NOT ENOUGH WHEN A READER IS WEDGED (finding CCCC-3)
 *
 * Measured 2026-08-25, twice, by removing `FILE_FLAG_OVERLAPPED` from the
 * shipped surface. The first version tidied up before reporting, and
 * `CloseHandle` on an instance with a blocked synchronous `ConnectNamedPipe`
 * blocks as well — the probe hung for ten minutes and reported nothing. Skipping
 * the cleanup fixed that half: the three failing cases printed with their
 * diagnoses. And then the process still did not exit. `process.exit(1)` does not
 * end a process whose worker thread is inside a syscall.
 *
 * So a wedged run ends with `TerminateProcess`, which is what
 * `process.kill(SIGKILL)` is on Windows. The exit code is non-zero either way
 * and the diagnosis is already on stderr; what this buys is that CI sees a
 * FAILING STEP rather than a job timeout, and a reader gets the reason rather
 * than a wall clock.
 *
 * A probe whose failure mode is a hang cannot report the failure it exists to
 * detect. That is worth more than the instance: this one's whole subject is
 * teardown, and its own teardown was the thing that did not work.
 */
function bail() {
  process.stderr.write(
    `\nTransport teardown — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  if (anyWedged) {
    process.stderr.write(
      'A reader is still inside a syscall, so this process cannot exit normally and is being ' +
        'terminated. The failures above are the result; the termination is not one of them.\n',
    );
    process.kill(process.pid, 'SIGKILL');
  }
  process.exit(1);
}

const waitingForClient = await runCell('noclient', 'connect', false);
assertCell('waiting-for-a-client', 'connect', waitingForClient);

// ONE WEDGED READER IS ENOUGH. Running the second cell would only produce a
// second thread nothing can stop, and this process then exits with two of them
// alive. The first failure is the whole diagnosis.
if (waitingForClient.wedged) bail();

const waitingForBytes = await runCell('silent', 'read', true);
assertCell('waiting-for-bytes', 'read', waitingForBytes);

// THE HANDLE QUESTION, asserted once over both cells because it is one fact:
// postMessage carries structured-cloneable data and not koffi pointers, so the
// handle travelled as an address. Had it not, the shipped adapter would have to
// create the pipe INSIDE the worker — which moves where createHostPipe is
// called, so this is a design reading rather than a harness detail.
check(
  'HANDLES CROSS AS ADDRESSES: both readers drove a pipe main created',
  [waitingForClient, waitingForBytes].every((cell) =>
    cell.said.some((m) => m.outcome === 'waiting'),
  ),
  `the cells said ${JSON.stringify([waitingForClient.said, waitingForBytes.said])}. A reader that ` +
    `never reached a wait at all did not use the handle it was given.`,
);

// EVIDENCE, printed whether or not anything failed, because the numbers are what
// the transport's design is being decided from.
process.stdout.write(
  `\n  waiting for a client   entered after ${String(waitingForClient.entered)}ms, ` +
    `exited ${String(waitingForClient.took)}ms after the signal, code ${String(waitingForClient.code)}\n` +
    `  waiting for bytes      entered after ${String(waitingForBytes.entered)}ms, ` +
    `exited ${String(waitingForBytes.took)}ms after the signal, code ${String(waitingForBytes.code)}\n\n`,
);

if (failures.length > 0) bail();

process.stdout.write(`${roster.format('teardown case')}`);
