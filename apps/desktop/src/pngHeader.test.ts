import { describe, expect, it } from 'vitest';

import { declaredPngSize, pngSizeWithin } from './pngHeader.js';

/** The first 24 bytes of a PNG that declares `width` by `height`: signature, chunk length 13, 'IHDR', and the two sizes. */
function header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const PRINT_LIMIT = 30_000_000;

describe('the print raster is measured before it is decoded (CR-SEC-21)', () => {
  it('refuses a header that declares more pixels than a print asks for, however small the bytes are', () => {
    // 33 BYTES THAT DECLARE FOUR BILLION PIXELS ON A SIDE: what a hostile host would send, and what a decoder allocates for.
    expect(() => pngSizeWithin(header(4_000_000_000, 4_000_000_000), PRINT_LIMIT)).toThrow(/not decoded/u);
    expect(() => pngSizeWithin(header(6000, 5001), PRINT_LIMIT)).toThrow(/not decoded/u);
    expect(() => pngSizeWithin(header(0, 100), PRINT_LIMIT)).toThrow(/not decoded/u);
  });

  it('refuses bytes that are not a PNG header at all, and a truncated one', () => {
    expect(() => pngSizeWithin(new Uint8Array(40), PRINT_LIMIT)).toThrow(/readable header/u);
    expect(() => pngSizeWithin(header(10, 10).subarray(0, 20), PRINT_LIMIT)).toThrow(/readable header/u);
    const notIhdr = header(10, 10);
    notIhdr[12] = 0x58;
    expect(declaredPngSize(notIhdr)).toBeUndefined();
  });

  it('CONTROL: a page at the bound, and an ordinary one, are read at the size they declare', () => {
    expect(pngSizeWithin(header(5000, 6000), PRINT_LIMIT)).toStrictEqual({ width: 5000, height: 6000 });
    expect(pngSizeWithin(header(1275, 1650), PRINT_LIMIT)).toStrictEqual({ width: 1275, height: 1650 });
    // A VIEW into a larger buffer is read where it starts, not at the start of the buffer under it.
    const padded = new Uint8Array(64);
    padded.set(header(300, 200), 16);
    expect(declaredPngSize(padded.subarray(16))).toStrictEqual({ width: 300, height: 200 });
  });
});
