import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { framesTold, installInspector, stopWatching, unfinishedNow, watchFrames } from './frameInspector.js';
import { bridge } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * A layer behind for a minute is PARKED and comes back finished
 * ([ADR-0129](../../../docs/DECISIONS/0129-an-open-documents-view-lives-until-it-closes.md)'s correction of 2026-10-17).
 *
 * A parked layer mounts nothing, so its parser, worker and layout are given back. Shown again it is rebuilt hidden and
 * comes forward when its viewport is drawn, so not one frame after the click shows its *Opening* state or an undrawn
 * page; the frames are read in a real browser. The minute is passed with Playwright's clock, which moves `Date.now` and
 * the timers the shell checks it with.
 *
 * CONTROL: a document a command has applied to is never parked, whatever the time behind.
 */

const PORTRAIT = asDocId('00000000-0000-4000-8000-0000000000b1');
const LANDSCAPE = asDocId('00000000-0000-4000-8000-0000000000b2');

/** Whether the page on screen has the expected shape, read off the VISIBLE canvas. */
async function showsShape(page: Page, portrait: boolean): Promise<boolean> {
  return page.evaluate((tall) => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('.m-page-list canvas.m-page')].find((each) =>
      each.checkVisibility({ visibilityProperty: true }),
    );
    return canvas !== undefined && canvas.width > 0 && canvas.height > canvas.width === tall;
  }, portrait);
}

/** Opens the two documents, portrait first, so the landscape one is on show and the portrait one behind. */
/** A third document, tall like the first, which only the control opens. */
const THIRD = asDocId('00000000-0000-4000-8000-0000000000b3');

async function openBoth(
  page: Page,
  options: { third?: boolean; observe?: (channel: string, params: unknown) => void } = {},
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tall = await blockedPages([612, 792], 3);
  const wide = await blockedPages([792, 612], 3);
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: PORTRAIT, version: asDocVersion(1), byteLength: tall.byteLength, name: 'portrait.pdf' },
      { kind: 'opened', docId: LANDSCAPE, version: asDocVersion(1), byteLength: wide.byteLength, name: 'landscape.pdf' },
      ...(options.third === true
        ? [{ kind: 'opened' as const, docId: THIRD, version: asDocVersion(1), byteLength: tall.byteLength, name: 'third.pdf' }]
        : []),
    ],
    documentBytes: new Map([
      [PORTRAIT, tall],
      [LANDSCAPE, wide],
      [THIRD, tall],
    ]),
    // MAIN'S TIME FOR A RANGE, so a rebuild takes frames: with ranges answered at once the parse lands inside one frame,
    // and a layer that came forward on its *Opening* state would show it for none (measured: that mutant passed).
    delays: { 'document.readRange': 150 },
  }, options.observe);
  await page.clock.install();
  await installInspector(page, 'body', '.m-status-zoom');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect.poll(() => showsShape(page, true), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
}

const parkedLayers = (page: Page) => page.locator('[data-document-layer="parked"]');

/**
 * Watches every frame for a VISIBLE *Opening* state, which `frameInspector.ts` counts as finished on purpose — right for a
 * document opening for the first time, and exactly the screen a parked layer coming back must not show.
 */
async function watchOpening(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { frames: 0, opening: 0, running: true, seen: [] as string[] };
    (window as unknown as { __opening: typeof state }).__opening = state;
    const began = performance.now();
    const tick = (): void => {
      if (!state.running) return;
      state.frames += 1;
      const shown = [...document.querySelectorAll<HTMLElement>('.m-page-opening')].filter((each) =>
        each.checkVisibility({ visibilityProperty: true }),
      );
      if (shown.length > 0) {
        state.opening += 1;
        // WHERE AND WHEN, for the failing case's own message: the layer it was in, and the time since the watch began.
        const layer = shown[0]?.closest('[data-document-layer]')?.getAttribute('data-document-layer') ?? 'none';
        state.seen.push(`frame ${String(state.frames)} at ${String(Math.round(performance.now() - began))} ms in a ${layer} layer`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops the watch and answers how many frames it read and how many showed the *Opening* state. */
async function openingFrames(page: Page): Promise<{ frames: number; opening: number; seen: string[] }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __opening: { frames: number; opening: number; running: boolean; seen: string[] } })
      .__opening;
    state.running = false;
    return { frames: state.frames, opening: state.opening, seen: state.seen };
  });
}

