import { type Locator, type Page, expect } from '@playwright/test';

/**
 * The two steps Edit text opens a block in (ADR-0271 section 3), as the rendered tests take them: a press on the block's
 * outline selects its box, and Enter on the box (or a second press inside it) puts the caret in its words.
 */

/** The open editor's words. */
export const SURFACE = '[data-kit-surface]';
/** The open editor's frame. */
export const FRAME = '[data-kit-frame]';

/** Selects `outline`'s box: the frame is up and has the focus, and no caret is in the words yet. */
export async function selectBox(page: Page, outline: Locator): Promise<void> {
  await outline.click();
  await expect(page.locator(FRAME)).toBeFocused({ timeout: 10_000 });
  await expect(page.locator(FRAME)).toHaveAttribute('data-kit-mode', 'box');
}

/** Selects `outline`'s box and puts the caret at the end of its words, by Enter on the box. */
export async function openWords(page: Page, outline: Locator): Promise<void> {
  await selectBox(page, outline);
  await page.keyboard.press('Enter');
  await expect(page.locator(SURFACE)).toBeFocused();
}
