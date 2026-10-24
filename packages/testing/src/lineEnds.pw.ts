import { readFileSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { runCommand } from './palette.js';
import { pageShown } from './settled.js';

/**
 * A DRAG ACROSS A WHOLE LINE MARKS THE WHOLE LINE (cloud run 18, F1): its two ends are the line's first and last glyph,
 * within a point, however the pointer was sampled on the way out and whichever font the text layer is drawn in.
 *
 * ## The mechanism this holds
 *
 * Past a line's right edge a drag is over the layer's gap cover, which is not selectable, so Chromium kept the selection
 * where the LAST move event over the line had put it, and a move event is a sample of the pointer: a drag that left
 * *…continue for the term of* between two samples selected up to *term*, and the highlight, the copy and the look all
 * lost *of*. The same held for a press just before a line's first letter, on the layer beside it. `followPastLineEnds`
 * and `holdPressedAnchor` in `TextLayer.tsx` place both ends by one rule, `caretBesideLine`.
 *
 * ## What the case asserts, and against what
 *
 * Each line is dragged from 2 pt before its start to the middle of its second to last word, then in ONE move to 3 pt
 * past its end: the last sample on the line is inside a word that is not the last, which is the shape that failed. The
 * ends asserted are the PAGE'S glyph edges, MuPDF's character quads recorded in `agreement-lines.json`, and not the
 * text layer's boxes. The page is Times, standard 14 and not embedded. The kernel half is `lineEndMarks.proof.mjs`,
 * which holds that file to the engine's reading and shows that from these two ends MuPDF marks first glyph to last on
 * every font kind.
 *
 * ## Why it does not depend on the substitute font
 *
 * The text layer draws in a substitute for Times, and Windows and Linux have different ones. The rule reads only the
 * lines' boxes, which the engine reported, and each line is fitted to its box from the DOM's own layout of it, so the
 * case runs the same drags with the layer drawn in four families — the application's own, `serif`, `sans-serif` and
 * `monospace` — and asserts the same ends for each. The second and third are the ones where a canvas's measure of a
 * line disagreed with its layout (`fitLines`): with the canvas fit, `serif` ended 1.1 pt short of the last glyph and
 * failed here (measured 2026-10-24) while `monospace` passed.
 *
 * ## The CONTROL
 *
 * The same line, the same cover and the same drag on a bare page with none of this application in it, which must end
 * short of the line: the day Chromium extends a selection to the end of a line it runs past, the rule has nothing
 * left to repair, and that is when this control fails.
 */

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface AgreementLine {
  readonly text: string;
  readonly baseline: number;
  /** Where the engine reports the line, in display space: what the page's text layer is handed. */
  readonly box: Box;
  /** The left of its first glyph and the right of its last, from MuPDF's character quads. */
  readonly glyphs: { readonly first: number; readonly last: number };
}

/**
 * The page's lines, shared with `lineEndMarks.proof.mjs`, which holds every box and glyph edge in it to the engine's
 * own reading of the page built from it (that file's `$comment`). Read through a check rather than cast, so a file that
 * changed shape is an error here rather than a case that passes on `undefined`.
 */
function agreement(): { readonly size: number; readonly x: number; readonly pageHeight: number; readonly lines: readonly AgreementLine[] } {
  const parsed: unknown = JSON.parse(readFileSync(new URL('../fixtures/text-markup/agreement-lines.json', import.meta.url), 'utf8'));
  const number = (value: unknown): number => {
    if (typeof value !== 'number') throw new Error(`agreement-lines.json holds ${JSON.stringify(value)} where a number belongs`);
    return value;
  };
  const record = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) throw new Error('agreement-lines.json is not the shape this case reads');
    return value as Record<string, unknown>;
  };
  const file = record(parsed);
  const lines = file['lines'];
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('agreement-lines.json holds no lines');
  return {
    size: number(file['size']),
    x: number(file['x']),
    pageHeight: number(file['pageHeight']),
    lines: lines.map((value: unknown): AgreementLine => {
      const line = record(value);
      const box = record(line['box']);
      const glyphs = record(line['glyphs']);
      if (typeof line['text'] !== 'string') throw new Error('a line in agreement-lines.json has no text');
      return {
        text: line['text'],
        baseline: number(line['baseline']),
        box: { x0: number(box['x0']), y0: number(box['y0']), x1: number(box['x1']), y1: number(box['y1']) },
        glyphs: { first: number(glyphs['first']), last: number(glyphs['last']) },
      };
    }),
  };
}

