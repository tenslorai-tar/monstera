import { expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * A dialog opened from the keyboard draws no ring around ITSELF, and its controls still draw theirs.
 *
 * `Dialog.tsx` puts focus on the popup when it opens. Opened by a key — F1 here — that focus is
 * `:focus-visible` in Chromium, which drew its default ring around the whole dialog: the owner's
 * noted defect. Whether a focus is *visible* is the browser's heuristic, so this is a Playwright run
 * against real Chromium; happy-dom has no such heuristic and would pass with the rule deleted.
 *
 * The first case asserts the popup IS `:focus-visible` before reading its outline, so it cannot
 * pass for a popup that simply was not focused. The second is the control: Tab onto the Close button
 * and its ring is there, so the rule did not remove rings from the dialog's contents.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bridge(page);
  await page.goto('/');
  await expect(page.locator('.m-title-bar')).toBeVisible();
});

test('the popup a key opened is focus-visible and draws no outline', async ({ page }) => {
  await page.keyboard.press('F1');
  const popup = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(popup).toBeFocused();
  expect(await popup.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  expect(await popup.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
});

test('CONTROL: Tab onto its Close button, and that control draws its ring', async ({ page }) => {
  await page.keyboard.press('F1');
  const popup = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(popup).toBeFocused();
  await page.keyboard.press('Tab');
  const close = popup.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  expect(await close.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
});
