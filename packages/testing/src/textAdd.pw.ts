import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Add text on pinned Chromium (the owner's B1 to B4): a press on the empty page opens a box, the words typed in it are
 * ONE command carrying them, and they are kept when the person clicks away.
 *
 * The kernel is the shim's; that an insert puts the words on the page is `pdfiumCommand.proof.mjs`' subject. What this
 * file holds is the half no kernel proof reaches: that a key pressed in the new box puts a letter in it. It did not, and
 * every case below failed on the first assertion after typing, because a box with no words laid out no line to type in.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000a7');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;

async function onePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('A heading', { x: 72, y: 720, size: 12, font });
  return document.save();
}

async function openForAdding(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await onePage();
  // WIDE ENOUGH THAT THE WHOLE PAGE IS CLEAR OF THE SIDE PANEL, so a press near its right edge lands on it.
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Add.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [
        {
          box: { x0: 72, y0: 716, x1: 140, y1: 730 },
          lines: [{ runs: [{ index: 3, text: 'A heading', style: RUN }], box: { x0: 72, y0: 716, x1: 140, y1: 730 }, soft: false }],
          style: RUN,
          shape: { align: 'left', firstIndent: 0 },
        },
      ],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Add text');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-add-surface]').first()).toBeAttached();
}

/** The words every `document.execute` carried as inserts, in order. */
function insertedWords(sent: readonly { channel: string; params: unknown }[]): string[] {
  const words: string[] = [];
  for (const { channel, params } of sent) {
    if (channel !== 'document.execute') continue;
    const command = (params as { command?: { inserts?: readonly { text: string }[] } }).command;
    for (const insert of command?.inserts ?? []) words.push(insert.text);
  }
  return words;
}

test.describe('Add text', () => {
  for (const where of [
    { name: 'the middle of the page', x: 0.5, y: 0.5 },
    { name: 'near the right edge', x: 0.93, y: 0.3 },
  ]) {
    test(`a press at ${where.name}, words typed and a click away keep the words as one insert`, async ({ page }) => {
      const sent: { channel: string; params: unknown }[] = [];
      await openForAdding(page, sent);
      const surface = page.locator('[data-text-add-surface]').first();
      const box = await surface.boundingBox();
      if (box === null) throw new Error('the add surface has no box');
      await page.mouse.click(box.x + box.width * where.x, box.y + box.height * where.y);
      const editor = page.locator('[data-text-editor]');
      await expect(editor).toBeFocused();
      await page.keyboard.type('Words that stay');
      // IN THE BOX before anything is sent: the defect was here, and a case asserting only the command could not say so.
      await expect(editor).toHaveText('Words that stay');
      // AWAY: a press on the page below the box, which is where a person clicks when they are done.
      await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.9);

      await expect.poll(() => insertedWords(sent)).toStrictEqual(['Words that stay']);
    });
  }

  // W2: AFTER A FONT IS PICKED IN THE PANEL, every way out of the box must still end it: the key, a click in the words
  // and then the key, and a click away. One case per way, each from a font chosen by the keyboard and by the mouse.
  for (const way of ['Escape', 'a click in the words, then Escape', 'a click away'] as const) {
    for (const by of ['keyboard', 'mouse'] as const) {
      test(`W2: a font picked by the ${by} during Add text, and ${way} still ends the box with the words in that font`, async ({ page }) => {
        const sent: { channel: string; params: unknown }[] = [];
        await openForAdding(page, sent);
        const surface = page.locator('[data-text-add-surface]').first();
        const box = await surface.boundingBox();
        if (box === null) throw new Error('the add surface has no box');
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
        const editor = page.locator('[data-text-editor]');
        await expect(editor).toBeFocused();
        await page.keyboard.type('In a chosen font');
        const panel = page.locator('[data-text-properties]');
        await panel.getByRole('button', { name: /^Font:/u }).click();
        const search = panel.getByRole('combobox', { name: 'Search fonts' });
        await search.fill('Times New');
        if (by === 'keyboard') await search.press('Enter');
        else await panel.locator('[data-font-choice="Times New Roman"]').first().click();
        // THE LIST IS CLOSED and the words have the focus again, which is where every way out starts from.
        await expect(panel.getByRole('listbox')).toHaveCount(0);
        await expect(editor).toBeFocused();
        if (way === 'Escape') {
          await page.keyboard.press('Escape');
        } else if (way === 'a click in the words, then Escape') {
          await editor.click();
          await page.keyboard.press('Escape');
        } else {
          await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.9);
        }
        await expect(editor).toHaveCount(0);
        await expect.poll(() => insertedWords(sent)).toStrictEqual(['In a chosen font']);
      });
    }
  }

  test('Escape keeps the words too, and a box left empty sends nothing', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForAdding(page, sent);
    const surface = page.locator('[data-text-add-surface]').first();
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the add surface has no box');
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    await page.keyboard.type('Kept by Escape');
    await page.keyboard.press('Escape');
    await expect.poll(() => insertedWords(sent)).toStrictEqual(['Kept by Escape']);

    // CONTROL: the same steps with nothing typed write nothing, so the case above is the words and not the press.
    const before = sent.length;
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Add text');
    await page.keyboard.press('Enter');
    const again = page.locator('[data-text-add-surface]').first();
    await expect(again).toBeAttached();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);
    expect(insertedWords(sent.slice(before))).toStrictEqual([]);
  });
});
