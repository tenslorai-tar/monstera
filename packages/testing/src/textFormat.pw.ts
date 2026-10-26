import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { BUNDLED_FAMILIES } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { commandsSettled } from './settled.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Formatting words in place on pinned Chromium (the owner's K11 and C1 to C5): no bar floats over the page; the
 * Properties panel shows the one Text section and Box while the editor is open (N13), and what is chosen there reaches the ONE write
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
  /** A font's bytes the shim answers for a bundled family once the page releases it (`bundledFace`). */
  bundledFace?: { readonly bytes: Uint8Array<ArrayBuffer>; readonly released: Promise<void> },
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
      ...(bundledFace === undefined ? {} : { bundledFace }),
      ...(section === undefined ? {} : { settings: { 'appearance.ribbon-section': section } }),
      textBlocks: [
        {
          box: { x0: 100, y0: 686, x1: 400, y1: 700 },
          lines: [{ runs: [{ index: 3, text: 'A paragraph of words', style: RUN }], box: { x0: 100, y0: 686, x1: 400, y1: 700 }, soft: false, baseline: 690 }],
          style: RUN,
          shape: { align: 'left', firstIndent: 0 },
          push: { below: [], room: 0 },
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
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
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
  test('no bar floats over the words, and the panel shows the one Text section, then Box, while the editor is open', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    await expect(page.locator('[data-text-format-bar]')).toHaveCount(0);
    const panel = page.locator('[data-text-properties]');
    await expect(panel).toBeVisible();
    for (const name of ['Text', 'Box']) await expect(panel.getByRole('group', { name, exact: true })).toBeVisible();
    // ONE TEXT SECTION (N13): what was the Paragraph group is in it, and no sentence explains the controls.
    await expect(panel.getByRole('group', { name: 'Paragraph', exact: true })).toHaveCount(0);
    await expect(panel.locator('p')).toHaveCount(0);
  });

  test('the Text section is in the owner’s order: font and size, the styles, colour, highlight, alignment, the spacings (N13)', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const section = page.locator('[data-text-properties] [data-text-section]');
    const order = await section.evaluate((root) =>
      [...root.querySelectorAll('button, input, [role="group"]')]
        .map((control) => {
          const label = control instanceof HTMLInputElement ? control.labels?.[0]?.textContent : undefined;
          const name = control.getAttribute('aria-label') ?? label ?? control.textContent;
          return name.startsWith('Font:') ? 'Font' : name;
        })
        .filter((name) =>
          ['Font', 'Size in points', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Superscript', 'Subscript', 'Text colour',
            'Highlight', 'Align left', 'Justify', 'Line spacing', 'Space after the paragraph in points',
            'Character spacing in points'].includes(name),
        ),
    );
    expect(order).toStrictEqual([
      'Font', 'Size in points', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Superscript', 'Subscript', 'Text colour',
      'Highlight', 'Align left', 'Justify', 'Line spacing', 'Space after the paragraph in points', 'Character spacing in points',
    ]);
    // FONT AND SIZE ON ONE ROW, and every spacing field starting at one edge: the layout the order is drawn in.
    const font = await section.getByRole('button', { name: /^Font:/u }).boundingBox();
    const size = await section.getByRole('spinbutton', { name: 'Size in points' }).boundingBox();
    expect(font !== null && size !== null && Math.abs(font.y - size.y) < 4).toBe(true);
    const lefts = await Promise.all(
      ['Line spacing', 'Space after the paragraph in points', 'Character spacing in points'].map(
        async (name) => (await section.getByRole('spinbutton', { name }).boundingBox())?.x,
      ),
    );
    expect(new Set(lefts).size).toBe(1);
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
    await expect(page.locator('[data-kit-surface]')).toBeFocused();
    const size = panel.getByRole('spinbutton', { name: 'Size in points' });
    await size.fill('18');
    await size.press('Enter');
    await expect(page.locator('[data-kit-surface]')).toBeFocused();
    // NONE, read once settled (DDDDDDDD-4): straight after the gesture the read could come before a send.
    expect(await commandsSettled(page, () => sent.filter((one) => one.channel === 'document.execute').length, 'the edits sent')).toBe(0);

    // AWAY, on the page beside the block.
    await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
    await expect.poll(() => marksSent(sent)).toStrictEqual([
      expect.objectContaining({ set: expect.objectContaining({ family: 'Times New Roman', size: 18 }) }),
    ]);
    expect(sent.filter((one) => one.channel === 'document.execute')).toHaveLength(1);
  });

  test('the ribbon has NO Format group while the editor is open (N10); the panel and Ctrl+B still format the words', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    // THE EDIT TAB ON SHOW FROM THE START, where the Format group was: choosing a tab moves the focus out of the words.
    await openBlock(page, sent, [], 'edit');
    const ribbon = page.locator('[data-pane="ribbon"]');
    // CONTROL: the Edit tab's own tools are drawn, so the absences below are the group's and not an empty ribbon.
    await expect(ribbon.locator('[data-command]').first()).toBeVisible();
    await expect(ribbon.locator('[data-command^="text.format."]')).toHaveCount(0);
    await expect(ribbon.locator('[data-ribbon-values]')).toHaveCount(0);
    // THE PANEL KEEPS FONT, SIZE AND BOLD, and the editor's own key bolds the words.
    const panel = page.locator('[data-text-properties]');
    await expect(panel.getByRole('spinbutton', { name: 'Size in points' })).toBeVisible();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+B');
    await expect(panel.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-kit-surface]')).toBeFocused();
  });

  test('a bundled family is drawn in its own face once that face ARRIVES, in a list already on screen (ADR-0250, ADR-0258)', async ({
    page,
  }) => {
    // ANY VALID FONT serves as a family's face, so a committed one: the bundle is provisioned, and a runner may not have it.
    const bytes = new Uint8Array(readFileSync(join(REPO_ROOT, 'assets', 'fonts', 'marcellus', 'Marcellus-Regular.ttf')));
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openBlock(page, [], [], undefined, { bytes, released });
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: /^Font:/u }).click();
    // THE NAME'S OWN SPAN, which the picker draws in the family's face; the option around it carries no font of its own.
    const drawnIn = (family: string): Promise<string> =>
      panel
        .locator(`[data-font-choice="${family}"] span`)
        .first()
        .evaluate((element) => (element as HTMLElement).style.fontFamily);
    await expect(panel.locator('[data-font-choice="Carlito"]')).toBeVisible();
    // THE CONTROL: a bundled family THIS BROWSER DOES NOT DRAW BY NAME, so it is in the interface font until its face
    // arrives. Which ones a machine draws depends on its installed fonts (this one draws Carlito), so the case takes the
    // first it does not, and refuses to count where every one is drawn already.
    const waiting: string[] = [];
    for (const family of BUNDLED_FAMILIES) if ((await panel.locator(`[data-font-choice="${family}"]`).count()) > 0 && (await drawnIn(family)) === '') waiting.push(family);
    const [family] = waiting;
    if (family === undefined) throw new Error('every bundled family is drawn by name on this machine, so a face arriving cannot be seen');
    release();
    // DRAWN AGAIN once the face is given — the same list, never reopened. A compiled list that read the faces given once,
    // during its first render, kept the interface font (ADR-0258).
    await expect.poll(() => drawnIn(family)).toBe(family);
  });

  test('the font picker lists the page’s own font first, its subset tag stripped, then this computer’s: names alone (N12)', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const panel = page.locator('[data-text-properties]');
    await panel.getByRole('button', { name: /^Font:/u }).click();
    const groups = panel.getByRole('listbox').getByRole('group');
    await expect(groups.first()).toHaveAccessibleName('In this document');
    await expect(groups.first().getByRole('option')).toHaveText(['Garamond']);
    // THE COMPUTER'S, from the shim's list, and a bundled one, each by its name and nothing else.
    await expect(panel.getByRole('group', { name: 'On this computer' }).getByRole('option', { name: 'Calibri' })).toBeVisible();
    await expect(panel.getByRole('option', { name: 'Carlito', exact: true })).toBeVisible();
    // THE SHIM LISTS A FAMILY WHOSE LICENCE FORBIDS EMBEDDING, and the picker leaves it out; the family beside it in the
    // same list is the control that the list was read.
    await expect(panel.locator('[data-font-choice="Locked Display"]')).toHaveCount(0);
    await expect(panel.locator('[data-font-choice="Arial"]')).not.toHaveCount(0);
    const texts = await panel.getByRole('option').evaluateAll((each) => each.map((node) => [node.textContent, node.getAttribute('data-font-choice')]));
    expect(texts.filter(([text, name]) => text !== name)).toStrictEqual([]);
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
      'Garamond',
      'Lato-Regular',
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
    // THE BOUND AT THIS SIZE IS THE FIELD'S OWN: 0.12 of 12 points, with no sentence under it (N13).
    await expect(letters).toHaveAttribute('max', '1.44');
    await letters.fill('0.6');
    // STILL A FIELD AFTER THE FORMAT IT SENT: the words read as nothing once their range collapsed, and the field went
    // disabled under the cursor (measured before `formatRange` selected the words again).
    await expect(letters).toBeEnabled();
    await expect(letters).toBeFocused();
    await letters.press('Enter');
    await expect(page.locator('[data-kit-surface]')).toBeFocused();
    // AN UPPER-CASE J, as Caps Lock sends it: a chord compared in lower case alone went unanswered.
    await page.keyboard.press('Control+J');
    await expect(page.locator('[data-kit-surface] > [data-kit-paragraph]').first()).toHaveCSS('text-align', 'justify');
    const after = panel.getByRole('spinbutton', { name: 'Space after the paragraph in points' });
    await after.fill('6');
    await after.press('Enter');
    // NONE, read once settled (DDDDDDDD-4): straight after the gesture the read could come before a send.
    expect(await commandsSettled(page, () => sent.filter((one) => one.channel === 'document.execute').length, 'the edits sent')).toBe(0);

    await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
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
    await page.locator('[data-kit-surface]').getByText('A paragraph of words').dblclick({ position: { x: 40, y: 6 } });
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
    await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
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
      const editor = document.querySelector('[data-kit-surface]');
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
    await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
    await expect.poll(() => marksSent(sent)).toStrictEqual([{ block: 0, from: 2, to: 11, set: { size: 18 } }]);
  });

  test('Tab in the words types a TAB CHARACTER, drawn at the next stop, and the one write carries it (K8)', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openBlock(page, sent);
    const editor = page.locator('[data-kit-surface]');
    await page.keyboard.press('Home');
    await page.keyboard.press('Tab');
    // THE FOCUS STAYS IN THE WORDS, and the editor holds the character, at the shared stop's width.
    await expect(editor).toBeFocused();
    await expect.poll(() => editor.evaluate((element) => element.textContent.startsWith('\t'))).toBe(true);
    expect(await editor.evaluate((element) => getComputedStyle(element).tabSize)).not.toBe('8');
    await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
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
    await expect(page.locator('[data-kit-surface]')).toBeFocused();
    // NONE, read once settled (DDDDDDDD-4): straight after the gesture the read could come before a send.
    expect(await commandsSettled(page, () => sent.filter((one) => one.channel === 'document.execute').length, 'the edits sent')).toBe(0);
  });
});
