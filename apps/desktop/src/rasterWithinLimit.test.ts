import { claudeAcceptsBytes } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { MAX_RASTER_RETAKES, rasterWithinLimit } from './rasterWithinLimit.js';

/**
 * A rasteriser whose PNG weighs `bytesPerPixel` for each pixel of a region, recording
 * every scale it was asked for — the calls are the decision this module makes.
 */
function drawing(widthPoints: number, heightPoints: number, bytesPerPixel: number) {
  const asked: number[] = [];
  const rasterAt = (scale: number): Promise<{ png: Uint8Array }> => {
    asked.push(scale);
    const pixels = Math.ceil(widthPoints * scale) * Math.ceil(heightPoints * scale);
    return Promise.resolve({ png: new Uint8Array(Math.floor(pixels * bytesPerPixel)) });
  };
  return { asked, rasterAt };
}

describe('rasterWithinLimit, with Claude’s byte rule', () => {
  it('takes a raster that fits once, and CONTROL: draws nothing a second time', async () => {
    // A letter page at 2× of a clean scan: ~0.4 bytes a pixel, well under the limit.
    const { asked, rasterAt } = drawing(612, 792, 0.4);
    const taken = await rasterWithinLimit(2, 1, claudeAcceptsBytes, rasterAt);
    expect(asked).toStrictEqual([2]);
    expect(taken.scale).toBe(2);
  });

  it('draws a photographed region again SMALLER, and the second raster fits', async () => {
    // THE MEASURED SHAPE: ~2.2 bytes a pixel, as the 2240×1652 scan that drew a 400
    // was (8,234,490 bytes). At 2× this region is over the encoded limit.
    const { asked, rasterAt } = drawing(1000, 900, 2.2);
    const taken = await rasterWithinLimit(2, 1, claudeAcceptsBytes, rasterAt);
    expect(asked[0]).toBe(2);
    expect(claudeAcceptsBytes((await rasterAt(2)).png.byteLength).ok).toBe(false);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(taken.scale).toBeLessThan(2);
    expect(claudeAcceptsBytes(taken.raster.png.byteLength).ok).toBe(true);
  });

  it('stops at the floor and hands the raster on, rather than refusing a second time', async () => {
    // So large that even scale 1 is over: the recogniser is the one that refuses.
    const { asked, rasterAt } = drawing(3000, 3000, 3);
    const taken = await rasterWithinLimit(2, 1, claudeAcceptsBytes, rasterAt);
    expect(taken.scale).toBe(1);
    expect(asked.at(-1)).toBe(1);
    expect(claudeAcceptsBytes(taken.raster.png.byteLength).ok).toBe(false);
  });

  it('draws at most the bounded number of retakes', async () => {
    // A verdict that always asks for only a sliver smaller: the bound, not the floor, stops it.
    const { asked, rasterAt } = drawing(100, 100, 1);
    await rasterWithinLimit(2, 1, () => ({ ok: false, shrinkBy: 0.99 }), rasterAt);
    expect(asked).toHaveLength(1 + MAX_RASTER_RETAKES);
  });
});
