import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  type ZoomMode,
  resolveZoom,
  zoomInFrom,
  zoomOutFrom,
} from './zoom.js';

/**
 * The zoom vocabulary, tested as arithmetic rather than through a component.
 *
 * A fit is a relationship between two boxes, and both boxes are values — so
 * every case here can state them, which a component test cannot: happy-dom has
 * no layout and would report every box as zero. `PageList.test.tsx` covers what
 * the scroller does with the answer; this covers what the answer is.
 */

const A4 = { width: 595, height: 842 };
const FIT_WIDTH: ZoomMode = { kind: 'fit-width' };
const FIT_PAGE: ZoomMode = { kind: 'fit-page' };

describe('resolveZoom', () => {
  it('answers a scale mode with its own number, measured or not', () => {
    // The point of the mode split: an explicit scale needs nothing measured,
    // so a viewer with no layout yet still draws at what the reader asked for.
    expect(resolveZoom({ kind: 'scale', scale: 1.5 })).toBe(1.5);
    expect(resolveZoom(DEFAULT_ZOOM)).toBe(1);
  });

  it('fits the width to the box, less the gutter', () => {
    // 595pt page in an 827px box: (827 - 32) / 595 = 1.336…
    expect(resolveZoom(FIT_WIDTH, { width: 827, height: 400 }, A4)).toBeCloseTo(795 / 595, 10);
  });

  it('IGNORES the height when fitting width, which is what makes it fit-WIDTH', () => {
    // THE SEPARATING CASE. A box far too short for the page must not change the
    // answer — an implementation that took the minimum of both ratios would
    // pass every other case here and be fit-page wearing fit-width's name.
    const wide = resolveZoom(FIT_WIDTH, { width: 827, height: 100 }, A4);
    expect(wide).toBeCloseTo(795 / 595, 10);
    expect(resolveZoom(FIT_PAGE, { width: 827, height: 100 }, A4)).toBeLessThan(wide ?? 0);
  });

  it('fits the page to whichever dimension runs out first', () => {
    // Tall box, narrow: width binds. (432 - 32) / 595
    expect(resolveZoom(FIT_PAGE, { width: 432, height: 2000 }, A4)).toBeCloseTo(400 / 595, 10);
    // Wide box, short: height binds. (474 - 32) / 842
    expect(resolveZoom(FIT_PAGE, { width: 2000, height: 474 }, A4)).toBeCloseTo(442 / 842, 10);
  });

  it('answers UNDEFINED rather than 1 when a fit cannot be computed', () => {
    // "Not yet" and "100%" are different answers and the caller treats them
    // differently: one waits, the other draws. Returning 1 here would show the
    // reader a zoom they did not ask for and correct it a frame later.
    expect(resolveZoom(FIT_WIDTH, undefined, A4)).toBeUndefined();
    expect(resolveZoom(FIT_WIDTH, { width: 827, height: 400 }, undefined)).toBeUndefined();
  });

  it('refuses a degenerate box instead of dividing by it', () => {
    // A ZERO IS NOT A SMALL NUMBER HERE. Dividing by a zero-width page yields
    // Infinity, which clamps to the maximum step — so the reader would meet a
    // page at 400% produced entirely by an absent measurement, which looks like
    // a decision rather than a gap.
    expect(resolveZoom(FIT_WIDTH, { width: 827, height: 400 }, { width: 0, height: 842 })).toBeUndefined();
    expect(resolveZoom(FIT_WIDTH, { width: 827, height: 400 }, { width: 595, height: 0 })).toBeUndefined();
    // A box smaller than the gutter has no room at all, which is the same state
    // arriving from the other side.
    expect(resolveZoom(FIT_WIDTH, { width: 8, height: 400 }, A4)).toBeUndefined();
  });

  it('clamps a fit into the ladder, so every fit is a scale the controls can leave', () => {
    const huge = resolveZoom(FIT_WIDTH, { width: 100_000, height: 100_000 }, A4);
    expect(huge).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    const tiny = resolveZoom(FIT_WIDTH, { width: 60, height: 60 }, A4);
    expect(tiny).toBe(ZOOM_STEPS[0]);
  });
});

describe('the ladder', () => {
  it('steps to the next member above and below what is SHOWN', () => {
    expect(zoomInFrom(1)).toStrictEqual({ kind: 'scale', scale: 1.25 });
    expect(zoomOutFrom(1)).toStrictEqual({ kind: 'scale', scale: 0.75 });
  });

  it('steps out of a fit onto the ladder, not onto the fits own number', () => {
    // A reader at fit-width showing 1.336 presses `+` and gets 1.5 — a preset,
    // and a mode that no longer moves when the window does. This is the whole
    // reason the step takes the shown scale rather than the mode.
    expect(zoomInFrom(1.336)).toStrictEqual({ kind: 'scale', scale: 1.5 });
    expect(zoomOutFrom(1.336)).toStrictEqual({ kind: 'scale', scale: 1.25 });
  });

  it('holds at the ends rather than wrapping', () => {
    const top = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 4;
    expect(zoomInFrom(top)).toStrictEqual({ kind: 'scale', scale: top });
    expect(zoomOutFrom(ZOOM_STEPS[0])).toStrictEqual({ kind: 'scale', scale: ZOOM_STEPS[0] });
  });

  it('CONTROL: the ladder is ordered and has no duplicates, so find() means what it reads', () => {
    // `zoomIn` takes the FIRST member greater than the current scale, which is
    // the next one only if the list ascends. An unordered list would make both
    // functions return a member that is merely somewhere above or below, and
    // every case above would still pass for the values it happens to use.
    const ascending = [...ZOOM_STEPS].every(
      (step, at) => at === 0 || step > (ZOOM_STEPS[at - 1] ?? Number.NEGATIVE_INFINITY),
    );
    expect(ascending).toBe(true);
    expect(new Set(ZOOM_STEPS).size).toBe(ZOOM_STEPS.length);
  });
});
