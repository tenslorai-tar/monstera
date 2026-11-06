import { type Page, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * EVERY HOME TOOL, AT EVERY WIDTH (the owner's decision of 2026-11-06, ADR-0284's correction of that date): Home is
 * built as Comment and Tools are, with small and icon sizes (ADR-0194), so at 1280 x 800 every one of its tools is its
 * own button and no group draws a More; and at every width each is a button or in a More drawn inside the window.
 *
 * THE LIST IS WRITTEN OUT, not read from the ribbon: a tool that left Home would leave a list read from it too, and
 * the case would agree (CLAUDE.md item 4c). A tool added to Home and not here is caught the other way, by the case that
 * every Home button drawn at 1920 is one of these.
 */

const HOME = [
  'document.open',
  'document.save',
  'document.print',
  'document.undo',
  'document.redo',
  'annotate.select',
  'view.hand',
  'view.select-text',
  'annotate.highlight',
  'annotate.sticky-note',
  'annotate.signature',
  'view.fit-width',
  'view.fit-page',
  'view.page-layout-single',
  'view.page-layout-continuous',
  'view.page-layout-pair',
  'view.page-layout-facing',
  'view.cover-page',
  'view.toggle-split',
  'view.toggle-dark-page',
  'document.compare',
  'document.export-page-images',
  'document.export-word',
  'document.email',
];

async function openHome(page: Page, width: number): Promise<void> {
  await openApp(page);
  await page.setViewportSize({ width, height: 800 });
  await openDocument(page);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.m-ribbon__tools .m-ribbon__group').first()).toBeVisible();
}

/** Where each Home tool can be reached on the drawn ribbon now: its own button, a More holding it, or nowhere. */
function reach(page: Page): Promise<Record<string, 'button' | 'more' | 'none'>> {
  return page.evaluate((ids) => {
    const inWindow = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight;
    };
    const tools = document.querySelector('.m-ribbon__tools');
    const answer: Record<string, 'button' | 'more' | 'none'> = {};
    for (const id of ids) {
      const own = [...(tools?.querySelectorAll(`[data-command="${id}"]`) ?? [])].some(inWindow);
      const more = [...(tools?.querySelectorAll(`[data-holds~="${id}"]`) ?? [])].some(inWindow);
      answer[id] = own ? 'button' : more ? 'more' : 'none';
    }
    return answer;
  }, HOME);
}

/** The fold Mores drawn on the Home row: a group's, or the row's own. Export's named menu holds commands too, and is not one. */
function foldMores(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.m-ribbon__tools [data-holds]')]
      .filter((element) => /^More\b/u.test(element.getAttribute('aria-label') ?? element.textContent.trim()))
      .map((element) => element.getAttribute('data-holds') ?? ''),
  );
}

for (const width of [1920, 1280, 1024, 900, 760]) {
  test(`at ${String(width)} x 800 every Home tool is its own button or in a More inside the window`, async ({ page }) => {
    await openHome(page, width);
    const found = await reach(page);
    test.info().annotations.push({ type: 'reach', description: JSON.stringify(found) });
    expect(HOME.filter((id) => found[id] === 'none'), JSON.stringify(found)).toStrictEqual([]);
  });
}

test('at 1280 x 800 every Home tool is its own button and no group on Home draws a More', async ({ page }) => {
  await openHome(page, 1280);
  const found = await reach(page);
  expect(HOME.filter((id) => found[id] !== 'button'), JSON.stringify(found)).toStrictEqual([]);
  expect(await foldMores(page)).toStrictEqual([]);
});

test('CONTROL: at 900 x 800 a fold More is drawn and found, so the empty answer at 1280 is the fold and not the reading', async ({ page }) => {
  await openHome(page, 900);
  expect((await foldMores(page)).length).toBeGreaterThan(0);
});

test('at 1920 every Home button drawn is one this case lists, so a tool added to Home must be listed', async ({ page }) => {
  await openHome(page, 1920);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('.m-ribbon__tools [data-command]')].map((element) => element.getAttribute('data-command') ?? ''));
  expect([...new Set(drawn)].sort()).toStrictEqual([...HOME].sort());
});

test('at 1280 x 800 Tab reaches every Home tool, the icon and small ones included', async ({ page }) => {
  await openHome(page, 1280);
  // FROM THE FIRST HOME BUTTON, forward through the row: each focused control's command is recorded.
  await page.locator('.m-ribbon__tools [data-command="document.open"]').focus();
  const reached = new Set<string>();
  for (let press = 0; press < 80 && reached.size < HOME.length; press += 1) {
    const id = await page.evaluate(() => document.activeElement?.closest('[data-command]')?.getAttribute('data-command') ?? '');
    if (id !== '') reached.add(id);
    await page.keyboard.press('Tab');
  }
  expect(HOME.filter((id) => !reached.has(id))).toStrictEqual([]);
});

test('at 1280 x 800 the small and icon Home buttons each work and show checked when on', async ({ page }) => {
  await openHome(page, 1280);
  const button = (id: string) => page.locator(`.m-ribbon__tools [data-command="${id}"]`);
  // THE SMALL TOOLS IN QUICK TOOLS: each, pressed, is the one shown checked.
  for (const id of ['view.hand', 'annotate.select']) {
    await button(id).click();
    await expect(button(id)).toHaveAttribute('aria-pressed', 'true');
  }
  // Text is checked when no tool is on, which pressing it makes true.
  await button('view.select-text').click();
  await expect(button('view.select-text')).toHaveAttribute('aria-pressed', 'true');
  await expect(button('annotate.select')).toHaveAttribute('aria-pressed', 'false');
  // THE SECONDARY SMALL TOOLS IN DISPLAY.
  await button('view.toggle-dark-page').click();
  await expect(button('view.toggle-dark-page')).toHaveAttribute('aria-pressed', 'true');
  await button('view.toggle-split').click();
  await expect(button('view.toggle-split')).toHaveAttribute('aria-pressed', 'true');
  // THE ICONS IN FILE: named for a screen reader, since the label is not drawn.
  await expect(button('document.undo')).toHaveAccessibleName(/^Undo\b/u);
  await expect(button('document.redo')).toHaveAccessibleName(/^Redo\b/u);
});
