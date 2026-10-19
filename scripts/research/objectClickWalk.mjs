// @ts-check
/**
 * Edit object's response to a click, timed step by step in the running app (the owner's review of 0.1.16.0, R11: on a
 * multi-page brochure, a click on a picture took several seconds to select it, the view jumped to another page, and
 * clicks seemed lost).
 *
 *   node scripts/research/objectClickWalk.mjs
 *
 * The document is made here by pdf-lib — never a person's — as a brochure is: eight pages, each a heading, two columns
 * of text and four pictures. What is timed, each from the moment before the action:
 *
 * - **outlines**: Edit images chosen on page 5, until that page's pictures are outlined (the page's object read);
 * - **select**: a press on a picture, until it is marked selected; three presses on three pictures;
 * - **page in view** before and after each press, so a jump is a number and not an impression;
 * - **the reads' own times**, from the app's request log (`app-data/logs/shell.log`): `document.pageObjects`,
 *   `document.textBlocks`, `document.annotations`, each with its duration.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { startWalk } from './liveWalk.mjs';

const walk = await startWalk('objectClick');
const { page, output, open, command, step, finish } = walk;

/** A CRC-32 of `bytes`, as PNG's chunks carry one. @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG chunk. @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  head.set(Buffer.from(type, 'latin1'), 4);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32(new Uint8Array([...head.subarray(4), ...data])));
  return Buffer.concat([head, data, tail]);
}

/** A photo-sized RGB PNG, a smooth gradient with a seed so each picture differs. @param {number} seed */
function photo(seed) {
  const width = 1600;
  const height = 1000;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = (x + seed * 37) & 255;
      raw[at + 1] = (y + seed * 61) & 255;
      raw[at + 2] = ((x + y) / 2 + seed * 11) & 255;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

const brochure = join(output, 'input-brochure.pdf');
const made = await PDFDocument.create();
const font = await made.embedFont(StandardFonts.Helvetica);
const bold = await made.embedFont(StandardFonts.HelveticaBold);
const words = 'Our programme runs through the year with sessions for every age, held in the hall and the garden, and open to all.';
for (let at = 1; at <= 8; at += 1) {
  const each = made.addPage([595, 842]);
  each.drawRectangle({ x: 0, y: 760, width: 595, height: 82, color: rgb(0.1, 0.35, 0.3) });
  each.drawText(`Brochure page ${String(at)}`, { font: bold, size: 24, x: 40, y: 790, color: rgb(1, 1, 1) });
  for (let line = 0; line < 14; line += 1) {
    each.drawText(words.slice(0, 58), { font, size: 9, x: 40, y: 400 - line * 12 });
    each.drawText(words.slice(58), { font, size: 9, x: 310, y: 400 - line * 12 });
  }
  for (let picture = 0; picture < 4; picture += 1) {
    const image = await made.embedPng(photo(at * 4 + picture));
    each.drawImage(image, { x: 40 + (picture % 2) * 270, y: 560 - Math.floor(picture / 2) * 150 + 40, width: 250, height: 140 });
  }
}
await writeFile(brochure, await made.save());

/** The 1-based number of the page whose canvas holds the window's middle, or 0. */
const pageInView = () =>
  page.locator('[data-page-canvas]').evaluateAll((canvases) => {
    const middle = (canvases[0]?.ownerDocument.defaultView?.innerHeight ?? 0) / 2;
    const held = canvases.find((canvas) => {
      const box = canvas.getBoundingClientRect();
      return box.top <= middle && box.bottom >= middle;
    });
    // ZERO-BASED on the canvas (the kernel's index), one-based in the answer, as the status bar shows it.
    return Number(held?.getAttribute('data-page-canvas') ?? '-1') + 1;
  });

/** The outlined pictures that lie on page `number`'s canvas, by their outline's box. @param {number} number */
const picturesOn = async (number) => {
  const canvas = await page.locator(`[data-page-canvas="${String(number - 1)}"]`).boundingBox({ timeout: 5000 }).catch(() => null);
  if (canvas === null) return [];
  const outlines = await page
    .locator('[data-object-kind="image"]')
    .evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute('data-object') ?? '', box: element.getBoundingClientRect().toJSON() })));
  return outlines
    .filter(({ box }) => box.top >= canvas.y - 1 && box.bottom <= canvas.y + canvas.height + 1 && box.width > 0)
    .map(({ id, box }) => ({ id, x: box.x + box.width / 2, y: box.y + box.height / 2 }));
};

await step('R11.1: Edit images on page 5 of a brochure — the time until its pictures are outlined', async () => {
  await open(brochure);
  const goTo = page.getByRole('textbox', { name: 'Go to page', exact: true });
  await goTo.fill('5');
  await goTo.press('Enter');
  await expect.poll(pageInView, { timeout: 10_000 }).toBe(5);
  const began = Date.now();
  await command('Edit images');
  await expect.poll(async () => (await picturesOn(5)).length, { timeout: 30_000 }).toBe(4);
  return { outlinedMs: Date.now() - began, pageInView: await pageInView() };
});

/** @type {Record<string, unknown>[]} */
const presses = [];
await step('R11.2: three presses on three pictures of page 5 — each until it is selected, and the page in view', async () => {
  for (let picture = 0; picture < 3; picture += 1) {
    const targets = await picturesOn(5);
    const target = targets[picture];
    if (target === undefined) throw new Error(`picture ${String(picture)} is not outlined on page 5`);
    const before = await pageInView();
    const began = Date.now();
    await page.mouse.click(target.x, target.y);
    // THE PAGE'S OWN OUTLINE: another page's object may carry the same index.
    const onPage = page.getByRole('group', { name: 'Objects on page 5' }).locator(`[data-object="${target.id}"]`);
    await expect(onPage).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    presses.push({ picture, selectedMs: Date.now() - began, pageBefore: before, pageAfter: await pageInView() });
  }
  return { presses };
});

await step('R11.4: each read ALONE, once the page is settled — three of each, the lane empty, from the page itself', async () => {
  const docId = await page.locator('[data-tab]').first().getAttribute('data-tab');
  if (docId === null) throw new Error('no tab names its document');
  return page.evaluate(async (id) => {
    const bridge = /** @type {{ invoke: (channel: string, params: unknown) => Promise<unknown> }} */ (Reflect.get(globalThis, 'monstera'));
    /** @type {Record<string, number[]>} */
    const times = { 'document.pageObjects': [], 'document.textBlocks': [], 'document.annotations': [] };
    for (let round = 0; round < 3; round += 1) {
      for (const channel of Object.keys(times)) {
        const began = performance.now();
        await bridge.invoke(channel, channel === 'document.annotations' ? { docId: id, from: 0 } : { docId: id, page: 4, from: 0 });
        times[channel]?.push(Math.round(performance.now() - began));
      }
    }
    return times;
  }, docId);
});

await step('R11.3: the reads the mode made, and how long each took, from the app’s request log', async () => {
  const log = await readFile(join(output, 'app-data', 'logs', 'shell.log'), 'utf8');
  const reads = log
    .split('\n')
    .filter((line) => / REQUEST document\.(pageObjects|textBlocks|annotations) /u.test(line))
    .map((line) => line.replace(/^\S+ REQUEST /u, ''));
  return { reads };
});

await finish();
