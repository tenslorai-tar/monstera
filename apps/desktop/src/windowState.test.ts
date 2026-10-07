import { describe, expect, it } from 'vitest';

import { createEphemeralSettings } from './settingsFile.js';
import {
  FIRST_LAUNCH,
  MIN_VISIBLE,
  PLATFORM_DEFAULT,
  type Box,
  placementFor,
  windowMemory,
} from './windowState.js';

/**
 * Where the window opens (the owner's order of 2026-10-07, item 14): maximised the first time, then as it was left —
 * and only if that place is still on a connected screen. Every case that expects the remembered place has a control
 * that expects the first launch from the same record, differing in the one thing the case is about.
 */

const PRIMARY: Box = { x: 0, y: 0, width: 1920, height: 1040 };
/** A second screen to the right, as it would be connected while the window was left on it. */
const SECOND: Box = { x: 1920, y: 0, width: 1920, height: 1040 };
const FLOOR = { width: 1024, height: 720 };
const LEFT = { x: 100, y: 80, width: 1400, height: 900, maximized: false };

describe('placementFor', () => {
  it('a FIRST launch — nothing remembered — opens maximised and leaves the bounds to the platform', () => {
    expect(placementFor({}, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
    expect(placementFor(undefined, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
    // CONTROL: the same call with a record is NOT a first launch, so the answer above is the missing record's.
    expect(placementFor(LEFT, [PRIMARY], FLOOR)).not.toStrictEqual(FIRST_LAUNCH);
  });

  it('a window left where it was opens THERE, at that size, not maximised', () => {
    expect(placementFor(LEFT, [PRIMARY], FLOOR)).toStrictEqual({
      bounds: { x: 100, y: 80, width: 1400, height: 900 },
      maximize: false,
    });
  });

  it('a window left MAXIMISED opens maximised, over the size it unmaximises to', () => {
    expect(placementFor({ ...LEFT, maximized: true }, [PRIMARY], FLOOR)).toStrictEqual({
      bounds: { x: 100, y: 80, width: 1400, height: 900 },
      maximize: true,
    });
  });

  it('a record that is not a window is a first launch, whatever shape it has', () => {
    const broken: unknown[] = [
      { ...LEFT, width: 0 },
      { ...LEFT, width: -10 },
      { ...LEFT, x: 1.5 },
      { ...LEFT, maximized: 'yes' },
      { x: 1, y: 1, width: 800, height: 600 },
      { ...LEFT, extra: true },
      'window',
      null,
    ];
    for (const record of broken) expect(placementFor(record, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
  });

  it('a window left on a screen that is no longer connected is NOT put there — and is, while that screen is', () => {
    const onSecond = { ...LEFT, x: 2200 };
    // THE DECISION: no screen holds it now, so it opens maximised on the primary one.
    expect(placementFor(onSecond, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
    // CONTROL: the same record with that screen connected is restored, so the line above is the screen's absence.
    expect(placementFor(onSecond, [PRIMARY, SECOND], FLOOR).bounds).toStrictEqual({
      x: 2200,
      y: 80,
      width: 1400,
      height: 900,
    });
  });

  it('a screen LEFT of the primary has negative coordinates, and a window left on it is restored there', () => {
    // THE HARD SHAPE: every other case here has its screens at positive coordinates. Windows numbers a screen to the left
    // of the primary from below zero, and a window left on it has a negative x.
    const LEFT_SCREEN: Box = { x: -1920, y: 0, width: 1920, height: 1040 };
    const onLeft = { ...LEFT, x: -1700 };
    expect(placementFor(onLeft, [LEFT_SCREEN, PRIMARY], FLOOR).bounds).toStrictEqual({
      x: -1700,
      y: 80,
      width: 1400,
      height: 900,
    });
    // CONTROL: the same record with that screen gone is a first launch.
    expect(placementFor(onLeft, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
  });

  it('a window with too little of it on a screen to grab is not restored; exactly enough is', () => {
    // ONLY ITS CORNER ON THE SCREEN: the window's left edge is MIN_VISIBLE.width − 1 short of the screen's right edge.
    const edge = PRIMARY.x + PRIMARY.width;
    const sliver = { ...LEFT, x: edge - (MIN_VISIBLE.width - 1) };
    expect(placementFor(sliver, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
    // CONTROL: one pixel more is enough, so the boundary is where it is said to be.
    const enough = { ...LEFT, x: edge - MIN_VISIBLE.width };
    expect(placementFor(enough, [PRIMARY], FLOOR).bounds?.x).toBe(enough.x);
    // AND THE SAME ON THE OTHER AXIS.
    const below = { ...LEFT, y: PRIMARY.y + PRIMARY.height - (MIN_VISIBLE.height - 1) };
    expect(placementFor(below, [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);
  });

  it('a remembered size under the window’s floor is raised to it, and a size over it is left', () => {
    expect(placementFor({ ...LEFT, width: 600, height: 400 }, [PRIMARY], FLOOR).bounds).toStrictEqual({
      x: 100,
      y: 80,
      width: FLOOR.width,
      height: FLOOR.height,
    });
    expect(placementFor(LEFT, [PRIMARY], FLOOR).bounds?.width).toBe(1400);
  });

  it('a harness’s window has no memory and is neither maximised nor placed', () => {
    expect(PLATFORM_DEFAULT).toStrictEqual({ bounds: undefined, maximize: false });
    expect(PLATFORM_DEFAULT).not.toStrictEqual(FIRST_LAUNCH);
  });
});

describe('windowMemory', () => {
  it('keeps what it is given and reads it back as a window the placement accepts', () => {
    const file = createEphemeralSettings();
    const memory = windowMemory(file);
    // NOTHING KEPT YET reads as a first launch, so the round trip below is what changed it.
    expect(placementFor(memory.read(), [PRIMARY], FLOOR)).toStrictEqual(FIRST_LAUNCH);

    memory.write(LEFT);
    expect(placementFor(memory.read(), [PRIMARY], FLOOR)).toStrictEqual({
      bounds: { x: 100, y: 80, width: 1400, height: 900 },
      maximize: false,
    });
  });
});
