import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * The caret reaches the end of a line whose letters the editor lays out in a face other than the page's (the owner's
 * test of milestone 1, 2026-10-27): on a page whose fonts are drawn from shapes (Type 3, as a web browser prints), a press
 * past the last word left the caret a word or two short, because the editor's invisible letters, laid out in a stand-in
 * face, ran past the visible ones. Each line of words nobody changed is now fitted to the width the page draws it at
 * (`fitDrawnLines`).
 *
 * The page here draws its line in Helvetica, and the read names the run fixed-pitch, so the editor lays it out in a
 * fixed-pitch stand-in, far wider: the mismatch a drawn font makes, with a size this case can state. THE CONTROL is the
 * same line read in the kind the page draws it in, whose face is near enough that the press lands at the end either way:
 * it shows the case's press and its reading of the caret are sound, so a red first case is the stand-in's width.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e4');
const WORDS = 'A line the stand-in face sets far wider';
const SIZE = 12;

async function open(page: Page, mono: boolean): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(WORDS, { x: 72, y: 690, size: SIZE, font });
  const bytes = await document.save();
  const width = font.widthOfTextAtSize(WORDS, SIZE);
  const box = { x0: 72, y0: 687, x1: 72 + width, y1: 699 };
  const style = { size: SIZE, colour: { r: 0, g: 0, b: 0 }, serif: false, mono, italic: false, bold: false } as const;
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Ends.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [
      {
        box,
        lines: [{ runs: [{ index: 3, text: WORDS, style }], box, soft: false, baseline: 690 }],
        style,
        shape: { align: 'left' as const, firstIndent: 0 },
      },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
}

/** How many characters of the words lie before the caret, and the caret's x on screen. */
async function caret(page: Page): Promise<{ before: number; x: number }> {
  return page.locator(SURFACE).evaluate((root) => {
    const selection = root.ownerDocument.getSelection();
    const focus = selection?.focusNode ?? null;
    if (selection === null || focus === null) return { before: -1, x: Number.NaN };
    const range = root.ownerDocument.createRange();
    range.setStart(root, 0);
    range.setEnd(focus, selection.focusOffset);
    const here = root.ownerDocument.createRange();
    here.setStart(focus, selection.focusOffset);
    return { before: range.toString().length, x: here.getBoundingClientRect().x };
  });
}

for (const mono of [true, false]) {
  test(`${mono ? '' : 'CONTROL: '}a press after the last word${mono ? ' laid out in a wider face' : ''} puts the caret at the end, and so does End`, async ({ page }) => {
    await open(page, mono);
    // THE FRAME IS THE BLOCK'S BOX, which is the line's ink as the page draws it: its right edge is where the line ends.
    const area = await page.locator('[data-kit-frame]').boundingBox();
    if (area === null) throw new Error('the editor has no frame');
    // JUST INSIDE THAT EDGE, over the last letter's right half.
    await page.mouse.click(area.x + area.width - 1, area.y + area.height / 2);
    expect((await caret(page)).before).toBe(WORDS.length);
    // HOME, THEN END: the caret goes to the line's end, and it is drawn where the page's line ends.
    await page.keyboard.press('Home');
    expect((await caret(page)).before).toBe(0);
    await page.keyboard.press('End');
    const atEnd = await caret(page);
    expect(atEnd.before).toBe(WORDS.length);
    expect(Math.abs(atEnd.x - (area.x + area.width))).toBeLessThan(6);
  });
}
