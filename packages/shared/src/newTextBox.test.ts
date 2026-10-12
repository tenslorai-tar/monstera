import { describe, expect, it } from 'vitest';

import { NEW_TEXT_MARGIN, NEW_TEXT_MIN_MEASURE, newTextBox } from './newTextBox.js';

/**
 * Add text's box is inside the page's box wherever it is pressed (the owner's W1). The engine half — that words written
 * in such a box are on the page at every turn — is `packages/kernel/src/textInsertPlacement.test.ts`.
 */
describe('newTextBox', () => {
  const crop = { x0: 36, y0: 54, x1: 576, y1: 756 };

  it('starts where it was pressed when there is room, a margin inside the right edge', () => {
    expect(newTextBox({ x: 100, y: 400 }, crop, 12)).toStrictEqual({ left: 100, measure: 360, top: 400, baseline: 390.4, bottom: 385.6 });
  });

  it('CONTROL: a press near the right edge moves the box back, so the narrowest measure ends on the page', () => {
    const box = newTextBox({ x: 570, y: 400 }, crop, 12);
    expect(box.measure).toBe(NEW_TEXT_MIN_MEASURE);
    expect(box.left + box.measure).toBeLessThanOrEqual(crop.x1);
    // NOT a margin inside: the measure the margin would leave is under the narrowest, so the box ends at the edge.
    expect(box.left).toBe(crop.x1 - NEW_TEXT_MIN_MEASURE);
    expect(box.left).toBeLessThan(crop.x1 - NEW_TEXT_MARGIN);
  });

  it('a press below the foot or above the top puts the first line on the page', () => {
    expect(newTextBox({ x: 100, y: 10 }, crop, 12).bottom).toBeGreaterThanOrEqual(crop.y0);
    expect(newTextBox({ x: 100, y: 900 }, crop, 12).top).toBeLessThanOrEqual(crop.y1);
  });

  it('a page narrower than the narrowest measure takes the page’s width, never more', () => {
    const narrow = { x0: 0, y0: 0, x1: 60, y1: 100 };
    const box = newTextBox({ x: 50, y: 50 }, narrow, 12);
    expect(box.left).toBe(0);
    expect(box.measure).toBe(60);
  });

  it('a box given corners the other way round is the same box', () => {
    expect(newTextBox({ x: 570, y: 400 }, { x0: 576, y0: 756, x1: 36, y1: 54 }, 12)).toStrictEqual(newTextBox({ x: 570, y: 400 }, crop, 12));
  });
});
