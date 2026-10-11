import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Formatting words in place on pinned Chromium (the owner's K11 and C1 to C5): no bar floats over the page; the
 * Properties panel shows Text, Paragraph and Box while the editor is open, and what is chosen there reaches the ONE write
 * the editor sends when the person clicks away. The kernel is the shim's; what a mark does to the page is the kernel's.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000b8');
/** A run in a subset font, named as a page names it: the picker lists it under *In this document* without the tag. */
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false, font: 'QWERTY+Garamond' } as const;

async function onePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('A paragraph of words', { x: 100, y: 690, size: 12, font });
  return document.save();
}

async function openBlock(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await onePage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Format.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [
        {
          box: { x0: 100, y0: 686, x1: 400, y1: 700 },
          lines: [{ runs: [{ index: 3, text: 'A paragraph of words', style: RUN }], box: { x0: 100, y0: 686, x1: 400, y1: 700 }, soft: false }],
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
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();
  await expect(page.locator('[data-text-editor]')).toBeFocused();
}

/** The marks the one `editTextBlock` command carried. */
function marksSent(sent: readonly { channel: string; params: unknown }[]): unknown[] {
  return sent.flatMap(({ channel, params }) => {
    if (channel !== 'document.execute') return [];
    const command = (params as { command?: { kind?: string; marks?: unknown[] } }).command;
    return command?.kind === 'editTextBlock' ? (command.marks ?? []) : [];
  });
}

test.describe('Formatting in the Properties panel (K11)', () => {
  test('no bar floats over the words, and the panel shows Text, Paragraph and Box while the editor is open', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await expect(page.locator('[data-text-format-bar]')).toHaveCount(0);
    const panel = page.locator('[data-text-properties]');
    await expect(panel).toBeVisible();
    for (const name of ['Text', 'Paragraph', 'Box']) await expect(panel.getByRole('group', { name })).toBeVisible();
  });

  test('a font chosen and a size typed in the panel keep the editor open, and the click away writes both, once', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await page.keyboard.press('Control+A');
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: /^Font:/u }).click();
    const search = panel.getByRole('combobox', { name: 'Search fonts' });
    await expect(search).toBeFocused();
    await search.fill('Times New');
    await search.press('Enter');
    // THE EDITOR IS STILL OPEN, and the words have the focus back.
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    const size = panel.getByRole('spinbutton', { name: 'Size in points' });
    await size.fill('18');
    await size.press('Enter');
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(0);

    // AWAY, on the page beside the block.
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    await expect.poll(() => marksSent(sent)).toStrictEqual([
      expect.objectContaining({ set: expect.objectContaining({ family: 'Times New Roman', size: 18 }) }),
    ]);
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(1);
  });

  test('the font picker lists the page’s own font first, its subset tag stripped and said partial, then this computer’s', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: /^Font:/u }).click();
    const groups = panel.getByRole('listbox').getByRole('group');
    await expect(groups.first()).toHaveAccessibleName('In this document');
    await expect(groups.first().getByRole('option')).toHaveText(['Garamond (partial: only the letters this document uses)']);
    // THE COMPUTER'S, from the shim's list, and a bundled one said to look like another.
    await expect(panel.getByRole('group', { name: 'On this computer' }).getByRole('option', { name: 'Calibri' })).toBeVisible();
    await expect(panel.getByRole('option', { name: 'Carlito (looks like Calibri)' })).toBeVisible();
  });

  test('strikethrough, a highlight, character spacing, Ctrl+J and space after reach the one write (ADR-0228)', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await page.keyboard.press('Control+A');
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: 'Strikethrough' }).click();
    await panel.getByRole('group', { name: 'Highlight' }).getByRole('button', { name: 'Yellow highlight' }).click();
    const letters = panel.getByRole('spinbutton', { name: 'Character spacing in points' });
    // THE BOUND AT THIS SIZE IS SAID: 0.12 of 12 points.
    await expect(panel.getByText('Up to 1.4 points either way at this size.', { exact: false })).toBeVisible();
    await letters.fill('0.6');
    // STILL A FIELD AFTER THE FORMAT IT SENT: the words read as nothing once their range collapsed, and the field went
    // disabled under the cursor (measured before `formatRange` selected the words again).
    await expect(letters).toBeEnabled();
    await expect(letters).toBeFocused();
    await letters.press('Enter');
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    // AN UPPER-CASE J, as Caps Lock sends it: a chord compared in lower case alone went unanswered.
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-text-editor] > div').first()).toHaveAttribute('data-align', 'justify');
    const after = panel.getByRole('spinbutton', { name: 'Space after the paragraph in points' });
    await after.fill('6');
    await after.press('Enter');
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(0);

    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    await expect.poll(() => marksSent(sent)).toStrictEqual([
      expect.objectContaining({ set: { strike: true, highlight: { r: 255, g: 241, b: 118 }, spacing: 0.05 } }),
    ]);
    const paragraphs = sent.flatMap(({ channel, params }) => {
      const command = (params as { command?: { kind?: string; paragraphs?: unknown[] } }).command;
      return channel === 'document.execute' && command?.kind === 'editTextBlock' ? (command.paragraphs ?? []) : [];
    });
    expect(paragraphs).toStrictEqual([expect.objectContaining({ paragraph: 0, align: 'justify', spaceAfter: 6 })]);
  });

  test('a size typed digit by digit formats the selected word only, not its paragraph from the second digit on', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await page.locator('[data-text-editor]').getByText('A paragraph of words').dblclick({ position: { x: 40, y: 6 } });
    const size = page.locator('[data-text-properties]').getByRole('spinbutton', { name: 'Size in points' });
    // TWO KEYSTROKES, TWO FORMATS: the first wraps the word in a span of its own, which a live range does not survive.
    await size.fill('');
    await size.pressSequentially('18');
    await size.press('Enter');
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    // `paragraph` IS WORDS 2 TO 11, and is the one mark: the words around it were never formatted.
    await expect.poll(() => marksSent(sent)).toStrictEqual([{ block: 0, from: 2, to: 11, set: { size: 18 } }]);
  });

  test('Tab in the words types a TAB CHARACTER, drawn at the next stop, and the one write carries it (K8)', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const editor = page.locator('[data-text-editor]');
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    // THE FOCUS STAYS IN THE WORDS, and the editor holds the character, at the shared stop's width.
    await expect(editor).toBeFocused();
    await expect.poll(() => editor.evaluate((element) => element.textContent.startsWith('\t'))).toBe(true);
    expect(await editor.evaluate((element) => getComputedStyle(element).tabSize)).not.toBe('8');
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    const texts = (): string[] =>
      sent.flatMap(({ channel, params }) => {
        const command = (params as { command?: { kind?: string; texts?: string[]; text?: string } }).command;
        if (channel !== 'document.execute' || command?.kind !== 'editTextBlock') return [];
        return JSON.stringify(command).includes('\\tA paragraph of words') ? ['tab'] : ['no tab'];
      });
    await expect.poll(texts).toStrictEqual(['tab']);
  });

  test('CONTROL: a press on Bold in the panel keeps the focus in the words, where a click on the page ends the edit', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await page.locator('[data-text-properties]').getByRole('button', { name: 'Bold' }).click();
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(0);
  });
});
