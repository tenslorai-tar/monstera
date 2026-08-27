import { BRIDGE_KEY } from '@monstera/contract';
import { BrowserWindow, app, session } from 'electron';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SANDBOX_PROBE_KEY } from './sandboxProbeKey.js';
import type { ShellFailure } from './shellFailure.js';
import { createMainWindow } from './window.js';
import { RENDERER_WEB_PREFERENCES } from './windowPolicy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_HTML = join(HERE, '..', 'renderer', 'index.html');

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
 * absence to one of the three.
 *
 * **A PRELOAD is what attributes, and the probe below is it.** This paragraph
 * once offered different evidence — that Chromium refuses to start without a
 * correctly-owned SUID helper on Linux — which is a true observation about a
 * *different proposition*: the helper backs the browser's OS-level sandbox,
 * which the zygote and the GPU and utility processes need whatever one window's
 * `webPreferences.sandbox` says. Offering it here committed the same attribution
 * error the paragraph above refuses, one line later (finding II-2).
 *
 * A preload separates the three flags and nothing else does. `nodeIntegration`
 * governs the page; `contextIsolation` governs which world globals land in;
 * neither decides what a preload may `require`. Measured against the pinned
 * Electron before the case was written: a sandboxed preload gets
 * `threw: module not found: node:fs`, and with `sandbox` flipped **by itself**
 * it gets a usable `fs` while the page-side reading stays empty. That is the
 * attribution, and the mutation is what establishes it.
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
  /**
   * How many listeners the SHIPPED window carries per failure event.
   *
   * The harness having its own listener proves nothing about the product — that
   * was exactly the state finding II-1 describes. This counts on the
   * `WebContents` that `createMainWindow` returned, so it is a statement about
   * what the shell subscribed, not about what the test did.
   */
  readonly failureListeners: Readonly<Record<string, number>>;
  /**
   * What the shell's failure sink actually received, after a real crash.
   *
   * A listener count says something is attached. It does not say the sink is
   * reached, and "attached to a function that drops it" is the same silence one
   * step along — so the renderer is genuinely killed and the sink's contents are
   * reported.
   */
  readonly failuresReceived: readonly string[];
  /**
   * HOW the wait for the crash ended — see {@link CrashResolution}.
   *
   * Separate from {@link failuresReceived} being empty, because those are two
   * different findings and only one is a defect: `'bound'` means the event never
   * arrived at all, where an empty list alone used to mean *either* that or that
   * the harness looked too early. And `'event'` is what no fixed sleep can
   * produce, which is what makes the harness's own mechanism assertable.
   */
  readonly crashResolvedBy: CrashResolution;
  /** What Chromium made of the declared `backgroundColor`. */
  readonly backgroundColor: string;
  /**
   * What a preload under the SAME web preferences got from `require('node:fs')`.
   *
   * The page-side `nodeSurface` reading is the union consequence of three flags.
   * This one is about `sandbox` alone: `nodeIntegration` governs the page and
   * not the preload, and `contextIsolation` governs which world globals land in
   * and not what may be required. The mutation that proves the attribution is
   * flipping `sandbox` by itself — this must go red while `nodeSurface` stays
   * green (finding II-2).
   */
  readonly preloadNodeReach: string;
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
 * How long to wait for a crash to reach the sink before calling it absent.
 *
 * Deliberately far above anything observed, because it decides nothing when the
 * mechanism works: the wait ends the moment the event arrives. It exists only so
 * a sink that is never reached fails rather than hanging, which is the one thing
 * a pure event-wait cannot do.
 */
const CRASH_BOUND_MS = 15_000;

/**
 * HOW the wait for a crash ended, which is the harness's own mechanism rather
 * than the run's outcome.
 *
 * This exists because the control for a harness fix has to assert what the
 * harness PASSES, not what the run produces (the rule this project wrote after
 * BB-4). On a machine where a fixed sleep happens to be long enough, "waited for
 * the event" and "slept long enough" produce the same readback — so the boolean
 * that used to live here could not separate the fix from its absence, and the
 * mutation had to be run by hand.
 *
 * `'event'` can only be produced by a waiter that was installed and then fired.
 * A `setTimeout` cannot reach it. Deleting the mechanism means deleting this
 * field, which fails to compile against the `Readback` the proof carries — a
 * red build rather than a silent pass.
 *
 * `'already'` is impossible for the crash case by construction: the waiter is
 * installed before the kill is issued, so nothing can have arrived first. It is
 * in the union because a second caller with a different ordering would need it,
 * and a state that cannot occur is cheaper to keep than to rediscover.
 */
type CrashResolution = 'already' | 'event' | 'bound';

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

