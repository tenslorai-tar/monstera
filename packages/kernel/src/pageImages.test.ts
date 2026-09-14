import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { MAX_SNAPSHOT_SCALE, MIN_SNAPSHOT_SCALE } from '@monstera/contract';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { type PageImageRequest, rasterisePageImage } from './pageImages.js';
import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';

/**
 * A whole page, rasterised and encoded.
 *
 * ## Colours are COUNTED over the decoded image, never sampled at a point
 *
 * The scratch probe behind this row read one pixel at the annotation's PDF
 * coordinates and got white in every mode, because MuPDF's annotation rectangle
 * is top-down — a point sample in the wrong frame reads exactly like *not
 * drawn*. A count of a colour nothing else on the page has does not depend on
 * which way y runs.
 *
 * ## The size is read from the file's own header
 *
 * `pngSize` reads IHDR, so a claim about dimensions does not rest on the writer
 * that produced them.
 */

const DEFAULTS = { format: 'png', scale: 1, quality: 90 } as const;

/** A `width`×`height` page with one BLUE 60×60 square of content. */
async function contentPage(width = 200, height = 100, rotate?: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  page.drawRectangle({ x: 10, y: 10, width: 60, height: 60, color: rgb(0, 0, 1) });
  if (rotate !== undefined) page.node.set(page.node.context.obj('Rotate'), page.node.context.obj(rotate));
  return await document.save({ useObjectStreams: false });
}

/** {@link contentPage} with a RED Square annotation carrying an appearance, made by MuPDF. */
function annotatedPage(): Uint8Array {
  const document = new mupdf.PDFDocument();
  try {
    const resources = document.addObject(document.newDictionary());
    document.insertPage(-1, document.addPage([0, 0, 200, 200], 0, resources, '0 0 1 rg 10 10 60 60 re f'));
    const page = document.loadPage(0);
    const square = page.createAnnotation('Square');
    square.setRect([120, 20, 180, 80]);
    square.setColor([1, 0, 0]);
    square.setInteriorColor([1, 0, 0]);
    square.update();
    return document.saveToBuffer('').asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

async function onSession<T>(bytes: Uint8Array, work: (session: MupdfSession) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

async function image(bytes: Uint8Array, request: Partial<PageImageRequest> = {}): Promise<ByteImage> {
  return await onSession(bytes, (session) =>
    rasterisePageImage(session, { page: 0, ...DEFAULTS, ...request }),
  );
}

function pngSize(png: ByteImage): readonly [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/** How many pixels of the decoded image are close to `[r, g, b]`. */
function countOf(encoded: ByteImage, [r, g, b]: readonly [number, number, number]): number {
  const pixmap = new mupdf.Image(encoded).toPixmap();
  try {
    const pixels = pixmap.getPixels();
    const n = pixmap.getNumberOfComponents();
    let count = 0;
    for (let i = 0; i < pixels.length; i += n) {
      const near = (value: number | undefined, want: number): boolean =>
        value !== undefined && Math.abs(value - want) < 60;
      if (near(pixels[i], r) && near(pixels[i + 1], g) && near(pixels[i + 2], b)) count += 1;
    }
    return count;
  } finally {
    pixmap.destroy();
  }
}

describe('rasterisePageImage', () => {
  it('writes a PNG the size of the page at the scale asked for', async () => {
    const png = await image(await contentPage(), { scale: 2 });

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(png)).toEqual([400, 200]);
    // THE CONTENT IS THERE, and exactly the content: 60 points square at scale 2.
    expect(countOf(png, [0, 0, 255])).toBe(120 * 120);
  });

  it('turns the image with the page’s /Rotate', async () => {
    // A 200×100 page turned a quarter is a 100×200 picture. An export that
    // rasterised the MediaBox and ignored /Rotate would answer 200×100.
    expect(pngSize(await image(await contentPage(200, 100, 90)))).toEqual([100, 200]);
  });

  it('draws the page’s annotations, as the page looks', async () => {
    const png = await image(annotatedPage());

    expect(countOf(png, [255, 0, 0])).toBeGreaterThan(50 * 50);
    // CONTROL: the content square, so a blank image cannot pass for one that
    // simply lacks the annotation.
    expect(countOf(png, [0, 0, 255])).toBe(60 * 60);
  });

  it('writes a JPEG, and the quality reaches the encoder', async () => {
    const bytes = await contentPage();
    const high = await image(bytes, { format: 'jpeg', quality: 95 });
    const low = await image(bytes, { format: 'jpeg', quality: 5 });

    expect([...high.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // A quality that went nowhere would make these the same file.
    expect(high.length).toBeGreaterThan(low.length);
    expect(countOf(high, [0, 0, 255])).toBeGreaterThan(55 * 55);
  });

  describe('refuses', () => {
    it('a page the document does not have', async () => {
      await expect(image(await contentPage(), { page: 1 })).rejects.toThrow(/outside this document/u);
    });

    it('a scale outside the bounds, at both ends', async () => {
      const bytes = await contentPage();
      await expect(image(bytes, { scale: MIN_SNAPSHOT_SCALE - 0.01 })).rejects.toThrow(/scale/u);
      await expect(image(bytes, { scale: MAX_SNAPSHOT_SCALE + 0.01 })).rejects.toThrow(/scale/u);
      // CONTROL: the bounds themselves are admitted.
      await expect(image(bytes, { scale: MIN_SNAPSHOT_SCALE })).resolves.toBeDefined();
    });

    it('a quality outside 1–100', async () => {
      const bytes = await contentPage();
      await expect(image(bytes, { format: 'jpeg', quality: 0 })).rejects.toThrow(/quality/u);
      await expect(image(bytes, { format: 'jpeg', quality: 101 })).rejects.toThrow(/quality/u);
      await expect(image(bytes, { format: 'jpeg', quality: 50.5 })).rejects.toThrow(/quality/u);
    });

    it('an A4 page at the top scale, naming the pixel count', async () => {
      // 595.28×841.89 at scale 8, rounded up: 4763×6736 = 32,083,568.
      const a4 = await contentPage(595.28, 841.89);
      await expect(image(a4, { scale: MAX_SNAPSHOT_SCALE })).rejects.toThrow(
        new RegExp(`32083568 pixels, past the ${String(MAX_SNAPSHOT_PIXELS)}`, 'u'),
      );
    });

    it('a page that displays no region', async () => {
      const document = await PDFDocument.create();
      const page = document.addPage([200, 100]);
      page.node.set(page.node.context.obj('MediaBox'), page.node.context.obj([0, 0, 200]));
      const bytes = await document.save({ useObjectStreams: false });

      await expect(image(bytes)).rejects.toThrow(/displays no region/u);
    });
  });
});
