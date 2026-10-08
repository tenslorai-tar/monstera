import { unzlibSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedSource } from './editableSlide.js';
import type { ContentFrame } from './pageContent.js';
import type { EditableSlide, SlidePicture } from './slideModel.js';
import { type Raster, cutFromRaster, resolveSlide } from './slideResolve.js';

/**
 * A picture made out of the page's own render, and a slide's unresolved pictures made into bytes
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 */

const RED = [0, 0, 255, 255];
const BLUE = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const YELLOW = [0, 255, 255, 255];

function raster(width: number, height: number, colour: (x: number, y: number) => number[]): Raster {
  const bgra = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) bgra.set(colour(x, y), (y * width + x) * 4);
  return { width, height, bgra };
}

/** The pixels of a PNG written by `encodePng` (filter 0, RGB or RGBA), by a second reader. */
function pixelsOf(png: Uint8Array): { width: number; height: number; rgb: number[][] } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const data: number[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const name = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      type = body[9] ?? 0;
    }
    if (name === 'IDAT') data.push(...body);
    at += 12 + length;
  }
  const raw = unzlibSync(Uint8Array.from(data));
  const channels = type === 6 ? 4 : 3;
  const rgb: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * (1 + width * channels) + 1 + x * channels;
      rgb.push([...raw.subarray(start, start + 3)]);
    }
  }
  return { width, height, rgb };
}

const FRAME: ContentFrame = { crop: { x0: 0, y0: 0, x1: 50, y1: 100 }, rotation: 0 };

describe('cutFromRaster', () => {
  // A 50 x 100 pt page rendered at 2 px per point: red on its left half, blue on its right.
  const halves = raster(100, 200, (x) => (x < 50 ? RED : BLUE));

  it('cuts the region it was asked for, at the render’s own resolution', () => {
    const cut = cutFromRaster(halves, FRAME, { left: 0, bottom: 0, right: 25, top: 100 });
    const read = pixelsOf(cut.bytes);
    expect([read.width, read.height]).toStrictEqual([50, 200]);
    expect(read.rgb.every((pixel) => pixel[0] === 255 && pixel[2] === 0)).toBe(true);
  });

  it('CONTROL: the other half is blue, so the red above is the left half and not any half', () => {
    const read = pixelsOf(cutFromRaster(halves, FRAME, { left: 25, bottom: 0, right: 50, top: 100 }).bytes);
    expect(read.rgb.every((pixel) => pixel[0] === 0 && pixel[2] === 255)).toBe(true);
  });

  it('measures from the CropBox, not from the origin', () => {
    const offset: ContentFrame = { crop: { x0: 10, y0: 20, x1: 60, y1: 120 }, rotation: 0 };
    // Page x 10..35 is the left half of the visible page; 35..60 is the right.
    expect(pixelsOf(cutFromRaster(halves, offset, { left: 10, bottom: 20, right: 35, top: 120 }).bytes).rgb[0]).toStrictEqual([255, 0, 0]);
    expect(pixelsOf(cutFromRaster(halves, offset, { left: 35, bottom: 20, right: 60, top: 120 }).bytes).rgb[0]).toStrictEqual([0, 0, 255]);
  });

  it('follows a quarter turn: the bottom-left of a page turned 90 degrees is the top-left of what is shown', () => {
    // The shown page is 100 pt wide and 50 pt tall, rendered at 2 px per point: green on top, yellow below.
    const shown = raster(200, 100, (_x, y) => (y < 50 ? GREEN : YELLOW));
    const turned: ContentFrame = { crop: { x0: 0, y0: 0, x1: 50, y1: 100 }, rotation: 90 };
    const read = pixelsOf(cutFromRaster(shown, turned, { left: 0, bottom: 0, right: 10, top: 10 }).bytes);
    expect(read.rgb[0]).toStrictEqual([0, 255, 0]);
  });

  it('rounds OUTWARD, so a hairline is never cut to nothing, and refuses a region off the page', () => {
    const hairline = cutFromRaster(halves, FRAME, { left: 0, bottom: 50, right: 50, top: 50.2 });
    expect(pixelsOf(hairline.bytes).height).toBeGreaterThanOrEqual(1);
    expect(() => cutFromRaster(halves, FRAME, { left: 500, bottom: 0, right: 600, top: 10 })).toThrow(/outside/u);
  });
});

describe('resolveSlide', () => {
  const embedded: EmbeddedSource = { kind: 'embedded', extension: 'jpeg', bytes: Uint8Array.of(1) };
  const made: EmbeddedSource = { kind: 'embedded', extension: 'png', bytes: Uint8Array.of(2) };

  function picture(source: SlidePicture['source'], order: number): SlidePicture {
    return { kind: 'picture', order, x: 0, y: 0, width: 1, height: 1, rotation: 0, flipV: false, source };
  }

  it('makes each cut and the page, leaves embedded bytes alone, and keeps the order', async () => {
    const slide: EditableSlide = {
      objects: [
        picture({ kind: 'page' }, 0),
        picture(embedded, 1),
        picture({ kind: 'cut', region: { left: 1, bottom: 2, right: 3, top: 4 } }, 2),
      ],
    };
    const cut = vi.fn(() => Promise.resolve(made));
    const page = vi.fn(() => Promise.resolve(made));
    const resolved = await resolveSlide(slide, { cut, page });
    expect(resolved.objects.map((object) => (object.kind === 'picture' ? object.source.bytes[0] : -1))).toStrictEqual([2, 1, 2]);
    // THE REGION REACHED THE CUT, and an embedded picture reached neither maker.
    expect(cut).toHaveBeenCalledExactlyOnceWith({ left: 1, bottom: 2, right: 3, top: 4 });
    expect(page).toHaveBeenCalledOnce();
  });

  it('a picture that cannot be made fails the slide rather than writing a hole', async () => {
    const slide: EditableSlide = { objects: [picture({ kind: 'cut', region: { left: 0, bottom: 0, right: 1, top: 1 } }, 0)] };
    await expect(
      resolveSlide(slide, { cut: () => Promise.reject(new Error('no render')), page: () => Promise.resolve(made) }),
    ).rejects.toThrow('no render');
  });
});
