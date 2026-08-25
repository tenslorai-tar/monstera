/**
 * What a worker reports about the runtime mode it is running in.
 *
 * Declared in its own module with no side effects, so `index.ts` can re-export
 * the type without pulling in a worker entry point that starts work on import.
 */
export interface WorkerModeReport {
  /** Electron sets this on its own processes. `undefined` in plain Node. */
  readonly processType: string | undefined;
  /** Present whenever the Electron binary is the runtime, main or worker. */
  readonly electronVersion: string | undefined;
  /**
   * What `import('electron')` did.
   *
   * `module` and `path` are separated because *the import succeeded* is the
   * wrong question: Electron's package main exports a STRING PATH when the
   * runtime is not Electron, which is the mechanism behind invariant 26.
   */
  readonly importOutcome: 'module' | 'path' | 'failed';
  /** Whether the imported value carries `app` — the test of a USABLE module. */
  readonly hasApp: boolean;
  /** The path or the failure's message, when there was one. */
  readonly detail: string;
}
