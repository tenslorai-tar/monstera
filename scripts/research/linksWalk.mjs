// @ts-check
/**
 * The links walk (cloud run 3, the owner's O6(b) and O6(c)): links drawn, selected, moved, sent elsewhere and followed in
 * the running app with a real mouse and keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`, and
 * every step that changes the document READ BACK from the saved file by pdf-lib, a reader that is not the writer.
 *
 *   node scripts/research/linksWalk.mjs
 *
 * Its document is built here (two pages, the second turned 90 degrees), so the walk needs no file of the owner's. What
 * it walks:
 *
 * - O6(b): a web link drawn at a known spot is saved at that spot, at the opening zoom and zoomed in, and on a turned
 *   page. The saved `/Rect` is compared with the drawn box taken into PDF space by `@monstera/shared`'s own transform.
 * - O6(c): the link is selected with Select, moved by a drag, and sent to page 2 from Properties; the saved file holds
 *   the moved `/Rect` and a destination on page 2 with no address. Then, reading, a click on it shows page 2.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { root, startWalk } from './liveWalk.mjs';

const expect = defaultExpect.configure({ timeout: 20_000 });

// THE ONE TRANSFORM, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/shared/src/geometry.ts', 'packages/shared/dist/geometry.js', 'tsc']], 1);
// A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { pageTransform, toPdf, viewportPoint } = await import('../../packages/shared/dist/geometry.js');

const walk = await startWalk('links');
const { page, output, open, saveTo, command, section, step, finish } = walk;

/** A letter page with words on it, then a second one turned 90 degrees. */
async function linksDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  first.drawText('Annual report: see the figures on the next page.', { x: 72, y: 700, size: 14, font });
  const second = document.addPage([612, 792]);
  second.setRotation(degrees(90));
  second.drawText('Figures', { x: 72, y: 700, size: 14, font });
  return document.save({ useObjectStreams: false });
}

/**
 * Each page's links in a saved file, read by pdf-lib: the `/Rect` as stored, and where it goes (an address, or the
 * zero-based page a `/Dest` or a `/GoTo` names).
 *
 * @param {string} path
 */
async function savedLinks(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const pages = document.getPages();
  /** @param {unknown} value */
  const pageOf = (value) => {
    const target = value instanceof PDFArray ? value.get(0) : undefined;
    return target instanceof PDFRef ? pages.findIndex((each) => each.ref === target) : undefined;
  };
  return pages.map((each) => {
    const annots = each.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    return (annots?.asArray() ?? [])
      .map((entry) => document.context.lookup(entry))
      .filter((entry) => entry instanceof PDFDict && entry.get(PDFName.of('Subtype')) === PDFName.of('Link'))
      .map((entry) => {
        const link = /** @type {PDFDict} */ (entry);
        const rect = link.lookup(PDFName.of('Rect'), PDFArray).asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : Number.NaN));
        const action = link.lookupMaybe(PDFName.of('A'), PDFDict);
        const uri = action?.get(PDFName.of('URI'));
        const dest = link.get(PDFName.of('Dest')) ?? action?.get(PDFName.of('D'));
        return { rect, uri: uri === undefined ? undefined : String(uri), toPage: pageOf(dest instanceof PDFRef ? document.context.lookup(dest) : dest) };
      });
  });
}

/**
 * The drawn box in PDF space, through the transform the app uses for this page's slot on screen.
 *
 * @param {{ x: number; y: number; width: number; height: number }} slot the page's box on screen
 * @param {number} rotation the page's turn
 * @param {{ x0: number; y0: number; x1: number; y1: number }} drawn the drag, in screen pixels
 */
