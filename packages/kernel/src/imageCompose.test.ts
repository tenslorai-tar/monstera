import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { MAX_IMPORT_IMAGE_PIXELS, MAX_PAGE_COORDINATE } from '@monstera/contract';

import { ComposeRefused } from './composeOutcome.js';
import { type ImportImage, composeImages } from './imageCompose.js';

/**
 * Picked images made into pages, read back through pdf-lib's own loader.
 *
 * ## The fixtures are HEADERS, built here
 *
 * B10's reason, `pageImage.test.ts`' approach: every byte is derived in this file. A
 * JPEG needs only its start-of-frame for `embedJpg`, which reads the size and carries
 * the rest, so a twenty-byte JPEG makes a real page of any size. A PNG built from a
 * header alone is one no decoder accepts — which is what makes it the separating
 * fixture for the pixel bound: refused as `too-many-pixels`, the bound ran first;
 * refused as `image-unreadable`, the decoder did.
 */

/** A baseline JPEG's start-of-image, start-of-frame for three components, and end. */
function jpegOf(width: number, height: number): Uint8Array {
  return Uint8Array.of(
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  );
}

/** A PNG signature and an `IHDR` stating a size, and nothing a decoder could use. */
function pngHeaderOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

/** Images that record every read, so a case can say what was read and when. */
function recorded(
  sources: readonly { readonly mediaType: ImportImage['mediaType']; readonly bytes: Uint8Array }[],
): { readonly images: ImportImage[]; readonly reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    images: sources.map((source, index) => ({
      mediaType: source.mediaType,
      read: () => {
        reads.push(index + 1);
        return Promise.resolve(source.bytes);
      },
    })),
  };
}

async function sizesOf(pdf: Uint8Array): Promise<{ width: number; height: number }[]> {
  return (await PDFDocument.load(pdf)).getPages().map((page) => page.getSize());
}