/**
 * Loads a window under the shipped web preferences with the probe preload, and
 * returns what that preload got from `require('node:fs')`.
 *
 * @param target the session the shipped window uses, so the policy is the same
 */
async function probeSandboxThroughPreload(target: Electron.Session): Promise<string> {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: {
      ...RENDERER_WEB_PREFERENCES,
      preload: join(HERE, 'sandboxProbePreload.cjs'),
      session: target,
    },
  });

  // A holder rather than a `let`, because TypeScript narrows a `let` assigned
  // only inside a callback to its initialiser and then reports every later `??`
  // as unnecessary — which would make the diagnostic below unreachable by lint's
  // own reasoning while remaining reachable at run time.
  const failed: { reason: string | null } = { reason: null };
  probe.webContents.on('preload-error', (_event, path, error) => {
    failed.reason = `${path}: ${error.name}: ${error.message}`;
  });

  // BOUNDED, because a probe that can only fail by hanging is the shape this
  // harness already has a rule about. A window that never finishes loading is a
  // reportable fact; a proof that times out after two minutes is not.
  //
  // THE ELAPSED TIME IS REPORTED ON BOTH PATHS, and that is the point of it.
  // `proof:rendererpolicy` failed once on windows-latest at 37 seconds — about a
  // normal run plus this bound — and passed everywhere else, so the bound is a
  // suspect and there is no evidence against it. A bare pass/fail makes a load
  // that took 14.9s indistinguishable from one that took 400ms, so the first
  // warning of a cliff is falling off it. Reporting the duration turns that into
  // a gradient somebody can read BEFORE it is a failure.
  //
  // Deliberately not raised. Bumping a timeout to make a red check green is the
  // banned reflex, and the mechanism is not known yet.
  const startedAt = process.hrtime.bigint();
  const loaded = await Promise.race([
    new Promise<'loaded'>((resolve) => {
      probe.webContents.once('did-finish-load', () => {
        resolve('loaded');
      });
      void probe.loadFile(RENDERER_HTML);
    }),
    settle(15_000).then(() => 'timed-out' as const),
  ]);

  const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  if (loaded === 'timed-out') {
    probe.destroy();
    return (
      `the probe window never finished loading ${RENDERER_HTML} within 15s ` +
      `(preload-error: ${failed.reason ?? 'none'})`
    );
  }

  const reported: unknown = await probe.webContents.executeJavaScript(
    `globalThis[${JSON.stringify(SANDBOX_PROBE_KEY)}]?.requireNodeBuiltin ?? null`,
  );
  probe.destroy();

  if (typeof reported === 'string') {
    return `${reported} [probe window loaded in ${String(elapsedMs)}ms]`;
  }
  // An absent report is NOT "the preload could not reach Node". It is a preload
  // that did not run, which is HH-1's class and produces the reassuring answer.
  return `the probe preload reported nothing (preload-error: ${failed.reason ?? 'none'})`;
}

