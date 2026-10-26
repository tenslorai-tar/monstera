import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * THE CLICK THAT OPENS A BLOCK PUTS THE CARET WHERE IT WAS PRESSED (cloud run 21, the owner's video of 2026-10-26):
 * the boundary between characters nearest the point, in the editor's own text, exactly where a click inside the open
 * editor would put it, and a letter typed then lands there.
 *
 * ## The oracle is the open editor itself
 *
 * Each target is read off the editor's own layout once it has settled, opened by a key so no point is involved: the
 * two characters either side of a boundary, and the point between them. The editor is closed with nothing changed, and
 * the block is then opened by ONE press at that point, as a hand makes it (down, a pixel's move, up). The letter typed
 * must land at that boundary, and the caret must stand within half a character of the press.
 *
 * ## The three blocks, and why each
 *
 * - A HEADING OVER THREE LINES whose runs the host answers a rebuilt font for (ADR-0175), as it does for a web-printed
 *   page's Type 3 text, after a delay as a host's answer has: until it arrives the runs are drawn in their kind of face,
 *   whose widths are not the font's.
 * - A PARAGRAPH WITH RAISED REFERENCE MARKERS, smaller than the body and set above its line, in a rebuilt font too.
 * - A CODE BLOCK in the editor's fixed-pitch face, with no rebuilt font, at 150 %.
 *
 * ## The control, run 2026-10-26 on Chromium 151 against the build before this change
 *
 * Eight of the fourteen red, every one a press away from a line's start or end: the heading mid-word on each of its three
 * lines, the paragraph mid-word, before its marker (32 px off) and on its second line (6 px), and the code block mid-word
 * on its first and third lines (99 and 45 px). The caret was turned into a character once, as the editor was built, from
 * a layout that was not yet the one shown (`useOpeningPress`). The six that passed are the line starts and ends, which
 * that layout also gets right, and which is all the cases in `textEditorGeometry.pw.ts` pressed.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000c1');
const BLACK = { r: 0, g: 0, b: 0 };
const FONTS = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts');
const BOLD = new Uint8Array(readFileSync(join(FONTS, 'LiberationSans-Bold.ttf')));
const REGULAR = new Uint8Array(readFileSync(join(FONTS, 'LiberationSans-Regular.ttf')));
/** How long the host takes to answer the runs' fonts: long enough that a caret placed before them is visibly placed. */
const FONT_DELAY = 300;

/** A heading's run: drawn in its kind of face (serif) until the host's rebuilt sans arrives, so the two widths differ. */
const HEADING = { size: 20, colour: BLACK, serif: true, mono: false, italic: false, bold: true, font: 'T3Font_1' } as const;
const BODY = { size: 10, colour: BLACK, serif: true, mono: false, italic: false, bold: false, font: 'T3Font_2' } as const;
const MARKER = { ...BODY, size: 7.88, rise: 3.5 } as const;
const CODE = { size: 10, colour: BLACK, serif: false, mono: true, italic: false, bold: false, font: 'Courier' } as const;

type Style = typeof HEADING | typeof BODY | typeof MARKER | typeof CODE;
interface LineSpec {
  readonly runs: readonly { readonly text: string; readonly style: Style }[];
  readonly baseline: number;
  readonly soft: boolean;
}

/** A block of lines set from x = 72, each line's box its words' ink at about half an em a letter. */
function blockOf(lines: readonly LineSpec[], first: number) {
  let index = first;
  const built = lines.map((line) => {
    const size = Math.max(...line.runs.map((run) => run.style.size));
    const length = line.runs.reduce((sum, run) => sum + run.text.length * run.style.size * 0.5, 0);
    const box = { x0: 72, y0: line.baseline - 0.21 * size, x1: 72 + length, y1: line.baseline + 0.72 * size + 4 };
    return {
      runs: line.runs.map((run) => ({ index: index++, text: run.text, style: run.style })),
      box,
      soft: line.soft,
      baseline: line.baseline,
    };
  });
  const box = {
    x0: 72,
    y0: Math.min(...built.map((line) => line.box.y0)),
    x1: Math.max(...built.map((line) => line.box.x1)),
    y1: Math.max(...built.map((line) => line.box.y1)),
  };
  return { box, lines: built, style: lines[0]?.runs[0]?.style ?? BODY, shape: { align: 'left' as const, firstIndent: 0 }, push: { below: [], room: 0 } };
}

const HEADING_BLOCK = blockOf(
  [
    { runs: [{ text: 'Edit text puts the caret', style: HEADING }], baseline: 700, soft: true },
    { runs: [{ text: 'where the person clicked,', style: HEADING }], baseline: 676, soft: true },
    { runs: [{ text: 'on every line it opens', style: HEADING }], baseline: 652, soft: false },
  ],
  10,
);
const PARAGRAPH_BLOCK = blockOf(
  [
    {
      runs: [
        { text: 'Reference markers sit above the body text', style: BODY },
        { text: '[4]', style: MARKER },
        { text: ' and', style: BODY },
      ],
      baseline: 600,
      soft: true,
    },
    {
      runs: [
        { text: 'the size field reads the body, not the marker', style: BODY },
        { text: '[5]', style: MARKER },
        { text: '.', style: BODY },
      ],
      baseline: 586,
      soft: false,
    },
  ],
  20,
);
const CODE_BLOCK = blockOf(
  [
    { runs: [{ text: 'git clone https://example.org/repo.git', style: CODE }], baseline: 500, soft: false },
    { runs: [{ text: 'cd repo && npm install', style: CODE }], baseline: 486, soft: false },
    { runs: [{ text: 'npm run build -- --watch', style: CODE }], baseline: 472, soft: false },
  ],
  30,
);
const BLOCKS = [HEADING_BLOCK, PARAGRAPH_BLOCK, CODE_BLOCK];

/** The heading's runs answered the bold program, the paragraph's the regular one: the host's rebuilt fonts. */
function runFonts(): { fonts: Uint8Array<ArrayBuffer>[]; runs: Map<number, number> } {
  const runs = new Map<number, number>();
  for (const line of HEADING_BLOCK.lines) for (const run of line.runs) runs.set(run.index, 0);
  for (const line of PARAGRAPH_BLOCK.lines) for (const run of line.runs) runs.set(run.index, 1);
  return { fonts: [new Uint8Array(BOLD), new Uint8Array(REGULAR)], runs };
}

async function pageBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const sans = await document.embedFont(StandardFonts.Helvetica);
  const mono = await document.embedFont(StandardFonts.Courier);
  const sheet = document.addPage([612, 792]);
  for (const block of BLOCKS) {
    for (const line of block.lines) {
      let x = 72;
      for (const run of line.runs) {
        const font = run.style.mono ? mono : sans;
        const y = line.baseline + ('rise' in run.style ? run.style.rise : 0);
        sheet.drawText(run.text, { x, y, size: run.style.size, font });
        x += font.widthOfTextAtSize(run.text, run.style.size);
      }
    }
  }
  return document.save();
}

async function open(page: Page, zoom: '100pct' | '150pct', fontDelay = FONT_DELAY): Promise<void> {
  const bytes = await pageBytes();
  await page.setViewportSize({ width: 1800, height: 1100 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Clicks.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    textBlocks: BLOCKS,
    runFonts: runFonts(),
    delays: { 'document.runFonts': fontDelay },
    settings: { 'viewing.starting-zoom': zoom },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(BLOCKS.length - 1)}"]`)).toBeVisible({ timeout: 10_000 });
}

/** Waits until the open editor is as it will stay: focused, and every run the host answers a font for drawn in it. */
async function settled(page: Page, rebuilt: boolean): Promise<void> {
  const editor = page.locator('[data-text-editor]');
  await expect(editor).toBeFocused();
  if (rebuilt) await expect(editor.locator('[data-run-font]').first()).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // TWO FRAMES, for the layout effects and the baseline's re-render after the faces.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
}

/** Where boundary `at` of the editor's text stands on screen, by its own layout: the point a press there is made at. */
function pointOf(page: Page, at: number): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.locator('[data-text-editor]').evaluate((editor, at) => {
    const owner = editor.ownerDocument;
    const walker = owner.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let total = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node: node as Text, start: total });
      total += (node as Text).data.length;
    }
    const rectOf = (index: number): DOMRect | undefined => {
      const holder = nodes.find(({ node, start }) => index >= start && index < start + node.data.length);
      if (holder === undefined) return undefined;
      const range = owner.createRange();
      range.setStart(holder.node, index - holder.start);
      range.setEnd(holder.node, index - holder.start + 1);
      return range.getBoundingClientRect();
    };
    const before = rectOf(at - 1);
    const after = rectOf(at);
    // AFTER THE LAST CHARACTER: a quarter of a character past its right edge, on its line.
    if (after === undefined) {
      if (before === undefined) throw new Error(`boundary ${String(at)} has no character on either side`);
      return { x: before.right + before.width / 4, y: before.top + before.height / 2, width: before.width, height: before.height };
    }
    // THE START OF A LINE, or a boundary whose two sides are on different lines: a fifth into the character after it.
    if (before === undefined || Math.abs(before.top - after.top) > after.height / 2) {
      return { x: after.left + after.width / 5, y: after.top + after.height / 2, width: after.width, height: after.height };
    }
    return { x: (before.right + after.left) / 2, y: after.top + after.height / 2, width: Math.min(before.width, after.width), height: after.height };
  }, at);
}

