import { BRIDGE_KEY, type MonsteraBridge, PRELOAD_CHANNEL_IDS } from '@monstera/contract/bridge';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

/**
 * The preload bridge: the fourth contract surface, and the smallest one.
 *
 * ## Invariant 1, and why this file is short on purpose
 *
 * *"Renderer sandbox on; preload uses only `contextBridge`, `ipcRenderer` and
 * `webUtils`."* Everything a preload can do wrong, it does by importing
 * something else — `fs`, `path`, `child_process`, or Electron's `app` — and
 * exposing a shred of it across the bridge. There is nothing here to review for
 * that: the imports are invariant 1's three names, and `scripts/security/preloadSurface.mjs`
 * derives the set from this file's own syntax and fails the build if it grows.
 *
 * That derivation is what makes this surface **provable without running
 * Electron**, which matters because every workflow installs with
 * `--ignore-scripts`: `electron.d.ts` arrives and no binary does. A structural
 * test that asserted on the options passed to `contextBridge` would prove the
 * call was made, not that the exposure is confined — the difference between a
 * flag being set and a flag being enforced.
 *
 * ## A transport, and the shape is the contract's
 *
 * `MonsteraBridge` lives in `@monstera/contract` because both sides of this
 * bridge need it and neither package may import the other. Exposing a transport
 * rather than per-channel methods is invariant 2 by construction: nothing the
 * page receives could carry a filesystem path, so no allowlist has to be
 * remembered (B5). The one path this file ever holds is resolved inside
 * `openDropped` and sent to main in the same statement (ADR-0099).
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

/** The contract's own list, so a preload channel declared there is refused here with no second edit. */
const PRELOAD_ONLY: ReadonlySet<string> = new Set(PRELOAD_CHANNEL_IDS);

const bridge: MonsteraBridge = {
  // Named `invoke` and passed through unchanged. No channel allowlist here: the
  // channel id is validated against the registry by `wrapHandler` on the other
  // side, and a second opinion about which channels exist is exactly the drift
  // deriving every surface from one registry exists to prevent (B3a).
  //
  // ONE REFUSAL, and it is not an allowlist: the preload's own channels (ADR-0099's
  // correction). They take a path, `invoke` forwards any string, and main cannot tell
  // this call from `openDropped`'s — both arrive from the same frame — so this is the
  // only place page script can be stopped from sending one a path it spelt.
  invoke: (channel, params) =>
    PRELOAD_ONLY.has(channel)
      ? Promise.reject(new Error(`refused: ${channel} is sent by the preload only`))
      : ipcRenderer.invoke(channel, params),
  // THE SECOND DIRECTION (ADR-0082), and the same shape: a channel id and an opaque
  // payload. The listener is wrapped so the renderer never receives Electron's
  // `IpcRendererEvent` — that object carries `sender` and `ports`, which is a surface
  // invariant 1 keeps out of the isolated world.
  subscribe: (channel, handler) => {
    const listener = (_event: unknown, payload: unknown): void => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  // A DROPPED FILE (ADR-0099). The path is resolved here and sent to main, and it is
  // never returned: the page receives main's envelope, which carries a document id
  // and a name. Anything that is not a `File` from the operating system resolves to
  // an empty path, which main refuses by name — one place decides, and it is main.
  openDropped: (file) => {
    const path = file instanceof File ? webUtils.getPathForFile(file) : '';
    return ipcRenderer.invoke('document.openDropped', { path });
  },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
