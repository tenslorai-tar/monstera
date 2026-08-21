import { BRIDGE_KEY } from '@monstera/contract';
import { BrowserWindow, app, session } from 'electron';

import { createMainWindow } from './window.js';

/**
 * Reports what the renderer ACTUALLY does, for `proof:rendererpolicy`.
 *
 * ## Why this runs the real `createMainWindow`
 *
 * A harness that rebuilt the window with the same options would prove that a
 * copy of the policy works. The point of this proof is the *shipped* path, so
 * the window comes from the function `startShell` calls, and the debugger
 * attaches to it afterwards and reloads — the reload goes through the same
 * session and the same `onHeadersReceived`, so the header captured is the one a
 * user's renderer gets.
 *
 * ## Set versus enforced, which is the whole reason this file exists
 *
 * ARCHITECTURE §2's renderer hardening is seven items. Before this, one of them
 * was evidence and six were configuration: `windowPolicy.test.ts` proves the
 * values this repository *intends*, and `window.ts` hands them to Electron. That
 * is the half that silently drifts when someone edits an options object — and it
 * says nothing about whether Chromium honoured any of it. Invariant 25 refuses
 * to elide that distinction one layer down; this is the same refusal at the
 * window.
 *
 * So every probe below asks the renderer to **do** something and reports what
 * happened, never what was configured. `getLastWebPreferences` would have been
 * the tempting shortcut and is not in this Electron's type surface anyway; it
 * would only have reported what Electron applied, which is one step closer to
 * the truth and still not the truth.
 *
 * ## Every refusal probe carries the permitted case beside it
 *
 * A renderer that is simply broken refuses everything, and "the guard works" and
 * "nothing works" are then the same observation — item 4's fixture rule, which
 * this proof has already been bitten by once. So the popup probe reports whether
 * the bridge reached the page, the permission probe asks for a permitted
 * permission as well as a refused one, and the navigation probe performs a
 * navigation the policy PERMITS and requires it to complete.
 *
 * ## What this cannot see, stated rather than implied
 *
 * `sandbox: true` has no read-back. The page-context probe reports that no Node
 * surface is reachable, which is the *union* consequence of `sandbox`,
 * `contextIsolation` and `nodeIntegration: false` — it cannot attribute the
 * absence to one of the three. The independent evidence for the sandbox is that
 * Chromium refuses to start at all without a correctly-owned SUID helper on
 * Linux, which the CI job configures and which is a real observation about a
 * running process rather than a flag.
 *
 * Output is a single JSON line on stdout, prefixed so it cannot be confused with
 * Chromium's own chatter, which is copious and goes to stderr.
 */
const MARKER = 'MONSTERA_RENDERER_READBACK ';

/** How long a refused operation is given to fail to happen. */
const SETTLE_MS = 400;

interface Readback {
  readonly delivered: string | null;
  readonly url: string | null;
  readonly connectBlocked: boolean;
  readonly evalBlocked: boolean;
  /** Node globals reachable from page script. Must be empty. */
  readonly nodeSurface: readonly string[];
  /** Whether `contextBridge` reached the page — the control for the line above. */
  readonly bridgeExposed: boolean;
  /**
   * What the preload threw, if anything.
   *
   * A preload that fails to load produces NO output on main's stderr and no
   * exception anywhere the shell can see — the window comes up, the page
   * renders, and the bridge is simply absent. `preload-error` is the only place
   * Electron says so, and it is captured here because the difference between
   * "the bridge is missing" and "the bridge is missing BECAUSE the module system
   * rejected it" is the difference between a mystery and a fix.
   */
  readonly preloadError: string | null;
  readonly popupReturnedNull: boolean;
  readonly windowCount: number;
  readonly permissions: Readonly<Record<string, string>>;
  /** Document loads observed after a navigation the policy REFUSES. */
  readonly refusedNavigationLoads: number;
  /** Document loads observed after a navigation the policy PERMITS. */
  readonly permittedNavigationLoads: number;
  readonly finalUrl: string;
}

/** Resolves after `ms`, for giving a refused operation time to not happen. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `source` in the page and narrows the result, or throws saying what came
 * back.
 *
 * `executeJavaScript` is typed `Promise<any>`. Letting an unexpected shape flow
 * into a `.includes` or a truthiness test reports the REASSURING answer —
 * "nothing was visible", "it was blocked" — produced by a bug in the probe
 * rather than by the property holding. Every probe here goes through this.
 *
 * @param contents the renderer to evaluate in
 * @param source an expression, evaluated as-is
 * @param accepts narrows the result, and is the only thing that may say yes
 * @param what named in the error, so a shape mismatch says which probe broke
 */
