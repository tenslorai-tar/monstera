import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type CDPSession, type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { installRenderCounter, startCounting, stopCounting } from './renderCounter.js';

/**
 * WHAT A PAGE LAYOUT SWITCH COSTS, measured: a research instrument for group U (ADR-0284's switch frames), run by hand
 * through `scripts/research/layoutSwitch.config.mjs`, never by the rendered suite (its name is not a `.pw.ts`). It
 * prints readings and no verdict.
 *
 * One window per switch, from the press on a View menu layout to 1.5 s after it, the menu already open, so what is
 * counted is the choice and what follows it. In each window:
 *
 * - **Chromium's own main-thread counts**, `Performance.getMetrics`' `ScriptDuration`, `LayoutDuration`,
 *   `RecalcStyleDuration` and `TaskDuration`, read before and after;
 * - **the script, function by function**, from a CPU profile sampled every 100 µs: self time per function, named on an
 *   UNMINIFIED renderer build (`vite build --minify false`), the application's own modules apart from PDF.js;
 * - **the browser's share** from a trace: the durations of `Layout`, `UpdateLayoutTree`, `PrePaint`, `Paint`,
 *   `Layerize`, `RasterTask` and the rest, summed by name;
 * - **pages redrawn against pages moved**: a redraw is a `drawImage` onto a canvas inside a page slot, which is how a
 *   finished page reaches the screen (`renderPage.ts`' present); a move is a slot whose box changed with no redraw;
 * - **React's renders**, by the shared render counter: page slots and the list;
 * - **frames over 16.7 ms**, from `requestAnimationFrame` intervals.
 *
 * THE RESOLUTION TEST runs first (`MONSTERA_SWITCH_RESOLUTION=1`): the same window over a re-choice of the layout already
 * on, once as it is and once with a named function, `deliberateWork`, holding the press 20 ms. The profile must name
 * that function at about 20 ms and the script count must rise by about as much; and a zoom step must count as redraws.
 *
 * WHAT IT FOUND ABOUT ITSELF (measured 2026-11-02, Chromium 151 on Linux): the script count and the trace see the hold
 * in every window; the profile names it at 19-20 ms in about two windows of three, and in the third files the same
 * 20 ms under `(program)`, at a 100 µs and at a 1 ms interval alike. So `(program)` is not only the browser's own work,
 * the browser's share is read from the trace's stage durations and never from that bucket, and a function's figure is
 * read over several rounds (`MONSTERA_SWITCH_ROUNDS`, 3 by default), never from one window.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f6');
const PAGES = 40;
const LINE = 'The quarterly figures were reconciled against the ledger and every account balanced to the cent, as before.';

/** The two fixtures: the scroll fixture's dense page (64 lines of 9-point text), and an ordinary page (one line, a box). */
async function fixture(kind: 'dense' | 'ordinary'): Promise<{ readonly bytes: Uint8Array; readonly lines: readonly (readonly string[])[] }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines: string[][] = [];
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    const own: string[] = [];
    if (kind === 'dense') {
      for (let line = 0; line < 64; line += 1) {
        const text = `${String(at + 1)}.${String(line + 1)} ${LINE}`;
        own.push(text);
        page.drawText(text, { x: 48, y: 760 - line * 11, size: 9, font, color: rgb(0, 0, 0) });
      }
    } else {
      const text = `Words of page ${String(at + 1)}`;
      own.push(text);
      page.drawText(text, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
      page.drawRectangle({ x: 200, y: 300, width: 200, height: 200, color: rgb(0.2, 0.3, 0.6) });
    }
    lines.push(own);
  }
  return { bytes: await document.save(), lines };
}

/** The four layouts, by the setting's value and the View menu item that chooses each. */
const LAYOUTS = [
  { value: 'continuous', item: 'Continuous' },
  { value: 'single', item: 'Single page' },
  { value: 'pair', item: 'Facing' },
  { value: 'facing', item: 'Continuous facing' },
] as const;

