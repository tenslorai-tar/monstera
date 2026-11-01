import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Browser, type CDPSession, type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * WHAT A TEXT SELECTION COSTS THE MAIN THREAD, two bundles against each other in one browser session: a research
 * instrument, run by hand through `scripts/research/shellRenders.config.mjs`, never by the rendered suite (its name is
 * not a `.pw.ts`). It prints readings and no verdict.
 *
 * The bundles are two directories of a built renderer, each served on its own port by the configuration: today's
 * (`MONSTERA_BUNDLE_A`) and the one under test (`MONSTERA_BUNDLE_B`). The rounds alternate A, B, A, B on one browser,
 * each in a fresh page, so a machine that slows over the run slows both.
 *
 * Each round opens a dense page (56 lines of 96 letters) and runs select-and-clear cycles over it: the whole of the
 * page's text layer selected, three frames, the selection removed, three frames. Three readings per cycle:
 *
 * - **the longest task**: Chromium's own `RunTask` events on the page's main thread, from a trace of the round (the
 *   `devtools.timeline` categories), each one a task the browser ran; a task over 16.7 ms is a frame missed;
 * - **the work**: `Performance.getMetrics`' script, layout and style durations, before and after the cycle;
 * - **the longest frame**: the interval between animation frames, recorded in the page.
 *
 * ## The instrument's control
 *
 * On today's bundle a selection renders the shell, which the owner measured at about 56 ms per cycle with a 66.6 ms
 * frame. A reading of A that shows no task near that cannot vouch for B's, so A's longest task is printed first and is
 * the control: if it is under 16.7 ms the trace is not seeing the work, and the run says so.
 */

const LINES = 56;
const CYCLES = 5;
const ROUNDS = Number(process.env['MONSTERA_ROUNDS'] ?? '6');
const WORDS = ['agreement', 'party', 'notice', 'term', 'clause', 'shall', 'the', 'of', 'any', 'such', 'provided', 'that'];
const BUNDLES = [
  { name: 'A', url: 'http://localhost:4180/' },
  { name: 'B', url: 'http://localhost:4181/' },
] as const;

function lineText(line: number): string {
  let text = '';
  let at = line * 7;
  while (text.length < 96) {
    text += `${WORDS[at % WORDS.length] ?? 'word'} `;
    at += 5;
  }
  return text.slice(0, 96);
}

async function densePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const sheet = document.addPage([612, 792]);
  for (let line = 0; line < LINES; line += 1) sheet.drawText(lineText(line), { x: 54, y: 744 - line * 12.6, size: 10, font });
  return document.save();
}

