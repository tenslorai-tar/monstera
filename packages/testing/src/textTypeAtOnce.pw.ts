import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Keys typed the moment the caret is put in a block land in its words (N5, 2026-10-23): one reading of the text walk's
 * step 9 was that keys typed before the editor was ready were lost. Edit text opens in two presses (ADR-0271 section 3):
 * the first selects the box, the second puts the caret. This makes both presses and types in the same breath — no wait
 * for the editor, its focus or its caret — and requires every key in the words; the control types after the words are
 * focused, as a person who pauses does.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000da');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const WORDS = 'The first paragraph';

async function open(page: Page): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(WORDS, { x: 100, y: 690, size: 12, font });
  const bytes = await document.save();
  const box = { x0: 100, y0: 686, x1: 400, y1: 700 };
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'One.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [
      {
        box,
        lines: [{ runs: [{ index: 3, text: WORDS, style: RUN }], box, soft: false, baseline: 690 }],
        style: RUN,
        shape: { align: 'left' as const, firstIndent: 0 },
        push: { below: [], room: 0 },
      },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"] [data-text-block="0"]')).toBeVisible({ timeout: 10_000 });
}

for (const typed of ['at once', 'CONTROL: once the editor is open'] as const) {
  test(`keys typed ${typed} after the press on a block are all in its words`, async ({ page }) => {
    await open(page);
    const block = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
    const area = await block.boundingBox();
    if (area === null) throw new Error('the block has no box');
    // THE BOX, then the caret AT THE BLOCK'S END, so the keys add to the words.
    await page.mouse.click(area.x + area.width - 2, area.y + area.height / 2);
    await page.mouse.click(area.x + area.width - 2, area.y + area.height / 2);
    const editor = page.locator('[data-kit-surface]');
    if (typed !== 'at once') await expect(editor).toBeFocused();
    await page.keyboard.type(' grows');
    await expect(editor).toContainText('grows', { timeout: 5000 });
    expect((await editor.innerText()).replace(/\s+/gu, ' ').trim()).toBe(`${WORDS} grows`);
  });
}
