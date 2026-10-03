import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';
import { popupPlaced, settled } from './settled.js';

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
  // for a menu that happened to open below the row, which is the shape where nothing was ever wrong. While a menu is
  // open the whole row is no-drag (the rule beside `.m-title-bar`), so its region is read on a closed menu.
  const titleBar = page.locator('.m-title-bar');
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();
  expect(await appRegion(titleBar)).toBe('drag');
  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await expect(item).toBeVisible();
  // PLACED, not only visible: an unplaced menu sits at the window's origin, over the title bar whatever is wrong.
  const box = await popupPlaced(page, item, 'the Help menu’s item');
  const bar = await titleBar.boundingBox();
  if (bar === null) throw new Error('the title bar has a box');
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
  // ITS GLYPH IS MUTED WITH IT: the icon strokes in the item's own colour, and CONTROL, the enabled one's does not.
  const stroke = (locator: Locator): Promise<string> =>
    locator.locator('.m-menu-bar__icon svg').evaluate((svg) => getComputedStyle(svg).color);
  expect(await stroke(disabled)).toBe(muted);
  expect(await stroke(enabled)).not.toBe(muted);
});

// AN OPEN MENU CLOSES ON A PRESS ANYWHERE OUTSIDE IT (the owner's review of 0.1.8.0, where it closed only on a press in
// the document). What decides it in Electron is the region: a press in a `drag` region goes to the window frame and the
// page never sees it. So each case asserts the row's computed region is `no-drag` WHILE the menu is open and `drag`
// again once it closes (CONTROL: it is `drag` before), and then that the page's own handling closes the menu. The real
// press on the window frame is the local agent's to confirm on Windows.
for (const where of ['the empty MENU ROW', 'the empty TITLE BAR'] as const) {
  test(`a press on ${where} closes an open menu, which made that row no-drag while it was open`, async ({ page }) => {
    await openDocument(page);
    const row = where === 'the empty MENU ROW' ? page.locator('.m-menu-bar') : page.locator('.m-title-bar');
    expect(await appRegion(row)).toBe('drag');
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
    const popup = page.locator('.m-menu-bar__popup');
    await expect(popup).toBeVisible();
    expect(await appRegion(row)).toBe('no-drag');
    // AN EMPTY STRETCH of the row: right of the last menu on the menu row, between the tabs and the search on the title
    // bar — a point where the row's own topmost element is the row or a part of it no person can press, read rather
    // than assumed. Read through every layer, because an open menu lays Base UI's own transparent overlay over the
    // window, and that overlay is what the press lands on — in Electron too, once the row under it is no-drag.
    const point = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const y = box.top + box.height / 2;
      for (let x = box.right - 40; x > box.left; x -= 8) {
        const hit = document.elementsFromPoint(x, y).find((each) => element.contains(each));
        const pressable = hit?.closest('button, input, select, textarea, a, [role="menuitem"], [role="tab"], [role="menu"]');
        const covered = document.elementFromPoint(x, y)?.closest('[role="menu"]') !== null;
        if (hit !== undefined && (pressable === null || pressable === undefined) && !covered) return { x, y };
      }
      return null;
    });
    expect(point, `an empty point on ${where}`).not.toBeNull();
    await page.mouse.click(point?.x ?? 0, point?.y ?? 0);
    await expect(popup).toBeHidden();
    expect(await appRegion(row)).toBe('drag');
  });
}

test('a press on the OPEN menu’s title closes it; Esc closes it; and hover switches menus only while one is open', async ({ page }) => {
  await openDocument(page);
  const bar = page.getByRole('menubar');
  const file = bar.getByRole('menuitem', { name: 'File', exact: true });
  const edit = bar.getByRole('menuitem', { name: 'Edit', exact: true });
  const popup = page.locator('.m-menu-bar__popup');
  // CLOSED, A HOVER OPENS NOTHING.
  await edit.hover();
  await page.waitForTimeout(300);
  await expect(popup).toHaveCount(0);
  // OPEN, a hover moves to the menu under the pointer.
  await file.click();
  await expect(popup).toBeVisible();
  await edit.hover();
  await expect(edit).toHaveAttribute('aria-expanded', 'true');
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  // A PRESS ON THE OPEN MENU'S OWN TITLE closes it.
  await edit.click();
  await expect(popup).toBeHidden();
  // ESC closes one too.
  await file.click();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
});

