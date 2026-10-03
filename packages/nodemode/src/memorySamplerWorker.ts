import { parentPort, workerData } from 'node:worker_threads';

import koffi from 'koffi';

import { SAMPLER_FLAG, type SamplerMessage, type SamplerWorkerData } from './samplerProtocol.js';

/**
 * An engine host's memory sampler — ADR-0023 §3's PRIMARY, built 2026-10-03 (CR-SEC-09).
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
};

/** `PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE`: what reading the commit and the kill need, nothing else. */
const ACCESS = 0x1000 | 0x0001;
/** The host's exit code when this kills it: `STATUS_NO_MEMORY`, so a crash dump or an event log reads it for what it was. */
const KILLED_EXIT_CODE = 0xc0000017;

const data = workerData as SamplerWorkerData;
const flags = new Int32Array(data.flags);
const say = (message: SamplerMessage): void => {
  parentPort?.postMessage(message);
};

const handle = win32.openProcess(ACCESS, false, data.pid);
if (handle === null || koffi.address(handle) === 0n) {
  say({ kind: 'failed', detail: `OpenProcess refused process ${String(data.pid)} (GetLastError ${String(win32.lastError())})` });
} else {
  const size = koffi.sizeof(COUNTERS);
  let peak = 0;
  let killedAt: number | null = null;
  while (Atomics.load(flags, SAMPLER_FLAG.STOP) === 0) {
    const counters: Record<string, unknown> = {};
    // A READ THAT FAILS is a host that has gone — its ending reaches main through the pipe — so sampling stops.
    if (win32.memoryInfo(handle, counters, size) !== true) break;
    const privateBytes = Number(counters['PrivateUsage']);
    peak = Math.max(peak, privateBytes);
    if (privateBytes >= data.killAtBytes) {
      // THE FLAG FIRST, then the kill: see the header.
      Atomics.store(flags, SAMPLER_FLAG.KILLED, 1);
      win32.terminate(handle, KILLED_EXIT_CODE);
      killedAt = privateBytes;
      break;
    }
    Atomics.wait(flags, SAMPLER_FLAG.STOP, 0, data.intervalMs);
  }
  win32.closeHandle(handle);
  say(killedAt === null ? { kind: 'stopped', peakBytes: peak } : { kind: 'killed', privateBytes: killedAt });
}
