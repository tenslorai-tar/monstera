import { asDocId, asDocVersion } from '@monstera/shared';
import type { Locator, Page } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';
import { expect, test } from './renderedTest.js';

/**
 * A toast is SEEN with any tab on show, not only the last (R28, the owner's review of 0.1.17.0, 2026-10-21).
 *
 * The toast strip sits at the page area's corner through a CSS anchor name. Every document kept behind keeps its page
 * area, hidden, and a name several boxes carry resolves to the last of them in the tree: with the first of two tabs on
 * show, the strip anchored to the second tab's hidden page area, and Chromium's default `position-visibility:
 * anchors-visible` hid it. Every toast, and the conversion notice the owner saw missing, was mounted and placed and never
 * seen. `toBeVisible` passes such a toast, so what is asserted is the box a person's eye lands on: the element on top at
 * the toast's centre.
 *
 * CONTROL: the same case with the last tab on show, where the name resolved to the page area on show before the fix too.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000c1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000c2');

/** Opens two documents; the second is on show and the first behind. */
async function openBoth(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 2);
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: FIRST, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'first.pdf' },
      { kind: 'opened', docId: SECOND, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'second.pdf' },
    ],
    documentBytes: new Map([
      [FIRST, bytes],
      [SECOND, bytes],
    ]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-document-layer="active"] .m-page-list .m-page').first()).toBeVisible();
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect(page.locator('[data-document-layer="background"]')).toHaveCount(1);
  await expect(page.locator('[data-document-layer="active"] .m-page-list .m-page').first()).toBeVisible();
}

/** The toast a save raises, once it has arrived (`m-toast-in` slides it 8 px over 160 ms). */
async function savedToast(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+S');
  const toast = page.locator('.m-toast').first();
  await expect(toast).toBeAttached();
  await page.waitForTimeout(400);
  return toast;
}

/** What a person sees at the toast's centre: the toast, or what is drawn over it. */
async function onTop(page: Page, toast: Locator): Promise<string> {
  const box = await toast.boundingBox();
  if (box === null) throw new Error('the toast has no box');
  return page.evaluate(
    ([x, y]) => {
      const at = document.elementFromPoint(x ?? 0, y ?? 0);
      return at === null ? 'nothing' : at.closest('.m-toast') !== null ? 'the toast' : `${at.tagName.toLowerCase()}.${at.className}`;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
}

test('with the FIRST of two tabs on show, a toast is on top at its own centre, in the page area on show', async ({ page }) => {
  await openBoth(page);
  await page.locator(`[data-tab-select="${FIRST}"]`).click();
  await expect(page.locator(`[data-document-layer="background"]`)).toHaveCount(1);
  const toast = await savedToast(page);
  expect(await onTop(page, toast)).toBe('the toast');
  // AT THE CORNER OF THE PAGE AREA ON SHOW, which is where the anchor puts it: not the window's corner fallback.
  const pane = await page.locator('[data-document-layer="active"] .m-canvas-area').boundingBox();
  const box = await toast.boundingBox();
  if (pane === null || box === null) throw new Error('the page area or the toast has no box');
  expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
});

/**
 * IN ORGANIZE, which unmounts the page pane for its grid of cards (the guide videos, 2026-11-19): the strip named an
 * anchor no box carried, and "Pages saved" and "Saved" were mounted and never drawn. The anchor is now the page area
 * every view has, and the strip is never hidden by its anchor. Asserted at its own centre and inside the page area on
 * show, so neither the window-corner fallback nor a strip drawn over the Properties panel passes.
 */
test('in ORGANIZE, a toast is on top at its own centre, in the page area on show', async ({ page }) => {
  await openBoth(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Organize', exact: true }).first().click();
  await expect(page.locator('[data-document-layer="active"] .m-page-grid')).toBeVisible();
  await expect(page.locator('[data-document-layer="active"] .m-page-pane')).toHaveCount(0);
  const toast = await savedToast(page);
  expect(await onTop(page, toast)).toBe('the toast');
  const area = await page.locator('[data-document-layer="active"] .m-canvas-area').boundingBox();
  const box = await toast.boundingBox();
  if (area === null || box === null) throw new Error('the page area or the toast has no box');
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
});

test('CONTROL: with the LAST tab on show, the toast is on top too', async ({ page }) => {
  await openBoth(page);
  const toast = await savedToast(page);
  expect(await onTop(page, toast)).toBe('the toast');
});
