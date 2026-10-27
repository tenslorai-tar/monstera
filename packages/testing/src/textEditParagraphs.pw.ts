import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
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
 * clause's words were drawn at the number column's left. The editor now opens each paragraph with the space the page
 * leaves above it and at its own edges (`modelOfBlock` in `editText/blockModel.ts`), so it stands where the page has it.
 *
 * ## Corrected by cloud run 19: ONE copy is now the PAGE'S, until the person changes a row
 *
 * This file first held the shape run 18 built, a papered frame over the block with the editor's copy drawn on it. Run
 * 19 measured that any second drawing changes what is shown on open (`editorFidelity.pw.ts`) and stopped drawing rows
 * nobody changed (`AS_DRAWN`). The single copy is now the page's own, so the first assertion below is that opening
 * changes no pixel of the block, and the walk's that no frame draws a row or lays paper while nothing is changed.
 *
 * ## What is asserted, and how it is read
 *
 * - ONE COPY: the block's box on screen holds the same dark pixels after the editor opens as before. Its positive
 *   control is that the box holds ink before.
 * - EACH LINE ON THE PAGE'S: a zero-size marker at the start of each of the editor's rows stands on its baseline and at
 *   its first letter's origin, and each is within a pixel of the page's line, at 100 % and at 200 %: where a changed
 *   row is drawn, and where the caret runs meanwhile.
 * - OPENING AND CLOSING, every animation frame: while the editor is there it holds the block's words and draws none of
 *   them and lays no paper, so no frame shows a second copy or a papered gap.
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
      // AND THE OUTLINE'S HOVER TINT, which an open block, having no outline, does not show (measured: 153 dark pixels at 200 %).
      '.m-text-editor-handle,.m-text-editor-problem{visibility:hidden!important}.m-text-block{border-color:transparent!important;outline:none!important;background:transparent!important}.m-text-editor-frame{outline:none!important;border-color:transparent!important}',
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

    await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
    const editor = page.locator(SURFACE);
    await page.waitForTimeout(300);
    // THE SAME PLACE ON THE PAGE, or the ink compared is of two places.
    expect((await onScreen(page)).y(CLAUSE_BOX.y1) - 1).toBe(region.y);

    // EACH ROW'S BASELINE AND START against the page's line it was built from.
    const rows = await editor.evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-kit-paragraph]'), (row) => {
        const marker = element.ownerDocument.createElement('span');
        marker.className = 'm-kit__baseline';
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

    // AND ONE COPY, THE PAGE'S: the box holds the ink it held before the editor opened, the caret hidden.
    await page.addStyleTag({ content: '[data-kit-surface]{caret-color:transparent!important}' });
    await page.waitForTimeout(100);
    expect.soft(await darkPixels(page, region)).toBe(before);
  });
}

test('opening and closing the clause’s editor shows, in every frame, the page’s words and nothing of the editor’s', async ({ page }) => {
  await open(page, '100pct');
  await page.evaluate(() => {
    const frames: { readonly open: boolean; readonly words: string; readonly drawn: number; readonly papered: number }[] = [];
    Reflect.set(window, 'editorFrames', frames);
    const clear = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none';
    };
    const sample = (): void => {
      const editor = document.querySelector('[data-kit-surface]');
      const rows = editor === null ? [] : Array.from(editor.querySelectorAll(':scope > [data-kit-paragraph]'));
      const frame = editor?.closest('.m-text-editor-frame') ?? null;
      frames.push({
        open: editor !== null,
        words: editor?.textContent ?? '',
        drawn: rows.filter((row) => getComputedStyle(row).color !== 'rgba(0, 0, 0, 0)').length,
        papered:
          document.querySelectorAll('.m-text-editor-cover').length +
          (editor !== null && !clear(editor) ? 1 : 0) +
          (frame !== null && !clear(frame) ? 1 : 0),
      });
      if (Reflect.get(window, 'editorFramesStop') !== true) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(page.locator(SURFACE)).toHaveCount(0);
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => {
    Reflect.set(window, 'editorFramesStop', true);
    return Reflect.get(window, 'editorFrames') as { readonly open: boolean; readonly words: string; readonly drawn: number; readonly papered: number }[];
  });
  // THE WALK SAW BOTH: frames with the editor open and frames after it closed, or it proves nothing about either.
  expect(frames.some((frame) => frame.open)).toBe(true);
  expect(frames.at(-1)?.open).toBe(false);
  const words = READ.map((line) => line.text).join('');
  const wrong = frames.filter((frame) => frame.open && (frame.words !== words || frame.drawn > 0 || frame.papered > 0));
  expect(wrong, JSON.stringify(wrong.slice(0, 4))).toStrictEqual([]);
});
