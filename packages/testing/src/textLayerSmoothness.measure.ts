import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type CDPSession, type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * WHAT THE TEXT LAYER COSTS THE MAIN THREAD, measured, for ADR-0280's build against today's: a research instrument, run
 * by hand through `scripts/research/textLayerSmoothness.config.mjs`, never by the rendered suite (its name is not a
 * `.pw.ts`). It prints readings and no verdict.
 *
 * The cost is Chromium's own count of main-thread work, `Performance.getMetrics`' `ScriptDuration`, `LayoutDuration` and
 * `RecalcStyleDuration`, read before and after each event, so what is counted is everything the page did for it — the
 * application's script, the layout it forced and the style it recalculated — and not a timer a listener holds.
 *
 * **It does not count paint, compositing, raster or the GPU process.** So the browser's own selection highlight, which
 * Chromium paints, costs today's build nothing here, while the build's highlight, drawn by script, is counted: a
 * comparison of the two leans against the build. `scripts/research/frameTimes.mjs`' `select` scenario reads a trace and
 * counts every thread. Three
 * readings, each repeated and printed as its spread:
 *
 * - **a page arriving**: a long document opened cold and scrolled one page at a time, each page's text layer waited for,
 *   and the work between the scroll and two frames after its lines are in;
 * - **a dense page's whole selection**: every line of a page selected at once, and the work up to two frames later;
 * - **a growing drag**: a drag down a dense page, one pointer move a frame, and the work of each.
 *
 * Every frame's interval is recorded beside the arrivals, so a frame over 16.7 ms is counted where it happened.
 *
 * The page is dense on purpose: 56 lines of 96 letters, each line's letters stated as the engine reads them, which is
 * the shape whose cost grows with the letters.
 */

const PAGES = 12;
const LINES = 56;
const SIZE = 10;
const WIDTH = 612;
const HEIGHT = 792;
const WORDS = ['agreement', 'party', 'notice', 'term', 'clause', 'shall', 'the', 'of', 'any', 'such', 'provided', 'that'];

function lineText(page: number, line: number): string {
  let text = '';
  let at = page * 31 + line * 7;
  while (text.length < 96) {
    text += `${WORDS[at % WORDS.length] ?? 'word'} `;
    at += 5;
  }
  return text.slice(0, 96);
}

async function densePdf(): Promise<{ bytes: Uint8Array; placed: unknown[][] }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const placed: unknown[][] = [];
  for (let page = 0; page < PAGES; page += 1) {
    const sheet = document.addPage([WIDTH, HEIGHT]);
    const lines: unknown[] = [];
    for (let line = 0; line < LINES; line += 1) {
      const text = lineText(page, line);
      const baseline = HEIGHT - 48 - line * 12.6;
      sheet.drawText(text, { x: 54, y: baseline, size: SIZE, font });
      // ONE ADVANCE PER UTF-16 UNIT, as the channel carries them; the text is ASCII words, so a unit is a letter.
      const advances = Array.from({ length: text.length }, (_, at) => Math.round(font.widthOfTextAtSize(text.charAt(at), SIZE) * 100));
      const length = advances.reduce((sum, each) => sum + each, 0) / 100;
      lines.push({
        text,
        box: { x0: 54, y0: HEIGHT - baseline - 8.9, x1: 54 + length, y1: HEIGHT - baseline + 2.2 },
        letters: { origin: { x: 54, y: HEIGHT - baseline }, direction: { x: 1, y: 0 }, size: SIZE, advances },
      });
    }
    placed.push(lines);
  }
  return { bytes: await document.save(), placed };
}

/** Milliseconds of main-thread work Chromium has counted so far, and its three parts. */
const PARTS: Record<string, number[]> = { script: [], layout: [], style: [] };
let last: Record<string, number> = {};
async function work(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const of = (name: string): number => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000;
  const now = { script: of('ScriptDuration'), layout: of('LayoutDuration'), style: of('RecalcStyleDuration') };
  last = now;
  return now.script + now.layout + now.style;
}
/** The three parts of the work since `from`, kept for {@link PARTS}. */
function partsSince(from: Record<string, number>): void {
  for (const key of Object.keys(PARTS)) PARTS[key]?.push((last[key] ?? 0) - (from[key] ?? 0));
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

function spread(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  const show = (value: number): string => value.toFixed(3);
  return `n=${String(sorted.length)} min=${show(sorted[0] ?? NaN)} median=${show(at(0.5))} p90=${show(at(0.9))} max=${show(sorted.at(-1) ?? NaN)}`;
}

async function open(page: Page): Promise<CDPSession> {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { bytes, placed } = await densePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f9');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'dense.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    viewModels: [{ pageCount: PAGES, rotations: Array.from({ length: PAGES }, () => 0) }],
    pageLinesPlaced: placed as never,
  });
  // EVERY FRAME'S INTERVAL from the moment the document exists, for the frames over 16.7 ms.
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
  await page.goto('/');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES);
  await pageShown(page);
  return cdp;
}

test.setTimeout(600_000);

