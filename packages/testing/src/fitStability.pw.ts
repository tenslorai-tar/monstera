import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * A FIT SETTLES, AND STAYS SETTLED (the owner's videos of 1.1.2611.0, 2026-11-05): two A4 pages in Facing at
 * 1600 × 852, Fit width, and the pane's scrollbar came and went several times a second while the zoom figure flipped
 * between 69% and 68%. Only a browser lays out a pane and draws its scrollbar, so only this can see it.
 *
 * ## What is sampled, and why every frame
 *
 * Each animation frame for two seconds after the fit has had a second to settle: the zoom figure the status bar shows,
 * the scroller's `clientWidth` (which a classic scrollbar takes its width from) and whether its content overflows it.
 * A loop at 15 frames a second shows up as a change between frames; sampling once at the end would see one side of it
 * and pass.
 *
 * ## The instrument is shown to see first
 *
 * A case below makes a loop on purpose and asserts the sampler counts it. Without that, a sampler that never sees a
 * change (an overlay scrollbar that takes no width, a figure read from the wrong element) passes every stability case
 * here, which is the reassuring answer from an instrument that is blind.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f5');

interface Sample {
  readonly zoom: string;
  readonly clientWidth: number;
  readonly overflows: boolean;
}

interface Run {
  /** How many times each property changed from one frame to the next. */
  readonly zoomChanges: number;
  readonly widthChanges: number;
  readonly scrollbarChanges: number;
  readonly frames: number;
  readonly zooms: readonly string[];
  /** How wide the classic scrollbar is here: offsetWidth less clientWidth while it shows. */
  readonly scrollbarWidth: number;
}

/** Samples the zoom figure and the scroller's box every frame for `ms` milliseconds. */
function sample(page: Page, ms: number, scroller = '.m-page-list'): Promise<Run> {
  return page.evaluate(
    ([duration, selector]) =>
      new Promise<Run>((resolve) => {
        const list = document.querySelector<HTMLElement>(selector);
        const zoom = document.querySelector<HTMLElement>('.m-status-bar .m-status-zoom');
        if (list === null || zoom === null) throw new Error('no page list or zoom figure');
        const samples: Sample[] = [];
        let widest = 0;
        const start = performance.now();
        const step = (): void => {
          const overflows = list.scrollHeight > list.clientHeight;
          if (overflows) widest = Math.max(widest, list.offsetWidth - list.clientWidth);
          samples.push({ zoom: zoom.textContent, clientWidth: list.clientWidth, overflows });
          if (performance.now() - start < duration) {
            requestAnimationFrame(step);
            return;
          }
          const changes = (key: keyof Sample): number =>
            samples.reduce((count, each, at) => (at > 0 && samples[at - 1]?.[key] !== each[key] ? count + 1 : count), 0);
          resolve({
            zoomChanges: changes('zoom'),
            widthChanges: changes('clientWidth'),
            scrollbarChanges: changes('overflows'),
            frames: samples.length,
            zooms: [...new Set(samples.map((each) => each.zoom))],
            scrollbarWidth: widest,
          });
        };
        requestAnimationFrame(step);
      }),
    [ms, scroller] as const,
  );
}

/** Every value the zoom figure takes after the one it had when sampling began, frame by frame, for `ms`. */
function timeline(page: Page, ms: number): Promise<readonly string[]> {
  return page.evaluate(
    (duration) =>
      new Promise<readonly string[]>((resolve) => {
        const zoom = document.querySelector<HTMLElement>('.m-status-bar .m-status-zoom');
        if (zoom === null) throw new Error('no zoom figure');
        let last = zoom.textContent;
        const seen: string[] = [];
        const start = performance.now();
        const step = (): void => {
          const now = zoom.textContent;
          if (now !== last) seen.push(now);
          last = now;
          if (performance.now() - start < duration) requestAnimationFrame(step);
          else resolve(seen);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

/** What the reader sees of the pages after a fit: the first shown slot's box against the scroller's. */
function placement(page: Page): Promise<{ top: number; bottom: number; viewTop: number; viewBottom: number; scrollTop: number }> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.m-page-list');
    if (list === null) throw new Error('no page list');
    const view = list.getBoundingClientRect();
    const slot = [...list.querySelectorAll<HTMLElement>('.m-page-slot')]
      .map((each) => each.getBoundingClientRect())
      .find((box) => box.height > 0 && box.bottom > view.top && box.top < view.bottom);
    return {
      top: slot?.top ?? Number.NaN,
      bottom: slot?.bottom ?? Number.NaN,
      viewTop: view.top,
      viewBottom: view.top + list.clientHeight,
      scrollTop: list.scrollTop,
    };
  });
}

interface Case {
  readonly layout: 'single' | 'continuous' | 'pair' | 'facing';
  readonly pages: number;
  readonly size: readonly [number, number];
  readonly window: { readonly width: number; readonly height: number };
}

async function open(page: Page, { layout, pages, size, window }: Case): Promise<void> {
  await page.setViewportSize(window);
  const bytes = await blockedPages(size, pages);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'fit.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
    settings: { 'viewing.page-layout': layout },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1, { timeout: 60_000 });
}

/** Applies a fit by its shortcut, lets it settle for a second, and samples the two seconds after. */
async function fitted(page: Page, key: 'Control+1' | 'Control+0'): Promise<Run> {
  await page.locator('.m-page-list').focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(1000);
  return sample(page, 2000);
}

const A4: readonly [number, number] = [595, 842];
const LETTER: readonly [number, number] = [612, 792];
const LANDSCAPE: readonly [number, number] = [842, 595];
const LARGE: readonly [number, number] = [1275, 1650];

const LAYOUTS = ['single', 'continuous', 'pair', 'facing'] as const;
const SIZES = { A4, LETTER, LANDSCAPE, LARGE } as const;
const WINDOWS = [
  { width: 1600, height: 852 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 900, height: 700 },
] as const;

/**
 * SCROLLBARS THAT TAKE ROOM, as Windows draws them. Playwright launches headless Chromium with `--hide-scrollbars`
 * (its default arguments), and a hidden scrollbar takes no width, so the loop cannot happen here at all: measured
 * 2026-11-05 on Chromium 151.0.7922.34, the deliberate loop below counted 0 changes with the flag and the owner's case
 * passed on unfixed code. Without the flag the bar is a classic one with a width, as on Windows.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('THE INSTRUMENT SEES A LOOP made on purpose: a scroller whose content height follows its own width', async ({ page }) => {
  await open(page, { layout: 'pair', pages: 2, size: A4, window: { width: 1600, height: 852 } });
  // A loop of the owner's shape, beside the app: a scroller whose content is tall only while it is at its full width,
  // remeasured by a ResizeObserver as `PageList` remeasures its own. Tall shows the bar, the bar narrows the box, the
  // content goes short, the bar goes, and round again.
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'm-loop-probe';
    probe.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;overflow-y:auto;z-index:9999';
    const content = document.createElement('div');
    probe.append(content);
    document.body.append(probe);
    const full = probe.clientWidth;
    new ResizeObserver(() => {
      content.style.height = probe.clientWidth >= full ? '600px' : '100px';
    }).observe(probe);
  });
  const run = await sample(page, 2000, '.m-loop-probe');
  expect(run.scrollbarWidth, JSON.stringify(run)).toBeGreaterThan(0);
  expect(run.scrollbarChanges, JSON.stringify(run)).toBeGreaterThan(5);
  expect(run.widthChanges, JSON.stringify(run)).toBeGreaterThan(5);
});

/**
 * THE OWNER'S CASE AT THE HEIGHT IT LOOPS HERE. The owner's 1600 × 852 is the Electron window; this harness's viewport
 * is the page alone, so its pane is taller by the window's own chrome, and the loop is found at 868 to 876 instead
 * (the sweep below, measured 2026-11-05 on d594f808: 68% and 70% alternating every frame). 870 is inside that band.
 */
for (const layout of ['pair', 'facing'] as const) {
  test(`THE OWNER'S CASE: two A4 pages in ${layout === 'pair' ? 'Facing' : 'Continuous facing'} at 1600 × 870, Fit width, holds still`, async ({ page }) => {
    await open(page, { layout, pages: 2, size: A4, window: { width: 1600, height: 870 } });
    const run = await fitted(page, 'Control+1');
    expect(run.zoomChanges, JSON.stringify(run)).toBe(0);
    expect(run.widthChanges, JSON.stringify(run)).toBe(0);
    expect(run.scrollbarChanges, JSON.stringify(run)).toBe(0);
  });
}

/** The zoom figure as a number, 0.35 for *35%*. */
async function zoomShown(page: Page): Promise<number> {
  const text = (await page.locator('.m-status-bar .m-status-zoom').textContent()) ?? '';
  return Number.parseFloat(text) / 100;
}

/** The first shown page's box and the scroller's own, in one frame. */
async function pageAndPane(page: Page): Promise<{ page: DOMRect; pane: DOMRect; clientWidth: number; clientHeight: number }> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.m-page-list');
    const slot = [...(list?.querySelectorAll<HTMLElement>('.m-page-slot') ?? [])].find((each) => !each.hidden && each.getBoundingClientRect().height > 0);
    if (list === null || slot === undefined) throw new Error('no page shown');
    return { page: slot.getBoundingClientRect().toJSON() as DOMRect, pane: list.getBoundingClientRect().toJSON() as DOMRect, clientWidth: list.clientWidth, clientHeight: list.clientHeight };
  });
}

