import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * A drag that starts on a press Chromium places in two minds (F-C8, `holdPressedAnchor` in `TextLayer.tsx`).
 *
 * Chromium 151 places the press's caret at the exact pointer, then on the first drag event hit-tests the press again at
 * the point FLOORED to whole pixels and collapses there. Where a character's midpoint lies between the two, the drag
 * never becomes a range: the anchor follows the pointer and nothing is selected, so a line whose start lands there
 * cannot be highlighted, underlined, struck through or copied. It needs a pointer at a fraction of a pixel, which
 * Playwright's always is, and then whether a line fails depends on where its first letters fall: the shape of two lines
 * of one paragraph that failed on every press while the lines either side of them worked.
 *
 * ## The press is found, not guessed
 *
 * Each case scans the start of a line for a point where `caretPositionFromPoint` answers differently at the point and
 * at its floor, and refuses to run without one: a press anywhere else is a drag Chromium handles by itself, and a case
 * pressing there would pass with the repair deleted. The CONTROL makes the same press on a bare page with none of this
 * application in it and requires the drag to select nothing, so it fails the day Chromium stops doing this, which is
 * the day the repair can go.
 *
 * The kernel half of the markup pair is `pageAnnotations.test.ts`: MuPDF resolves the text between the two ends this
 * sends. The lines are this file's own words, placed at 11 on 13 with boxes that overlap by a point, as MuPDF reports a
 * paragraph's lines.
 */

const LINES = [
  'A selection begins where the press lands and runs with the pointer to the end of the line,',
  'so a person can mark the words they meant without aiming at the edge of a letter, and the',
  'line beneath reads the same way, whichever pixel of its first word the press happens to meet,',
  'which is how a paragraph is read: from where the eye starts to where the sentence stops.',
].map((text, index) => ({
  text,
  box: { x0: 72, y0: 90 + index * 13, x1: 72 + Math.round(text.length * 4.9), y1: 104 + index * 13 },
}));
const PAGE_HEIGHT = 792;

/** The paragraph drawn in Times at 11 points, so the page under the layer carries the words the layer holds. */
async function paragraphPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const line of LINES) page.drawText(line.text, { x: line.box.x0, y: PAGE_HEIGHT - line.box.y0 - 10.5, size: 11, font });
  return document.save();
}

/** Where on `line` a press puts its caret at one offset and its floored point at another, scanning the first 60 px. */
function splitPress(line: Locator): Promise<{ x: number; y: number; offset: number } | null> {
  return line.evaluate((element) => {
    const text = element.firstChild;
    const box = element.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const at = (x: number): number | null => {
      const caret = element.ownerDocument.caretPositionFromPoint(x, y);
      return caret?.offsetNode === text ? caret.offset : null;
    };
    for (let x = box.left + 0.05; x < box.left + 60; x += 0.05) {
      if (Number.isInteger(x)) continue;
      const exact = at(x);
      const floored = at(Math.floor(x));
      if (exact !== null && floored !== null && exact !== floored) return { x, y, offset: exact };
    }
    return null;
  });
}

/** The first line of {@link LINES} that has a split press, its index and the press. */
async function firstSplit(lines: Locator): Promise<{ index: number; press: { x: number; y: number; offset: number } }> {
  for (let index = 0; index < LINES.length; index += 1) {
    const press = await splitPress(lines.nth(index));
    if (press !== null) return { index, press };
  }
  throw new Error('no line has a point where the press caret and its floored point differ, so nothing here is tested');
}

/** Drags from `press` to `endX`, and answers the selection before the release. */
async function dragFrom(page: Page, press: { x: number; y: number }, endX: number): Promise<{ text: string; anchor: number }> {
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move((press.x + endX) / 2, press.y, { steps: 8 });
  await page.mouse.move(endX, press.y, { steps: 8 });
  const selected = await page.evaluate(() => {
    const selection = document.getSelection();
    return { text: selection?.toString() ?? '', anchor: selection?.anchorOffset ?? -1 };
  });
  await page.mouse.up();
  return selected;
}

/** Counts `dragstart` on the page: a re-anchor before the first drag event turns the press into a drag of the text. */
async function countDragStarts(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const counter = globalThis as unknown as { dragStarts: number };
    counter.dragStarts = 0;
    document.addEventListener('dragstart', () => {
      counter.dragStarts += 1;
    });
  });
  return () => page.evaluate(() => (globalThis as unknown as { dragStarts: number }).dragStarts);
}

