import { BRIDGE_KEY, type MonsteraBridge } from '@monstera/contract';
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
 * ## Not yet enforced, and stated rather than implied
 *
 * A preload is only confining if the window that loads it sets `sandbox: true`,
 * `contextIsolation: true` and `nodeIntegration: false`. That window does not
 * exist yet. This file is correct and unreachable; the hardening it depends on
 * lands with the main entry, and until then invariant 1's *"sandbox on"* clause
 * is unmet by absence rather than by violation.
 */

const bridge: MonsteraBridge = {
  // Named `invoke` and passed through unchanged. No channel allowlist here: the
  // channel id is validated against the registry by `wrapHandler` on the other
  // side, and a second opinion about which channels exist is exactly the drift
  // deriving every surface from one registry exists to prevent (B3a).
  invoke: (channel, params) => ipcRenderer.invoke(channel, params),
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
