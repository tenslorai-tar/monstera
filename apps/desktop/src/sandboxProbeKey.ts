/**
 * The global the sandbox probe exposes under, shared by the preload that sets it
 * and the harness that reads it.
 *
 * ## Its own module, and the reason is a measured crash
 *
 * The harness first imported this constant from `sandboxProbePreload.ts`. That
 * file calls `contextBridge.exposeInMainWorld` at module scope, so importing it
 * for a string **ran a preload in the main process** — and Electron refused with
 * `SyntaxError: The requested module 'electron' does not provide an export named
 * 'contextBridge'`, which is the main process's ESM view of a module only a
 * preload may load.
 *
 * A constant with no imports has no side effect to drag anywhere. Same shape as
 * `@monstera/contract/bridge`, which exists so the product preload can have the
 * bridge's name without the package that declares it.
 */
export const SANDBOX_PROBE_KEY = 'monsteraSandboxProbe';
