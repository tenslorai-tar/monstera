// @ts-check
/**
 * Whether the application draws every page of a document as MuPDF draws it: each page's share of inked pixels, read
 * from the page's canvas in the running application and from MuPDF 1.28's own drawing of the same page.
 *
 *   node scripts/research/pictureCheck.mjs --path <a PDF> [--app-root <checkout>]
 *
 * Written for pictures PDF.js could not decode (CCITT, JBIG2, JPEG 2000), which drew as nothing while the rest of the
 * page drew: a page whose only content is such a picture read as a blank page. The figure compared is the INK SHARE,
 * the fraction of a page's pixels darker than near-white, which does not depend on the size the page was drawn at. A
 * page passes when the two shares differ by less than {@link TOLERANCE}: a page that drew as nothing reads 0 against
 * MuPDF's share, and two rasterisers' anti-aliasing differs by far less.
 *
 * Nothing about the document is printed or written: no name, no words, only page numbers and two numbers a page.
 *
 * ## The control, every run
 *
 * The share is computed in the application's page by one function, run first on a canvas the script draws itself, a
 * black square over a known fraction of a white canvas. The run refuses to report unless that reads the fraction drawn:
 * a reader that saw nothing would report every page blank, and a reader that saw everything every page full, and both
 * read as a finding. MuPDF's side refuses a document whose every page it reads as blank, which compares nothing.
 */

import { readFileSync } from 'node:fs';

import * as mupdf from 'mupdf';

import { appRootOption, startWalk } from './liveWalk.mjs';

/** Two shares closer than this are the same drawing; a page drawn as nothing differs by the whole of MuPDF's share. */
const TOLERANCE = 0.03;
/** Darker than this in every channel is ink, against a white page. */
const INK_BELOW = 235;

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const given = option('--path');
if (given === undefined) throw new Error('usage: node scripts/research/pictureCheck.mjs --path <a PDF> [--app-root <checkout>]');
const path = given;

/** MuPDF's ink share of each page, drawn at 72 dpi in RGB on white. */
function mupdfShares() {
  const document = mupdf.Document.openDocument(readFileSync(path), 'application/pdf');
  /** @type {number[]} */
  const shares = [];
  for (let at = 0; at < document.countPages(); at += 1) {
    const pixmap = document.loadPage(at).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
    const pixels = pixmap.getPixels();
    let ink = 0;
    for (let byte = 0; byte < pixels.length; byte += 3) {
      if ((pixels[byte] ?? 255) < INK_BELOW || (pixels[byte + 1] ?? 255) < INK_BELOW || (pixels[byte + 2] ?? 255) < INK_BELOW) ink += 1;
    }
    shares.push(ink / (pixels.length / 3));
  }
  return shares;
}

const reference = mupdfShares();
if (reference.every((share) => share === 0)) throw new Error('MuPDF draws every page of this document blank, so nothing here can be compared');

const walk = await startWalk('picture-check', appRootOption(process.argv));
const { page, open, finish } = walk;

/**
 * The reader, defined in the page once, so the control and every page go through the same function. A string, since
 * this file is checked without the DOM's types and the function runs only in the page. A TRANSPARENT pixel is one
 * nothing was drawn on, which the page's white ground shows as white, so it counts as shown and not as ink.
 */
await page.evaluate(String.raw`globalThis.__inkShare = (canvas) => {
  const context = canvas.getContext('2d');
  if (context === null || canvas.width === 0 || canvas.height === 0) return -1;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let ink = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] === 0) continue;
    if (data[at] < ${String(INK_BELOW)} || data[at + 1] < ${String(INK_BELOW)} || data[at + 2] < ${String(INK_BELOW)}) ink += 1;
  }
  return ink / (data.length / 4);
}`);

{
  // THE CONTROL: a white canvas with a black square over a quarter of it must read a quarter.
  const read = Number(
    await page.evaluate(String.raw`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 200, 200);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, 100, 100);
      return globalThis.__inkShare(canvas);
    })()`),
  );
  if (Math.abs(read - 0.25) > 0.001) throw new Error(`the ink reader read ${String(read)} for a canvas a quarter inked, so it is blind and nothing is reported`);
  process.stdout.write(`control: a canvas a quarter inked reads ${read.toFixed(3)}\n`);
}

await open(path);
let failures = 0;
for (let at = 0; at < reference.length; at += 1) {
  const slot = page.locator('.m-page-list:visible .m-page-slot').nth(at);
  await slot.scrollIntoViewIfNeeded();
  const canvas = slot.locator('canvas.m-page');
  await canvas.waitFor({ state: 'visible', timeout: 30_000 });
  // SETTLED: the same share twice, a second apart, so a page still drawing is not read half drawn.
  let previous = -3;
  let share = -4;
  for (let tries = 0; tries < 30 && share !== previous; tries += 1) {
    previous = share;
    await page.waitForTimeout(1000);
    share = Number(await canvas.evaluate((element) => /** @type {(canvas: unknown) => number} */ (Reflect.get(globalThis, '__inkShare'))(element)));
  }
  const failed = await canvas.getAttribute('data-failed');
  const expected = reference[at] ?? 0;
  const same = Math.abs(share - expected) < TOLERANCE && failed === null;
  if (!same) failures += 1;
  process.stdout.write(
    `page ${String(at + 1)}: app ${share.toFixed(3)}, MuPDF ${expected.toFixed(3)}${failed === null ? '' : ', marked failed'} ${same ? 'ok' : 'DIFFERS'}\n`,
  );
}
process.stdout.write(`${String(reference.length - failures)} of ${String(reference.length)} page(s) drawn as MuPDF draws them\n`);
await finish();
process.exitCode = failures === 0 ? 0 : 1;
