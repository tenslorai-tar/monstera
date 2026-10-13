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
 * - O7: Highlight area highlights a box with no words in it, saved as a Highlight at exactly that box, and is listed.
 * - O3: three blank pages put before the first page in one insert, and two pictures after the last page in file-name
 *   order; each read back from the saved file, and each taken out again by one Undo.
 * - O9: a dismissed picker shows no notice; a long Markdown conversion shows its notice, without a Cancel, until its tab
 *   opens, and the PDF it wrote is read back.
 * - N6: a `.doc`, a two-sheet `.xls` and a `.ppt` from `_review/samples/old-office/` each become a PDF that opens.
 * - N3: Straighten turns a page tilted 3 degrees upright and says so, and says a level page is already straight; Crop to
 *   paper crops a photographed sheet and says so. Each read back from the saved file: the turn in its content, the
 *   sheet's shape in its box.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, StandardFonts, decodePDFRawStream, degrees } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { root, startWalk } from './liveWalk.mjs';
import { savedFonts, savedWords } from './savedPdf.mjs';

const expect = defaultExpect.configure({ timeout: 20_000 });

// THE ONE TRANSFORM, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/shared/src/geometry.ts', 'packages/shared/dist/geometry.js', 'tsc']], 1);
// A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { pageTransform, toPdf, viewportPoint } = await import('../../packages/shared/dist/geometry.js');

const walk = await startWalk('comments');
const { page, output, open, pickFiles, saveTo, command, section, step, finish } = walk;

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

await step('O7: Highlight area highlights a box with no words in it; the file holds a Highlight at exactly that box, listed in Comments', async () => {
  await section('Comment');
  await page.locator('[data-command="annotate.highlight-area"]').first().click();
  const slot = await planSlot();
  // AN EMPTY PART OF THE PAGE, where a text highlight would mark nothing.
  const drawn = { x0: 100, x1: 300, top: 400, bottom: 500 };
  await page.mouse.move(slot.x + drawn.x0 * slot.scale, slot.y + drawn.top * slot.scale);
  await page.mouse.down();
  await page.mouse.move(slot.x + drawn.x1 * slot.scale, slot.y + drawn.bottom * slot.scale, { steps: 10 });
  await page.mouse.up();
  const saved = await saveCopy('plan-highlight-area.pdf');
  const document = await PDFDocument.load(await readFile(saved), { updateMetadata: false });
  const annots = document.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const highlight = (annots?.asArray() ?? [])
    .map((entry) => document.context.lookup(entry))
    .find((entry) => entry instanceof PDFDict && entry.get(PDFName.of('Subtype')) === PDFName.of('Highlight'));
  if (!(highlight instanceof PDFDict)) throw new Error('no highlight in the saved file');
  /** @param {string} key */
  const numbers = (key) => highlight.lookup(PDFName.of(key), PDFArray).asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : Number.NaN));
  const rect = numbers('Rect');
  // THE BOX DRAGGED, in PDF space, and nothing wider: MuPDF alone would pad it sideways.
  const expected = [drawn.x0, 792 - drawn.bottom, drawn.x1, 792 - drawn.top];
  expect(Math.max(...rect.map((value, at) => Math.abs(value - (expected[at] ?? 0))))).toBeLessThan(1);
  expect(numbers('QuadPoints')).toHaveLength(8);
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.locator('.m-annotations-panel').getByText('Highlight').first()).toBeVisible();
  return { rect, quad: numbers('QuadPoints') };
});

/**
 * Each page of a saved file as pdf-lib reads it: its size, and whether it has any content.
 *
 * @param {string} path
 */
async function savedPages(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  return document.getPages().map((each) => ({
    width: Math.round(each.getWidth()),
    height: Math.round(each.getHeight()),
    drawn: each.node.get(PDFName.of('Contents')) !== undefined,
  }));
}

/** A letter page with words on it, twice, so a blank page among them shows. */
async function pagesDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const words of ['The first page.', 'The second page.']) {
    document.addPage([612, 792]).drawText(words, { x: 72, y: 700, size: 14, font });
  }
  return document.save({ useObjectStreams: false });
}

