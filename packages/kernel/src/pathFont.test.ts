import { describe, expect, it } from 'vitest';

import { MAX_PATH_GLYPHS, type PathGlyph, pathFontFor } from './pathFont.js';
import { ShapingFace } from './textShaping.js';

/**
 * The font built from drawn outlines (ADR-0238), read back by HarfBuzz, the reader the host and the editor share: every
 * character maps to a glyph whose width and outline are the ones written, so the font draws what PDFium drew.
 */
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

describe('pathFontFor (ADR-0238)', () => {
  it('maps each character to a glyph with the width and the outline it was drawn with', () => {
    const font = pathFontFor(
      new Map([
        [0x48, square],
        [0x6f, bowl],
      ]),
      metrics,
    );
    expect(font).not.toBeNull();
    const face = ShapingFace.readable(font ?? new Uint8Array());
    expect(face?.unitsPerEm).toBe(1000);
    const h = face?.glyphFor(0x48) ?? 0;
    const o = face?.glyphFor(0x6f) ?? 0;
    expect([h, o]).toStrictEqual([1, 2]);
    expect(face?.nominalAdvance(h)).toBe(600);
    expect(face?.nominalAdvance(o)).toBe(520);
    if (face === null) throw new Error('unreadable');
    expect(outlineOf(face, h)).toStrictEqual([
      ['M', 50, 0],
      ['L', 550, 0],
      ['L', 550, 500],
      ['L', 50, 500],
      // A CFF CONTOUR CLOSES ITSELF, and HarfBuzz reports the closing side as a line back to its start.
      ['L', 50, 0],
      ['Z'],
    ]);
    expect(outlineOf(face, o)).toStrictEqual([
      ['M', 260, -10],
      ['C', 400, -10, 480, 100, 480, 250],
      ['C', 480, 400, 400, 510, 260, 510],
      ['C', 120, 510, 40, 400, 40, 250],
      ['C', 40, 100, 120, -10, 260, -10],
      ['Z'],
    ]);
    // CONTROL: a character not drawn is mapped to nothing, so a letter the person types falls to the kind of face.
    expect(face.glyphFor(0x61)).toBeUndefined();
  });

  it('builds nothing from nothing, or from more characters than one page sets', () => {
    expect(pathFontFor(new Map(), metrics)).toBeNull();
    const many = new Map(Array.from({ length: MAX_PATH_GLYPHS + 1 }, (_, at): [number, PathGlyph] => [0x4e00 + at, square]));
    expect(pathFontFor(many, metrics)).toBeNull();
  });
});
