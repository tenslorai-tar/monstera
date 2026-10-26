import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * OPENING EDIT TEXT CHANGES NOTHING VISIBLE (cloud run 19, the owner's video of 2026-10-24): a block clicked open looks
 * exactly as the page drew it, in its font, its weight, its positions and its line breaks, until the person changes it.
 * Then only what they changed moves.
 *
 * ## The page and its blocks
 *
 * `scripts/research/editorFidelityFixture.mjs` writes both, and `proof:editorfidelityfixture` holds them to what it would
 * write now: one page
 * with a bold Times heading over two lines, a justified paragraph, a bulleted list with bold lead-ins and raised
 * references, a Courier code block, a paragraph in an embedded TrueType font and one in Times not embedded; and those
 * blocks as PDFium and `groupIntoBlocks` read them. The embedded paragraph's runs are answered the font's own bytes, as
 * the host answers a run whose program it rebuilt (ADR-0175), so the editor has the page's glyphs for it.
 *
 * ## How "no visible change" is read, and its threshold
 *
 * The block's box on screen is captured twice before the editor opens and once after, with the caret, the frame's
 * outline and the handles hidden: they are the editor's chrome, and the question is about the words. A pixel CHANGED
 * when any channel moved by more than {@link CHANNEL_TOLERANCE}. The two captures before opening are the measured
 * spread of the instrument itself; the capture after opening may differ from the first by no more changed pixels than
 * the two before differ from each other. On Chromium 151 that spread is 0 at this tolerance on every block here, so the
 * bound is exact rather than chosen.
 *
 * ## Controls, each run 2026-10-24 on Chromium 151 against a build with one part of the rule taken out
 *
 * - THE EDITOR DRAWING EVERY ROW, as it did before: opening changed 1,451 to 3,403 pixels of each block at 100 %,
 *   1,671 of them on the paragraph whose runs had their own font, and the heading's two lines read as one.
 * - THE OLD WRAPPING, no break where a page line ended: the heading, the justified paragraph and the Times paragraph
 *   red (a row one pitch tall where the page has two or three lines); the list, the code and the embedded paragraph,
 *   whose lines all end hard, unaffected, as they should be.
 * - THE CODE ROW IN A PROPORTIONAL FACE: its characters' advances spread 4.5 px, against the fixed pitch's under 0.5.
 * - PAPER AS TALL AS A ROW'S LINE BOX: 75 pixels of the command below the typed one clipped.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000f9');
const FIXTURES = join(dirname(createRequire(import.meta.url).resolve('../package.json')), 'fixtures', 'text-edit');
const BYTES = new Uint8Array(readFileSync(join(FIXTURES, 'editor-fidelity.pdf')));
/** Liberation Sans, the program the embedded paragraph carries, from where `fontKindFixtures.mjs` reads it. */
const LIBERATION = new Uint8Array(
  readFileSync(join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts', 'LiberationSans-Regular.ttf')),
);
/** A channel moves by more than this to count as changed: past the 8-bit rounding of one blend, under any glyph's edge. */
const CHANNEL_TOLERANCE = 8;

interface Run {
  readonly index: number;
  readonly text: string;
  readonly style: { readonly size: number; readonly mono: boolean; readonly font?: string };
}
interface Line {
  readonly runs: readonly Run[];
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly soft: boolean;
  readonly baseline: number;
}
interface Block {
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly lines: readonly Line[];
}

/** The blocks as the fixture's reading wrote them, checked to the depth this file reads. */
function readBlocks(): readonly Block[] {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, 'editor-fidelity.blocks.json'), 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 6) throw new Error('editor-fidelity.blocks.json does not hold the six blocks this case opens');
  return parsed as readonly Block[];
}
const BLOCKS = readBlocks();
const lineText = (line: Line): string => line.runs.map((run) => run.text).join('');
const blockNamed = (start: string): number => {
  const at = BLOCKS.findIndex((block) => lineText(block.lines[0] ?? { runs: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 }, soft: false, baseline: 0 }).startsWith(start));
  if (at < 0) throw new Error(`no block starts with ${start}`);
  return at;
};
const CASES = [
  { name: 'a bold serif heading over two lines', at: blockNamed('Quarterly results') },
  { name: 'a justified paragraph', at: blockNamed('The committee') },
  { name: 'a bulleted list with bold lead-ins and raised references', at: blockNamed('• ') },
  { name: 'a Courier code block, one command to a line', at: blockNamed('git clone') },
  { name: 'a paragraph in an embedded font', at: blockNamed('This paragraph is set in a font') },
  { name: 'a paragraph in Times, not embedded', at: blockNamed('This paragraph is set in Times') },
] as const;