const pages = join(output, 'pages.pdf');
await writeFile(pages, await pagesDocument());

await step('O3: three blank pages before the first page are one insert; the saved file has them first, empty, and page-sized', async () => {
  await open(pages);
  await command('Insert blank pages…');
  const dialog = page.getByRole('dialog', { name: 'Insert blank pages' });
  await dialog.getByRole('textbox', { name: 'How many pages' }).fill('3');
  await dialog.getByRole('button', { name: 'Before', exact: true }).click();
  await dialog.getByRole('button', { name: 'The first page', exact: true }).click();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  const read = await savedPages(await saveCopy('pages-blank.pdf'));
  expect(read.map((each) => each.drawn)).toStrictEqual([false, false, false, true, true]);
  expect(read.every((each) => each.width === 612 && each.height === 792)).toBe(true);
  return { pages: read };
});

await step('O3: ONE Undo takes all three blank pages out, in the saved file', async () => {
  await page.keyboard.press('Control+Z');
  const read = await savedPages(await saveCopy('pages-blank-undone.pdf'));
  expect(read.map((each) => each.drawn)).toStrictEqual([true, true]);
  return { pages: read };
});

await step('O3: two pictures after the last page become two pages, in file-name order, one page each, in ONE insert', async () => {
  // TWO PICTURES OF DIFFERENT SHAPES, so the order is readable off the saved pages: *pic 2* is tall and *pic 10* wide,
  // and the picker answers them in the order name order is NOT.
  const tall = join(output, 'pic 2.png');
  const wide = join(output, 'pic 10.png');
  await writeFile(tall, await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 240 } }));
  await writeFile(wide, await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 120 } }));
  await command('Insert images…');
  const dialog = page.getByRole('dialog', { name: 'Insert images' });
  await dialog.getByRole('button', { name: 'After', exact: true }).click();
  await dialog.getByRole('button', { name: 'The last page', exact: true }).click();
  await pickFiles([wide, tall]);
  await saveTo(join(output, 'pages-pictures-composed.pdf'));
  await dialog.getByRole('button', { name: 'Choose images…', exact: true }).click();
  // THE PICTURES' OWN TAB opens beside this one, and the person is brought back to the document they inserted into.
  await expect(page.getByRole('tab', { name: /pages-pictures-composed/u })).toBeVisible();
  const read = await savedPages(await saveCopy('pages-pictures.pdf'));
  expect(read).toHaveLength(4);
  const [, , second, third] = read;
  if (second === undefined || third === undefined) throw new Error('the pictures are not in the saved file');
  expect(second.height).toBeGreaterThan(second.width);
  expect(third.width).toBeGreaterThan(third.height);
  return { pages: read };
});

await step('O3: ONE Undo takes both pictures out, in the saved file', async () => {
  await page.getByRole('tab', { name: /^pages\.pdf/u }).first().click();
  await page.keyboard.press('Control+Z');
  const read = await savedPages(await saveCopy('pages-pictures-undone.pdf'));
  expect(read).toHaveLength(2);
  return { pages: read };
});

await step('O9: a dismissed Markdown picker shows NO notice — nothing was chosen, so nothing is converting', async () => {
  await pickFiles([]);
  await command('New PDF from Markdown…');
  // THE FONT QUESTION FIRST (L4), answered with its default; the picker after it is the one dismissed.
  await page.getByRole('dialog', { name: 'New PDF' }).getByRole('button', { name: 'Choose file…' }).click();
  // LONGER THAN THE NOTICE'S FIRST LOOK (200 ms) several times over, so a notice that ignored the picker would be up.
  await page.waitForTimeout(1500);
  expect(await page.locator('[data-task-notice]').count()).toBe(0);
});

