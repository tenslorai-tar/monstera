import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * The command palette closes by every route, from every place focus can be — in a real browser.
 *
 * ## Why this is a Playwright run and not another unit case
 *
 * The palette would not close in a live session on 2026-09-17, and its unit cases were green throughout: they fired
 * a key AT an element the case chose, and happy-dom moves focus on no click. Where focus goes when a person clicks is
 * the browser's answer, not the component's, so these cases click where a person clicks and press keys through the
 * keyboard, and assert on whether the palette is there — never on where the case put focus itself.
 *
 * Each case carries its own control: the palette is asserted OPEN after the click and before the key, so a route that
 * closed on the click cannot pass as one that closed on the key. Studio's overlay has its cases beside its own in
 * `renderedScreen.pw.ts`, which already opens a document for it.
 */

const PALETTE = '.m-palette';

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await expect(page.locator(PALETTE)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bridge(page);
  await page.goto('/');
  await expect(page.locator('.m-title-bar')).toBeVisible();
});

test('Escape where focus LANDS on open — the query field', async ({ page }) => {
  await openPalette(page);
  await expect(page.locator('.m-palette-query')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('Escape after a click on the palette’s HEADER', async ({ page }) => {
  await openPalette(page);
  await page.locator(`${PALETTE} .m-dialog__title`).click();
  await expect(page.locator(PALETTE)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('Escape from wherever TAB takes focus inside it — a control whose tooltip opens takes one first', async ({
  page,
}) => {
  await openPalette(page);
  await page.keyboard.press('Tab');
  // WHEREVER Tab took it, it is inside the palette — the trap's promise — and not the field any more.
  const inside = await page.evaluate(
    (selector) => document.querySelector(selector)?.contains(document.activeElement) === true,
    PALETTE,
  );
  expect(inside).toBe(true);
  await expect(page.locator('.m-palette-query')).not.toBeFocused();

  // TAB REACHES THE CLOSE CONTROL since the results became options rather than tab stops, and
  // focusing it opens its tooltip. Escape then dismisses the TOPMOST layer — the tooltip — and the
  // next one the palette, which is what a layered surface does everywhere. Asserted rather than
  // hidden behind one key press, so a change in either layer is visible here.
  const tooltip = page.locator('.m-tooltip');
  await expect(tooltip).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator(PALETTE)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('a press OUTSIDE — on the page below it', async ({ page }) => {
  await openPalette(page);
  await page.mouse.click(640, 700);
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('a press on the TITLE BAR — its own control is under the backdrop, and the press still closes it', async ({ page }) => {
  // MEASURED BEFORE OPENING: once the modal is up, the rest of the window is out of the accessibility tree, so the
  // control can no longer be found by its role — which is the trap working, not the control missing.
  const search = await page.locator('.m-title-bar').getByRole('button', { name: /Search commands/u }).boundingBox();
  if (search === null) throw new Error('the title bar carries the command search');
  await openPalette(page);
  await page.mouse.click(search.x + search.width / 2, search.y + search.height / 2);
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('its own CHORD, Ctrl+K, pressed while it is open', async ({ page }) => {
  await openPalette(page);
  await page.keyboard.press('Control+K');
  await expect(page.locator(PALETTE)).toHaveCount(0);
  // CONTROL: the chord opens it again, so the line above is a toggle and not a chord that only closes.
  await openPalette(page);
});

test('its CLOSE control', async ({ page }) => {
  await openPalette(page);
  await page.locator(PALETTE).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('draws no horizontal scrollbar — its field and rows fit the popup', async ({ page }) => {
  // Seen live 2026-09-18: 100%-wide rows under the default content box overflowed the popup by their padding.
  await openPalette(page);
  const overflow = await page.evaluate((selector) => {
    const body = document.querySelector(`${selector} .m-dialog__body`);
    return body === null ? null : body.scrollWidth - body.clientWidth;
  }, PALETTE);
  expect(overflow).toBe(0);
});
