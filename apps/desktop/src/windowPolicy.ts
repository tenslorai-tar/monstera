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
 * ARCHITECTURE §2 lists "CSP set" among the non-negotiables, so the header is
 * owed by the unit that creates the window. **Pinning the exact directive list
 * as an invariant is a separate obligation** — a `docs/FEATURES.md` row requires
 * it once a renderer exists to read it back from, and that row also requires the
 * comparison to read the policy *as delivered* rather than from this constant.
 * Two obligations; this is the one due now.
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
 * **Unverified against a running renderer.** No Electron binary has ever been
 * provisioned in this repository, so nothing here has been observed to load. The
 * read-back check is what converts this from a stated policy into an enforced
 * one.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
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