await step('O9: converting a long Markdown file shows "Converting Markdown to PDF" from the chosen file until the tab opens; the PDF is written', async () => {
  // LONG ENOUGH TO TAKE SECONDS in the compose host, so the notice has time to be seen.
  const markdown = join(output, 'long.md');
  const paragraph = 'A paragraph of plain words that the composer sets as prose, again and again. ';
  await writeFile(markdown, Array.from({ length: 4000 }, (_, at) => `## Part ${String(at + 1)}\n\n${paragraph.repeat(6)}\n`).join('\n'));
  const composed = join(output, 'long.pdf');
  await pickFiles([markdown]);
  await saveTo(composed);
  await command('New PDF from Markdown…');
  await page.getByRole('dialog', { name: 'New PDF' }).getByRole('button', { name: 'Choose file…' }).click();
  const notice = page.locator('[data-task-notice]');
  await expect(notice).toContainText('Converting Markdown to PDF', { timeout: 20_000 });
  // NO CANCEL: one composition runs to the end, and a button that could not stop it would do nothing.
  expect(await notice.getByRole('button').count()).toBe(0);
  await expect(page.getByRole('tab', { name: /^long\.pdf/u })).toBeVisible({ timeout: 120_000 });
  await expect(notice).toHaveCount(0);
  const read = await savedPages(composed);
  expect(read.length).toBeGreaterThan(1);
  return { pages: read.length };
});

/**
 * L4: a new PDF from Markdown and from CSV, each set in a font of this computer chosen in the font question before the
 * picker, read back by the saved file's page fonts. Courier New and Georgia, because neither is a family the default
 * (Arimo) or a built-in face would put in the file.
 */
for (const { format, title, file, text, family } of [
  { format: 'Markdown', title: 'New PDF from Markdown…', file: 'l4-notes.md', text: '# Notes\n\nSet in the chosen font.\n', family: 'Courier New' },
  { format: 'CSV', title: 'New PDF table from CSV…', file: 'l4-table.csv', text: 'Name,Amount\nFirst,1\nSecond,2\n', family: 'Georgia' },
]) {
  await step(`L4: a new PDF from ${format}, set in ${family} chosen before the picker, has ${family} in the saved file`, async () => {
    const source = join(output, file);
    await writeFile(source, text);
    const composed = join(output, file.replace(/\.\w+$/u, '.pdf'));
    await pickFiles([source]);
    await saveTo(composed);
    await command(title);
    const dialog = page.getByRole('dialog', { name: 'New PDF' });
    await dialog.getByRole('button', { name: /^Font:/u }).click();
    const search = dialog.getByRole('combobox', { name: 'Search fonts' });
    await search.fill(family);
    await search.press('Enter');
    await dialog.getByRole('button', { name: 'Choose file…' }).click();
    await expect.poll(() => existsSync(composed), { timeout: 60_000 }).toBe(true);
    const fonts = await savedFonts(composed);
    // READ BACK: the face's PostScript name carries the family without its space (CourierNewPSMT, Georgia).
    expect(fonts.some((name) => name.replace(/^[A-Z]{6}\+/u, '').replace(/\s/gu, '').toLowerCase().startsWith(family.replace(/\s/gu, '').toLowerCase()))).toBe(true);
    return { fonts };
  });
}