/** The editor's words, its rows run together: the string a boundary's index counts in. */
function editorText(page: Page): Promise<string> {
  return page.locator('[data-text-editor]').evaluate((editor) => editor.textContent);
}

/** Where the caret stands on screen: the collapsed selection's own rectangle. */
function caretPoint(page: Page): Promise<{ x: number; y: number } | undefined> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return undefined;
    const rects = selection.getRangeAt(0).getClientRects();
    const rect = rects[0] ?? selection.getRangeAt(0).getBoundingClientRect();
    if (rect.height === 0) return undefined;
    return { x: rect.left, y: rect.top + rect.height / 2 };
  });
}

/** A press as a hand makes it: down, a pixel's drift, up. */
async function press(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.up();
}

const CASES = [
  {
    name: 'a three-line heading in a rebuilt font',
    block: 0,
    zoom: '100pct',
    rebuilt: true,
    targets: [
      { name: 'the start of its first line', find: 'Edit', offset: 0 },
      { name: 'between two letters mid-word', find: 'caret', offset: 2 },
      { name: 'on its second line, mid-word', find: 'person', offset: 3 },
      { name: 'on its third line, mid-word', find: 'opens', offset: 2 },
      { name: 'just after its last character', find: 'opens', offset: 5 },
    ],
  },
  {
    name: 'a paragraph with raised reference markers',
    block: 1,
    zoom: '100pct',
    rebuilt: true,
    targets: [
      { name: 'the start of its second line', find: 'the size', offset: 0 },
      { name: 'between two letters mid-word', find: 'markers', offset: 3 },
      { name: 'just before a raised marker', find: '[4]', offset: 0 },
      { name: 'on its second line, mid-word', find: 'field', offset: 2 },
      { name: 'just after its last character', find: '[5].', offset: 4 },
    ],
  },
  {
    name: 'a monospace code block at 150 %',
    block: 2,
    zoom: '150pct',
    rebuilt: false,
    targets: [
      { name: 'the start of its second line', find: 'cd repo', offset: 0 },
      { name: 'between two letters mid-word', find: 'example', offset: 4 },
      { name: 'on its third line, mid-word', find: 'build', offset: 2 },
      { name: 'just after its last character', find: '--watch', offset: 7 },
    ],
  },
] as const;

