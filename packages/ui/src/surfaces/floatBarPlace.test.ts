import { describe, expect, it } from 'vitest';

import { FLOAT_BAR_LEAP, FLOAT_BAR_STEP, nudged, positionAt } from './floatBarPlace.js';

const ROOM = { areaWidth: 1000, areaHeight: 600, barWidth: 40, barHeight: 400 };

// WHERE A SHARE IS DRAWN is the stylesheet's (`.m-quick-toolbar--free`), against the area as laid out, and the
// rendered suite proves it inside the area at every size, in the same frame as a resize. These cases are the other
// half: turning where a person put the bar into the share that is stored.
describe('the Float bar’s place (item 4)', () => {
  it('a requested corner is stored as a share of the travel, clamped into the room, both ways, on both axes', () => {
    expect(positionAt({ left: -300, top: 5000 }, ROOM)).toStrictEqual({ x: 0, y: 1 });
    expect(positionAt({ left: 480, top: 100 }, ROOM)).toStrictEqual({ x: 0.5, y: 0.5 });
    // THE TRAVEL, not the area: the far corner is 960 across (1000 less the bar's 40), so 960 is a share of 1.
    expect(positionAt({ left: 960, top: 200 }, ROOM)).toStrictEqual({ x: 1, y: 1 });
  });

  it('an area smaller than the bar PINS it to the start rather than dividing by nothing', () => {
    const cramped = { ...ROOM, areaHeight: 300 };
    expect(positionAt({ left: 10, top: 90 }, cramped)).toStrictEqual({ x: 10 / 960, y: 0 });
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
