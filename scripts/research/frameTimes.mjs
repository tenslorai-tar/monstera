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
 * **The stage cannot measure anything the engine hosts do.** Measured 2026-10-02: a host created by a process with no
 * package identity is refused the runtime (ADR-0023's 2026-09-30 correction), so on the stage every document waits out
 * two 10 s connect attempts and is then poisoned — *"Invalid file descriptor to ICU data"* in the shell log — and a
 * page draws only after that, without the engine's answer. `--build installed` runs the INSTALLED test package inside
 * its own package context (`Invoke-CommandInDesktopPackage`, no install and no elevation), where the hosts start; its
 * profile sits outside AppData, and its teardown ends only the tree whose PID answered the port and was not one of the
 * owner's Monstera processes before the run.
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
 * ## Opening a second document, and switching between two (row 303's open and tab-switch figures)
 *
 * `--then-open <absolute .pdf>|large` names a second document, and the `open` and `switch` scenarios use it. Both are
 * read IN THE PAGE, once per animation frame, so every time below is the frame at which a condition first held:
 *
 * - a page is DRAWN when its canvas on screen has a non-transparent centre pixel. `renderPage.ts` draws on a scratch
 *   canvas and presents it in one step (`present`), and an undrawn canvas is transparent throughout, so one pixel
 *   separates the two — at the cost of one readback per canvas per frame, which this instrument adds to what it times;
 * - the screen is FINISHED when the document asked for is the current tab and every page and thumbnail canvas on screen
 *   — inside the window and inside each scrolling ancestor — is drawn;
 * - the document is QUIET from the first moment after it finished with no long task (over 50 ms, Chromium's
 *   `longtask` entries) in the second that follows. That is this instrument's reading of *fully usable*: input is
 *   answered within a frame or two from then on. It is a definition, stated as one.
 *
 * `open` hands the second document to the running application the way a file association or *Open with* does — a
 * second launch, which loses the single-instance lock and passes its arguments over — and times from just before that
 * launch, so the second process's own start is inside the figure. `switch` clicks each tab in turn, three times each
 * way, timed from the click event's own timestamp.
 *
 * Usage: node scripts/research/frameTimes.mjs --build package|dev --document <absolute .pdf> [--large]
 *   [--variant none|no-blur|no-gradients|no-thumbnails] [--scenarios scroll,drag,menu,draw,open,switch]
 *   [--then-open <absolute .pdf>|large]
 * `--large` generates the scan-shaped fixture (`scripts/perf/largeFixture.mjs`) and measures that instead.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
/** The measured program's PID: the launched process, or for an installed run the port's listener. */
/** @type {number | undefined} */
let appPid;

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const build = option('build') ?? 'package';
if (!['package', 'installed', 'dev'].includes(build)) throw new Error('--build is package, installed or dev.');

/** The installed test package, read from Windows: its family name and folder. */
const INSTALLED = build === 'installed' ? installedPackage() : { family: '', location: '' };

function installedPackage() {
  const text = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "$p = Get-AppxPackage -Name 'TenslorInc.MonsteraPDFEditor.Test'; if ($null -eq $p) { exit 3 }; \"$($p.PackageFamilyName)|$($p.InstallLocation)|$($p.Version)\""],
    { encoding: 'utf8' },
  ).trim();
  const [family = '', location = '', version = ''] = text.split('|');
  if (family === '' || location === '') throw new Error('no installed test package to measure');
  console.error(`measuring the installed package ${version}`);
  return { family, location };
}