/** Every run of the embedded paragraph answered the font's own program, as the host answers a run it rebuilt. */
function runFonts(): { fonts: Uint8Array<ArrayBuffer>[]; runs: Map<number, number> } {
  const embedded = BLOCKS[blockNamed('This paragraph is set in a font')];
  const runs = new Map<number, number>();
  for (const line of embedded?.lines ?? []) for (const run of line.runs) runs.set(run.index, 0);
  return { fonts: [new Uint8Array(LIBERATION)], runs };
}

async function open(page: Page, zoom: string): Promise<void> {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: BYTES.byteLength, name: 'Fidelity.pdf' }],
    documentBytes: new Map([[ID, BYTES]]),
    textBlocks: BLOCKS.map((block) => ({ ...block, style: block.lines[0]?.runs[0]?.style, shape: (block as unknown as { shape: unknown }).shape })) as never,
    runFonts: runFonts(),
    settings: { 'viewing.starting-zoom': zoom },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(BLOCKS.length - 1)}"]`)).toBeVisible();
  // THE EDITOR'S CHROME HIDDEN — outlines, handles, the caret — so what is compared is the words.
  await page.addStyleTag({
    content:
      // THE OUTLINE'S HOVER TINT TOO: an open block has no outline, so a pointer resting on one tints only the capture before.
      '.m-text-editor-handle,.m-text-editor-problem{visibility:hidden!important}.m-text-block{border-color:transparent!important;outline:none!important;background:transparent!important}' +
      '.m-text-editor-frame{outline:none!important;border-color:transparent!important}[data-kit-surface]{caret-color:transparent!important}',
  });
}

/** PDF points of page 1 to the window, through the drawn page's own box. */
async function onScreen(page: Page): Promise<{ x: (x: number) => number; y: (y: number) => number; zoom: number }> {
  const canvas = await page.locator('canvas[data-page-canvas="0"]').boundingBox();
  if (canvas === null) throw new Error('the page has no canvas');
  const zoom = canvas.width / 612;
  return { x: (x) => canvas.x + x * zoom, y: (y) => canvas.y + (792 - y) * zoom, zoom };
}

async function regionOf(page: Page, block: Block): Promise<{ x: number; y: number; width: number; height: number }> {
  const at = await onScreen(page);
  return {
    x: Math.floor(at.x(block.box.x0) - 3),
    y: Math.floor(at.y(block.box.y1) - 3),
    width: Math.ceil((block.box.x1 - block.box.x0) * at.zoom + 6),
    height: Math.ceil((block.box.y1 - block.box.y0) * at.zoom + 6),
  };
}

/** The region's pixels, RGBA. */
async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<number[]> {
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
      return Array.from(context.getImageData(0, 0, image.width, image.height).data);
    }, shot);
  } finally {
    await scratch.close();
  }
}

/** How many pixels differ by more than the tolerance in any channel. */
function changed(a: readonly number[], b: readonly number[]): number {
  let count = 0;
  for (let at = 0; at < Math.min(a.length, b.length); at += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs((a[at + channel] ?? 0) - (b[at + channel] ?? 0)) > CHANNEL_TOLERANCE) {
        count += 1;
        break;
      }
    }
  }
  return count + Math.abs(a.length - b.length) / 4;
}

/**
 * The editor's lines as it lays them out: each visual line's text, and the top of a zero-size marker at its start, which
 * stands on its baseline. A row is one of the page's paragraphs; a line inside it ends at a soft break the editor drew.
 */
