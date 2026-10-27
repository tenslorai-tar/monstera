import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A word a person highlights is the word the edit formats (the owner's video of 1.1.2609.0, on a document whose fonts are
 * drawn from shapes: highlighting the first word highlighted the second and third, and Bold off then landed on the last
 * three). The editor lays its invisible letters out in a stand-in face, and a line fitted only at its two ends leaves its
 * words where the stand-in puts them, not where the page draws them. Each run now says where the page draws its words,
 * and each word is fitted there (`fitDrawnLines`).
 *
 * The page draws its line in Helvetica, where `illicit` is narrow and `MOMWAW` wide, and the read names the run
 * fixed-pitch, so the stand-in gives every letter one width: the word a hand drags across on the page is, in the stand-in,
 * somewhere else. THE CONTROL is the same line with no word places, fitted at its ends alone, which selects other letters
 * than the word dragged across: it shows the case can see the defect it is for.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e6');
const WORDS = 'illicit lilt MOMWAW WAMMOW tilt little';
const SIZE = 12;
const LEFT = 72;

interface Word {
  readonly from: number;
  readonly to: number;
  readonly x0: number;
  readonly x1: number;
  readonly text: string;
}

async function open(page: Page, placed: boolean): Promise<{ words: Word[]; right: number }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(WORDS, { x: LEFT, y: 690, size: SIZE, font });
  const bytes = await document.save();
  // EACH WORD WHERE THE PAGE DRAWS IT, from the font's own advances.
  const words: Word[] = [];
  for (const match of WORDS.matchAll(/\S+/gu)) {
    const from = match.index;
    const x0 = LEFT + font.widthOfTextAtSize(WORDS.slice(0, from), SIZE);
    words.push({ from, to: from + match[0].length, x0, x1: x0 + font.widthOfTextAtSize(match[0], SIZE), text: match[0] });
  }
  const right = LEFT + font.widthOfTextAtSize(WORDS, SIZE);
  const box = { x0: LEFT, y0: 687, x1: right, y1: 699 };
  const style = { size: SIZE, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: true, italic: false, bold: false } as const;
  const run = { index: 3, text: WORDS, style, ...(placed ? { words: words.map(({ from, to, x0, x1 }) => ({ from, to, x0, x1 })) } : {}) };
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Words.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: [{ box, lines: [{ runs: [run], box, soft: false, baseline: 690 }], style, shape: { align: 'left' as const, firstIndent: 0 } }],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  return { words, right };
}

/**
 * Drags across a word where the page draws it, as a hand does, from just inside its first letter to just inside its last;
 * answers what the editor selected.
 */
async function dragAcross(page: Page, word: Word, right: number): Promise<string> {
  // THE FRAME IS THE BLOCK'S BOX ON SCREEN, the line's ink from its left to its right.
  const area = await page.locator('[data-kit-frame]').boundingBox();
  if (area === null) throw new Error('the editor has no frame');
  const at = (x: number): number => area.x + ((x - LEFT) / (right - LEFT)) * area.width;
  const y = area.y + area.height / 2;
  // A QUARTER OF A LETTER IN, before the first letter's middle and after the last's: a narrow `l` at this zoom is under
  // 3 px, and a press 1.5 px into one is past its middle, so the caret is rightly after it.
  const inset = (at(word.x1) - at(word.x0)) / (word.to - word.from) / 4;
  await page.mouse.move(at(word.x0) + inset, y);
  await page.mouse.down();
  await page.mouse.move(at(word.x1) - inset, y, { steps: 8 });
  await page.mouse.up();
  return page.locator(SURFACE).evaluate((root) => root.ownerDocument.getSelection()?.toString() ?? '');
}

/** The words the editor draws bold, as one string per run of bold letters. */
async function boldWords(page: Page): Promise<string[]> {
  return page.locator(SURFACE).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('span[data-kit-run]'))
      .filter((span) => span.style.fontWeight === '700')
      .map((span) => span.textContent)
      .join('|')
      .split(/\|?\s+\|?/u)
      .map((part) => part.replaceAll('|', ''))
      .filter((part) => part !== ''),
  );
}

test('a word dragged across where the page draws it is selected exactly, and Bold makes that word bold and no other', async ({ page }) => {
  const { words, right } = await open(page, true);
  for (const word of words) {
    // A HAND'S DRAG ON EACH WORD, a fresh press each time.
    expect(await dragAcross(page, word, right), `the drag across “${word.text}”`).toBe(word.text);
  }
  const target = words[3];
  if (target === undefined) throw new Error('no fourth word');
  expect(await dragAcross(page, target, right)).toBe(target.text);
  await page.keyboard.press('Control+B');
  await expect.poll(() => boldWords(page)).toEqual([target.text]);
});

test('no handle of the frame answers a point on the line’s last letter: every quarter pixel of its right half is the editor’s', async ({ page }) => {
  await open(page, true);
  const answers = await page.locator(SURFACE).evaluate((root) => {
    const last = Array.from(root.querySelectorAll('span[data-kit-run]')).at(-1)?.firstChild;
    if (!(last instanceof Text)) return ['no last letter'];
    const range = root.ownerDocument.createRange();
    range.setStart(last, last.data.length - 1);
    range.setEnd(last, last.data.length);
    const box = range.getBoundingClientRect();
    const y = (box.top + box.bottom) / 2;
    const found: string[] = [];
    // THE LETTER'S RIGHT HALF, to a hair inside its edge, where a drag across the word ends.
    for (let x = (box.left + box.right) / 2; x < box.right - 0.05; x += 0.25) {
      // THE EDITOR'S WORDS, a letter or the paragraph holding it, and nothing over them.
      const element = root.ownerDocument.elementFromPoint(x, y);
      if (element === null || !root.contains(element)) found.push(`${x.toFixed(2)}: ${element?.className ?? 'nothing'}`);
    }
    return found;
  });
  // MEASURED BEFORE THE GAP: from 0.9 px inside the edge on, the side handle answered, through its grip (`--m-handle-gap`).
  expect(answers).toEqual([]);
});

test('CONTROL: fitted at its ends alone, the same drags select other letters than the words dragged across', async ({ page }) => {
  const { words, right } = await open(page, false);
  const selected = [];
  for (const word of words) selected.push(await dragAcross(page, word, right));
  expect(selected.filter((each, at) => each !== words[at]?.text).length).toBeGreaterThan(0);
});
