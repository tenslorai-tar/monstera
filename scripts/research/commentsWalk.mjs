// @ts-check
/**
 * The comments walk (cloud run 3, Part 3): links and measurements drawn, selected, changed and followed in the running
 * app with a real mouse and keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`, and every step
 * that changes the document READ BACK from the saved file by pdf-lib, a reader that is not the writer.
 *
 *   node scripts/research/commentsWalk.mjs
 *
 * Its document is built here (two pages, the second turned 90 degrees), so the walk needs no file of the owner's. What
 * it walks:
 *
 * - O6(b): a web link drawn at a known spot is saved at that spot, at the opening zoom and zoomed in, and on a turned
 *   page. The saved `/Rect` is compared with the drawn box taken into PDF space by `@monstera/shared`'s own transform.
 * - O6(c): the link is selected with Select, moved by a drag, and sent to page 2 from Properties; the saved file holds
 *   the moved `/Rect` and a destination on page 2 with no address. Then, reading, a click on it shows page 2.
 * - O8: a distance shows its reading while it is drawn; its end, dragged with Select, moves alone and the line stays flat;
 *   the saved label is worked out again in proportion to the new length, no fill is written, and Undo brings the first
 *   reading back. An area's corner dragged changes its saved reading.
 * - O5: an insertion mark is as tall as the words it is placed in, and its Size in Properties resizes it; both read back.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { root, startWalk } from './liveWalk.mjs';

const expect = defaultExpect.configure({ timeout: 20_000 });

// THE ONE TRANSFORM, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/shared/src/geometry.ts', 'packages/shared/dist/geometry.js', 'tsc']], 1);
// A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { pageTransform, toPdf, viewportPoint } = await import('../../packages/shared/dist/geometry.js');

const walk = await startWalk('comments');
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

/**
 * Each measurement on page 1 of a saved file, read by pdf-lib: its subtype, its points (`/L` or `/Vertices`), the
 * reading it carries and whether it has an interior colour.
 *
 * @param {string} path
 */
async function savedMeasurements(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const annots = document.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  /** @param {unknown} value */
  const numbers = (value) => (value instanceof PDFArray ? value.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN)) : []);
  return (annots?.asArray() ?? [])
    .map((entry) => document.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict && entry.get(PDFName.of('Measure')) !== undefined)
    .map((entry) => {
      const mark = /** @type {PDFDict} */ (entry);
      const contents = mark.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString);
      return {
        subtype: String(mark.get(PDFName.of('Subtype'))),
        points: numbers(mark.lookup(PDFName.of('L')) ?? mark.lookup(PDFName.of('Vertices'))),
        reading: contents?.decodeText() ?? '',
        filled: mark.get(PDFName.of('IC')) !== undefined,
      };
    });
}

/** The number a reading starts with. @param {string} reading */
const valueOf = (reading) => Number.parseFloat(reading);

/** A one-page document with words on it, for the measurements. */
async function measureDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  // TWENTY POINTS, so an insertion mark sized to the words is told apart from MuPDF's own 14.
  document.addPage([612, 792]).drawText('Plan: measure the room below.', { x: 72, y: 720, size: 20, font });
  return document.save({ useObjectStreams: false });
}

const plan = join(output, 'plan.pdf');
await writeFile(plan, await measureDocument());

/** Page 1's slot on screen, and its scale. */
async function planSlot() {
  const slot = await page.locator('.m-page-slot:visible').first().boundingBox();
  if (slot === null) throw new Error('page 1 has no box on screen');
  return { ...slot, scale: slot.width / 612 };
}

/** @type {{ reading: string; points: number[] } | undefined} */
let firstDistance;
await step('O8: a distance shows its reading WHILE it is drawn, and the saved file carries it, unfilled', async () => {
  await open(plan);
  await command('Measure distance');
  const slot = await planSlot();
  const from = { x: slot.x + 100 * slot.scale, y: slot.y + 300 * slot.scale };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // NEARLY FLAT, as a hand draws: 216 points across and a point and a half down.
  await page.mouse.move(from.x + 216 * slot.scale, from.y + 1.5 * slot.scale, { steps: 10 });
  const live = await page.locator('[data-annotation-caption]').textContent();
  expect(live).toMatch(/^\d+\.\d /u);
  await page.mouse.up();
  const [distance] = await savedMeasurements(await saveCopy('plan-drawn.pdf'));
  if (distance === undefined) throw new Error('no measurement in the saved file');
  expect(distance.reading).toBe(live);
  expect(distance.filled).toBe(false);
  firstDistance = distance;
  return { live, saved: distance.reading, line: distance.points };
});

