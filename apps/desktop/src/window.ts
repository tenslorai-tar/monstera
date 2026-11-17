import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimumWindowFor } from '@monstera/shared';
import { BrowserWindow, type Session, type WebContents, app, protocol, screen } from 'electron';

import { offerEditMenu } from './editMenu.js';
import { type ShellFailureSink, reportRendererFailures } from './shellFailure.js';
import { PLATFORM_DEFAULT, type WindowMemory, placementFor } from './windowState.js';
import {
  CONTENT_SECURITY_POLICY,
  RENDERER_SCHEME,
  RENDERER_URL,
  RENDERER_WEB_PREFERENCES,
  WINDOW_BACKGROUND,
  devToolsAllowed,
  isPermittedNavigation,
  isPermittedPermission,
  rendererFileFor,
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

/** The renderer build the scheme serves: the folder `RENDERER_HTML` is in. */
const RENDERER_ROOT = dirname(RENDERER_HTML);

// REGISTERED AS THIS MODULE LOADS, because Electron takes a privileged scheme only before the application is ready,
// and every process that makes the window imports this module first: the shell and both harnesses. STANDARD, so the
// page's relative URLs and its module worker resolve against it; SECURE, as the `file:` page was a secure context;
// with V8's CODE CACHE, which a custom scheme has only when asked and `file:` had by default.
protocol.registerSchemesAsPrivileged([{ scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, codeCache: true } }]);

