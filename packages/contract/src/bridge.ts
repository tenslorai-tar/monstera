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
 * ## A transport, and that is the security property
 *
 * `invoke` takes a channel id and an opaque params value. Invariant 1
 * confines the preload to `contextBridge`, `ipcRenderer` and `webUtils`;
 * invariant 2 says the renderer never holds a filesystem path. Both are served
 * by the same decision: no per-channel methods, no file operations, and no
 * object carrying a path, so there is no surface for one to appear on without
 * someone widening this interface on purpose.
 *
 * A renderer that cannot NAME a path needs no path allowlist (B5). Every member
 * here is a widening by amendment: `subscribe` by ADR-0082, `openDropped` by
 * ADR-0099, and neither hands the page a path.
 */
export interface MonsteraBridge {
  readonly invoke: (channel: string, params: unknown) => Promise<unknown>;
  /**
   * Listens for one declared event from `main`, and answers the function that stops
   * listening ([ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
   *
   * **The second member.** §5 gained a second direction because the assistant
   * streams and the renderer has no network of its own; this carries it with the same
   * shape as `invoke` — a channel id and an opaque payload, no per-event methods, nothing
   * that could name a path. The payload is validated against the event registry on arrival,
   * by `subscribeToEvent`, not here.
   */
  readonly subscribe: (channel: string, handler: (payload: unknown) => void) => () => void;
  /**
   * Opens a file a person dropped on the window
   * ([ADR-0099](../../../docs/DECISIONS/0099-a-dropped-file-is-opened-by-the-preload-and-its-path-never-reaches-the-page.md)).
   *
   * **The third member, and it takes an object rather than naming a path.** The page hands over the
   * `File` its drop event gave it; the preload resolves the path with `webUtils.getPathForFile` and sends
   * it to main on `document.openDropped`, and the page receives the envelope that channel answers. The
   * parameter is `unknown` because this package has no DOM, and nothing about its type is load-bearing:
   * `getPathForFile` answers an empty string for anything that is not a file from the operating system,
   * and main refuses an empty path by name.
   */
  readonly openDropped: (file: unknown) => Promise<unknown>;
}

/**
 * The channels only the preload sends, and the bridge's `invoke` refuses
 * ([ADR-0099](../../../docs/DECISIONS/0099-a-dropped-file-is-opened-by-the-preload-and-its-path-never-reaches-the-page.md)'s
 * correction, §5).
 *
 * `invoke` is a raw transport: it forwards any string. A channel whose parameter is a path must therefore
 * be refused there by id, or page script could send one a path it spelt. This list is that refusal's, and
 * main registers exactly these ids from `preloadChannels`, whose keys are checked against it — so a preload
 * channel cannot be declared without being refused.
 *
 * It lives here rather than beside the schemas because the preload is bundled from this entry alone, and
 * the schemas would bring zod into it (ADR-0020).
 */
export const PRELOAD_CHANNEL_IDS = ['document.openDropped'] as const;

/** One of {@link PRELOAD_CHANNEL_IDS}. */
export type PreloadChannelId = (typeof PRELOAD_CHANNEL_IDS)[number];

/** The single `window` key the preload is permitted to define. */
export const BRIDGE_KEY = 'monstera';
