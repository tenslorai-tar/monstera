import { StandardFonts, PDFDocument, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { installRenderCounter, pagesRendered, rendersOf, startCounting, stopCounting } from './renderCounter.js';

/**
 * A long document scrolled from cold: what React renders as each page arrives, and the frames it costs (item 61).
 *
 * The local agent's reading on Windows (2026-11-01, main at d1147537): a 37-page cold scroll through a 300-page dense
 * document gave about 140 frames over 33 ms and a worst frame of 100 to 117 ms, about 135 ms of React work for each page
 * that arrived. The fixture here is generated (300 pages of dense text, the shim's text layer holding the same lines),
 * so nothing a person wrote is read.
 *
 * The render cases hold the class shut. The frame reading runs only when asked (`MONSTERA_SCROLL_ROUNDS`), since a frame
 * time is a measurement of a machine and not a property CI can hold a build to.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f1');
const PAGES = 300;
const LINES = 64;
const LINE = 'The quarterly figures were reconciled against the ledger and every account balanced to the cent, as before.';

/** 300 Letter pages of 64 lines of 9-point text each, and the same lines as the shim's text layer. */
async function densePages(): Promise<{ readonly bytes: Uint8Array; readonly lines: readonly (readonly string[])[] }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines: string[][] = [];
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    const own: string[] = [];
    for (let line = 0; line < LINES; line += 1) {
      const text = `${String(at + 1)}.${String(line + 1)} ${LINE}`;
      own.push(text);
      page.drawText(text, { x: 48, y: 760 - line * 11, size: 9, font, color: rgb(0, 0, 0) });
    }
    lines.push(own);
  }
  return { bytes: await document.save(), lines };
}

const COUNTED = { slot: '.m-page-list [data-page]', list: '.m-page-pane' };

/** The page layout a run reads in (`viewing.page-layout`): Continuous unless `MONSTERA_SCROLL_LAYOUT` names another. */
const LAYOUT = process.env['MONSTERA_SCROLL_LAYOUT'] ?? 'continuous';

async function opened(page: Page, layout: string = LAYOUT): Promise<void> {
  const { bytes, lines } = await densePages();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'dense.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
    pageLines: lines,
    settings: { 'viewing.page-layout': layout },
  });
  await installRenderCounter(page, COUNTED);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

/**
 * Scrolls the list past `pages` pages, in steps of a fifth of a row each frame, and waits for it to settle. A row is a
 * page in one column and a pair in two (Continuous facing), so the same count is the same pages arriving in either.
 */
