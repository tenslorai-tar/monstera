import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * A SELECTION ACROSS LINES READS WITH A SPACE WHERE EACH LINE ENDS (cloud run 24, the launch recording of 1.1.2610.0): a
 * sentence selected over three lines was quoted to the assistant as *provided thatall fees are payablenotwithstanding*.
 * Each line of the text layer is its own element holding that line's words and no separator, so the platform's text of
 * the range, its copy and the selection's own text all join the last word of one line to the first of the next
 * (measured in Chromium 151, 2026-10-29). The text is now read once, by `readTextSelection`, and every reader takes it:
 * the copy, *Search for this*, and the assistant's four items.
 *
 * Every selection here is a hand's drag across the words, and every read is a reader's own: the clipboard after Ctrl+C,
 * and the find field after the menu's *Search for this*.
 */

const LINES = [
  'The licence continues in force provided that',
  'all fees are paid in full, and remain payable',
  'notwithstanding any notice to end it given by a',
  'party who has not paid them. Any well-',
  'known exception applies. ',
  'The last line of the clause.',
].map((text, index) => ({ text, box: { x0: 72, y0: 120 + index * 16, x1: 72 + Math.round(text.length * 4.9), y1: 134 + index * 16 } }));

async function open(page: Page): Promise<void> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of LINES) sheet.drawText(line.text, { x: line.box.x0, y: 792 - line.box.y1 + 3.5, size: 11, font });
  const bytes = await document.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e7');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'licence.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLinesPlaced: [LINES],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES.length);
  await pageShown(page);
}

/**
 * A hand's drag from the start of line `from` to 6 pt past the end of line `to`, in a dozen moves. Placed by the page's
 * own points through the layer's box: a line element's own box on screen is scaled with the text fitted into it, so
 * its right edge is not where its words end.
 */
async function drag(page: Page, from: number, to: number): Promise<void> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  const first = LINES[from];
  const last = LINES[to];
  if (layer === null || first === undefined || last === undefined) throw new Error('no text layer');
  const scale = layer.width / 612;
  const middle = (line: (typeof LINES)[number]): number => layer.y + ((line.box.y0 + line.box.y1) / 2) * scale;
  await page.mouse.move(layer.x + (first.box.x0 + 0.5) * scale, middle(first));
  await page.mouse.down();
  await page.mouse.move(layer.x + (last.box.x1 + 6) * scale, middle(last), { steps: 12 });
  await page.mouse.up();
}

/** What Ctrl+C put on the clipboard. */
async function copied(page: Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('Control+C');
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('a copy of a selection across three lines puts a space where each line ends', async ({ page }) => {
  await open(page);
  await drag(page, 0, 2);
  const text = await copied(page);
  // THE CONTROL IS TODAY'S JOIN: *thatall* and *payablenotwithstanding*, the words of two lines run together.
  expect(text).not.toContain('thatall');
  expect(text).toContain('provided that all fees');
  expect(text).toContain('remain payable notwithstanding');
  // AND NOTHING ELSE MOVED: each line's own words, whole, in order.
  expect(text.replaceAll(' ', '')).toBe(LINES.slice(0, 3).map((line) => line.text.replaceAll(' ', '')).join(''));
});

test('a line that already ends in a space is not given a second one, and a hyphen at a line’s end joins the next line’s word', async ({ page }) => {
  await open(page);
  await drag(page, 3, 5);
  const text = await copied(page);
  expect(text).toBe('party who has not paid them. Any well-known exception applies. The last line of the clause.');
});

test('Search for this searches for the selected words with a space where the line ended', async ({ page }) => {
  await open(page);
  await drag(page, 0, 1);
  const line = await page.locator('[data-text-layer="0"] [data-text-line="1"]').boundingBox();
  if (line === null) throw new Error('the second line has no box');
  await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Search for this' }).click();
  await expect(page.locator('[data-find-input="true"]')).toHaveValue(
    'The licence continues in force provided that all fees are paid in full, and remain payable',
  );
});
