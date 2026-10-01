import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { installInspector, stopWatching, unfinishedNow, watchFrames } from './frameInspector.js';
import { bridge } from './pageBridge.js';

/**
 * A tab switch shows the finished document from its first frame, read frame by frame in a real browser.
 *
 * ## The mechanism this holds shut
 *
 * Only the active document's page area was mounted (ADR-0129 reverses it). A switch unmounted it and mounted the
 * other document's from nothing: a new parser, slots at their minimum size with blank thumbnails while the zoom
 * readout still said the old tab's figure, then a blank page at 100%, then the page at its fit. Row 303 says tab
 * switching is instant, and §6 says it re-parses nothing.
 *
 * ## The fixture tells the two documents apart
 *
 * The first is portrait and the second landscape, so a frame showing the wrong document's pages is caught by
 * their shape as well as by the frame checks. The zoom readout is recorded on every frame and must hold one
 * value from the first frame after the click: the fit the document comes back at.
 */

const PORTRAIT = asDocId('00000000-0000-4000-8000-0000000000a1');
const LANDSCAPE = asDocId('00000000-0000-4000-8000-0000000000a2');
/**
 * Whether the page on screen has the expected shape. The VISIBLE canvas, so the case reads the same against a
 * build that keeps background tabs and one that does not, which is what lets it be its own control.
 */
async function showsShape(page: Page, portrait: boolean): Promise<boolean> {
  return page.evaluate((tall) => {
    const canvas = [...document.querySelectorAll<HTMLCanvasElement>('.m-page-list canvas.m-page')].find((each) =>
      each.checkVisibility({ visibilityProperty: true }),
    );
    return canvas !== undefined && canvas.width > 0 && canvas.height > canvas.width === tall;
  }, portrait);
}

test('a TAB SWITCH shows the finished document from its first frame, at its own zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tall = await blockedPages([612, 792], 3);
  const wide = await blockedPages([792, 612], 3);
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: PORTRAIT, version: asDocVersion(1), byteLength: tall.byteLength, name: 'portrait.pdf' },
      { kind: 'opened', docId: LANDSCAPE, version: asDocVersion(1), byteLength: wide.byteLength, name: 'landscape.pdf' },
    ],
    documentBytes: new Map([
      [PORTRAIT, tall],
      [LANDSCAPE, wide],
    ]),
  });
  await installInspector(page, 'body', '.m-status-zoom');
  await page.goto('/');

  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect.poll(() => showsShape(page, true), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  const portraitZoom = await page.locator('.m-status-zoom').textContent();

  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect.poll(() => showsShape(page, false), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  // THE TWO ZOOMS DIFFER, or the readout case below could not tell one document's zoom from the other's. Both
  // open at the starting zoom, so the second is zoomed in, through the palette as a person would.
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Zoom in');
  await page.getByRole('option', { name: /^Zoom in\b/u }).first().click();
  await expect.poll(() => page.locator('.m-status-zoom').textContent(), { timeout: 10_000 }).not.toBe(portraitZoom);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);

  await watchFrames(page);
  await page.locator(`[data-tab-select="${PORTRAIT}"]`).click();
  // THE SWITCH LANDED: the layer on show is the portrait document's, drawn.
  await expect.poll(() => showsShape(page, true), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  await page.waitForTimeout(500);
  const log = await stopWatching(page);

  expect(log.frames).toBeGreaterThan(10);
  expect({ unfinished: log.unfinished.length, first: log.unfinished.slice(0, 12) }).toStrictEqual({ unfinished: 0, first: [] });
  // EVERY FRAME AFTER THE CLICK reads the portrait document's own zoom. The first frames recorded may precede
  // the click's render, so they may read the landscape figure; what must never appear is a third value, or the
  // landscape figure after the portrait one has shown.
  const firstPortrait = log.zooms.indexOf(portraitZoom ?? '');
  expect(firstPortrait).toBeGreaterThanOrEqual(0);
  expect(log.zooms.slice(firstPortrait).filter((zoom) => zoom !== portraitZoom)).toStrictEqual([]);
  expect(new Set(log.zooms.slice(0, firstPortrait)).size).toBeLessThanOrEqual(1);
});