/** The PIDs of running Monstera processes — the owner's own, before a run, which a teardown must never end. */
function monsteraPids() {
  const text = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Monstera.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return text
    .split('\n')
    .map((line) => Number(line.split('","')[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}
/** What `npm start` hands a development shell (`launchEnvironment.mjs`); nothing for the package, which finds its own. */
const DEVELOPMENT_ENV = build === 'dev' ? await developmentEnvironment(ROOT) : {};
const variant = option('variant') ?? 'none';
const scenarios = (option('scenarios') ?? 'scroll,drag,menu,draw').split(',');
const large = process.argv.includes('--large');
const documentPath = large ? buildScanFixture({ root: ROOT }).path : option('document');
if (documentPath === undefined) throw new Error('--document <absolute .pdf> or --large is required.');
const thenOpenOption = option('then-open');
const secondPath = thenOpenOption === 'large' ? buildScanFixture({ root: ROOT }).path : thenOpenOption;
if ((scenarios.includes('open') || scenarios.includes('switch')) && secondPath === undefined) {
  throw new Error('the open and switch scenarios need --then-open <absolute .pdf>|large.');
}

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

/**
 * The busiest threads between two marks, named by process and thread, in milliseconds — every process the trace holds,
 * the browser process (`main`) included, so time no thread spent is visible as the window minus the busiest.
 *
 * @param {any[]} trace @param {string} startMark @param {string} endMark
 */
function busiestThreads(trace, startMark, endMark) {
  const mark = (/** @type {string} */ name) => trace.find((e) => e.name === name && e.cat?.includes('blink.user_timing'));
  const start = mark(startMark);
  const end = mark(endMark);
  if (start === undefined || end === undefined) throw new Error(`the trace holds no ${start === undefined ? startMark : endMark} mark`);
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const e of trace) {
    if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args?.name ?? '');
    if (e.ph === 'M' && e.name === 'process_name') names.set(String(e.pid), e.args?.name ?? '');
  }
  const busyMs = busyByThread(trace.filter((e) => e.ts >= start.ts && e.ts <= end.ts));
  return {
    windowMs: Math.round((end.ts - start.ts) / 1000),
    threads: Object.entries(busyMs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, ms]) => `${names.get(key.split(':')[0] ?? '') ?? '?'} ${String(key.split(':')[0])} / ${names.get(key) ?? '?'}: ${String(ms)} ms`),
  };
}

/**
 * The longest single events on the page's renderer main thread between two marks, by name and with the function a
 * script event ran where the trace names one — what a long task WAS, which a busy total cannot say.
 *
 * @param {any[]} trace @param {string} startMark @param {string} endMark
 */
function topEvents(trace, startMark, endMark) {
  const start = trace.find((e) => e.name === startMark && e.cat?.includes('blink.user_timing'));
  const end = trace.find((e) => e.name === endMark && e.cat?.includes('blink.user_timing'));
  if (start === undefined || end === undefined) return [];
  /** @type {Set<string>} */
  const mains = new Set();
  for (const e of trace) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && e.pid === start.pid) mains.add(`${e.pid}:${e.tid}`);
  }
  return trace
    .filter((e) => e.ph === 'X' && typeof e.dur === 'number' && e.ts >= start.ts && e.ts <= end.ts && mains.has(`${e.pid}:${e.tid}`) && e.name !== 'RunTask' && !/ThreadControllerImpl|RunTask$/u.test(e.name))
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 12)
    .map((e) => {
      const data = e.args?.data ?? {};
      const what = data.functionName || data.url?.split('/').at(-1) || data.type || '';
      return `${e.name}${what === '' ? '' : ` (${String(what).slice(0, 60)}${data.lineNumber === undefined ? '' : `:${String(data.lineNumber)}`})`} ${String(Math.round(e.dur / 1000))} ms`;
    });
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
 * The program and its leading arguments for this run's build: the stage's executable, or the provisioned runtime given
 * the desktop package's folder.
 *
 * @param {string[]} rest
 * @returns {[string, string[]]}
 */
