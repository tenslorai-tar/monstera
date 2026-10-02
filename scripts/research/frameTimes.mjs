// @ts-check
/**
 * Frame times of the running application, from a Chromium performance trace: FEATURES row 303's performance pass.
 *
 * The owner reported that scrolling lags, dragging feels heavy and the application feels heavy (2026-10-01), with no
 * recording of it. This drives the real application through each scenario and reads two things at once:
 *
 * - **frame times**, from `requestAnimationFrame` in the page — the interval between frames the renderer's main thread
 *   produced: median, 95th percentile, and frames dropped against the display's own interval;
 * - **what each frame cost**, from a trace over the same window: the renderer main thread's time split into script,
 *   layout (style and layout), paint, composite (pre-paint, layerize, commit) and other; the raster workers' time; and
 *   the GPU process's busy time, which is where a `backdrop-filter`'s blur executes.
 *
 * ## Which build
 *
 * `--build package` runs `release/msix/test/layout/Monstera.exe`, the folder `packageMsix.mjs` wraps into the MSIX:
 * the same files the owner installs, without the package identity (no install is needed, and none is made).
 * `--build dev` runs this checkout's build through the provisioned Electron, for a before-and-after on a change; a
 * figure that decides anything is read again from a package.
 *
 * Each launch takes a scratch `--user-data-dir`, which scopes Electron's single-instance lock
 * (`scripts/proofs/shell.proof.mjs` proves the lock follows it). Without one, a launch while the owner's installed
 * application is open would hand its documents to the owner's window. The process tree is ended by PID.
 *
 * ## The controls, run first, and the instrument refuses to report without them (audit item 4a)
 *
 * - IDLE: nothing happens for two seconds. The median interval is the display's frame interval, and nothing drops.
 * - HEAVY: a frame callback that spins for 40 ms. The median must be at least twice the idle one, frames must drop, and
 *   script must be the largest share of the main thread — so a reading of *smooth, nothing dominant* is one this
 *   instrument can tell apart from a busy page.
 *
 * ## What it does not measure
 *
 * Frames the compositor produces on its own — a scroll the compositor moves without the main thread — reach the screen
 * whether or not `requestAnimationFrame` fires, so a main thread that is busy shows here as lag that a compositor
 * scroll may partly hide. The trace's busy times are read either way.
 *
 * Usage: node scripts/research/frameTimes.mjs --build package|dev --document <absolute .pdf> [--large]
 *   [--variant none|no-blur|no-gradients|no-thumbnails] [--scenarios scroll,drag,menu,draw]
 * `--large` generates the scan-shaped fixture (`scripts/perf/largeFixture.mjs`) and measures that instead.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { repoRoot } from '../lib/gitScope.mjs';
import { buildScanFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';

const ROOT = repoRoot();
const PORT = 9339;
/** Set by the teardown, so an exit it caused is not reported as the application's own. */
let ending = false;

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const build = option('build') ?? 'package';
/** What `npm start` hands a development shell (`launchEnvironment.mjs`); nothing for the package, which finds its own. */
const DEVELOPMENT_ENV = build === 'dev' ? await developmentEnvironment(ROOT) : {};
const variant = option('variant') ?? 'none';
const scenarios = (option('scenarios') ?? 'scroll,drag,menu,draw').split(',');
const large = process.argv.includes('--large');
const documentPath = large ? buildScanFixture({ root: ROOT }).path : option('document');
if (documentPath === undefined) throw new Error('--document <absolute .pdf> or --large is required.');