async function opened(page: Page, kind: 'dense' | 'ordinary', layout: string): Promise<void> {
  const { bytes, lines } = await fixture(kind);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: `${kind}.pdf` }],
    documentBytes: new Map([[DOC, bytes]]),
    pageLines: lines,
    settings: { 'viewing.page-layout': layout },
  });
  await installRenderCounter(page, { slot: '.m-page-list [data-page]', list: '.m-page-pane' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

/** One window's readings. */
interface Reading {
  readonly script: number;
  readonly layout: number;
  readonly style: number;
  readonly task: number;
  readonly functions: readonly (readonly [string, number])[];
  /** The time in `getBoundingClientRect`, by the function that called it. */
  readonly forcedBy: readonly (readonly [string, number])[];
  /** Time INCLUDING callees, by function name: a function's own time is split with every native it calls. */
  readonly inclusive: (name: string) => number;
  readonly where: Readonly<Record<string, number>>;
  readonly browser: Readonly<Record<string, number>>;
  readonly redrawn: number;
  readonly moved: number;
  readonly slotRenders: number;
  readonly listRenders: number;
  readonly longFrames: number;
  readonly longest: number;
  /** The profile's own span and sample count: a window whose profile does not cover it is not a reading. */
  readonly profiled: { readonly spanMs: number; readonly samples: number };
}

const METRICS = ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'] as const;

async function metrics(session: CDPSession): Promise<Record<string, number>> {
  const { metrics: all } = await session.send('Performance.getMetrics');
  return Object.fromEntries(all.filter((each) => (METRICS as readonly string[]).includes(each.name)).map((each) => [each.name, each.value * 1000]));
}

/** What a trace event's name is counted as: the browser's own stages, by the names Chromium gives them. */
const BROWSER_STAGES = new Set([
  'Layout',
  'UpdateLayoutTree',
  'PrePaint',
  'Paint',
  'PaintImage',
  'Layerize',
  'UpdateLayer',
  'CompositeLayers',
  'Commit',
  'RasterTask',
  'GPUTask',
  'Decode Image',
  'ImageDecodeTask',
  'HitTest',
  'ScrollLayer',
]);

/**
 * Measures one window: the press on `item` (the menu already open) and 1.5 s after it. `hold` holds the press that many
 * milliseconds in a function named `deliberateWork`, for the resolution test; `zoom` presses Zoom in instead of a layout.
 */
/** ONE CDP SESSION A PAGE, kept across its windows, so the profiler is started and stopped in the session it lives in. */
const SESSIONS = new WeakMap<Page, CDPSession>();

async function sessionOf(page: Page): Promise<CDPSession> {
  const known = SESSIONS.get(page);
  if (known !== undefined) return known;
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: Number(process.env['MONSTERA_SWITCH_INTERVAL_US'] ?? '100') });
  SESSIONS.set(page, session);
  return session;
}

