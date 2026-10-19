// @ts-check
/**
 * Where a measurement's parts are, read in the running app against each other (the owner's review of 0.1.16.0, R7: the
 * selection box and the end handles did not sit on the drawn line, the line ran past its own box, the label jumped off
 * the line during an end's drag, and a triangle's handles and box did not match its corners after a move).
 *
 *   node scripts/research/measureGeometryWalk.mjs
 *
 * Every part is read in WINDOW pixels, from its own source, so two sources that disagree show as a number:
 *
 * - **saved**: the geometry the file holds (`/L`, `/Vertices`), read from a saved copy by pdf-lib, placed through the
 *   page slot's own scale;
 * - **ink**: where the mark is drawn, read from the page canvas's pixels (anything not near white, in a window drawn
 *   around the mark and away from the page's words);
 * - **handles** and **box**: the selection layer's elements;
 * - **mid-drag**: the preview's path, the live reading's text box and font size, and the box, with the pointer half way.
 *
 * Our own one-page document, never a person's. Nothing is asserted: this is the instrument, and the record is its
 * reading.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from '@cantoo/pdf-lib';
import { startWalk } from './liveWalk.mjs';

const walk = await startWalk('measureGeometry');
const { page, output, open, saveTo, command, step, finish } = walk;

const plan = join(output, 'input-plan.pdf');
const made = await PDFDocument.create();
const font = await made.embedFont(StandardFonts.Helvetica);
made.addPage([612, 792]).drawText('Plan: measure the room below.', { x: 72, y: 720, size: 20, font });
await writeFile(plan, await made.save());

/** Saves a copy and answers each measurement's points on page 1. @param {string} name */
async function savedPoints(name) {
  const saved = join(output, name);
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  const document = await PDFDocument.load(await readFile(saved), { updateMetadata: false });
  const annots = document.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return (annots?.asArray() ?? [])
    .map((entry) => document.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict && entry.get(PDFName.of('Measure')) !== undefined)
    .map((entry) => {
      const mark = /** @type {PDFDict} */ (entry);
      const array = mark.lookup(PDFName.of('L')) ?? mark.lookup(PDFName.of('Vertices'));
      const numbers = array instanceof PDFArray ? array.asArray().map((each) => (each instanceof PDFNumber ? each.asNumber() : Number.NaN)) : [];
      const pairs = [];
      for (let at = 0; at + 1 < numbers.length; at += 2) pairs.push({ x: numbers[at] ?? 0, y: numbers[at + 1] ?? 0 });
      return { subtype: String(mark.get(PDFName.of('Subtype'))), points: pairs };
    });
}

/** Page 1's slot in window pixels, and points to pixels. */
async function slot() {
  const box = await page.locator('.m-page-slot:visible').first().boundingBox();
  if (box === null) throw new Error('page 1 has no box on screen');
  const scale = box.width / 612;
  /** @param {{ x: number; y: number }} point */
  const at = (point) => ({ x: box.x + point.x * scale, y: box.y + (792 - point.y) * scale });
  return { ...box, scale, at };
}