async function evaluate<T>(
  contents: Electron.WebContents,
  source: string,
  accepts: (value: unknown) => value is T,
  what: string,
): Promise<T> {
  const returned: unknown = await contents.executeJavaScript(source);
  if (!accepts(returned)) {
    throw new Error(
      `The ${what} probe returned ${JSON.stringify(returned)}, which is not the shape it ` +
        `reports in. Treating that as a result would let a broken probe answer for the ` +
        `property it was written to measure.`,
    );
  }
  return returned;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export async function reportRendererPolicy(): Promise<void> {
  await app.whenReady();
  const window = createMainWindow(session.defaultSession);
  const { webContents } = window;

  let delivered: string | null = null;
  let url: string | null = null;

  webContents.debugger.attach('1.3');
  webContents.debugger.on('message', (_event, method, params: unknown) => {
    if (method !== 'Network.responseReceived') return;
    const response = (params as { response?: { url?: string; headers?: Record<string, string> } })
      .response;
    if (response?.headers === undefined) return;
    for (const [name, value] of Object.entries(response.headers)) {
      // Case-insensitively, because CDP reports headers as the protocol carried
      // them and nothing guarantees the casing we wrote.
      if (name.toLowerCase() === 'content-security-policy') {
        delivered = value;
        url = response.url ?? null;
      }
    }
  });
  await webContents.debugger.sendCommand('Network.enable');

  let preloadError: string | null = null;
  webContents.on('preload-error', (_event, path, error) => {
    preloadError = `${path}: ${error.name}: ${error.message}`;
  });

  // Counted rather than awaited, because the navigation probes need to
  // distinguish "no load happened" from "a load happened". A promise can only
  // answer the second.
  let loads = 0;
  webContents.on('did-finish-load', () => {
    loads += 1;
  });

  await new Promise<void>((resolve) => {
    webContents.once('did-finish-load', () => {
      resolve();
    });
    webContents.reload();
  });

  // ---------------------------------------------------------------------------
  // CSP: delivered, and obeyed.
  // ---------------------------------------------------------------------------
  //
  // Enforcement is read from `securitypolicyviolation`, which ONLY CSP fires —
  // not from whether the operations failed.
  //
  // The first version asked whether `fetch` rejected and whether `new Function`
  // threw. Measured: loosening `connect-src` to `'self' https:` left both
  // answers unchanged, because `https://example.invalid/` fails DNS whatever the
  // policy says. The probe reported "blocked" for a request CSP had just
  // permitted — a fixture the defect handles correctly, which is item 4's
  // fixture rule, and it survived the exact mutation it existed to catch.
  //
  // A violation event cannot be produced by a network failure, a typo in a
  // hostname, or an offline runner. It is emitted by the CSP implementation or
  // not at all, which is the difference between measuring the policy and
  // measuring the weather.
  const violated = await evaluate(
    webContents,
    `(async () => {
       const seen = [];
       const record = (event) => { seen.push(event.effectiveDirective); };
       document.addEventListener('securitypolicyviolation', record);
       try { await fetch('https://example.invalid/'); } catch { /* the event is the signal */ }
       try { new Function('return 1')(); } catch { /* likewise */ }
       await new Promise((done) => { setTimeout(done, 200); });
       document.removeEventListener('securitypolicyviolation', record);
       return seen;
     })()`,
    isStringArray,
    'CSP violation',
  );
  const connectBlocked = violated.includes('connect-src');
  // Chromium reports eval against `script-src`, and names the narrower
  // `script-src-attr`/`script-src-elem` for other cases, so the family is
  // matched rather than one spelling.
  const evalBlocked = violated.some((directive) => directive.startsWith('script-src'));

  // ---------------------------------------------------------------------------
  // The Node surface, and the bridge that proves the probe can see anything.
  // ---------------------------------------------------------------------------
  //
  // The bridge is the control and it is not optional. An empty `nodeSurface` is
  // also what a probe that cannot read `globalThis` returns, and what a page
  // that failed to load returns — the reassuring answer from three different
  // failures. `contextBridge` puts exactly one key there, so a page that can see
  // that key and no Node global is reporting an absence it was able to look for.
  const surface = await evaluate(
    webContents,
    `(() => {
       const names = ['require', 'process', 'module', 'exports', 'global', 'Buffer', '__dirname'];
       return {
         visible: names.filter((name) => typeof globalThis[name] !== 'undefined'),
         bridge: typeof globalThis[${JSON.stringify(BRIDGE_KEY)}] !== 'undefined',
       };
     })()`,
    (value): value is { visible: string[]; bridge: boolean } =>
      typeof value === 'object' &&
      value !== null &&
      isStringArray((value as { visible?: unknown }).visible) &&
      typeof (value as { bridge?: unknown }).bridge === 'boolean',
    'node surface',
  );

  // ---------------------------------------------------------------------------
  // Popups.
  // ---------------------------------------------------------------------------
  //
  // Two readings, because `window.open` returning null is the renderer's view
  // and a window existing is main's. A handler that denied the proxy while
  // Chromium still created a window would satisfy the first alone.
  const popupReturnedNull = await evaluate(
    webContents,
    `(() => {
       const opened = window.open('https://example.org/', '_blank');
       if (opened !== null) opened.close();
       return opened === null;
     })()`,
    (value): value is boolean => typeof value === 'boolean',
    'popup',
  );
  await settle(SETTLE_MS);
  const windowCount = BrowserWindow.getAllWindows().length;

  // ---------------------------------------------------------------------------
  // Permissions: deny-all except media.
  // ---------------------------------------------------------------------------
  //
  // `camera` is the control and carries the whole weight of this probe. Electron
  // maps it to the `media` permission, which is the ONE this app grants, so a
  // handler that denied everything — or one that was never installed and left
  // Chromium answering `prompt` — is separated from the policy by this line and
  // by nothing else.
  //
  // `permissions.query` takes the CHECK handler, which is the synchronous path
  // most permission code reaches first and the one that is silently missing when
  // only `setPermissionRequestHandler` is wired.
  const permissions = await evaluate(
    webContents,
    `(async () => {
       const out = {};
       for (const name of ['camera', 'geolocation', 'notifications']) {
         try {
           out[name] = (await navigator.permissions.query({ name })).state;
         } catch (error) {
           out[name] = 'query-threw: ' + String(error && error.message);
         }
       }
       return out;
     })()`,
    (value): value is Record<string, string> =>
      typeof value === 'object' &&
      value !== null &&
      Object.values(value).every((entry) => typeof entry === 'string'),
    'permission',
  );

  // ---------------------------------------------------------------------------
  // Navigation: refused, then permitted.
  // ---------------------------------------------------------------------------
  //
  // The URL after each attempt is NOT the discriminator, and this is the trap
  // worth naming: a refused navigation leaves the document URL unchanged, and a
  // permitted navigation to the loaded URL also leaves it unchanged. Identical
  // observations for opposite outcomes.
  //
  // Loads are what separate them. A refused attempt produces none; a permitted
  // one produces exactly one more.
  //
  // THE TARGET IS THE LOADED DOCUMENT WITH A QUERY STRING, and the first version
  // of this probe used `https://example.org/` — which was vacuous and was caught
  // by mutating the guard away and watching the case stay green. A remote URL
  // produces no load when the guard refuses it AND no load when the machine has
  // no network, so it could not tell a working guard from an offline runner.
  // Item 4's fixture rule, in the same file that already records being bitten by
  // it once.
  //
  // A query string on the loaded file is the fixture the defect cannot handle:
  // the bytes are on disk so it loads without a network, and the href differs so
  // `isPermittedNavigation` refuses it. It also happens to exercise the exact
  // property that function claims — whole-href comparison, never a prefix.
  const before = loads;
  const refusedTarget = `${webContents.getURL()}?probe=refused`;
  await evaluate(
    webContents,
    `(() => { location.href = ${JSON.stringify(refusedTarget)}; return true; })()`,
    (value): value is boolean => value === true,
    'refused navigation',
  );
  await settle(SETTLE_MS);
  const refusedNavigationLoads = loads - before;

  // The permitted case navigates to the page already loaded, which
  // `isPermittedNavigation` allows — a whole-href match against itself. This
  // resets the page's JavaScript context, so it runs last.
  const beforePermitted = loads;
  const loaded = webContents.getURL();
  await evaluate(
    webContents,
    `(() => { location.href = ${JSON.stringify(loaded)}; return true; })()`,
    (value): value is boolean => value === true,
    'permitted navigation',
  );
  await settle(SETTLE_MS);
  const permittedNavigationLoads = loads - beforePermitted;

  const readback: Readback = {
    delivered,
    url,
    connectBlocked,
    evalBlocked,
    nodeSurface: surface.visible,
    bridgeExposed: surface.bridge,
    preloadError,
    popupReturnedNull,
    windowCount,
    permissions,
    refusedNavigationLoads,
    permittedNavigationLoads,
    finalUrl: webContents.getURL(),
  };
  webContents.debugger.detach();

  // EXIT ONLY ONCE THE LINE IS FLUSHED. `app.exit()` terminates immediately, and
  // when stdout is a pipe — which it always is under a proof — writes are
  // asynchronous. Exiting on the next line truncates the report the caller is
  // waiting for, and the caller then reports "no marker line", which is the same
  // output a harness that never ran produces.
  process.stdout.write(`${MARKER}${JSON.stringify(readback)}\n`, () => {
    app.exit(0);
  });
}
