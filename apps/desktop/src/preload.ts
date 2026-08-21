import { BRIDGE_KEY, type MonsteraBridge } from '@monstera/contract/bridge';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The preload bridge: the fourth contract surface, and the smallest one.
 *
 * ## Invariant 1, and why this file is short on purpose
 *
 * *"Renderer sandbox on; preload uses only `contextBridge`, `ipcRenderer` and
 * `webUtils`."* Everything a preload can do wrong, it does by importing
 * something else — `fs`, `path`, `child_process`, or Electron's `app` — and
 * exposing a shred of it across the bridge. There is nothing here to review for
 * that: the imports are two names, and `scripts/security/preloadSurface.mjs`
 * derives the set from this file's own syntax and fails the build if it grows.
 *
 * That derivation is what makes this surface **provable without running
 * Electron**, which matters because every workflow installs with
 * `--ignore-scripts`: `electron.d.ts` arrives and no binary does. A structural
 * test that asserted on the options passed to `contextBridge` would prove the
 * call was made, not that the exposure is confined — the difference between a
 * flag being set and a flag being enforced.
 *
 * ## One function, and the shape is the contract's
 *
 * `MonsteraBridge` lives in `@monstera/contract` because both sides of this
 * bridge need it and neither package may import the other. Exposing a transport
 * rather than per-channel methods is invariant 2 by construction: there is no
 * object here that could carry a filesystem path, so no allowlist has to be
 * remembered (B5).
 *
 * ## What `exposeInMainWorld` does with this
 *
 * It structured-clones across the isolated-world boundary and passes functions
 * by proxy. So the renderer receives a callable `invoke` and **no types** —
 * which is why the client is built on the renderer side from the contract it
 * already imports, rather than being handed over from here.
 *
 * ## Enforced now, and it was not before
 *
 * A preload is only confining if the window that loads it sets `sandbox: true`,
 * `contextIsolation: true` and `nodeIntegration: false`. `createMainWindow` sets
 * all three, and `proof:rendererpolicy` reads back from the running renderer
 * that no Node surface is reachable and that this bridge is.
 *
 * **That read-back's first finding was that this file had never executed.**
 * `tsc` emits it as ESM into a `"type": "module"` package; a sandboxed preload
 * is loaded as CommonJS and refused it with
 * `SyntaxError: Cannot use import statement outside a module` — announced
 * through Electron's `preload-error` event and through nothing else. The window
 * opened, the page rendered, and the bridge was absent. Every check here was
 * structural and every one of them passed, correctly, about a file nothing had
 * run.
 *
 * So the shipped artefact is the CommonJS bundle from
 * `scripts/build/preload.mjs`, and the import below is from
 * `@monstera/contract/bridge` rather than the package root: a sandboxed
 * preload's `require` reaches a small fixed set and never `node_modules`, so the
 * key has to be inlined at build time — and entering through the root pulled the
 * channel registry and zod in with it
 * ([ADR-0020](../../../docs/DECISIONS/0020-the-preload-is-bundled.md)).
 */

const bridge: MonsteraBridge = {
  // Named `invoke` and passed through unchanged. No channel allowlist here: the
  // channel id is validated against the registry by `wrapHandler` on the other
  // side, and a second opinion about which channels exist is exactly the drift
  // deriving every surface from one registry exists to prevent (B3a).
  invoke: (channel, params) => ipcRenderer.invoke(channel, params),
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
