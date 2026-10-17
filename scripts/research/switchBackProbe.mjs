// @ts-check
/**
 * The switch back to a PARKED tab, timed (the owner's addendum 2, item 4, step 4 — a gate: fully drawn within 1 s,
 * median): from the tab's click until its viewport is on show and every page canvas visible in it is painted, read once
 * a frame inside the page. Each document is opened beside a second, left behind for 70 s so its layer parks
 * (ADR-0129's correction of 2026-10-17, `PARK_AFTER_MS` 60 s), then clicked; RUNS times. The same switch with no time
 * behind, so nothing parked, is timed too as the comparison. Where the time goes is read from the performance marks
 * `PageList` leaves (`monstera:parsed`, `monstera:first-frame`), relative to the click.
 *
 * Nothing names the documents: each is reported by its size in bytes.
 *
 * Usage (Windows): node scripts/research/switchBackProbe.mjs <runs> <a .pdf> [<a .pdf> ...]
 */

import { copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { root, startWalk } from './liveWalk.mjs';

const [runsArg, ...documents] = process.argv.slice(2);
const RUNS = Number(runsArg ?? '5');
if (documents.length === 0) throw new Error('name at least one document to time');
const { page, output, open, step, finish } = await startWalk('switch-back');
const filler = join(output, 'filler.pdf');
await copyFile(join(root, '_review/test-files/sample5.pdf'), filler);

/**
 * Clicks the tab of `docId` inside the page and answers, in ms from the click: when the layer on show was its and every
 * visible page canvas in it painted, and when each `monstera:` mark after the click was left.
 * @param {string} docId
 */
async function timedSwitch(docId) {
  return page.evaluate(async (id) => {
    // THE PAGE'S GLOBALS THROUGH `globalThis`, `frameTimes.mjs`' way: this callback runs in the page, and the scripts'
    // compiler has no DOM library to type it.
    const w = /** @type {any} */ (globalThis);
    /** @param {any} canvas */
    const painted = (canvas) => {
      if (canvas.width === 0 || canvas.height === 0) return false;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let at = 3; at < data.length; at += 4 * 97) if (data[at] === 0) return false;
      return true;
    };
    const tab = w.document.querySelector(`[data-tab-select="${id}"]`);
    if (tab === null) throw new Error('no such tab');
    performance.clearMarks();
    const clicked = performance.now();
    tab.click();
    const drawnAt = await new Promise((resolve) => {
      const tick = () => {
        const shown = w.document.querySelector('[data-document-layer="active"]');
        const selected = tab.getAttribute('aria-current') === 'true';
        /** @type {any[]} */
        const canvases =
          shown === null
            ? []
            : [...shown.querySelectorAll('.m-page-list canvas.m-page')].filter((/** @type {any} */ each) =>
                each.checkVisibility({ visibilityProperty: true }),
              );
        if (selected && canvases.length > 0 && canvases.every(painted)) {
          resolve(performance.now() - clicked);
          return;
        }
        if (performance.now() - clicked > 30_000) {
          resolve(-1);
          return;
        }
        w.requestAnimationFrame(tick);
      };
      w.requestAnimationFrame(tick);
    });
    const marks = Object.fromEntries(
      performance
        .getEntriesByType('mark')
        .filter((mark) => mark.name.startsWith('monstera:') && mark.startTime >= clicked)
        .map((mark) => [mark.name, Math.round(mark.startTime - clicked)]),
    );
    return { drawnMs: Math.round(Number(drawnAt)), marks };
  }, docId);
}

/** @param {number[]} values */
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { readings: values, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
};

for (const [index, path] of documents.entries()) {
  const bytes = (await stat(path)).size;
  await step(`S${String(index + 1)}. a ${String(bytes)}-byte document, switched back to after 70 s behind, ${String(RUNS)} times`, async () => {
    const copy = join(output, `timed-${String(index + 1)}.pdf`);
    await copyFile(path, copy);
    await open(copy);
    const layer = page.locator('[data-document-layer="active"] .m-page-list canvas.m-page').first();
    await expect(layer).toBeVisible({ timeout: 60_000 });
    const timedId = await page.locator('[data-tab-select]').last().getAttribute('data-tab-select');
    await open(filler);
    await expect(page.locator('[data-tab-select]')).toHaveCount(2, { timeout: 30_000 });
    const fillerId = await page.locator('[data-tab-select]').last().getAttribute('data-tab-select');
    if (timedId === null || fillerId === null) throw new Error('a tab has no document id');
    await page.waitForTimeout(3_000);
    /** @type {{ drawnMs: number, marks: Record<string, number> }[]} */
    const parked = [];
    /** @type {{ drawnMs: number, marks: Record<string, number> }[]} */
    const kept = [];
    for (let run = 0; run < RUNS; run += 1) {
      // KEPT: back and forth at once, so the layer is behind for seconds and not parked.
      await timedSwitch(fillerId);
      await page.waitForTimeout(2_000);
      kept.push(await timedSwitch(timedId));
      await page.waitForTimeout(2_000);
      // PARKED: behind for 70 s, past the minute and the 5 s check.
      await timedSwitch(fillerId);
      await page.waitForTimeout(70_000);
      await expect(page.locator('[data-document-layer="parked"]')).toHaveCount(1);
      parked.push(await timedSwitch(timedId));
      await page.waitForTimeout(2_000);
    }
    // EACH DOCUMENT ALONE for the next: both tabs closed.
    for (let left = 2; left > 0; left -= 1) {
      await page.locator('[data-tab-close]').first().click();
      await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
    }
    return {
      bytes,
      parked: { ...summary(parked.map((each) => each.drawnMs)), marks: parked.map((each) => each.marks) },
      notParked: summary(kept.map((each) => each.drawnMs)),
    };
  });
}

await finish();
