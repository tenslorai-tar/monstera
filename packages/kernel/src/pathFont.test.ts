import { describe, expect, it } from 'vitest';

import { type PathGlyph, cffProgram, stepsOfOutline } from './pathFont.js';
import { ShapingFace } from './textShaping.js';

/** A font written from outlines alone, read back by HarfBuzz: each glyph's width and outline are the ones written. */
const square: PathGlyph = {
  advance: 600,
  steps: [
    { kind: 'move', x: 50, y: 0 },
    { kind: 'line', x: 550, y: 0 },
    { kind: 'line', x: 550, y: 500 },
    { kind: 'line', x: 50, y: 500 },
  ],
};
const bowl: PathGlyph = {
  advance: 520.4,
  steps: [
    { kind: 'move', x: 260, y: -10 },
    { kind: 'curve', x1: 400, y1: -10, x2: 480, y2: 100, x: 480, y: 250 },
    { kind: 'curve', x1: 480, y1: 400, x2: 400, y2: 510.2, x: 260, y: 510 },
    { kind: 'curve', x1: 120, y1: 510, x2: 40, y2: 400, x: 40, y: 250 },
    { kind: 'curve', x1: 40, y1: 100, x2: 120, y2: -10, x: 260, y: -10 },
  ],
};
const metrics = { ascender: 900, descender: -250 };

/** HarfBuzz's outline for a glyph as `[command, ...values]`, values rounded to whole units. */
function outlineOf(face: ShapingFace, glyph: number): (string | number)[][] {
  return face.outline(glyph).map((command) => [command.type, ...command.values.map((value) => Math.round(value))]);
}

describe('cffProgram', () => {
  it('holds each outline as its glyph, in order, with the width and the outline it was given', () => {
    const font = cffProgram([{ advance: 0, steps: [] }, square, bowl], metrics, 'MonsteraTest');
    const face = ShapingFace.readable(font);
    if (face === null) throw new Error('unreadable');
    expect(face.unitsPerEm).toBe(1000);
    expect(face.nominalAdvance(1)).toBe(600);
    expect(face.nominalAdvance(2)).toBe(520);
    expect(outlineOf(face, 1)).toStrictEqual([
      ['M', 50, 0],
      ['L', 550, 0],
      ['L', 550, 500],
      ['L', 50, 500],
      // A CFF CONTOUR CLOSES ITSELF, and HarfBuzz reports the closing side as a line back to its start.
      ['L', 50, 0],
      ['Z'],
    ]);
    expect(outlineOf(face, 2)).toStrictEqual([
      ['M', 260, -10],
      ['C', 400, -10, 480, 100, 480, 250],
      ['C', 480, 400, 400, 510, 260, 510],
      ['C', 120, 510, 40, 400, 40, 250],
      ['C', 40, 100, 120, -10, 260, -10],
      ['Z'],
    ]);
    // CONTROL: glyph 0 is the empty .notdef it was given, so the order is the caller's and not a sort.
    expect(outlineOf(face, 0)).toStrictEqual([]);
  });
});


describe('stepsOfOutline', () => {
  it('scales an outline and turns a quadratic into the cubic that draws the same curve', () => {
    const steps = stepsOfOutline(
      [
        { type: 'M', values: [0, 0] },
        { type: 'Q', values: [30, 60, 90, 0] },
        { type: 'C', values: [1, 2, 3, 4, 5, 6] },
        { type: 'Z', values: [] },
      ],
      2,
    );
    // THE TWO-THIRDS RULE from the current point and from the end toward the control (60, 120): (40, 80) and (100, 80),
    // at double scale.
    expect(steps).toStrictEqual([
      { kind: 'move', x: 0, y: 0 },
      { kind: 'curve', x1: 40, y1: 80, x2: 100, y2: 80, x: 180, y: 0 },
      { kind: 'curve', x1: 2, y1: 4, x2: 6, y2: 8, x: 10, y: 12 },
    ]);
  });

  it('starts a quadratic after a close from the contour it closed, not from the last point drawn', () => {
    const steps = stepsOfOutline(
      [
        { type: 'M', values: [0, 0] },
        { type: 'L', values: [90, 0] },
        { type: 'Z', values: [] },
        { type: 'Q', values: [0, 30, 0, 90] },
      ],
      1,
    );
    // From (0, 0), the contour's start: controls (0, 20) and (0, 50). CONTROL: from (90, 0) the first would be (30, 20).
    expect(steps.at(-1)).toStrictEqual({ kind: 'curve', x1: 0, y1: 20, x2: 0, y2: 50, x: 0, y: 90 });
  });
});
