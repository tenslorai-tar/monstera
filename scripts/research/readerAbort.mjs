// @ts-check
/**
 * Does terminating the engine host's reader thread on its way out abort the process? A measurement of the mechanism
 * behind `readerDispose.proof.mjs`, kept as research because its answer depends on the machine's timing.
 *
 * The order the old `dispose` took (before 2026-10-01): signal the reader's stop event, then terminate the thread a
 * moment later, while the reader — woken by that event — is still on its way out. This drives the SHIPPED reader thread
 * (`packages/nodemode/dist/readerWorker.js`) on a real pipe and stop event made by the shipped surfaces, sweeps the
 * moment of the termination across the reader's wake (0–130 ms; the ending arrives 57–127 ms after the stop), and
 * counts how child processes end. One abort ends a process, so each child is a trial of many cycles.
 *
 * Measured 2026-10-01 on the build machine: 7 processes of 8 aborted under Electron's Node (`--runtime electron`), 3 of
 * 8 under plain Node, sixty cycles each, every abort printing `FATAL ERROR: Error::ThrowAsJavaScriptException
 * napi_throw` with exit 134 — the packaged 0.1.6.0's crash; a third run, six processes, aborted four and lost a fifth
 * to an ACCESS VIOLATION (exit 3221225477, `0xC0000005`), a second way the same termination ends the process. A Windows
 * Server 2022 runner went twenty processes without one, which is why this is not a CI gate.
 *
 * The control is the abort itself: a run that reports no abort has not shown the mechanism, and says so rather than
 * reading as *the old order was safe*.
 *
 * Usage: node scripts/research/readerAbort.mjs [processes] [--runtime electron]
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { READER_DISPOSE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const SELF = fileURLToPath(import.meta.url);
const PER_PROCESS = 60;
const SWEEP_MS = 130;
const READER = join(ROOT, 'packages', 'nodemode', 'dist', 'readerWorker.js');
const FATAL = 'FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw';

/** @param {number} ms */
const rest = (ms) => new Promise((done) => setTimeout(done, ms));

if (process.argv[2] === 'child') {
  const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
    '../../apps/desktop/dist/win32PipeSurface.js'
  );
  const { createHostPipe } = await import('../../apps/desktop/dist/enginePipeFactory.js');
  const { createReaderHostSurface } = await import('../../apps/desktop/dist/readerHostSurface.js');
  const pipes = createWin32PipeSurface();
  const user = currentUserSid();
  const container = hostContainerSid('monstera-reader-abort');
  if (!user.ok || !container.ok) throw new Error('the SIDs could not be resolved');
  const surface = createReaderHostSurface(READER);
  for (let i = 0; i < PER_PROCESS; i += 1) {
    const built = createHostPipe(pipes, `\\\\.\\pipe\\monstera-reader-abort-${String(process.pid)}-${String(i)}`, user.value, container.value, 1);
    if (!built.ok) throw new Error(built.error.detail);
    const pipe = built.value.instances[0];
    if (pipe === undefined) throw new Error('no pipe instance');
    const stop = surface.createStopEvent();
    if (stop === null) throw new Error('no stop event');
    // STARTED AS `readerHostSurface.ts` STARTS IT, so the thread is the shipped one; terminated as the old order did.
    const worker = new Worker(READER, {
      workerData: { pipeAddress: surface.addressOf(pipe), stopAddress: surface.addressOf(stop), readBytes: 65536 },
    });
    const exited = new Promise((done) => worker.once('exit', done));
    await rest(30);
    surface.signal(stop);
    const until = performance.now() + (i / PER_PROCESS) * SWEEP_MS;
    while (performance.now() < until) {
      // A busy wait: a Windows timer is coarser than the window being aimed at.
    }
    void worker.terminate();
    await exited;
    surface.closeEvent(stop);
    pipes.close(pipe);
  }
  process.exit(0);
}

// THE BUILT READER AND SURFACES ARE THE SUBJECT, so a stale build would be measured under this build's name.
refuseStaleBuild(ROOT, READER_DISPOSE, 5);
const processes = Number(process.argv.find((argument) => /^\d+$/u.test(argument)) ?? 8);
const runtime = process.argv.includes('--runtime') && process.argv.includes('electron') ? electronBinaryPath(ROOT) : process.execPath;
let aborted = 0;
let clean = 0;
for (let i = 0; i < processes; i += 1) {
  const run = spawnSync(runtime, [SELF, 'child'], {
    encoding: 'utf8',
    timeout: 600_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (run.status === 134 && run.stderr.includes(FATAL)) aborted += 1;
  else if (run.status === 0) clean += 1;
  else process.stderr.write(`a child ended ${String(run.status)}: ${run.stderr.slice(-400)}\n`);
}
process.stdout.write(
  `${String(processes)} process(es) of ${String(PER_PROCESS)} stop-then-terminate cycles: ${String(aborted)} aborted, ` +
    `${String(clean)} clean.\n` +
    (aborted === 0 ? 'NO ABORT: the mechanism was not shown on this machine at this timing — not evidence the order is safe.\n' : ''),
);