/** The CSS each variant adds, to measure a candidate by removing it — never shipped, only injected here. */
const VARIANTS = {
  none: '',
  'no-blur': '*, *::before, *::after { backdrop-filter: none !important; }',
  'no-gradients': '*, *::before, *::after { background-image: none !important; }',
  'no-thumbnails': '.m-document-panel__body { display: none !important; }',
  // THE SCROLLER COMPOSITED, two ways: a hint, and an opaque background (which changes the look and is a probe only).
  'composited-scroll': '.m-page-list { will-change: scroll-position; }',
  'opaque-scroller': '.m-page-list { background-color: #0b120e !important; }',
  'scroller-layer': '.m-page-list { will-change: transform; }',
  // `no-gradients` TAKES THE GRAIN TOO (an SVG noise image, blended `overlay` over the window), so the three are also
  // measured apart: the grain alone, the surface's ambient lights alone, and the page area's own light alone.
  'no-grain': '.m-document-surface::before { display: none !important; }',
  'no-ambient': '.m-document-surface { background-image: none !important; }',
  'no-canvas-light': '.m-canvas-area { background-image: none !important; }',
  'scroller-layer-no-grain': '.m-page-list { will-change: transform; } .m-document-surface::before { display: none !important; }',
  // THE GRAIN KEPT, on its own layer: drawn once, blended by the compositor, never re-rastered under a repaint.
  'grain-layer': '.m-document-surface::before { will-change: transform; }',
  'scroller-layer-grain-layer': '.m-page-list { will-change: transform; } .m-document-surface::before { will-change: transform; }',
  // THE GRADIENTS' REMAINING COST once the page list has its own layer: the owner's trade, measured after the fix.
  'scroller-layer-no-gradients':
    '.m-page-list { will-change: transform; } *, *::before, *::after { background-image: none !important; }',
  // EACH PAGE'S LAYOUT ISOLATED: a slot that moved without changing size need not lay its text layer out again.
  'contain-slots': '.m-page-slot { contain: layout; }',
  // A Chromium switch rather than CSS: every scroller composited, LCD text given up wherever one scrolls.
  'prefer-compositing': '',
  // A script rather than CSS: see NO_GLOBAL_CURSOR.
  'no-global-cursor': '',
};

/**
 * Keeps zag's splitter from adding its drag-cursor `<style>` (`* { cursor: … !important }`), which `setGlobalCursor`
 * rewrites on EVERY pointer move (`@zag-js/splitter` 1.43.3, `splitter.machine.mjs`) — a stylesheet change matching
 * every element, so a whole-document style recalculation per move; and the renderer's CSP refuses the sheet anyway.
 * Measurement only: injected into the page, never shipped.
 */
const NO_GLOBAL_CURSOR = variant === 'no-global-cursor';
/** Chromium switches a variant adds to the launch. */
const SWITCHES = variant === 'prefer-compositing' ? ['--enable-prefer-compositing-to-lcd-text'] : [];
const css = VARIANTS[/** @type {keyof typeof VARIANTS} */ (variant)];
if (css === undefined) throw new Error(`--variant is one of ${Object.keys(VARIANTS).join(', ')}.`);

// ---------------------------------------------------------------------------------------------------------------
// The trace: which thread did what, between two marks.

const CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing',
  'v8.execute',
  'cc',
  'viz',
  'gpu',
  'benchmark',
];

/** @param {string} name @returns {'script' | 'layout' | 'paint' | 'composite' | null} */
function categoryOf(name) {
  if (/^(FunctionCall|EvaluateScript|EventDispatch|TimerFire|FireAnimationFrame|FireIdleCallback|RunMicrotasks|MinorGC|MajorGC|V8\.|v8\.)/u.test(name)) return 'script';
  if (/^(Layout|UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|HitTest)$/u.test(name)) return 'layout';
  if (/^(Paint|PaintImage|Decode Image|ImageDecodeTask|Decode LazyPixelRef|RasterTask|Rasterize)$/u.test(name)) return 'paint';
  if (/^(PrePaint|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|ProxyMain::BeginMainFrame::commit|ActivateLayerTree)$/u.test(name)) return 'composite';
  return null;
}

/**
 * Self time per category on one thread, where an event's self time goes to its nearest categorised ancestor (itself
 * included), and to `other` when none is.
 *
 * @param {any[]} events complete events on one thread, any order
 */
