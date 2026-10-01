// @ts-check
/**
 * Disposing the engine host's reader channel ends its thread cleanly, on a real thread, every time.
 *
 * ## The defect
 *
 * `engineReaderChannel.ts`' `dispose` ended a reader that had not yet ended with `worker.terminate()`, and every
 * deliberate close reached it: the transport signals the stop event, announces its ending on the next tick, and the
 * connection disposes the channel there — while the reader, woken by that same event, is still on its way out. A
 * termination that lands at the wrong moment of a koffi call fails koffi's own throw, and node-addon-api answers a
 * failed throw with `napi_fatal_error`. The whole process aborts, exit 134, printing
 * `FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw`.
 *
 * Observed 2026-10-01 in the packaged 0.1.6.0 as the application vanishing mid-run, with the reader's JavaScript stack
 * at `abandonOperation` — the cancel it issues after being stopped while waiting for a host to connect. Reproduced the
 * same day by `scripts/research/readerAbort.mjs`: the old order, stop then terminate swept across the reader's wake,
 * aborted 7 processes of 8 on Electron's Node and 3 of 8 on plain Node, sixty cycles each.
 *
 * ## Why the reproduction is research and not this proof's control
 *
 * It was this proof's control first, and a Windows Server 2022 runner went twenty processes without one abort
 * (CI at `6a230404`): whether the termination lands in the window is the machine's timing. A control that fires on one
 * runner and not another is a gate that reddens on correct code. Terminating first and waking after, and terminating
 * a thread looping on a koffi call, were each tried as a deterministic trigger and aborted nothing in 2,400 and 200
 * cycles — so the window is narrower than *inside a koffi call*, and the mechanism's reproduction stays where a
 * measurement belongs. That the channel CANNOT terminate the thread is the type's to hold: `ReaderWorkerHandle` has no
 * `terminate`, and `engineReaderChannel.test.ts` holds the waiting half.
 *
 * ## What this proves, and its control
 *
 * - THE SHIPPED CHANNEL, on the shipped thread over a real pipe and stop event made by the shipped surfaces: stopped
 *   and disposed across the window the old order aborted in, sixty cycles a process. No process ends but cleanly, and
 *   every dispose's `release` runs exactly once — after the reader's ending, the other half of the fix (the pipe
 *   outlives the reader).
 * - CONTROL, of the instrument: a process that ends the way the abort ends — the fatal line on stderr, exit 134 — is
 *   counted as an abort, and one that ends cleanly is not. Without it, *no abort* is also what a parent that never
 *   recognised one would report.
 *
 * Usage: node scripts/proofs/readerDispose.proof.mjs [--require-transport]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { READER_DISPOSE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();
const SELF = fileURLToPath(import.meta.url);
/** Stop-and-dispose cycles per process. */
const PER_PROCESS = 60;
/** Processes the shipped channel runs, every one of which must end cleanly. */
const CHANNEL_PROCESSES = 10;
/** The sweep after the stop, in milliseconds: the reader's ending arrives 57–127 ms after it (measured 2026-10-01). */
const SWEEP_MS = 130;
/** The line the abort prints, from the packaged application's own stderr. */
const FATAL = 'FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw';
/** The abort's exit code. */
const ABORTED = 134;

const BUILT = {
  pipeSurface: join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js'),
  pipeFactory: join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js'),
  readerSurface: join(ROOT, 'apps', 'desktop', 'dist', 'readerHostSurface.js'),
  readerChannel: join(ROOT, 'apps', 'desktop', 'dist', 'engineReaderChannel.js'),
  reader: join(ROOT, 'packages', 'nodemode', 'dist', 'readerWorker.js'),
};

/** @param {number} ms */
const rest = (ms) => new Promise((done) => setTimeout(done, ms));

/** A busy wait: a timer on Windows is coarser than the window being aimed at. @param {number} ms */
function spin(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Aiming, not waiting.
  }
}

/**
 * How a child process ended: an abort is the fatal line AND exit 134 — the two together, because either alone is
 * something else (a test failing with 134, a log that quotes the line).
 *
 * @param {{ status: number | null, stderr: string }} run
 */
function endedBy(run) {
  if (run.status === ABORTED && run.stderr.includes(FATAL)) return 'abort';
  return run.status === 0 ? 'clean' : 'other';
}

// ---------------------------------------------------------------------------------------------------------------
// THE CHILDREN.

if (process.argv[2] === 'abort-like') {
  // THE CONTROL'S CHILD: it ends the way the abort ends, and nothing else.
  process.stderr.write(`\n#\n# ${FATAL}\n----- Native stack trace -----\n`);
  process.exit(ABORTED);
}

