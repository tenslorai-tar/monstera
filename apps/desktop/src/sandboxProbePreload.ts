import { contextBridge } from 'electron';

import { SANDBOX_PROBE_KEY } from './sandboxProbeKey.js';

/**
 * A harness-only preload that asks whether it can reach Node, and reports.
 *
 * ## Why the product preload cannot answer this
 *
 * `proof:rendererpolicy` reports that no Node surface is reachable from page
 * script. That is the **union** consequence of `sandbox`, `contextIsolation` and
 * `nodeIntegration: false` and cannot be attributed to any one of them — the
 * proof says so, and finding II-2 is that the evidence previously offered for
 * `sandbox: true` specifically was evidence for a different proposition. The
 * SUID helper Chromium needs on Linux backs the browser's OS-level sandbox,
 * which the zygote and the GPU and utility processes require whatever one
 * window's `webPreferences.sandbox` says.
 *
 * **A preload separates the three, and nothing else does.** `nodeIntegration`
 * governs the page, not the preload: an unsandboxed preload has full Node
 * regardless of it. `contextIsolation` governs which world the preload's globals
 * land in, not what the preload itself may require. So a preload that tries to
 * reach a Node builtin is answering about `sandbox` alone — and the mutation
 * that proves the attribution is flipping `sandbox` by itself and requiring the
 * page-side case to stay green while this one goes red.
 *
 * ## Harness-only, and the product preload stays 233 bytes
 *
 * Nothing in the app loads this. It is built alongside the real preload because
 * a sandboxed preload must be CommonJS and must resolve no bare specifiers, and
 * those constraints are the build's rather than this file's.
 *
 * It exposes under its own key so it can never be mistaken for the contract
 * bridge, and it reports a STRING rather than a boolean: "it threw" and "it
 * returned something unusable" are different answers, and collapsing them would
 * be the reassuring one.
 */
/** What happened when the preload asked for a Node builtin. */
function reachNodeBuiltin(): string {
  try {
    // `require` is the thing under test. A sandboxed preload's `require` is a
    // small polyfilled shim rather than Node's, and asking what it does with a
    // builtin is the entire purpose of this file — so the rule is disabled here
    // and nowhere else.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs: unknown = require('node:fs');
    if (fs === null || fs === undefined) return 'returned nullish';
    const readFileSync = (fs as { readFileSync?: unknown }).readFileSync;
    return typeof readFileSync === 'function'
      ? 'returned a usable fs: readFileSync is a function'
      : `returned an object without readFileSync (${typeof readFileSync})`;
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

contextBridge.exposeInMainWorld(SANDBOX_PROBE_KEY, { requireNodeBuiltin: reachNodeBuiltin() });