function breakdown(events) {
  const sorted = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  /** @type {Record<string, number>} */
  const totals = { script: 0, layout: 0, paint: 0, composite: 0, other: 0 };
  /** @type {{ end: number, category: string, child: number, dur: number }[]} */
  const stack = [];
  const close = (/** @type {number} */ until) => {
    while (stack.length > 0 && (stack.at(-1)?.end ?? 0) <= until) {
      const done = /** @type {{ end: number, category: string, child: number, dur: number }} */ (stack.pop());
      totals[done.category] = (totals[done.category] ?? 0) + Math.max(0, done.dur - done.child);
      const parent = stack.at(-1);
      if (parent !== undefined) parent.child += done.dur;
    }
  };
  for (const event of sorted) {
    close(event.ts);
    const inherited = stack.at(-1)?.category ?? 'other';
    stack.push({ end: event.ts + event.dur, category: categoryOf(event.name) ?? inherited, child: 0, dur: event.dur });
  }
  close(Number.POSITIVE_INFINITY);
  for (const key of Object.keys(totals)) totals[key] = Math.round((totals[key] ?? 0) / 100) / 10;
  return totals;
}

/**
 * Busy milliseconds per thread: the UNION of its task intervals, because a task runs nested inside another (a nested
 * run loop), and summing durations counted that time twice — measured on the first run, a main thread reported 5,432
 * ms busy inside a 4,973 ms window, which no single thread can be.
 *
 * @param {any[]} events
 * @returns {Record<string, number>} thread key to milliseconds
 */
function busyByThread(events) {
  /** @type {Map<string, [number, number][]>} */
  const spans = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !/RunTask$/u.test(e.name) || typeof e.dur !== 'number') continue;
    const key = `${String(e.pid)}:${String(e.tid)}`;
    const list = spans.get(key) ?? [];
    list.push([e.ts, e.ts + e.dur]);
    spans.set(key, list);
  }
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, list] of spans) {
    list.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [from, to] = list[0] ?? [0, 0];
    for (const [start, stop] of list.slice(1)) {
      if (start > to) {
        total += to - from;
        [from, to] = [start, stop];
      } else if (stop > to) to = stop;
    }
    total += to - from;
    out[key] = Math.round(total / 100) / 10;
  }
  return out;
}

/** @param {any[]} events */
function busy(events) {
  return Math.round(Object.values(busyByThread(events)).reduce((sum, ms) => sum + ms, 0) * 10) / 10;
}

/** @param {any[]} trace @param {string} startMark @param {string} endMark */
function analyse(trace, startMark, endMark) {
  const mark = (/** @type {string} */ name) => trace.find((e) => e.name === name && e.cat?.includes('blink.user_timing'));
  const start = mark(startMark);
  const end = mark(endMark);
  if (start === undefined || end === undefined) throw new Error(`the trace holds no ${start === undefined ? startMark : endMark} mark, so it cannot be windowed`);
  const inWindow = trace.filter((e) => e.ts >= start.ts && e.ts <= end.ts);
  /** @type {Map<string, string>} */
  const threadNames = new Map();
  /** @type {Map<number, string>} */
  const processNames = new Map();
  for (const e of trace) {
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? '');
    if (e.ph === 'M' && e.name === 'process_name') processNames.set(e.pid, e.args?.name ?? '');
  }
  const on = (/** @type {(thread: string, process: string) => boolean} */ test) =>
    inWindow.filter((e) => test(threadNames.get(`${e.pid}:${e.tid}`) ?? '', processNames.get(e.pid) ?? ''));
  // THE PAGE'S renderer: the one whose main thread carries the start mark.
  const main = inWindow.filter((e) => e.pid === start.pid && threadNames.get(`${e.pid}:${e.tid}`) === 'CrRendererMain');
  const reporters = inWindow.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b');
  /** @type {Record<string, number>} */
  const states = {};
  for (const r of reporters) {
    // `frame_reporter` in this Chromium's JSON trace (read from a kept trace, 2026-10-01), not the proto's name.
    const state = r.args?.frame_reporter?.state ?? 'unstated';
    states[state] = (states[state] ?? 0) + 1;
    // WHICH THREAD SCROLLED: a scroll on the main thread repaints the scroller every frame.
    const scroll = r.args?.frame_reporter?.scroll_state;
    if (typeof scroll === 'string' && scroll !== 'SCROLL_NONE') states[scroll] = (states[scroll] ?? 0) + 1;
  }
  const windowMs = Math.round((end.ts - start.ts) / 1000);
  // A THREAD CANNOT BE BUSY FOR LONGER THAN THE WINDOW: the check the first run failed, kept so it cannot recur.
  for (const [thread, ms] of Object.entries(busyByThread(inWindow))) {
    if (ms > windowMs * 1.02 + 5) throw new Error(`thread ${thread} reads ${String(ms)} ms busy in a ${String(windowMs)} ms window`);
  }
  return {
    windowMs,
    main: breakdown(main),
    mainBusy: busy(main),
    raster: busy(on((thread, process) => process === 'Renderer' && /CompositorTileWorker/u.test(thread))),
    compositor: busy(on((thread, process) => process === 'Renderer' && thread === 'Compositor')),
    gpuMain: busy(on((thread, process) => process === 'GPU Process' && thread === 'CrGpuMain')),
    viz: busy(on((thread, process) => process === 'GPU Process' && thread === 'VizCompositorThread')),
    compositorFrames: states,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The application.

/** The PIDs listening on the debugging port, from `netstat -ano`. */
function portListeners() {
  return execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(`127.0.0.1:${String(PORT)} `) && line.includes('LISTENING'))
    .map((line) => Number(line.trim().split(/\s+/u).at(-1)));
}

