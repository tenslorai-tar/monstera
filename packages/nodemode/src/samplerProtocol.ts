/**
 * What `memorySamplerWorker.ts` is given and what it posts back (ADR-0023 §3, corrected 2026-10-03).
 *
 * Types only, like `readerProtocol.ts`: the worker is loaded by path, and what crosses into `main` is the shape of its
 * messages.
 */

/** The flags' indices in {@link SamplerWorkerData.flags}, one `Int32` each. */
export const SAMPLER_FLAG = {
  /** Set by `main` to end the sampling; the worker waits on it between samples, so setting it wakes the worker. */
  STOP: 0,
  /**
   * Set by the WORKER, before it terminates the host — so whoever reads the host's ending afterwards can tell it was
   * the memory budget and not a host that vanished. Read before the ending is reported, never after.
   */
  KILLED: 1,
} as const;

export interface SamplerWorkerData {
  /** The engine host's process id. */
  readonly pid: number;
  /** The private commit, in bytes, at which the host is terminated: the budget less the measured headroom. */
  readonly killAtBytes: number;
  /** How long the worker waits between samples. */
  readonly intervalMs: number;
  /** Two `Int32` flags, {@link SAMPLER_FLAG}, shared with `main`. */
  readonly flags: SharedArrayBuffer;
}

/** The worker's one message, posted as it ends. */
export type SamplerMessage =
  /** The host reached `killAtBytes` and was terminated, at `privateBytes`. */
  | { readonly kind: 'killed'; readonly privateBytes: number }
  /** Sampling ended without a kill — main stopped it, or the host had ended — with the highest commit seen. */
  | { readonly kind: 'stopped'; readonly peakBytes: number }
  /** The sampler cannot see a host that is still running: it could not open it, or a read was refused. */
  | { readonly kind: 'failed'; readonly detail: string };
