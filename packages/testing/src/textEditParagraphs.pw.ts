import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * AN OPEN BLOCK OF SEVERAL NUMBERED PARAGRAPHS SHOWS ONE COPY OF ITS WORDS, WHERE THE PAGE HAS THEM (cloud run 18, F2).
 *
 * ## The mechanism this holds
 *
 * The editor set every line of a block at one pitch, its first two baselines apart, and was as tall as those lines. A
 * contract clause of three numbered paragraphs with space between them is one block of five lines to PDFium and
 * `groupIntoBlocks`, and its baselines are not evenly spaced: the editor's last line stood 8 points above the page's,
 * and the page's own last line showed below the editor, a second copy a few pixels away. The lines carrying on a
 * clause's words were drawn at the number column's left. `paragraphPlaces` in `TextEditLayer.tsx` moves each paragraph
 * to where the page has it, and the frame carries the page's paper over the block's whole box.
 *
 * ## What is asserted, and how it is read
 *
 * - NO SECOND COPY: with the editor open and its own words made transparent, the block's box on screen holds no dark
 *   pixel, so nothing of the page's words shows beside or under the editor. Its positive control is the same box
 *   before the editor opens, which must hold ink.
 * - EACH LINE ON THE PAGE'S: a zero-size marker at the start of each of the editor's rows stands on its baseline and at
 *   its first letter's origin, and each is within a pixel of the page's line, at 100 % and at 200 %.
 * - OPENING AND CLOSING, every animation frame: while the editor is there it holds the block's words and its frame
 *   covers the block's box, so no frame shows the editor's words beside the page's, or an empty editor over paper.
 *
 * ## The fixture is the shape that fails
 *
 * Built from what the guard must get right: the case first asserts that the block's even spacing would put its last
 * line more than four pixels from the page's at 100 %, so with the placement removed it reads two copies. Measured
 * 2026-10-24 on Chromium 151 with `placeParagraphs` disabled and the frame's paper removed: the box held dark pixels of
 * the page's last line below the editor and the last row's baseline was 8 px off at 100 %.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000f2');
const TIMES = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: true, mono: false, italic: false, bold: false, font: 'Times-Roman' } as const;
const NO_PUSH = { below: [], room: 0 };

/** The clause as drawn: each number at x 72 and its words at x 90, 11 pt on 14, 3 and then 5 points between paragraphs. */
const DRAWN = [
  { number: '1.1', lines: ['The Supplier shall deliver the Goods to the Premises on the dates', 'set out in the Order, and in the quantities it names.'], baselines: [700, 686] },
  { number: '1.2', lines: ['Risk in the Goods passes to the Customer on delivery, and title', 'passes when the Customer has paid for them in full.'], baselines: [669, 655] },
  { number: '1.3', lines: ['Either party may end the Order on thirty days notice in writing.'], baselines: [636] },
];
const BELOW = { text: '2. Price', baseline: 602 };

/**
 * The clause AS THE APPLICATION READS IT: PDFium's `textRuns` over this page, grouped by `groupIntoBlocks` as
 * `composition.ts` groups them, read 2026-10-24 (PDFium 155.0.8044.0, Linux). One block of five lines, each ending on
 * purpose, the number joined to its words by a space; and the heading below as a block of its own.
 */
const READ = [
  { text: '1.1 The Supplier shall deliver the Goods to the Premises on the dates', baseline: 700, box: { x0: 73.221, y0: 697.624, x1: 376.44, y1: 707.513 } },
  { text: 'set out in the Order, and in the quantities it names.', baseline: 686, box: { x0: 90.561, y0: 683.624, x1: 311.056, y1: 693.513 } },
  { text: '1.2 Risk in the Goods passes to the Customer on delivery, and title', baseline: 669, box: { x0: 73.221, y0: 666.613, x1: 366.606, y1: 676.513 } },
  { text: 'passes when the Customer has paid for them in full.', baseline: 655, box: { x0: 90.055, y0: 652.624, x1: 317.161, y1: 662.513 } },
  { text: '1.3 Either party may end the Order on thirty days notice in writing.', baseline: 636, box: { x0: 73.221, y0: 633.613, x1: 367.871, y1: 643.513 } },
];
const CLAUSE_BOX = { x0: 73.221, y0: 633.613, x1: 376.44, y1: 707.513 };
const BELOW_BOX = { x0: 72.33, y0: 601.89, x1: 105.385, y1: 609.513 };