function editorLines(page: Page): Promise<{ text: string; baseline: number; boxes: number }[]> {
  return page.locator('[data-kit-surface]').evaluate((editor) => {
    const owner = editor.ownerDocument;
    const found: { text: string; baseline: number; boxes: number }[] = [];
    for (const row of editor.querySelectorAll<HTMLElement>(':scope > [data-kit-paragraph]')) {
      // THE ROW'S LINES split where the browser broke them: by the tops of its text's own rectangles.
      const range = owner.createRange();
      range.selectNodeContents(row);
      const tops = [...new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)))];
      const texts = row.innerText.split('\n');
      const starts: Node[] = [row];
      for (const br of row.querySelectorAll('br[data-kit-wrap]')) starts.push(br);
      starts.forEach((start, at) => {
        const marker = owner.createElement('span');
        marker.className = 'm-kit__baseline';
        if (start === row) row.prepend(marker);
        else (start as Element).after(marker);
        found.push({ text: texts[at] ?? '', baseline: marker.getBoundingClientRect().top, boxes: at === 0 ? tops.length : 0 });
        marker.remove();
      });
    }
    return found;
  });
}

for (const zoom of ['100pct', '200pct'] as const) {
  for (const { name, at } of CASES) {
    test(`opening ${name} changes nothing visible, and keeps each of its lines (${zoom})`, async ({ page }) => {
      const block = BLOCKS[at];
      if (block === undefined) throw new Error('no block');
      await open(page, zoom);
      const outline = page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(at)}"]`);
      // IN VIEW, at the window's foot where it falls, as a person scrolls to a block: opening it must not move the page,
      // which the region read again after opening checks.
      await outline.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const region = await regionOf(page, block);
      const first = await pixels(page, region);
      const second = await pixels(page, region);
      const spread = changed(first, second);
      await openWords(page, outline);
      // THE RUN FONTS ANSWERED AND LOADED, which is the moment a face change would show.
      await page.waitForTimeout(500);
      // THE SAME PLACE ON THE PAGE, or the comparison is of two places.
      expect(await regionOf(page, block)).toStrictEqual(region);
      const opened = await pixels(page, region);
      const after = changed(first, opened);
      const lines = await editorLines(page);
      const shown = await onScreen(page);
      const facts = JSON.stringify({ spread, after, lines: lines.map((line) => line.text) });
      expect.soft(after, facts).toBeLessThanOrEqual(spread);
      // EACH OF THE PAGE'S LINES IS A LINE, with its own words and its baseline within a pixel of the page's.
      expect.soft(lines.map((line) => line.text.trim()), facts).toStrictEqual(block.lines.map((line) => lineText(line).trim()));
      for (const [index, line] of block.lines.entries()) {
        const drawn = lines[index];
        expect.soft(Math.abs((drawn?.baseline ?? Infinity) - shown.y(line.baseline)), `${facts} line ${String(index)}`).toBeLessThanOrEqual(1);
      }
      // NO ROW WRAPPED ANYWHERE THE PAGE DID NOT: each row is as tall as its page lines at the block's pitch, so a line
      // the browser broke again would make it a pitch taller.
      const [one, two] = block.lines;
      if (one !== undefined && two !== undefined) {
        const pitch = (one.baseline - two.baseline) * shown.zoom;
        const heights = await page.locator('[data-kit-surface] > [data-kit-paragraph]').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).offsetHeight));
        expect.soft(heights, facts).toStrictEqual(paragraphSizes(block).map((size) => Math.round(size * pitch)));
      }
    });
  }
}

/** How many page lines each of the block's paragraphs has: a line that ends soft carries on in the next. */
function paragraphSizes(block: Block): number[] {
  const sizes: number[] = [];
  let open = 0;
  for (const line of block.lines) {
    open += 1;
    if (!line.soft) {
      sizes.push(open);
      open = 0;
    }
  }
  return sizes;
}