function commandFor(rest) {
  if (build === 'installed') {
    // INSIDE THE PACKAGE'S CONTEXT, without an install or an elevation: the program gets the package identity a Start
    // menu launch gives it, which the stage cannot have. Each argument is quoted for the command line and the whole is
    // one PowerShell single-quoted string, whose only escape is a doubled quote.
    const line = rest.map((argument) => `"${argument}"`).join(' ').replaceAll("'", "''");
    const exe = join(INSTALLED.location, 'Monstera.exe').replaceAll("'", "''");
    return [
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Invoke-CommandInDesktopPackage -PackageFamilyName '${INSTALLED.family}' -AppId 'Monstera' -Command '${exe}' -Args '${line}'`],
    ];
  }
  return build === 'package'
    ? [join(ROOT, 'release', 'msix', 'test', 'layout', 'Monstera.exe'), rest]
    : [electronBinaryPath(ROOT), [resolve(ROOT, 'apps', 'desktop'), ...rest]];
}

/**
 * A second launch on the same profile, as a file association makes: it loses the single-instance lock to the running
 * application and hands its document over. Not ended here — it quits on its own at the lock.
 *
 * @param {string} documentFile @param {string} userData
 */
function handOver(documentFile, userData) {
  const [command, args] = commandFor([`--user-data-dir=${userData}`, documentFile]);
  return spawn(command, args, { stdio: 'ignore', env: { ...process.env, ...DEVELOPMENT_ENV } });
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
  // AN INSTALLED RUN'S PROFILE SITS OUTSIDE AppData: a packaged process's writes under AppData are redirected into the
  // package's own storage, where a scratch profile would outlive the run in the owner's package data.
  const scratchRoot = build === 'installed' ? join(ROOT, '..', 'perf-profiles') : tmpdir();
  mkdirSync(scratchRoot, { recursive: true });
  const userData = mkdtempSync(join(scratchRoot, 'monstera-frames-'));
  const common = [`--user-data-dir=${userData}`, `--remote-debugging-port=${String(PORT)}`, ...SWITCHES, documentFile];
  const [command, args] = commandFor(common);
  // A DEVELOPMENT SHELL IS HANDED ITS NATIVE COMPONENTS, as `npm start` hands them: without them it has no engine
  // host, and every document is poisoned for engine commands while it still displays. The package finds its own.
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...DEVELOPMENT_ENV } });
  const started = Date.now();
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.on('exit', (code, signal) => {
    // AN INSTALLED RUN'S CHILD IS THE LAUNCHER, which exits once the package has started the program.
    if (!ending && build !== 'installed') console.error(`THE APPLICATION EXITED after ${String(Date.now() - started)} ms, code ${String(code)} signal ${String(signal)}; its stderr ends:\n${stderr}`);
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
  // THE TREE THIS RUN STARTED: the launched process, or for an installed run the program the package started — the
  // port's listener, checked against the owner's own PIDs when it was found.
  const root = build === 'installed' ? appPid : child.pid;
  if (root !== undefined) {
    try {
      execFileSync('taskkill', ['/PID', String(root), '/T', '/F'], { stdio: 'ignore' });
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

/**
 * Starts the per-frame watch for one document becoming finished and quiet (see the header). `target` is the docId asked
 * for, or `null` for *a tab that is not `previous`* — an open, whose docId is not known until its tab appears.
 * `startAt` is the moment timed from, in the page's clock; `click` replaces it with the next tab click's own timestamp.
 *
 * @param {any} page @param {{ target: string | null, previous: string | null, click: boolean, probeModel?: boolean }} options
 * @returns {Promise<number>} the page's clock when the watch began
 */
async function watchDocument(page, options) {
  return page.evaluate((/** @type {{ target: string | null, previous: string | null, click: boolean, probeModel?: boolean }} */ o) => {
    const w = /** @type {any} */ (globalThis);
    const state = {
      start: performance.now(),
      tabAt: /** @type {number | null} */ (null),
      firstPageAt: /** @type {number | null} */ (null),
      finishedAt: /** @type {number | null} */ (null),
      docId: /** @type {string | null} */ (null),
      frames: 0,
      firstSeen: /** @type {object | null} */ (null),
      modelAt: /** @type {number | null} */ (null),
      modelAskedAt: /** @type {number | null} */ (null),
      modelCalls: 0,
      modelFirstAnswer: /** @type {string | null} */ (null),
      longTasks: /** @type {[number, number][]} */ ([]),
      running: true,
    };
    w.__watch = state;
    if (o.click) {
      w.document.addEventListener(
        'click',
        (/** @type {any} */ event) => {
          if (event.target?.closest?.('[data-tab-select]')) state.start = event.timeStamp;
        },
        { capture: true, once: true },
      );
    }
    w.__longTasks?.disconnect();
    w.__longTasks = new w.PerformanceObserver((/** @type {any} */ list) => {
      for (const entry of list.getEntries()) state.longTasks.push([entry.startTime, entry.startTime + entry.duration]);
    });
    w.__longTasks.observe({ type: 'longtask' });
    /** Whether an element is on screen: inside the window and inside every scrolling ancestor. */
    const onScreen = (/** @type {any} */ element) => {
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.bottom <= 0 || box.right <= 0 || box.top >= w.innerHeight || box.left >= w.innerWidth) return false;
      for (let up = element.parentElement; up !== null; up = up.parentElement) {
        const overflow = w.getComputedStyle(up).overflowY;
        if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'hidden') continue;
        const clip = up.getBoundingClientRect();
        if (box.bottom <= clip.top || box.top >= clip.bottom || box.right <= clip.left || box.left >= clip.right) return false;
      }
      return true;
    };
    const drawn = (/** @type {any} */ canvas) => {
      if (canvas.width === 0 || canvas.height === 0) return false;
      const pixel = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
      return pixel !== undefined && pixel[3] > 0;
    };
    const tick = (/** @type {number} */ now) => {
      if (!state.running) return;
      state.frames += 1;
      const current = w.document.querySelector('[data-tab-select][aria-current="true"]')?.dataset.tabSelect ?? null;
      const wanted = o.target === null ? current !== null && current !== o.previous : current === o.target;
      if (wanted) {
        state.docId = current;
        state.tabAt ??= now;
        const pages = [...w.document.querySelectorAll('.m-page-list canvas.m-page, .m-page-list canvas.m-page-tile')].filter(onScreen);
        const thumbs = [...w.document.querySelectorAll('canvas.m-thumb-canvas')].filter(onScreen);
        // WHAT THE FIRST WATCHED FRAME SAW, so a slow reading says whether nothing was on screen or nothing was drawn.
        state.firstSeen ??= {
          pages: pages.length,
          pagesDrawn: pages.filter(drawn).length,
          thumbs: thumbs.length,
          thumbsDrawn: thumbs.filter(drawn).length,
        };
        if (state.firstPageAt === null && pages.some(drawn)) state.firstPageAt = now;
        if (state.finishedAt === null && pages.length > 0 && thumbs.length > 0 && pages.every(drawn) && thumbs.every(drawn)) state.finishedAt = now;
      }
      w.requestAnimationFrame(tick);
    };
    w.requestAnimationFrame(tick);
    // WHEN THE VIEW MODEL FIRST ANSWERS for the document's first page — the read a page waits on before it draws
    // (`usePageRotations`), answered by `main` from the engine host, which no Chromium trace contains. One call in
    // flight at a time, through the bridge the page itself uses; diagnostic, and it adds that one call to what it times.
    if (o.probeModel) {
      void (async () => {
        while (state.running && state.modelAt === null) {
          if (state.docId !== null) {
            const asked = performance.now();
            const answer = await w.monstera.invoke('document.viewModel', { docId: state.docId, pages: [0] });
            state.modelCalls += 1;
            state.modelFirstAnswer ??= JSON.stringify(answer).slice(0, 160);
            if (answer?.ok === true) {
              state.modelAt = performance.now();
              state.modelAskedAt = asked;
            }
          }
          await new Promise((next) => setTimeout(next, 100));
        }
      })();
    }
    return state.start;
  }, options);
}

/**
 * Waits for the watch to reach quiet — finished, then a second with no long task — or `limitMs`, then reads it back as
 * milliseconds from its start.
 *
 * @param {any} page @param {number} limitMs
 */
async function settleWatch(page, limitMs) {
  const began = Date.now();
  /** @type {any} */
  let state;
  for (;;) {
    await page.waitForTimeout(250);
    state = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      return { ...w.__watch, now: performance.now() };
    });
    const lastLong = Math.max(0, ...state.longTasks.map((/** @type {[number, number]} */ t) => t[1]));
    if (state.finishedAt !== null && state.now - Math.max(state.finishedAt, lastLong) > 1100) break;
    if (Date.now() - began > limitMs) break;
  }
  await page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    w.__watch.running = false;
    w.__longTasks?.disconnect();
  });
  // QUIET: the first moment at or after the finish from which no long task overlaps the next second.
  /** @type {number | null} */
  let quietAt = null;
  if (typeof state.finishedAt === 'number') {
    let at = state.finishedAt;
    const tasks = [...state.longTasks].sort((/** @type {[number, number]} */ a, /** @type {[number, number]} */ b) => a[0] - b[0]);
    for (let moved = true; moved; ) {
      moved = false;
      for (const [from, to] of tasks) {
        if (to > at && from < at + 1000) {
          at = to;
          moved = true;
        }
      }
    }
    quietAt = at;
  }
  const since = (/** @type {number | null} */ at) => (at === null ? null : Math.round(at - state.start));
  const longest = Math.max(0, ...state.longTasks.map((/** @type {[number, number]} */ t) => t[1] - t[0]));
  return {
    docId: state.docId,
    tabMs: since(state.tabAt),
    firstPageMs: since(state.firstPageAt),
    finishedMs: since(state.finishedAt),
    quietMs: quietAt !== null && state.now - quietAt >= 1000 ? since(quietAt) : null,
    longTasks: state.longTasks.length,
    longestTaskMs: Math.round(longest),
    frames: state.frames,
    firstSeen: state.firstSeen,
    ...(state.modelCalls > 0
      ? { modelAnsweredMs: since(state.modelAt), modelAskedMs: since(state.modelAskedAt), modelCalls: state.modelCalls, modelFirstAnswer: state.modelFirstAnswer }
      : {}),
    timedOut: state.finishedAt === null,
  };
}

// ---------------------------------------------------------------------------------------------------------------

/** The owner's own Monstera processes, read before this run starts one: never the run's, never ended by it. */
const ownersBefore = build === 'installed' ? monsteraPids() : [];
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
  if (build === 'installed') {
    // THE PACKAGE STARTED THE PROGRAM, so its PID is the listener's — and it must be a Monstera process that did not
    // exist before this run, or the run would measure, and end, the owner's own window.
    const listener = listeners.length === 1 ? listeners[0] : undefined;
    if (listener === undefined || ownersBefore.includes(listener) || !monsteraPids().includes(listener)) {
      throw new Error(`the port answers from PID ${listeners.join(', ')}, which is not a Monstera process this run started`);
    }
    appPid = listener;
  } else {
    if (!listeners.includes(/** @type {number} */ (child.pid))) {
      throw new Error(`the port answers from PID ${listeners.join(', ')}, not the launched ${String(child.pid)} (exit code ${String(child.exitCode)})`);
    }
    appPid = child.pid;
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
  maximise(/** @type {number} */ (appPid));
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

  if ((scenarios.includes('open') || scenarios.includes('switch')) && secondPath !== undefined) {
    const first = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      return w.document.querySelector('[data-tab-select][aria-current="true"]')?.dataset.tabSelect ?? null;
    });
    if (first === null) throw new Error('no tab is current before the open, so the open cannot be told from it');
    // CONTROL: a watch for a tab that does not exist must time out with nothing seen, or "finished at once" — the answer
    // a kept background tab gives — would be indistinguishable from a predicate that holds of anything.
    await watchDocument(page, { target: 'no-such-document', previous: null, click: false });
    const nothing = await settleWatch(page, 3000);
    if (!nothing.timedOut || nothing.tabMs !== null || nothing.firstPageMs !== null) {
      throw new Error(`THE WATCH IS BLIND: a tab that does not exist read as ${JSON.stringify(nothing)}`);
    }
    // CONTROL, the other way: the document on show now must read as finished at once, or the watch cannot see a drawn one.
    await watchDocument(page, { target: first, previous: null, click: false });
    const shown = await settleWatch(page, 15_000);
    if (shown.finishedMs === null) throw new Error(`THE WATCH CANNOT SEE: the settled document on show never read as finished: ${JSON.stringify(shown)}`);
    results.push({ label: 'CONTROL the document on show', ...shown });
    // TRACED, so a slow open says which process was busy — or that none was, which is waiting.
    await startTrace(cdp);
    await page.evaluate(() => performance.mark('open:start'));
    await watchDocument(page, { target: null, previous: first, click: false, probeModel: process.argv.includes('--probe-model') });
    handOver(secondPath, userData);
    const opened = await settleWatch(page, 120_000);
    await page.evaluate(() => performance.mark('open:end'));
    const openTrace = await stopTrace(cdp);
    const keep = process.env['FRAMES_TRACE_DIR'];
    if (keep !== undefined) writeFileSync(join(keep, 'open.json'), JSON.stringify(openTrace));
    results.push({ label: 'open the second document', ...opened, busiest: busiestThreads(openTrace, 'open:start', 'open:end') });
    if (scenarios.includes('switch') && opened.docId !== null) {
      // EACH WAY THREE TIMES, the first document's tab first: the second is current after its open.
      for (let round = 0; round < 3; round += 1) {
        for (const [label, target] of /** @type {[string, string][]} */ ([['switch to the first document', first], ['switch to the second document', opened.docId]])) {
          await page.waitForTimeout(1500);
          // THE FIRST ROUND IS TRACED, so the work that follows a switch is split by kind on the renderer's main thread.
          const traced = round === 0;
          if (traced) {
            await startTrace(cdp);
            await page.evaluate(() => performance.mark('switch:start'));
          }
          await watchDocument(page, { target, previous: null, click: true });
          await page.locator(`[data-tab-select="${target}"]`).click();
          const switched = await settleWatch(page, 60_000);
          /** @type {any} */
          let trace = {};
          if (traced) {
            await page.evaluate(() => performance.mark('switch:end'));
            const events = await stopTrace(cdp);
            const keepDir = process.env['FRAMES_TRACE_DIR'];
            if (keepDir !== undefined) writeFileSync(join(keepDir, `${label.replace(/[^a-z0-9]+/giu, '-')}.json`), JSON.stringify(events));
            const split = analyse(events, 'switch:start', 'switch:end');
            trace = { main: split.main, mainBusy: split.mainBusy, windowMs: split.windowMs, topEvents: topEvents(events, 'switch:start', 'switch:end') };
          }
          results.push({ label, round: round + 1, ...switched, ...trace });
        }
      }
    }
  }

  console.log(JSON.stringify({ build, variant, large, screen, interval, results }, null, 1));
  await browser.close().catch(() => undefined);
} finally {
  await end(child, userData);
}
