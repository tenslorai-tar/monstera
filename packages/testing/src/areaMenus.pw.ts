import { type Page, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * The right-click menus draw each command's glyph in one column, as the menu row does (the owner's item 9b), on the
 * pinned Chromium at 1280 x 800.
 *
 * Which command carries which glyph, and that one is drawn before the title and out of its name, is
 * `ContextMenu.test.tsx`'s; that every command a right-click menu lists has one is the registry's refusal. These are
 * what only a browser can answer: every item of the page, selected-text and tab menus shows a glyph, every title starts
 * at one edge, every item is the menu's 30 px, and the popup stays in the window.
 */

interface Reading {
  readonly items: number;
  readonly glyphless: readonly string[];
  readonly offsets: readonly number[];
  readonly heights: readonly number[];
  readonly inside: boolean;
}

async function readOpenMenu(page: Page): Promise<Reading> {
  const popup = page.locator('.m-area-menu');
  await expect(popup).toBeVisible();
  return popup.evaluate((menu) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.m-context-menu-item')];
    const box = menu.getBoundingClientRect();
    return {
      items: items.length,
      glyphless: items.filter((item) => item.querySelector('.m-context-menu__icon svg') === null).map((item) => item.textContent),
      offsets: [
        ...new Set(
          items.map((item) => {
            const title = item.querySelector<HTMLElement>(':scope > span:not(.m-context-menu__icon):not(.m-context-menu-chord)');
            return Math.round((title?.getBoundingClientRect().left ?? 0) - item.getBoundingClientRect().left);
          }),
        ),
      ],
      heights: [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().height)))],
      inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
    };
  });
}

function expectOneColumn(reading: Reading): void {
  // A SEARCH, so it must find something: a menu with no items passes every rule below.
  expect(reading.items).toBeGreaterThan(0);
  expect(reading.glyphless).toStrictEqual([]);
  expect(reading.offsets).toHaveLength(1);
  expect(reading.heights).toStrictEqual([30]);
  expect(reading.inside).toBe(true);
}

test('the PAGE, SELECTED-TEXT and TAB menus each draw a glyph on every item, every title at one edge', async ({ page }) => {
  // THE TEXT LAYER is built from main's read of the page's lines, which the shim answers from these.
  await openApp(page, { pageLines: [['Annual report — page 1', 'Revenue grew across all three regions']] });
  await openDocument(page);

  await page.locator('.m-page-list .m-page-slot').first().click({ button: 'right' });
  expectOneColumn(await readOpenMenu(page));
  await page.keyboard.press('Escape');

  const line = page.locator('[data-text-layer="0"] [data-text-line="0"]');
  await expect(line).toHaveCount(1);
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has no box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => document.getSelection()?.toString().trim() ?? '')).not.toBe('');
  await line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  const selection = await readOpenMenu(page);
  expectOneColumn(selection);
  // CONTROL: this is the selection's menu, which is the longest, not the page's again.
  expect(selection.items).toBeGreaterThan(6);
  await page.keyboard.press('Escape');

  await page.locator('.m-tab').first().click({ button: 'right' });
  expectOneColumn(await readOpenMenu(page));
});

/**
 * Whether the open right-click menu shows every item without scrolling, and lies inside the window.
 * `scrollHeight` against `clientHeight`, because a menu that scrolls hides its bar (the owner's N2) and so looks whole.
 */
async function readWhole(page: Page): Promise<{ items: number; scrolls: boolean; inside: boolean; top: number }> {
  const popup = page.locator('.m-area-menu');
  await expect(popup).toBeVisible();
  // SETTLED: the positioner places the popup after it is measured, so read once its box has stopped moving.
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await popup.boundingBox());
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return popup.evaluate((menu) => {
    const box = menu.getBoundingClientRect();
    return {
      items: menu.querySelectorAll('.m-context-menu-item').length,
      scrolls: menu.scrollHeight > menu.clientHeight + 1,
      inside: box.top >= 0 && box.bottom <= window.innerHeight,
      top: Math.round(box.top),
    };
  });
}

test('M1: a right-click menu lists every item without scrolling, and moves up to fit when opened low', async ({ page }) => {
  await openApp(page, { pageLines: [['Annual report — page 1', 'Revenue grew across all three regions']] });
  await openDocument(page);
  const line = page.locator('[data-text-layer="0"] [data-text-line="0"]');
  await expect(line).toHaveCount(1);
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has no box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const openSelectionMenu = (): Promise<void> => line.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });
  await openSelectionMenu();
  const items = (await readWhole(page)).items;
  // THE SELECTION'S MENU, the longest, not the page's.
  expect(items).toBeGreaterThan(6);
  await page.keyboard.press('Escape');

  // A WINDOW WHOSE HALF IS SHORTER THAN THAT MENU: the cap the owner saw cut off a 14-item menu at 1280 × 800, in the
  // proportion this harness's menu needs to meet it.
  const height = Math.floor(items * 30 * 1.6);
  await page.setViewportSize({ width: 1280, height });
  await openSelectionMenu();
  const tall = await readWhole(page);
  expect(tall.items).toBe(items);
  expect({ scrolls: tall.scrolls, inside: tall.inside }).toStrictEqual({ scrolls: false, inside: true });
  await page.keyboard.press('Escape');

  // LOW IN THE WINDOW: too little room below the pointer, so the menu moves up to fit rather than scrolling or running
  // past the window's foot.
  const area = await page.locator('.m-page-list').boundingBox();
  if (area === null) throw new Error('the page list has no box');
  const y = area.y + area.height - 12;
  await page.mouse.click(area.x + area.width / 2, y, { button: 'right' });
  const low = await readWhole(page);
  expect({ scrolls: low.scrolls, inside: low.inside }).toStrictEqual({ scrolls: false, inside: true });
  // AND IT MOVED: its top is above the pointer, where a menu opened downwards would start.
  expect(low.top).toBeLessThan(y);
  await page.keyboard.press('Escape');
});
