import { describe, expect, it } from 'vitest';

import { pictureSize } from './pictureSize.js';

/**
 * A picture attached to a question, sized in the compose host (ADR-0135 Decision 4). The sizes are off the square and
 * different on each axis, so a reader that swapped width and height would be seen.
 */

/** A baseline JPEG's start-of-image, start-of-frame for three components, and end — `imageCompose.test.ts`' fixture. */
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

/** A PNG signature and an `IHDR` stating a size. */
function pngHeaderOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('pictureSize', () => {
  it('reads a JPEG’s size from its frame header and a PNG’s from its IHDR', async () => {
    await expect(pictureSize(jpegOf(4032, 3024), 'image/jpeg')).resolves.toStrictEqual({ width: 4032, height: 3024 });
    await expect(pictureSize(pngHeaderOf(640, 480), 'image/png')).resolves.toStrictEqual({ width: 640, height: 480 });
  });

  it('answers null for bytes the reader for that type cannot read, never a size', async () => {
    await expect(pictureSize(Uint8Array.of(1, 2, 3, 4), 'image/jpeg')).resolves.toBeNull();
    await expect(pictureSize(Uint8Array.of(1, 2, 3, 4), 'image/png')).resolves.toBeNull();
    // A PNG HANDED TO THE JPEG READER is not a JPEG: the type chooses the reader, and the reader decides.
    await expect(pictureSize(pngHeaderOf(640, 480), 'image/jpeg')).resolves.toBeNull();
  });
});
