// @ts-check
/**
 * A worker thread for `hostMemoryHost.mjs`: samples one process's private commit every 10 ms until told to stop, and
 * posts the highest reading and how many samples it took.
 *
 * AN INSTRUMENT, independent of the sampler under test (`memorySamplerWorker.ts`): the proof needs to know what the
 * host's commit actually reached on THIS machine, so it can put the kill threshold between the open and the save
 * rather than at a figure measured somewhere else. On its own thread for the product sampler's reason — a sample taken
 * on the harness's event loop is late exactly when memory moves.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

/** @type {{ root: string, pid: number, stop: SharedArrayBuffer }} */
const data = workerData;
const koffi = createRequire(join(data.root, 'package.json'))('koffi');
const kernel = koffi.load('kernel32.dll');
koffi.struct('MONSTERA_PEAK_COUNTERS', {
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
const openProcess = kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const memoryInfo = kernel.func('bool K32GetProcessMemoryInfo(void *process, _Out_ MONSTERA_PEAK_COUNTERS *counters, uint32 cb)');
const closeHandle = kernel.func('bool CloseHandle(void *handle)');
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x0010;

const flag = new Int32Array(data.stop);
const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, data.pid);
let first = 0;
let peak = 0;
let samples = 0;
if (koffi.address(handle) !== 0n) {
  while (Atomics.load(flag, 0) === 0) {
    /** @type {Record<string, unknown>} */
    const counters = {};
    if (memoryInfo(handle, counters, koffi.sizeof('MONSTERA_PEAK_COUNTERS')) !== true) break;
    const reading = Number(counters['PrivateUsage']);
    // THE FIRST READING IS ANNOUNCED, so the caller starts the save only once it is taken.
    if (samples === 0) {
      first = reading;
      parentPort?.postMessage({ kind: 'first', first });
    }
    peak = Math.max(peak, reading);
    samples += 1;
    Atomics.wait(flag, 0, 0, 10);
  }
  closeHandle(handle);
}
// `first` is the commit when sampling began — the open document, before the save the caller starts next.
parentPort?.postMessage({ kind: 'done', first, peak, samples });
