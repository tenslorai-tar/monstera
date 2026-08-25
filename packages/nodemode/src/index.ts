/**
 * Code that runs in **Node mode** and is not the document engine
 * ([ADR-0024](../../../docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)).
 *
 * ## What that means, and why a package rather than a directory
 *
 * The Electron binary may be the runtime here — a `worker_threads` Worker inside
 * Electron's main process reports `process.versions.electron` — while Electron's
 * APIs are absent: `process.type` is `undefined` and `import('electron')` yields
 * a module carrying no `app`. Measured, and it is the fourth failure of
 * `apps/desktop/src/` as a proxy for *runs inside Electron*, and the only one
 * where the import **succeeds** rather than throwing.
 *
 * So this package is not in `MAY_IMPORT_ELECTRON`. Naming the specifier here is
 * a red build by all four routes `patternsFor` covers, and TypeScript project
 * references reject it independently. There is no rule about when Electron may
 * be imported, because it cannot be (B5).
 *
 * ## What lives here and what does not
 *
 * Node-mode code whose SUBJECT is not the document engine. The engine host's
 * own protocol loop stays in `packages/kernel`, where its subject and its mode
 * agree; the factory that *spawns* a worker stays in `apps/desktop/`, where
 * Electron is the API surface and the code genuinely runs inside it.
 *
 * ## Most of this package is not reached through this file
 *
 * A worker entry point is loaded by PATH — `new Worker(…)` — not by import, so
 * it has no export to re-export. What crosses this boundary as a value is the
 * shape of what a worker posts back, and that is what this file exports. A
 * caller resolves the entry points through the package rather than by walking
 * relative directories out of its own `dist`.
 *
 * `lib` here is `ES2023` with no `DOM`, which is the package's premise stated to
 * the compiler: there is no window and no `fetch` in a worker thread.
 */

export type { WorkerModeReport } from './workerModeReport.js';