for (const fixture of CASES) {
  test.describe(`the first click on ${fixture.name} puts the caret where it was pressed`, () => {
    for (const target of fixture.targets) {
      test(`at ${target.name}`, async ({ page }) => {
        await open(page, fixture.zoom);
        const outline = page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(fixture.block)}"]`);
        // THE ORACLE: the block opened by a key, read once it has settled, and closed with nothing changed.
        await outline.focus();
        await page.keyboard.press('Enter');
        await settled(page, fixture.rebuilt);
        const words = await editorText(page);
        const found = words.indexOf(target.find);
        expect(found, `"${target.find}" in ${JSON.stringify(words)}`).toBeGreaterThanOrEqual(0);
        const at = found + target.offset;
        const point = await pointOf(page, at);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-text-editor]')).toHaveCount(0);
        await expect(outline).toBeVisible();

        // THE PRESS THAT OPENS IT, at that point.
        await press(page, point.x, point.y);
        await settled(page, fixture.rebuilt);
        const caret = await caretPoint(page);
        const facts = JSON.stringify({ at, point, caret, words });
        expect(caret, facts).toBeDefined();
        expect(Math.abs((caret?.x ?? Number.NaN) - point.x), facts).toBeLessThanOrEqual(point.width / 2);
        expect(Math.abs((caret?.y ?? Number.NaN) - point.y), facts).toBeLessThanOrEqual(point.height / 2);
        await page.keyboard.type('Q');
        // POLLED: a letter typed before the host's answer to the runs' fonts is held until it arrives (C1b).
        await expect.poll(() => editorText(page), { message: facts }).toBe(`${words.slice(0, at)}Q${words.slice(at)}`);
      });
    }
  });
}

/*
 * KEYS TYPED BEFORE THE LAYOUT SETTLES land at the press too (cloud run 21, C1b). The runs' own fonts arrive 900 ms after
 * the press here, the host's answer delayed so the keys are surely typed first, and three letters are typed in the same
 * breath as the press. CONTROL, Chromium 151, the build before C1b: the letters went where the caret stood in the
 * layout the editor was first built in, not at the press.
 */
const LATE_FONTS = 900;
for (const fixture of [
  { name: 'a three-line heading in a rebuilt font', block: 0, find: 'person', offset: 3 },
  { name: 'a paragraph with raised reference markers', block: 1, find: 'markers', offset: 3 },
] as const) {
  test(`three letters typed at once after the press that opens ${fixture.name} land at the press, in order`, async ({ page }) => {
    await open(page, '100pct', LATE_FONTS);
    const outline = page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(fixture.block)}"]`);
    await outline.focus();
    await page.keyboard.press('Enter');
    await settled(page, true);
    const words = await editorText(page);
    const at = words.indexOf(fixture.find) + fixture.offset;
    const point = await pointOf(page, at);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);
    await expect(outline).toBeVisible();

    await press(page, point.x, point.y);
    await page.keyboard.type('XYZ');
    // THE KEYS WERE TYPED BEFORE THE FONTS ARRIVED, or this case separates nothing.
    expect(await page.locator('[data-text-editor] [data-run-font]').count(), 'the runs’ fonts had not arrived when the keys were typed').toBe(0);
    await settled(page, true);
    await expect.poll(() => editorText(page), { message: JSON.stringify({ at, point, words }) }).toBe(`${words.slice(0, at)}XYZ${words.slice(at)}`);
  });
}