async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let left = n;
        const next = (): void => {
          left -= 1;
          if (left <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

async function work(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const of = (name: string): number => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
  return of('ScriptDuration') + of('LayoutDuration') + of('RecalcStyleDuration');
}

interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly dur?: number;
  readonly args?: { readonly name?: string };
}

/** The durations, in ms, of every task the page's main thread ran in the trace: the renderer whose main thread ran most. */
function mainThreadTasks(trace: Buffer): number[] {
  const parsed = JSON.parse(trace.toString('utf8')) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const mains = new Set(events.filter((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain').map((event) => `${String(event.pid)}:${String(event.tid)}`));
  const byThread = new Map<string, number[]>();
  for (const event of events) {
    const thread = `${String(event.pid)}:${String(event.tid)}`;
    if (event.name !== 'RunTask' || event.ph !== 'X' || event.dur === undefined || !mains.has(thread)) continue;
    const list = byThread.get(thread) ?? [];
    list.push(event.dur / 1000);
    byThread.set(thread, list);
  }
  const busiest = [...byThread.values()].sort((a, b) => b.reduce((s, x) => s + x, 0) - a.reduce((s, x) => s + x, 0))[0];
  // AN EMPTY TASK LIST IS A BROKEN TRACE, not an idle page (CLAUDE.md item 4b).
  if (busiest === undefined || busiest.length === 0) throw new Error('the trace held no main-thread task: it is not reading the page');
  return busiest;
}

interface Round {
  readonly bundle: string;
  readonly longestTask: number;
  readonly over: number;
  readonly work: readonly number[];
  readonly longestFrame: number;
}

async function round(browser: Browser, page: Page, url: string, name: string, bytes: Uint8Array): Promise<Round> {
  await page.setViewportSize({ width: 1280, height: 900 });
  const docId = asDocId('00000000-0000-4000-8000-0000000000fa');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'dense.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    viewModels: [{ pageCount: 1, rotations: [0] }],
    pageLines: [Array.from({ length: LINES }, (_, line) => lineText(line))],
  });
  await page.addInitScript(() => {
    const intervals: number[] = [];
    (globalThis as unknown as { __frames: number[] }).__frames = intervals;
    let last = 0;
    const tick = (now: number): void => {
      if (last > 0) intervals.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES);
  await pageShown(page);
  // WARM: one cycle unmeasured, so a first selection's code loading is not in the readings.
  await cycle(page);
  await page.evaluate(() => ((globalThis as unknown as { __frames: number[] }).__frames.length = 0));
  const costs: number[] = [];
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  for (let at = 0; at < CYCLES; at += 1) {
    const before = await work(cdp);
    await cycle(page);
    costs.push((await work(cdp)) - before);
  }
  const tasks = mainThreadTasks(await browser.stopTracing());
  const intervals = await page.evaluate(() => (globalThis as unknown as { __frames: number[] }).__frames);
  await cdp.detach();
  return {
    bundle: name,
    longestTask: Math.max(...tasks),
    over: tasks.filter((each) => each > 16.7).length,
    work: costs,
    longestFrame: Math.max(...intervals),
  };
}

/** The page's whole text layer selected, three frames, the selection removed, three frames. */
async function cycle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const layer = document.querySelector('[data-text-layer="0"]');
    if (layer === null) throw new Error('no text layer');
    document.getSelection()?.selectAllChildren(layer);
  });
  await frames(page, 3);
  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
  });
  await frames(page, 3);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

test.setTimeout(900_000);

test('a select-and-clear cycle, bundle A against bundle B, alternating', async ({ browser }) => {
  const bytes = await densePdf();
  const rounds: Round[] = [];
  for (let at = 0; at < ROUNDS; at += 1) {
    for (const bundle of BUNDLES) {
      const page = await browser.newPage();
      try {
        rounds.push(await round(browser, page, bundle.url, bundle.name, bytes));
      } finally {
        await page.close();
      }
      const last = rounds.at(-1);
      if (last !== undefined) {
        console.log(`round ${String(at + 1)} ${last.bundle}: longest task ${last.longestTask.toFixed(1)} ms, ${String(last.over)} over 16.7 ms; work per cycle median ${median(last.work).toFixed(1)} ms (${last.work.map((each) => each.toFixed(1)).join(', ')}); longest frame ${last.longestFrame.toFixed(1)} ms`);
      }
    }
  }
  for (const bundle of BUNDLES) {
    const mine = rounds.filter((each) => each.bundle === bundle.name);
    const medians = mine.map((each) => median(each.work));
    console.log(
      `${bundle.name}: round medians ${medians.map((each) => each.toFixed(1)).join(', ')}; median ${median(medians).toFixed(1)}, range ${Math.min(...medians).toFixed(1)} to ${Math.max(...medians).toFixed(1)}; longest task ${Math.max(...mine.map((each) => each.longestTask)).toFixed(1)} ms; tasks over 16.7 ms ${String(mine.reduce((sum, each) => sum + each.over, 0))}; longest frame ${Math.max(...mine.map((each) => each.longestFrame)).toFixed(1)} ms`,
    );
  }
  const control = rounds.filter((each) => each.bundle === 'A');
  if (Math.max(...control.map((each) => each.longestTask)) < 16.7) console.log('CONTROL FAILED: bundle A shows no task over 16.7 ms, so this trace cannot vouch for B');
});
