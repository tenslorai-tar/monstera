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

async function openBlock(
  page: Page,
  sent: { channel: string; params: unknown }[],
  documentFonts: readonly { name: string; partial: boolean }[] = [],
  /** The ribbon's section at the start: Edit, where Edit text is reached, for a case about the Format group. */
  section?: 'edit',
): Promise<void> {
  const bytes = await onePage();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Format.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      documentFonts,
      ...(section === undefined ? {} : { settings: { 'appearance.ribbon-section': section } }),
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

  test('the RIBBON’S Format group has Font and Size too (C3): chosen there, they keep the editor open and write once', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    // THE EDIT TAB ON SHOW FROM THE START, where Edit text is reached: choosing a tab moves the focus out of the words,
    // which ends the edit, as a click anywhere outside them does.
    await openBlock(page, sent, [], 'edit');
    await page.keyboard.press('Control+A');
    const values = page.locator('.m-ribbon__tools [data-ribbon-values] [data-text-font-size="ribbon"]');
    await expect(values).toBeVisible();
    await values.getByRole('button', { name: /^Font:/u }).click();
    // THE LIST FLOATS over the window, outside the ribbon's clipped row, and its search takes the keys.
    const search = page.getByRole('combobox', { name: 'Search fonts' });
    await expect(search).toBeFocused();
    expect(await search.evaluate((field) => field.closest('.m-ribbon__tools') === null)).toBe(true);
    await search.fill('Times New');
    await search.press('Enter');
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    const size = values.getByRole('spinbutton', { name: 'Size in points' });
    await size.fill('18');
    await size.press('Enter');
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(0);
    // THE PANEL SHOWS WHAT THE RIBBON SET, being the same component over the same editor.
    await expect(page.locator('[data-text-properties] [data-text-font-size="panel"]').getByRole('spinbutton', { name: 'Size in points' })).toHaveValue('18');

    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    await expect.poll(() => marksSent(sent)).toStrictEqual([
      expect.objectContaining({ set: expect.objectContaining({ family: 'Times New Roman', size: 18 }) }),
    ]);
    // CONTROL: with the editor closed the Format group and its values are gone, so they are the editor's and not the tab's.
    await expect(page.locator('[data-ribbon-values]')).toHaveCount(0);
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

  // THE WHOLE DOCUMENT'S FONTS (B2.8): the two below are on no run of the open page, so only `document.fonts` can put them
  // there, and the case above, whose document read names none, is the control that the page's own font alone is listed.
  test('In this document lists every font the document names, the page’s own first and each once', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent, [
      { name: 'ABCDEF+Lato-Regular', partial: true },
      { name: 'QWERTY+Garamond', partial: true },
      { name: 'Courier', partial: false },
    ]);
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: /^Font:/u }).click();
    await expect(panel.getByRole('listbox').getByRole('group').first().getByRole('option')).toHaveText([
      'Garamond (partial: only the letters this document uses)',
      'Lato-Regular (partial: only the letters this document uses)',
      'Courier',
    ]);
    expect(sent.filter((one) => one.channel === 'document.fonts').length).toBeGreaterThan(0);
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
    await expect(panel.getByText('Up to 1.4 pt either way at this size.', { exact: false })).toBeVisible();
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
    // WHAT A DOUBLE-CLICK CHOOSES IS THE PLATFORM'S: Chromium on Windows takes the word AND the space after it (its
    // `SelectTrailingWhitespaceEnabled` editing behaviour), and on Linux the word alone — CI run 38207412421 sent 2 to 12
    // on windows where ubuntu sent 2 to 11. Read here, so the case asserts what the person chose is what is formatted.
    const chosen = await page.evaluate(() => document.getSelection()?.toString() ?? '');
    expect(['paragraph', 'paragraph ']).toContain(chosen);
    const size = page.locator('[data-text-properties]').getByRole('spinbutton', { name: 'Size in points' });
    // TWO KEYSTROKES, TWO FORMATS: the first wraps the word in a span of its own, which a live range does not survive.
    // AND THE FIELD IS FILLED AT ONCE after the double-click, before the browser's queued `selectionchange` has run: the
    // word is remembered as the focus leaves the words, not only when that event arrives.
    await size.fill('');
    await size.pressSequentially('18');
    await size.press('Enter');
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    // `paragraph` IS CHARACTERS 2 TO 11 (12 with the space the platform chose), and is the one mark: the words around it
    // were never formatted, and the paragraph's length (20) is what the defect this guards would send.
    await expect.poll(() => marksSent(sent)).toStrictEqual([{ block: 0, from: 2, to: 2 + chosen.length, set: { size: 18 } }]);
  });

  // THE RACE, MADE DETERMINISTIC: the word is chosen and the focus moved to the size field in ONE task, so the browser's
  // `selectionchange` for the choice is still queued when the focus leaves the words, and by the time it runs the
  // selection is the field's. What the field formats must still be the word, not the paragraph the caret was in.
  test('a word chosen and the focus moved to the size field in the same moment still formats that word only', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const size = page.locator('[data-text-properties]').getByRole('spinbutton', { name: 'Size in points' });
    await size.evaluate((field) => {
      const editor = document.querySelector('[data-text-editor]');
      const walker = editor === null ? null : document.createTreeWalker(editor, 4);
      for (let node = walker?.nextNode() ?? null; node !== null; node = walker?.nextNode() ?? null) {
        const at = node.textContent?.indexOf('paragraph') ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 'paragraph'.length);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        break;
      }
      (field as HTMLInputElement).focus();
    });
    await expect(size).toBeFocused();
    await size.fill('');
    await size.pressSequentially('18');
    await size.press('Enter');
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
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
