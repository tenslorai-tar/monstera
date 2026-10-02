import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The menus, in a real browser: every popup can be used where it overlaps the window's drag rows, and a disabled
 * item looks disabled.
 *
 * ## What Chromium can and cannot show here
 *
 * The defect lives in Electron: a press inside a `drag` region goes to the window frame, not the page, whatever is
 * painted over it, so *Help › Help centre*, the first item and lying over the title bar, took no hover and no click.
 * Chromium alone honours no drag region, so a click here succeeds either way and would prove nothing. What it CAN
 * read is the computed `app-region` of each element, which is what Electron derives its regions from. So the case
 * asserts the two premises — the title bar is `drag`, and the item lies over it — and then the thing that decides
 * the outcome: the item and its popup compute `no-drag`. The live click is confirmed on the installed build.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c5');

async function openDocument(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'menus.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
}

/** An element's own computed `app-region`: `none` where it declares nothing. */
function appRegion(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).getPropertyValue('app-region') || 'none');
}

/**
 * The region an element lies in: the nearest element, itself or an ancestor, that declares one. `app-region` is not
 * inherited — Electron builds its regions from the boxes that declare one, and a later `no-drag` box subtracts from
 * the `drag` boxes under it — so an item with no region of its own is in its popup's.
 */
function regionOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const region = getComputedStyle(at).getPropertyValue('app-region');
      if (region !== '' && region !== 'none') return region;
    }
    return 'none';
  });
}

test('HELP › HELP CENTRE, lying over the title bar, is a no-drag region, and opens the Help centre', async ({ page }) => {
  await openDocument(page);
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  const item = page.getByRole('menuitem', { name: 'Help centre' });
  await expect(item).toBeVisible();

  // THE PREMISES: the title bar is a drag region, and the item lies over it. Without the second the case would pass
  // for a menu that happened to open below the row, which is the shape where nothing was ever wrong.
  const titleBar = page.locator('.m-title-bar');
  expect(await appRegion(titleBar)).toBe('drag');
  const bar = await titleBar.boundingBox();
  const box = await item.boundingBox();
  if (bar === null || box === null) throw new Error('the title bar and the item have boxes');
  expect(box.y < bar.y + bar.height && box.y + box.height > bar.y).toBe(true);

  // WHAT DECIDES IT: the item lies in a no-drag region, its popup's.
  expect(await regionOf(item)).toBe('no-drag');
  expect(await appRegion(page.locator('.m-menu-bar__popup'))).toBe('no-drag');

  await item.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('EVERY POSITIONED POPUP is a no-drag region: the context menu and a tooltip as well as a menu', async ({ page }) => {
  await openDocument(page);
  await page.locator('.m-page-list .m-page-slot').first().click({ button: 'right' });
  const contextMenu = page.locator('.m-context-menu').first();
  await expect(contextMenu).toBeVisible();
  expect(await appRegion(contextMenu)).toBe('no-drag');
  await page.keyboard.press('Escape');

  // A TOOLTIP, from the document panel's tab strip, whose tabs are the Tooltip primitive's triggers.
  await page.locator('[data-panel-tab]').first().hover();
  const tooltip = page.locator('.m-tooltip').first();
  await expect(tooltip).toBeVisible({ timeout: 5_000 });
  expect(await regionOf(tooltip)).toBe('no-drag');
});

/** Each item's title offset from its own edge, and its chord's gap to its own end, in one open popup. */
async function itemGeometry(page: Page, popup: string): Promise<{ title: number; chordGap: number | null }[]> {
  return page.evaluate((selector) => {
    const items = [...document.querySelectorAll<HTMLElement>(`${selector} .m-context-menu-item`)];
    return items.map((item) => {
      const box = item.getBoundingClientRect();
      const spans = [...item.querySelectorAll<HTMLElement>(':scope > span')];
      const chord = item.querySelector<HTMLElement>('.m-context-menu-chord');
      const title = spans.find((span) => span !== chord && span.textContent.trim() !== '');
      return {
        title: Math.round((title?.getBoundingClientRect().left ?? box.left) - box.left),
        chordGap: chord === null ? null : Math.round(box.right - chord.getBoundingClientRect().right),
      };
    });
  }, popup);
}

test('EVERY MENU lines its items up: each title at one offset, each chord at the item’s end', async ({ page }) => {
  // The menu bar's items carried a grid class and a flex class with `space-between`; the flex rule came later and
  // won, so each title floated towards the middle at an offset that depended on its own width. A title offset that
  // varies from item to item is exactly that; one offset everywhere is the grid the menu bar meant.
  await openDocument(page);
  const menus = ['File', 'Edit', 'View', 'Organize', 'Comment', 'Forms', 'Review', 'Protect', 'Tools', 'Window', 'Help'];
  const report: Record<string, unknown> = {};
  for (const name of menus) {
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(page.locator('.m-menu-bar__popup')).toBeVisible();
    const items = await itemGeometry(page, '.m-menu-bar__popup');
    const offsets = new Set(items.map((item) => item.title));
    const loose = items.filter((item) => item.chordGap !== null && item.chordGap > 12);
    if (items.length === 0 || offsets.size !== 1 || loose.length > 0) report[name] = { offsets: [...offsets], loose };
    await page.keyboard.press('Escape');
  }

  await page.locator('.m-page-list .m-page-slot').first().click({ button: 'right' });
  await expect(page.locator('.m-context-menu').first()).toBeVisible();
  const context = await itemGeometry(page, '.m-context-menu');
  const contextOffsets = new Set(context.map((item) => item.title));
  if (context.length === 0 || contextOffsets.size !== 1 || context.some((item) => item.chordGap !== null && item.chordGap > 12)) {
    report['context menu'] = context;
  }

  expect(report).toStrictEqual({});
});

test('a DISABLED menu item looks disabled: muted, and no highlight under the pointer', async ({ page }) => {
  await openDocument(page);
  // EDIT, where Undo has nothing to undo on a document nobody has changed: a disabled item beside enabled ones.
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const disabled = page.locator('.m-menu-bar__popup [role="menuitem"][data-disabled]').first();
  const enabled = page.locator('.m-menu-bar__popup [role="menuitem"]:not([data-disabled])').first();
  await expect(disabled).toBeVisible();
  await expect(enabled).toBeVisible();

  const colour = (locator: Locator): Promise<string> => locator.evaluate((element) => getComputedStyle(element).color);
  const muted = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    document.querySelector('.m-menu-bar__popup')?.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(await colour(disabled)).toBe(muted);
  expect(await colour(enabled)).not.toBe(muted);

  await disabled.hover();
  const background = await disabled.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgba(0, 0, 0, 0)');
  expect(await disabled.evaluate((element) => getComputedStyle(element).cursor)).toBe('default');
});