/**
 * A PAGE THAT NEEDS LESS THAN 50% (the owner's video: a page 638 px wide at 50%, in a pane about 868 × 610; both fits
 * stayed at 50% in the facing layouts and Fit page ran off the bottom everywhere). The page list draws a point as a CSS
 * pixel at 100%, so that page is 1,276 pt wide; 1,275 × 1,650 pt is its size here, at a window whose pane is 862 wide.
 */
const BIG = LARGE;
const BIG_WINDOW = { width: 1600, height: 870 } as const;

for (const layout of LAYOUTS) {
  test(`A BIG PAGE, ${layout}: Fit page puts the whole page inside the pane, top and bottom, below 50% if it must`, async ({ page }) => {
    await open(page, { layout, pages: 1, size: BIG, window: BIG_WINDOW });
    await fitted(page, 'Control+0');
    const { page: box, pane, clientHeight } = await pageAndPane(page);
    const where = JSON.stringify({ box, pane, clientHeight, zoom: await zoomShown(page) });
    expect(box.top, where).toBeGreaterThanOrEqual(pane.top - 0.5);
    expect(box.bottom, where).toBeLessThanOrEqual(pane.top + clientHeight + 0.5);
  });

  test(`A BIG PAGE, ${layout}: Fit width spans the pane's width, below 50% if it must`, async ({ page }) => {
    await open(page, { layout, pages: 1, size: BIG, window: BIG_WINDOW });
    await fitted(page, 'Control+1');
    const { page: box, clientWidth } = await pageAndPane(page);
    const where = JSON.stringify({ box, clientWidth, zoom: await zoomShown(page) });
    // ONE PAGE: a one-page document fits as one page in every layout (the owner's decision, 2026-11-05).
    expect(box.width, where).toBeGreaterThan(clientWidth - 80);
    expect(box.width, where).toBeLessThanOrEqual(clientWidth);
  });
}