test('a layer behind for a minute is parked, and comes back finished from its first frame', async ({ page }) => {
  await openBoth(page);
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect.poll(() => showsShape(page, false), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  // NOT YET: under the minute, the portrait layer is behind and kept.
  await page.clock.fastForward(30_000);
  await expect(parkedLayers(page)).toHaveCount(0);
  await page.clock.fastForward(40_000);
  await expect(parkedLayers(page)).toHaveCount(1, { timeout: 15_000 });
  // THE LAYER ON SHOW STILL FILLS THE PAGE AREA: a parked layer takes no box. In flow it took half the area and pushed the
  // page down (the memory walk's screenshot, 2026-10-17), which every frame check above passed.
  const area = await page.locator('.m-body-area').boundingBox();
  const shown = await page.locator('[data-document-layer="active"]').boundingBox();
  expect(shown?.y).toBeCloseTo(area?.y ?? Number.NaN, 0);
  expect(shown?.height).toBeCloseTo(area?.height ?? Number.NaN, 0);

  await watchFrames(page);
  await watchOpening(page);
  await page.locator(`[data-tab-select="${PORTRAIT}"]`).click();
  await expect.poll(() => showsShape(page, true), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  await page.waitForTimeout(500);
  const opening = await openingFrames(page);
  const log = await stopWatching(page);
  const told = framesTold(log);
  expect(log.frames, told).toBeGreaterThan(10);
  expect({ unfinished: log.unfinished.length, first: log.unfinished.slice(0, 12) }, told).toStrictEqual({ unfinished: 0, first: [] });
  // NOT ONE FRAME OF *OPENING*: the rebuild happened out of sight, with the landscape page on show meanwhile.
  expect(opening.frames, told).toBeGreaterThan(10);
  expect(opening.seen, told).toStrictEqual([]);
  // ON SHOW, IT IS NOT PARKED; and the landscape layer that went behind is kept until its own minute.
  await expect(parkedLayers(page)).toHaveCount(0);
});

test('CONTROL: a document a command has applied to is never parked, however long it is behind', async ({ page }) => {
  const executed: unknown[] = [];
  await openBoth(page, {
    third: true,
    observe: (channel, params) => {
      if (channel === 'document.execute') executed.push((params as { docId?: unknown }).docId);
    },
  });
  // A COMMAND ON THE PORTRAIT DOCUMENT, so its version moves: it has an undo history now. SENT, then settled: `data-writes`
  // at 0 alone also holds before the command has started.
  await runCommand(page, 'Rotate page');
  await expect.poll(() => executed, { timeout: 10_000 }).toStrictEqual([PORTRAIT]);
  await expect(page.locator('html')).toHaveAttribute('data-writes', '0', { timeout: 10_000 });
  // BEHIND IT, A CLEAN DOCUMENT TOO: the landscape one, then the third on show.
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect.poll(() => showsShape(page, false), { timeout: 20_000 }).toBe(true);
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect.poll(() => showsShape(page, true), { timeout: 20_000 }).toBe(true);
  await page.clock.fastForward(70_000);
  // A PARKING PASS THAT MUST HAPPEN: the clean landscape layer is parked. Without it, *none parked* reads the same as
  // *not parked yet*, and a shell that parked the edited document too would pass (the audit of 39a81ead..cd0abe3c).
  await expect(parkedLayers(page)).toHaveCount(1, { timeout: 15_000 });
  // AND ONLY THAT ONE, after another pass's worth of time: the edited portrait layer is kept.
  await page.clock.fastForward(10_000);
  await page.waitForTimeout(1_000);
  await expect(parkedLayers(page)).toHaveCount(1);
  await expect(page.locator('[data-document-layer="background"]')).toHaveCount(1);
});
