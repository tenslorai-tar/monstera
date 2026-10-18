import { parentPort, receiveMessageOnPort, workerData } from 'node:worker_threads';

import koffi from 'koffi';

import { SAMPLER_FLAG, type SamplerMessage, type SamplerReport, type SamplerWatch, type SamplerWorkerData } from './samplerProtocol.js';

/**
 * The engine hosts' memory sampler — ADR-0023 §3's PRIMARY, built 2026-10-03 (CR-SEC-09), ONE thread for every host
 * since 2026-10-18 (a worker thread costs `main` 12.3 MB, measured; each host had one).
 *
 * ## On its own thread, because the thread that would otherwise run it is busy exactly when memory moves
 *
 * §3 says main samples the host's memory and kills it at the budget, with the job's `ProcessMemoryLimit` as the
 * backstop. A sampler on main's event loop was measured starving: 40 samples across a 27 s save where about 1,000 were
 * due. Here each sample is a `K32GetProcessMemoryInfo` call between `Atomics.wait`s on the stop flag, so nothing main
 * does can delay one, and a stop from main wakes the wait at once.
 *
 * ## It kills, and says so first
 *
 * At `killAtBytes` of private commit — what the job's limit counts — the worker sets the KILLED flag and THEN calls
 * `TerminateProcess`. The host's ending reaches main through its pipe after the process is gone, so a flag set before
 * the kill is always readable by then, and main reports the memory budget rather than a host that vanished. Killing
 * here rather than asking main to means a busy main cannot delay it.
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by path, never imported, and it runs in Node mode, which is why it lives in this package (ADR-0024).
 */

/**
 * The Win32 calls, declared with the C prototype beside each, as `readerWorker.ts` declares its own. The returns that
 * could be `boolean` are `unknown`, so success must be compared against `true`.
 */
interface SamplerBindings {
  readonly openProcess: (access: number, inherit: boolean, pid: number) => unknown;
  readonly memoryInfo: (process: unknown, counters: Record<string, unknown>, size: number) => unknown;
  readonly terminate: (process: unknown, exitCode: number) => unknown;
  readonly closeHandle: (handle: unknown) => unknown;
  readonly lastError: () => number;
  readonly exitCode: (process: unknown, code: number[]) => unknown;
}

const kernel = koffi.load('kernel32.dll');
// `PROCESS_MEMORY_COUNTERS_EX`: `PrivateUsage` is the commit charge the job's `ProcessMemoryLimit` counts.
const COUNTERS = koffi.struct('MONSTERA_SAMPLER_COUNTERS', {
  cb: 'uint32',
  PageFaultCount: 'uint32',
  PeakWorkingSetSize: 'size_t',
  WorkingSetSize: 'size_t',
  QuotaPeakPagedPoolUsage: 'size_t',
  QuotaPagedPoolUsage: 'size_t',
  QuotaPeakNonPagedPoolUsage: 'size_t',
  QuotaNonPagedPoolUsage: 'size_t',
  PagefileUsage: 'size_t',
  PeakPagefileUsage: 'size_t',
  PrivateUsage: 'size_t',
});
const win32: SamplerBindings = {
  openProcess: kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)'),
  memoryInfo: kernel.func('bool K32GetProcessMemoryInfo(void *process, _Out_ MONSTERA_SAMPLER_COUNTERS *counters, uint32 cb)'),
  terminate: kernel.func('bool TerminateProcess(void *process, uint32 exitCode)'),
  closeHandle: kernel.func('bool CloseHandle(void *handle)'),
  lastError: kernel.func('uint32 GetLastError()'),
  exitCode: kernel.func('bool GetExitCodeProcess(void *process, _Out_ uint32 *code)'),
};

/** `GetExitCodeProcess`' answer for a process that has not ended. */
const STILL_ACTIVE = 259;

/** `PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE`: what reading the commit and the kill need, nothing else. */
const ACCESS = 0x1000 | 0x0001;
/** The host's exit code when this kills it: `STATUS_NO_MEMORY`, so a crash dump or an event log reads it for what it was. */
const KILLED_EXIT_CODE = 0xc0000017;

