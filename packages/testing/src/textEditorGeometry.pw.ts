import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Where the open editor stands against the page it is over (the owner's A5 and A7, 2026-10-14): its words on the
 * page's words, its height the block's, the line below uncovered, and a one-line label one line however its face
 * measures.
 *
 * ## The instrument
 *
 * INK, read from pixels: the page's canvas before the editor opens, and the editor's own glyphs with the canvas hidden,
 * so the comparison is two drawings of one line and not the editor's claim about itself. The screenshot is decoded in a
 * blank page of the same browser, so no image library is needed. Its positive control is that both readings find ink.
 *
 * THE CONTROL, run 2026-10-14 on Chromium 151 at 200 % with the three behaviours disabled in a build that compiles
 * (no baseline shift, spacing from the ink's tops, no widening): the two-line block's words read 5 px below the page's
 * (ink top 414.7 against 409.7) and the label wrapped onto two lines; with them, both readings agree to the pixel. A
 * first control that reverted the file did not compile against the required `baseline`, so the build stopped and the
 * test ran the previous bundle and passed: a control's build is checked, not assumed.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000f5');
const BLACK = { r: 0, g: 0, b: 0 };
const SANS = { size: 12, colour: BLACK, serif: false, mono: false, italic: false, bold: false, font: 'Helvetica' } as const;
const SMALL = { ...SANS, size: 9 } as const;
const LABEL = { ...SANS, size: 10 } as const;
/** A mono face over a Helvetica label, so the editor's face is wider than the page's and a wrap would show. */
const WIDE = { ...LABEL, mono: true } as const;

/** Each line: its words, its baseline, its size, and its ink box (Helvetica's ascent 0.72 and descent 0.21 of the size). */
const LINES = [
  { text: 'Every line here ends on purpose.', baseline: 690, size: 12, right: 290 },
  { text: 'A second line, set below it.', baseline: 676, size: 12, right: 260 },
  { text: 'Small print just below the block.', baseline: 658, size: 9, right: 230 },
  // HELVETICA'S WIDTH for the label, about half an em a letter; the mono face the editor draws it in takes 0.6 an em.
  { text: 'Full name of the applicant:', baseline: 560, size: 10, right: 228 },
] as const;
const inkBox = (line: (typeof LINES)[number]) => ({ x0: 100, y0: line.baseline - 0.21 * line.size, x1: line.right, y1: line.baseline + 0.72 * line.size });

async function pageBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  for (const line of LINES) sheet.drawText(line.text, { x: 100, y: line.baseline, size: line.size, font });
  return document.save();
}

function blocks(labelStyle: typeof LABEL | typeof WIDE) {
  const [first, second, small, label] = LINES;
  const lineOf = (line: (typeof LINES)[number], index: number, style: typeof SANS | typeof SMALL | typeof LABEL | typeof WIDE) => ({
    runs: [{ index, text: line.text, style }],
    box: inkBox(line),
    soft: false,
    baseline: line.baseline,
  });
  return [
    {
      box: { x0: 100, y0: inkBox(second).y0, x1: first.right, y1: inkBox(first).y1 },
      lines: [lineOf(first, 1, SANS), lineOf(second, 2, SANS)],
      style: SANS,
      shape: { align: 'left' as const, firstIndent: 0 },
    },
    { box: inkBox(small), lines: [lineOf(small, 3, SMALL)], style: SMALL, shape: { align: 'left' as const, firstIndent: 0 } },
    { box: inkBox(label), lines: [lineOf(label, 4, labelStyle)], style: labelStyle, shape: { align: 'left' as const, firstIndent: 0 } },
  ];
}

async function open(page: Page, labelStyle: typeof LABEL | typeof WIDE = LABEL): Promise<void> {
  const bytes = await pageBytes();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Geometry.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: blocks(labelStyle),
    // AT 200 %, where the old placement put the words 5 px low (measured): at 100 % it was 2 to 3, near the tolerance.
    settings: { 'viewing.starting-zoom': '200pct' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"] [data-text-block="2"]')).toBeVisible();
  // THE OUTLINES AND HANDLES HIDDEN, so the only dark pixels are words.
  await page.addStyleTag({
    content: '.m-text-editor-handle,.m-text-editor-problem{visibility:hidden!important}.m-text-block{border-color:transparent!important;outline:none!important}.m-text-editor-frame{outline:none!important;border-color:transparent!important}',
  });
}

/** The rows and columns of dark pixels in `clip` of the page as it is drawn now. */
async function ink(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const shot = (await page.screenshot({ clip })).toString('base64');
  const scratch = await page.context().newPage();
  try {
    const found = await scratch.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (context === null) return null;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let top = Infinity;
      let bottom = -Infinity;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const at = (y * image.width + x) * 4;
          if (((pixels[at] ?? 255) + (pixels[at + 1] ?? 255) + (pixels[at + 2] ?? 255)) / 3 >= 110) continue;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return Number.isFinite(top) ? { top, bottom } : null;
    }, shot);
    if (found === null) throw new Error('no ink in the region: the instrument saw nothing');
    // IN CSS PIXELS of the page, as the clip is: the screenshot is at the device scale, which is 1 here.
    return { top: clip.y + found.top, bottom: clip.y + found.bottom };
  } finally {
    await scratch.close();
  }
}