export async function reportRendererPolicy(): Promise<void> {
  await app.whenReady();

  // THE SHELL'S SINK, and the harness subscribes to nothing on its own behalf.
  //
  // It did at first, keeping a private `preload-error` listener so a missing
  // bridge stayed attributable if the sink were the thing that broke. That
  // second listener then satisfied the differential count below all by itself —
  // the probe read one subscriber for an event the shell had stopped
  // subscribing to. Reading the preload's failure out of the SHELL's sink
  // instead tests the shipped path end to end and leaves nothing to subtract.
  const received: ShellFailure[] = [];

  /**
   * One waiter, so the harness can block on an EVENT rather than on a duration.
   *
   * `render-process-gone` is asynchronous, and reading the sink after a fixed
   * settle is a race the runner decides: it passed here and on ubuntu and failed
   * on windows-latest, reporting that the sink was never reached when what
   * happened is that it had not been reached YET. A false negative about a
   * working guard, produced by the clock.
   *
   * Raising the settle is the banned reflex — it moves the boundary and keeps
   * the race. Waiting for the thing removes it.
   */
  let waiter: { event: ShellFailure['event']; resolve: () => void } | null = null;

  const window = createMainWindow(session.defaultSession, (failure) => {
    received.push(failure);
    if (waiter !== null && failure.event === waiter.event) {
      const { resolve } = waiter;
      waiter = null;
      resolve();
    }
  });
  const { webContents } = window;

  /**
   * Resolves when the SINK receives `event`, or `false` at the bound.
   *
   * Checks what has already arrived first: an event delivered before the wait
   * begins would otherwise wait for a second one that never comes, which is the
   * classic way an event-wait reintroduces the race it replaced.
   *
   * @param event the failure the sink must receive
   * @param boundMs liveness only — see {@link CRASH_BOUND_MS}
   */
  const sinkReceives = async (
    event: ShellFailure['event'],
    boundMs: number,
  ): Promise<CrashResolution> => {
    if (received.some((failure) => failure.event === event)) return 'already';
    return await new Promise<CrashResolution>((resolve) => {
      const timer = setTimeout(() => {
        waiter = null;
        resolve('bound');
      }, boundMs);
      waiter = {
        event,
        resolve: () => {
          clearTimeout(timer);
          resolve('event');
        },
      };
    });
  };

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

  // COUNTED AGAINST A BASELINE, because an absolute count is not evidence.
  //
  // Measured: with `reportRendererFailures` deleted, every one of these events
  // still reports exactly one listener — Electron attaches its own internally.
  // So `count > 0` is satisfied by a window that subscribed to nothing, and the
  // first version of this probe passed the mutation it existed to catch. HH-2's
  // class exactly, an hour after HH-2's rule was written down: the reassuring
  // reading was produced by something other than the thing under test.
  //
  // A bare window carries Electron's listeners and none of ours, so the
  // DIFFERENCE is ours. Created after `windowCount` is sampled, so it cannot
  // disturb the popup probe.
  const bare = new BrowserWindow({ show: false });
  const failureListeners = Object.fromEntries(
    (['preload-error', 'render-process-gone', 'unresponsive'] as const).map((event) => [
      event,
      webContents.listenerCount(event) - bare.webContents.listenerCount(event),
    ]),
  );
  bare.destroy();

  // ---------------------------------------------------------------------------
  // The sandbox, attributed rather than inferred.
  // ---------------------------------------------------------------------------
  //
  // A SECOND WINDOW, built from the same RENDERER_WEB_PREFERENCES, with a
  // harness-only preload. It cannot be the product window: the product preload
  // is 233 bytes and exposes one function, and putting a Node probe in it would
  // widen the surface invariant 1 exists to keep narrow.
  //
  // Created after `windowCount` is sampled so it cannot disturb the popup probe,
  // and destroyed immediately.
  const preloadNodeReach = await probeSandboxThroughPreload(session.defaultSession);

  // The URL is read before the kill, because a dead renderer reports none and
  // that would look like a navigation failure rather than like a crash.
  const finalUrl = webContents.getURL();
  const backgroundColor = window.getBackgroundColor();

  // Detached BEFORE the kill: the debugger is attached to the process about to
  // die, and detaching from a gone renderer throws — which would arrive as a
  // harness failure and read as though a probe had broken.
  webContents.debugger.detach();

  // THE SINK IS PROVEN BY KILLING SOMETHING, not by counting listeners. A
  // listener attached to a function that drops what it is given produces the
  // same silence one step along, which is the finding this closes wearing a
  // different hat.
  //
  // WAITED FOR BY EVENT, not by duration. `SETTLE_MS` here was a race the
  // runner decided — green locally and on ubuntu, red on windows-latest with
  // "the sink held: (nothing)", which is what a working sink looks like when it
  // is read too early. `CRASH_BOUND_MS` is a LIVENESS bound and not the
  // correctness mechanism: reaching it means the event genuinely never arrived,
  // and the readback carries that apart from "arrived and was empty" so the
  // case can say which happened.
  // THE WAITER IS INSTALLED BEFORE THE KILL. `sinkReceives` runs synchronously
  // up to its `await`, so calling it without awaiting registers the waiter now —
  // which makes `'already'` unreachable here and leaves `'event'` as the only
  // resolution a working mechanism can produce.
  const crashWait = sinkReceives('render-process-gone', CRASH_BOUND_MS);
  webContents.forcefullyCrashRenderer();
  const crashResolvedBy = await crashWait;

  const readback: Readback = {
    delivered,
    url,
    failureListeners,
    failuresReceived: received.map((failure) => failure.event),
    crashResolvedBy,
    backgroundColor,
    preloadNodeReach,
    connectBlocked,
    evalBlocked,
    nodeSurface: surface.visible,
    bridgeExposed: surface.bridge,
    preloadError: received.find((failure) => failure.event === 'preload-error')?.detail ?? null,
    popupReturnedNull,
    windowCount,
    permissions,
    refusedNavigationLoads,
    permittedNavigationLoads,
    finalUrl,
  };

  // EXIT ONLY ONCE THE LINE IS FLUSHED. `app.exit()` terminates immediately, and
  // when stdout is a pipe — which it always is under a proof — writes are
  // asynchronous. Exiting on the next line truncates the report the caller is
  // waiting for, and the caller then reports "no marker line", which is the same
  // output a harness that never ran produces.
  process.stdout.write(`${MARKER}${JSON.stringify(readback)}\n`, () => {
    app.exit(0);
  });
}