const data = workerData as SamplerWorkerData;
const wake = new Int32Array(data.wake);
const SIZE = koffi.sizeof(COUNTERS);

/** One host being watched: its watch, its open handle, its flags and the highest commit seen. */
interface Watched {
  readonly watch: SamplerWatch;
  readonly handle: unknown;
  readonly flags: Int32Array;
  peak: number;
}

const watched = new Map<number, Watched>();

/** Ends one host's watch with its one message: the handle closed, the host taken off the table. */
function end(host: Watched, message: SamplerMessage): void {
  win32.closeHandle(host.handle);
  watched.delete(host.watch.id);
  const report: SamplerReport = { id: host.watch.id, message };
  parentPort?.postMessage(report);
}

/** Opens a host to watch, or reports at once that it cannot be watched. */
function add(watch: SamplerWatch): void {
  const handle = win32.openProcess(ACCESS, false, watch.pid);
  if (handle === null || koffi.address(handle) === 0n) {
    const report: SamplerReport = {
      id: watch.id,
      message: { kind: 'failed', detail: `OpenProcess refused process ${String(watch.pid)} (GetLastError ${String(win32.lastError())})` },
    };
    parentPort?.postMessage(report);
    return;
  }
  watched.set(watch.id, { watch, handle, flags: new Int32Array(watch.flags), peak: 0 });
}

/** One sample of one host: its watch ended with its message, or `undefined` to go on watching. */
function sample(host: Watched): SamplerMessage | undefined {
  if (Atomics.load(host.flags, SAMPLER_FLAG.STOP) !== 0) return { kind: 'stopped', peakBytes: host.peak };
  // ASKED FIRST, every sample: a process that has ended still answers the memory read through an open handle, so the
  // read alone never says the host is gone.
  const status = [STILL_ACTIVE];
  if (win32.exitCode(host.handle, status) === true && status[0] !== STILL_ACTIVE) return { kind: 'exited', code: status[0] ?? 0 };
  const counters: Record<string, unknown> = {};
  if (win32.memoryInfo(host.handle, counters, SIZE) !== true) {
    // A READ THAT FAILS IS ASKED WHY, and only a host that has ended stops the sampling quietly — its ending reaches main
    // through the pipe. A read refused while the host still runs is a sampler that can no longer see, which is the state
    // the finding was about, so it is reported as a failure and main ends the host. A failed read was once taken to mean
    // "the host has gone" without asking, which made a sampler that could not see indistinguishable from one whose host
    // had ended — both ended in silence.
    const error = win32.lastError();
    const exit = [0];
    return win32.exitCode(host.handle, exit) === true && exit[0] === STILL_ACTIVE
      ? { kind: 'failed', detail: `K32GetProcessMemoryInfo refused a running host (GetLastError ${String(error)})` }
      : { kind: 'stopped', peakBytes: host.peak };
  }
  const privateBytes = Number(counters['PrivateUsage']);
  host.peak = Math.max(host.peak, privateBytes);
  if (privateBytes >= host.watch.killAtBytes) {
    // THE FLAG FIRST, then the kill: see the header.
    Atomics.store(host.flags, SAMPLER_FLAG.KILLED, 1);
    win32.terminate(host.handle, KILLED_EXIT_CODE);
    return { kind: 'killed', privateBytes };
  }
  return undefined;
}

// ROUND AFTER ROUND, every host each round (ADR-0023's correction of 2026-10-18): the watches main has sent are taken
// first, then each host is sampled, then the thread waits the shortest interval any host asks for, woken at once by a
// host added or stopped. It never ends of its own accord: `main` ends it when its last host's watch has ended, and
// starts another with the next host, so no message is lost between a thread deciding to end and a watch arriving.
for (;;) {
  for (let received = receiveMessageOnPort(data.port); received !== undefined; received = receiveMessageOnPort(data.port)) {
    add(received.message as SamplerWatch);
  }
  for (const host of [...watched.values()]) {
    const ended = sample(host);
    if (ended !== undefined) end(host, ended);
  }
  const interval = Math.min(...[...watched.values()].map((host) => host.watch.intervalMs));
  Atomics.wait(wake, 0, 0, Number.isFinite(interval) ? interval : undefined);
  Atomics.store(wake, 0, 0);
}
