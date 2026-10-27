import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * Select text, the plain tool, on an ordinary page: a press on blank space must not select from the top of the page
 * (the local agent's measurement on Windows, 2026-10-27: a press on blank space collapsed the selection to the first
 * line's start, so a press with any drift onto text selected everything from the page's top to there — 1,252
 * characters in its probe, a heading and a paragraph in the owner's video).
 *
 * Every press here is a hand's: down, one or two pixels of drift, up. A click on blank space selects nothing; a press on
 * blank space that drifts onto words selects from the text nearest the press to the pointer, which is what it crossed;
 * a drag across words selects exactly them.
 */

const HEADING = { text: 'Terms of the garden club', box: { x0: 72, y0: 60, x1: 72 + 24 * 8, y1: 78 } };
const LINES = [
  'Members keep their own plots tidy and share the tools in the shed with everyone else,',
  'returning each one clean to its hook, and they bring their cuttings to the spring sale,',
  'where every pound raised goes to new seed and to the upkeep of the greenhouse roof.',
].map((text, index) => ({ text, box: { x0: 72, y0: 120 + index * 13, x1: 72 + Math.round(text.length * 4.9), y1: 134 + index * 13 } }));
const ALL = [HEADING, ...LINES];
const PAGE_HEIGHT = 792;

async function open(page: Page): Promise<void> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  sheet.drawText(HEADING.text, { x: 72, y: PAGE_HEIGHT - 74, size: 16, font });
  for (const line of LINES) sheet.drawText(line.text, { x: line.box.x0, y: PAGE_HEIGHT - line.box.y0 - 10.5, size: 11, font });
  const bytes = await document.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e5');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'club.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLinesPlaced: [ALL],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(ALL.length);
  await pageShown(page);
}

/** A point of the page, in PDF points from its top left, on the window. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no text layer');
  const scale = layer.width / 612;
  return { x: layer.x + x * scale, y: layer.y + y * scale };
}

/** A hand's press: down at `from`, drifting to `to` in a few moves, up; and the selection it left. */
async function press(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  return page.evaluate(() => document.getSelection()?.toString() ?? '');
}

test('a click on blank space with a pixel or two of drift selects nothing, below the text and in the margin', async ({ page }) => {
  await open(page);
  for (const [x, y] of [[300, 300], [300, 100], [60, 400]] as const) {
    const point = await at(page, x, y);
    const onLayer = await page.evaluate(([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-text-layer]') !== null, [point.x, point.y]);
    expect(onLayer, `(${String(x)}, ${String(y)}) is on the text layer`).toBe(true);
    expect(await press(page, point, { x: point.x + 1.5, y: point.y + 1 }), `a click at (${String(x)}, ${String(y)})`).toBe('');
  }
});

/** A point a pixel outside a line's box, above it or below it, and the point two pixels on, inside it. */
async function justOff(page: Page, line: { box: { x0: number; y0: number; y1: number } }, side: 'above' | 'below', across: number) {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no text layer');
  const scale = layer.width / 612;
  const x = layer.x + (line.box.x0 + across) * scale;
  const edge = layer.y + (side === 'above' ? line.box.y0 : line.box.y1) * scale;
  const from = { x, y: side === 'above' ? edge - 1 : edge + 1 };
  return { from, to: { x: x + 1, y: side === 'above' ? from.y + 2 : from.y - 2 } };
}

for (const [name, side, index] of [
  ['above the paragraph’s first line', 'above', 1],
  ['below the paragraph’s last line', 'below', 3],
  ['above the heading', 'above', 0],
] as const) {
  test(`a press a pixel ${name}, drifting two pixels onto it, selects at most a few letters and never from the top of the page`, async ({ page }) => {
    await open(page);
    const line = ALL[index];
    if (line === undefined) throw new Error('no line');
    const { from, to } = await justOff(page, line, side, 60);
    const selected = await press(page, from, to);
    // WHAT THE DRIFT CROSSED: at most the letter or two under it. From the top of the page it was everything above too.
    expect(selected.length).toBeLessThanOrEqual(3);
    if (index > 0) expect(selected).not.toContain('Terms');
  });
}

test('THE MECHANISM: a bare press on blank space leaves no anchor at the page’s first letter', async ({ page }) => {
  await open(page);
  // BLANK POINTS ON THE PAGE, each on the text layer and on no line: below the text, between the heading and the
  // paragraph, under the last line.
  for (const [x, y] of [[300, 300], [200, 100], [150, 170]] as const) {
    const point = await at(page, x, y);
    const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-text-layer]') !== null, [point.x, point.y]);
    expect(hit, `(${String(x)}, ${String(y)}) is on the text layer`).toBe(true);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    // WHILE HELD, before any move: the browser put its caret at the layer's start, the heading's first letter; the fix
    // leaves no selection at all.
    const where = await page.evaluate(() => {
      const selection = document.getSelection();
      const line = selection?.anchorNode?.parentElement?.closest('[data-text-line]');
      return line === null || line === undefined ? 'none' : `${line.textContent.slice(0, 5)}@${String(selection?.anchorOffset)}`;
    });
    await page.mouse.up();
    expect(where, `the anchor after a press at (${String(x)}, ${String(y)})`).toBe('none');
  }
});

test('a press in the gap above a paragraph, dragged into its first line, selects only what it crossed of that line', async ({ page }) => {
  await open(page);
  const line = LINES[0];
  if (line === undefined) throw new Error('no line');
  const gap = await at(page, 200, 100);
  const inside = await at(page, 300, (line.box.y0 + line.box.y1) / 2);
  const selected = await press(page, gap, inside);
  expect(selected.length).toBeGreaterThan(0);
  expect(line.text.includes(selected)).toBe(true);
  expect(selected).not.toContain('Terms');
});

test('CONTROL: a drag across words selects exactly them', async ({ page }) => {
  await open(page);
  const line = LINES[1];
  if (line === undefined) throw new Error('no line');
  const start = await at(page, line.box.x0 + 1, (line.box.y0 + line.box.y1) / 2);
  const end = await at(page, line.box.x1 - 1, (line.box.y0 + line.box.y1) / 2);
  const selected = await press(page, start, end);
  expect(selected.startsWith('returning')).toBe(true);
  expect(selected).not.toContain('Members');
});