function drawnInPdf(slot, rotation, drawn) {
  const turned = rotation === 90 || rotation === 270;
  const scale = slot.width / (turned ? 792 : 612);
  const transform = pageTransform({ x0: 0, y0: 0, x1: 612, y1: 792 }, rotation, scale);
  const a = toPdf(viewportPoint(drawn.x0 - slot.x, drawn.y0 - slot.y), transform);
  const b = toPdf(viewportPoint(drawn.x1 - slot.x, drawn.y1 - slot.y), transform);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/** The largest difference between two rectangles' entries, in points. @param {readonly number[]} a @param {readonly number[]} b */
const apart = (a, b) => Math.max(...a.map((value, at) => Math.abs(value - (b[at] ?? Number.NaN))));

/**
 * Draws a web link over a box on page `index`'s slot, from `from` to `to` as fractions of the slot, and types `address`.
 *
 * @param {number} index
 * @param {readonly [number, number]} from
 * @param {readonly [number, number]} to
 * @param {string} address
 */
async function drawWebLink(index, from, to, address) {
  const slot = await page.locator('.m-page-slot').nth(index).boundingBox();
  if (slot === null) throw new Error(`page ${String(index + 1)} has no box on screen`);
  const drawn = { x0: slot.x + slot.width * from[0], y0: slot.y + slot.height * from[1], x1: slot.x + slot.width * to[0], y1: slot.y + slot.height * to[1] };
  await page.getByRole('button', { name: 'Web link', exact: true }).first().click();
  await page.mouse.move(drawn.x0, drawn.y0);
  await page.mouse.down();
  await page.mouse.move(drawn.x1, drawn.y1, { steps: 8 });
  await page.mouse.up();
  const field = page.getByRole('textbox', { name: 'Address' });
  await field.fill(address);
  await field.press('Enter');
  await expect(page.getByText('Link added.').last()).toBeVisible();
  return { slot, drawn };
}

/** Saves a copy to `name` in the output folder and answers its path once it is written. @param {string} name */
async function saveCopy(name) {
  const saved = join(output, name);
  await saveTo(saved);
  await command('Save a copy');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  return saved;
}

const source = join(output, 'links.pdf');
await writeFile(source, await linksDocument());

/** @type {{ x: number; y: number; width: number; height: number } | undefined} */
let firstSlot;
await step('O6(b): a web link drawn on page 1 is saved where it was drawn, read back from the file', async () => {
  await open(source);
  await section('Comment');
  const { slot, drawn } = await drawWebLink(0, [0.2, 0.3], [0.6, 0.36], 'https://example.org/one');
  firstSlot = slot;
  const [link] = (await savedLinks(await saveCopy('links-drawn.pdf')))[0] ?? [];
  if (link === undefined) throw new Error('no link on page 1 of the saved file');
  const expected = drawnInPdf(slot, 0, drawn);
  expect(apart(link.rect, expected)).toBeLessThan(1);
  return { drawnPdf: expected, savedRect: link.rect, zoom: slot.width / 612 };
});

await step('O6(b): zoomed in, a second link is saved where it was drawn too', async () => {
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.locator('.m-page-slot').first().scrollIntoViewIfNeeded();
  const { slot, drawn } = await drawWebLink(0, [0.25, 0.5], [0.55, 0.55], 'https://example.org/two');
  expect(slot.width).not.toBe(firstSlot?.width);
  const links = (await savedLinks(await saveCopy('links-zoomed.pdf')))[0] ?? [];
  const link = links.find((each) => each.uri?.includes('/two') === true);
  if (link === undefined) throw new Error('the second link is not on page 1 of the saved file');
  const expected = drawnInPdf(slot, 0, drawn);
  expect(apart(link.rect, expected)).toBeLessThan(1);
  await page.keyboard.press('Control+0');
  return { drawnPdf: expected, savedRect: link.rect, zoom: slot.width / 612 };
});

await step('O6(b): on page 2, turned 90 degrees, a link is saved where it was drawn', async () => {
  await page.locator('.m-page-slot').nth(1).scrollIntoViewIfNeeded();
  const { slot, drawn } = await drawWebLink(1, [0.3, 0.3], [0.6, 0.4], 'https://example.org/turned');
  const [link] = (await savedLinks(await saveCopy('links-turned.pdf')))[1] ?? [];
  if (link === undefined) throw new Error('no link on page 2 of the saved file');
  const expected = drawnInPdf(slot, 90, drawn);
  expect(apart(link.rect, expected)).toBeLessThan(1);
  return { drawnPdf: expected, savedRect: link.rect };
});

await step('O6(c): the first link is selected with Select, moved by a drag, and sent to page 2 from Properties; the file says so', async () => {
  const first = page.locator('.m-page-slot').first();
  await first.scrollIntoViewIfNeeded();
  const slot = await first.boundingBox();
  if (slot === null) throw new Error('page 1 has no box on screen');
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const middle = { x: slot.x + slot.width * 0.4, y: slot.y + slot.height * 0.33 };
  await page.mouse.click(middle.x, middle.y);
  await expect(page.locator('[data-selection-kind="link"] [data-selection-handle]')).toHaveCount(8);
  await page.getByRole('tab', { name: 'Properties' }).click();
  await expect(page.getByRole('textbox', { name: 'Address' })).toHaveValue('https://example.org/one');
  // THE DRAG: 60 pixels right and 40 down, which is a known distance in points at this zoom.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 60, middle.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'A page' }).click();
  await page.getByRole('textbox', { name: 'Page number' }).fill('2');
  await page.getByRole('button', { name: 'Change where it goes' }).click();
  const before = (await savedLinks(join(output, 'links-drawn.pdf')))[0]?.[0];
  const links = (await savedLinks(await saveCopy('links-changed.pdf')))[0] ?? [];
  const moved = links.find((each) => each.toPage === 1);
  if (before === undefined || moved === undefined) throw new Error('no link to page 2 on page 1 of the saved file');
  const scale = slot.width / 612;
  // MOVED BY THE DRAG in PDF space: right by 60 pixels, and DOWN the page by 40, which is a smaller y.
  expect(Math.abs((moved.rect[0] ?? 0) - (before.rect[0] ?? 0) - 60 / scale)).toBeLessThan(1);
  expect(Math.abs((moved.rect[1] ?? 0) - (before.rect[1] ?? 0) + 40 / scale)).toBeLessThan(1);
  // AND IT NO LONGER CARRIES THE ADDRESS IT HAD.
  expect(moved.uri).toBeUndefined();
  return { before: before.rect, after: moved.rect, toPage: moved.toPage };
});

await step('O6(c): reading, the link is followed with a click, and hovering it says where it goes', async () => {
  await section('Home');
  // NO TOOL ON, so the page's links take the pointer rather than the select tool's surface.
  await page.keyboard.press('Escape');
  await page.locator('.m-page-slot').first().scrollIntoViewIfNeeded();
  const link = page.locator('[data-link-layer="0"] [aria-label="Go to page 2"]');
  await link.hover();
  await expect(page.locator('.m-tooltip', { hasText: 'Go to page 2' })).toBeVisible();
  await link.click();
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('2');
  return { linksOnPage1: await page.locator('[data-link-layer="0"] [data-page-link]').count() };
});

await finish();
