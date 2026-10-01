import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { installInspector, stopWatching, unfinishedNow, watchFrames } from './frameInspector.js';
import { bridge } from './pageBridge.js';

/**
 * An edit never shows an unfinished screen, read frame by frame in a real browser.
 *
 * ## The mechanism this holds shut
 *
 * Every command moves the document's version, and a new version opens a new view (ADR-0031: the
 * old view's byte offsets belong to bytes that no longer exist). Three things blanked the pages
 * while that happened. The view hook cleared the shown view in its cleanup, before the new one had
 * opened, so the page area rendered empty until the parse finished. A slot mounted its canvas only
 * while the new version's rotation was answered, so every canvas unmounted until the model was
 * asked again. And each page draw sized the canvas on screen first, which clears it, and then let
 * PDF.js paint into it across tasks, so a page was transparent, then white, then whole.
 *
 * ## How a frame is read
 *
 * `frameInspector.ts`, from the moment before the command until the edit has settled. The shim
 * answers the same bytes at every version, so the new view's pages are the old pixels again and
 * any frame between them that is not a whole page is the reopen showing through.
 *
 * A frame where a page is still the PREVIOUS version's whole drawing is finished, and that is the
 * point: the old view stays until the new one has something to show.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000e7');

test('an EDIT shows the previous pages or the new ones, never a blank or half-drawn frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 2);
  /** Every version a range was asked for: a read above 1 is the view the edit reopened. */
  const rangeVersions = new Set<number>();
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'blocks.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel, params) => {
      if (channel === 'document.readRange') rangeVersions.add((params as { version: number }).version);
    },
  );
  await installInspector(page, 'body');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // GENEROUS, because these wait for a page to rasterise and are not a product bound
  // (`pagePosition.pw.ts` measured the default missing a first draw on a loaded machine).
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  expect([...rangeVersions]).toStrictEqual([1]);

  await watchFrames(page);

  // A COMMAND, through the palette as a person runs one: the shim moves the version per command
  // (`browserShim.test.ts`), so the view reopens underneath the pages on screen.
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Rotate page');
  await page.locator('.m-palette-item').filter({ hasText: /^Rotate page$/u }).first().click();

  // THE EDIT REOPENED THE VIEW: a range was read at the version the command moved to. Without
  // this the case passes for a command that never ran, which leaves every frame finished.
  await expect.poll(() => [...rangeVersions].some((version) => version > 1), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => unfinishedNow(page), { timeout: 20_000 }).toStrictEqual([]);
  // A SETTLE: frames after the last draw are read too, so a late redraw that clears a page is seen.
  await page.waitForTimeout(500);

  const log = await stopWatching(page);
  // THE LOOP RAN across the edit: a handful of frames is a watcher that stopped, not a clean edit.
  expect(log.frames).toBeGreaterThan(10);
  expect({ unfinished: log.unfinished.length, first: log.unfinished.slice(0, 12) }).toStrictEqual({ unfinished: 0, first: [] });
});
