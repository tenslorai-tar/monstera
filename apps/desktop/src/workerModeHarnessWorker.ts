import { parentPort } from 'node:worker_threads';

/**
 * The worker half of the harness that measures which MODE a worker thread runs
 * in.
 *
 * ## Why this exists
 *
 * CLAUDE.md's placement rule says *anything that runs in Node mode lives outside
 * `desktop`*, and that `apps/desktop/src/` is exempted from the Electron-import
 * ban as a PROXY for "runs inside Electron" — a proxy it records as having
 * failed three times. The engine host's reader is a `worker_threads` Worker
 * inside the Electron main process, and whether that is Node mode or Electron
 * mode decides where the shipped file lives.
 *
 * The rule's premise is that a worker is Node mode. That is a claim about the
 * runtime, so it is measured rather than cited — and it has an expiry a document
 * cannot enforce, because an Electron bump is exactly the event that would
 * change it in silence.
 *
 * ## What it reports and why the failure is a value rather than a throw
 *
 * A throw inside a worker arrives at the parent as an `error` event with a
 * stack, which is a different shape from a report and would have to be parsed
 * separately. Every outcome here is a field instead, so the harness has one
 * thing to forward and the probe one thing to read.
 *
 * This file is built into `dist/` and is not reachable from the package's
 * exports — `index.ts` does not re-export it — so nothing can import it by
 * accident and it is not part of the app.
 */
interface WorkerModeReport {
  /** Electron sets this on its own processes. `undefined` in plain Node. */
  readonly processType: string | undefined;
  /** Present whenever the Electron binary is the runtime, main or worker. */
  readonly electronVersion: string | undefined;
  /** What `import('electron')` did: a module, a string path, or a failure. */
  readonly importOutcome: 'module' | 'path' | 'failed';
  /** Whether the imported value carries `app` — the test of a USABLE module. */
  readonly hasApp: boolean;
  /** The failure's message, when there was one. */
  readonly detail: string;
}

async function look(): Promise<WorkerModeReport> {
  const processType = (process as NodeJS.Process & { type?: string }).type;
  const electronVersion = process.versions['electron'];
  try {
    // A DYNAMIC import deliberately. A static one would be resolved at build
    // time by the bundler and could not report a runtime failure, which is the
    // whole measurement.
    const loaded: unknown = await import('electron');
    // Electron's package main exports a STRING PATH when the runtime is not
    // Electron — that is the mechanism behind invariant 26, and it is exactly
    // what makes "the import succeeded" the wrong question to ask.
    if (typeof loaded === 'string') {
      return { processType, electronVersion, importOutcome: 'path', hasApp: false, detail: loaded };
    }
    const shape = loaded as { app?: unknown; default?: { app?: unknown } };
    const hasApp = shape.app !== undefined || shape.default?.app !== undefined;
    return { processType, electronVersion, importOutcome: 'module', hasApp, detail: '' };
  } catch (error) {
    return {
      processType,
      electronVersion,
      importOutcome: 'failed',
      hasApp: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

void look().then((report) => {
  parentPort?.postMessage(report);
});