await step('O8: its END dragged with Select moves alone, the line stays flat, and the saved reading follows the length', async () => {
  if (firstDistance === undefined) throw new Error('the distance step did not record its line');
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = firstDistance.points;
  const slot = await planSlot();
  const end = { x: slot.x + x1 * slot.scale, y: slot.y + (792 - y1) * slot.scale };
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.mouse.click(slot.x + ((x0 + x1) / 2) * slot.scale, slot.y + (792 - (y0 + y1) / 2) * slot.scale);
  await expect(page.locator('[data-selection-handle="point-1"]')).toBeAttached();
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  // 72 POINTS FURTHER along: an end moved by points follows the pointer; it is not a box being stretched.
  await page.mouse.move(end.x + 72 * slot.scale, end.y, { steps: 10 });
  await expect(page.locator('[data-annotation-preview="boxes"] rect')).toHaveCount(0);
  await page.mouse.up();
  const [moved] = await savedMeasurements(await saveCopy('plan-stretched.pdf'));
  if (moved === undefined) throw new Error('no measurement in the saved file');
  const [nx0 = 0, ny0 = 0, nx1 = 0, ny1 = 0] = moved.points;
  // THE OTHER END DID NOT MOVE, and the line is as flat as it was drawn.
  expect(Math.abs(nx0 - x0) + Math.abs(ny0 - y0)).toBeLessThan(0.5);
  expect(Math.abs(ny1 - ny0)).toBeLessThan(Math.abs(y1 - y0) + 1);
  // THE READING FOLLOWS THE LENGTH, in proportion, whatever the drawing's unit.
  const before = Math.hypot(x1 - x0, y1 - y0);
  const after = Math.hypot(nx1 - nx0, ny1 - ny0);
  expect(valueOf(moved.reading) / valueOf(firstDistance.reading)).toBeCloseTo(after / before, 1);
  expect(moved.filled).toBe(false);
  return { before: firstDistance.reading, after: moved.reading, line: moved.points };
});

await step('O8: Undo brings the first reading and the first line back, in the saved file', async () => {
  if (firstDistance === undefined) throw new Error('the distance step did not record its line');
  await page.keyboard.press('Control+Z');
  const [undone] = await savedMeasurements(await saveCopy('plan-undone.pdf'));
  expect(undone?.reading).toBe(firstDistance.reading);
  return { reading: undone?.reading };
});

await step('O8: an AREA’s corner dragged with Select changes the saved area', async () => {
  await command('Measure area');
  const slot = await planSlot();
  const corners = [
    [150, 500],
    [300, 500],
    [300, 400],
  ].map(([x = 0, y = 0]) => ({ x: slot.x + x * slot.scale, y: slot.y + (792 - y) * slot.scale }));
  for (const corner of corners) await page.mouse.click(corner.x, corner.y);
  const [first] = corners;
  if (first === undefined) throw new Error('no corners');
  await page.mouse.click(first.x, first.y);
  const drawn = (await savedMeasurements(await saveCopy('plan-area.pdf'))).find((each) => each.subtype === '/Polygon');
  if (drawn === undefined) throw new Error('no area in the saved file');
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const [, , top] = corners;
  if (top === undefined) throw new Error('no third corner');
  await page.mouse.click(slot.x + 260 * slot.scale, slot.y + (792 - 470) * slot.scale);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x + 60 * slot.scale, top.y, { steps: 10 });
  await page.mouse.up();
  const grown = (await savedMeasurements(await saveCopy('plan-area-grown.pdf'))).find((each) => each.subtype === '/Polygon');
  if (grown === undefined) throw new Error('no area in the saved file');
  expect(valueOf(grown.reading)).toBeGreaterThan(valueOf(drawn.reading));
  expect(grown.filled).toBe(false);
  return { before: drawn.reading, after: grown.reading };
});

/** Each caret's `/Rect` on page 1 of a saved file, read by pdf-lib. @param {string} path */
async function savedCarets(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const annots = document.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return (annots?.asArray() ?? [])
    .map((entry) => document.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict && entry.get(PDFName.of('Subtype')) === PDFName.of('Caret'))
    .map((entry) => /** @type {PDFDict} */ (entry).lookup(PDFName.of('Rect'), PDFArray).asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : Number.NaN)));
}
/** A rectangle's height. @param {readonly number[]} rect */
const tallOf = (rect) => (rect[3] ?? 0) - (rect[1] ?? 0);

await step('O5: an insertion mark placed in the 20-point line is as tall as the words, in the saved file', async () => {
  await command('Insertion mark');
  const slot = await planSlot();
  await page.mouse.click(slot.x + 150 * slot.scale, slot.y + (792 - 727) * slot.scale);
  const [caret] = await savedCarets(await saveCopy('plan-caret.pdf'));
  if (caret === undefined) throw new Error('no caret in the saved file');
  expect(Math.abs(tallOf(caret) - 20)).toBeLessThan(2);
  return { rect: caret, tall: tallOf(caret) };
});

await step('O5: its Size typed in Properties resizes it, and the saved file keeps that size', async () => {
  const slot = await planSlot();
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.mouse.click(slot.x + 150 * slot.scale, slot.y + (792 - 727) * slot.scale);
  await page.getByRole('tab', { name: 'Properties' }).click();
  const size = page.getByRole('spinbutton', { name: 'Size' });
  await size.fill('32');
  await size.press('Enter');
  const [caret] = await savedCarets(await saveCopy('plan-caret-sized.pdf'));
  if (caret === undefined) throw new Error('no caret in the saved file');
  expect(Math.abs(tallOf(caret) - 32)).toBeLessThan(0.5);
  return { rect: caret };
});

await finish();