/**
 * Launches the application, refusing when something already listens on the port.
 *
 * A run attaches to whatever answers on {@link PORT}, so a process left from an earlier run would be MEASURED in place
 * of this one — observed 2026-10-01 as a run whose launched process had already exited while a connection succeeded.
 * The listener is compared with the launched PID once the port opens, in `main` below.
 *
 * @param {string} documentFile
 */
function launch(documentFile) {
  const already = portListeners();
  if (already.length > 0) throw new Error(`port ${String(PORT)} is already held by PID ${already.join(', ')}; end it first`);
  const userData = mkdtempSync(join(tmpdir(), 'monstera-frames-'));
  const common = [`--user-data-dir=${userData}`, `--remote-debugging-port=${String(PORT)}`, ...SWITCHES, documentFile];
  const [command, args] =
    build === 'package'
      ? [join(ROOT, 'release', 'msix', 'test', 'layout', 'Monstera.exe'), common]
      : [electronBinaryPath(ROOT), [resolve(ROOT, 'apps', 'desktop'), ...common]];
  // A DEVELOPMENT SHELL IS HANDED ITS NATIVE COMPONENTS, as `npm start` hands them: without them it has no engine
  // host, and every document is poisoned for engine commands while it still displays. The package finds its own.
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...DEVELOPMENT_ENV } });
  const started = Date.now();
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.on('exit', (code, signal) => {
    if (!ending) console.error(`THE APPLICATION EXITED after ${String(Date.now() - started)} ms, code ${String(code)} signal ${String(signal)}; its stderr ends:\n${stderr}`);
  });
  return { child, userData };
}

/**
 * Ends the tree this run started, then removes its scratch folder.
 *
 * `taskkill /F` returns once termination is REQUESTED, and the processes release their handles on the user-data folder
 * as they finish tearing down — measured 2026-10-01, an immediate delete failed with EPERM and nothing was left running
 * a moment later. So this waits for the launched process's own exit, and a folder that still cannot be removed is
 * REPORTED rather than thrown, because a throw here replaces whatever error the run itself raised.
 *
 * @param {import('node:child_process').ChildProcess} child @param {string} userData
 */
async function end(child, userData) {
  ending = true;
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once('exit', done));
  if (child.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone: taskkill exits non-zero for a PID with no process, which is the state this wanted.
    }
  }
  await exited;
  // THE PORT IS THE NEXT RUN'S PRECONDITION, so the teardown waits for it to be released rather than for a guess.
  for (let i = 0; i < 60 && portListeners().length > 0; i += 1) await new Promise((done) => setTimeout(done, 500));
  if (portListeners().length > 0) console.error(`port ${String(PORT)} is still held by ${portListeners().join(', ')} after the kill`);
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`The scratch folder ${userData} was not removed: ${String(error)}`);
  }
}

/**
 * Maximises the launched window, as the owner's is in every recording of the lag (`batch-1`).
 *
 * The shell sets no size, and Electron's DevTools protocol has no `Browser.getWindowForTarget` (measured: *"wasn't
 * found"*), so this asks Windows: `ShowWindow(…, SW_MAXIMIZE)` on the main window of THIS run's process, found by its
 * PID — never by title, which the owner's own window shares.
 *
 * @param {number} pid
 */
