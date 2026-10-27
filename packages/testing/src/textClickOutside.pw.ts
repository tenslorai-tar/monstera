import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * IN EDIT TEXT A CLICK NEVER SELECTS THE PAGE'S WORDS (cloud run 21, the owner's video of 2026-10-26): a click outside
 * the open block finishes the edit and leaves nothing selected, wherever it lands — on words no block outlines, on the
 * empty page, on another block — and so does every click after it.
 *
 * ## The page
 *
 * Three lines of words, all in the page's text layer, and two of them offered as blocks: the third is words the mode
 * outlines nothing for, as a page's text the reading could not address is. Each press is made as a hand makes it, down,
 * a pixel or two of drift, up, since a press with no drift is one the page's text layer never turns into a range.
 *
 * ## What is read
 *
 * After each press, the document's selection: collapsed or empty, so no word is highlighted; a caret in a block the
 * press opened is collapsed and allowed.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000c2');
const RUN = { size: 14, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const LINES = [
  { text: 'The first block, which is edited and left.', baseline: 700 },
  { text: 'A second block, which a click may open next.', baseline: 600 },
  { text: 'Words on the page that no block outlines at all.', baseline: 500 },
] as const;
const width = (text: string): number => text.length * RUN.size * 0.5;
const inkOf = (line: (typeof LINES)[number]) => ({ x0: 72, y0: line.baseline - 3, x1: 72 + width(line.text), y1: line.baseline + 11 });

async function open(page: Page): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  for (const line of LINES) sheet.drawText(line.text, { x: 72, y: line.baseline, size: RUN.size, font });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Outside.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    // THE TEXT LAYER, every line, in display space at scale 1 (y down from the page's top).
    pageLinesPlaced: [
      LINES.map((line) => ({ text: line.text, box: { x0: 72, y0: 792 - line.baseline - 11, x1: 72 + width(line.text), y1: 792 - line.baseline + 3 } })),
    ],
    textBlocks: LINES.slice(0, 2).map((line, at) => {
      const box = inkOf(line);
      return {
        box,
        lines: [{ runs: [{ index: at + 1, text: line.text, style: RUN }], box, soft: false, baseline: line.baseline }],
        style: RUN,
        shape: { align: 'left' as const, firstIndent: 0 },
      };
    }),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.m-text-layer').first()).toBeAttached({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"] [data-text-block="1"]')).toBeVisible({ timeout: 10_000 });
}

/** PDF points of page 1 to the window, through the drawn page's own box. */
async function onScreen(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const canvas = await page.locator('canvas[data-page-canvas="0"]').boundingBox();
  if (canvas === null) throw new Error('the page has no canvas');
  const zoom = canvas.width / 612;
  return (x, y) => ({ x: canvas.x + x * zoom, y: canvas.y + (792 - y) * zoom });
}

/** A press as a hand makes it: down, a drift of a pixel or two, up. */
async function press(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.move(at.x + 2, at.y + 1);
  await page.mouse.up();
}

/** The selection's words, empty when nothing is selected (collapsed or none). */
function selected(page: Page): Promise<string> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    return selection === null || selection.isCollapsed ? '' : selection.toString();
  });
}

const OUTSIDE = {
  'on words no block outlines': (pdf: (x: number, y: number) => { x: number; y: number }) => pdf(72 + width(LINES[2].text) / 2, LINES[2].baseline + 4),
  'on the empty page': (pdf: (x: number, y: number) => { x: number; y: number }) => pdf(400, 300),
  'on another block': (pdf: (x: number, y: number) => { x: number; y: number }) => pdf(72 + width(LINES[1].text) / 2, LINES[1].baseline + 4),
} as const;

for (const [where, point] of Object.entries(OUTSIDE)) {
  test(`a click ${where} after an edit leaves nothing selected, and so do the two clicks after it`, async ({ page }) => {
    await open(page);
    const pdf = await onScreen(page);
    // THE BOX, then the caret in its words (ADR-0271's two steps).
    await press(page, pdf(72 + 20, LINES[0].baseline + 4));
    await expect(page.locator('[data-kit-frame]')).toBeFocused();
    await press(page, pdf(72 + 20, LINES[0].baseline + 4));
    const editor = page.locator('[data-kit-surface]');
    await expect(editor).toBeFocused();
    await page.keyboard.type(' Edited');
    const outside = point(pdf);
    await press(page, outside);
    await page.waitForTimeout(400);
    expect(await selected(page), 'after the click outside').toBe('');
    // AND THE EDIT IS FINISHED: the focus is out of the words typed into.
    expect(await page.evaluate(() => document.activeElement?.closest('[data-kit-surface]')?.textContent.includes('Edited') ?? false)).toBe(false);
    // TWO MORE: on the words no block outlines, and on the empty page, each read after it.
    await press(page, OUTSIDE['on words no block outlines'](pdf));
    await page.waitForTimeout(400);
    expect(await selected(page), 'after the second click').toBe('');
    await press(page, OUTSIDE['on the empty page'](pdf));
    await page.waitForTimeout(400);
    expect(await selected(page), 'after the third click').toBe('');
  });
}

test('words selected before Edit text was turned on are let go at the first press', async ({ page }) => {
  await open(page);
  // THE PAGE'S WORDS SELECTED as a reader leaves them, by the selection's own call, since the mode now takes the drag.
  await page.evaluate(() => {
    const line = document.querySelector('.m-text-layer [data-line], .m-text-layer span');
    if (line === null) throw new Error('the page has no text layer line to select');
    document.getSelection()?.selectAllChildren(line);
  });
  expect(await selected(page), 'the selection this case starts from').not.toBe('');
  const pdf = await onScreen(page);
  await press(page, OUTSIDE['on the empty page'](pdf));
  expect(await selected(page)).toBe('');
});

test('a drag across words no block outlines selects nothing in Edit text', async ({ page }) => {
  await open(page);
  const pdf = await onScreen(page);
  const from = pdf(74, LINES[2].baseline + 4);
  const to = pdf(72 + width(LINES[2].text) - 4, LINES[2].baseline + 4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  expect(await selected(page)).toBe('');
});
