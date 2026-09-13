import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import { pngPixelSize } from './imageDimensions.js';

/** A real PNG, encoded by MuPDF, so the reader is held to an encoder it did not write. */
function png(width: number, height: number): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  pixmap.clear(255);
  return new Uint8Array(pixmap.asPNG());
}

describe('pngPixelSize', () => {
  it('reads the width and height a real PNG states — and CONTROL: they are not swapped', () => {
    // NOT SQUARE, so a reader that took width for height passes nothing here.
    expect(pngPixelSize(png(37, 11))).toStrictEqual({ width: 37, height: 11 });
  });

  it('reads the size without decoding, so a huge image costs nothing to measure', () => {
    // A HEADER THAT CLAIMS A BOMB, built by hand: signature, IHDR, 60000 × 60000, and
    // no image data at all. A reader that decoded would fail here; this one only reads.
    const header = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0xea, 0x60, 0x00, 0x00, 0xea, 0x60,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ]);
    expect(pngPixelSize(header)).toStrictEqual({ width: 60000, height: 60000 });
  });

  it('answers null for a JPEG, for bytes too short, and for a wrong first chunk', () => {
    expect(pngPixelSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(40).fill(0)]))).toBeNull();
    expect(pngPixelSize(png(5, 5).subarray(0, 20))).toBeNull();
    const renamed = png(5, 5).slice();
    renamed[12] = 0x58; // `XHDR`
    expect(pngPixelSize(renamed)).toBeNull();
  });

  it('answers null for a zero dimension, which would let any pixel bound pass', () => {
    const zero = png(5, 5).slice();
    zero.set([0, 0, 0, 0], 16);
    expect(pngPixelSize(zero)).toBeNull();
  });

  it('reads a PNG that is a view into a larger buffer at an offset', () => {
    // THE OFFSET CASE, because the host hands a subarray of what it read and a DataView
    // built without `byteOffset` would read the bytes before the image.
    const inner = png(9, 4);
    const outer = new Uint8Array(inner.length + 16);
    outer.set(inner, 16);
    expect(pngPixelSize(outer.subarray(16))).toStrictEqual({ width: 9, height: 4 });
  });
});
