import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The rulers, and the loupe beside them, once the reader has scrolled (the owner's review of 0.1.6.0: the vertical
 * ruler showed numbers for page 1 only and disappeared on scrolling down).
 *
 * Both were absolutely positioned children of the scroll container, which lays them out in its scrolled content; so
 * every case here scrolls first, because at the top of the document the defect and the fix draw the same thing.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000b8');
/** A letter page is eleven inches tall: no mark on a page's own run can read more. */
const PAGE_INCHES = 11;

async function openScrolledToSecondPage(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 3);
  await bridge(page, {
    settings: { 'viewing.rulers': true, 'viewing.ruler-unit': 'in', ...settings },
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-slot')).toHaveCount(3);
  await expect(page.locator('.m-ruler-v')).toBeVisible();
  // PAGE 2'S TOP 200 px INTO THE SCROLLER: a whole screen of scrolling at any fit, with page 1's foot above it.
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.m-page-list');
    const second = document.querySelectorAll<HTMLElement>('.m-page-slot')[1];
    if (scroller === null || second === undefined) throw new Error('a scroller and a second page');
    scroller.scrollTop += second.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 200;
  });
}

test('the VERTICAL RULER stays beside the scroller once scrolled, and starts page 2 at its own 0', async ({ page }) => {
  await openScrolledToSecondPage(page, {});

  const read = (): Promise<{ ruler: number; scroller: number; zero: boolean; highest: number; scrolled: number }> =>
    page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.m-page-list');
      const ruler = document.querySelector<HTMLElement>('.m-ruler-v');
      const second = document.querySelectorAll<HTMLElement>('.m-page-slot')[1];
      if (scroller === null || ruler === null || second === undefined) throw new Error('the three boxes');
      const top = second.getBoundingClientRect().top;
      const majors = [...ruler.querySelectorAll<HTMLElement>('.m-tick-major')].map((tick) => ({
        top: tick.getBoundingClientRect().top,
        label: Number(tick.textContent),
      }));
      return {
        ruler: ruler.getBoundingClientRect().top,
        scroller: scroller.getBoundingClientRect().top,
        zero: majors.some((tick) => tick.label === 0 && Math.abs(tick.top - top) <= 1.5),
        highest: Math.max(...majors.map((tick) => tick.label)),
        scrolled: scroller.scrollTop,
      };
    });

  await expect.poll(async () => (await read()).zero, { timeout: 5_000 }).toBe(true);
  const after = await read();
  // THE PREMISE: the scroller did move by more than a screen's worth of ruler.
  expect(after.scrolled).toBeGreaterThan(400);
  // ON SCREEN, level with the scroller it measures, rather than carried up and away with page 1.
  expect(Math.abs(after.ruler - after.scroller)).toBeLessThanOrEqual(1);
  // AND EVERY NUMBER IS A PAGE'S OWN: a run zeroed on page 1 reads past eleven down page 2.
  expect(after.highest).toBeLessThanOrEqual(PAGE_INCHES);
});

test('the LOUPE sits under the pointer once the pages are scrolled', async ({ page }) => {
  await openScrolledToSecondPage(page, { 'viewing.loupe': true });
  const second = page.locator('.m-page-slot').nth(1);
  const box = await second.boundingBox();
  if (box === null) throw new Error('page 2 is laid out');
  const at = { x: box.x + box.width / 2, y: Math.max(box.y, 0) + 120 };
  await page.mouse.move(at.x, at.y - 10);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  const loupe = page.locator('.m-loupe-at');
  await expect(loupe).toBeVisible();
  const centre = await loupe.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(Math.abs(centre.x - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(centre.y - at.y)).toBeLessThanOrEqual(2);
});
