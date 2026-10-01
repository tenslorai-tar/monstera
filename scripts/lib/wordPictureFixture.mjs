// @ts-check
/**
 * The page the Word export's pictures are measured on
 * ([ADR-0072](../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)'s amendment
 * of 2026-10-01): two columns, a picture between the left column's two paragraphs, the same picture turned 90° in the
 * right column, and a PNG whose right quarter is transparent.
 *
 * Built here, PNG and all, so nothing about it is MuPDF's: the engine under test is not also the author of what it is
 * tested on. One module for `wordPictures.proof.mjs` and `wordPicturesInWord.mjs`, so the proof and the measurement
 * in Word are about the same page.
 */
import { deflateSync } from 'node:zlib';

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';

export const ABOVE = 'Left column paragraph above the picture';
export const BELOW = 'Left column paragraph below the picture';

/**
 * Where each picture is on the page, top-down in points, as `[x0, y0, x1, y1]`: the upright one, then the turned one.
 *
 * @type {readonly (readonly [number, number, number, number])[]}
 */
export const PICTURE_BOXES = [
  [50, 132, 250, 232],
  [350, 292, 400, 392],
];

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 40 × 20 RGBA: top-left red, top-right blue, bottom green; columns 30–39 fully transparent. */
export function quadrantPng() {
  const width = 40;
  const height = 20;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgb = y < height / 2 ? (x < width / 2 ? [255, 0, 0] : [0, 0, 255]) : [0, 255, 0];
      raw.set([...rgb, x >= 30 ? 0 : 255], y * (1 + width * 4) + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @returns {Promise<Uint8Array>} the page, as a PDF */
export async function picturedPage() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const picture = await document.embedPng(quadrantPng());
  page.drawText(ABOVE, { x: 50, y: 700, size: 11, font });
  // 200 × 100 pt whose top edge is 132 pt below the page's top: PDF y 560 + 100 = 660, and 792 − 660 = 132.
  page.drawImage(picture, { x: 50, y: 560, width: 200, height: 100 });
  page.drawText(BELOW, { x: 50, y: 520, size: 11, font });
  page.drawText('Right column text that is separate', { x: 330, y: 700, size: 11, font });
  page.drawImage(picture, { x: 400, y: 400, width: 100, height: 50, rotate: degrees(90) });
  return await document.save();
}
