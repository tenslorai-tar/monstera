import { crc32, deflateSync } from 'node:zlib';

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { type EmbeddableImageType, MAX_PAGE_COORDINATE } from '@monstera/contract';

import { ImageDecodeRefused, PngPixelsRefused } from './imageDimensions.js';
import { addImagePage } from './pageImage.js';

/**
 * A page made from an image, read back through a **different parser** than the
 * one that wrote it.
 *
 * ## The fixture is GENERATED, not pasted
 *
 * B10 forbids an unvetted fixture, and a base64 PNG copied from somewhere is
 * exactly that: bytes nobody in this repository can account for, in a public
 * tree. {@link pngOf} builds one from its own dimensions using Node's own
 * `deflateSync` and `crc32`, so every byte is derived here and a case can ask
 * for any size it needs — which is what the page-size assertions turn on.
 *
 * ## What separates a real insert from a plausible one
 *
 * Three things, and each has a case because each fails silently on its own: the
 * page **count** goes up, the new page is at the **index the command named**,
 * and the page is the **image's size** rather than the document's. An
 * implementation that appended a correctly-sized page satisfies the first and
 * third; one that inserted a blank page of the right size satisfies all but the
 * XObject case.
 */

/** A solid-colour truecolour PNG of the given size, built byte by byte. */
function pngOf(width: number, height: number): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    // `charCodeAt` per index rather than spreading the string: a chunk type is
    // four ASCII bytes by PNG's own definition, and spreading yields code
    // points, which is the wrong unit for a byte array even where the two agree.
    const name = new Uint8Array(type.length);
    for (let at = 0; at < type.length; at += 1) name[at] = type.charCodeAt(at);
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set(name, 4);
    out.set(body, 8);
    // THE CRC COVERS TYPE AND BODY, not the length — PNG's own rule, and
    // getting it wrong produces a file every decoder refuses, which would make
    // every case here report `unreadable` for a reason nothing names.
    const covered = new Uint8Array(4 + body.length);
    covered.set(name, 0);
    covered.set(body, 4);
    view.setUint32(8 + body.length, crc32(Buffer.from(covered)));
    return out;
  };

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour, so three bytes a pixel and no palette to build
  // compression, filter and interlace are all 0, which the array already is.

  // Each scanline carries a leading FILTER BYTE of 0 — "none". A raster with
  // the filter bytes omitted decodes as an image one byte narrower per row and
  // progressively skewed, which renders and is wrong.
  const raster = new Uint8Array(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      raster[start + 1 + x * 3] = 0xc0;
      raster[start + 2 + x * 3] = 0x30;
      raster[start + 3 + x * 3] = 0x30;
    }
  }

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raster)))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** Three pages of a known, deliberately non-square size. */
const PAGE_WIDTH = 200;
const PAGE_HEIGHT = 300;
const PAGE_COUNT = 3;

async function threePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) {
    document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }
  // PINNED, so a reproducibility reading cannot come out right by accident —
  // `pageWatermark.test.ts`'s fixture and its reason. `PDFDocument.create`
  // stamps today's date, and two runs inside one clock tick then produce the
  // same `/ModDate` whether or not the command preserves it.
  document.setModificationDate(new Date(Date.UTC(2001, 0, 2, 3, 4, 5)));
  return document.save();
}

/** The image size every case uses — different from the page size on both axes. */
const IMAGE_WIDTH = 64;
const IMAGE_HEIGHT = 40;

/** `addImagePage` on the three-page fixture at `at`, saved: what a composition makes of one picture. */
async function insert(
  at: number,
  bytes: Uint8Array = pngOf(IMAGE_WIDTH, IMAGE_HEIGHT),
  mediaType: EmbeddableImageType = 'image/png',
): Promise<Uint8Array> {
  const document = await PDFDocument.load(await threePages(), { updateMetadata: false });
  await addImagePage(document, bytes, mediaType, at);
  return document.save();
}

/** Every page's size, as pdf-lib reads them back. */
async function sizesOf(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getSize());
}

/** Whether a page carries at least one image XObject. */
async function hasImage(bytes: Uint8Array, page: number): Promise<boolean> {
  const document = await PDFDocument.load(bytes);
  const node = document.getPages()[page]?.node;
  if (node === undefined) throw new Error(`the document has no page ${String(page)}`);
  const resources = node.Resources();
  const xobjects = resources?.get(PDFName.of('XObject'));
  if (xobjects === undefined) return false;
  const dictionary = document.context.lookup(xobjects);
  if (dictionary === undefined || !('entries' in dictionary)) return false;
  return (dictionary as { entries: () => unknown[] }).entries().length > 0;
}

