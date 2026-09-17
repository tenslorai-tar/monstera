import { describe, expect, it } from 'vitest';

import { rasterScale } from './rasterScale.js';

describe('rasterScale — a DPI, under a pixel budget, never below the engine’s floor', () => {
  it('gives the DPI asked where the page fits the budget', () => {
    expect(rasterScale({ width: 612, height: 792 }, 300, 30_000_000)).toBeCloseTo(300 / 72, 10);
  });

  it('lowers the scale to the budget where the DPI would pass it — US Letter at 600 dpi to about 566', () => {
    const scale = rasterScale({ width: 612, height: 792 }, 600, 30_000_000);
    expect(scale * 72).toBeCloseTo(566.4, 1);
    expect(612 * scale * 792 * scale).toBeCloseTo(30_000_000, 0);
  });

  it('CONTROL: never goes below 1, even for a page the budget cannot hold at 1', () => {
    expect(rasterScale({ width: 14_400, height: 14_400 }, 150, 16_000_000)).toBe(1);
  });
});
