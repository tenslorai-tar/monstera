import { displayLocationSchema } from '@monstera/contract';
import { asFileHandle } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Room between the start screen's recent cards and its footer (the owner's item 19b), at the two sizes it was asked at.
 *
 * With four recent files the start screen is taller than the window at both, so the footer, stuck to the window's
 * foot, is what the cards scroll under. Scrolled to the end, measured 2026-10-04 on Chromium 151, the last card's foot
 * WAS the footer's top (−0.3 px): the list follows the start screen in the scroll, so the screen's padding never
 * reached below it.
 */

const ENTRIES = ['Annual report.pdf', 'Site survey.pdf', 'Board minutes.pdf', 'Lease.pdf'].map((name, at) => ({
  handle: asFileHandle(`handle-${String(at)}`),
  name,
  location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
  openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
  availability: 'available' as const,
}));

for (const size of [
  { width: 1280, height: 800 },
  { width: 1600, height: 852 },
]) {
  test(`at ${String(size.width)} x ${String(size.height)} the recent cards end clear of the footer, scrolled to the end`, async ({ page }) => {
    await page.setViewportSize(size);
    await bridgeUnder(page, LOOKS[0], { recent: ENTRIES });
    await page.goto('/');
    await expect(page.locator('.m-recent-item')).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const reading = await page.evaluate(() => {
      const area = document.querySelector('.m-start-area');
      const footer = document.querySelector('.m-start-footer');
      if (area === null || footer === null) throw new Error('the start screen is not drawn');
      area.scrollTop = area.scrollHeight;
      const cards = [...document.querySelectorAll('.m-recent-item')].map((card) => card.getBoundingClientRect().bottom);
      return {
        scrolls: area.scrollHeight - area.clientHeight,
        atEnd: area.scrollHeight - area.clientHeight - area.scrollTop,
        gap: footer.getBoundingClientRect().top - Math.max(...cards),
      };
    });
    // CONTROL: the list is taller than the window here, so the footer is one the cards meet rather than one far below.
    expect(reading.scrolls).toBeGreaterThan(0);
    expect(reading.atEnd).toBeLessThanOrEqual(1);
    // THE SCREEN'S RHYTHM UNDER THE LAST CARD: --space-24, less a fractional pixel of layout.
    expect(reading.gap).toBeGreaterThanOrEqual(23);
  });
}
