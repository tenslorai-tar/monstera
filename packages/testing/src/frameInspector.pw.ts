import { expect, test } from '@playwright/test';

import { installInspector, unfinishedNow } from './frameInspector.js';

/**
 * The frame inspector reads only what is ON SCREEN: a canvas with some part inside every ancestor that clips it and the
 * window. A canvas the page list mounts below the fold and draws ahead was read as on screen, and its transparent
 * pixels, which nobody could see, as an unfinished screen: the tab-switch case failed on Ubuntu CI that way
 * (2026-10-19, "frame 6 at 131 ms: page 2 transparent pixel", the second page's canvas starting at 1031 px below a
 * scroller ending at 747).
 *
 * Two canvases in one scroller, each unfinished in its own way so the report says which was read: the first, in view,
 * is painted white with no dark block; the second, below the fold, is left transparent.
 */
const SCROLLER = `
  <div class="m-page-list" style="height: 300px; overflow: auto; width: 320px">
    <canvas class="m-page" width="200" height="200" style="display: block"></canvas>
    <div style="height: 900px"></div>
    <canvas class="m-page" width="200" height="200" style="display: block"></canvas>
  </div>
  <script>
    const first = document.querySelectorAll('canvas.m-page')[0].getContext('2d');
    first.fillStyle = '#ffffff';
    first.fillRect(0, 0, 200, 200);
  </script>`;

test('the frame inspector reads a canvas inside the view, and not one below the fold', async ({ page }) => {
  await installInspector(page, 'body');
  await page.goto('about:blank');
  await page.setContent(SCROLLER);
  expect(await unfinishedNow(page)).toStrictEqual(['page 1 no dark pixel (painted, not drawn)']);
});

test('CONTROL: the canvas below the fold is read once it is scrolled into the view', async ({ page }) => {
  await installInspector(page, 'body');
  await page.goto('about:blank');
  await page.setContent(SCROLLER);
  await page.locator('.m-page-list').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight;
  });
  expect(await unfinishedNow(page)).toStrictEqual(['page 1 transparent pixel']);
});
