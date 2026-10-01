// @ts-check
/**
 * Disposing the engine host's reader channel never ends the process.
 *
 * ## The defect
 *
 * `engineReaderChannel.ts`' `dispose` ended a reader that had not yet ended with `worker.terminate()`, and every
 * deliberate close reached it: the transport signals the stop event, announces its ending on the next tick, and the
 * connection disposes the channel there — while the reader, woken by that same event, is still on its way out. A
 * termination that lands while the thread is inside a koffi call fails koffi's own throw, and node-addon-api answers a
 * failed throw with `napi_fatal_error`. The whole process aborts, exit 134, printing
 * `FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw`.
 *
 * Observed 2026-10-01 in the packaged 0.1.6.0 as the application vanishing mid-run, with the reader's JavaScript stack
 * at `abandonOperation` — the cancel it issues after being stopped while waiting for a host to connect.
 *
 * ## The two arms
 *
 * - CONTROL: the shipped reader thread, started on a real pipe and stop event made by the shipped surfaces, stopped,
 *   and TERMINATED a swept moment later — the order the old `dispose` took. At least one process must abort with the
 *   fatal error, or the other arm's silence proves nothing: this arm is what shows the instrument can see the abort.
 * - THE SHIPPED CHANNEL: stopped and disposed across the same sweep. No process aborts, and every dispose's `release`
 *   runs exactly once — after the reader's ending, which is the other half of the fix (the pipe outlives the reader).
 *
 * The moment is swept across 0–130 ms after the stop, because the reader's ending arrives 57–127 ms after it (measured
 * 2026-10-01) and the abort needs the termination to land inside a native call on that path. Each process runs many
 * iterations because one abort ends it; the parent counts how processes ended.
 *
 * ## What it does not cover
 *
 * That `dispose` cannot terminate the thread is the TYPE's to guarantee — `ReaderWorkerHandle` has no `terminate`.
 * This proves the hazard is real and that the shipped channel completes its teardown on a real thread without it.
 *
 * Usage: node scripts/proofs/readerDispose.proof.mjs [--require-transport]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { READER_DISPOSE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();
const SELF = fileURLToPath(import.meta.url);
/** Iterations per process. One abort ends a process, so a process is a trial of this many. */
const PER_PROCESS = 60;
/** Processes the control may take to show one abort; it stops at the first. */
const CONTROL_PROCESSES = 20;
/** Processes the shipped channel runs, every one of which must end cleanly. */
const CHANNEL_PROCESSES = 10;
/** The sweep after the stop, in milliseconds. */
const SWEEP_MS = 130;
const FATAL = 'Error::ThrowAsJavaScriptException napi_throw';

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

// ---------------------------------------------------------------------------------------------------------------
// A CHILD: one arm's iterations in one process.

if (process.argv[2] === 'child') {
  const arm = process.argv[3];
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
    const gap = (i / PER_PROCESS) * SWEEP_MS;
    if (arm === 'control') {
      // THE OLD ORDER, on the shipped thread: started as `readerHostSurface.ts` starts it, stopped, then terminated.
      const stop = surface.createStopEvent();
      if (stop === null) throw new Error('no stop event');
      const worker = new Worker(BUILT.reader, {
        workerData: { pipeAddress: surface.addressOf(pipe), stopAddress: surface.addressOf(stop), readBytes: 65536 },
      });
      const exited = new Promise((done) => worker.once('exit', done));
      await rest(30);
      surface.signal(stop);
      spin(gap);
      void worker.terminate();
      await exited;
      surface.closeEvent(stop);
      pipes.close(pipe);
    } else {
      const made = createEngineReaderChannel(surface, pipe, 65536);
      if (!made.ok) throw new Error(made.error);
      /** @type {() => void} */
      let markFreed = () => undefined;
      const freed = new Promise((done) => {
        markFreed = () => done(undefined);
      });
      await rest(30);
      made.value.channel.stop();
      spin(gap);
      made.value.dispose(() => {
        released += 1;
        pipes.close(pipe);
        markFreed();
      });
      await Promise.race([freed, rest(5000)]);
    }
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

/** @param {'control' | 'channel'} arm */
function runChild(arm) {
  const run = spawnSync(process.execPath, [SELF, 'child', arm], { encoding: 'utf8', timeout: 600_000 });
  return { status: run.status, aborted: run.stderr.includes(FATAL), stdout: run.stdout, stderr: run.stderr };
}

let controlProcesses = 0;
let controlAborts = 0;
while (controlProcesses < CONTROL_PROCESSES && controlAborts === 0) {
  const run = runChild('control');
  controlProcesses += 1;
  if (run.aborted && run.status === 134) controlAborts += 1;
}
check(
  'CONTROL: terminating the shipped reader on its way out aborts the process',
  controlAborts > 0,
  `${String(controlProcesses)} process(es) of ${String(PER_PROCESS)} stop-then-terminate each, and none aborted. ` +
    `Without an abort here, the shipped channel's arm ending cleanly below separates nothing.`,
);

let channelAborts = 0;
let channelOther = 0;
let releasedTotal = 0;
for (let i = 0; i < CHANNEL_PROCESSES; i += 1) {
  const run = runChild('channel');
  if (run.aborted) channelAborts += 1;
  else if (run.status !== 0) channelOther += 1;
  releasedTotal += Number(/released (\d+)/u.exec(run.stdout)?.[1] ?? 0);
  if (run.status !== 0 && !run.aborted) process.stderr.write(run.stderr.slice(-2000));
}
check(
  'the shipped channel, stopped and disposed across the same window, never aborts the process',
  channelAborts === 0 && channelOther === 0,
  `${String(channelAborts)} process(es) aborted with the fatal error and ${String(channelOther)} ended otherwise, ` +
    `of ${String(CHANNEL_PROCESSES)}.`,
);
check(
  'and every dispose released its pipe exactly once, after the reader ended',
  releasedTotal === CHANNEL_PROCESSES * PER_PROCESS,
  `${String(releasedTotal)} release(s) for ${String(CHANNEL_PROCESSES * PER_PROCESS)} dispose(s). A release that never ` +
    `ran is a pipe left open; the count is what the channel's waiting half has to answer for on a real thread.`,
);

process.stdout.write(
  `\n  control: an abort in process ${String(controlProcesses)} of up to ${String(CONTROL_PROCESSES)}\n` +
    `  shipped channel: ${String(CHANNEL_PROCESSES * PER_PROCESS)} dispose(s), ${String(channelAborts)} abort(s)\n\n`,
);
process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} reader dispose case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('reader dispose case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
