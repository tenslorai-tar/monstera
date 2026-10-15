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
          lines: [{ runs: [{ index: 3, text: 'A heading', style: RUN }], box: { x0: 72, y0: 716, x1: 140, y1: 730 }, soft: false, baseline: 720 }],
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

  test('N11: Add text shows the I-beam over the empty page, where a press puts the words', async ({ page }) => {
    await openForAdding(page, []);
    const surface = page.locator('[data-text-add-surface]').first();
    await expect(surface).toHaveCSS('cursor', 'text');
    // CONTROL: the surface is the element under the page's middle, so the I-beam above is the one a person sees.
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the add surface has no box');
    const under = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.hasAttribute('data-text-add-surface') ?? false,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(under).toBe(true);
  });

  // W4: THE SIZE IS THE WORDS' SIZE BEFORE THERE ARE ANY, and character spacing can be set before the first letter.
  test('W4: a new box shows its size before anything is typed, and character spacing is open', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForAdding(page, sent);
    const surface = page.locator('[data-text-add-surface]').first();
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the add surface has no box');
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    const panel = page.locator('[data-text-properties]');
    await expect(panel.getByRole('spinbutton', { name: 'Size in points' })).toHaveValue('12');
    await expect(panel.getByRole('spinbutton', { name: 'Character spacing in points' })).toBeEnabled();
    // AND ONCE WORDS ARE TYPED, which land beside the empty run in no run of their own: still the box's size, and the
    // spacing typed then reaches the one insert as a fraction of it.
    await page.keyboard.type('Now words');
    await expect(panel.getByRole('spinbutton', { name: 'Size in points' })).toHaveValue('12');
    await page.keyboard.press('Control+A');
    const letters = panel.getByRole('spinbutton', { name: 'Character spacing in points' });
    await expect(letters).toBeEnabled();
    await letters.fill('0.6');
    await letters.press('Enter');
    await page.keyboard.press('Escape');
    await expect.poll(() => insertedWords(sent)).toStrictEqual(['Now words']);
    const marks = sent.flatMap(({ channel, params }) => {
      if (channel !== 'document.execute') return [];
      const command = (params as { command?: { inserts?: readonly { marks?: readonly { set?: { spacing?: number } }[] }[] } }).command;
      return (command?.inserts ?? []).flatMap((insert) => insert.marks ?? []);
    });
    expect(marks.map((mark) => mark.set?.spacing)).toStrictEqual([0.05]);
  });

  // C3: A SECTION TITLE READS AS A HEADING: larger and heavier than the labels under it, and every title alike (one token
  // pair, `--panel-heading-size` and `--panel-heading-weight`).
  test('C3: the Properties panel’s section titles are larger and heavier than its field labels, all alike', async ({ page }) => {
    await openForAdding(page, []);
    const surface = page.locator('[data-text-add-surface]').first();
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the add surface has no box');
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const panel = page.locator('[data-text-properties]');
    await expect(panel.locator('.m-text-section__title').first()).toBeVisible();
    const read = await panel.evaluate((root) => {
      const styleOf = (element: Element): { size: number; weight: number } => {
        const style = getComputedStyle(element);
        return { size: Number.parseFloat(style.fontSize), weight: Number(style.fontWeight) };
      };
      return {
        titles: [...root.querySelectorAll('.m-text-section__title')].map(styleOf),
        labels: [...root.querySelectorAll('.m-text-section__label')].map(styleOf),
      };
    });
    // A SEARCH on both sides, so each must find something.
    expect(read.titles.length).toBeGreaterThan(1);
    expect(read.labels.length).toBeGreaterThan(0);
    expect(new Set(read.titles.map((each) => `${String(each.size)}/${String(each.weight)}`)).size).toBe(1);
    const title = read.titles[0] ?? { size: 0, weight: 0 };
    expect(read.labels.filter((label) => !(title.size > label.size && title.weight > label.weight))).toStrictEqual([]);
  });

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
