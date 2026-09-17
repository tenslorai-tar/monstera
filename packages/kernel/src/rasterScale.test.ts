import { describe, expect, it } from 'vitest';

import { MAX_SNAPSHOT_PIXELS } from './pageSnapshot.js';
import { rasterScale } from './rasterScale.js';

/** The raster's size as the engine counts it: each side rounded up (`rasterisePageImage`). */
function roundedPixels(size: { width: number; height: number }, scale: number): number {
  return Math.ceil(size.width * scale) * Math.ceil(size.height * scale);
}

describe('rasterScale — a DPI, under a pixel budget, never below the engine’s floor', () => {
  it('gives the DPI asked where the page fits the budget', () => {
    expect(rasterScale({ width: 612, height: 792 }, 300, 30_000_000)).toBeCloseTo(300 / 72, 10);
  });

  it('lowers the scale to the budget where the DPI would pass it — US Letter at 600 dpi to about 566', () => {
    const letter = { width: 612, height: 792 };
    const scale = rasterScale(letter, 600, 30_000_000);
    // 566.34: the area-only rule gave 566.40, one rounded pixel per side above this.
    expect(scale * 72).toBeCloseTo(566.34, 2);
    expect(roundedPixels(letter, scale)).toBeLessThanOrEqual(30_000_000);
    expect(roundedPixels(letter, scale)).toBeGreaterThan(29_990_000);
  });

  it('counts ROUNDED pixels: an A0 page fitted to the engine’s own bound is one the engine admits', () => {
    const a0 = { width: 2384, height: 3370 };
    // The fixture the area-only rule failed: sqrt(bound / area) rounds up to 32,002,308.
    const areaOnly = Math.sqrt(MAX_SNAPSHOT_PIXELS / (a0.width * a0.height));
    expect(roundedPixels(a0, areaOnly)).toBeGreaterThan(MAX_SNAPSHOT_PIXELS);

    expect(roundedPixels(a0, rasterScale(a0, 200, MAX_SNAPSHOT_PIXELS))).toBeLessThanOrEqual(MAX_SNAPSHOT_PIXELS);
  });

  it('CONTROL: never goes below 1, even for a page the budget cannot hold at 1', () => {
    expect(rasterScale({ width: 14_400, height: 14_400 }, 150, 16_000_000)).toBe(1);
  });
});
