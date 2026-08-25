import { parentPort } from 'node:worker_threads';

import type { WorkerModeReport } from './workerModeReport.js';

/**
 * The worker half of the harness that measures which MODE a worker thread runs
 * in.
 *
 * ## Why this exists
 *
 * The placement rule says *anything that runs in Node mode lives outside
 * `desktop`*, and `apps/desktop/src/` is exempted from the Electron-import ban
 * as a PROXY for "runs inside Electron". The engine host's reader is a
 * `worker_threads` Worker inside the Electron main process, and whether that is
 * Node mode or Electron mode decided where the shipped file lives.
 *
 * The rule's premise was that a worker is Node mode. That is a claim about the
 * runtime, so it was measured rather than cited — and it has an expiry a
 * document cannot enforce, because an Electron bump is exactly the event that
 * would change it in silence. The answer became
 * [ADR-0024](../../../docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)
 * and the package this file now sits in.
 *
 * **It was in `apps/desktop/src/` when it took that measurement**, which is
 * finding DDDD-9: a file running in Node mode, in the directory its own reading
 * said Node-mode code must leave. It imported no Electron so nothing was broken,
 * and that is exactly why it would have stayed.
 *
 * ## What it reports and why the failure is a value rather than a throw
 *
 * A throw inside a worker arrives at the parent as an `error` event with a
 * stack, which is a different shape from a report and would have to be parsed
 * separately. Every outcome here is a field instead, so the harness has one
 * thing to forward and the probe one thing to read.
 *
 * This file is built into `dist/` and is a worker ENTRY POINT: loaded by path
 * through `new Worker(…)`, never imported. `index.ts` does not re-export it, so
 * nothing can pull its top-level work in by accident. The shape it posts back is
 * `workerModeReport.ts`, which the package does export, because that shape is
 * what crosses the boundary as a value.
 */
async function look(): Promise<WorkerModeReport> {
  const processType = (process as NodeJS.Process & { type?: string }).type;
  const electronVersion = process.versions.electron;
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