async function pageBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const sheet = document.addPage([612, 792]);
  for (const paragraph of DRAWN) {
    sheet.drawText(paragraph.number, { x: 72, y: paragraph.baselines[0] ?? 0, size: 11, font });
    paragraph.lines.forEach((line, at) => {
      sheet.drawText(line, { x: 90, y: paragraph.baselines[at] ?? 0, size: 11, font });
    });
  }
  sheet.drawText(BELOW.text, { x: 72, y: BELOW.baseline, size: 11, font });
  return document.save();
}

function blocks() {
  return [
    {
      box: CLAUSE_BOX,
      lines: READ.map((line, index) => ({ runs: [{ index: index + 1, text: line.text, style: TIMES }], box: line.box, soft: false, baseline: line.baseline })),
      style: TIMES,
      shape: { align: 'left' as const, firstIndent: 0 },
      push: NO_PUSH,
    },
    {
      box: BELOW_BOX,
      lines: [{ runs: [{ index: 6, text: BELOW.text, style: TIMES }], box: BELOW_BOX, soft: false, baseline: BELOW.baseline }],
      style: TIMES,
      shape: { align: 'left' as const, firstIndent: 0 },
      push: NO_PUSH,
    },
  ];
}

async function open(page: Page, zoom: string): Promise<void> {
  const bytes = await pageBytes();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Clause.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: blocks(),
    settings: { 'viewing.starting-zoom': zoom },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"] [data-text-block="1"]')).toBeVisible();
  // THE OUTLINES AND HANDLES HIDDEN, so the only dark pixels are words.
  await page.addStyleTag({
    content:
      '.m-text-editor-handle,.m-text-editor-problem{visibility:hidden!important}.m-text-block{border-color:transparent!important;outline:none!important}.m-text-editor-frame{outline:none!important;border-color:transparent!important}',
  });
}

/** PDF points of page 1 to the window, through the drawn page's own box. */
async function onScreen(page: Page): Promise<{ x: (x: number) => number; y: (y: number) => number; zoom: number }> {
  const canvas = await page.locator('canvas[data-page-canvas="0"]').boundingBox();
  if (canvas === null) throw new Error('the page has no canvas');
  const zoom = canvas.width / 612;
  return { x: (x) => canvas.x + x * zoom, y: (y) => canvas.y + (792 - y) * zoom, zoom };
}

/** How many dark pixels the window shows in `clip`: the words drawn there, in whatever drew them. */
async function darkPixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const shot = (await page.screenshot({ clip })).toString('base64');
  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context to read the screenshot with');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let dark = 0;
      for (let at = 0; at < pixels.length; at += 4) {
        if (((pixels[at] ?? 255) + (pixels[at + 1] ?? 255) + (pixels[at + 2] ?? 255)) / 3 < 110) dark += 1;
      }
      return dark;
    }, shot);
  } finally {
    await scratch.close();
  }
}

test('the fixture is the shape that fails: the even spacing puts the last line more than 4 px from the page’s at 100 %', () => {
  const [first, second] = READ;
  const last = READ.at(-1);
  if (first === undefined || second === undefined || last === undefined) throw new Error('no lines');
  const pitch = first.baseline - second.baseline;
  const even = first.baseline - (READ.length - 1) * pitch;
  expect(even - last.baseline).toBeGreaterThan(4);
});