async function scrollPages(page: Page, pages: number): Promise<void> {
  await page.locator('.m-page-list').evaluate(
    (element, count) =>
      new Promise<void>((resolve) => {
        const first = element.querySelector<HTMLElement>('[data-page="0"]');
        const second = element.querySelector<HTMLElement>('[data-page="1"]');
        const paired = first !== null && second !== null && second.offsetTop === first.offsetTop;
        const below = element.querySelector<HTMLElement>(`[data-page="${paired ? '2' : '1'}"]`);
        const pitch = below !== null && first !== null ? below.offsetTop - first.offsetTop : element.clientHeight;
        const target = element.scrollTop + pitch * (paired ? count / 2 : count);
        const step = (): void => {
          element.scrollTop = Math.min(target, element.scrollTop + pitch / 5);
          if (element.scrollTop >= target - 1) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    pages,
  );
  await page.waitForTimeout(1200);
}

test.describe('a long document scrolled from cold (item 61)', () => {
  test.setTimeout(180_000);

  // IN BOTH SCROLLING LAYOUTS: Continuous facing lays the same slots out two to a row (ADR-0284), and must render as few.
  for (const layout of ['continuous', 'facing'] as const) {
    test(`a page ARRIVING renders that page’s slot, and no slot of a page that is not arriving or leaving: ${layout}`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await opened(page, layout);
      await startCounting(page);
      await scrollPages(page, 3);
      const counts = await stopCounting(page);
      const rendered = pagesRendered(counts, 'slot', 0);
      console.log(JSON.stringify({ layout, commits: counts.commits, slots: rendersOf(counts, 'slot', 0), rendered: rendered.slice(0, 40) }));
      // THE POSITIVE CONTROL: the pages the scroll brought on screen rendered, so the counter saw the scroll.
      expect(rendered.some(([at]) => at >= 3)).toBe(true);
      // A PAGE FAR BELOW, which nothing about the scroll reaches, rendered not once.
      expect(rendered.filter(([at]) => at >= 12)).toStrictEqual([]);
    });
  }

  test('CONTROL: a change every page depends on, the zoom, still renders every slot', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await opened(page);
    await startCounting(page);
    await page.locator('.m-page-list').focus();
    await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(1500);
    const counts = await stopCounting(page);
    expect(pagesRendered(counts, 'slot', 0).length).toBe(PAGES);
  });

  // WHERE THE SCROLL'S TIME GOES, when asked for: the renderer main thread's trace events summed by name, and the CPU
  // profile's functions by self time. Read against an unminified build (`vite build --minify false`) for the names.
  test('PROFILE of a 37-page cold scroll, when asked for (MONSTERA_SCROLL_PROFILE=1)', async ({ page }) => {
    test.skip(process.env['MONSTERA_SCROLL_PROFILE'] !== '1', 'a measurement, run by hand');
    await page.setViewportSize({ width: 1600, height: 900 });
    await opened(page);
    const session = await page.context().newCDPSession(page);
    const events: { name: string; ph: string; dur?: number; tid: number; pid: number; args?: { data?: { frame?: string } } }[] = [];
    session.on('Tracing.dataCollected', (payload) => {
      // THE TRACE'S OWN EVENTS, whose shape the protocol types as plain objects.
      events.push(...(payload.value as unknown as typeof events));
    });
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 200 });
    await session.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink.user_timing',
      transferMode: 'ReportEvents',
    });
    await session.send('Profiler.start');
    await scrollPages(page, 37);
    const { profile } = (await session.send('Profiler.stop')) as {
      profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
    };
    const ended = new Promise<void>((resolve) => {
      session.once('Tracing.tracingComplete', () => {
        resolve();
      });
    });
    await session.send('Tracing.end');
    await ended;
    // THE RENDERER MAIN THREAD: the thread its `CrRendererMain` metadata names.
    const main = events.find((each) => each.name === 'thread_name' && (each as unknown as { args: { name: string } }).args.name === 'CrRendererMain');
    const byName = new Map<string, number>();
    const onMainThread = (each: { tid: number; pid: number; ph: string; dur?: number }): boolean =>
      each.tid === main?.tid && each.pid === main.pid && each.ph === 'X' && each.dur !== undefined;
    for (const each of events) if (onMainThread(each)) byName.set(each.name, (byName.get(each.name) ?? 0) + (each.dur ?? 0) / 1000);
    const self = new Map<string, number>();
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    for (const [at, id] of profile.samples.entries()) {
      const node = nodes.get(id);
      if (node === undefined) continue;
      const file = node.callFrame.url.split('/').at(-1) ?? '';
      const key = `${node.callFrame.functionName || '(anonymous)'} ${file}:${String(node.callFrame.lineNumber)}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[at] ?? 0) / 1000);
    }
    const top = (map: Map<string, number>, count: number): string[] =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([name, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${name}`);
    console.log(`TRACE (main thread, ms, summed; nested events overlap)\n${top(byName, 25).join('\n')}`);
    // EACH LONG TASK (over 25 ms) by what it held: its children's names, and a script's function where the trace names it.
    interface Timed {
      name: string;
      ph: string;
      ts: number;
      dur?: number;
      tid: number;
      pid: number;
      args?: { data?: { functionName?: string; url?: string } };
    }
    const onMain = (events as unknown as Timed[]).filter(onMainThread);
    const tasks = onMain.filter((each) => each.name === 'RunTask' && (each.dur ?? 0) > 25_000);
    const held = new Map<string, number>();
    for (const task of tasks) {
      const end = task.ts + (task.dur ?? 0);
      for (const each of onMain) {
        if (each === task || each.ts < task.ts || each.ts >= end || each.name === 'RunTask') continue;
        const what = each.args?.data?.functionName ? `${each.name}:${each.args.data.functionName}` : each.name;
        held.set(what, (held.get(what) ?? 0) + (each.dur ?? 0) / 1000);
      }
    }
    console.log(`LONG TASKS ${String(tasks.length)}, ${tasks.map((each) => Math.round((each.dur ?? 0) / 1000)).join(' ')} ms\n${top(held, 30).join('\n')}`);
    console.log(`SELF (CPU profile)\n${top(self, 45).join('\n')}`);
    expect(byName.size).toBeGreaterThan(0);
  });

  // ONE ROUND A RUN, each in a fresh page: `--repeat-each 5` for five rounds.
  test('FRAMES of a 37-page cold scroll, when asked for (MONSTERA_SCROLL_FRAMES=1)', async ({ page }) => {
    test.skip(process.env['MONSTERA_SCROLL_FRAMES'] !== '1', 'a measurement, run by hand');
    const readings: unknown[] = [];
    for (let round = 0; round < 1; round += 1) {
      await page.setViewportSize({ width: 1600, height: 900 });
      await opened(page);
      await page.evaluate(() => {
        const intervals: number[] = [];
        let last = performance.now();
        let on = true;
        const tick = (now: number): void => {
          intervals.push(now - last);
          last = now;
          if (on) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        (window as unknown as Record<string, unknown>)['scrollFrames'] = (): number[] => {
          on = false;
          return intervals;
        };
      });
      // THE IDLE CONTROL, in the same page before the scroll: the frames this browser gives when nothing happens.
      await page.waitForTimeout(3000);
      const idle = await page.evaluate(() => (window as unknown as { scrollFrames: () => number[] }).scrollFrames());
      console.log(`IDLE ${JSON.stringify({ frames: idle.length, over33: idle.filter((each) => each > 33).length, longest: Math.round(Math.max(...idle)) })}`);
      await page.evaluate(() => {
        const intervals: number[] = [];
        let last = performance.now();
        let on = true;
        const tick = (now: number): void => {
          intervals.push(now - last);
          last = now;
          if (on) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        (window as unknown as Record<string, unknown>)['scrollFrames'] = (): number[] => {
          on = false;
          return intervals;
        };
      });
      await startCounting(page);
      await scrollPages(page, 37);
      const counts = await stopCounting(page);
      const intervals = await page.evaluate(() => (window as unknown as { scrollFrames: () => number[] }).scrollFrames());
      const reading = {
        round,
        frames: intervals.length,
        over33: intervals.filter((each) => each > 33).length,
        longest: Math.round(Math.max(...intervals)),
        slotRenders: rendersOf(counts, 'slot', 0),
        commits: counts.commits,
      };
      console.log(`SCROLL ${JSON.stringify(reading)}`);
      readings.push(reading);
    }
    expect(readings.length).toBe(1);
  });
});
