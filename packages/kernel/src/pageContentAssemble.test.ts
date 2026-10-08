import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { PageContentAnswer } from './pageContentAssemble.js';
import { PageContentRefused, assemblePageContent, encodePng } from './pageContentAssemble.js';

/**
 * The host's page-content answer, taken back into content
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 * The host is hostile by invariant 25's premise, so most of these cases are a claim the host could make falsely, each beside
 * the same claim made truly.
 */

const FRAME = { crop: { x0: 0, y0: 0, x1: 100, y1: 100 }, rotation: 0 } as const;

function answer(images: PageContentAnswer['images']): PageContentAnswer {
  return { frame: FRAME, runs: [], images, paths: [], opaque: [], unaddressable: 0, truncated: false };
}

const BOUNDS = { left: 0, bottom: 0, right: 10, top: 10 };
const MATRIX: [number, number, number, number, number, number] = [10, 0, 0, 10, 0, 0];

/** Reads a PNG back with a second reader: the signature, the IHDR, and the inflated, unfiltered pixels. */
function decode(png: Uint8Array): { width: number; height: number; colourType: number; pixels: number[][] } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
      colourType = data[9] ?? -1;
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = unzlibSync(Uint8Array.from(idat.flatMap((part) => [...part])));
  const channels = colourType === 6 ? 4 : 3;
  const pixels: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (1 + width * channels)], 'filter type 0 on every row').toBe(0);
    for (let x = 0; x < width; x += 1) {
      const start = y * (1 + width * channels) + 1 + x * channels;
      pixels.push([...raw.subarray(start, start + channels)]);
    }
  }
  return { width, height, colourType, pixels };
}

describe('encodePng', () => {
  it('writes the pixels it was given, BGRA turned into RGB(A), as a PNG a second reader decodes', () => {
    // 2 x 1: a pure red pixel and a pure blue one, in BGRA order. Swapped channels would read blue then red.
    const bgra = Uint8Array.of(0, 0, 255, 255, 255, 0, 0, 255);
    const read = decode(encodePng(2, 1, bgra));
    expect(read.width).toBe(2);
    expect(read.height).toBe(1);
    expect(read.colourType, 'every pixel opaque: RGB, a third smaller').toBe(2);
    expect(read.pixels).toStrictEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it('keeps alpha when any pixel is not opaque — CONTROL: the opaque case above drops it', () => {
    const read = decode(encodePng(2, 1, Uint8Array.of(0, 0, 255, 128, 255, 0, 0, 255)));
    expect(read.colourType).toBe(6);
    expect(read.pixels).toStrictEqual([
      [255, 0, 0, 128],
      [0, 0, 255, 255],
    ]);
  });

  it('refuses a buffer that is not width times height times four', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(PageContentRefused);
    expect(() => encodePng(2, 2, new Uint8Array(16))).not.toThrow();
  });
});

describe('assemblePageContent', () => {
  const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 9, 9);

  it('hands a JPEG on as its own bytes and a bitmap as a PNG, each from its own place in the blob', () => {
    const blob = new Uint8Array(JPEG.length + 4);
    blob.set(JPEG, 0);
    blob.set([0, 0, 255, 255], JPEG.length);
    const content = assemblePageContent(
      answer([
        { index: 1, matrix: MATRIX, bounds: BOUNDS, width: 8, height: 8, format: 'jpeg', offset: 0, length: JPEG.length },
        { index: 2, matrix: MATRIX, bounds: BOUNDS, width: 1, height: 1, format: 'bgra', offset: JPEG.length, length: 4 },
      ]),
      blob,
    );
    const [first, second] = content.images;
    expect(first?.format).toBe('jpeg');
    expect([...(first?.bytes ?? [])]).toStrictEqual([...JPEG]);
    expect(second?.format).toBe('png');
    expect(decode(second?.bytes ?? new Uint8Array()).pixels).toStrictEqual([[255, 0, 0]]);
  });

  it('REFUSES bytes the host did not write, a bitmap of the wrong size, and a JPEG that is not one', () => {
    const blob = new Uint8Array(8);
    blob.set(JPEG.subarray(0, 4));
    const ok = { index: 1, matrix: MATRIX, bounds: BOUNDS, width: 1, height: 1, format: 'jpeg' as const, offset: 0, length: 4 };
    // CONTROL: the same header, naming bytes that are there, is taken.
    expect(() => assemblePageContent(answer([ok]), blob)).not.toThrow();
    expect(() => assemblePageContent(answer([{ ...ok, offset: 6, length: 4 }]), blob)).toThrow(/up to 10 of 8 written/u);
    expect(() => assemblePageContent(answer([{ ...ok, offset: 4 }]), blob)).toThrow(/not a JPEG/u);
    expect(() => assemblePageContent(answer([{ ...ok, format: 'bgra', width: 2, height: 2, length: 4 }]), blob)).toThrow(PageContentRefused);
  });
});