/**
 * Just inside the end of line `index`, in the window: from the line's box through the layer, and not from the line
 * element's own box, which is the box SHRUNK by the horizontal fit (`fitLines`) while the text inside it is the box's
 * full width.
 */
async function lineEnd(page: Page, index: number): Promise<number> {
  const layer = await page.locator('[data-text-layer="0"]').boundingBox();
  const line = LINES[index];
  if (layer === null || line === undefined) throw new Error('no layer or no line');
  return layer.x + (line.box.x1 - 1) * (layer.width / 612);
}

async function openParagraph(page: Page, observe?: (channel: string, params: unknown) => void): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await paragraphPdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000c8');
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'paragraph.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      pageLinesPlaced: [LINES],
    },
    observe,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const lines = page.locator('[data-text-layer="0"] [data-text-line]');
  await expect(lines).toHaveCount(LINES.length);
  await pageShown(page);
  return lines;
}

test('a drag from a SPLIT PRESS selects from the press to the pointer', async ({ page }) => {
  const lines = await openParagraph(page);
  const dragStarts = await countDragStarts(page);
  const { index, press } = await firstSplit(lines);
  const text = LINES[index]?.text ?? '';
  const selected = await dragFrom(page, press, await lineEnd(page, index));
  // FROM THE PRESS: the anchor is the caret the press placed, and the run is the line's own text from there. Without
  // the repair the drag selects nothing, so an empty string cannot pass.
  expect(selected.anchor).toBe(press.offset);
  expect(selected.text.startsWith(text.slice(press.offset, press.offset + 30))).toBe(true);
  expect(selected.text.length).toBeGreaterThan(text.length - press.offset - 4);
  expect(await dragStarts()).toBe(0);
});

test('a HIGHLIGHT dragged from a split press marks its line (F-C8)', async ({ page }) => {
  const sent: unknown[] = [];
  const lines = await openParagraph(page, (channel, params) => {
    if (channel === 'document.execute') sent.push(params);
  });
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Highlight');
  await page.getByRole('option', { name: /^Highlight\b/u }).first().click();
  const dragStarts = await countDragStarts(page);
  const { index, press } = await firstSplit(lines);
  const line = LINES[index];
  if (line === undefined) throw new Error('no line');
  await dragFrom(page, press, await lineEnd(page, index));
  // THE CALL, not a state: the mark is a command the release sends, and a drag that selected nothing sends none.
  await expect.poll(() => sent.length).toBe(1);
  const { command } = sent[0] as {
    command: { kind: string; annotation: { type: string; from: { x: number; y: number }; to: { x: number; y: number } } };
  };
  expect([command.kind, command.annotation.type]).toStrictEqual(['addAnnotation', 'highlight']);
  // ON THE PRESSED LINE, from near its start to its end: both ends inside the line's band in PDF space.
  const band = [PAGE_HEIGHT - line.box.y1, PAGE_HEIGHT - line.box.y0];
  for (const end of [command.annotation.from, command.annotation.to]) {
    expect(end.y).toBeGreaterThanOrEqual(band[0] ?? 0);
    expect(end.y).toBeLessThanOrEqual(band[1] ?? 0);
  }
  expect(command.annotation.from.x).toBeLessThan(line.box.x0 + 40);
  expect(command.annotation.to.x).toBeGreaterThan(line.box.x1 - 6);
  expect(await dragStarts()).toBe(0);
});

test('CONTROL: Chromium alone collapses a drag from a split press to nothing', async ({ page }) => {
  // THE SAME PRESS with none of this application on the page: one span at a fractional offset. A drag that selects
  // here means Chromium no longer re-hit-tests the floored press, and `holdPressedAnchor` has nothing left to repair.
  const text = LINES[0]?.text ?? '';
  await page.setContent(
    `<!doctype html><body style="margin:0;font-family:serif"><span style="position:absolute;left:20.37px;top:40px;white-space:pre;font-size:14px;line-height:1">${text}</span></body>`,
  );
  const line = page.locator('span');
  const press = await splitPress(line);
  if (press === null) throw new Error('no split press on the bare line, so the control reproduces nothing');
  const box = await line.boundingBox();
  if (box === null) throw new Error('the bare line has no box');
  const selected = await dragFrom(page, press, box.x + box.width - 1);
  expect(selected.text).toBe('');
});
