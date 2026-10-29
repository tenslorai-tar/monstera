import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { FRAME, SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * A REFERENCE MARKER UNDER A LINK (cloud run 25, item 25a; the owner's corpus page, 2026-10-28): a block about 17 pt wide,
 * *[13] [1]*, opened with two presses, End, and words typed. The box stayed the marker's size while the words ran on past
 * its right edge, and the link's hover sat over the words being typed.
 *
 * The page is built here, the marker in Helvetica at 6 pt, read to the shim as a block of one run, as `document.textBlocks`
 * answers a line, and the link over it as `document.pageLinks` answers one.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000fb');
const RUN = { size: 6, colour: { r: 26, g: 77, b: 187 }, serif: false, mono: false, italic: false, bold: false } as const;
const BODY = { ...RUN, size: 10, colour: { r: 0, g: 0, b: 0 } } as const;
const PAGE_HEIGHT = 792;
const PARAGRAPH_TEXT = 'A paragraph that cites its sources, set across the column above its markers.';
const WRAPPED = ['A narrow paragraph whose words', 'wrap within its own measure.'];

/** The page with the marker and the paragraph above it, Edit text on, and the words of block `which` open (0: the marker). */
async function openMarker(page: Page, which = 0, beforeOpen?: () => Promise<void>): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sheet = pdf.addPage([612, PAGE_HEIGHT]);
  sheet.drawText(PARAGRAPH_TEXT, { x: 72, y: 700, size: 10, font });
  sheet.drawText('[13] [1]', { x: 300, y: 670, size: 6, font });
  for (const [at, text] of WRAPPED.entries()) sheet.drawText(text, { x: 72, y: 600 - at * 12, size: 10, font });
  const WRAPPED_WIDTH = Math.max(...WRAPPED.map((text) => font.widthOfTextAtSize(text, 10)));
  const bytes = await pdf.save();
  const BOX = { x0: 300, y0: 668.5, x1: 300 + font.widthOfTextAtSize('[13] [1]', 6), y1: 675 };
  const PARAGRAPH = { x0: 72, y0: 697, x1: 72 + font.widthOfTextAtSize(PARAGRAPH_TEXT, 10), y1: 708 };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Markers.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textRewrite: 'operators',
    // THE PARAGRAPH IS A BLOCK TOO, across the column above the marker: what a one-line block's reach is measured to.
    textBlocks: [
      { box: BOX, lines: [{ runs: [{ index: 4, text: '[13] [1]', style: RUN }], box: BOX, soft: false, baseline: 670 }], style: RUN, shape: { align: 'left' as const, firstIndent: 0 } },
      {
        box: PARAGRAPH,
        lines: [{ runs: [{ index: 1, text: PARAGRAPH_TEXT, style: BODY }], box: PARAGRAPH, soft: false, baseline: 700 }],
        style: BODY,
        shape: { align: 'left' as const, firstIndent: 0 },
      },
      // A PARAGRAPH THAT WRAPS, two lines joined by a soft end: the editor's surface wraps it at the block's width.
      {
        box: { x0: 72, y0: 585, x1: 72 + WRAPPED_WIDTH, y1: 608 },
        lines: WRAPPED.map((text, at) => {
          const box = { x0: 72, y0: 597 - at * 12, x1: 72 + font.widthOfTextAtSize(text, 10), y1: 608 - at * 12 };
          return { runs: [{ index: 7 + at, text, style: BODY }], box, soft: at === 0, baseline: 600 - at * 12 };
        }),
        style: BODY,
        shape: { align: 'left' as const, firstIndent: 0 },
      },
    ],
    pageLinks: [[{ kind: 'external' as const, uri: 'https://example.org/13', bounds: { x0: BOX.x0, y0: PAGE_HEIGHT - BOX.y1, x1: BOX.x1, y1: PAGE_HEIGHT - BOX.y0 } }]],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await runCommand(page, 'Edit text on the page');
  await beforeOpen?.();
  await openWords(page, page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(which)}"]`));
  await expect(page.locator(FRAME)).toHaveAttribute('data-kit-mode', 'text');
}

test('the box over a reference marker grows as words are typed past its edge, and its outline holds them', async ({ page }) => {
  await openMarker(page);
  const before = await page.locator(FRAME).boundingBox();
  if (before === null) throw new Error('no frame');
  await page.keyboard.press('End');
  await page.keyboard.type(' with added words', { delay: 40 });
  await expect(page.locator(SURFACE)).toHaveText('[13] [1] with added words');
  const frame = await page.locator(FRAME).boundingBox();
  // WHERE THE WORDS REACH, by each text node's own rectangles: a range over the surface's contents would answer the
  // paragraph's box, which is as wide as the surface whatever the words are.
  const words = await page.locator(SURFACE).evaluate((surface) => {
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let right = Number.NEGATIVE_INFINITY;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const range = surface.ownerDocument.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) right = Math.max(right, rect.right);
    }
    return { right };
  });
  if (frame === null) throw new Error('no frame');
  // THE CONTROL IS TODAY'S FRAME: the marker's own width, about 17 pt, with the words running on past its right edge.
  expect(frame.width).toBeGreaterThan(before.width * 2);
  expect(frame.x + frame.width).toBeGreaterThanOrEqual(words.right - 0.5);
});

test('a word typed wider than a paragraph is set whole on one line, never broken, and the box widens to hold it', async ({ page }) => {
  await openMarker(page, 2);
  await page.keyboard.press('Control+End');
  const long = 'Antidisestablishmentarianismwithoutanyspaceatall';
  await page.keyboard.type(` ${long}`, { delay: 10 });
  // THE WORD'S OWN RECTANGLES, one per line it stands on: ONE, where `overflow-wrap: break-word` set it on several.
  const lines = await page.locator(SURFACE).evaluate((surface, word) => {
    const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(word);
      if (at < 0) continue;
      const range = surface.ownerDocument.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
      return { count: new Set(rects.map((rect) => Math.round(rect.top))).size, right: Math.max(...rects.map((rect) => rect.right)) };
    }
    return { count: 0, right: 0 };
  }, long);
  expect(lines.count).toBe(1);
  const frame = await page.locator(FRAME).boundingBox();
  if (frame === null) throw new Error('no frame');
  expect(frame.x + frame.width).toBeGreaterThanOrEqual(lines.right - 0.5);
});

test("the link's hover does not cover the words being edited over it, and is shown over the same link before they open", async ({ page }) => {
  const hover = page.locator('[data-link-hover]');
  const marker = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
  // THE CONTROL, with no editor open: the pointer over the marker is over its link, and the hover says where it goes.
  await openMarker(page, 0, async () => {
    const box = await marker.boundingBox();
    if (box === null) throw new Error('no marker');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(hover).toHaveText('Open https://example.org/13 · Ctrl+click to follow');
  });
  const surface = await page.locator(SURFACE).boundingBox();
  if (surface === null) throw new Error('no surface');
  await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2 + 1);
  await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2);
  await expect(hover).toHaveCount(0);
});
