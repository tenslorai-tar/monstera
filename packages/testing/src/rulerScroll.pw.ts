import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { samplePdf } from './helpScreensHarness.js';
import { pageShown } from './settled.js';

/**
 * A SCROLL MOVES EACH PAGE'S RULER RUN AND REDRAWS NO MARK (cloud-4 item 9f).
 *
 * Measured 2026-10-04 on Chromium 151, an 8 s wheel scroll over forty dense pages at 1.5x: every ruler mark was keyed
 * by its offset from the RULER'S start, so each frame removed and inserted all of them — 3,644 elements, each insert
 * re-matching the canvas area's `:has()` rules — at a frame p95 of 100 ms and 80 of 196 frames over 33 ms. With each
 * page's marks placed from the page's own zero (`pageRuns`), the same scroll ran 466 frames at a p95 of 16.8 ms.
 *
 * This holds the property rather than the timing, which a runner cannot measure steadily: a scroll that brings no page
 * onto or off the ruler inserts and removes no mark, while the runs it moves do move.
 */
test('a short scroll moves the vertical ruler’s runs and inserts or removes no mark', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await samplePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000a1');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'report.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await pageShown(page);
  const ruler = page.locator('.m-ruler-v');
  await expect(ruler.locator('.m-tick').first()).toBeAttached();
  // PAGES 1 AND 2 BOTH ON THE RULER, neither near its edge, so the scroll below brings no page onto it or off it. From
  // 200 the next page's top came on during the scroll (measured: 1 run before, 2 after).
  const scroller = page.locator('.m-page-list').first();
  await scroller.evaluate((element) => {
    element.scrollTop = 400;
  });
  await page.waitForTimeout(300);

  const reading = await page.evaluate(async () => {
    const strip = document.querySelector('.m-ruler-v');
    const list = document.querySelector<HTMLElement>('.m-page-list');
    if (strip === null || list === null) throw new Error('no ruler or no page list');
    const runsBefore = strip.querySelectorAll('.m-ruler-run').length;
    // WHERE EACH LABELLED MARK IS ON SCREEN, by its label: a reading of the ruler a person sees, whatever builds it.
    const labelled = (): Map<string, number> =>
      new Map(
        [...strip.querySelectorAll<HTMLElement>('.m-tick-major')]
          .reverse()
          .map((mark) => [mark.textContent, mark.getBoundingClientRect().top] as const),
      );
    const marksBefore = labelled();
    let marksInserted = 0;
    let marksRemoved = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('m-tick')) marksInserted += 1;
        for (const node of record.removedNodes) if (node instanceof HTMLElement && node.classList.contains('m-tick')) marksRemoved += 1;
      }
    });
    observer.observe(strip, { childList: true, subtree: true });
    const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
    for (let step = 0; step < 12; step += 1) {
      // 7 PX, NOT A MULTIPLE OF THE MARKS' SPACING: a step equal to it lines the old keys up again one mark along,
      // and marks keyed from the ruler's start then look almost kept (measured: 12 of 59 at 9 px).
      list.scrollTop += 7;
      await frame();
      await frame();
    }
    observer.disconnect();
    const marksAfter = labelled();
    const moved = [...marksBefore].flatMap(([label, top]) => {
      const now = marksAfter.get(label);
      return now === undefined ? [] : [top - now];
    });
    return {
      runsBefore,
      runsAfter: strip.querySelectorAll('.m-ruler-run').length,
      moved,
      marksInserted,
      marksRemoved,
      marks: strip.querySelectorAll('.m-tick').length,
    };
  });

  // PREMISE: the same pages were on the ruler throughout, and it has marks to keep.
  expect(reading.runsAfter, JSON.stringify(reading)).toBe(reading.runsBefore);
  expect(reading.marks).toBeGreaterThan(20);
  // THE RULER ANSWERED THE SCROLL: every labelled mark seen before and after moved up by the 84 px scrolled — a ruler
  // that stopped updating would also insert nothing.
  expect(reading.moved.length, JSON.stringify(reading)).toBeGreaterThan(0);
  expect(reading.moved.every((distance) => Math.abs(distance - 84) < 1), JSON.stringify(reading)).toBe(true);
  // AND NO MARK WAS INSERTED OR REMOVED.
  expect([reading.marksInserted, reading.marksRemoved], JSON.stringify(reading)).toStrictEqual([0, 0]);
});
