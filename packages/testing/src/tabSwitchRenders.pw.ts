import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';
import { installRenderCounter, rendersOf, startCounting, stopCounting } from './renderCounter.js';

/**
 * What React renders across a tab switch and across a scroll, counted (the owner's review of 0.1.9.0, items D.b and
 * G; `renderCounter.ts` is the instrument).
 *
 * ## The mechanism these hold shut
 *
 * Every page and thumbnail sat in a page menu of its own — a Base UI menu root, its floating tree and its portal per
 * slot — built from the focused document's command context. A switch changes that context, and every kept layer
 * (ADR-0129) took it through the shared `background`, alongside the element on show as `children`. So each render of
 * `App` rendered every open document's every slot and rebuilt every slot's menu: 340 menu areas, 194 page slots and
 * 160 thumbnails across one switch with two documents open, measured in Chromium 151 on 2026-10-02. On the installed
 * 0.1.8.0 that was the 1.5–2.2 s of work after each switch (`docs/JOURNAL.md`, *Row 303's open and tab-switch
 * figures*).
 *
 * Now each list draws ONE menu, asking for the right-clicked page when the right-click happens, and a layer behind
 * takes no prop that changes with the document on show, so a switch renders the two layers it moves and no other.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000d1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000d2');
const THIRD = asDocId('00000000-0000-4000-8000-0000000000d3');

/** The elements counted: a page slot, a menu's trigger, and the two lists that hold slots. */
const COUNTED = {
  slot: '.m-page-list [data-page]',
  menu: '.m-context-menu-region',
  list: '.m-page-pane, .m-thumbnails',
};

/** Three documents open, the third in front: tabs and layers are in that order, so the layer index is the tab's. */
async function threeOpen(page: Page): Promise<void> {
  const [first, second, third] = await Promise.all([
    blockedPages([612, 792], 5),
    blockedPages([612, 792], 40),
    blockedPages([612, 792], 40),
  ]);
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: FIRST, version: asDocVersion(1), byteLength: first.byteLength, name: 'first.pdf' },
      { kind: 'opened', docId: SECOND, version: asDocVersion(1), byteLength: second.byteLength, name: 'second.pdf' },
      { kind: 'opened', docId: THIRD, version: asDocVersion(1), byteLength: third.byteLength, name: 'third.pdf' },
    ],
    documentBytes: new Map([
      [FIRST, first],
      [SECOND, second],
      [THIRD, third],
    ]),
  });
  await installRenderCounter(page, COUNTED);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator(`[data-tab-select="${FIRST}"]`)).toBeVisible({ timeout: 20_000 });
  for (const next of [SECOND, THIRD]) {
    await page.keyboard.press('Control+O');
    await expect(page.locator(`[data-tab-select="${next}"]`)).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.locator('.m-document-layer')).toHaveCount(3);
  // SETTLED: every layer's first frame is shown, so what the window counts next is the gesture's and not the opening's.
  await expect(page.locator('.m-page-pane[data-first-frame="pending"]')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1000);
}

test('a TAB SWITCH renders the two layers it moves and none of the others, and builds no menu per page', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 852 });
  await threeOpen(page);

  // FROM THE THIRD TO THE FIRST: the second is behind before and after, and nothing about it changes.
  await startCounting(page);
  await page.locator(`[data-tab-select="${FIRST}"]`).click();
  await expect(page.locator('.m-document-layer').nth(0)).toHaveAttribute('data-document-layer', 'active');
  await page.waitForTimeout(2000);
  const counts = await stopCounting(page);
  console.log(JSON.stringify(counts));

  // THE POSITIVE CONTROL: the counter saw the switch — the layer coming forward and the one going behind rendered.
  expect(rendersOf(counts, 'slot', 0)).toBeGreaterThan(0);
  expect(rendersOf(counts, 'slot', 2)).toBeGreaterThan(0);
  // THE LAYER THE SWITCH DOES NOT MOVE: not one slot, menu or list rendered. Without the fix, every one did.
  expect(rendersOf(counts, 'slot', 1)).toBe(0);
  expect(rendersOf(counts, 'menu', 1)).toBe(0);
  expect(rendersOf(counts, 'list', 1)).toBe(0);
  // ONE MENU PER LIST in every layer, never one per page: a list renders its menu with it, and nothing more.
  for (const layer of [0, 2]) expect(rendersOf(counts, 'menu', layer)).toBeLessThanOrEqual(rendersOf(counts, 'list', layer));
  const perLayer = await page.evaluate(() =>
    [...document.querySelectorAll('.m-document-layer')].map((layer) => ({
      menus: layer.querySelectorAll('.m-context-menu-region').length,
      lists: layer.querySelectorAll('.m-page-list, .m-thumbnails').length,
      slots: layer.querySelectorAll('.m-page-list [data-page]').length,
    })),
  );
  for (const layer of perLayer) {
    expect(layer.slots).toBeGreaterThan(layer.lists);
    expect(layer.menus).toBe(layer.lists);
  }
});

test('a SCROLL through 40 pages builds one menu per list render, not one per page slot', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 852 });
  await threeOpen(page);

  const list = page.locator('.m-document-layer').nth(2).locator('.m-page-list');
  await startCounting(page);
  for (let step = 0; step < 60; step += 1) {
    const atEnd = await list.evaluate((element) => {
      element.scrollTop += element.clientHeight / 2;
      return element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    });
    await page.waitForTimeout(60);
    if (atEnd) break;
  }
  await page.waitForTimeout(800);
  const counts = await stopCounting(page);
  console.log(JSON.stringify(counts));

  // THE POSITIVE CONTROL: the scroll mounted and rendered slots, so the list did render as it went.
  expect(rendersOf(counts, 'slot', 2)).toBeGreaterThan(40);
  expect(rendersOf(counts, 'list', 2)).toBeGreaterThan(0);
  // A MENU BUILT ONCE PER LIST RENDER at most. Per slot, it was built as often as the slots rendered.
  expect(rendersOf(counts, 'menu', 2)).toBeLessThanOrEqual(rendersOf(counts, 'list', 2));
  // AND THE LAYERS BEHIND rendered nothing while the one in front scrolled.
  for (const layer of [0, 1]) expect(rendersOf(counts, 'slot', layer)).toBe(0);
});
