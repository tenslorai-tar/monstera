import { type ContractClient, channels, createClient } from '@monstera/contract';

/**
 * The renderer's side of the contract, and the shape the preload must expose.
 *
 * ## What the bridge is allowed to be
 *
 * A **transport**, and nothing else: one function taking a channel id and a
 * params value. Invariant 1 confines the preload to `contextBridge`,
 * `ipcRenderer` and `webUtils`, and invariant 2 says the renderer never holds a
 * filesystem path. Both are served by the same decision — the bridge exposes no
 * per-channel methods, no file operations, and no object with a path on it, so
 * there is no surface here for one to appear on later without someone widening
 * this type on purpose.
 *
 * That is B5 rather than a check: a renderer that cannot NAME a path needs no
 * path allowlist, and a bridge that carries one function cannot grow a
 * `readFile` by accident.
 *
 * ## Why the client is built here rather than in the preload
 *
 * `createClient` derives the whole surface from the channel registry, so the
 * renderer gets every channel typed without either side restating one. Building
 * it in the preload would put the derivation behind `contextBridge`, which
 * serialises what it exposes — the functions would survive and the types would
 * not, and the renderer would be back to calling strings.
 *
 * The preload therefore exposes the smallest possible thing and the renderer
 * derives the rest from the contract it already imports.
 */

/** What `contextBridge` must expose on `window`, and the whole of it. */
export interface MonsteraBridge {
  readonly invoke: (channel: string, params: unknown) => Promise<unknown>;
}

declare global {
  // `var`, because that is how a global is declared to TypeScript — `let` and
  // `const` do not attach to `globalThis`. Declared here rather than in a
  // `.d.ts` so it sits beside the interface it names and cannot drift from it.
  var monstera: MonsteraBridge | undefined;
}

/**
 * Thrown when the renderer is running without a preload.
 *
 * A named class rather than a bare `Error`, so a caller can tell "the bridge is
 * missing" from "a channel failed" — and so the message stays ours. Nothing in
 * it names a path, a file or a build.
 */
export class BridgeUnavailableError extends Error {
  constructor() {
    super(
      'The contract bridge is not on `window`. The renderer is running without its preload, ' +
        'so no channel can be reached.',
    );
    this.name = 'BridgeUnavailableError';
  }
}

/**
 * Builds the renderer's contract client over the preload bridge.
 *
 * ## It THROWS when the bridge is absent, and that is the design
 *
 * The alternative — returning a client whose calls reject — is worse in the way
 * this project keeps finding: every call would fail identically to a channel
 * that genuinely failed, and the renderer would report a document error for a
 * missing preload. A missing bridge is not a channel outcome; it is the
 * application being wired wrong, and it should be indistinguishable from
 * nothing else.
 *
 * Checked once, when the client is built, rather than on every call. A bridge
 * cannot appear later: `contextBridge` runs before any renderer script.
 *
 * @param bridge the transport, defaulting to the one the preload exposes
 */
export function createRendererClient(bridge: MonsteraBridge | undefined = globalThis.monstera): ContractClient {
  if (bridge === undefined) throw new BridgeUnavailableError();
  return createClient(channels, async (id, params) => bridge.invoke(id, params));
}