test('typing in one command of the code block draws that command alone, in a fixed-pitch face, and leaves the others as the page drew them', async ({ page }) => {
  const at = blockNamed('git clone');
  const block = BLOCKS[at];
  const second = block?.lines[1];
  if (block === undefined || second === undefined) throw new Error('no code block');
  await open(page, '100pct');
  const outline = page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(at)}"]`);
  await outline.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const shown = await onScreen(page);
  /** One line's ink band on screen, a pixel either way. */
  const band = (line: Line): { x: number; y: number; width: number; height: number } => ({
    x: Math.floor(shown.x(block.box.x0) - 2),
    y: Math.floor(shown.y(line.box.y1) - 1),
    width: Math.ceil((block.box.x1 - block.box.x0) * shown.zoom + 4),
    height: Math.ceil((line.box.y1 - line.box.y0) * shown.zoom + 2),
  });
  const before = await Promise.all(block.lines.map((line) => pixels(page, band(line))));
  // AT THE END OF THE SECOND COMMAND, where the person clicks to add to it.
  // THE BOX, then the caret there (ADR-0271's two steps).
  await page.mouse.click(shown.x(second.box.x1) - 1, shown.y(second.baseline) - 3);
  await page.mouse.click(shown.x(second.box.x1) - 1, shown.y(second.baseline) - 3);
  await expect(page.locator('[data-kit-surface]')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await page.waitForTimeout(400);
  const rows = await page.locator('[data-kit-surface] > [data-kit-paragraph]').evaluateAll((elements) => elements.map((row) => row.textContent));
  expect(rows).toStrictEqual(block.lines.map((line, index) => `${lineText(line)}${index === 1 ? ' now' : ''}`));
  const after = await Promise.all(block.lines.map((line) => pixels(page, band(line))));
  const moved = after.map((shot, index) => changed(before[index] ?? [], shot));
  // THE OTHER THREE AS THE PAGE DREW THEM, and the second drawn again: it changed, so it is not vacuously equal.
  expect([moved[0], moved[2], moved[3]], JSON.stringify(moved)).toStrictEqual([0, 0, 0]);
  expect(moved[1], JSON.stringify(moved)).toBeGreaterThan(50);
  // IN A FIXED-PITCH FACE: every character of the drawn command advances the same width.
  const widths = await page.locator('[data-kit-surface] > [data-kit-paragraph]').nth(1).evaluate((row) => {
    const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const found: number[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      for (let offset = 0; offset < (node.textContent ?? '').length; offset += 1) {
        const range = row.ownerDocument.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        found.push(range.getBoundingClientRect().width);
      }
    }
    return found;
  });
  expect(Math.max(...widths) - Math.min(...widths), JSON.stringify(widths)).toBeLessThan(0.5);
  // AND NOTHING OF THE PAGE'S COPY UNDER IT: the editor's own words made transparent, the second command's band is paper.
  await page.addStyleTag({ content: '[data-kit-surface] *{color:transparent!important}' });
  await page.waitForTimeout(100);
  const papered = await pixels(page, band(second));
  const white = papered.map((value, index) => (index % 4 === 3 ? 255 : 255));
  expect(changed(white, papered)).toBe(0);
});

test('opening and closing a block shows, in every frame, the page’s own drawing of it and no paper', async ({ page }) => {
  const at = blockNamed('Quarterly results');
  await open(page, '100pct');
  await page.evaluate(() => {
    const frames: { readonly open: boolean; readonly drawnRows: number; readonly covers: number; readonly opaque: number }[] = [];
    Reflect.set(window, 'editorFrames', frames);
    const sample = (): void => {
      const editor = document.querySelector('[data-kit-surface]');
      const rows = editor === null ? [] : Array.from(editor.querySelectorAll(':scope > [data-kit-paragraph]'));
      frames.push({
        open: editor !== null,
        drawnRows: rows.filter((row) => getComputedStyle(row).color !== 'rgba(0, 0, 0, 0)').length,
        covers: document.querySelectorAll('.m-text-editor-cover').length,
        opaque: editor === null ? 0 : getComputedStyle(editor).backgroundColor === 'rgba(0, 0, 0, 0)' ? 0 : 1,
      });
      if (Reflect.get(window, 'editorFramesStop') !== true) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await openWords(page, page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(at)}"]`));
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-kit-surface]')).toHaveCount(0);
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => {
    Reflect.set(window, 'editorFramesStop', true);
    return Reflect.get(window, 'editorFrames') as { readonly open: boolean; readonly drawnRows: number; readonly covers: number; readonly opaque: number }[];
  });
  expect(frames.some((frame) => frame.open)).toBe(true);
  expect(frames.at(-1)?.open).toBe(false);
  // NO FRAME DOUBLED OR EMPTY: while the editor is open and untouched it draws no row, lays no paper and has none behind it.
  expect(frames.filter((frame) => frame.open && (frame.drawnRows > 0 || frame.covers > 0 || frame.opaque > 0))).toStrictEqual([]);
});
