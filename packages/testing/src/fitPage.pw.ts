import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * FIT PAGE shows exactly one page and Page Down moves exactly one (the owner's review of 0.1.8.0: at 1600 × 852 and 63%,
 * a strip of the next page showed under page 1). Only a browser lays out a pane, so only this can measure it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f2');

interface Shown {
  readonly pages: readonly number[];
  readonly above: number;
  readonly below: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly pageWidth: number;
}

/** Which pages' slots any part of lies inside the scroller, and the room above and below the first of them. */
function shown(page: Page): Promise<Shown> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.m-page-list');
    if (list === null) throw new Error('no page list');
    const view = list.getBoundingClientRect();
    const slots = [...list.querySelectorAll<HTMLElement>('.m-page-slot')].map((slot) => slot.getBoundingClientRect());
    const pages = slots.flatMap((box, at) => (box.height > 0 && box.bottom > view.top + 0.5 && box.top < view.bottom - 0.5 ? [at] : []));
    const first = slots[pages[0] ?? 0];
    return {
      pages,
      above: first === undefined ? Number.NaN : first.top - view.top,
      below: first === undefined ? Number.NaN : view.bottom - first.bottom,
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      pageWidth: first?.width ?? 0,
    };
  });
}

async function open(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  const bytes = await blockedPages([612, 792], 3);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]')).toHaveCount(1);
}

for (const size of [
  { width: 1600, height: 852 },
  { width: 1280, height: 800 },
]) {
  test(`FIT PAGE at ${String(size.width)} × ${String(size.height)} shows exactly one page, centred, and Page Down moves one whole page`, async ({
    page,
  }) => {
    await open(page, size);
    await page.keyboard.press('Control+0');
    await expect.poll(async () => (await shown(page)).pages).toStrictEqual([0]);
    const first = await shown(page);
    // CENTRED: the room above and below the page agree to a pixel.
    expect(Math.abs(first.above - first.below), JSON.stringify(first)).toBeLessThanOrEqual(1);
    expect(first.above).toBeGreaterThan(0);

    // PAGE DOWN, from the pages themselves, as a reader presses it: one whole page on, no part of another.
    await page.locator('.m-page-list').focus();
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await shown(page)).pages, { timeout: 5_000 }).toStrictEqual([1]);
    const second = await shown(page);
    expect(Math.abs(second.above - second.below), JSON.stringify(second)).toBeLessThanOrEqual(1);
  });
}

// FIT WIDTH, SEPARATELY: the page spans the pane less its gutter and the pane never scrolls sideways. Several pages
// may show, which is what a width fit is.
for (const size of [
  { width: 1600, height: 852 },
  { width: 1280, height: 800 },
]) {
  test(`FIT WIDTH at ${String(size.width)} × ${String(size.height)} fills the width and never scrolls sideways`, async ({ page }) => {
    await open(page, size);
    await page.keyboard.press('Control+1');
    await expect.poll(async () => (await shown(page)).pageWidth).toBeGreaterThan(300);
    await page.waitForTimeout(400);
    const fit = await shown(page);
    expect(fit.scrollWidth, JSON.stringify(fit)).toBeLessThanOrEqual(fit.clientWidth);
    expect(fit.pageWidth).toBeGreaterThan(fit.clientWidth - 40);
  });
}