if (process.argv[2] === 'channel') {
  const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
    '../../apps/desktop/dist/win32PipeSurface.js'
  );
  const { createHostPipe } = await import('../../apps/desktop/dist/enginePipeFactory.js');
  const { createReaderHostSurface } = await import('../../apps/desktop/dist/readerHostSurface.js');
  const { createEngineReaderChannel } = await import('../../apps/desktop/dist/engineReaderChannel.js');
  const pipes = createWin32PipeSurface();
  const user = currentUserSid();
  const container = hostContainerSid('monstera-reader-dispose-proof');
  if (!user.ok || !container.ok) throw new Error('the SIDs could not be resolved, so no pipe can be built');
  const surface = createReaderHostSurface(BUILT.reader);
  let released = 0;
  for (let i = 0; i < PER_PROCESS; i += 1) {
    const name = `\\\\.\\pipe\\monstera-reader-dispose-${String(process.pid)}-${String(i)}`;
    const built = createHostPipe(pipes, name, user.value, container.value, 1);
    if (!built.ok) throw new Error(`the shipped factory refused at ${built.error.stage}: ${built.error.detail}`);
    const pipe = built.value.instances[0];
    if (pipe === undefined) throw new Error('the shipped factory answered no pipe instance for a request of one');
    const made = createEngineReaderChannel(surface, pipe, 65536);
    if (!made.ok) throw new Error(made.error);
    /** @type {() => void} */
    let markFreed = () => undefined;
    const freed = new Promise((done) => {
      markFreed = () => done(undefined);
    });
    // THE READER REACHES ITS CONNECT WAIT — the state the packaged abort was in — before the close.
    await rest(30);
    made.value.channel.stop();
    spin((i / PER_PROCESS) * SWEEP_MS);
    made.value.dispose(() => {
      released += 1;
      pipes.close(pipe);
      markFreed();
    });
    await Promise.race([freed, rest(5000)]);
  }
  process.stdout.write(`released ${String(released)}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------
// THE PARENT.

const REQUIRE = process.argv.includes('--require-transport');
if (process.platform !== 'win32') {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'disposing the shipped reader channel',
    why: `this drives a Win32 named pipe and the shipped reader thread, which do not exist on ${process.platform}.`,
    flag: '--require-transport',
  });
}
for (const built of Object.values(BUILT)) {
  if (!existsSync(built)) {
    exitUnverifiable({
      required: REQUIRE,
      subject: 'disposing the shipped reader channel',
      why: `${built} is not built; this runs the shipped reader rather than a copy. Run \`npm run build\`.`,
      flag: '--require-transport',
    });
  }
}
refuseStaleBuild(ROOT, READER_DISPOSE, 5);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 3 });
/** @param {string} label @param {boolean} held @param {string} detail */
function check(label, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {'channel' | 'abort-like'} mode */
function runChild(mode) {
  return spawnSync(process.execPath, [SELF, mode], { encoding: 'utf8', timeout: 600_000 });
}

// THE CONTROL FIRST: the parent recognises an abort, and a clean ending is not one.
const abortLike = runChild('abort-like');
check(
  'CONTROL: a process ending the way the abort ends is counted as an abort',
  endedBy({ status: abortLike.status, stderr: abortLike.stderr }) === 'abort' && endedBy({ status: 0, stderr: '' }) === 'clean',
  `the abort-like child read as ${endedBy({ status: abortLike.status, stderr: abortLike.stderr })} (exit ${String(abortLike.status)}).`,
);

/** @type {Record<string, number>} */
const endings = { clean: 0, abort: 0, other: 0 };
let releasedTotal = 0;
for (let i = 0; i < CHANNEL_PROCESSES; i += 1) {
  const run = runChild('channel');
  const ending = endedBy({ status: run.status, stderr: run.stderr });
  endings[ending] = (endings[ending] ?? 0) + 1;
  releasedTotal += Number(/released (\d+)/u.exec(run.stdout)?.[1] ?? 0);
  if (ending !== 'clean') process.stderr.write(run.stderr.slice(-2000));
}
check(
  'the shipped channel, stopped and disposed across the window the old order aborted in, ends every process cleanly',
  endings['clean'] === CHANNEL_PROCESSES,
  `${String(endings['abort'])} aborted and ${String(endings['other'])} ended otherwise, of ${String(CHANNEL_PROCESSES)}.`,
);
check(
  'and every dispose released its pipe exactly once, after the reader ended',
  releasedTotal === CHANNEL_PROCESSES * PER_PROCESS,
  `${String(releasedTotal)} release(s) for ${String(CHANNEL_PROCESSES * PER_PROCESS)} dispose(s). A release that never ` +
    `ran is a pipe left open; the count is what the channel's waiting half has to answer for on a real thread.`,
);

process.stdout.write(
  `\n  shipped channel: ${String(CHANNEL_PROCESSES * PER_PROCESS)} stop-and-dispose cycle(s), ` +
    `${String(endings['abort'])} abort(s), ${String(releasedTotal)} release(s)\n\n`,
);
process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} reader dispose case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('reader dispose case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