function maximise(pid) {
  const command =
    "Add-Type -Name Win -Namespace Frames -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr window, int command);'; " +
    `$w = (Get-Process -Id ${String(pid)}).MainWindowHandle; if ($w -eq 0) { exit 3 }; [void][Frames.Win]::ShowWindow($w, 3)`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'pipe' });
}

/*
 * THE CALLBACKS HANDED TO `page.evaluate` RUN IN THE PAGE, not here, so they reach its globals through `globalThis` —
 * which is the page's `window` where they execute. Naming `window` or `document` directly would need a file-wide
 * declaration that would also let this Node-side script name them without a word from the linter.
 */

/** @param {any} page */
async function recordFrames(page, /** @type {string} */ label) {
  await page.evaluate((/** @type {string} */ name) => {
    const w = /** @type {any} */ (globalThis);
    w.__frames = [];
    w.__canvas = { added: 0, resized: 0 };
    w.__recording = true;
    w.__observer = new w.MutationObserver((/** @type {any[]} */ records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target instanceof w.HTMLCanvasElement) w.__canvas.resized += 1;
        for (const n of r.addedNodes) {
          if (n instanceof w.HTMLCanvasElement || (n instanceof w.Element && n.querySelector('canvas'))) w.__canvas.added += 1;
        }
      }
    });
    w.__observer.observe(w.document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['width', 'height'] });
    const tick = (/** @type {number} */ t) => {
      if (!w.__recording) return;
      w.__frames.push(t);
      w.requestAnimationFrame(tick);
    };
    w.requestAnimationFrame(tick);
    performance.mark(`${name}:start`);
  }, label);
}

/** @param {any} page @param {string} label */
async function stopFrames(page, label) {
  return page.evaluate((/** @type {string} */ name) => {
    const w = /** @type {any} */ (globalThis);
    performance.mark(`${name}:end`);
    w.__recording = false;
    w.__observer.disconnect();
    return { frames: /** @type {number[]} */ (w.__frames), canvas: w.__canvas };
  }, label);
}

/** @param {number[]} times @param {number} interval the display's frame interval, from the idle control */
function frameStats(times, interval) {
  const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t)).sort((a, b) => a - b);
  if (gaps.length === 0) return { frames: 0, median: NaN, p95: NaN, dropped: NaN };
  const at = (/** @type {number} */ q) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? NaN;
  const dropped = gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / interval) - 1), 0);
  return { frames: gaps.length + 1, median: Math.round(at(0.5) * 10) / 10, p95: Math.round(at(0.95) * 10) / 10, dropped };
}

/** @param {any} cdp */
async function startTrace(cdp) {
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: { includedCategories: CATEGORIES, recordMode: 'recordAsMuchAsPossible' },
  });
}

/** @param {any} cdp @returns {Promise<any[]>} */
async function stopTrace(cdp) {
  const complete = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
  await cdp.send('Tracing.end');
  const { stream } = /** @type {{ stream: string }} */ (await complete);
  let text = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream, size: 1 << 20 });
    text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.traceEvents;
}

/**
 * One scenario: trace on, frames recorded, the action, frames and trace read back.
 *
 * @param {any} cdp @param {any} page @param {string} label @param {() => Promise<void>} action @param {number} interval
 */
async function measure(cdp, page, label, action, interval) {
  await startTrace(cdp);
  await recordFrames(page, label);
  await action();
  const { frames, canvas } = await stopFrames(page, label);
  const trace = await stopTrace(cdp);
  const keep = process.env['FRAMES_TRACE_DIR'];
  if (keep !== undefined) writeFileSync(join(keep, `${label.replace(/[^a-z0-9]+/giu, '-')}.json`), JSON.stringify(trace));
  return { label, ...frameStats(frames, interval), canvas, ...analyse(trace, `${label}:start`, `${label}:end`) };
}

/** @param {any} page @param {number} x0 @param {number} y0 @param {number} dx @param {number} dy */
async function drag(page, x0, y0, dx, dy, steps = 60) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await page.waitForTimeout(8);
  }
  for (let i = steps - 1; i >= 0; i -= 1) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
}

