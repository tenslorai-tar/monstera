// @ts-check
/**
 * How big is page 1 as the recent list's card picture? (ADR-0100)
 *
 * The card draws a few hundred pixels, and the host draws no smaller than one pixel per point
 * (`MIN_SNAPSHOT_SCALE`), so the picture is page 1 at that scale, encoded as JPEG. This measures the bytes
 * that costs over a folder of real PDFs, at a few qualities, through the KERNEL's own rasteriser — the one
 * the engine host runs — so the number is the product's and not a second opinion about how a page draws.
 *
 * Usage: MONSTERA_CORPUS=<folder> node scripts/research/recentPreviewSize.mjs
 *
 * Prints no file names, only an index, because the corpus is private.
 *
 * CONTROL: a blank page built here is measured first and must come out smaller than every corpus page
 * that has content, or the instrument is not reading what it claims.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { MIN_SNAPSHOT_SCALE } from '@monstera/contract';
import { mupdfWriter, rasterisePageImage } from '@monstera/kernel/engine';

const QUALITIES = [60, 75, 90];

const corpus = process.env['MONSTERA_CORPUS'];
if (corpus === undefined || corpus === '') {
  throw new Error('Set MONSTERA_CORPUS to a folder of PDFs.');
}

/**
 * @param {Uint8Array} bytes
 * @param {number} quality
 * @returns {Promise<number>}
 */
async function pictureBytes(bytes, quality) {
  const session = await mupdfWriter.open(bytes);
  try {
    const picture = await rasterisePageImage(session, { page: 0, format: 'jpeg', scale: MIN_SNAPSHOT_SCALE, quality });
    return picture.length;
  } finally {
    await mupdfWriter.close(session);
  }
}

const blank = await PDFDocument.create();
blank.addPage([612, 792]);
const blankBytes = await blank.save();
/** @type {Record<number, number>} */
const control = {};
for (const quality of QUALITIES) control[quality] = await pictureBytes(blankBytes, quality);
process.stdout.write(`control (blank Letter page): ${QUALITIES.map((q) => `q${String(q)}=${String(control[q])}`).join(' ')}\n`);

const files = readdirSync(corpus).filter((name) => name.toLowerCase().endsWith('.pdf'));
if (files.length === 0) throw new Error(`no PDFs in the corpus folder, so nothing was measured`);

/** @type {Record<number, number[]>} */
const sizes = Object.fromEntries(QUALITIES.map((q) => [q, []]));
let index = 0;
for (const name of files) {
  index += 1;
  const bytes = new Uint8Array(readFileSync(join(corpus, name)));
  /** @type {string[]} */
  const row = [];
  try {
    for (const quality of QUALITIES) {
      const size = await pictureBytes(bytes, quality);
      sizes[quality]?.push(size);
      row.push(`q${String(quality)}=${String(size)}`);
    }
    process.stdout.write(`#${String(index)}: ${row.join(' ')}\n`);
  } catch (error) {
    process.stdout.write(`#${String(index)}: could not draw page 1 (${error instanceof Error ? error.name : 'unknown'})\n`);
  }
}

for (const quality of QUALITIES) {
  const list = [...(sizes[quality] ?? [])].sort((a, b) => a - b);
  const median = list[Math.floor(list.length / 2)] ?? 0;
  const max = list.at(-1) ?? 0;
  const belowControl = list.filter((size) => size <= (control[quality] ?? 0)).length;
  process.stdout.write(
    `q${String(quality)}: ${String(list.length)} pages, median ${String(median)} B, max ${String(max)} B, ` +
      `${String(belowControl)} at or under the blank control\n`,
  );
}