async function measured(
  page: Page,
  item: string,
  options: { readonly hold?: number; readonly zoom?: boolean; readonly traced?: boolean } = {},
): Promise<Reading> {
  const session = await sessionOf(page);
  const tracing = options.traced !== false;
  if (options.zoom !== true) {
    await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.waitForTimeout(300);
  }
  await page.evaluate((hold) => {
    const record = window as unknown as {
      switchWatch?: { gaps: number[]; redrawn: Set<string>; boxes: Map<string, string>; generation: number };
    };
    const generation = (record.switchWatch?.generation ?? 0) + 1;
    const boxes = new Map<string, string>();
    for (const slot of document.querySelectorAll<HTMLElement>('.m-page-slot')) {
      const box = slot.getBoundingClientRect();
      boxes.set(slot.dataset['page'] ?? '?', `${String(Math.round(box.left))},${String(Math.round(box.top))},${String(Math.round(box.width))}`);
    }
    const watch = { gaps: [] as number[], redrawn: new Set<string>(), boxes, generation };
    record.switchWatch = watch;
    // THE PLATFORM'S OWN DRAW, kept once a page and wrapped: a property typed as a function taking its `this`, so the
    // wrapper calls it with the canvas it was called on.
    type Draw = (this: CanvasRenderingContext2D, ...rest: unknown[]) => void;
    const prototype = CanvasRenderingContext2D.prototype as unknown as { drawImage: Draw; __measuredDraw?: Draw };
    prototype.__measuredDraw ??= prototype.drawImage;
    const kept = prototype.__measuredDraw;
    prototype.drawImage = function counted(this: CanvasRenderingContext2D, ...args: unknown[]): void {
      const slot = this.canvas.closest<HTMLElement>('.m-page-slot');
      if (slot !== null && record.switchWatch === watch) watch.redrawn.add(slot.dataset['page'] ?? '?');
      kept.apply(this, args);
    };
    if (hold > 0) {
      window.addEventListener(
        'pointerdown',
        function deliberateWork(event: Event) {
          (window as unknown as { heldOn?: string }).heldOn = `${event.type} on ${(event.target as Element | null)?.textContent.slice(0, 30) ?? '?'}`;
          // HELD ON PURPOSE: the resolution test's known cost, under a name the profile must find. Arithmetic, reading the
          // clock only every few thousand steps: a loop of nothing but `performance.now()` is mostly time in that
          // native, and the sampler lost the frames above it in about one window of three, filing 11 ms under an
          // unparented `now` (measured 2026-11-02).
          const until = performance.now() + hold;
          let sum = 0;
          for (let step = 0; ; step += 1) {
            sum += Math.sqrt(step);
            if (step % 4096 === 0 && performance.now() >= until) break;
          }
          (window as unknown as { heldSum?: number }).heldSum = sum;
        },
        { capture: true, once: true },
      );
    }
  }, options.hold ?? 0);

  const events: { name: string; dur?: number }[] = [];
  const collect = ({ value }: { value: object[] }): void => {
    for (const event of value as { name: string; dur?: number }[]) events.push(event);
  };
  session.on('Tracing.dataCollected', collect);
  if (tracing) {
    await session.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents',
    });
  }
  await startCounting(page);
  const before = await metrics(session);
  await session.send('Profiler.start');
  // THE FRAME WATCH STARTS NOW, after the profiler and the trace are running and a frame has passed: started before
  // them, its first interval timed their own start, 183-233 ms in every window including the control (first pass,
  // 2026-11-02).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const record = window as unknown as { switchWatch: { gaps: number[] } };
        const watch = record.switchWatch;
        requestAnimationFrame((first) => {
          let last = first;
          const tick = (now: number): void => {
            if (record.switchWatch !== watch) return;
            watch.gaps.push(now - last);
            last = now;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          resolve();
        });
      }),
  );

  if (options.zoom === true) await page.keyboard.press('Control+Equal');
  else await page.getByRole('menuitemcheckbox', { name: item, exact: true }).click();
  await page.waitForTimeout(1500);

  const { profile } = await session.send('Profiler.stop');
  const after = await metrics(session);
  const counts = await stopCounting(page);
  if (tracing) {
    const traced = new Promise<void>((resolve) => {
      session.once('Tracing.tracingComplete', () => {
        resolve();
      });
    });
    await session.send('Tracing.end');
    await traced;
  }
  session.off('Tracing.dataCollected', collect);

  const watched = await page.evaluate(() => {
    const record = window as unknown as {
      switchWatch: { gaps: number[]; redrawn: Set<string>; boxes: Map<string, string>; generation: number };
    };
    const watch = record.switchWatch;
    record.switchWatch = { ...watch, generation: watch.generation + 1 };
    let moved = 0;
    for (const slot of document.querySelectorAll<HTMLElement>('.m-page-slot')) {
      const page = slot.dataset['page'] ?? '?';
      const box = slot.getBoundingClientRect();
      const now = `${String(Math.round(box.left))},${String(Math.round(box.top))},${String(Math.round(box.width))}`;
      if (watch.boxes.get(page) !== now && !watch.redrawn.has(page) && box.width > 0) moved += 1;
    }
    return { gaps: watch.gaps, redrawn: watch.redrawn.size, moved };
  });

  // SELF TIME BY FUNCTION, and by where it lives: the application's modules, PDF.js, and the engine's own buckets.
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentOf = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);
  const inclusiveTime = new Map<string, number>();
  for (const [at, id] of (profile.samples ?? []).entries()) {
    const ms = (profile.timeDeltas?.[at] ?? 0) / 1000;
    const seen = new Set<string>();
    for (let walk: number | undefined = id; walk !== undefined; walk = parentOf.get(walk)) {
      const name = nodes.get(walk)?.callFrame.functionName ?? '';
      if (name === '' || seen.has(name)) continue;
      seen.add(name);
      inclusiveTime.set(name, (inclusiveTime.get(name) ?? 0) + ms);
    }
  }
  // WHO FORCES A LAYOUT: the time inside `getBoundingClientRect`, by the script function that called it, since the
  // native alone names no caller and the switch's largest single native is that read.
  const forced = new Map<string, number>();
  for (const [at, id] of (profile.samples ?? []).entries()) {
    const leaf = nodes.get(id);
    if (leaf?.callFrame.functionName !== 'getBoundingClientRect') continue;
    const parent = nodes.get(parentOf.get(id) ?? -1);
    const caller = parent === undefined ? '?' : `${parent.callFrame.functionName || '(anonymous)'} ${parent.callFrame.url.split('/').at(-1) ?? ''}:${String(parent.callFrame.lineNumber + 1)}`;
    forced.set(caller, (forced.get(caller) ?? 0) + (profile.timeDeltas?.[at] ?? 0) / 1000);
  }
  const self = new Map<string, number>();
  const where: Record<string, number> = {};
  for (const [at, id] of (profile.samples ?? []).entries()) {
    const node = nodes.get(id);
    if (node === undefined) continue;
    const ms = (profile.timeDeltas?.[at] ?? 0) / 1000;
    const url = node.callFrame.url;
    const file = url.split('/').at(-1) ?? '';
    const name = node.callFrame.functionName || '(anonymous)';
    // THE ENGINE'S OWN BUCKETS are the parenthesised names, `(program)`, `(garbage collector)`, `(idle)`, `(root)`;
    // everything else is script, and a script with no URL is one a test evaluated, which is where the resolution test's
    // named function lives. Keying the buckets on a missing URL instead hid that function from the profile.
    const engine = name.startsWith('(') && name.endsWith(')') && url === '';
    const bucket = engine ? name : url === '' ? 'evaluated by the measurement' : /pdf(\.worker)?[.-]/u.test(file) ? 'PDF.js' : 'application';
    where[bucket] = (where[bucket] ?? 0) + ms;
    if (engine) continue;
    const key = `${name} ${file}:${String(node.callFrame.lineNumber + 1)}`;
    self.set(key, (self.get(key) ?? 0) + ms);
  }
  const browser: Record<string, number> = {};
  for (const event of events) {
    if (!BROWSER_STAGES.has(event.name) || event.dur === undefined) continue;
    browser[event.name] = (browser[event.name] ?? 0) + event.dur / 1000;
  }
  let slotRenders = 0;
  let listRenders = 0;
  // THE COUNTER'S TOTALS, not its outer object: reading `counts` itself counted nothing, and every window read zero
  // renders, which is the reassuring answer and was wrong (found by the first pass, 2026-11-02).
  for (const [key, value] of Object.entries(counts.totals)) {
    if (key.includes('#')) continue;
    if (key.startsWith('slot@')) slotRenders += value;
    if (key.startsWith('list@')) listRenders += value;
  }
  return {
    script: (after['ScriptDuration'] ?? 0) - (before['ScriptDuration'] ?? 0),
    layout: (after['LayoutDuration'] ?? 0) - (before['LayoutDuration'] ?? 0),
    style: (after['RecalcStyleDuration'] ?? 0) - (before['RecalcStyleDuration'] ?? 0),
    task: (after['TaskDuration'] ?? 0) - (before['TaskDuration'] ?? 0),
    // EVERY FUNCTION OVER 0.1 ms, not a top few: which functions make a window's top changes from window to window, so a
    // fixed cut leaves a function out of most windows, and a summary over rounds then reads it as nearly nothing.
    functions: [...self.entries()].filter(([, ms]) => ms >= 0.1).sort((a, b) => b[1] - a[1]),
    inclusive: (name) => inclusiveTime.get(name) ?? 0,
    forcedBy: [...forced.entries()].sort((a, b) => b[1] - a[1]),
    where,
    browser,
    redrawn: watched.redrawn,
    moved: watched.moved,
    slotRenders,
    listRenders,
    longFrames: watched.gaps.filter((gap) => gap > 17.5).length,
    longest: Math.max(0, ...watched.gaps),
    profiled: { spanMs: (profile.endTime - profile.startTime) / 1000, samples: profile.samples?.length ?? 0 },
  };
}

