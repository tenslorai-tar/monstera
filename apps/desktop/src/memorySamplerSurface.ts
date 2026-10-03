import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { SAMPLER_FLAG, type SamplerMessage, type SamplerWorkerData } from '@monstera/nodemode';

/**
 * Starting an engine host's memory sampler (ADR-0023 §3, corrected 2026-10-03): the worker thread, and the two
 * shared flags `main` reads and sets. The sampling itself is `memorySamplerWorker.ts`'s, in Node mode.
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
  /** The worker's one message, as it ends: a kill, a stop, or that it could not watch the host at all. */
  readonly onMessage: (sink: (message: SamplerMessage) => void) => void;
  /** Ends the sampling and wakes the worker. Safe to call more than once. */
  readonly stop: () => void;
}

/** Where the sampler's entry point sits, resolved through the package as the reader's is. */
export function memorySamplerEntryPath(): string {
  const entry = createRequire(import.meta.url).resolve('@monstera/nodemode');
  return join(dirname(entry), 'memorySamplerWorker.js');
}

export function createMemorySamplerSurface(entryPath: string = memorySamplerEntryPath()): MemorySamplerSurface {
  return {
    start: (pid, killAtBytes, intervalMs) => {
      const flags = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
      const view = new Int32Array(flags);
      const data: SamplerWorkerData = { pid, killAtBytes, intervalMs, flags };
      let worker: Worker;
      try {
        worker = new Worker(entryPath, { workerData: data });
      } catch {
        // A REFUSAL, not a throw, for the reader's reason: the connection treats `null` as a stage that failed.
        return null;
      }
      // NOT A REASON TO STAY ALIVE: the sampler watches a host, and the host's own lifetime is what keeps things open.
      worker.unref();
      // EVERY WAY THE THREAD CAN END IS ONE MESSAGE. The worker posts exactly one as it ends; a thread that throws, or
      // exits without posting, has stopped watching just as surely, and is reported as a failure rather than as
      // nothing — a sampler that ended in silence would leave a host watched by no one, which is the finding.
      let ended = false;
      let sinks: ((message: SamplerMessage) => void)[] = [];
      const end = (message: SamplerMessage): void => {
        if (ended) return;
        ended = true;
        for (const sink of sinks) sink(message);
      };
      worker.on('message', (message: SamplerMessage) => {
        end(message);
      });
      worker.on('error', (error: unknown) => {
        end({ kind: 'failed', detail: `the sampler thread threw: ${String(error)}` });
      });
      worker.on('exit', (code: number) => {
        end({ kind: 'failed', detail: `the sampler thread exited (${String(code)}) without saying why` });
      });
      return {
        killed: () => Atomics.load(view, SAMPLER_FLAG.KILLED) === 1,
        onMessage: (sink) => {
          sinks = [...sinks, sink];
        },
        stop: () => {
          Atomics.store(view, SAMPLER_FLAG.STOP, 1);
          Atomics.notify(view, SAMPLER_FLAG.STOP);
        },
      };
    },
  };
}
