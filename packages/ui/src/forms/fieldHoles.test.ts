import { describe, expect, it } from 'vitest';

import { fieldPressArea } from './fieldHoles.js';

const FIELD = { left: 0, top: 0, width: 100, height: 20 };

/** Whether a point of the field takes the press under a clip answer, by the browser's `evenodd` rule over its polygon. */
function takesPress(answer: ReturnType<typeof fieldPressArea>, x: number, y: number): boolean {
  if (answer === 'whole') return true;
  if (answer === 'none') return false;
  const points = [...answer.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/gu)].map((match) => [Number(match[1]), Number(match[2])] as const);
  let inside = false;
  for (let at = 0, before = points.length - 1; at < points.length; before = at, at += 1) {
    const [x1, y1] = points[at] ?? [0, 0];
    const [x0, y0] = points[before] ?? [0, 0];
    if (y1 > y !== y0 > y && x < ((x0 - x1) * (y - y1)) / (y0 - y1) + x1) inside = !inside;
  }
  return inside;
}

describe('fieldPressArea', () => {
  it('is the whole field where no comment overlaps it, and a comment touching its edge does not', () => {
    expect(fieldPressArea(FIELD, [{ left: 100, top: 0, width: 30, height: 20 }])).toBe('whole');
  });

  it('is nothing where comments cover the field', () => {
    expect(fieldPressArea(FIELD, [{ left: -5, top: -5, width: 200, height: 40 }])).toBe('none');
  });

  it('leaves a comment over part of the field to the tool and the rest to the field', () => {
    const answer = fieldPressArea(FIELD, [{ left: 60, top: -10, width: 80, height: 50 }]);
    expect(takesPress(answer, 20, 10)).toBe(true);
    expect(takesPress(answer, 80, 10)).toBe(false);
  });

  it('leaves the overlap of two comments to the tool, where a clip with a hole per comment fills it again', () => {
    const comments = [
      { left: 20, top: 2, width: 40, height: 16 },
      { left: 40, top: 2, width: 40, height: 16 },
    ];
    const answer = fieldPressArea(FIELD, comments);
    // THE OVERLAP: inside both comments. A hole-per-comment clip under evenodd answers true here.
    expect(takesPress(answer, 50, 10)).toBe(false);
    expect(takesPress(answer, 30, 10)).toBe(false);
    expect(takesPress(answer, 70, 10)).toBe(false);
    expect(takesPress(answer, 10, 10)).toBe(true);
    expect(takesPress(answer, 90, 10)).toBe(true);
    expect(takesPress(answer, 50, 1)).toBe(true);
  });
});
