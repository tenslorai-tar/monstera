import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOX, boxFont } from './boxFont.js';
import { KEPT_NAME_IDS, nameRecordsOf, subsetFont } from './fontSubset.js';
import { ShapingFace } from './textShaping.js';

/**
 * The box font (ADR-0173 Decision 7 as corrected), against the bundled Arimo. ABSENT IS A FAILURE, never a skip,
 * `fontSubset.test.ts`' rule.
 */
function bundled(file: string): Uint8Array {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const path = join(folder, file);
  if (folder === '' || !existsSync(path)) throw new Error(`${file} is not provisioned at ${path}. Run: npm run provision:fonts`);
  return new Uint8Array(readFileSync(path));
}

const ARIMO = bundled('Arimo[wght].ttf');
const ZHONG = 0x4e2d;

describe('boxFont', () => {
  /**
   * THE REAL CHARACTER MAPS TO THE BOX GLYPH, and nothing else maps to anything: PDFium's ToUnicode is this cmap, so a
   * font that still mapped U+25A1 would read as the box and not as the character. CONTROL: the plain subset maps
   * U+25A1 to that same glyph and the character to nothing, so the remapping is this function's doing.
   */
  it('maps the character it stands for, and only that, to the box glyph', () => {
    const font = boxFont(ARIMO, 0, { wght: 400 }, 'Arimo-Regular-wght400', ZHONG);
    if (font === null) throw new Error('Arimo carries U+25A1, so a box font should have been made');
    const shaping = new ShapingFace(font.bytes, 0, {});
    const plain = subsetFont(ARIMO, { unicodes: [BOX], faceIndex: 0, axes: { wght: 400 } });
    if (plain === null) throw new Error('the plain subset should have been made');
    const plainShaping = new ShapingFace(plain, 0, {});
    const boxGlyph = plainShaping.glyphFor(BOX);

    expect(boxGlyph).toBeGreaterThan(0);
    expect(shaping.glyphFor(ZHONG)).toBe(boxGlyph);
    expect(shaping.glyphFor(BOX)).toBeUndefined();
    expect(plainShaping.glyphFor(ZHONG)).toBeUndefined();
  });

  /**
   * ONE NAME PER CHARACTER: PDFium writes fonts of one name as one resource, and two box fonts of one subset were
   * measured to read as the first's character. Past the BMP too, which only a format 12 cmap can map.
   */
  it('names each character’s box font apart, past the BMP as well', () => {
    const zhong = boxFont(ARIMO, 0, { wght: 400 }, 'Arimo-Regular-wght400', ZHONG);
    const face = boxFont(ARIMO, 0, { wght: 400 }, 'Arimo-Regular-wght400', 0x1f600);
    if (zhong === null || face === null) throw new Error('both box fonts should have been made');
    expect(zhong.name).not.toBe(face.name);
    expect(zhong.name).toMatch(/^[A-Z]{6}\+Arimo-Regular-wght400-Box$/u);
    expect(new ShapingFace(face.bytes, 0, {}).glyphFor(0x1f600)).toBeGreaterThan(0);
  });

  it('keeps the face’s copyright and licence records, which an open font asks travel with it', () => {
    const font = boxFont(ARIMO, 0, { wght: 400 }, 'Arimo-Regular-wght400', ZHONG);
    if (font === null) throw new Error('the box font should have been made');
    const ids = nameRecordsOf(font.bytes, 0, KEPT_NAME_IDS).map((record) => record.id);
    // NOT TWO EMPTY SETS (SSSSSSS-8): the copyright notice and the licence are among what is compared.
    expect(ids).toEqual(expect.arrayContaining([0, 13]));
    expect(new Set(ids)).toStrictEqual(new Set(nameRecordsOf(ARIMO, 0, KEPT_NAME_IDS).map((record) => record.id)));
  });

  it('answers null for a face with no box glyph, so the caller tries the next face', () => {
    const noBox = subsetFont(ARIMO, { unicodes: [0x41], faceIndex: 0, axes: { wght: 400 } });
    if (noBox === null) throw new Error('the subset should have been made');
    expect(boxFont(noBox, 0, {}, 'Arimo', ZHONG)).toBeNull();
  });
});