await step('N5: a dialog’s buttons sit at the centre of its footer, and Settings keeps its own at the right', async () => {
  await command('Watermark…');
  const dialog = page.getByRole('dialog', { name: 'Watermark' });
  const outer = await dialog.locator('.m-dialog-footer').boundingBox();
  const group = await dialog.locator('.m-dialog-footer__buttons').boundingBox();
  if (outer === null || group === null) throw new Error('the Watermark footer is not drawn');
  const offCentre = Math.abs(group.x + group.width / 2 - (outer.x + outer.width / 2));
  expect(offCentre).toBeLessThan(1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  return { offCentre };
});

await step('L7: a NUL in a Markdown file is the replacement character in the saved PDF, once, as CommonMark requires', async () => {
  const source = join(output, 'l7-nul.md');
  await writeFile(source, `Null ${String.fromCharCode(0)} here.\n`);
  const composed = join(output, 'l7-nul.pdf');
  await pickFiles([source]);
  await saveTo(composed);
  await command('New PDF from Markdown…');
  await page.getByRole('dialog', { name: 'New PDF' }).getByRole('button', { name: 'Choose file…' }).click();
  await expect.poll(() => existsSync(composed), { timeout: 60_000 }).toBe(true);
  // READ BACK by PDF.js: one U+FFFD where the NUL was, and no box list was opened for it.
  const [words] = await savedWords(composed);
  expect(words).toContain(`Null ${String.fromCharCode(0xfffd)} here.`);
  expect((words ?? '').split(String.fromCharCode(0xfffd))).toHaveLength(2);
  expect(await page.getByRole('dialog', { name: 'Some characters are shown as boxes' }).count()).toBe(0);
  return { words };
});

/**
 * N6's samples: a `.doc`, a two-sheet `.xls` and a `.ppt`, which nothing in this repository can make (B10 keeps a binary
 * fixture out of the commit), so they are read from `_review/samples/old-office/` — put there on the walk machine — and a
 * step with its sample missing FAILS saying so, never passes.
 */
const OLD_OFFICE = join(root, '_review', 'samples', 'old-office');
for (const { file, expectation } of [
  { file: 'sample.doc', expectation: 'a Word 97–2003 document' },
  { file: 'sample.xls', expectation: 'an Excel 97–2003 workbook with TWO visible sheets: the PDF holds both' },
  { file: 'sample.ppt', expectation: 'a PowerPoint 97–2003 deck' },
]) {
  await step(`N6: ${file}, ${expectation}, becomes a PDF that opens; read back from the file`, async () => {
    const source = join(OLD_OFFICE, file);
    if (!existsSync(source)) throw new Error(`no sample at ${source}: put ${expectation} there and run the walk again`);
    const made = join(output, `${file}.pdf`);
    await pickFiles([source]);
    await saveTo(made);
    await command('New PDF from Word, Excel or PowerPoint…');
    await expect(page.getByRole('tab', { name: new RegExp(`^${file.replace('.', '\\.')}\\.pdf`, 'u') })).toBeVisible({ timeout: 300_000 });
    const read = await savedPages(made);
    // TWO SHEETS ARE TWO PARTS, each its own pages: one page would be x2t's active sheet alone, the loss N6 must not have.
    expect(read.length).toBeGreaterThanOrEqual(file.endsWith('.xls') ? 2 : 1);
    return { pages: read.length };
  });
}

/** One page of text lines laid on a baseline turned `angle` degrees, as `pageDeskew.test.ts` lays its own. @param {number} angle */
async function linesAt(angle) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const added = document.addPage([420, 560]);
  for (let index = 0; index < 18; index += 1) {
    added.drawText('The quick brown fox jumps over the lazy dog, again and again.', { x: 40, y: 500 - index * 26, size: 10, font, rotate: degrees(angle) });
  }
  return document.save({ useObjectStreams: false });
}

/**
 * The turn the first `cm` on page 1 of a saved file applies, in degrees, read from its decoded content streams by
 * pdf-lib; `null` when no stream on the page opens with one.
 *
 * @param {string} path
 */
async function firstTurn(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const [first] = document.getPages();
  if (first === undefined) throw new Error('the saved file has no page');
  const contents = first.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((entry) => document.context.lookup(entry)) : [contents];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) continue;
    const text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
    const cm = /^\s*q\s+(-?[\d.]+)\s+(-?[\d.]+)\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+cm/u.exec(text);
    if (cm !== null) return (Math.atan2(Number(cm[2]), Number(cm[1])) * 180) / Math.PI;
  }
  return null;
}

