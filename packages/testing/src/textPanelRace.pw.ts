import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * W8 on pinned Chromium: the Properties panel's Text section must be on screen whenever a block's editor is open, whatever
 * came before the open — a click from one block to another, a write still in flight, Escape and a click again.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d8');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;

function block(y: number, text: string) {
  const box = { x0: 100, y0: y, x1: 400, y1: y + 14 };
  // THE BASELINE THE PAGE DRAWS IT ON: `drawText` at `y + 4`, the ink box 14 points tall from `y`.
  return {
    box,
    lines: [{ runs: [{ index: 3, text, style: RUN }], box, soft: false, baseline: y + 4 }],
    style: RUN,
    shape: { align: 'left' as const, firstIndent: 0 },
    push: { below: [], room: 0 },
  };
}

async function open(page: Page, writeMs: number): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  sheet.drawText('The first paragraph', { x: 100, y: 690, size: 12, font });
  sheet.drawText('The second paragraph', { x: 100, y: 590, size: 12, font });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Two.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [block(686, 'The first paragraph'), block(586, 'The second paragraph')],
    delays: { 'document.execute': writeMs },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
}

const blockAt = (page: Page, at: number) => page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(at)}"]`);

/** Once the editor over `words` is open and editable, the panel's Text section is on screen. */
async function panelFollowsEditor(page: Page, words: RegExp, label: string): Promise<void> {
  const editor = page.locator('[data-text-editor]');
  const section = page.locator('[data-text-properties] [data-text-section]');
  // THE CLICKED BLOCK'S OWN EDITOR, editable: while the last block's write is in flight its busy editor is still the one
  // on screen, and the clicked block opens after the write and its read.
  await expect(editor, label).toHaveText(words, { timeout: 10_000 });
  await expect(editor, label).toHaveAttribute('aria-busy', 'false');
  await expect(section, label).toBeVisible();
}

test('Escape pressed while a block’s write is in flight leaves Edit text on, and the words are written', async ({ page }) => {
  await open(page, 1500);
  await blockAt(page, 0).click();
  await panelFollowsEditor(page, /first/u, 'the first block');
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-editor]')).toHaveAttribute('aria-busy', 'true');
  // A SECOND ESCAPE, AS A PERSON PRESSES WHEN NOTHING SEEMS TO HAPPEN: the editor keeps the key while it writes.
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-editor]')).toHaveCount(0, { timeout: 10_000 });
  // STILL IN EDIT TEXT: the blocks are outlined, and one opens on a click.
  await blockAt(page, 1).click();
  await panelFollowsEditor(page, /second/u, 'the second block after the write');
});

for (const writeMs of [0, 1500]) {
  test(`W8: the Text section is on screen at every open, with writes answering in ${String(writeMs)} ms`, async ({ page }) => {
    await open(page, writeMs);
    for (let round = 0; round < 4; round += 1) {
      await blockAt(page, 0).click();
      await panelFollowsEditor(page, /first/u, `round ${String(round)}: first block`);
      await page.keyboard.type('x');
      // FROM ONE BLOCK STRAIGHT TO THE OTHER, the first's write in flight.
      await blockAt(page, 1).click();
      await panelFollowsEditor(page, /second/u, `round ${String(round)}: second block after the first`);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-text-editor]')).toHaveCount(0, { timeout: 10_000 });
      await blockAt(page, 1).click();
      await panelFollowsEditor(page, /second/u, `round ${String(round)}: second block again after Escape`);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-text-editor]')).toHaveCount(0, { timeout: 10_000 });
    }
  });
}