/**
 * The editor's own glyphs' ink, the page's canvas hidden. A row nobody has changed is laid out where the editor would draw
 * it and painted in no colour, so the page shows (cloud run 19, `editorFidelity.pw.ts`); this instrument asks where the
 * words ARE laid out, so it paints them black for the reading, whatever their own colour, and takes the paint off after.
 */
async function editorInk(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const canvas = page.locator('canvas[data-page-canvas="0"]');
  const painted = await page.addStyleTag({
    content: '.m-kit__paragraph--as-drawn,.m-kit__paragraph--as-drawn *{color:black!important}',
  });
  await canvas.evaluate((element) => {
    (element as HTMLElement).style.visibility = 'hidden';
  });
  try {
    return await ink(page, clip);
  } finally {
    await canvas.evaluate((element) => {
      (element as HTMLElement).style.visibility = '';
    });
    await painted.evaluate((element) => {
      (element as HTMLElement).remove();
    });
  }
}

test.describe('the caret is where the person clicked, in a real browser (VVVVVVV-11)', () => {
  // THE BROWSER'S OWN `caretPositionFromPoint`, which the unit case stubs with one fixed node whatever the point: two
  // clicks on the same block, at its first letter and at its first line's end, and a letter typed after each. A caret
  // the layer left at one fixed place would put both letters in the same place, so the pair separates it.
  /** Opens the first block by two presses at `where` in its outline (the box, then the caret), types Z, and answers the editor's text. */
  const typedAt = async (page: Page, where: (box: { x: number; y: number; width: number; height: number }) => { x: number; y: number }) => {
    await open(page);
    const box = await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').boundingBox();
    if (box === null) throw new Error('no outline');
    const at = where(box);
    await page.mouse.click(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    const editor = page.locator(SURFACE);
    await expect(editor).toBeFocused();
    await page.keyboard.type('Z');
    // ONCE IT IS IN: a letter typed before the block's faces are read is held until they are, then put in at the press
    // (`BlockEditor`'s held press, at most 1.5 s), so the words read the instant after the key may not hold it yet.
    await expect(editor).toContainText('Z');
    return (await editor.innerText()).replace(/\s+/gu, ' ').trim();
  };

  test('a click at the block’s first letter puts the caret before it', async ({ page }) => {
    const text = await typedAt(page, (box) => ({ x: box.x + 1, y: box.y + box.height * 0.25 }));
    expect(text).toMatch(/^ZEvery line here/u);
  });

  test('a click at the end of its first line puts the caret after that line’s last letter', async ({ page }) => {
    const text = await typedAt(page, (box) => ({ x: box.x + box.width - 1, y: box.y + box.height * 0.25 }));
    expect(text).toContain('on purpose.Z');
    expect(text).not.toMatch(/^Z/u);
  });
});

test.describe('the open editor stands where the page’s words are (A5, A7)', () => {
  test('a two-line block: its words on the page’s, no taller than the block, and the line below uncovered', async ({ page }) => {
    await open(page);
    const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
    const box = await outline.boundingBox();
    const below = await page.locator('[data-text-edit-layer="0"] [data-text-block="1"]').boundingBox();
    if (box === null || below === null) throw new Error('no outline');
    const region = { x: box.x - 4, y: box.y - 8, width: box.width + 60, height: box.height + 16 };
    const drawn = await ink(page, region);
    await openWords(page, outline);
    await page.waitForTimeout(300);
    const typed = await editorInk(page, region);
    const editor = await page.locator(SURFACE).boundingBox();
    if (editor === null) throw new Error('no editor');
    const facts = JSON.stringify({ drawn, typed, editor, box, below });
    // THE WORDS WHERE THE PAGE'S ARE, within a pixel at the top and the foot of the ink.
    expect(Math.abs(typed.top - drawn.top), facts).toBeLessThanOrEqual(1.5);
    expect(Math.abs(typed.bottom - drawn.bottom), facts).toBeLessThanOrEqual(1.5);
    // AND THE EDITOR ENDS ABOVE THE LINE BELOW IT.
    expect(editor.y + editor.height, facts).toBeLessThanOrEqual(below.y + 1);
  });

  test('a one-line label: its words on the page’s, and it stays one line though its face is wider than the page’s', async ({ page }) => {
    await open(page, WIDE);
    const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="2"]');
    const box = await outline.boundingBox();
    if (box === null) throw new Error('no outline');
    const region = { x: box.x - 4, y: box.y - 8, width: box.width + 200, height: box.height + 40 };
    const drawn = await ink(page, region);
    await openWords(page, outline);
    const editor = page.locator(SURFACE);
    await page.waitForTimeout(300);
    const typed = await editorInk(page, region);
    const lines = await editor.evaluate((element) => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });
    const facts = JSON.stringify({ drawn, typed, lines, box });
    expect(Math.abs(typed.top - drawn.top), facts).toBeLessThanOrEqual(1.5);
    expect(lines, facts).toBe(1);
  });
});