/** The script the profile sampled: everything but the engine's own buckets. */
function sampledScript(reading: Reading): number {
  return Object.entries(reading.where)
    .filter(([name]) => !name.startsWith('('))
    .reduce((sum, [, ms]) => sum + ms, 0);
}

function printed(label: string, reading: Reading): string {
  const round = (value: number): string => value.toFixed(1);
  const browser = Object.entries(reading.browser)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `${name} ${round(ms)}`)
    .join(', ');
  const where = Object.entries(reading.where)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => `${name} ${round(ms)}`)
    .join(', ');
  return [
    `SWITCH ${label}: script ${round(reading.script)} ms, layout ${round(reading.layout)}, style ${round(reading.style)}, all tasks ${round(reading.task)}; frames over 16.7 ms ${String(reading.longFrames)}, longest ${round(reading.longest)}; pages redrawn ${String(reading.redrawn)}, moved ${String(reading.moved)}; slot renders ${String(reading.slotRenders)}, list renders ${String(reading.listRenders)}`,
    `  samples by where: ${where}`,
    `  browser stages (ms): ${browser}`,
    `  getBoundingClientRect by caller: ${reading.forcedBy.map(([name, ms]) => `${name} ${round(ms)}`).join(' | ')}`,
    ...reading.functions.map(([name, ms]) => `  ${round(ms).padStart(7)} ms  ${name}`),
  ].join('\n');
}

