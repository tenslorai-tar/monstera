import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { FRAME, SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridge, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';
import { pageShown } from './settled.js';

/**
 * A SHAKY CLICK ON TEXT PLACES A CARET (the owner's decision, 2026-10-27): a hand's click that drifts a pixel or two
 * sideways across a narrow letter's middle selected that letter, because Chromium selects as soon as a held pointer
 * crosses a character's midpoint, however little it moved. The page's text (Select text) and the editor's words (Edit
 * text) both take `holdAnchorAtPress`, and below `CLICK_WOBBLE_PX` the press is now a click there, as it already was on
 * the page's blank space.
 *
 * The letters are found, not guessed: each case presses the narrow letters of its line, just left of each one's middle,
 * and drifts 2 px right across it, so on the previous build every press made a one-letter selection. *t* measured 2.56 px
 * wide on Linux CI, 3.02 on Windows CI and 3.66 in the cloud sandbox (cloud run 21 at 7e784d57), so a drift straight
 * down, which the older cases made, crosses no midpoint at all.
 */

const WORDS = 'little tilt filled till it lit';
const LINE = { text: WORDS, box: { x0: 72, y0: 120, x1: 72 + Math.round(WORDS.length * 4.9), y1: 134 } };

/** Each narrow letter of the first text under `root` on screen: its middle across, its line's middle down, its width. */
function narrowLetters(page: Page, root: string): Promise<{ x: number; y: number; width: number }[]> {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (element === null) throw new Error(`nothing matches ${selector}`);
    const found: { x: number; y: number; width: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let at = 0; at < text.length; at += 1) {
        if (!'ilt'.includes(text[at] ?? '')) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const box = range.getBoundingClientRect();
        if (box.width > 0 && box.width < 4) found.push({ x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width });
      }
    }
    return found;
  }, root);
}

/** A hand's click: down just left of `x`, two moves that drift 2 px right across it and half a pixel down, up. */
async function shakyClick(page: Page, at: { x: number; y: number }): Promise<string> {
  await page.mouse.move(at.x - 0.7, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 0.4, at.y + 0.2);
  await page.mouse.move(at.x + 1.3, at.y + 0.5);
  await page.mouse.up();
  return page.evaluate(() => document.getSelection()?.toString() ?? '');
}

/** A drag from `at` 14 px to the right, past the click's wobble. */
async function drag(page: Page, at: { x: number; y: number }): Promise<string> {
  await page.mouse.move(at.x - 0.7, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 14, at.y, { steps: 6 });
  await page.mouse.up();
  return page.evaluate(() => document.getSelection()?.toString() ?? '');
}

async function pdfOfLine(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  document.addPage([612, 792]).drawText(WORDS, { x: LINE.box.x0, y: 792 - LINE.box.y1 + 3.5, size: 11, font });
  return document.save();
}

test('Select text: a click that drifts 2 px across a narrow letter places a caret, and a drag past the wobble selects', async ({ page }) => {
  const bytes = await pdfOfLine();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e8');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lilt.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLinesPlaced: [[LINE]],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(1);
  await pageShown(page);
  const letters = await narrowLetters(page, '[data-text-layer="0"] [data-text-line="0"]');
  // THE PREMISE: narrow letters to press, each under the wobble's width.
  expect(letters.length).toBeGreaterThanOrEqual(8);
  const selected: string[] = [];
  for (const letter of letters) selected.push(await shakyClick(page, letter));
  expect(selected).toStrictEqual(letters.map(() => ''));
  // CONTROL: past the wobble the same press is a drag, and selects what it crossed.
  const first = letters[0];
  if (first === undefined) throw new Error('no letter');
  expect((await drag(page, first)).length).toBeGreaterThan(1);
});

test('Edit text: a click that drifts 2 px across a narrow letter places a caret, so a letter typed goes in beside it', async ({ page }) => {
  const bytes = await pdfOfLine();
  const ID = asDocId('00000000-0000-4000-8000-0000000000e9');
  const RUN = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: true, mono: false, italic: false, bold: false } as const;
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRoman);
  const BOX = { x0: LINE.box.x0, y0: 792 - LINE.box.y1 + 1, x1: LINE.box.x0 + font.widthOfTextAtSize(WORDS, 11), y1: 792 - LINE.box.y1 + 13 };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lilt.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [
      {
        box: BOX,
        lines: [{ runs: [{ index: 1, text: WORDS, style: RUN }], box: BOX, soft: false, baseline: 792 - LINE.box.y1 + 3.5 }],
        style: RUN,
        shape: { align: 'left' as const, firstIndent: 0 },
      },
    ],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await runCommand(page, 'Edit text on the page');
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  await expect(page.locator(FRAME)).toHaveAttribute('data-kit-mode', 'text');
  const letters = await narrowLetters(page, SURFACE);
  expect(letters.length).toBeGreaterThanOrEqual(8);
  const selected: string[] = [];
  for (const letter of letters) selected.push(await shakyClick(page, letter));
  expect(selected).toStrictEqual(letters.map(() => ''));
  // AND THE LAST CLICK LEFT A CARET, not a letter chosen: a letter typed goes in and takes nothing with it.
  await page.keyboard.type('X');
  const words = (await page.locator(SURFACE).textContent()) ?? '';
  expect(words.replace('X', '')).toBe(WORDS);
  // CONTROL: past the wobble the same press is a drag, and selects what it crossed.
  const first = (await narrowLetters(page, SURFACE))[0];
  if (first === undefined) throw new Error('no letter');
  expect((await drag(page, first)).length).toBeGreaterThan(1);
});
