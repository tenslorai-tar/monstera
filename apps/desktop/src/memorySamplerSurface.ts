import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { MessageChannel, Worker } from 'node:worker_threads';

import { SAMPLER_FLAG, type SamplerMessage, type SamplerReport, type SamplerWatch, type SamplerWorkerData } from '@monstera/nodemode';

/**
 * Starting an engine host's memory sampler (ADR-0023 §3, corrected 2026-10-03 and 2026-10-18): the shared flags `main`
 * reads and sets, and the ONE worker thread that samples every host. The sampling itself is `memorySamplerWorker.ts`'s,
 * in Node mode.
 *
 * ## One thread for every host
 *
 * A worker thread is a whole V8 isolate, 12.3 MB of `main`'s private memory idle (measured 2026-10-18), and each host
 * had one sampler. Now a host's `start` sends the thread a watch, starting the thread if none runs, and the thread is
 * ended when the last watch it holds has ended, so an application with no host holds none. What a host's connection
 * sees is unchanged: its own `killed`, its one message, its own `stop`.
 *
 * Injected into the connection as `readerHostSurface.ts` is, so the connection's cases decide the sampler's answers
 * without a thread or a process.
 */
export interface MemorySamplerSurface {
  /** Starts sampling `pid`, killing it at `killAtBytes` of private commit. `null` when the thread could not start. */
  readonly start: (pid: number, killAtBytes: number, intervalMs: number) => MemorySampler | null;
}

export interface MemorySampler {
  /** Whether the sampler killed the host. Read when the host's ending is named, so it is set before the ending arrives. */
  readonly killed: () => boolean;
  /** The host's one message, as its watch ends: a kill, a stop, or that it could not watch the host at all. */
  readonly onMessage: (sink: (message: SamplerMessage) => void) => void;
  /** Ends the sampling and wakes the thread. Safe to call more than once. */
  readonly stop: () => void;
}

/** Where the sampler's entry point sits, resolved through the package as the reader's is. */
export function memorySamplerEntryPath(): string {
  const entry = createRequire(import.meta.url).resolve('@monstera/nodemode');
  return join(dirname(entry), 'memorySamplerWorker.js');
}

/** The thread running for one entry point, and the hosts it watches by their watch's id. */
interface Shared {
  readonly worker: Worker;
  readonly send: (watch: SamplerWatch) => void;
  readonly wake: Int32Array;
  readonly hosts: Map<number, (message: SamplerMessage) => void>;
}

/** THE thread per entry point, process-wide: every surface over the same entry point shares it. */
const running = new Map<string, Shared>();
let nextId = 0;

/** Wakes the thread, so a host added or stopped is seen at once rather than at the next round. */
function wakeUp(shared: Shared): void {
  Atomics.store(shared.wake, 0, 1);
  Atomics.notify(shared.wake, 0);
}

/** Starts the thread for `entryPath`, or answers the one running. `null` where it could not start. */
function threadFor(entryPath: string): Shared | null {
  const held = running.get(entryPath);
  if (held !== undefined) return held;
  const wakeBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const { port1, port2 } = new MessageChannel();
  const data: SamplerWorkerData = { port: port2, wake: wakeBuffer };
  let worker: Worker;
  try {
    worker = new Worker(entryPath, { workerData: data, transferList: [port2] });
  } catch {
    // A REFUSAL, not a throw, for the reader's reason: the connection treats `null` as a stage that failed.
    port1.close();
    return null;
  }
  // NOT A REASON TO STAY ALIVE: the sampler watches hosts, and the hosts' own lifetimes are what keep things open.
  worker.unref();
  port1.unref();
  const shared: Shared = {
    worker,
    // THE FLAGS ARE SHARED, not transferred: a `SharedArrayBuffer` posted is the same memory on both sides.
    send: (watch) => {
      port1.postMessage(watch);
    },
    wake: new Int32Array(wakeBuffer),
    hosts: new Map(),
  };
  /** One host's message, delivered, and the thread ended once it watches nothing. */
  const deliver = (id: number, message: SamplerMessage): void => {
    const sink = shared.hosts.get(id);
    if (sink === undefined) return;
    shared.hosts.delete(id);
    sink(message);
    if (shared.hosts.size === 0 && running.get(entryPath) === shared) {
      running.delete(entryPath);
      port1.close();
      void worker.terminate();
    }
  };
  // EVERY WAY THE THREAD CAN END IS EACH WATCHED HOST'S ONE MESSAGE: a thread that throws, or exits, has stopped watching
  // every host just as surely, and each is told so rather than nothing — a sampler that ended in silence would leave a
  // host watched by no one, which is the finding. A thread `main` ended itself watches nothing, so it tells no one.
  const all = (message: SamplerMessage): void => {
    if (running.get(entryPath) === shared) running.delete(entryPath);
    for (const id of [...shared.hosts.keys()]) deliver(id, message);
  };
  worker.on('message', (report: SamplerReport) => {
    deliver(report.id, report.message);
  });
  worker.on('error', (error: unknown) => {
    all({ kind: 'failed', detail: `the sampler thread threw: ${String(error)}` });
  });
  worker.on('exit', (code: number) => {
    all({ kind: 'failed', detail: `the sampler thread exited (${String(code)}) without saying why` });
  });
  running.set(entryPath, shared);
  return shared;
}

export function createMemorySamplerSurface(entryPath: string = memorySamplerEntryPath()): MemorySamplerSurface & {
  /** How many sampling threads run for this entry point now: one while any host is watched, none otherwise. */
  readonly threads: () => number;
} {
  return {
    threads: () => (running.has(entryPath) ? 1 : 0),
    start: (pid, killAtBytes, intervalMs) => {
      const shared = threadFor(entryPath);
      if (shared === null) return null;
      const flags = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
      const view = new Int32Array(flags);
      const id = (nextId += 1);
      let sinks: ((message: SamplerMessage) => void)[] = [];
      shared.hosts.set(id, (message) => {
        for (const sink of sinks) sink(message);
      });
      shared.send({ id, pid, killAtBytes, intervalMs, flags });
      wakeUp(shared);
      return {
        killed: () => Atomics.load(view, SAMPLER_FLAG.KILLED) === 1,
        onMessage: (sink) => {
          sinks = [...sinks, sink];
        },
        stop: () => {
          Atomics.store(view, SAMPLER_FLAG.STOP, 1);
          wakeUp(shared);
        },
      };
    },
  };
}
