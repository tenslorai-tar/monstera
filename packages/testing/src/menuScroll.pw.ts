import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A menu that is longer than its room draws NO scrollbar and still scrolls, and says there is more by a fade at the edge
 * it continues past (the owner's N2). Every menu is the one popup class (`.m-context-menu`), so the menu bar's Edit menu
 * in a short window is the rule measured. Rendered on pinned Chromium: scrollbars and scroll timelines are layout.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d7');

async function openEdit(page: Page, height: number): Promise<Locator> {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1280, height });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'menus.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
  await page.locator('.m-menu-bar__trigger[data-menu="edit"]').click();
  const popup = page.locator('.m-menu-bar__popup').first();
  await expect(popup).toBeVisible();
  return popup;
}

/** The popup's scroll state, whether a bar takes any width, and how opaque each fade is now. */
function state(popup: Locator) {
  return popup.evaluate((element) => {
    const scroller = element as HTMLElement;
    const style = getComputedStyle(scroller);
    const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return {
      overflows: scroller.scrollHeight > scroller.clientHeight + 1,
      // NOT THE BAR'S WIDTH, which this harness cannot see: Playwright starts headless Chromium with
      // `--hide-scrollbars`, so a bar measures 0 with or without the rule (measured 2026-10-13 by removing it). What is
      // read is the menu's own computed rule, which removing the declaration turns back to `auto`; the bar on screen is
      // the walk's to see.
      scrollbarWidth: style.scrollbarWidth,
      barWidth: scroller.offsetWidth - border - scroller.clientWidth,
      scrollTop: scroller.scrollTop,
      above: Number(getComputedStyle(scroller, '::before').opacity),
      below: Number(getComputedStyle(scroller, '::after').opacity),
    };
  });
}

test('a menu longer than its room scrolls with no bar, and fades where more items are', async ({ page }) => {
  const popup = await openEdit(page, 360);
  const first = await state(popup);
  expect(first.overflows).toBe(true);
  expect(first.scrollbarWidth).toBe('none');
  expect(first.barWidth).toBe(0);
  // AT THE TOP: more below, nothing above.
  expect([first.above, first.below]).toStrictEqual([0, 1]);

  // THE WHEEL STILL SCROLLS IT.
  const box = await popup.boundingBox();
  if (box === null) throw new Error('the menu is not drawn');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect.poll(async () => (await state(popup)).scrollTop).toBeGreaterThan(0);
  const end = await state(popup);
  // AT THE END: more above, nothing below.
  expect([end.above, end.below]).toStrictEqual([1, 0]);

  // AND THE KEYS: Home focuses the first item and scrolls the menu back to show it, whole.
  await page.keyboard.press('Home');
  const firstItem = popup.getByRole('menuitem').first();
  await expect(firstItem).toBeFocused();
  await expect
    .poll(async () => {
      const [item, menu] = await Promise.all([firstItem.boundingBox(), popup.boundingBox()]);
      return item !== null && menu !== null && item.y >= menu.y && item.y + item.height <= menu.y + menu.height;
    })
    .toBe(true);
  expect((await state(popup)).scrollTop).toBeLessThan(end.scrollTop);
});

test('CONTROL: the same menu with room for every item has nothing to scroll and shows no fade', async ({ page }) => {
  // TALL ENOUGH THAT HALF THE WINDOW, the menu's own bound, holds every item.
  const popup = await openEdit(page, 2000);
  const roomy = await state(popup);
  expect(roomy.overflows).toBe(false);
  expect([roomy.above, roomy.below]).toStrictEqual([0, 0]);
});