await step('N3: Straighten turns a page tilted 3 degrees upright, says "The page is now straight.", and the saved page carries the turn', async () => {
  const tilted = join(output, 'tilted.pdf');
  await writeFile(tilted, await linesAt(3));
  await open(tilted);
  await command('Straighten crooked pages');
  const dialog = page.getByRole('dialog', { name: 'Straighten' });
  await expect(dialog).toContainText('The page is now straight.', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  const turn = await firstTurn(await saveCopy('tilted-straightened.pdf'));
  // THE OPPOSITE OF THE TILT, within the measurement's half degree: the sign is what a wrong turn would get wrong.
  expect(turn).not.toBeNull();
  expect(Math.abs(Math.abs(turn ?? 0) - 3)).toBeLessThan(0.5);
  return { turn };
});

await step('N3: Straighten on a level page says "This page is already straight. Nothing was changed." and the saved page has no turn', async () => {
  const level = join(output, 'level.pdf');
  await writeFile(level, await linesAt(0));
  await open(level);
  await command('Straighten crooked pages');
  const dialog = page.getByRole('dialog', { name: 'Straighten' });
  await expect(dialog).toContainText('This page is already straight. Nothing was changed.', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  expect(await firstTurn(await saveCopy('level-unchanged.pdf'))).toBeNull();
});

/**
 * A JPEG of a light sheet turned 8 degrees on a dark desk, `width` by `height`: the photograph the crop finds a sheet in.
 * Drawn on the app's own canvas, because a phone photo is a JPEG and the crop decodes only what MuPDF recognises on its
 * own: the same picture embedded as raw samples behind `/FlateDecode` reads as *unreadable* (measured 2026-10-13).
 *
 * @param {number} width
 * @param {number} height
 */
async function photographJpeg(width, height) {
  const base64 = await page.evaluate(([w, h]) => {
    /** @typedef {{ fillStyle: string; fillRect: (x: number, y: number, w: number, h: number) => void; translate: (x: number, y: number) => void; rotate: (a: number) => void }} Pen */
    const dom = /** @type {{ createElement: (tag: string) => { width: number; height: number; getContext: (kind: string) => Pen | null; toDataURL: (type: string, quality: number) => string } }} */ (
      Reflect.get(globalThis, 'document')
    );
    const canvas = dom.createElement('canvas');
    canvas.width = w ?? 0;
    canvas.height = h ?? 0;
    const pen = canvas.getContext('2d');
    if (pen === null) throw new Error('the renderer has no 2d canvas');
    pen.fillStyle = '#282828';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.translate(canvas.width / 2, canvas.height / 2);
    pen.rotate((8 * Math.PI) / 180);
    pen.fillStyle = '#ebebeb';
    // A SHEET TALLER THAN WIDE in a photograph wider than tall, so the cropped page's shape is the sheet's and not the photo's.
    pen.fillRect(-canvas.width * 0.25, -canvas.height * 0.42, canvas.width * 0.5, canvas.height * 0.84);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '';
  }, [width, height]);
  return Buffer.from(base64, 'base64');
}

await step('N3: Crop to paper crops a photographed sheet, says "The page is now cropped to the paper.", and the saved page is the sheet', async () => {
  const document = await PDFDocument.create();
  const photo = await document.embedJpg(await photographJpeg(800, 600));
  document.addPage([612, 459]).drawImage(photo, { x: 0, y: 0, width: 612, height: 459 });
  const photographed = join(output, 'photographed.pdf');
  await writeFile(photographed, await document.save({ useObjectStreams: false }));
  await open(photographed);
  await command('Crop photographed pages to the paper');
  const dialog = page.getByRole('dialog', { name: 'Crop to paper' });
  await expect(dialog).toContainText('The page is now cropped to the paper.', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  const [read] = await savedPages(await saveCopy('photographed-cropped.pdf'));
  // THE SHEET IS TALLER THAN WIDE where the photograph was wider than tall, so the page's box changing shape is the crop.
  expect(read?.height).toBeGreaterThan(read?.width ?? Number.POSITIVE_INFINITY);
  return { page: read };
});

await step('N3: Crop to paper on a typed page says no photographed pages, and changes nothing', async () => {
  const typed = join(output, 'typed.pdf');
  await writeFile(typed, await linesAt(0));
  await open(typed);
  await command('Crop photographed pages to the paper');
  const dialog = page.getByRole('dialog', { name: 'Crop to paper' });
  await expect(dialog).toContainText('No photographed pages here.', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  expect(await firstTurn(await saveCopy('typed-unchanged.pdf'))).toBeNull();
});

await finish();
