// @ts-check
/**
 * The Compare walk (HHHHHHH-5): the owner's recording of 0.1.9.0 showed the right pane of Side by Side moving up and down
 * by itself for about 15 s after Compare. `sideBySide.pw.ts` holds the behaviour in Chromium under the browser shim and
 * did not reproduce it; what it lacks is the defect's environment — Electron on Windows, the real engine, real files.
 * This walk is that environment, through `liveWalk.mjs`.
 *
 *   node scripts/research/compareWalk.mjs [<right-hand .pdf>]
 *
 * The left document is made here by pdf-lib, one page of text, standing in for the owner's `text-page.pdf`, which is not
 * in the test files; the right is `_review/test-files/sample5.pdf`, five pages of mixed sizes, unless another is named.
 *
 * Each pane's `scrollTop` is read on every animation frame for 15 s from the moment Side by Side shows. The record keeps
 * every reading; the step asserts that after the first 2 s, while the panes draw, neither pane moves. CONTROL, in the
 * same step: a scroll the walk makes itself during a second recording is seen, so a recorder that could not see a
 * movement cannot pass for a pane that did not move.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { root, startWalk } from './liveWalk.mjs';

const walk = await startWalk('compare');
const { page, output, open, command, step, finish } = walk;

const right = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const left = join(output, 'input-text-page.pdf');
const made = await PDFDocument.create();
const font = await made.embedFont(StandardFonts.Helvetica);
const sheet = made.addPage([612, 792]);
for (let line = 0; line < 30; line += 1) {
  sheet.drawText(`Quarterly totals for the north region, line ${String(line + 1)}`, { font, size: 12, x: 72, y: 720 - line * 20 });
}
await writeFile(left, await made.save());

/** Each pane's scrollTop on every frame for `ms`. @param {number} ms @param {number} [nudgeAt] a time to scroll the right pane by 120 */
const record = (ms, nudgeAt) =>
  page.evaluate(
    ({ duration, nudge }) =>
      new Promise((resolve) => {
        // THE PAGE'S OWN GLOBALS, read through `globalThis`: this file is typed and linted for Node, where neither exists.
        const shown = /** @type {{ querySelector: (selector: string) => { scrollTop: number } | null }} */ (Reflect.get(globalThis, 'document'));
        const nextFrame = /** @type {(callback: () => void) => void} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
        /** @type {{ t: number; left: number; right: number }[]} */
        const frames = [];
        const start = performance.now();
        const pane = (/** @type {string} */ side) => shown.querySelector(`[data-side-half="${side}"] .m-page-list`);
        let nudged = false;
        const frame = () => {
          const t = performance.now() - start;
          if (nudge !== undefined && !nudged && t >= nudge) {
            const target = pane('right');
            if (target !== null) target.scrollTop += 120;
            nudged = true;
          }
          frames.push({ t: Math.round(t), left: pane('left')?.scrollTop ?? Number.NaN, right: pane('right')?.scrollTop ?? Number.NaN });
          if (t < duration) nextFrame(frame);
          else resolve(frames);
        };
        nextFrame(frame);
      }),
    { duration: ms, nudge: nudgeAt },
  );

await step('HHHHHHH-5: after Compare, neither pane moves by itself for 15 s; a scroll the walk makes is seen', async () => {
  await open(left);
  await open(right);
  await command('Compare documents…');
  const surface = page.locator('section[data-side-by-side]');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(surface.locator('[data-side-half="right"] canvas.m-page').first()).toBeVisible({ timeout: 30_000 });

  const frames = /** @type {{ t: number; left: number; right: number }[]} */ (await record(15_000));
  const settled = frames.filter((frame) => frame.t >= 2_000);
  const leftValues = [...new Set(settled.map((frame) => frame.left))];
  const rightValues = [...new Set(settled.map((frame) => frame.right))];
  await writeFile(join(output, 'scroll-frames.json'), JSON.stringify(frames));

  // CONTROL: the same recorder, with a scroll the walk makes 1 s in.
  const nudged = /** @type {{ t: number; left: number; right: number }[]} */ (await record(2_000, 1_000));
  const seen = new Set(nudged.map((frame) => frame.right)).size;

  expect(seen, 'the recorder sees a scroll the walk made').toBeGreaterThanOrEqual(2);
  expect(rightValues, 'the right pane after the first 2 s').toHaveLength(1);
  expect(leftValues, 'the left pane after the first 2 s').toHaveLength(1);
  return {
    frames: frames.length,
    rightValuesFirst2s: [...new Set(frames.filter((frame) => frame.t < 2_000).map((frame) => frame.right))].length,
    rightValuesAfter: rightValues,
    leftValuesAfter: leftValues,
    controlSaw: seen,
  };
});

await finish();
