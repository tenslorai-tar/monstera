import { describe, expect, it } from 'vitest';

import { liesOffPage } from './offPage.js';

const PAGE = { x0: 0, y0: 0, x1: 595, y1: 842 };
const box = (left: number, bottom: number, right: number, top: number) => ({ left, bottom, right, top });

describe('liesOffPage, the one rule for text a page does not show (Fix 2, 2026-11-17)', () => {
  it('is true of text wholly above, below, left of or right of the page, whichever way its corners are written', () => {
    expect(liesOffPage(box(72, 900, 300, 912), PAGE)).toBe(true);
    expect(liesOffPage(box(72, -300, 300, -288), PAGE)).toBe(true);
    expect(liesOffPage(box(-400, 400, -100, 412), PAGE)).toBe(true);
    expect(liesOffPage(box(700, 400, 900, 412), PAGE)).toBe(true);
    // A TURNED PAGE answers its corners the other way round.
    expect(liesOffPage(box(300, 912, 72, 900), PAGE)).toBe(true);
  });

  // CONTROL: what is on the page, in whole or in part, and a page with no box, where nothing can be called off it.
  it('is false of text on the page, text across an edge, text touching it from inside, and any text where no box is known', () => {
    expect(liesOffPage(box(72, 400, 300, 412), PAGE)).toBe(false);
    expect(liesOffPage(box(72, 836, 300, 848), PAGE)).toBe(false);
    expect(liesOffPage(box(-10, 400, 20, 412), PAGE)).toBe(false);
    expect(liesOffPage(box(72, 900, 300, 912), null)).toBe(false);
  });

  it('a line that only touches the edge from outside is off it: it shares no area with the page', () => {
    expect(liesOffPage(box(72, 842, 300, 854), PAGE)).toBe(true);
  });
});
