import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';
import { pageShown, settled as settledOn } from './settled.js';

/**
 * The ribbon's fold holds still while the selection changes, read frame by frame in a real browser.
 *
 * ## The mechanism this holds shut
 *
 * The shell's command context depends on the text selection, so every change of selection builds new ribbon
 * section objects. The fold was keyed on the section's IDENTITY and dropped the widths it had measured when that
 * changed, so each change drew the row unfolded for a frame, measured it overflowing and folded it again: the
 * Comment section, which does not fit unfolded, flickered between its folded and unfolded rows for as long as text
 * was selected (the owner's review of 0.1.6.0, `ribbonfold_29.6` and `ribbonfold_29.75`). Home, Forms and Review
 * fit unfolded, which is why only Comment showed it.
 *
 * ## What a frame records
 *
 * How many command buttons the row draws. A fold is a pure function of the row's width and its buttons, so at one
 * width that number may take one value only, however often the selection moves.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000b4');

async function drawnButtons(page: Page): Promise<number> {
  return page.locator('.m-ribbon__tools [data-command]').count();
}

test('the COMMENT ribbon keeps one fold while a text selection changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'words.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
    pageLines: [['Quarterly totals for the north region', 'Revenue rose on the strength of new contracts']],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(2);

  await page.getByRole('navigation').getByRole('button', { name: 'Comment', exact: true }).first().click();
  // THE ROW HAS FOLDED: at this width the Comment section does not fit unfolded, so its row More is drawn. Without
  // it the case below would pass for a row that never folds, which is the one shape that cannot oscillate.
  await expect(page.locator('.m-ribbon__tools button.m-ribbon__more').first()).toBeVisible({ timeout: 10_000 });
  // THE FOLD AT REST AND THE PAGE SHOWN, in place of a 300 ms sleep: the count the case compares against is the one
  // the row holds once it has stopped changing, and the line pressed below is only on screen after the first frame.
  await pageShown(page);
  const settled = await settledOn(page, () => drawnButtons(page), () => true, 'the folded Comment row');

  await page.evaluate(() => {
    const state = { counts: [] as number[], running: true };
    (window as unknown as { __fold: typeof state }).__fold = state;
    const read = (): void => {
      if (!state.running) return;
      state.counts.push(document.querySelectorAll('.m-ribbon__tools [data-command]').length);
      requestAnimationFrame(read);
    };
    requestAnimationFrame(read);
  });

  // A SELECTION THAT CHANGES, as a person drags across a line: each step moves the selection's end.
  const line = page.locator('[data-text-layer="0"] [data-text-line]').first();
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first text line has a box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(box.x + 2 + (box.width * step) / 12, box.y + box.height / 2);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);

  const counts = await page.evaluate(() => {
    const state = (window as unknown as { __fold: { counts: number[]; running: boolean } }).__fold;
    state.running = false;
    return state.counts;
  });
  // THE SELECTION REACHED THE SHELL: something is selected. Without it the frames below say nothing about a
  // selection, since none happened.
  expect(await page.evaluate(() => document.getSelection()?.toString().length ?? 0)).toBeGreaterThan(0);
  expect(counts.length).toBeGreaterThan(10);
  expect({ settled, others: [...new Set(counts)].filter((count) => count !== settled) }).toStrictEqual({ settled, others: [] });
});
