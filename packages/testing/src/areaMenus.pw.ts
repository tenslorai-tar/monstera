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