// A MEASUREMENT OPENS THE DOCUMENT ONCE A WINDOW, twelve times a test at three rounds, which is far past the suite's
// thirty seconds. Hand-run only, so the long allowance cannot hide a slow case in the suite.
test.describe.configure({ mode: 'serial', timeout: 900_000 });

test('THE RESOLUTION TEST: a 20 ms hold under a known name is seen, and a zoom step counts as redraws', async ({ page }) => {
  test.skip(process.env['MONSTERA_SWITCH_RESOLUTION'] !== '1', 'run by hand: MONSTERA_SWITCH_RESOLUTION=1');
  await opened(page, 'ordinary', 'continuous');
  for (let round = 0; round < 3; round += 1) {
    const plain = await measured(page, 'Continuous');
    await page.evaluate(() => {
      (window as unknown as { heldOn?: string }).heldOn = 'not run';
    });
    const held = await measured(page, 'Continuous', { hold: 20 });
    console.log(`RESOLUTION round ${String(round)}: the hold ran: ${await page.evaluate(() => (window as unknown as { heldOn?: string }).heldOn ?? '?')}`);
    console.log(
      `RESOLUTION round ${String(round)}: profile spans ${held.profiled.spanMs.toFixed(0)} ms in ${String(held.profiled.samples)} samples; ` +
        `(program) ${(held.where['(program)'] ?? 0).toFixed(1)} ms held, ${(plain.where['(program)'] ?? 0).toFixed(1)} ms plain`,
    );
    const named = held.inclusive('deliberateWork');
    console.log(
      `RESOLUTION round ${String(round)}: script ${plain.script.toFixed(1)} ms plain, ${held.script.toFixed(1)} ms held; ` +
        `deliberateWork ${named.toFixed(1)} ms in the profile with its callees, ${plain.inclusive('deliberateWork').toFixed(1)} ms in the plain window; ` +
        `sampled script ${sampledScript(plain).toFixed(1)} plain, ${sampledScript(held).toFixed(1)} held`,
    );
  }
  const zoomed = await measured(page, '', { zoom: true });
  console.log(`RESOLUTION zoom step: pages redrawn ${String(zoomed.redrawn)}, moved ${String(zoomed.moved)}`);
});

for (const kind of ['ordinary', 'dense'] as const) {
  for (const from of LAYOUTS) {
    test(`${kind}: from ${from.item} to each other layout, and to itself as the control`, async ({ browser, baseURL }) => {
      test.skip(process.env['MONSTERA_SWITCH_MEASURE'] !== '1', 'run by hand: MONSTERA_SWITCH_MEASURE=1');
      const rounds = Number(process.env['MONSTERA_SWITCH_ROUNDS'] ?? '3');
      for (let round = 0; round < rounds; round += 1) {
        for (const to of LAYOUTS) {
          // A FRESH PAGE A WINDOW: the shim's bridge registers its function once a page, and each window opens the
          // document from the layout it switches from.
          const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
          const page = await context.newPage();
          try {
            await opened(page, kind, from.value);
            const label = `${kind} ${from.item} -> ${to.item}${to.value === from.value ? ' (CONTROL: the same layout)' : ''} round ${String(round)}`;
            console.log(printed(label, await measured(page, to.item)));
          } finally {
            await context.close();
          }
        }
      }
    });
  }
}