/** The selection layer's handles and box, in window pixels. */
async function selectionParts() {
  const handles = await page.locator('[data-selection-handle^="point-"]').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { name: element.getAttribute('data-selection-handle'), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
  const box = await page.locator('rect.m-selection-box').first().boundingBox();
  return { handles, box };
}

/**
 * The page SETTLED after a drag: the shape held over the release is gone, and the selection draws the mark's own
 * handles again. A drag that never lets go of its held shape leaves the mark undrawn and handle-less, so this throws
 * rather than measuring that state.
 */
async function settled() {
  await expect(page.locator('[data-annotation-held], [data-reshaped-selection]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-selection-handle^="point-"]').first()).toBeAttached({ timeout: 15_000 });
}

/**
 * A screenshot of `window` with the selection and the tool overlays hidden for it, as base64: the page's own pixels.
 * Hidden through the CSSOM, which the renderer's CSP allows where an inline style tag is refused.
 *
 * @param {{ x: number; y: number; width: number; height: number }} window
 */
async function screenOf(window) {
  const overlays = page.locator('.m-selection-layer, .m-annotation-overlay');
  await overlays.evaluateAll((elements) => {
    for (const element of elements) Reflect.set(Reflect.get(element, 'style'), 'visibility', 'hidden');
  });
  const shot = (await page.screenshot({ clip: window })).toString('base64');
  await overlays.evaluateAll((elements) => {
    for (const element of elements) Reflect.set(Reflect.get(element, 'style'), 'visibility', '');
  });
  return shot;
}

/**
 * The bounding box of the ink inside a window of THE SCREEN, in window pixels: a screenshot of the window, with the
 * selection and the tools hidden for it, decoded by the page itself. The screen, not the page canvas, because the page
 * may be shown by another surface (the second rasteriser's picture) while the canvas holds an older frame.
 *
 * @param {{ x: number; y: number; width: number; height: number }} window
 */
async function inkIn(window) {
  // THE MARK'S OWN INK ALONE: the selection's box and handles and the tool overlays are drawn over it. Hidden through
  // the CSSOM, which the renderer's CSP allows where an inline style tag is refused.
  const shot = await screenOf(window);
  return page.evaluate(async ({ png, area }) => {
    // DECODED FROM BYTES, not a `data:` address, which the renderer's CSP may refuse as an image source. The browser's
    // globals by name: this file is type-checked without the DOM's types, as every walk here is.
    const bytes = Uint8Array.from(Reflect.get(globalThis, 'atob')(png), (/** @type {string} */ character) => character.charCodeAt(0));
    const image = await Reflect.get(globalThis, 'createImageBitmap')(new (Reflect.get(globalThis, 'Blob'))([bytes], { type: 'image/png' }));
    const canvas = new (Reflect.get(globalThis, 'OffscreenCanvas'))(image.width, image.height);
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const w = image.width;
    const h = image.height;
    const sx = w / area.width;
    const sy = h / area.height;
    const { data } = context.getImageData(0, 0, w, h);
    const rect = { x: area.x, y: area.y };
    const x0 = 0;
    const y0 = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const at = (y * w + x) * 4;
        const r = data[at] ?? 255;
        const g = data[at + 1] ?? 255;
        const b = data[at + 2] ?? 255;
        // INKED: anything not near white. The window is drawn around the mark alone, away from the page's words.
        if (Math.min(r, g, b) > 200) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (left === Infinity) return null;
    return { left: rect.x + (x0 + left) / sx, top: rect.y + (y0 + top) / sy, right: rect.x + (x0 + right + 1) / sx, bottom: rect.y + (y0 + bottom + 1) / sy };
  }, { png: shot, area: window });
}

await step('R7.0: CONTROL — the screen read finds the page’s own words where they are drawn', async () => {
  await open(plan);
  const page1 = await slot();
  // "Plan: measure the room below." at 72, 720, 20 pt: its ink lies inside this window and nowhere else near it.
  const corner = page1.at({ x: 60, y: 750 });
  const ink = await inkIn({ x: corner.x, y: corner.y, width: 360 * page1.scale, height: 50 * page1.scale });
  if (ink === null) throw new Error('the screen read found no ink where the page’s words are: the instrument is blind');
  const words = page1.at({ x: 72, y: 720 });
  // THE BASELINE'S LEFT END within a few pixels of the ink's left, or the read is of something else.
  if (Math.abs(ink.left - words.x) > 4) throw new Error(`the words' ink starts at ${String(ink.left)}, not at ${String(words.x)}`);
  return { ink, wordsStart: words };
});

/**
 * How far the ink ALONG a segment reaches past each of its ends, in window pixels: inked pixels within `band` of the
 * line through `a` and `b`, projected onto it. Negative is short of the end. Read from the screen as {@link inkIn} is.
 *
 * @param {{ x: number; y: number }} a
 * @param {{ x: number; y: number }} b
 */
async function inkAlong(a, b, band = 3) {
  const margin = 60;
  const window = { x: Math.min(a.x, b.x) - margin, y: Math.min(a.y, b.y) - margin, width: Math.abs(b.x - a.x) + 2 * margin, height: Math.abs(b.y - a.y) + 2 * margin };
  const shot = await screenOf(window);
  return page.evaluate(
    async ({ png, area, from, to, width }) => {
      const bytes = Uint8Array.from(Reflect.get(globalThis, 'atob')(png), (/** @type {string} */ character) => character.charCodeAt(0));
      const image = await Reflect.get(globalThis, 'createImageBitmap')(new (Reflect.get(globalThis, 'Blob'))([bytes], { type: 'image/png' }));
      const canvas = new (Reflect.get(globalThis, 'OffscreenCanvas'))(image.width, image.height);
      const context = canvas.getContext('2d');
      if (context === null) return null;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const scale = image.width / area.width;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      let least = Infinity;
      let most = -Infinity;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const at = (y * image.width + x) * 4;
          if (Math.min(data[at] ?? 255, data[at + 1] ?? 255, data[at + 2] ?? 255) > 200) continue;
          const px = area.x + (x + 0.5) / scale - from.x;
          const py = area.y + (y + 0.5) / scale - from.y;
          if (Math.abs(px * uy - py * ux) > width) continue;
          const along = px * ux + py * uy;
          least = Math.min(least, along);
          most = Math.max(most, along);
        }
      }
      return least === Infinity ? null : { pastStart: Math.round(-least * 10) / 10, pastEnd: Math.round((most - length) * 10) / 10 };
    },
    { png: shot, area: window, from: a, to: b, width: band },
  );
}

