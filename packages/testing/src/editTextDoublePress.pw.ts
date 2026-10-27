import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { FRAME, SURFACE } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * A QUICK DOUBLE PRESS on a block does both of the two steps at once: it selects the box and puts the caret where the
 * second press fell (ADR-0271 section 3). A person's two quick presses arrive with `detail` 1 and then 2; every other
 * rendered case presses once at a time, so each of its presses arrives with `detail` 1 and this path was reached by none
 * (the stage audit of dabf6041..f1c1dc16, ZZZZZZZZ-14).
 *
 * The caret's place is read by what a key does: a letter typed lands inside the word pressed, never at the block's end,
 * where Enter would have put it, and never replacing the word, which is the browser's own answer to a double press.
 *
 * WHAT THIS DOES NOT SEPARATE, measured 2026-10-27 on Chromium 151: the two `detail >= 2` branches (the outline's and
 * `BlockEditor`'s second press) can each be removed and this stays green. The first press lays the frame over the
 * outline, so the second press reaches the editor's words and never the outline; there, a press in box mode places the
 * caret at the point by itself. The case holds the behaviour, not either branch.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000dd');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
test('a double press on a block opens its words with the caret where it fell', async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('The first paragraph', { x: 100, y: 690, size: 12, font });
  const bytes = await pdf.save();
  // THE LINE'S BOX AS A READ REPORTS IT, as wide as the page draws its words: the editor fits the line's letters to it.
  const BOX = { x0: 100, y0: 686, x1: 100 + font.widthOfTextAtSize('The first paragraph', 12), y1: 700 };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'One.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [{ box: BOX, lines: [{ runs: [{ index: 3, text: 'The first paragraph', style: RUN }], box: BOX, soft: false, baseline: 690 }], style: RUN, shape: { align: 'left' as const, firstIndent: 0 } }],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await runCommand(page, 'Edit text on the page');
  const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
  await expect(outline).toBeVisible();
  const box = await outline.boundingBox();
  if (box === null) throw new Error('no outline');
  // INSIDE "first", at its middle as the page draws it, well away from either end of the block.
  const middle = font.widthOfTextAtSize('The ', 12) + font.widthOfTextAtSize('first', 12) / 2;
  const at = { x: box.x + middle * (box.width / (BOX.x1 - BOX.x0)), y: box.y + box.height / 2 };
  const seen: number[] = [];
  await page.exposeFunction('notePress', (detail: number) => {
    seen.push(detail);
  });
  await page.evaluate(() => {
    document.addEventListener(
      'mousedown',
      (event) => {
        (window as unknown as { notePress: (detail: number) => void }).notePress(event.detail);
      },
      true,
    );
  });
  await page.mouse.click(at.x, at.y, { clickCount: 2 });
  // CONTROL: the second press reached the page as a double press, which is the path this case is about.
  await expect.poll(() => seen).toContain(2);
  await expect(page.locator(FRAME)).toHaveAttribute('data-kit-mode', 'text');
  await expect(page.locator(SURFACE)).toBeFocused();
  await page.keyboard.type('X');
  const words = (await page.locator(SURFACE).textContent()) ?? '';
  // THE DECISION: a CARET at the press, not the browser's own answer to a double press, which selects the word, so a
  // letter typed then replaces it. The words with the letter taken out are the block's words whole, and the letter is
  // inside "first", never at the block's end (Enter's place).
  expect(words.replace('X', '')).toBe('The first paragraph');
  expect(words.indexOf('X')).toBeGreaterThan(words.indexOf('first'));
  expect(words.indexOf('X')).toBeLessThan(words.indexOf(' paragraph'));
});