/** @param {any} page @param {string} selector */
async function centre(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** @param {any} page @param {number} scale */
async function zoomTo(page, scale) {
  await page.evaluate((/** @type {number} */ value) => {
    const w = /** @type {any} */ (globalThis);
    const slider = w.document.querySelector('.m-status-zoom-slider');
    // THE NATIVE SETTER, so React's input tracker sees a change it did not make and `onChange` runs.
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(slider, String(value));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, scale);
  await page.waitForTimeout(1500);
  return page.locator('.m-status-zoom').first().textContent();
}

/** @param {any} page */
async function scrollDown(page) {
  const list = await centre(page, '.m-page-list');
  await page.mouse.move(list.x, list.y);
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(16);
  }
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(16);
  }
}

// ---------------------------------------------------------------------------------------------------------------

const { child, userData } = launch(documentPath);
/** @type {any[]} */
const results = [];
try {
  /** @type {any} */
  let browser;
  for (let i = 0; i < 120 && browser === undefined; i += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (browser === undefined) throw new Error('the application never opened its debugging port');
  const listeners = portListeners();
  if (!listeners.includes(/** @type {number} */ (child.pid))) {
    throw new Error(`the port answers from PID ${listeners.join(', ')}, not the launched ${String(child.pid)} (exit code ${String(child.exitCode)})`);
  }
  // THE PAGE THAT SHOWS THE DOCUMENT, looked for again on each attempt: the first run that connected early found its
  // page closed under it, so the first page listed is not assumed to be the one that lives.
  /** @type {any} */
  let page;
  for (let i = 0; i < 120 && page === undefined; i += 1) {
    for (const candidate of browser.contexts().flatMap((/** @type {any} */ context) => context.pages())) {
      if (!candidate.isClosed() && (await candidate.locator('.m-page-list canvas').count().catch(() => 0)) > 0) page = candidate;
    }
    if (page === undefined) await new Promise((done) => setTimeout(done, 500));
  }
  if (page === undefined) {
    const seen = browser.contexts().flatMap((/** @type {any} */ context) => context.pages().map((/** @type {any} */ p) => p.url()));
    throw new Error(`no page showed the document within a minute; pages: ${JSON.stringify(seen)}`);
  }
  const cdp = await browser.newBrowserCDPSession();
  maximise(/** @type {number} */ (child.pid));
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 5000 }).catch(() => undefined);
  // A CONSTRUCTED SHEET, because the renderer's CSP refuses an injected `<style>` (`style-src` pins hashes, §9.27) —
  // measured: `addStyleTag` was blocked. A sheet adopted through the CSSOM is not an inline style, so the policy that
  // ships is left as it is and the candidate is still removed.
  if (css !== '') {
    await page.evaluate((/** @type {string} */ text) => {
      const w = /** @type {any} */ (globalThis);
      const sheet = new w.CSSStyleSheet();
      sheet.replaceSync(text);
      w.document.adoptedStyleSheets = [...w.document.adoptedStyleSheets, sheet];
    }, css);
  }
  if (NO_GLOBAL_CURSOR) {
    await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      const head = w.document.head;
      const append = head.appendChild.bind(head);
      head.appendChild = (/** @type {any} */ node) => (String(node.id ?? '').startsWith('splitter:') ? node : append(node));
    });
  }
  await page.waitForTimeout(3000);
  const screen = await page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    return {
      width: w.innerWidth,
      height: w.innerHeight,
      dpr: w.devicePixelRatio,
      // HOW MUCH THE PAGE VIEW HOLDS, which is what a layout of it walks.
      elementsInPageList: w.document.querySelectorAll('.m-page-list *').length,
      elements: w.document.querySelectorAll('*').length,
    };
  });

  // A PICTURE OF THE SETTLED SCREEN, for a variant whose claim is that it changes no look: compared by pixel elsewhere.
  const picture = option('screenshot');
  if (picture !== undefined) await page.screenshot({ path: picture });
  if (scenarios.includes('none')) {
    // THE PICTURE WAS THE RUN: the tree this started is ended here, because nothing below should measure anything.
    console.log(JSON.stringify({ build, variant, screenshot: picture ?? null }));
    await browser.close().catch(() => undefined);
    await end(child, userData);
    process.exit(0);
  }

  // THE CONTROLS FIRST, and nothing is reported unless they separate.
  const idle = await measure(cdp, page, 'CONTROL idle', () => page.waitForTimeout(2000), 1000 / 60);
  const interval = idle.median;
  const heavy = await measure(
    cdp,
    page,
    'CONTROL heavy',
    async () => {
      await page.evaluate(() => {
        const w = /** @type {any} */ (globalThis);
        const until = performance.now() + 2000;
        const spin = () => {
          const stop = performance.now() + 40;
          while (performance.now() < stop) {
            // A deliberate 40 ms of script per frame: the control's load.
          }
          if (performance.now() < until) w.requestAnimationFrame(spin);
        };
        w.requestAnimationFrame(spin);
      });
      await page.waitForTimeout(2300);
    },
    interval,
  );
  const largestShare = Object.entries(heavy.main).sort((a, b) => b[1] - a[1])[0]?.[0];
  // ON THE 95TH PERCENTILE AND THE DROPPED COUNT, not the median: 40 ms of script lands frames at two and three display
  // intervals, so the median is 33.3 ms where twice the idle median is 33.4 — the first form of this test sat exactly on
  // the value it was testing and failed a run whose separation was plain (p95 50 ms against 16.8, 70 dropped against 0).
  const separated = heavy.p95 >= 2.5 * interval && heavy.dropped >= 30 && largestShare === 'script' && idle.dropped <= 2;
  results.push(idle, heavy);
  if (!separated) {
    console.log(JSON.stringify({ screen, idle, heavy }, null, 1));
    throw new Error('THE CONTROLS DID NOT SEPARATE: an idle page and a page spinning 40 ms a frame read alike, so no reading below would mean anything.');
  }

  if (scenarios.includes('scroll')) {
    for (const scale of [1, 1.9]) {
      const shown = await zoomTo(page, scale);
      results.push(await measure(cdp, page, `scroll at ${String(shown)}`, () => scrollDown(page), interval));
    }
    await zoomTo(page, 1);
  }
  if (scenarios.includes('drag')) {
    /** @type {[string, string, number, number][]} */
    const drags = [
      ['drag the Float bar', '.m-quick-toolbar__grip', 260, 120],
      ['drag a panel edge', '.m-splitter__handle--leads', 160, 0],
      ['drag a thumbnail', '.m-thumb', 0, 180],
    ];
    for (const [label, selector, dx, dy] of drags) {
      // A VARIANT CAN HIDE THE THING DRAGGED (no thumbnails hides their panel's edge too): that scenario is skipped
      // and says so, rather than ending the run.
      const box = await page.locator(selector).first().boundingBox();
      if (box === null) {
        results.push({ label, skipped: `${selector} is not on screen` });
        continue;
      }
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      results.push(await measure(cdp, page, label, () => drag(page, x, y, dx, dy), interval));
    }
  }
  if (scenarios.includes('draw')) {
    await page.locator('[data-ribbon-section="comment"]').first().click();
    await page.waitForTimeout(500);
    const tool = page.getByRole('button', { name: /^Rectangle/u }).first();
    if ((await tool.count()) > 0) {
      await tool.click();
      const list = await centre(page, '.m-page-list');
      results.push(await measure(cdp, page, 'draw a rectangle', () => drag(page, list.x - 120, list.y - 80, 220, 160), interval));
      await page.keyboard.press('Escape');
    } else {
      results.push({ label: 'draw a rectangle', skipped: 'no Rectangle button on the Comment tab' });
    }
  }
  if (scenarios.includes('menu')) {
    results.push(
      await measure(
        cdp,
        page,
        'open a menu',
        async () => {
          for (let i = 0; i < 5; i += 1) {
            await page.getByRole('menuitem', { name: 'File' }).first().click();
            await page.waitForTimeout(400);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
        },
        interval,
      ),
    );
  }

  console.log(JSON.stringify({ build, variant, large, screen, interval, results }, null, 1));
  await browser.close().catch(() => undefined);
} finally {
  await end(child, userData);
}