/** A number to one decimal. @param {number} value */
const one = (value) => Math.round(value * 10) / 10;

await step('R7.1: a DISTANCE drawn on a slant — its ink, its saved ends, its handles and its box, after Select', async () => {
  await command('Measure distance');
  const page1 = await slot();
  const from = page1.at({ x: 120, y: 300 });
  const to = page1.at({ x: 340, y: 420 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.mouse.click((from.x + to.x) / 2, (from.y + to.y) / 2);
  await expect(page.locator('[data-selection-handle="point-1"]')).toBeAttached();
  const saved = (await savedPoints('distance-drawn.pdf')).find((each) => each.subtype === '/Line');
  if (saved === undefined) throw new Error('no distance in the saved file');
  const ends = saved.points.map((point) => page1.at(point));
  const { handles, box } = await selectionParts();
  const ink = await inkIn({ x: Math.min(from.x, to.x) - 80, y: Math.min(from.y, to.y) - 80, width: Math.abs(to.x - from.x) + 160, height: Math.abs(to.y - from.y) + 160 });
  const [start, end] = ends;
  const along = start === undefined || end === undefined ? null : await inkAlong(start, end);
  return {
    inkPastSavedEnds: along,
    savedEnds: ends.map((each) => ({ x: one(each.x), y: one(each.y) })),
    handles: handles.map((handle) => ({ name: handle.name, x: one(handle.x), y: one(handle.y) })),
    handleOffEnd: handles.map((handle, at) => one(Math.hypot(handle.x - (ends[at]?.x ?? 0), handle.y - (ends[at]?.y ?? 0)))),
    box: box === null ? null : { left: one(box.x), top: one(box.y), right: one(box.x + box.width), bottom: one(box.y + box.height) },
    ink: ink === null ? null : { left: one(ink.left), top: one(ink.top), right: one(ink.right), bottom: one(ink.bottom) },
  };
});

await step('R7.2: the distance’s END dragged — mid-drag: the preview path, the live reading, the box; after: the same as R7.1', async () => {
  const page1 = await slot();
  const handle = page.locator('[data-selection-handle="point-1"]');
  const start = await handle.boundingBox();
  if (start === null) throw new Error('no end handle');
  const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const target = { x: grab.x + 60 * page1.scale, y: grab.y + 40 * page1.scale };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move((grab.x + target.x) / 2, (grab.y + target.y) / 2, { steps: 8 });
  const pointer = { x: (grab.x + target.x) / 2, y: (grab.y + target.y) / 2 };
  const middle = await page.evaluate(() => {
    // THE BROWSER'S GLOBALS BY NAME: this file is type-checked without the DOM's types, as every walk here is.
    const document = Reflect.get(globalThis, 'document');
    const path = document.querySelector('[data-annotation-preview-path]');
    const caption = document.querySelector('[data-annotation-caption]');
    const box = document.querySelector('[data-reshaped-selection] rect.m-selection-box')?.getBoundingClientRect();
    const svg = path?.closest('svg');
    const matrix = svg?.getScreenCTM?.() ?? null;
    const points = String(path?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/u)
      .map((pair) => pair.split(',').map(Number))
      .map(([x = 0, y = 0]) => (matrix === null ? { x, y } : { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f }));
    const text = caption?.getBoundingClientRect();
    return {
      path: points,
      caption:
        caption === null || text === undefined
          ? null
          : { text: String(caption.textContent), left: Number(text.left), top: Number(text.top), right: Number(text.right), bottom: Number(text.bottom), fontSize: String(Reflect.get(globalThis, 'getComputedStyle')(caption).fontSize) },
      box: box === undefined ? null : { left: Number(box.left), top: Number(box.top), right: Number(box.right), bottom: Number(box.bottom) },
    };
  });
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  await settled();
  const saved = (await savedPoints('distance-stretched.pdf')).find((each) => each.subtype === '/Line');
  if (saved === undefined) throw new Error('no distance in the saved file');
  const ends = saved.points.map((point) => page1.at(point));
  const { handles, box } = await selectionParts();
  const [a, b] = middle.path;
  // HOW FAR THE LIVE READING SITS FROM THE PREVIEW LINE: its centre's distance to the segment, in window pixels.
  const centre = middle.caption === null ? null : { x: (middle.caption.left + middle.caption.right) / 2, y: (middle.caption.top + middle.caption.bottom) / 2 };
  const offLine =
    centre === null || a === undefined || b === undefined
      ? null
      : Math.abs((b.y - a.y) * centre.x - (b.x - a.x) * centre.y + b.x * a.y - b.y * a.x) / Math.hypot(b.y - a.y, b.x - a.x);
  return {
    pointer: { x: one(pointer.x), y: one(pointer.y) },
    previewPath: middle.path.map((point) => ({ x: one(point.x), y: one(point.y) })),
    caption: middle.caption,
    captionOffLinePx: offLine === null ? null : one(offLine),
    boxMidDrag: middle.box,
    after: {
      savedEnds: ends.map((end) => ({ x: one(end.x), y: one(end.y) })),
      handleOffEnd: handles.map((each, at) => one(Math.hypot(each.x - (ends[at]?.x ?? 0), each.y - (ends[at]?.y ?? 0)))),
      box,
    },
  };
});

await step('R7.3: an AREA triangle moved whole — its corners, handles, box and ink after the move', async () => {
  await page.keyboard.press('Escape');
  await command('Measure area');
  const page1 = await slot();
  const corners = [
    { x: 150, y: 620 },
    { x: 330, y: 620 },
    { x: 330, y: 520 },
  ].map((corner) => page1.at(corner));
  for (const corner of corners) await page.mouse.click(corner.x, corner.y);
  const [first] = corners;
  if (first === undefined) throw new Error('no corners');
  await page.mouse.click(first.x, first.y);
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const inside = page1.at({ x: 280, y: 590 });
  await page.mouse.click(inside.x, inside.y);
  await expect(page.locator('[data-selection-handle="point-2"]')).toBeAttached();
  const before = await selectionParts();
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.down();
  await page.mouse.move(inside.x + 50 * page1.scale, inside.y + 30 * page1.scale, { steps: 10 });
  await page.mouse.up();
  await settled();
  const saved = (await savedPoints('area-moved.pdf')).find((each) => each.subtype === '/Polygon');
  if (saved === undefined) throw new Error('no area in the saved file');
  const vertices = saved.points.map((point) => page1.at(point));
  const after = await selectionParts();
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const ink = await inkIn({ x: Math.min(...xs) - 60, y: Math.min(...ys) - 60, width: Math.max(...xs) - Math.min(...xs) + 120, height: Math.max(...ys) - Math.min(...ys) + 120 });
  return {
    handlesBefore: before.handles.map((handle) => ({ x: one(handle.x), y: one(handle.y) })),
    savedCorners: vertices.map((vertex) => ({ x: one(vertex.x), y: one(vertex.y) })),
    handlesAfter: after.handles.map((handle) => ({ x: one(handle.x), y: one(handle.y) })),
    handleOffCorner: after.handles.map((handle, at) => one(Math.hypot(handle.x - (vertices[at]?.x ?? 0), handle.y - (vertices[at]?.y ?? 0)))),
    box: after.box,
    cornersBox: { left: one(Math.min(...xs)), top: one(Math.min(...ys)), right: one(Math.max(...xs)), bottom: one(Math.max(...ys)) },
    ink: ink === null ? null : { left: one(ink.left), top: one(ink.top), right: one(ink.right), bottom: one(ink.bottom) },
  };
});

await step('R7.4: the CURSOR on the selected area says what a press will do — a corner resizes, the body moves, off it is the arrow', async () => {
  // THE CURSOR THE PAGE ACTUALLY SHOWS, read from the overlay's computed style after a hover, never from the tool's answer.
  const cursorAt = async (/** @type {{ x: number; y: number }} */ point) => {
    await page.mouse.move(point.x, point.y);
    return page.locator('.m-annotation-overlay').first().evaluate((element) => String(Reflect.get(globalThis, 'getComputedStyle')(element).cursor));
  };
  const corners = await page.locator('[data-selection-handle^="point-"]').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
  if (corners.length !== 3) throw new Error(`expected the area's three corners, found ${String(corners.length)}`);
  const centre = { x: corners.reduce((sum, corner) => sum + corner.x, 0) / 3, y: corners.reduce((sum, corner) => sum + corner.y, 0) / 3 };
  const onCorners = [];
  for (const corner of corners) onCorners.push(await cursorAt(corner));
  const onBody = await cursorAt(centre);
  const off = await cursorAt({ x: centre.x, y: centre.y + 220 });
  if (!onCorners.every((cursor) => cursor.endsWith('-resize'))) throw new Error(`a corner does not say resize: ${onCorners.join(', ')}`);
  if (onBody !== 'move') throw new Error(`the body says ${onBody}, not move`);
  if (off !== 'default') throw new Error(`off the shape says ${off}, not the select tool's arrow`);
  return { onCorners, onBody, off };
});

await finish();
