/**
 * The window's security policy, as data and pure predicates.
 *
 * ## Why this is separate from the window that applies it
 *
 * Everything here is decidable without an Electron runtime, so it is unit-tested
 * in milliseconds rather than asserted. `window.ts` does nothing but hand these
 * values to Electron — which keeps the part that can be *proven* apart from the
 * part that can only be *set*.
 *
 * **That distinction is the point, and it is invariant 25's.** A flag SET and a
 * flag ENFORCED are different claims, and this module can only ever establish
 * the first. Nothing here is evidence that Chromium honoured `sandbox: true`;
 * that requires reading the value back out of a running renderer, which needs a
 * provisioned binary. What these tests do establish is that the policy this
 * repository intends is the policy that gets handed over — which is the half
 * that silently drifts when someone edits an options object.
 */

/**
 * The renderer's web preferences, fixed by ARCHITECTURE §2's non-negotiable
 * list.
 *
 * `sandbox: true` is what makes the renderer's OS-level capabilities smaller
 * than the app's; `contextIsolation: true` puts the preload's world out of
 * reach of page script, so `contextBridge` is an exposure decision rather than a
 * shared global; `nodeIntegration: false` is the one people remember and the
 * weakest of the three on its own.
 *
 * `webSecurity` is stated rather than left default. It defaults to `true`, and a
 * default that matters is one someone turns off while debugging and does not
 * turn back on — the diff then shows a deletion, which reviews poorly.
 */
export const RENDERER_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
} as const;

/**
 * What the window paints before the renderer's first frame, and during resize.
 *
 * ## A raw hex, and it is a violation of §10 rather than an exception to it
 *
 * `CLAUDE.md` says design tokens only, no raw hex anywhere. There is no token
 * to use: the design substrate is an unstarted `docs/FEATURES.md` row, and
 * `apps/desktop` cannot import `packages/ui` in any case — the module graph
 * allows it `shared`, `contract` and `kernel` only. So this is recorded as owed
 * rather than dressed up as outside the rule, and the row that lands tokens is
 * the one that must replace it.
 *
 * ## It said `#00000000` and that was not what it did
 *
 * Measured through `window.getBackgroundColor()` on a running window: the
 * declared `#00000000` came back as **`#000000`**. Electron honours the alpha
 * channel only for a `transparent: true` window, and this one is not — so the
 * value in force was opaque black while the source said fully transparent.
 *
 * That is worse than a raw hex. A reader checking what the window paints got an
 * answer that had never been true, and the next person to want transparency
 * would have found it already "set". The constant now states what is actually
 * in force, and `proof:rendererpolicy` reads the value back off the window and
 * fails when the two differ — so an alpha added here in future is caught the
 * moment it is silently dropped rather than believed.
 */
export const WINDOW_BACKGROUND = '#000000';

/**
 * The only permission the app may be granted, per ARCHITECTURE §2.
 *
 * A single-element set rather than a boolean check against a name, so widening
 * it is a visible edit to a list and not a new `||`.
 */
export const PERMITTED_PERMISSIONS: ReadonlySet<string> = new Set(['media']);

/**
 * Whether a permission request or check may be granted.
 *
 * **Both of Electron's handlers must call this, and that is not obvious enough
 * to leave implicit.** `setPermissionRequestHandler` covers the asynchronous
 * request path; `setPermissionCheckHandler` covers the synchronous one —
 * `navigator.permissions.query` and several `getUserMedia` routes. Electron's
 * own declarations say so on the check handler: *"you must also implement
 * `setPermissionRequestHandler` to get complete permission handling. Most web
 * APIs do a permission check and then make a permission request if the check is
 * denied."*
 *
 * Wiring only one leaves the other answering from Chromium's default, and the
 * window then denies what is *asked for* while a second path answers
 * separately. That is Rule 0's *close one handler and leave its six siblings*,
 * on a surface where the failure is silent and the reassuring answer is the one
 * you get.
 */
export function isPermittedPermission(permission: string): boolean {
  return PERMITTED_PERMISSIONS.has(permission);
}

/**
 * The Content-Security-Policy served to the renderer.
 *
 * **This constant is DERIVED. `docs/ARCHITECTURE.md` §9 invariant 27 is the
 * writer of record**, and `proof:rendererpolicy` extracts the pinned list from
 * that section and fails when the two differ. A change here that is not a change
 * there is a red build, and the section is the side to change first.
 *
 * That direction is the *opposite* of the memory budgets, on purpose.
 * `check:docs` fails when §9.17 restates a budget number, because there the code
 * is the writer and prose would be a second copy. Here the whole value of
 * pinning is that loosening the policy becomes an ARCHITECTURE diff someone has
 * to justify — which only works if the document holds the pen. One writer per
 * concern (B3); *which* side holds it is decided per concern rather than by
 * house style.
 *
 * `default-src 'none'` and then grant, so a directive nobody thought of is
 * denied rather than inherited. `connect-src 'none'` because the renderer talks
 * to main over the contract bridge and has no reason to open a socket —
 * invariant L1 in a form Chromium enforces.
 *
 * `blob:` on `img-src` and `media-src` is not decoration: rendered page bitmaps
 * arrive as blobs, and a policy that forbids them fails the first time a
 * document is opened rather than at review.
 *
 * **`style-src` grants `'self'` and nothing else**, and this list carried
 * `'unsafe-inline'` until the moment it was pinned. Nothing in this repository
 * needs it — the renderer document is empty — so pinning it would have made an
 * unproven grant into law by arriving early, which is the one thing the pin
 * exists to prevent
 * ([ADR-0019](../../../docs/DECISIONS/0019-the-renderers-csp-is-pinned.md)).
 * The predicted trip is named there so it is recognised rather than debugged:
 * Vite's dev server injects `<style>` elements for HMR.
 *
 * Verified against a running renderer by `proof:rendererpolicy` — read from the
 * response as Chromium received it, with two directives observed being obeyed.
 * That covers *delivery* completely and *enforcement* for `connect-src` and
 * `script-src` only; the other nine are pinned and delivered, not exercised.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Whether the renderer may navigate to a URL.
 *
 * An allowlist of one: the page the shell itself loaded. Everything else —
 * including a different file on the same disk — is refused, because "navigation
 * locked" means the renderer's document cannot be replaced, not that remote
 * origins are blocked.
 *
 * Compared as whole URLs after normalisation, never by prefix. A prefix test
 * accepts `file:///app/index.html.evil` for `file:///app/index.html`, which is
 * the classic shape and the reason this takes the loaded URL rather than a
 * directory.
 */
export function isPermittedNavigation(target: string, loaded: string): boolean {
  let targetUrl: URL;
  let loadedUrl: URL;
  try {
    targetUrl = new URL(target);
    loadedUrl = new URL(loaded);
  } catch {
    // An unparseable URL is refused. It cannot be compared, and "could not
    // parse" must not read as "matches".
    return false;
  }
  return targetUrl.href === loadedUrl.href;
}
