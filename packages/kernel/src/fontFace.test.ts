import { describe, expect, it } from 'vitest';

import { type FontFacts, faceOf, programFace } from './fontFace.js';

/**
 * A minimal `sfnt`: the version, one table record, and an `OS/2` table of `length` bytes carrying `weightClass` at
 * offset 4 and `selection` at offset 62. Built by numbers, the way the reader reads it.
 */
function sfnt(weightClass: number, selection: number, options: { version?: number; length?: number } = {}): Uint8Array {
  const length = options.length ?? 96;
  const bytes = new Uint8Array(12 + 16 + length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, options.version ?? 0x00010000);
  view.setUint16(4, 1);
  view.setUint32(12, 0x4f532f32);
  view.setUint32(12 + 8, 28);
  view.setUint32(12 + 12, length);
  if (length >= 64) {
    view.setUint16(28 + 4, weightClass);
    view.setUint16(28 + 62, selection);
  }
  return bytes;
}

describe('programFace: what an embedded TrueType or OpenType program says about itself', () => {
  it('reads OS/2’s weight class and its italic bit', () => {
    expect(programFace(sfnt(700, 1))).toStrictEqual({ weightClass: 700, italic: true });
    expect(programFace(sfnt(400, 0))).toStrictEqual({ weightClass: 400, italic: false });
  });

  it('counts the OBLIQUE bit as italic, and reads a CFF-flavoured OpenType program', () => {
    expect(programFace(sfnt(400, 512))?.italic).toBe(true);
    expect(programFace(sfnt(600, 0, { version: 0x4f54544f }))?.weightClass).toBe(600);
  });

  it('answers NOTHING for what is not such a program, or whose OS/2 is cut short — never a weight read from elsewhere', () => {
    // A Type 1 program begins `%!PS`; a collection `ttcf`; neither is a single table directory.
    expect(programFace(new TextEncoder().encode('%!PS-AdobeFont-1.0: Probe'))).toBeUndefined();
    expect(programFace(sfnt(700, 0, { version: 0x74746366 }))).toBeUndefined();
    expect(programFace(sfnt(700, 0, { length: 40 }))).toBeUndefined();
    expect(programFace(sfnt(700, 0).subarray(0, 50))).toBeUndefined();
    expect(programFace(new Uint8Array(0))).toBeUndefined();
  });
});

/** The facts PDFium answers for a standard font, measured: weight 0, flags 32. */
const standard = (name: string): FontFacts => ({ program: undefined, weight: 0, flags: 32, name });

describe('faceOf: bold and italic from the first witness that speaks (N4, the owner’s Part A item 3)', () => {
  it('THE PROGRAM DECIDES over the descriptor and the name', () => {
    // Roboto-Bold as the owner's page drew it: embedded, its stems estimating 415, its program saying 700.
    expect(faceOf({ program: { weightClass: 700, italic: false }, weight: 415, flags: 4, name: 'Roboto-Bold' })).toStrictEqual({
      bold: true,
      italic: false,
    });
    // AND OVERRULES A NAME: a program that says regular upright is regular upright, whatever it is called.
    expect(
      faceOf({ program: { weightClass: 400, italic: false }, weight: 700, flags: 64, name: 'Probe-BoldItalic' }),
    ).toStrictEqual({ bold: false, italic: false });
  });

  it('WITHOUT A PROGRAM, the descriptor decides — and the name is not read beside it', () => {
    expect(faceOf({ program: undefined, weight: 764, flags: 4, name: 'Nunito-Bold' }).bold).toBe(true);
    expect(faceOf({ program: undefined, weight: 470, flags: 4, name: 'Nunito-Regular' }).bold).toBe(false);
    // THE CASE THE OLD RULE GOT WRONG: a descriptor that says regular, a name that says bold. The old rule read
    // `weight >= 600 || force-bold || name` and answered bold here.
    expect(faceOf({ program: undefined, weight: 400, flags: 32, name: 'Probe-Bold' })).toStrictEqual({ bold: false, italic: false });
    expect(faceOf({ program: undefined, weight: 400, flags: 32 + 262_144, name: 'Probe' }).bold).toBe(true);
    expect(faceOf({ program: undefined, weight: 400, flags: 32 + 64, name: 'Probe' }).italic).toBe(true);
  });

  it('WITH NO DESCRIPTOR AT ALL — a standard font — the name is the only witness, and it is read', () => {
    expect(faceOf(standard('Helvetica'))).toStrictEqual({ bold: false, italic: false });
    expect(faceOf(standard('Helvetica-Bold'))).toStrictEqual({ bold: true, italic: false });
    expect(faceOf(standard('Helvetica-Oblique'))).toStrictEqual({ bold: false, italic: true });
    expect(faceOf(standard('Times-BoldItalic'))).toStrictEqual({ bold: true, italic: true });
  });
});
