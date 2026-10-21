import { describe, expect, it } from 'vitest';

import { openListPlace } from './PageChoice.js';

/** Six rows at a 10 px type size: 69 px of list (`ROW_PITCH` 1.15). */
const ROWS = 6;
const FONT = 10;
const LIST = ROWS * FONT * 1.15;

/** The rule before R21: under the field unless it ran past the foot AND fitted above, so neither fitting put it under. */
function before(at: { top: number; height: number }, room: number): { top: number; bottom: number } {
  const below = at.top + at.height;
  const upwards = below + LIST > room && at.top - LIST >= 0;
  const top = upwards ? at.top - LIST : below;
  return { top, bottom: top + LIST };
}

describe('openListPlace: where a list opened at its field sits (R21)', () => {
  it('under the field where the page has room below', () => {
    const at = { left: 10, top: 100, width: 80, height: 20 };
    expect(openListPlace(at, ROWS, FONT, 600)).toStrictEqual({ top: 120, maxHeight: LIST });
  });

  it('above it, touching it, where the page has room above and not below', () => {
    const at = { left: 10, top: 500, width: 80, height: 20 };
    const place = openListPlace(at, ROWS, FONT, 540);
    expect(place).toStrictEqual({ top: 500 - LIST, maxHeight: LIST });
    expect(place.top + place.maxHeight).toBe(at.top);
  });

  it('where neither side holds it, on the roomier side, shortened to the room and inside the page', () => {
    // A SHORT PAGE, the field in its middle: 40 px above, 50 px below, a 69 px list.
    const at = { left: 10, top: 40, width: 80, height: 20 };
    const room = 110;
    const place = openListPlace(at, ROWS, FONT, room);
    expect(place).toStrictEqual({ top: 60, maxHeight: 50 });
    expect(place.top + place.maxHeight).toBeLessThanOrEqual(room);
    // THE CONTROL: the rule before put the whole list under the field, past the page's foot, where it was cut off.
    expect(before(at, room).bottom).toBeGreaterThan(room);
  });

  it('and on the side above where it has more room, touching the field and from the page’s top', () => {
    const at = { left: 10, top: 55, width: 80, height: 20 };
    const place = openListPlace(at, ROWS, FONT, 110);
    expect(place).toStrictEqual({ top: 0, maxHeight: 55 });
    expect(place.top + place.maxHeight).toBe(at.top);
  });

  it('never more rows than it holds, and no more than eight shown', () => {
    const at = { left: 10, top: 100, width: 80, height: 20 };
    expect(openListPlace(at, 2, FONT, 600).maxHeight).toBeCloseTo(2 * FONT * 1.15);
    expect(openListPlace(at, 30, FONT, 600).maxHeight).toBeCloseTo(8 * FONT * 1.15);
  });
});
