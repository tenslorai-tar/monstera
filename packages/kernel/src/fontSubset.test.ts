import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Blob as HarfBuzzBlob, Face, Font } from 'harfbuzzjs';
import { describe, expect, it } from 'vitest';

import { embeddingOf, readFace } from './fontFaces.js';
import { namedSubset, subsetFont, subsetTag, withPostScriptName } from './fontSubset.js';

/**
 * The font reader and the subsetter, against the bundled faces (ADR-0172 Decisions 3 and 5).
 *
 * The faces come from the folder `vitest.config.mjs` passes as `MONSTERA_FONTS_DIRECTORY`. ABSENT IS A FAILURE, never
 * a skip, because a font test that passed without its font would be a could-not-look reading as a pass.
 */
function bundled(file: string): Uint8Array {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const path = join(folder, file);
  if (folder === '' || !existsSync(path)) throw new Error(`${file} is not provisioned at ${path}. Run: npm run provision:fonts`);
  return new Uint8Array(readFileSync(path));
}

const ARIMO = 'Arimo[wght].ttf';

function glyphOf(font: Uint8Array, character: string): number | undefined {
  return new Font(new Face(new HarfBuzzBlob(font))).nominalGlyph(character.codePointAt(0) ?? 0);
}

describe('embeddingOf, the licence rule', () => {
  it('uses an installable or editable face, subset unless the face forbids subsetting', () => {
    expect(embeddingOf(0)).toBe('subset');
    expect(embeddingOf(0x0008)).toBe('subset');
    expect(embeddingOf(0x0100)).toBe('whole');
    expect(embeddingOf(0x0108)).toBe('whole');
  });

  it('never uses a restricted, a preview-and-print, a bitmap-only face, or one stating nothing', () => {
    expect(embeddingOf(0x0002)).toBe('never');
    expect(embeddingOf(0x0004)).toBe('never');
    expect(embeddingOf(0x0200)).toBe('never');
    expect(embeddingOf(null)).toBe('never');
  });

  // CONTROL for the least-restrictive rule: preview-and-print alone is skipped, so a rule that refused ANY restriction
  // bit would also refuse this face, which the specification says is editable.
  it('takes the least restrictive permission where more than one is set', () => {
    expect(embeddingOf(0x0004 | 0x0008)).toBe('subset');
    expect(embeddingOf(0x0002 | 0x0004)).toBe('never');
  });
});

describe('readFace', () => {
  it('reads Arimo: family, weight, licence, its characters and its axis', () => {
    const face = readFace(bundled(ARIMO));
    expect(face).toMatchObject({ family: 'Arimo', postscript: 'Arimo-Regular', weight: 400, italic: false, embedding: 'subset' });
    expect(face.unicodes.has('A'.codePointAt(0) ?? 0)).toBe(true);
    expect(face.unicodes.has(0x25a1)).toBe(true);
    // CONTROL: a character no bundled Latin face carries, so the set is the face's and not every code point.
    expect(face.unicodes.has(0x4e2d)).toBe(false);
    expect(face.axes).toStrictEqual([{ tag: 'wght', min: 400, default: 400, max: 700 }]);
  });

  it('reads an italic face as italic, against the upright one above', () => {
    expect(readFace(bundled('Arimo-Italic[wght].ttf')).italic).toBe(true);
    expect(readFace(bundled('Tinos-BoldItalic.ttf'))).toMatchObject({ weight: 700, italic: true });
  });

  it('refuses bytes that are not a font, rather than answering a face that carries nothing', () => {
    expect(() => readFace(new TextEncoder().encode('not a font at all'))).toThrow(/no font face/u);
  });
});

