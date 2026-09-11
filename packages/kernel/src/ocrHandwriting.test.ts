import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { detokenise, rasteriseRegion } from './ocrHandwriting.js';

/**
 * The two halves of the handwriting engine that can be checked **without the
 * models**, and they are the two that have already been wrong.
 *
 * ## 1. The raster, which is where the worst failure lives
 *
 * Measured while writing the spike: composing the page's own ctm into the matrix
 * handed to `page.run` applies it twice, which puts the ink outside the pixmap.
 * The raster comes back a white square — and TrOCR answers a white square with a
 * **fluent sentence at high token probability**, not with an empty string.
 *
 * That is worse than the reassuring answer this project usually hunts: it is a
 * convincing one. Nothing downstream could have caught it, because a confident
 * line of text is exactly what a working recognition produces.
 *
 * So the case is on the tensor rather than on the recognition, which also makes
 * it free: ink normalises towards −1 and paper towards +1, so *did anything get
 * drawn* is one `Math.min` and needs no 67 MB download.
 *
 * ## 2. The detokeniser, whose family differs between the two model sizes
 *
 * `small` is `Unigram` with a `Metaspace` decoder and `base` is `BPE` with a
 * `ByteLevel` one — measured per repository on 2026-09-11, and not a detail: the
 * spike's first detokeniser assumed the wrong family and printed an **empty
 * string**, which on an OCR feature is a product answer meaning *this image has
 * no text*.
 */

const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 300;

/** Where the line is drawn, and the two regions the cases read. */
const INK_REGION = [30, 180, 370, 230] as const;
/** Well clear of the line, on the same page — the control's whole point. */
const BLANK_REGION = [30, 40, 370, 90] as const;

let inked: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText('Monstera deliciosa', {
    x: 40,
    y: 195,
    size: 26,
    font: await document.embedFont(StandardFonts.Helvetica),
  });
  inked = await document.save();
});

/** The darkest value in a region's tensor: −1 is black, +1 is white. */
async function darkest(bytes: Uint8Array, region: readonly [number, number, number, number]) {
  const session = await mupdfWriter.open(bytes);
  try {
    const raster = await rasteriseRegion(session, 0, region);
    let low = Number.POSITIVE_INFINITY;
    for (const value of raster.pixels) low = Math.min(low, value);
    return { low, side: raster.side };
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('the handwriting region raster', () => {
  it('DRAWS THE INK, which a double-applied page transform does not', async () => {
    const { low, side } = await darkest(inked, INK_REGION);
    // A WHITE SQUARE HAS NO VALUE BELOW +1. This is the defect that shipped in
    // the spike and answered a whole sentence anyway.
    expect(low).toBeLessThan(-0.5);
    expect(side).toBe(384);
  });

  it('CONTROL: an empty region of the SAME page is white, so the case above reads the region', async () => {
    // Without this, "there is ink" would pass for a raster that quietly drew the
    // whole page into the square — the region ignored, the answer still dark.
    const { low } = await darkest(inked, BLANK_REGION);
    expect(low).toBeGreaterThan(0.9);
  });

  it('reads the region on a ROTATED page, where the ctm carries the turn', async () => {
    // The region arrives in PDF user space and `getTransform()` is what accounts
    // for `/Rotate` — the same fix FFFFFF-1 made one engine along. A build that
    // ignored the ctm would rasterise somewhere else entirely and come back
    // white, which is indistinguishable from a blank page without this case.
    const document = await PDFDocument.load(inked);
    document.getPages()[0]?.setRotation(degrees(90));
    const { low } = await darkest(await document.save(), INK_REGION);
    expect(low).toBeLessThan(-0.5);
  });

  it('refuses a region with no area rather than rasterising nothing', async () => {
    const session = await mupdfWriter.open(inked);
    try {
      await expect(rasteriseRegion(session, 0, [100, 100, 100, 200])).rejects.toThrow(
        /has no area/u,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page the document does not have', async () => {
    const session = await mupdfWriter.open(inked);
    try {
      await expect(rasteriseRegion(session, 7, INK_REGION)).rejects.toThrow(
        /Page 7 is outside this document/u,
      );
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('the detokeniser', () => {
  it('joins Unigram pieces and turns the metaspace into a space', () => {
    // The pieces the spike actually got back, which is why this fixture is these
    // and not something tidier: `deliciosa` arrives split across two tokens with
    // the space marker only on the first.
    expect(detokenise(['▁Mon', 'ster', 'a', '▁delicious', 'a'], 'unigram-metaspace')).toBe(
      'Monstera deliciousa',
    );
  });

  it('maps ByteLevel pieces back to bytes and reads them as UTF-8', () => {
    // `Ġ` is byte 0x20 in GPT-2's table — a space that a JSON vocabulary can
    // hold — and `Ã©` is the two bytes of `é`, which is the case a naive
    // character-wise decoder gets wrong.
    expect(detokenise(['Mon', 'ster', 'a', 'Ġcaf', 'Ã©'], 'bpe-bytelevel')).toBe('Monstera café');
  });

  it('CONTROL: each family gets the OTHER one WRONG, and the failure is SILENT', () => {
    // The case the whole `family` field exists for, and it took two attempts.
    //
    // **Measured: the two families AGREE on a single word.** `['▁Mon','ster','a']`
    // decodes to `Monstera` either way, because the ByteLevel table covers all
    // 256 bytes and `U+2581` is in none of them — so the metaspace is dropped
    // rather than misread, and what is left is ASCII that maps to itself. A
    // fixture of one word is one the defect handles correctly.
    //
    // What separates them is a WORD BOUNDARY, which is the thing the two
    // families encode differently. Neither answer is an error and neither is
    // empty: one runs the words together and the other keeps a marker where a
    // space belonged, and a reader of the resulting text layer sees a
    // recognition that merely read badly.
    expect(detokenise(['▁Mon', 'ster', 'a', '▁deli'], 'unigram-metaspace')).toBe('Monstera deli');
    expect(detokenise(['▁Mon', 'ster', 'a', '▁deli'], 'bpe-bytelevel')).toBe('Monsteradeli');

    expect(detokenise(['Mon', 'ster', 'a', 'Ġdeli'], 'bpe-bytelevel')).toBe('Monstera deli');
    expect(detokenise(['Mon', 'ster', 'a', 'Ġdeli'], 'unigram-metaspace')).toBe('MonsteraĠdeli');
  });
});
