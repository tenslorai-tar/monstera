/**
 * The shape the preload exposes and the renderer consumes.
 *
 * ## Why it lives in the contract and not on either side
 *
 * Two packages must agree on it and **neither may import the other**:
 * `apps/desktop` may import `shared`, `contract` and `kernel`; `packages/ui` may
 * import `shared` and `contract`. So a definition on either side would have to
 * be restated on the other — one shape, two declarations, drifting silently
 * until a renderer calls a method the preload stopped exposing.
 *
 * That is **B3a**: many readers are fine, many opinions about one shape are not.
 * The contract already owns every other thing the two sides agree on — the
 * channels, the wire schemas, the failure shapes, the derived surfaces — and
 * this is the last of them. It was found by building the second side, which is
 * the only way a missing shared definition ever announces itself.
 *
 * ## It is one function, and that is the security property
 *
 * A transport, taking a channel id and an opaque params value. Invariant 1
 * confines the preload to `contextBridge`, `ipcRenderer` and `webUtils`;
 * invariant 2 says the renderer never holds a filesystem path. Both are served
 * by the same decision: no per-channel methods, no file operations, and no
 * object carrying a path, so there is no surface for one to appear on without
 * someone widening this interface on purpose.
 *
 * A renderer that cannot NAME a path needs no path allowlist (B5). Keep this to
 * one function.
 */
export interface MonsteraBridge {
  readonly invoke: (channel: string, params: unknown) => Promise<unknown>;
  /**
   * Listens for one declared event from `main`, and answers the function that stops
   * listening ([ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
   *
   * **The second member, and the last.** §5 gained a second direction because the assistant
   * streams and the renderer has no network of its own; this carries it with the same
   * shape as `invoke` — a channel id and an opaque payload, no per-event methods, nothing
   * that could name a path. The payload is validated against the event registry on arrival,
   * by `subscribeToEvent`, not here.
   */
  readonly subscribe: (channel: string, handler: (payload: unknown) => void) => () => void;
}

/** The single `window` key the preload is permitted to define. */
export const BRIDGE_KEY = 'monstera';
