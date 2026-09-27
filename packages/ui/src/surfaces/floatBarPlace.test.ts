import { describe, expect, it } from 'vitest';

import { FLOAT_BAR_LEAP, FLOAT_BAR_STEP, nudged, pointOf, positionAt } from './floatBarPlace.js';

const ROOM = { areaWidth: 1000, areaHeight: 600, barWidth: 40, barHeight: 400 };

describe('the Float bar’s place (item 4)', () => {
  it('a stored share of the travel draws inside the page area at EVERY size, which is why it is a share', () => {
    const corner = { x: 1, y: 1 };
    const wide = pointOf(corner, ROOM);
    expect(wide).toStrictEqual({ left: 960, top: 200 });
    // THE WINDOW SHRINKS: the same stored value lands inside the smaller room, not 960 px across it.
    const narrow = pointOf(corner, { ...ROOM, areaWidth: 500, areaHeight: 450 });
    expect(narrow).toStrictEqual({ left: 460, top: 50 });
    expect(narrow.left + ROOM.barWidth).toBeLessThanOrEqual(500);
  });

  it('a requested corner is clamped into the room, both ways, on both axes', () => {
    expect(positionAt({ left: -300, top: 5000 }, ROOM)).toStrictEqual({ x: 0, y: 1 });
    expect(positionAt({ left: 480, top: 100 }, ROOM)).toStrictEqual({ x: 0.5, y: 0.5 });
  });

  it('round-trips: where a person put it is where it is drawn', () => {
    const asked = { left: 312, top: 77 };
    const back = pointOf(positionAt(asked, ROOM), ROOM);
    expect(back.left).toBeCloseTo(asked.left, 9);
    expect(back.top).toBeCloseTo(asked.top, 9);
  });

  it('an area smaller than the bar PINS it to the start rather than dividing by nothing', () => {
    const cramped = { ...ROOM, areaHeight: 300 };
    expect(positionAt({ left: 10, top: 90 }, cramped)).toStrictEqual({ x: 10 / 960, y: 0 });
    expect(pointOf({ x: 0.3, y: 0.9 }, cramped).top).toBe(0);
  });

  it('an arrow key moves one grid step, Shift four, and any other key is not the bar’s', () => {
    const at = { left: 100, top: 100 };
    expect(nudged(at, 'ArrowRight', false)).toStrictEqual({ left: 100 + FLOAT_BAR_STEP, top: 100 });
    expect(nudged(at, 'ArrowUp', true)).toStrictEqual({ left: 100, top: 100 - FLOAT_BAR_LEAP });
    expect(nudged(at, 'ArrowLeft', false)).toStrictEqual({ left: 100 - FLOAT_BAR_STEP, top: 100 });
    expect(nudged(at, 'ArrowDown', true)).toStrictEqual({ left: 100, top: 100 + FLOAT_BAR_LEAP });
    expect(nudged(at, 'Enter', false)).toBeUndefined();
  });
});