const AGREEMENT = agreement();
const PAGE_HEIGHT = AGREEMENT.pageHeight;
const LINES = AGREEMENT.lines;

/** The page of {@link LINES}, in Times at their size and baselines, the font named and not embedded. */
async function timesPdf(): Promise<{ bytes: Uint8Array; widthOf: (text: string) => number }> {
  const document = await PDFDocument.create();
  const sheet = document.addPage([612, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of LINES) sheet.drawText(line.text, { x: AGREEMENT.x, y: line.baseline, size: AGREEMENT.size, font });
  return { bytes: await document.save(), widthOf: (text) => font.widthOfTextAtSize(text, AGREEMENT.size) };
}

interface Sent {
  readonly command: {
    readonly kind: string;
    readonly annotation: { readonly type: string; readonly from: { x: number; y: number }; readonly to: { x: number; y: number } };
  };
}

async function openTimes(page: Page, family: string | null, sent: Sent[]): Promise<{ widthOf: (text: string) => number }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { bytes, widthOf } = await timesPdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f1');
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'agreement.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      pageLinesPlaced: [LINES.map(({ text, box }) => ({ text, box }))],
    },
    (channel, params) => {
      if (channel === 'document.execute') sent.push(params as Sent);
    },
  );
  await page.goto('/');
  // A SUBSTITUTE OF THE CASE'S CHOOSING, before the page opens so the layer is fitted in it from its first frame.
  if (family !== null) await page.addStyleTag({ content: `.m-text-line { font-family: ${family} !important; }` });
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(LINES.length);
  await pageShown(page);
  return { widthOf };
}

/** Points on the page to the window, through the text layer's own box. */
async function toWindow(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  if (layer === null) throw new Error('the page has no text layer');
  const k = layer.width / 612;
  return (x, y) => ({ x: layer.x + x * k, y: layer.y + y * k });
}

/**
 * Drags line `index` the way that failed: from 2 pt before it to the middle of its second to last word, then in one
 * move to 3 pt past its end. Answers the selected text before the release.
 */