describe('composeImages', () => {
  it('makes one page per image, IN THE ORDER GIVEN, each its image’s size', async () => {
    // THREE DIFFERENT SIZES, so a composition that reordered or sized every page alike
    // fails on the page it moved.
    const { images } = recorded([
      { mediaType: 'image/jpeg', bytes: jpegOf(300, 200) },
      { mediaType: 'image/jpeg', bytes: jpegOf(100, 400) },
      { mediaType: 'image/jpeg', bytes: jpegOf(50, 60) },
    ]);

    const composed = await composeImages(images);
    expect(await sizesOf(composed.pdf)).toStrictEqual([
      { width: 300, height: 200 },
      { width: 100, height: 400 },
      { width: 50, height: 60 },
    ]);
    expect(composed.skipped).toStrictEqual([]);
  });

  it('scales a page past the format’s limit down to it, keeping the picture’s shape', async () => {
    // A 20,000 × 10,000 picture at one point a pixel is a page no conforming reader need
    // open. CONTROL: the 50 × 60 image in the same document is not scaled at all.
    const { images } = recorded([
      { mediaType: 'image/jpeg', bytes: jpegOf(20_000, 10_000) },
      { mediaType: 'image/jpeg', bytes: jpegOf(50, 60) },
    ]);

    expect(await sizesOf((await composeImages(images)).pdf)).toStrictEqual([
      { width: MAX_PAGE_COORDINATE, height: MAX_PAGE_COORDINATE / 2 },
      { width: 50, height: 60 },
    ]);
  });

  it('LEAVES OUT a PNG past the per-image bound BEFORE any decoder runs, naming it, and makes the rest pages', async () => {
    // THE DECISION IS THE ORDER. A header-only PNG is refused by the decoder too, so a
    // composer that decoded first would name `image-unreadable`. The reads say the PNG
    // was read once, for its header, and never handed to a decoder.
    const side = Math.ceil(Math.sqrt(MAX_IMPORT_IMAGE_PIXELS)) + 1;
    const { images, reads } = recorded([
      { mediaType: 'image/jpeg', bytes: jpegOf(10, 10) },
      { mediaType: 'image/png', bytes: pngHeaderOf(side, side) },
    ]);

    const composed = await composeImages(images);
    expect(composed.skipped).toStrictEqual([{ reason: 'too-many-pixels', line: null, item: 2 }]);
    expect(await sizesOf(composed.pdf)).toStrictEqual([{ width: 10, height: 10 }]);
    expect(reads).toStrictEqual([2, 1]);
  });

  it('leaves out the image that takes a SET past the total bound, and keeps a smaller one after it', async () => {
    // EIGHTY MEGAPIXELS EACH, every one under the per-image bound: only the running
    // total can leave out the third. The fourth is small and still fits.
    const { images } = recorded([
      { mediaType: 'image/png', bytes: pngHeaderOf(10_000, 8_000) },
      { mediaType: 'image/png', bytes: pngHeaderOf(10_000, 8_000) },
      { mediaType: 'image/png', bytes: pngHeaderOf(10_000, 8_000) },
      { mediaType: 'image/jpeg', bytes: jpegOf(20, 20) },
    ]);

    // THE HEADERS DECODE TO NOTHING, so 1 and 2 are left out by the decoder: the case is about which reason 3 gets.
    const composed = await composeImages(images);
    expect(composed.skipped).toStrictEqual([
      { reason: 'image-unreadable', line: null, item: 1 },
      { reason: 'image-unreadable', line: null, item: 2 },
      { reason: 'too-many-pixels', line: null, item: 3 },
    ]);
    expect(await sizesOf(composed.pdf)).toStrictEqual([{ width: 20, height: 20 }]);
  });

  it('leaves out bytes routed as PNG with no PNG header, and bytes the decoder refuses, by position', async () => {
    const noHeader = recorded([
      { mediaType: 'image/jpeg', bytes: jpegOf(10, 10) },
      { mediaType: 'image/png', bytes: jpegOf(10, 10) },
    ]);
    expect((await composeImages(noHeader.images)).skipped).toStrictEqual([{ reason: 'image-unreadable', line: null, item: 2 }]);

    // A HEADER THE BOUND ACCEPTS AND A DECODER DOES NOT, beside one it takes: left out in the second pass.
    const undecodable = recorded([
      { mediaType: 'image/png', bytes: pngHeaderOf(10, 10) },
      { mediaType: 'image/jpeg', bytes: jpegOf(30, 40) },
    ]);
    const composed = await composeImages(undecodable.images);
    expect(composed.skipped).toStrictEqual([{ reason: 'image-unreadable', line: null, item: 1 }]);
    expect(await sizesOf(composed.pdf)).toStrictEqual([{ width: 30, height: 40 }]);
  });

  it('CONTROL: a set with NO image that can be a page is refused, naming the first, rather than an empty PDF', async () => {
    const undecodable = recorded([{ mediaType: 'image/png', bytes: pngHeaderOf(10, 10) }]);
    const refusal = composeImages(undecodable.images);
    await expect(refusal).rejects.toBeInstanceOf(ComposeRefused);
    await expect(refusal).rejects.toMatchObject({ reason: 'image-unreadable', item: 1 });
    // Read once for its header and once to decode.
    expect(undecodable.reads).toStrictEqual([1, 1]);
  });

  it('CONTROL: a read that FAILS is not a refusal — it propagates as itself', async () => {
    // The bytes not arriving is the transport's, and the handler answers `asset-missing`
    // for it. A composer that caught it would tell a person their picture was broken.
    const gone = new Error('the file went');
    const images: ImportImage[] = [{ mediaType: 'image/jpeg', read: () => Promise.reject(gone) }];
    await expect(composeImages(images)).rejects.toBe(gone);
  });

  it('is reproducible: the same images make the same bytes', async () => {
    const make = async () => (await composeImages(recorded([{ mediaType: 'image/jpeg', bytes: jpegOf(40, 30) }]).images)).pdf;
    expect(await make()).toStrictEqual(await make());
  });
});