for (const zoom of ['100pct', '200pct'] as const) {
  test(`an open clause of numbered paragraphs shows no second copy, and each line on the page’s (${zoom})`, async ({ page }) => {
    await open(page, zoom);
    const at = await onScreen(page);
    const region = {
      x: at.x(CLAUSE_BOX.x0) - 1,
      y: at.y(CLAUSE_BOX.y1) - 1,
      width: (CLAUSE_BOX.x1 - CLAUSE_BOX.x0) * at.zoom + 2,
      height: (CLAUSE_BOX.y1 - CLAUSE_BOX.y0) * at.zoom + 2,
    };
    // THE INSTRUMENT SEES THE PAGE'S WORDS in this box before the editor opens.
    const before = await darkPixels(page, region);
    expect(before).toBeGreaterThan(200);

    await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();
    const editor = page.locator('[data-text-editor]');
    await expect(editor).toBeFocused();
    await page.waitForTimeout(300);

    // EACH ROW'S BASELINE AND START against the page's line it was built from.
    const rows = await editor.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>(':scope > .m-text-editor__line'), (row) => {
        const marker = element.ownerDocument.createElement('span');
        marker.className = 'm-text-editor__baseline';
        row.prepend(marker);
        const box = marker.getBoundingClientRect();
        marker.remove();
        return { y: box.top, x: box.left, text: row.textContent };
      }),
    );
    expect(rows.map((row) => row.text)).toStrictEqual(READ.map((line) => line.text));
    const off = rows.map((row, index) => {
      const line = READ[index];
      return line === undefined ? { down: Infinity, across: Infinity } : { down: row.y - at.y(line.baseline), across: row.x - at.x(line.box.x0) };
    });
    const facts = JSON.stringify(off);
    // SOFT, so a run without the placement reports every row and the copy below rather than the first row alone.
    for (const each of off) {
      expect.soft(Math.abs(each.down), facts).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(each.across), facts).toBeLessThanOrEqual(1);
    }

    // AND NOTHING OF THE PAGE'S COPY: the editor's own words made transparent, its paper left as it is.
    await page.addStyleTag({ content: '[data-text-editor],[data-text-editor] *{color:transparent!important;text-decoration-color:transparent!important;caret-color:transparent!important}' });
    await page.waitForTimeout(100);
    expect.soft(await darkPixels(page, region)).toBe(0);
  });
}

test('opening and closing the clause’s editor shows, in every frame, either the page’s words or the editor’s over the whole block', async ({ page }) => {
  await open(page, '100pct');
  const at = await onScreen(page);
  const block = { left: at.x(CLAUSE_BOX.x0), top: at.y(CLAUSE_BOX.y1), right: at.x(CLAUSE_BOX.x1), bottom: at.y(CLAUSE_BOX.y0) };
  await page.evaluate(() => {
    const frames: { readonly open: boolean; readonly words: string; readonly cover: { left: number; top: number; right: number; bottom: number } | null }[] = [];
    Reflect.set(window, 'editorFrames', frames);
    const sample = (): void => {
      const editor = document.querySelector('[data-text-editor]');
      const element = editor?.closest('.m-text-editor-frame') ?? null;
      // THE BOX THE PAGE'S PAPER IS PAINTED OVER, which is the frame only where the frame carries the paper.
      const style = element === null ? null : getComputedStyle(element);
      const painted = style !== null && (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none');
      const frame = painted ? (element?.getBoundingClientRect() ?? null) : null;
      frames.push({ open: editor !== null, words: editor?.textContent ?? '', cover: frame === null ? null : { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom } });
      if (Reflect.get(window, 'editorFramesStop') !== true) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text-editor]')).toHaveCount(0);
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => {
    Reflect.set(window, 'editorFramesStop', true);
    return Reflect.get(window, 'editorFrames') as { readonly open: boolean; readonly words: string; readonly cover: { left: number; top: number; right: number; bottom: number } | null }[];
  });
  // THE WALK SAW BOTH: frames with the editor open and frames after it closed, or it proves nothing about either.
  expect(frames.some((frame) => frame.open)).toBe(true);
  expect(frames.at(-1)?.open).toBe(false);
  const words = READ.map((line) => line.text).join('');
  const wrong = frames.filter(
    (frame) =>
      frame.open &&
      (frame.words !== words ||
        frame.cover === null ||
        frame.cover.left > block.left + 0.5 ||
        frame.cover.top > block.top + 0.5 ||
        frame.cover.right < block.right - 0.5 ||
        frame.cover.bottom < block.bottom - 0.5),
  );
  expect(wrong, JSON.stringify({ block, wrong: wrong.slice(0, 4) })).toStrictEqual([]);
});