async function dragWholeLine(page: Page, index: number, widthOf: (text: string) => number): Promise<string> {
  const line = LINES[index];
  if (line === undefined) throw new Error(`no line ${String(index)}`);
  const at = await toWindow(page);
  const y = (line.box.y0 + line.box.y1) / 2;
  const words = line.text.split(' ');
  const penultimate = words.slice(0, -1).join(' ');
  const lastStart = penultimate.length - (words.at(-2) ?? '').length;
  const inside = AGREEMENT.x + (widthOf(line.text.slice(0, lastStart)) + widthOf(penultimate)) / 2;
  // THE SAMPLE ON THE LINE IS INSIDE A WORD THAT IS NOT THE LAST, or this is a drag Chromium ends correctly by itself.
  if (inside >= AGREEMENT.x + widthOf(penultimate)) throw new Error('the last sample is not inside the second to last word');
  const start = at(line.box.x0 - 2, y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const middle = at(inside, y);
  await page.mouse.move(middle.x, middle.y, { steps: 6 });
  const past = at(line.box.x1 + 3, y);
  await page.mouse.move(past.x, past.y);
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.mouse.up();
  return selected;
}

for (const family of [null, 'serif', 'sans-serif', 'monospace']) {
  test(`a whole line dragged with HIGHLIGHT is marked from its first glyph to its last (${family ?? 'the application’s font'})`, async ({ page }) => {
    const sent: Sent[] = [];
    const { widthOf } = await openTimes(page, family, sent);
    await runCommand(page, 'Highlight text');
    for (const [index, line] of LINES.entries()) {
      const edge = line.glyphs;
      const selected = await dragWholeLine(page, index, widthOf);
      // WHAT A COPY TAKES: the whole line, which the held selection was not.
      expect(selected.trim()).toBe(line.text);
      await expect.poll(() => sent.length).toBe(index + 1);
      const made = sent[index];
      if (made === undefined) throw new Error(`no command for line ${String(index)}`);
      const { command } = made;
      expect([command.kind, command.annotation.type]).toStrictEqual(['addAnnotation', 'highlight']);
      // THE TWO ENDS MUPDF RESOLVES THE MARK FROM, at the page's own glyph edges and inside the line's band.
      expect(Math.abs(command.annotation.from.x - edge.first)).toBeLessThanOrEqual(1);
      expect(Math.abs(command.annotation.to.x - edge.last)).toBeLessThanOrEqual(1);
      for (const end of [command.annotation.from, command.annotation.to]) {
        expect(end.y).toBeGreaterThan(PAGE_HEIGHT - line.box.y1);
        expect(end.y).toBeLessThan(PAGE_HEIGHT - line.box.y0);
      }
    }
  });
}

test('UNDERLINE and STRIKETHROUGH dragged across the long line reach its last glyph too', async ({ page }) => {
  const sent: Sent[] = [];
  const { widthOf } = await openTimes(page, null, sent);
  const edge = LINES[0]?.glyphs;
  if (edge === undefined) throw new Error('no lines');
  for (const [title, type] of [['Underline text', 'underline'], ['Strikethrough text', 'strikeout']] as const) {
    await runCommand(page, title);
    await dragWholeLine(page, 0, widthOf);
    await expect.poll(() => sent.at(-1)?.command.annotation.type).toBe(type);
    const made = sent.at(-1);
    if (made === undefined) throw new Error(`no command for ${type}`);
    const { command } = made;
    expect(Math.abs(command.annotation.from.x - edge.first)).toBeLessThanOrEqual(1);
    expect(Math.abs(command.annotation.to.x - edge.last)).toBeLessThanOrEqual(1);
  }
});

test('CONTROL: Chromium alone ends the same drag at the last sample on the line, short of its end', async ({ page }) => {
  // THE SAME LINE fitted to its box, over the same kind of cover — absolute, not selectable, under the line — with none
  // of this application on the page.
  const line = LINES[0];
  if (line === undefined) throw new Error('no line');
  const { widthOf } = await timesPdf();
  const width = line.box.x1 - line.box.x0;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(
    '<!doctype html><body style="margin:0;font-family:serif">' +
      '<div id="layer" style="position:absolute;left:0;top:0;width:612px;height:792px;line-height:1;user-select:text">' +
      '<div style="position:absolute;inset:0;user-select:none"></div>' +
      `<span id="line" style="position:absolute;left:${String(line.box.x0)}px;top:${String(line.box.y0)}px;width:${String(width)}px;` +
      `height:14px;font-size:14px;white-space:pre;transform-origin:0 0">${line.text}</span></div></body>`,
  );
  await page.evaluate((box) => {
    const element = document.getElementById('line');
    if (element === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    element.style.transform = `scaleX(${String(box / range.getBoundingClientRect().width)})`;
  }, width);
  const y = (line.box.y0 + line.box.y1) / 2;
  const words = line.text.split(' ');
  const penultimate = words.slice(0, -1).join(' ');
  const lastStart = penultimate.length - (words.at(-2) ?? '').length;
  await page.mouse.move(line.box.x0 + 1, y);
  await page.mouse.down();
  await page.mouse.move(AGREEMENT.x + (widthOf(line.text.slice(0, lastStart)) + widthOf(penultimate)) / 2, y, { steps: 6 });
  await page.mouse.move(line.box.x1 + 3, y);
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  await page.mouse.up();
  // SOMETHING WAS SELECTED, so the short end is the hold and not a drag that never began.
  expect(selected.length).toBeGreaterThan(10);
  expect(selected.endsWith(' of')).toBe(false);
});