describe('subsetFont', () => {
  const whole = bundled(ARIMO);

  it('keeps exactly the asked characters, as a static face far smaller than the whole', () => {
    // H e l l o, and the four distinct code points the subset must map.
    const subset = subsetFont(whole, { unicodes: [0x48, 0x65, 0x6c, 0x6c, 0x6f] });
    expect(subset).not.toBeNull();
    const face = readFace(subset ?? new Uint8Array());
    expect([...face.unicodes].sort((a, b) => a - b)).toStrictEqual([0x48, 0x65, 0x6c, 0x6f]);
    expect(face.axes).toStrictEqual([]);
    expect((subset ?? whole).length).toBeLessThan(whole.length / 20);
  });

  it('pins a variable face at the weight asked, and at its default otherwise', () => {
    const bold = readFace(subsetFont(whole, { unicodes: [0x41], axes: { wght: 700 } }) ?? new Uint8Array());
    // CONTROL: the same request with no axis named is the default instance.
    const regular = readFace(subsetFont(whole, { unicodes: [0x41] }) ?? new Uint8Array());
    expect(bold.weight).toBe(700);
    expect(regular.weight).toBe(400);
  });

  it('keeps glyph ids when asked, so a shaper’s ids from the whole face stay valid', () => {
    const fromWhole = glyphOf(whole, 'Z');
    const kept = subsetFont(whole, { glyphs: [fromWhole ?? 0], retainGlyphIds: true }) ?? new Uint8Array();
    // CONTROL: without the flag the subset renumbers, so the case above is about the flag.
    const renumbered = subsetFont(whole, { glyphs: [fromWhole ?? 0] }) ?? new Uint8Array();
    expect(fromWhole).toBeGreaterThan(1);
    expect(glyphOf(kept, 'Z')).toBe(fromWhole);
    expect(glyphOf(renumbered, 'Z')).not.toBe(fromWhole);
  });

  it('answers null for bytes HarfBuzz cannot subset, and a font for the real face', () => {
    expect(subsetFont(new TextEncoder().encode('not a font'), { unicodes: [0x41] })).toBeNull();
    expect(subsetFont(whole, { unicodes: [0x41] })).not.toBeNull();
  });
});

describe('namedSubset and withPostScriptName', () => {
  const whole = bundled(ARIMO);

  it('names a subset TAG+PostScript, readable under that name with its characters intact', () => {
    const named = namedSubset(whole, 'Arimo-Regular', { unicodes: [0x48, 0x69] });
    expect(named?.name).toMatch(/^[A-Z]{6}\+Arimo-Regular$/u);
    const face = readFace(named?.bytes ?? new Uint8Array());
    expect(face.postscript).toBe(named?.name);
    expect(face.unicodes.has(0x48) && face.unicodes.has(0x69)).toBe(true);
  });

  it('gives two different subsets two names, and the same subset the same name', () => {
    const first = namedSubset(whole, 'Arimo-Regular', { unicodes: [0x48] });
    const again = namedSubset(whole, 'Arimo-Regular', { unicodes: [0x48] });
    const other = namedSubset(whole, 'Arimo-Regular', { unicodes: [0x49] });
    expect(again?.name).toBe(first?.name);
    expect(other?.name).not.toBe(first?.name);
    expect(subsetTag(new Uint8Array([1, 2, 3]))).toMatch(/^[A-Z]{6}$/u);
  });

  it('writes a font whose checksums hold: the whole file sums to the specification’s magic number', () => {
    const renamed = withPostScriptName(subsetFont(whole, { unicodes: [0x41] }) ?? new Uint8Array(), 'ABCDEF+Arimo-Regular');
    let sum = 0;
    for (let at = 0; at < renamed.length; at += 4) {
      sum = (sum + (((renamed[at] ?? 0) << 24) | ((renamed[at + 1] ?? 0) << 16) | ((renamed[at + 2] ?? 0) << 8) | (renamed[at + 3] ?? 0))) >>> 0;
    }
    expect(sum).toBe(0xb1b0afba);
  });

  it('refuses a name PostScript does not allow', () => {
    const subset = subsetFont(whole, { unicodes: [0x41] }) ?? new Uint8Array();
    expect(() => withPostScriptName(subset, 'Arimo Regular')).toThrow(/not a PostScript name/u);
    expect(() => withPostScriptName(subset, 'Arimo(Regular)')).toThrow(/not a PostScript name/u);
  });
});
