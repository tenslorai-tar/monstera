import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BrowserWindow, type Session, type WebContents } from 'electron';

import { type ShellFailureSink, reportRendererFailures } from './shellFailure.js';
import {
  CONTENT_SECURITY_POLICY,
  RENDERER_WEB_PREFERENCES,
  WINDOW_BACKGROUND,
  isPermittedNavigation,
  isPermittedPermission,
} from './windowPolicy.js';

/**
 * `dist/` at run time, so the sibling `preload.cjs` and the `renderer/` beside
 * the package root both resolve without a copy step.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

// `.cjs`, and the extension is the whole point. A sandboxed preload is loaded as
// CommonJS, so the ESM `dist/preload.js` that `tsc` emits fails with
// `SyntaxError: Cannot use import statement outside a module` — reported by
// Electron's `preload-error` event and nowhere else. The window still opens and
// the page still renders; the bridge is just absent. `scripts/build/preload.mjs`
// produces this file, and `proof:rendererpolicy` fails if the page cannot see
// the bridge, which is how the dead artefact next to it stays dead.
const PRELOAD = join(HERE, 'preload.cjs');

// Inside `dist/`, because the page is a BUILD ARTEFACT. Its source is
// `packages/ui/index.html` — renderer-mode code, which ADR-0024 keeps out of the
// one package `MAY_IMPORT_ELECTRON` exempts — and `npm run build:renderer` emits
// this tree. A tracked `renderer/` beside the package would be a directory the
// build overwrites, so the file git keeps and the file Electron loads are the
// same path and neither is authoritative.
export const RENDERER_HTML = join(HERE, 'renderer', 'index.html');

/**
 * Applies the deny-all permission policy to a session.
 *
 * **Both handlers, and neither is sufficient alone.** The request handler covers
 * the asynchronous path; the check handler covers the synchronous one that
 * `navigator.permissions.query` and several `getUserMedia` routes take. Electron
 * says so in its own declarations for the pinned version: *"you must also
 * implement `setPermissionRequestHandler` to get complete permission handling"*.
 *
 * Wiring one leaves the other answering from Chromium's default, so the window
 * denies what is *asked for* while a second path answers separately — and
 * nothing about a working app reveals it. That is Rule 0's *close one handler
 * and leave its siblings*, on a surface whose failure is silent.
 */
export function applyPermissionPolicy(target: Session): void {
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isPermittedPermission(permission));
  });
  target.setPermissionCheckHandler((_contents, permission) => isPermittedPermission(permission));
}

/**
 * Serves the Content-Security-Policy with every response in the session.
 *
 * As a **header** rather than a `<meta>` tag: `frame-ancestors` and `sandbox`
 * are ignored in meta form, and `docs/FEATURES.md`'s deferred read-back row
 * names "the response header as received" as a thing it can compare against.
 *
 * The header REPLACES rather than appends. Two `Content-Security-Policy`
 * headers intersect, which sounds safe and is how a policy nobody intended gets
 * enforced — and an appended one cannot loosen but can make the effective
 * policy impossible to state, which is worse for a value that is about to be
 * pinned as an invariant.
 */
export function applyContentSecurityPolicy(target: Session): void {
  target.webRequest.onHeadersReceived((details, callback) => {
    // Rebuilt by filtering rather than by deleting keys: the header name is
    // case-insensitive, so the one to drop is not known statically, and the
    // filter states the rule once instead of mutating a copy.
    const kept = Object.entries(details.responseHeaders ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'content-security-policy',
    );
    callback({
      responseHeaders: {
        ...Object.fromEntries(kept),
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

/**
 * Locks navigation and denies popups on a renderer's contents.
 *
 * Three events, not one. `will-navigate` is the top-level case everyone knows;
 * `will-redirect` is the same journey arriving via a server or a meta refresh,
 * and it does NOT re-fire `will-navigate`; `will-frame-navigate` covers
 * subframes, which `will-navigate` does not see. Guarding only the first is the
 * half-fix shape — the door is shut and the two beside it are open.
 */
export function lockNavigation(contents: WebContents, loaded: string): void {
  const refuseUnlessLoaded = (event: { preventDefault: () => void }, url: string): void => {
    if (!isPermittedNavigation(url, loaded)) event.preventDefault();
  };

  contents.on('will-navigate', refuseUnlessLoaded);
  contents.on('will-redirect', refuseUnlessLoaded);
  contents.on('will-frame-navigate', (event) => {
    refuseUnlessLoaded(event, event.url);
  });

  // Deny, with no allowlist and no `shell.openExternal` fallback. Opening a URL
  // in the user's browser is a capability the renderer does not have and must
  // not acquire by way of a link — when the app needs it, it becomes a command
  // in the registry with a `run`, not a side effect of `target="_blank"`.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // A renderer that attaches a webview would inherit its own preferences.
  // Refusing the attachment is smaller than sanitising what it asked for.
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/**
 * Creates the one hardened window.
 *
 * `show: false` until `ready-to-show`: a window painted before its first frame
 * is the white flash every Electron app ships with by default, and §10 bans
 * spinner-only loading states on surfaces whose shape is known.
 */
export function createMainWindow(target: Session, failures: ShellFailureSink): BrowserWindow {
  applyPermissionPolicy(target);
  applyContentSecurityPolicy(target);

  const window = new BrowserWindow({
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: { ...RENDERER_WEB_PREFERENCES, preload: PRELOAD, session: target },
  });

  // Subscribed HERE, where the contents is born, so a window that exists is a
  // window that reports. At the composition root instead, a window could be
  // created without one — which is precisely the state that let a preload fail
  // in silence.
  reportRendererFailures(window.webContents, failures);

  lockNavigation(window.webContents, pathToFileURL(RENDERER_HTML).href);
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadFile(RENDERER_HTML);
  return window;
}

/**
 * Whether an IPC event came from this window's own main frame.
 *
 * Compared by `WebContents` IDENTITY, not by URL. A URL check asks the renderer
 * what it is, and the renderer is the thing being checked; the id is assigned by
 * main and cannot be spoofed from inside a page.
 *
 * `senderFrame === null` is refused rather than treated as absent: a frame that
 * has been destroyed cannot be attributed to anything, and "could not tell" must
 * not read as "trusted".
 */
export function senderCheckFor(window: BrowserWindow): (event: unknown) => boolean {
  return (event) => {
    const candidate = event as { senderFrame?: unknown; sender?: { id?: unknown } } | null;
    if (candidate === null || typeof candidate !== 'object') return false;
    if (candidate.senderFrame === null || candidate.senderFrame === undefined) return false;
    return candidate.sender?.id === window.webContents.id;
  };
}