// EVERY MENU, EVERY ITEM (the owner's review of 0.1.8.0: the menus listed text only): each item draws a glyph in the
// one icon column, so every title starts at the same edge, and the menu fits the window — the View menu ran 74 px past
// a 1280 × 800 window while each item drew 38 px for v5's 30, and its last items could not be reached.
test('every MENU draws a glyph for every item in one column, titles aligned, and fits the window at 1280 × 800', async ({ page }) => {
  await openDocument(page);
  const triggers = page.locator('.m-menu-bar__trigger');
  const names = await triggers.allTextContents();
  expect(names.length).toBeGreaterThan(8);
  for (const name of names) {
    await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
    const popup = page.locator('.m-menu-bar__popup');
    await expect(popup).toBeVisible();
    // PLACED: an unplaced popup sits at the window's top, which passes "inside the window" whatever is wrong.
    await popupPlaced(page, popup, `the ${name} menu`);
    const read = await popup.evaluate((menu) => {
      const items = [...menu.querySelectorAll<HTMLElement>('.m-menu-bar__item')];
      const box = menu.getBoundingClientRect();
      return {
        count: items.length,
        bare: items.filter((item) => item.querySelector('.m-menu-bar__icon svg') === null).map((item) => item.textContent),
        titleEdges: [...new Set(items.map((item) => Math.round(item.querySelector('.m-menu-bar__title')?.getBoundingClientRect().left ?? -1)))],
        heights: [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().height)))],
        inside: box.top >= 0 && box.bottom <= window.innerHeight,
      };
    });
    expect(read.count, name).toBeGreaterThan(0);
    expect(read.bare, name).toStrictEqual([]);
    expect(read.titleEdges, name).toHaveLength(1);
    expect(read.heights, name).toStrictEqual([30]);
    expect(read.inside, name).toBe(true);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
  }
});

/**
 * A rounding pixel. The cap is half the window exactly; this is the sub-pixel a box's edge may land on, never a share
 * of the window, so a menu at 52% fails.
 */
const ROUNDING = 1;

// NO MENU IS TALLER THAN HALF THE WINDOW (the owner's correction N6): a menu as tall as the room below its trigger
// covered the page the reader was working on, and on a short window its items ran to the bottom edge. Every menu on the
// row is read at the default window and the narrowest; one that holds more than half a window of items scrolls inside,
// and the keyboard keeps the item it reaches on screen.
for (const size of [
  { width: 1280, height: 800 },
  { width: 760, height: 560 },
] as const) {
  test(`at ${String(size.width)} × ${String(size.height)} every MENU is at most half the window, ends inside it, and a long one scrolls with ArrowDown’s item in view`, async ({
    page,
  }) => {
    await openDocument(page);
    await page.setViewportSize(size);
    const triggers = page.locator('.m-menu-bar__trigger');
    const names = await triggers.allTextContents();
    expect(names.length).toBeGreaterThan(8);
    const popup = page.locator('.m-menu-bar__popup');
    const report: Record<string, unknown> = {};
    const long: string[] = [];
    for (const name of names) {
      await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
      await expect(popup).toBeVisible();
      await popupPlaced(page, popup, `the ${name} menu`);
      const read = await popup.evaluate((menu) => {
        const box = menu.getBoundingClientRect();
        return {
          height: box.height,
          top: box.top,
          bottom: box.bottom,
          window: window.innerHeight,
          scrolls: menu.scrollHeight > menu.clientHeight + 1,
          overflow: getComputedStyle(menu).overflowY,
        };
      });
      if (read.height > read.window / 2 + ROUNDING || read.bottom > read.window || read.top < 0) report[name] = read;
      if (read.scrolls) {
        long.push(name);
        // IT SCROLLS WITH A SCROLLBAR the platform draws, not a clipped box: `auto` draws one exactly when it overflows.
        if (read.overflow !== 'auto') report[`${name} overflow`] = read.overflow;
      }
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
    expect(report).toStrictEqual({});

    // NOT VACUOUS: at least one menu holds more than half a window of items at this size, so the scrolling half below
    // has a menu to read. The cap's own control is the report above, which names every menu taller than half without it.
    expect(long.length, 'a menu longer than half the window').toBeGreaterThan(0);

    for (const name of long) {
      await page.getByRole('menubar').getByRole('menuitem', { name, exact: true }).click();
      await expect(popup).toBeVisible();
      // ARROWDOWN TO THE LAST ITEM the keyboard can reach — a disabled item is passed over — and no further.
      const last = popup.locator('[role="menuitem"]:not([data-disabled]), [role="menuitemcheckbox"]:not([data-disabled])').last();
      const count = await popup.locator('[role="menuitem"], [role="menuitemcheckbox"]').count();
      for (let press = 0; press <= count && (await last.getAttribute('data-highlighted')) === null; press += 1) {
        await page.keyboard.press('ArrowDown');
      }
      await expect(last, name).toHaveAttribute('data-highlighted', '');
      // READ ONCE THE SCROLL HAS STOPPED: the highlight is set before the item is scrolled into view.
      const seen = await settled(page, () => popup.evaluate((menu) => {
        const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].filter(
          (item) => !item.hasAttribute('data-disabled'),
        );
        const item = items[items.length - 1];
        const view = menu.getBoundingClientRect();
        const style = getComputedStyle(menu);
        const top = view.top + parseFloat(style.borderTopWidth);
        const bottom = top + menu.clientHeight;
        const box = item?.getBoundingClientRect();
        return { scrolled: menu.scrollTop, inside: box !== undefined && box.top >= top - 0.5 && box.bottom <= bottom + 0.5 };
      }), () => true, `the ${name} menu after ArrowDown`);
      expect(seen.scrolled, `${name} scrolled`).toBeGreaterThan(0);
      expect(seen.inside, `${name}: the last item is inside the menu's visible box`).toBe(true);
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
  });
}