test('a page arriving, cold', async ({ page }) => {
  const cdp = await open(page);
  const costs: number[] = [];
  const longFrames: number[] = [];
  for (let index = 1; index < PAGES; index += 1) {
    await page.evaluate(() => ((globalThis as unknown as { __frames: number[] }).__frames.length = 0));
    const before = await work(cdp);
    // ONE PAGE DOWN by the wheel over the page, as a reader scrolls, until this page's text layer has its lines.
    const lines = page.locator(`[data-text-layer="${String(index)}"] [data-text-line]`);
    for (let turn = 0; turn < 40 && (await lines.count()) < LINES; turn += 1) {
      await page.mouse.move(640, 450);
      await page.mouse.wheel(0, 260);
      await frames(page, 2);
    }
    // A PAGE THE SCROLL DID NOT BRING IN is reported, not waited for: the readings are the arrivals there were.
    if ((await lines.count()) < LINES) {
      console.log(`ARRIVAL page ${String(index)} did not arrive within 40 turns of the wheel`);
      break;
    }
    await frames(page, 2);
    costs.push((await work(cdp)) - before);
    longFrames.push(...(await page.evaluate(() => (globalThis as unknown as { __frames: number[] }).__frames.filter((each) => each > 16.7))));
  }
  console.log(`ARRIVAL work per page (ms): ${spread(costs)}`);
  console.log(`ARRIVAL frames over 16.7 ms: ${String(longFrames.length)} [${longFrames.map((each) => each.toFixed(1)).join(', ')}]`);
});

test('a dense page’s whole selection', async ({ page }) => {
  const cdp = await open(page);
  const costs: number[] = [];
  // THE CONTROL: the same steps changing nothing, which is the instrument's own cost — its calls and its frame waits.
  const idle: number[] = [];
  for (let round = 0; round < 30; round += 1) {
    const still = await work(cdp);
    await page.evaluate(() => document.getSelection()?.rangeCount ?? 0);
    await frames(page, 2);
    idle.push((await work(cdp)) - still);
    const before = await work(cdp);
    await page.evaluate((last) => {
      const first = document.querySelector('[data-text-layer="0"] [data-text-line="0"]')?.firstChild;
      const end = document.querySelector(`[data-text-layer="0"] [data-text-line="${String(last)}"]`)?.firstChild;
      if (!(first instanceof Text) || !(end instanceof Text)) throw new Error('no lines');
      document.getSelection()?.setBaseAndExtent(first, 0, end, end.length);
    }, LINES - 1);
    await frames(page, 2);
    costs.push((await work(cdp)) - before);
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    await frames(page, 2);
  }
  console.log(`WHOLE PAGE SELECTED work (ms): ${spread(costs)}`);
  console.log(`WHOLE PAGE CONTROL, nothing changed (ms): ${spread(idle)}`);
});

test('where a whole page’s selection spends its script', async ({ page }) => {
  const cdp = await open(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  for (let round = 0; round < 30; round += 1) {
    await page.evaluate((lastLine) => {
      const first = document.querySelector('[data-text-layer="0"] [data-text-line="0"]')?.firstChild;
      const end = document.querySelector(`[data-text-layer="0"] [data-text-line="${String(lastLine)}"]`)?.firstChild;
      if (!(first instanceof Text) || !(end instanceof Text)) throw new Error('no lines');
      document.getSelection()?.setBaseAndExtent(first, 0, end, end.length);
    }, LINES - 1);
    await frames(page, 2);
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    await frames(page, 2);
  }
  const { profile } = await cdp.send('Profiler.stop');
  // SELF TIME per function, from the samples: each sample's node, times the interval between samples.
  const self = new Map<number, number>();
  const deltas = profile.timeDeltas ?? [];
  (profile.samples ?? []).forEach((node, at) => self.set(node, (self.get(node) ?? 0) + (deltas[at] ?? 0) / 1000));
  const named = new Map<string, number>();
  for (const node of profile.nodes) {
    const frame = node.callFrame;
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1) ?? ''}:${String(frame.lineNumber)}:${String(frame.columnNumber)}`;
    named.set(key, (named.get(key) ?? 0) + (self.get(node.id) ?? 0));
  }
  const top = [...named.entries()].filter(([key]) => !key.startsWith('(idle)') && !key.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [key, ms] of top) console.log(`PROFILE ${ms.toFixed(2)} ms ${key}`);
});

test('a growing drag', async ({ page }) => {
  const cdp = await open(page);
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no layer');
  const k = layer.width / WIDTH;
  const xOf = (x: number): number => layer.x + x * k;
  const yOf = (line: number): number => layer.y + (48 + line * 12.6 - 3) * k;
  const costs: number[] = [];
  // THE CONTROL: the same moves with no button held, which select nothing.
  const hover: number[] = [];
  for (let step = 0; step < 40; step += 1) {
    const before = await work(cdp);
    await page.mouse.move(xOf(80 + (step % 4) * 90), Math.min(yOf(1 + Math.floor(step / 4)), layer.y + layer.height - 4));
    await frames(page, 1);
    hover.push((await work(cdp)) - before);
  }
  for (let round = 0; round < 3; round += 1) {
    await page.mouse.move(xOf(60), yOf(1));
    await page.mouse.down();
    for (let step = 0; step < 40; step += 1) {
      const line = 1 + Math.floor(step / 4);
      const before = await work(cdp);
      const from = last;
      await page.mouse.move(xOf(80 + (step % 4) * 90), Math.min(yOf(line), layer.y + layer.height - 4));
      await frames(page, 1);
      costs.push((await work(cdp)) - before);
      partsSince(from);
    }
    await page.mouse.up();
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    await frames(page, 2);
  }
  console.log(`DRAG work per move (ms): ${spread(costs)}`);
  console.log(`DRAG CONTROL, the same moves with no button (ms): ${spread(hover)}`);
  for (const [key, values] of Object.entries(PARTS)) console.log(`DRAG ${key} per move (ms): ${spread(values)}`);
});
