import { type Page, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * THE PAGE LAYOUTS ON HOME › DISPLAY ARE REACHABLE AT EVERY WIDTH (the owner's decision of 2026-11-05 moved them there
 * from Tools). Each of the five is either its own button, drawn inside the window, or a member of a *More* that is, so a
 * narrow window folds them and never drops them. And each, pressed from where it is drawn, turns on and shows checked.
 */

const FIVE = ['view.page-layout-single', 'view.page-layout-continuous', 'view.page-layout-pair', 'view.page-layout-facing', 'view.cover-page'];
/** The three that stand after the layouts (the owner's decision of 2026-11-06), so a narrowing window folds them first. */
const AFTER = ['view.toggle-split', 'view.toggle-dark-page', 'document.compare'];

/** Where each command can be reached on the drawn ribbon now: its own button, a *More* holding it, or nowhere. */
function reach(page: Page, ids: readonly string[] = FIVE): Promise<Record<string, 'button' | 'more' | 'none'>> {
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
  }, ids);
}

for (const width of [1920, 1280, 1024, 900, 760]) {
  test(`at ${String(width)} wide, every page layout on Home › Display is a button or in a More inside the window`, async ({ page }) => {
    await openApp(page);
    await page.setViewportSize({ width, height: 800 });
    await openDocument(page);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.locator('.m-ribbon__tools .m-ribbon__group').first()).toBeVisible();
    const found = await reach(page, ['view.fit-width', 'view.fit-page', ...FIVE, ...AFTER]);
    test.info().annotations.push({ type: 'reach', description: JSON.stringify(found) });
    expect(FIVE.filter((id) => found[id] === 'none'), JSON.stringify(found)).toStrictEqual([]);
    // THE FOLD TAKES THE GROUP'S END FIRST: while any layout is folded, none of the three after them is still a button.
    if (FIVE.some((id) => found[id] === 'more')) expect(AFTER.filter((id) => found[id] === 'button'), JSON.stringify(found)).toStrictEqual([]);
  });
}

test('at 1920 wide, each page layout pressed from Home › Display turns on and shows checked, and Tools no longer holds them', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openDocument(page);
  const rail = page.getByRole('navigation', { name: 'Sections' });
  await rail.getByRole('button', { name: 'Tools', exact: true }).click();
  // CONTROL FIRST: the Tools section is drawn and holds Show rulers, which stays there, and none of the five.
  await expect(page.locator('.m-ribbon__tools [data-command="view.toggle-rulers"]')).toBeVisible();
  for (const id of FIVE) await expect(page.locator(`.m-ribbon__tools [data-command="${id}"]`)).toHaveCount(0);
  await rail.getByRole('button', { name: 'Home', exact: true }).click();
  for (const id of ['view.page-layout-pair', 'view.page-layout-facing', 'view.page-layout-single', 'view.page-layout-continuous']) {
    const button = page.locator(`.m-ribbon__tools [data-command="${id}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  const cover = page.locator('.m-ribbon__tools [data-command="view.cover-page"]');
  await cover.click();
  await expect(cover).toHaveAttribute('aria-pressed', 'true');
});
