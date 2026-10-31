import { readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * ADR-0280's TWO RULES, in Chromium, on the agreement page's Times lines with their letters stated as the engine reads
 * them (each glyph's own width, which `textLetters.test.ts` holds MuPDF to within 0.005 pt):
 *
 * - **rule (i)**, the selection is painted from its range alone, over the engine's letters;
 * - **rule (ii)**, a letter's side is decided from the engine's letters, for a press and a drag's moving end.
 *
 * The layer is drawn in `monospace`, whose letters stand far from Times', so every rule that read the browser's layout
 * instead would land visibly elsewhere — the control on each case measures how far.
 */

interface AgreementLine {
  readonly text: string;
  readonly baseline: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

const AGREEMENT = JSON.parse(readFileSync(new URL('../fixtures/text-markup/agreement-lines.json', import.meta.url), 'utf8')) as {
  readonly size: number;
  readonly x: number;
  readonly pageHeight: number;
  readonly lines: readonly AgreementLine[];
};
const LINES = AGREEMENT.lines;

/** The page, and each line's letters as the engine would read them: each glyph's own advance, in hundredths. */
async function timesPage(): Promise<{ bytes: Uint8Array; places: (index: number) => number[] }> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, AGREEMENT.pageHeight]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of LINES) sheet.drawText(line.text, { x: AGREEMENT.x, y: line.baseline, size: AGREEMENT.size, font });
  const placesOf = (text: string): number[] => {
    const out = [0];
    for (const character of text) out.push((out.at(-1) ?? 0) + Math.round(font.widthOfTextAtSize(character, AGREEMENT.size) * 100));
    return out;
  };
  return { bytes: await document.save(), places: (index) => placesOf(LINES[index]?.text ?? '') };
}

/** Opens the page with letters on every line but `bare`, whose line is placed as before. */
async function open(page: Page, bare: number | null): Promise<{ places: (index: number) => number[] }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { bytes, places } = await timesPage();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
  await bridge(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'agreement.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    pageLinesPlaced: [
      LINES.map((line, index) => {
        const at = places(index);
        const advances = at.slice(1).map((place, k) => place - (at[k] ?? 0));
        return index === bare
          ? { text: line.text, box: line.box }
          : {
              text: line.text,
              box: line.box,
              letters: { origin: { x: AGREEMENT.x, y: AGREEMENT.pageHeight - line.baseline }, direction: { x: 1, y: 0 }, size: AGREEMENT.size, advances },
            };
      }),
    ],
  });
  await page.goto('/');
  await page.addStyleTag({ content: '.m-text-line { font-family: monospace !important; }' });
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES.length);
  await pageShown(page);
  return { places };
}

/** Page points to the layer's pixels, and to the window's. */
async function scales(page: Page): Promise<{ k: number; left: number; top: number }> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('no text layer');
  return { k: layer.width / 612, left: layer.x, top: layer.y };
}

/** Selects `from` to `to` of line `index` by its text node, as the platform's own selection. */
async function select(page: Page, index: number, from: number, to: number): Promise<void> {
  await page.evaluate(
    ({ line, start, end }) => {
      const node = document.querySelector(`[data-text-layer="0"] [data-text-line="${String(line)}"]`)?.firstChild;
      if (node === null || node === undefined) throw new Error('no line');
      document.getSelection()?.setBaseAndExtent(node, start, node, end);
    },
    { line: index, start: from, end: to },
  );
}

/** The painted selection's shapes, each as its left and right in the layer's pixels. */
async function painted(page: Page): Promise<{ left: number; right: number }[]> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page.locator('[data-text-layer="0"] .m-text-layer__selection polygon').evaluateAll((polygons) =>
    polygons.map((polygon) => {
      const xs = (polygon.getAttribute('points') ?? '').split(' ').map((pair) => Number(pair.split(',')[0]));
      return { left: Math.min(...xs), right: Math.max(...xs) };
    }),
  );
}

/** Where the browser lays the same span out, in the layer's pixels: what a painter reading the DOM would draw. */
async function laidOut(page: Page, index: number, from: number, to: number): Promise<{ left: number; right: number }> {
  return page.evaluate(
    ({ line, start, end }) => {
      const layer = document.querySelector('[data-text-layer="0"]');
      const node = layer?.querySelector(`[data-text-line="${String(line)}"]`)?.firstChild;
      if (layer === null || node === null || node === undefined) throw new Error('no line');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const box = range.getBoundingClientRect();
      const origin = layer.getBoundingClientRect();
      return { left: box.left - origin.left, right: box.right - origin.left };
    },
    { line: index, start: from, end: to },
  );
}

test('RULE (i): the selection is painted over the engine’s letters, from its range alone', async ({ page }) => {
  const { places } = await open(page, null);
  const { k } = await scales(page);
  const at = places(0);
  await select(page, 0, 5, 30);
  const [shape, ...rest] = await painted(page);
  expect(rest).toStrictEqual([]);
  const left = (AGREEMENT.x + (at[5] ?? 0) / 100) * k;
  const right = (AGREEMENT.x + (at[30] ?? 0) / 100) * k;
  expect(Math.abs((shape?.left ?? NaN) - left), `painted left ${String(shape?.left)} against the engine's ${String(left)}`).toBeLessThan(0.5);
  expect(Math.abs((shape?.right ?? NaN) - right), `painted right ${String(shape?.right)} against the engine's ${String(right)}`).toBeLessThan(0.5);
  // CONTROL: the browser lays the same span out elsewhere, so a painter that read the DOM would have failed above.
  const dom = await laidOut(page, 0, 5, 30);
  expect(Math.max(Math.abs(dom.left - left), Math.abs(dom.right - right))).toBeGreaterThan(5);
});

test('RULE (ii): a drag selects the letters the engine has under its two ends, not the substitute’s', async ({ page }) => {
  const { places } = await open(page, null);
  const { k, left, top } = await scales(page);
  const line = LINES[0];
  if (line === undefined) throw new Error('no line');
  const at = places(0);
  const y = top + ((line.box.y0 + line.box.y1) / 2) * k;
  // EACH END ON A LETTER'S SECOND HALF, by the engine: letter 10 and letter 40, so the caret goes after each.
  const xOf = (letter: number): number => left + (AGREEMENT.x + ((at[letter] ?? 0) * 0.3 + (at[letter + 1] ?? 0) * 0.7) / 100) * k;
  await page.mouse.move(xOf(10), y);
  await page.mouse.down();
  await page.mouse.move(xOf(25), y, { steps: 4 });
  await page.mouse.move(xOf(40), y, { steps: 4 });
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.mouse.up();
  expect(selected).toBe(line.text.slice(11, 41));
});

test('CONTROL: on a line placed as before, the same drag is the browser’s and lands elsewhere', async ({ page }) => {
  const { places } = await open(page, 0);
  const { k, left, top } = await scales(page);
  const line = LINES[0];
  if (line === undefined) throw new Error('no line');
  const at = places(0);
  const y = top + ((line.box.y0 + line.box.y1) / 2) * k;
  const xOf = (letter: number): number => left + (AGREEMENT.x + ((at[letter] ?? 0) * 0.3 + (at[letter + 1] ?? 0) * 0.7) / 100) * k;
  await page.mouse.move(xOf(10), y);
  await page.mouse.down();
  await page.mouse.move(xOf(25), y, { steps: 4 });
  await page.mouse.move(xOf(40), y, { steps: 4 });
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.mouse.up();
  expect(selected).not.toBe(line.text.slice(11, 41));
});
