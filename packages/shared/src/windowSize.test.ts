import { describe, expect, it } from 'vitest';

import { MINIMUM_WINDOW, minimumWindowFor } from './windowSize.js';

/**
 * The window's floor against the screen it is on (the owner's order of 28 September, item 3): never more than the
 * work area, and the chrome's own floor wherever the screen has room for it.
 */
describe('minimumWindowFor', () => {
  it('CONTROL: a screen with room keeps the chrome’s floor exactly', () => {
    // A 1080p screen at 100%: the work area is well past 1024 × 720, so nothing gives way.
    expect(minimumWindowFor({ width: 1920, height: 1040 })).toStrictEqual(MINIMUM_WINDOW);
  });

  it('gives way to a 1080p screen at 200% scaling, on BOTH axes', () => {
    // 1920 × 1032 physical at 2× is 960 × 516 CSS pixels: a 1024 × 720 floor there is a window that cannot fit.
    expect(minimumWindowFor({ width: 960, height: 516 })).toStrictEqual({ width: 960, height: 516 });
  });

  it('gives way on the one axis that is short, and keeps the other', () => {
    // 150% on 1366 × 768: 910 × 485. Wide enough for neither — and a tall narrow screen for one.
    expect(minimumWindowFor({ width: 910.67, height: 485.33 })).toStrictEqual({ width: 910, height: 485 });
    expect(minimumWindowFor({ width: 800, height: 1200 })).toStrictEqual({ width: 800, height: MINIMUM_WINDOW.height });
  });

  it('never answers a size of nothing, whatever a display reports', () => {
    expect(minimumWindowFor({ width: 0, height: -5 })).toStrictEqual({ width: 1, height: 1 });
  });
});