test('A ONE-PAGE DOCUMENT in Facing fits as one page, and the zoom ladder steps out of a fit below 50%', async ({ page }) => {
  await open(page, { layout: 'pair', pages: 1, size: A4, window: { width: 1600, height: 870 } });
  await fitted(page, 'Control+1');
  const { page: box, clientWidth } = await pageAndPane(page);
  expect(box.width, JSON.stringify({ box, clientWidth })).toBeGreaterThan(clientWidth - 80);
});

test('THE ODD LAST PAGE of three in Facing keeps the pair’s zoom, so reading on does not jump', async ({ page }) => {
  await open(page, { layout: 'pair', pages: 3, size: A4, window: { width: 1600, height: 870 } });
  await fitted(page, 'Control+1');
  const atFirst = await zoomShown(page);
  await page.keyboard.press('End');
  await page.waitForTimeout(800);
  expect(await zoomShown(page)).toBe(atFirst);
  // AND IT IS THE PAIR'S SIZE: two pages' width, so the lone page takes about half the pane.
  const { page: box, clientWidth } = await pageAndPane(page);
  expect(box.width, JSON.stringify({ box, clientWidth })).toBeLessThan(clientWidth / 2 + 1);
});

test('FIT PAGE ANSWERS IN ONE STEP from a page wider than the pane, whose horizontal scrollbar goes as it fits', async ({ page }) => {
  // THE CLASS'S HEIGHT SIDE: at 100% the A4 page is wider than this pane, so a horizontal bar takes the box's height,
  // and a fit measured from that box answered twice as the bar went. Measured 2026-11-05 before the fix: 45%, then 47%.
  await open(page, { layout: 'single', pages: 1, size: A4, window: { width: 1280, height: 720 } });
  await page.locator('.m-page-list').focus();
  const answering = timeline(page, 1000);
  await page.keyboard.press('Control+0');
  expect(await answering).toHaveLength(1);
});

