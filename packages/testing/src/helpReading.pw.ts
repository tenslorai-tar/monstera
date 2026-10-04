import { AxeBuilder } from '@axe-core/playwright';
import { type Locator, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * The Help centre reads at the content size (the owner's item 19a), at the two window sizes it was asked at.
 *
 * Measured before the change, 2026-10-04 on Chromium 151: the article's text, its lists, its Show me row, Back to the
 * list and the list's titles and summaries were all 12 px; the article's title 14.04 px (the browser's h3, 1.17em of
 * 12) and a section heading 12 px, the size of the text under it. These cases assert the sizes the content scale gives,
 * that each heading level is a step above the next, that the buttons are the size of the sentence beside them, and that
 * nothing runs past the article at either size.
 */

const BLOCKING = new Set(['serious', 'critical']);

async function sizeOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 760, height: 560 },
]) {
  test(`at ${String(size.width)} x ${String(size.height)} a Help article and its list read at the content size, a step at each heading`, async ({
    page,
  }) => {
    await openApp(page);
    await openDocument(page);
    await page.setViewportSize(size);
    await page.keyboard.press('F1');
    const dialog = page.getByRole('dialog', { name: 'Help centre' });
    await dialog.getByRole('textbox', { name: 'Search help' }).fill('theme');

    // THE LIST: each article's title and summary.
    const item = dialog.locator('.m-help__item[data-article="theme-and-accent"]');
    expect(await sizeOf(item.locator('.m-help__item-title'))).toBe(14);
    expect(await sizeOf(item.locator('.m-help__item-summary'))).toBe(14);
    await item.click();

    const article = dialog.locator('.m-help__article');
    const text = await sizeOf(article.locator('p').first());
    expect(text).toBe(14);
    expect(await sizeOf(article.locator('li').first())).toBe(text);
    // A STEP AT EACH LEVEL: the title above a section's heading, and that above the text.
    const title = await sizeOf(article.locator('h3'));
    const section = await sizeOf(article.locator('h4').first());
    expect(title).toBe(20);
    expect(section).toBe(16);
    expect(title).toBeGreaterThan(section);
    expect(section).toBeGreaterThan(text);
    // IN STEP: Show me's words, its buttons and Back to the list are the size of the article's sentences.
    const show = dialog.locator('.m-help__show');
    await expect(show.getByRole('button')).not.toHaveCount(0);
    expect(await sizeOf(show.locator('span[aria-hidden]'))).toBe(text);
    expect(await sizeOf(show.getByRole('button').first())).toBe(text);
    expect(await sizeOf(dialog.getByRole('button', { name: 'Back to the list' }))).toBe(text);

    // NOTHING RUNS PAST THE ARTICLE, or past the dialog's scroll, at this size.
    const overflow = await dialog.evaluate((root) => {
      const scroll = root.querySelector('.m-dialog-scroll');
      const body = root.querySelector('.m-help__article');
      if (scroll === null || body === null) throw new Error('the article is not drawn in the dialog scroll');
      const edge = scroll.getBoundingClientRect().right;
      const wide = [...body.querySelectorAll('*')]
        .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
        .map((element) => element.tagName);
      return { scroll: scroll.scrollWidth - scroll.clientWidth, wide };
    });
    expect(overflow.wide).toStrictEqual([]);
    expect(overflow.scroll).toBeLessThanOrEqual(0);

    const results = await new AxeBuilder({ page }).include('.m-dialog').analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(blocking, blocking.map((violation) => `${String(violation.impact)}: ${violation.id}`).join('\n')).toEqual([]);
  });
}