/** How long after the last move or resize the window's place is written: a drag is one write, not hundreds. */
const REMEMBER_AFTER_MS = 400;

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
 * Serves the renderer build from the application's own scheme, with the Content-Security-Policy on every response
 * ([ADR-0296](../../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 *
 * THE ONE WRITER OF THE HEADER. It was a `webRequest.onHeadersReceived` hook on a `file://` page, and Chromium loads a
 * `file:` worker's scripts without passing them through that hook: the PDF.js worker, which parses every document, had
 * no policy (2026-11-17, `WebAssembly.compile` and `new Function` allowed in the worker and refused in the window). Every
 * request of this scheme, the worker's and its imports included, is answered here.
 *
 * As a **header** rather than a `<meta>` tag: `frame-ancestors` and `sandbox` are ignored in meta form, and a worker
 * has no document to carry a tag. A request for anything that is not a file of the build, of a kind it emits, is a 404
 * (`rendererFileFor`). Idempotent per session, since the harnesses make windows on the session the shell's code serves.
 */
export function serveRenderer(target: Session): void {
  if (target.protocol.isProtocolHandled(RENDERER_SCHEME)) return;
  target.protocol.handle(RENDERER_SCHEME, async (request) => {
    const found = rendererFileFor(request.url, RENDERER_ROOT, { resolve, relative, isAbsolute, extname });
    // A FILE THAT IS NOT THERE is a 404, as any request for no file of the build is; ANY OTHER failure to read one is
    // thrown, so the load fails as a failure and is reported as one, never answered as if the file did not exist
    // (KKKKKKKKK-6: every error was a quiet 404).
    const bytes =
      found === null
        ? null
        : await readFile(found.file).catch((error: unknown) => {
            if ((error as { code?: unknown } | null)?.code === 'ENOENT') return null;
            throw error;
          });
    if (found === null || bytes === null) return new Response(null, { status: 404, headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } });
    return new Response(bytes, { status: 200, headers: { 'Content-Type': found.type, 'Content-Security-Policy': CONTENT_SECURITY_POLICY } });
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
export function createMainWindow(
  target: Session,
  failures: ShellFailureSink,
  /**
   * Where the window was left. Absent for one that opens the platform's way every run (a harness's); the product's own
   * path, `startShell`, takes it as a required argument, so the shipped window cannot forget to remember.
   */
  memory?: WindowMemory,
): BrowserWindow {
  applyPermissionPolicy(target);
  serveRenderer(target);

  const initialFloor = minimumWindowFor(screen.getPrimaryDisplay().workAreaSize);
  const placement =
    memory === undefined
      ? PLATFORM_DEFAULT
      : placementFor(
          memory.read(),
          screen.getAllDisplays().map((display) => display.workArea),
          initialFloor,
        );
  const window = new BrowserWindow({
    ...(placement.bounds ?? {}),
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    // THE FLOOR THE CHROME FITS IN (`MINIMUM_WINDOW`, measured 2026-09-23), and NEVER MORE THAN THE SCREEN'S
    // WORK AREA (`minimumWindowFor`, the owner's order of 28 September): a 1080p screen at 200% has about
    // 960 × 516 to give, and a floor past it is a window that cannot fit. Below 1024 the ribbon folds whole
    // groups into its More, so nothing scrolls sideways there either. Re-applied below whenever the display
    // the window is on changes, because the primary display at creation is only where it starts.
    minWidth: initialFloor.width,
    minHeight: initialFloor.height,
    // §10.3's title bar is the application's own row, so the native caption goes and Windows keeps only its
    // controls, painted over the row's end (Window Controls Overlay). `true` gives the system's colours until the
    // renderer reports the bar's computed ones through `window.titleBarOverlay` — the frames before that report
    // are the one moment the two can differ.
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    webPreferences: {
      ...RENDERER_WEB_PREFERENCES,
      devTools: devToolsAllowed(app.isPackaged),
      preload: PRELOAD,
      session: target,
    },
  });

  // MAXIMISED BEFORE IT IS SHOWN, so the first frame is the maximised one and not a small window that grows.
  if (placement.maximize) window.maximize();

  // WHERE IT IS LEFT is kept: the size and place it has when not maximised, and whether it is maximised, written a moment
  // after the last move or resize and once more as it closes. `getNormalBounds` is the restored rectangle, so a window
  // closed maximised comes back to the size it unmaximises to.
  if (memory !== undefined) {
    let pending: NodeJS.Timeout | undefined;
    const remember = (): void => {
      if (window.isDestroyed()) return;
      memory.write({ ...window.getNormalBounds(), maximized: window.isMaximized() });
    };
    const soon = (): void => {
      clearTimeout(pending);
      pending = setTimeout(remember, REMEMBER_AFTER_MS);
    };
    window.on('resize', soon);
    window.on('move', soon);
    window.on('maximize', soon);
    window.on('unmaximize', soon);
    window.on('close', () => {
      clearTimeout(pending);
      remember();
    });
    window.once('closed', () => {
      clearTimeout(pending);
    });
  }

  // Subscribed HERE, where the contents is born, so a window that exists is a
  // window that reports. At the composition root instead, a window could be
  // created without one — which is precisely the state that let a preload fail
  // in silence.
  reportRendererFailures(window.webContents, failures);
  // EVERY EDITABLE FIELD'S RIGHT-CLICK MENU, subscribed where the contents is born for the same reason (the owner's N8).
  offerEditMenu(window.webContents);

  // THE FLOOR FOLLOWS THE SCREEN: moved to another display, or the scaling or resolution changed, the work area it
  // is measured against is a different one. Unsubscribed when the window goes, since `screen` outlives it.
  const refloor = (): void => {
    if (window.isDestroyed()) return;
    const floor = minimumWindowFor(screen.getDisplayMatching(window.getBounds()).workAreaSize);
    window.setMinimumSize(floor.width, floor.height);
  };
  screen.on('display-metrics-changed', refloor);
  screen.on('display-added', refloor);
  screen.on('display-removed', refloor);
  window.on('moved', refloor);
  window.once('closed', () => {
    screen.off('display-metrics-changed', refloor);
    screen.off('display-added', refloor);
    screen.off('display-removed', refloor);
  });

  lockNavigation(window.webContents, RENDERER_URL);
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadURL(RENDERER_URL);
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
