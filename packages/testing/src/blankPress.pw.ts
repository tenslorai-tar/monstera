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

/** A page of short list lines with clear space between them, the owner's second page for the gesture. */
const ITEMS = ['• Seed trays', '• Twine', '• Two watering cans for the shed', '• Labels', '• Gloves, small'].map((text, index) => ({
  text,
  box: { x0: 90, y0: 100 + index * 26, x1: 90 + Math.round(text.length * 5.4), y1: 114 + index * 26 },
}));

interface Line {
  readonly text: string;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

async function open(page: Page, lines: readonly Line[] = ALL): Promise<void> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of lines) {
    const size = line.box.y1 - line.box.y0 > 15 ? 16 : 11;
    sheet.drawText(line.text.replace('•', '-'), { x: line.box.x0, y: PAGE_HEIGHT - line.box.y1 + 3.5, size, font });
  }
  const bytes = await document.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e5');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'club.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLinesPlaced: [lines],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(lines.length);
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

test('a click on blank paper just above a line’s box, whose wobble ends inside it 3 px across and 3 down, selects nothing', async ({ page }) => {
  await open(page, ITEMS);
  // THE LINE'S BOX ON SCREEN, the start of the search for blank space above it.
  const box = await page.locator('[data-text-layer="0"] [data-text-line]').nth(2).boundingBox();
  if (box === null) throw new Error('no line on screen');
  // SEVERAL POINTS ACROSS, so the wobble crosses a letter's edge at some of them: a drift inside one letter selected
  // nothing even before, and separates nothing.
  const selections: string[] = [];
  for (let across = 20; across <= 40; across += 2) {
    const x = box.x + across;
    // JUST ABOVE THE LINE'S BOX, in no line's band: blank paper. The line's letters are laid out in a substitute face
    // whose line box stands above the box the page reads, so the point is ON the line's element all the same — the
    // owner's page, where such a click went to the browser as a press on the line.
    const from = { x, y: box.y - 1.5 };
    const premise = await page.evaluate(
      ([px, py]) => ({
        banded: [...document.querySelectorAll('[data-text-layer="0"] [data-text-line]')].some((element) => {
          const rect = element.getBoundingClientRect();
          return (py ?? 0) >= rect.top && (py ?? 0) <= rect.bottom;
        }),
        onLetters: document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-text-line]') !== null,
      }),
      [from.x, from.y],
    );
    expect(premise, `(${String(across)}) is in no band, on the line's letters`).toEqual({ banded: false, onLetters: true });
    // THE WOBBLE, inside the platform's 4 px drag rectangle, into the line's box.
    selections.push(await press(page, from, { x: x + 3, y: box.y + 1.5 }));
  }
  expect(selections).toStrictEqual(selections.map(() => ''));
});

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

/**
 * THE OWNER'S GESTURE (the local agent's measurement on Windows, 2026-10-27): a press between two lines, a little above
 * a short line and right of where it ends, so in no line's band; then one pixel at a time down into that line's band,
 * still right of its end; release. It selected from the page's first character to that line's end, because the
 * platform parks a press outside every band at the page's start and the line-end follower extended that caret.
 */
async function gesture(page: Page, line: Line, down: number): Promise<string> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no text layer');
  const scale = layer.width / 612;
  const x = layer.x + (line.box.x1 + 14) * scale;
  const top = layer.y + line.box.y0 * scale;
  const from = { x, y: top - 1.5 };
  const bands = await page.evaluate(
    ([px, py]) => {
      const target = document.elementFromPoint(px ?? 0, py ?? 0);
      const inBand = [...document.querySelectorAll('[data-text-layer="0"] [data-text-line]')].some((element) => {
        const box = element.getBoundingClientRect();
        return (py ?? 0) >= box.top && (py ?? 0) <= box.bottom;
      });
      return { onLayer: target?.closest('[data-text-layer]') !== null, inBand };
    },
    [from.x, from.y],
  );
  expect(bands, `the press above "${line.text}" is on the layer and in no line's band`).toEqual({ onLayer: true, inBand: false });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= down; step += 1) await page.mouse.move(from.x + step * 0.4, from.y + step);
  const inside = await page.evaluate(
    ([px, py]) =>
      [...document.querySelectorAll('[data-text-layer="0"] [data-text-line]')].some((element) => {
        const box = element.getBoundingClientRect();
        return (py ?? 0) >= box.top && (py ?? 0) <= box.bottom && (px ?? 0) > box.right;
      }),
    [from.x + down * 0.4, from.y + down],
  );
  await page.mouse.up();
  expect(inside, 'the release is in the line’s band, right of its end').toBe(true);
  return page.evaluate(() => document.getSelection()?.toString() ?? '');
}

for (const [name, lines, index] of [
  ['the heading, on an ordinary page', ALL, 0],
  ['the paragraph’s first line, from the gap under the heading', ALL, 1],
  ['a short list line', ITEMS, 1],
  ['the list’s last line', ITEMS, 4],
] as const) {
  test(`THE OWNER'S GESTURE above ${name}, right of its end, drifting 2 and 3 px into its band, selects nothing`, async ({ page }) => {
    await open(page, lines);
    const line = lines[index];
    if (line === undefined) throw new Error('no line');
    for (const down of [2, 3]) expect(await gesture(page, line, down), `a ${String(down)} px drift`).toBe('');
  });
}

/**
 * TWO COLUMNS, the right one's line set at the height of a gap between the left one's lines (the owner's page, the local
 * agent's measurement on Windows, 2026-10-28: a click in a gap lay 141 px left of a line in another column, inside that
 * line's band, and selected 1,252 characters from the top of the page). A press there is BESIDE that line, not on any
 * letters, and the browser parks its caret at the page's first letter for it as for a blank press.
 */
const COLUMNS = [
  ...['Plots are kept tidy by the members who hold them,', 'and the tools are shared from the shed by all,', 'each one returned clean to its own hook again.'].map(
    (text, index) => ({ text, box: { x0: 72, y0: 120 + index * 26, x1: 72 + Math.round(text.length * 4.9), y1: 133 + index * 26 } }),
  ),
  { text: 'A note set in the margin', box: { x0: 430, y0: 136, x1: 430 + Math.round(24 * 4.9), y1: 149 } },
];

test('a click in a gap of one column, inside the band of a line in another, selects nothing', async ({ page }) => {
  await open(page, COLUMNS);
  const point = await at(page, 160, 139.5);
  const beside = await page.evaluate(
    ([, py]) =>
      [...document.querySelectorAll('[data-text-layer="0"] [data-text-line]')].filter((element) => {
        const box = element.getBoundingClientRect();
        return (py ?? 0) >= box.top && (py ?? 0) <= box.bottom;
      }).length,
    [point.x, point.y],
  );
  // THE PREMISE: the click is in exactly one line's band (the margin note's), on none of its letters.
  expect(beside, 'lines whose band holds the click').toBe(1);
  expect(await press(page, point, { x: point.x + 2, y: point.y + 1 })).toBe('');
});

test('CONTROL for the gesture: a drag from a line’s middle past its end still reaches its last letter', async ({ page }) => {
  await open(page, ITEMS);
  const line = ITEMS[2];
  if (line === undefined) throw new Error('no line');
  const middle = (line.box.y0 + line.box.y1) / 2;
  const selected = await press(page, await at(page, line.box.x0 + 30, middle), await at(page, line.box.x1 + 20, middle));
  expect(selected.length).toBeGreaterThan(10);
  expect(selected.endsWith('shed')).toBe(true);
});