/** The sweeps take minutes each, so they run when asked (`MONSTERA_FIT_SWEEP=1`), as `longScroll.pw.ts`' figures do. */
const MATRIX_SWEEP = process.env['MONSTERA_FIT_SWEEP'] === '1';

/**
 * THE BAND WHERE A FIT CHANGES ITS OWN BOX, found by resizing rather than guessed: at fit width, every window height
 * from 560 to 1100 in steps of 2, each sampled for half a second. The loop lives only where the fitted pages are
 * within a scrollbar's width of fitting the pane's height, so a handful of window sizes is no evidence either way.
 */
for (const layout of MATRIX_SWEEP ? LAYOUTS : []) {
  for (const key of ['Control+1', 'Control+0'] as const) {
    test(`NO HEIGHT LOOPS: two A4 pages in ${layout}, ${key === 'Control+1' ? 'Fit width' : 'Fit page'}, window 1600 wide and 560 to 1100 high`, async ({ page }) => {
      test.setTimeout(600_000);
      await open(page, { layout, pages: 2, size: A4, window: { width: 1600, height: 852 } });
      await page.locator('.m-page-list').focus();
      await page.keyboard.press(key);
      const loops: { height: number; run: Run }[] = [];
      for (let height = 560; height <= 1100; height += 2) {
        await page.setViewportSize({ width: 1600, height });
        await page.waitForTimeout(250);
        const run = await sample(page, 500);
        if (run.zoomChanges + run.widthChanges + run.scrollbarChanges > 0) loops.push({ height, run });
      }
      expect(loops, JSON.stringify(loops)).toStrictEqual([]);
    });
  }
}

/** The matrix, or a slice of it named by `MONSTERA_FIT_MATRIX` (`all`, or a layout name), for a sweep by hand. */
const MATRIX = process.env['MONSTERA_FIT_MATRIX'];

if (MATRIX !== undefined) {
  for (const layout of LAYOUTS.filter((each) => MATRIX === 'all' || MATRIX === each)) {
    for (const pages of [1, 2, 3, 5]) {
      for (const [name, size] of Object.entries(SIZES)) {
        for (const window of WINDOWS) {
          for (const key of ['Control+1', 'Control+0'] as const) {
            test(`SWEEP ${layout} ${String(pages)}p ${name} ${String(window.width)}x${String(window.height)} ${key === 'Control+1' ? 'fit-width' : 'fit-page'}`, async ({ page }) => {
              await open(page, { layout, pages, size, window });
              await page.locator('.m-page-list').focus();
              // FROM THE PRESS: every frame of the next second, so a fit that lands in two visible steps is counted.
              const answering = timeline(page, 1000);
              await page.keyboard.press(key);
              const steps = await answering;
              const run = await sample(page, 2000);
              const where = await placement(page);
              const figures = { steps, ...run, where };
              test.info().annotations.push({ type: 'fit', description: JSON.stringify(figures) });
              expect(steps.length, JSON.stringify(figures)).toBeLessThanOrEqual(1);
              expect(run.zoomChanges + run.widthChanges + run.scrollbarChanges, JSON.stringify(figures)).toBe(0);
              if (key === 'Control+0') {
                expect(where.top, JSON.stringify(figures)).toBeGreaterThanOrEqual(where.viewTop - 0.5);
                expect(where.bottom, JSON.stringify(figures)).toBeLessThanOrEqual(where.viewBottom + 0.5);
              }
            });
          }
        }
      }
    }
  }
}