describe('addImagePage', () => {
  it('INSERTS AT THE INDEX IT IS GIVEN, rather than appending', async () => {
    // THE CASE THE MODULE EXISTS FOR, and the one an `addPage` implementation
    // fails. Appending produces a document with the same page count and the
    // same new page, and every size assertion below still passes — only WHERE
    // it landed separates them, so the index chosen is a middle one.
    const after = await insert(1);
    const sizes = await sizesOf(after);

    expect(sizes).toHaveLength(PAGE_COUNT + 1);
    expect(sizes[1]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
    // AND THE ORIGINAL PAGES ARE STILL THEIR OWN SIZE, on both sides of it.
    expect(sizes[0]).toStrictEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(sizes[2]).toStrictEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  });

  it('CARRIES THE IMAGE, not just a page of the right size', async () => {
    // The separating case for *inserted a blank page and called it done*: a
    // blank page of the image's dimensions satisfies every size assertion
    // above, and only the XObject says a picture is on it.
    const after = await insert(0);

    expect(await hasImage(after, 0)).toBe(true);
    // CONTROL: a page this did not touch carries none, so the check
    // above is not one that answers `true` for any page.
    expect(await hasImage(after, 1)).toBe(false);
  });

  it('takes the IMAGE’s size and not the document’s', async () => {
    // A page sized to its neighbours would letterbox or crop the scan, and both
    // are decisions this has no basis for. The fixture's page and image
    // differ on both axes so neither can pass by coincidence.
    const after = await insert(3);
    const sizes = await sizesOf(after);

    expect(sizes[3]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  });

  it('scales an image past the format’s page limit down to it, keeping its shape', async () => {
    // PDF 32000-1 Annex C.2 bounds a page side at 14,400 points, and one pixel is one
    // point. So a PNG 14,401 pixels wide made a non-conforming page until 2026-09-13.
    // One row of pixels keeps the fixture small; the height scales by the same factor.
    const wide = MAX_PAGE_COORDINATE + 1;
    const after = await insert(0, pngOf(wide, 2));
    const [page] = await sizesOf(after);

    expect(page?.width).toBe(MAX_PAGE_COORDINATE);
    expect(page?.height).toBeCloseTo((2 * MAX_PAGE_COORDINATE) / wide, 6);
  });

  it('CLAMPS an index past the end rather than refusing it', async () => {
    // `at` is *where the new page goes*, and the one value past the end a
    // caller can name is the position after the last page — a real request.
    const after = await insert(99);
    const sizes = await sizesOf(after);

    expect(sizes).toHaveLength(PAGE_COUNT + 1);
    expect(sizes[PAGE_COUNT]).toStrictEqual({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT });
  });

  it('REFUSES bytes that are not the image they claim to be', async () => {
    // The decoder is the validation, which is why the picker's extension filter
    // is only a hint. A `.png` a user renamed reaches here and pdf-lib throws,
    // named as the picture's refusal.
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    // AS A JPEG, whose header the decoder reads: a PNG this short is refused by the pixel check first, below.
    await expect(insert(0, notAnImage, 'image/jpeg')).rejects.toBeInstanceOf(ImageDecodeRefused);
  });
});

describe('THE PIXEL BOUND, held before the decoder runs in main', () => {
  /** A PNG header claiming `width × height`, with no image data at all. */
  function headerOnly(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    bytes.set([8, 2, 0, 0, 0], 24);
    return bytes;
  }

  it('refuses a PNG whose header claims 12,000 × 12,000 as TOO-MANY-PIXELS, not as unreadable', async () => {
    // THE DECISION IS THE ASSERTION. With no image data, `embedPng` would refuse these
    // bytes too — as a decode error. Only the pixel check answers `PngPixelsRefused`
    // with this reason, so a build without it fails here.
    const refusal = insert(0, headerOnly(12_000, 12_000));
    await expect(refusal).rejects.toBeInstanceOf(PngPixelsRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'too-many-pixels' });
  });

  it('CONTROL: a small header with no data is refused by the DECODER, not the pixel check', async () => {
    const refusal = insert(0, headerOnly(IMAGE_WIDTH, IMAGE_HEIGHT));
    await expect(refusal).rejects.toThrow();
    await expect(refusal).rejects.not.toBeInstanceOf(PngPixelsRefused);
  });
});
