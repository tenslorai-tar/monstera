import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PageSet } from '@monstera/contract/host';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { composeWordDocument, drawPagePictures } from './wordPictures.js';

/**
 * The Word export's pictures on the real engine (ADR-0072's amendment of 2026-10-01).
 *
 * The page is the one the amendment was measured on: two columns, a picture between the left column's two
 * paragraphs, the same picture rotated 90° in the right column, and a PNG whose right quarter is transparent. The
 * pictures are decoded by `sharp` — libvips, not the MuPDF that drew them — and every colour is one only that
 * quadrant has.
 */

/** A CRC-32 for PNG chunks, table-free: the fixture's PNG is built here so nothing about it is MuPDF's. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 40 × 20 RGBA: top-left red, top-right blue, bottom green; columns 30–39 fully transparent. */
function quadrantPng(): Uint8Array {
  const width = 40;
  const height = 20;
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = y < height / 2 ? (x < width / 2 ? [255, 0, 0] : [0, 0, 255]) : [0, 255, 0];
      raw.set([r, g, b, x >= 30 ? 0 : 255], row + 1 + x * 4);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const ABOVE = 'Left column paragraph above the picture';
const BELOW = 'Left column paragraph below the picture';
const RIGHT = 'Right column text that is separate';

async function picturedPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const picture = await document.embedPng(quadrantPng());
  page.drawText(ABOVE, { x: 50, y: 700, size: 11, font });
  // 200 × 100 pt with its top-left 132 pt down the page: PDF y 560 is 792 − 560 − 100 = 132 from the top.
  page.drawImage(picture, { x: 50, y: 560, width: 200, height: 100 });
  page.drawText(BELOW, { x: 50, y: 520, size: 11, font });
  page.drawText(RIGHT, { x: 330, y: 700, size: 11, font });
  page.drawImage(picture, { x: 400, y: 400, width: 100, height: 50, rotate: degrees(90) });
  return await document.save();
}

async function composed(
  session: MupdfSession,
  mode: 'text' | 'layout' | 'rich',
  pages: PageSet = [0],
): Promise<{
  readonly files: Record<string, Uint8Array>;
  readonly xml: string;
  readonly pictures: number;
}> {
  const { chunks, pictures } = composeWordDocument(session, mode, pages);
  const parts: Uint8Array[] = [];
  for await (const part of chunks) parts.push(part);
  const files = unzipSync(Buffer.concat(parts));
  return { files, xml: strFromU8(files['word/document.xml'] ?? new Uint8Array()), pictures: pictures() };
}

/** RGBA at a fraction of the picture's width and height, decoded by libvips. */
async function sampled(png: Uint8Array): Promise<(fx: number, fy: number) => readonly number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return (fx, fy) => {
    const x = Math.min(info.width - 1, Math.floor(info.width * fx));
    const y = Math.min(info.height - 1, Math.floor(info.height * fy));
    const at = (y * info.width + x) * 4;
    return [...data.subarray(at, at + 4)];
  };
}

describe('composeWordDocument — pictures, on the native engine', () => {
  let session: MupdfSession;
  beforeAll(async () => {
    session = await mupdfWriter.open(await picturedPage());
  });

  it('RICH: the picture sits between the two paragraphs it sits between on the page', async () => {
    const { xml, pictures } = await composed(session, 'rich');

    expect(pictures).toBe(2);
    const above = xml.indexOf(ABOVE);
    const first = xml.indexOf('r:embed="rIdImage1"');
    const below = xml.indexOf(BELOW);
    expect(above).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(above);
    expect(below).toBeGreaterThan(first);
  });

  it('the picture is ITS PIXELS: each quadrant its colour, and the transparent band transparent', async () => {
    const { files } = await composed(session, 'rich');
    const at = await sampled(files['word/media/image1.png'] ?? new Uint8Array());

    expect(at(0.1, 0.1)).toStrictEqual([255, 0, 0, 255]);
    expect(at(0.6, 0.1)).toStrictEqual([0, 0, 255, 255]);
    expect(at(0.1, 0.9)).toStrictEqual([0, 255, 0, 255]);
    // The soft mask carried as alpha: `toPixmap` alone drew this band opaque (measured 2026-10-01).
    expect(at(0.95, 0.5)[3]).toBe(0);
  });

  it('a ROTATED picture arrives turned as the page shows it, not as the image stores it', async () => {
    const { files } = await composed(session, 'rich');
    const at = await sampled(files['word/media/image2.png'] ?? new Uint8Array());

    // Turned 90° anticlockwise: the image's right edge (the transparent band) is now its top, its top row (red then
    // blue) runs up the left side, and its green bottom half is the right-hand side.
    expect(at(0.5, 0.05)[3]).toBe(0);
    expect(at(0.1, 0.9)).toStrictEqual([255, 0, 0, 255]);
    expect(at(0.9, 0.9)).toStrictEqual([0, 255, 0, 255]);
  });

  it('LAYOUT: anchored at its box on the page, in EMU from the page corner', async () => {
    const { xml } = await composed(session, 'layout');

    expect(xml).toContain(
      '<wp:positionH relativeFrom="page"><wp:posOffset>635000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>1676400</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="2540000" cy="1270000"/>',
    );
  });

  it('TEXT: the words only — CONTROL for the cases above, the same page with no picture read', async () => {
    const { files, xml, pictures } = await composed(session, 'text');

    expect(xml).toContain(ABOVE);
    expect(pictures).toBe(0);
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(false);
  });

  it('writes ONLY the chosen pages, in the set’s order, and refuses a page past the document (ADR-0161)', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const word of ['PAGEONE', 'PAGETWO', 'PAGETHREE']) {
      document.addPage([612, 792]).drawText(word, { x: 72, y: 700, size: 14, font });
    }
    const three = await mupdfWriter.open(await document.save());

    const { xml } = await composed(three, 'text', [2, 0]);
    expect(xml).toContain('PAGETHREE');
    expect(xml).toContain('PAGEONE');
    expect(xml.indexOf('PAGETHREE')).toBeLessThan(xml.indexOf('PAGEONE'));
    // THE PAGE NOT CHOSEN is not in the package.
    expect(xml).not.toContain('PAGETWO');
    // CONTROL: the same document with every page carries the one left out above.
    expect((await composed(three, 'text', [[0, 2]])).xml).toContain('PAGETWO');

    await expect(composed(three, 'text', [3])).rejects.toThrow();
  });

  it('a place the picture read cannot find is REFUSED, never drawn as something else', async () => {
    await expect(drawPagePictures(session, 0, [{ after: 0, printed: { x: 1, y: 2, w: 3, h: 4 } }])).rejects.toThrow(
      /placed a picture at .* and the picture read found none there \(it found 2\)/u,
    );
  });
});
