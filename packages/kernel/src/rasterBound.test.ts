import { PDFDocument } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { enhancedPages } from './pageEnhance.js';
import { straightenedPages } from './pageScan.js';
import { SKEW_DPI, greyRasterOfPage } from './pageSkew.js';
import { MAX_SNAPSHOT_PIXELS, imageWithinPixelBound, scaleWithinPixelBound } from './pageSnapshot.js';

/**
 * Every raster the engine host makes stays within its pixel bound (CR-NAT-06).
 *
 * OCR, deskew, Enhance and Straighten rasterised with no bound at all, so a page or an image large enough asked the
 * host for an allocation that ends it. A raster at a scale of the host's own choosing is now taken at the largest
 * scale within the bound; an image a command must keep every pixel of is left as it is when it is past it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** A flat grey JPEG of `side` × `side` pixels: past the bound at 6000, a file of a few kilobytes. */
function squareJpeg(side: number): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, side, side], false);
  pixmap.clear(200);
  const jpeg = new Uint8Array(pixmap.asJPEG(50, false));
  pixmap.destroy();
  return jpeg;
}

/** One page drawing `jpeg` over the whole of it. */
async function pageShowing(jpeg: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.drawImage(await document.embedJpg(jpeg), { x: 0, y: 0, width: 612, height: 792 });
  return document.save();
}

describe('the scale a raster is taken at', () => {
  it('is the scale asked for when the raster is within the bound', () => {
    expect(scaleWithinPixelBound(612, 792, 2)).toBe(2);
  });

  it('is the largest scale within the bound, counted rounded UP, when it is not', () => {
    const side = 20_000;
    const scale = scaleWithinPixelBound(side, side, 3);
    const pixels = Math.ceil(side * scale) ** 2;
    expect(pixels).toBeLessThanOrEqual(MAX_SNAPSHOT_PIXELS);
    // AND NOT NEEDLESSLY SMALL: within a tenth of a percent of the bound.
    expect(pixels).toBeGreaterThan(MAX_SNAPSHOT_PIXELS * 0.999);
  });

  it('CONTROL: the square root of the ratio alone admits a raster past the bound', () => {
    // The rule two modules spelt for themselves before this one: for a square, side × scale is √32 000 000 = 5656.85,
    // which a rasteriser rounds up to 5657 pixels a side.
    const side = 1000;
    const bare = Math.sqrt(MAX_SNAPSHOT_PIXELS / (side * side));
    expect(Math.ceil(side * bare) ** 2).toBeGreaterThan(MAX_SNAPSHOT_PIXELS);
    expect(Math.ceil(side * scaleWithinPixelBound(side, side, 100)) ** 2).toBeLessThanOrEqual(MAX_SNAPSHOT_PIXELS);
  });

  it('an image is within the bound by its own size', () => {
    expect(imageWithinPixelBound({ getWidth: () => 5000, getHeight: () => 6400 })).toBe(true);
    expect(imageWithinPixelBound({ getWidth: () => 5000, getHeight: () => 6401 })).toBe(false);
  });
});

describe('deskew reads a page too large for its resolution at a smaller one', () => {
  it('rasterises a 20 000-point page within the bound, where its own resolution would be past it', () => {
    const document = new mupdf.PDFDocument();
    document.insertPage(-1, document.addPage([0, 0, 20_000, 20_000], 0, document.newDictionary(), ''));
    try {
      // CONTROL, the premise: at `SKEW_DPI` this page is far past the bound, so the case could fail.
      expect(Math.ceil((20_000 * SKEW_DPI) / 72) ** 2).toBeGreaterThan(MAX_SNAPSHOT_PIXELS);
      const raster = greyRasterOfPage(document.loadPage(0));
      expect(raster.width * raster.height).toBeLessThanOrEqual(MAX_SNAPSHOT_PIXELS);
      expect(raster.width).toBeGreaterThan(5000);
    } finally {
      document.destroy();
    }
  });
});

describe('Enhance and Straighten leave an image past the bound as it is', () => {
  it('Enhance skips it and counts it, and never decodes it', async () => {
    const session = await mupdfWriter.open(await pageShowing(squareJpeg(6000)));
    try {
      // THE DECISION, not the end state: a decode that ran and then failed would also count a skip.
      const decodes = vi.spyOn(mupdf.Image.prototype, 'toPixmap');
      expect(await enhancedPages(session, { kind: 'enhancePages', pages: [0] })).toStrictEqual([
        { page: 0, enhanced: 0, skipped: 1 },
      ]);
      expect(decodes).not.toHaveBeenCalled();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('Straighten answers that it is too large, and never decodes it', async () => {
    const session = await mupdfWriter.open(await pageShowing(squareJpeg(6000)));
    try {
      const decodes = vi.spyOn(mupdf.Image.prototype, 'toPixmap');
      expect(await straightenedPages(session, { kind: 'straightenScans', pages: [0] })).toStrictEqual([
        { page: 0, outcome: 'too-large' },
      ]);
      expect(decodes).not.toHaveBeenCalled();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: an image within the bound is decoded by both', async () => {
    const session = await mupdfWriter.open(await pageShowing(squareJpeg(600)));
    try {
      const decodes = vi.spyOn(mupdf.Image.prototype, 'toPixmap');
      await enhancedPages(session, { kind: 'enhancePages', pages: [0] });
      await straightenedPages(session, { kind: 'straightenScans', pages: [0] });
      expect(decodes).toHaveBeenCalledTimes(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
