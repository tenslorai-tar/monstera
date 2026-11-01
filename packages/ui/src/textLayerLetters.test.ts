import { describe, expect, it } from 'vitest';

import { engineBoxOnScreen } from './annotations/annotationSpace.js';
import { bandPlace, caretAt, letterAt, letterRun, spanEnd, spanShape } from './textLayerLetters.js';

/**
 * The text layer's one geometry (ADR-0280, Decisions 4 to 6), pure: a line's letters on screen, the caret a point means
 * (rule (ii)) and a span's shape (rule (i)). Upright and turned, at two zooms, through the page's own conversion.
 */

const UPRIGHT = { crop: [0, 0, 612, 792] as const, rotation: 0 as const, zoom: 1 };

/** Four letters, 10, 20, 0 (a pair's second unit) and 5 points wide, from (72.4, 91.3) along x. */
const LETTERS = { origin: { x: 72.4, y: 91.3 }, direction: { x: 1, y: 0 }, size: 11, advances: [1000, 2000, 0, 500] };

describe('the text layer’s letters on screen (ADR-0280)', () => {
  it('places each edge along the line from the origin, through the page’s conversion', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    expect(run.origin.x).toBeCloseTo(72.4, 9);
    expect(run.origin.y).toBeCloseTo(91.3, 9);
    expect(run.edges.map((edge) => Number(edge.toFixed(6)))).toStrictEqual([0, 10, 30, 30, 35]);
  });

  it('is null for a line placed as before, and for advances that are not one per unit of its text', () => {
    expect(letterRun(undefined, 4, UPRIGHT)).toBeNull();
    expect(letterRun(LETTERS, 5, UPRIGHT)).toBeNull();
  });

  it('RULE (ii): a point on a letter’s first half is before it, on its second half after it', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    const y = 88;
    expect(caretAt(run, { x: 72.4 + 4, y })).toBe(0);
    expect(caretAt(run, { x: 72.4 + 6, y })).toBe(1);
    expect(caretAt(run, { x: 72.4 + 19, y })).toBe(1);
    expect(caretAt(run, { x: 72.4 + 21, y })).toBe(3);
    // BEFORE THE FIRST and PAST THE LAST.
    expect(caretAt(run, { x: 10, y })).toBe(0);
    expect(caretAt(run, { x: 500, y })).toBe(4);
  });

  it('RULE (ii): never between a pair’s two halves, whose second advances 0', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    // AT THE PAIR'S EDGE (30 points along) the caret is after both halves, 3, never 2.
    expect(caretAt(run, { x: 72.4 + 29.9, y: 88 })).toBe(3);
  });

  it('RULE (i): a span’s shape runs from its first letter’s start to its last letter’s end, on the line', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    const shape = spanShape(run, 1, 3);
    if (shape === null) throw new Error('no shape');
    expect(Number(spanEnd(shape, 'from').x.toFixed(6))).toBe(82.4);
    expect(Number(spanEnd(shape, 'to').x.toFixed(6))).toBe(102.4);
    expect(spanShape(run, 2, 2)).toBeNull();
  });

  it('THE LETTER a point is on, for a double click: the unit whose advance holds it, a pair by its first unit', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    const y = 88;
    expect(letterAt(run, { x: 72.4 + 9.9, y })).toBe(0);
    expect(letterAt(run, { x: 72.4 + 10, y })).toBe(1);
    // THE PAIR is units 1 and 2: its first spans 10 to 30 and its second advances 0, so no point is on the second.
    expect(letterAt(run, { x: 72.4 + 29.9, y })).toBe(1);
    expect(letterAt(run, { x: 72.4 + 31, y })).toBe(3);
    // BEFORE THE FIRST and PAST THE LAST, the first and last letter.
    expect(letterAt(run, { x: 10, y })).toBe(0);
    expect(letterAt(run, { x: 500, y })).toBe(3);
  });

  it('THE BAND: on, before, after and off a line, at its own angle', () => {
    const run = letterRun(LETTERS, 4, UPRIGHT);
    if (run === null) throw new Error('no run');
    // THE BAND runs from 0.25 of the size below the baseline (91.3) to 0.9 above it; y runs down the screen.
    expect(bandPlace(run, { x: 80, y: 91.3 - 5 }).place).toBe('on');
    const before = bandPlace(run, { x: 60, y: 91.3 - 5 });
    expect(before.place).toBe('before');
    expect(before.distance).toBeCloseTo(12.4, 9);
    expect(bandPlace(run, { x: 72.4 + 40, y: 91.3 - 5 }).place).toBe('after');
    expect(bandPlace(run, { x: 80, y: 91.3 - 11 }).place).toBe('off');
    expect(bandPlace(run, { x: 80, y: 91.3 + 3 }).place).toBe('off');
    // ON A LINE RUNNING DOWN THE SCREEN, a point down it is on it and one well across it is off it.
    const down = letterRun({ ...LETTERS, direction: { x: 0, y: 1 } }, 4, UPRIGHT);
    if (down === null) throw new Error('no run down the page');
    expect(bandPlace(down, { x: 72.4 + 4, y: 91.3 + 20 }).place).toBe('on');
    expect(bandPlace(down, { x: 72.4 + 20, y: 91.3 + 20 }).place).toBe('off');
  });

  it('follows the page’s turn and zoom: at 90 degrees and twice the size, the line runs down the screen', () => {
    const turned = { crop: [0, 0, 612, 792] as const, rotation: 90 as const, zoom: 2 };
    // THE LINE IN DISPLAY SPACE OF THE TURNED PAGE, as the engine reports it there: along x from its origin.
    const run = letterRun(LETTERS, 4, turned);
    if (run === null) throw new Error('no run');
    // ITS ORIGIN WHERE THE PAGE'S OWN BOX CONVERSION PUTS THE SAME POINT, and twice the points along.
    const box = engineBoxOnScreen({ x0: 72.4, y0: 91.3, x1: 72.4, y1: 91.3 }, turned);
    expect(run.origin.x).toBeCloseTo(box.left, 6);
    expect(run.origin.y).toBeCloseTo(box.top, 6);
    expect(run.edges.at(-1)).toBeCloseTo(70, 6);
    const length = Math.hypot(run.along.x, run.along.y);
    expect(length).toBeCloseTo(1, 9);
  });
});
