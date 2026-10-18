/**
 * What `memorySamplerWorker.ts` is given and what it posts back (ADR-0023 §3, corrected 2026-10-03 and 2026-10-18).
 *
 * Types only, like `readerProtocol.ts`: the worker is loaded by path, and what crosses into `main` is the shape of its
 * messages.
 *
 * ONE THREAD WATCHES EVERY HOST (the correction of 2026-10-18): a host is added by a {@link SamplerWatch} on the port the
 * thread is started with, and each host's ending comes back as a {@link SamplerReport} naming it.
 */

import type { MessagePort } from 'node:worker_threads';

/** The flags' indices in {@link SamplerWatch.flags}, one `Int32` each: every host has its own. */
export const SAMPLER_FLAG = {
  /** Set by `main` to end one host's sampling; the thread reads it every round, and `main` wakes the thread with it. */
  STOP: 0,
  /**
   * Set by the WORKER, before it terminates the host — so whoever reads the host's ending afterwards can tell it was
   * the memory budget and not a host that vanished. Read before the ending is reported, never after.
   */
  KILLED: 1,
} as const;

/** What the thread is started with. */
export interface SamplerWorkerData {
  /** The port `main` sends each {@link SamplerWatch} on; the thread reads it between rounds. */
  readonly port: MessagePort;
  /** One `Int32`, which `main` notifies to wake the thread at once: a host added, or a host's sampling stopped. */
  readonly wake: SharedArrayBuffer;
}

/** One host to watch. */
export interface SamplerWatch {
  /** `main`'s name for this watch, which every report about it carries. */
  readonly id: number;
  /** The engine host's process id. */
  readonly pid: number;
  /** The private commit, in bytes, at which the host is terminated: the budget less the measured headroom. */
  readonly killAtBytes: number;
  /** How long the thread waits between rounds at most, for this host. */
  readonly intervalMs: number;
  /** Two `Int32` flags, {@link SAMPLER_FLAG}, shared with `main`. */
  readonly flags: SharedArrayBuffer;
}

/** A host's one message, posted as its watch ends. */
export type SamplerMessage =
  /** The host reached `killAtBytes` and was terminated, at `privateBytes`. */
  | { readonly kind: 'killed'; readonly privateBytes: number }
  /** Sampling ended without a kill — main stopped it, or the host had ended — with the highest commit seen. */
  | { readonly kind: 'stopped'; readonly peakBytes: number }
  /** The sampler cannot see a host that is still running: it could not open it, or a read was refused. */
  | { readonly kind: 'failed'; readonly detail: string }
  /**
   * The host ended on its own, with Windows' exit code for it. The pipe reports a host that ends after it connected;
   * nothing else reports one that ends BEFORE, which left main waiting out the connect bound for a process that had
   * already gone.
   */
  | { readonly kind: 'exited'; readonly code: number };

/** What the thread posts: one host's {@link SamplerMessage}, named by its watch. */
export interface SamplerReport {
  readonly id: number;
  readonly message: SamplerMessage;
}
