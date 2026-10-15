import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The reading list holds pixels for the pages in use: on screen, and the one page ahead (ADR-0247, the owner's 13d).
 *
 * Pages 200 points tall, so two or three are on screen at 1280 × 800. Before ADR-0247 the list held the pages on screen
 * alone (its one-viewport margin never reached past the scroll box, measured 2026-10-15), so the page ahead being held
 * is what this change adds, and the page after it not being held is the limit of what it adds.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000e7');

async function open(
  page: Page,
  physicalMemory?: number,
  settings?: Record<string, unknown>,
  sent?: { channel: string; params: unknown }[],
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([300, 200], 30);
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'short.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      ...(physicalMemory === undefined ? {} : { physicalMemory }),
      ...(settings === undefined ? {} : { settings }),
    },
    (channel, params) => {
      sent?.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

/** Which pages cross the scroller's box, and which hold pixels: a page canvas with a backing store. */
function read(page: Page): Promise<{ onScreen: number[]; holding: number[] }> {
  return page.evaluate(() => {
    const scroller = document.querySelector('[aria-label="Document pages"]');
    const box = scroller?.getBoundingClientRect();
    const onScreen: number[] = [];
    const holding: number[] = [];
    for (const slot of document.querySelectorAll<HTMLElement>('.m-page-slot[data-page]')) {
      const at = Number(slot.dataset['page']);
      const rect = slot.getBoundingClientRect();
      if (box !== undefined && rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom) onScreen.push(at);
      const canvas = slot.querySelector<HTMLCanvasElement>('canvas.m-page');
      if (canvas !== null && canvas.width > 0) holding.push(at);
    }
    return { onScreen, holding };
  });
}

test('the reading list holds pixels for the pages on screen and the one page ahead, and none beyond', async ({ page }) => {
  await open(page);
  // SETTLED: every page on screen and the page after the last of them are drawn.
  await expect
    .poll(async () => {
      const { onScreen, holding } = await read(page);
      const ahead = Math.max(...onScreen) + 1;
      return onScreen.every((at) => holding.includes(at)) && holding.includes(ahead);
    })
    .toBe(true);
  const { onScreen, holding } = await read(page);
  const last = Math.max(...onScreen);
  expect(holding.filter((at) => !onScreen.includes(at))).toStrictEqual([last + 1]);
  expect(holding).not.toContain(last + 2);

  // SCROLLED ON, the pages left behind give their pixels back and the page ahead moves with the screen.
  await page.locator('[aria-label="Document pages"]').evaluate((scroller) => {
    scroller.scrollTop = 1200;
  });
  await expect
    .poll(async () => {
      const now = await read(page);
      const beyond = now.holding.filter((at) => !now.onScreen.includes(at));
      return beyond.length === 1 && beyond[0] === Math.max(...now.onScreen) + 1 && !now.holding.includes(0);
    })
    .toBe(true);
});

test('with a limit smaller than the pages on screen, those are still drawn and the page ahead is not', async ({ page }) => {
  // 1.6 MB of physical memory: Automatic is 400 KB, below the two pages on screen (300 × 200 pixels, 240 KB each).
  await open(page, 1.6 * 1000 * 1000);
  await expect
    .poll(async () => {
      const { onScreen, holding } = await read(page);
      return onScreen.every((at) => holding.includes(at));
    })
    .toBe(true);
  // A MOMENT FOR THE PAGE AHEAD to have been drawn had it been allowed, as it is in the case above.
  await page.waitForTimeout(500);
  const { onScreen, holding } = await read(page);
  expect(holding.filter((at) => !onScreen.includes(at))).toStrictEqual([]);
});

// FIRST USE (ADR-0247 Decision 4): thumbnails are made when the Pages tab is chosen, and search data when a query runs.
test('the thumbnails are made when the Pages tab is chosen, and no page is searched before a query', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await open(page, undefined, { 'appearance.document-panel': 'bookmarks' }, sent);
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  // ANOTHER TAB SHOWN: no thumbnail exists, drawn or not.
  await page.waitForTimeout(300);
  await expect(page.locator('[data-thumb-page]')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Pages' }).click();
  // CHOSEN: the cards exist and the first is drawn, the control that the strip can be made at all.
  await expect(page.locator('[data-thumb-page="0"] canvas')).toBeAttached();
  await expect.poll(() => page.locator('[data-thumb-page="0"] canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);

  // NO PAGE SEARCHED while the document has been read, scrolled and its strip drawn.
  const searched = (): number => sent.filter(({ channel }) => channel === 'document.searchPage').length;
  expect(searched()).toBe(0);
  await page.keyboard.press('Control+F');
  await page.keyboard.type('page');
  await page.keyboard.press('Enter');
  // THE QUERY RUNS, and only then are pages read for it: the control that search goes through this channel at all.
  await expect.poll(searched).toBeGreaterThan(0);
});
