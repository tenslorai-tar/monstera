import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Blob as HarfBuzzBlob, Face } from 'harfbuzzjs';
import { describe, expect, it } from 'vitest';

import { subsetFont } from './fontSubset.js';
import { type DrawnGlyph, isSfnt, runFontFor } from './runFont.js';
import { ShapingFace } from './textShaping.js';

/**
 * The font the editor draws a run in (ADR-0175), against a hinted bundled face standing for a document's program.
 * ABSENT IS A FAILURE, never a skip, `fontSubset.test.ts`' rule.
 */
function bundled(file: string): Uint8Array {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const path = join(folder, file);
  if (folder === '' || !existsSync(path)) throw new Error(`${file} is not provisioned at ${path}. Run: npm run provision:fonts`);
  return new Uint8Array(readFileSync(path));
}

/** A document's program: a subset of the hinted Carlito, as a producer embeds one, hinting kept. */
const PROGRAM = subsetFont(bundled('Carlito-Regular.ttf'), { unicodes: Array.from('Hello world', (c) => c.codePointAt(0) ?? 0) });

function program(): Uint8Array {
  if (PROGRAM === null) throw new Error('HarfBuzz refused the fixture subset');
  return PROGRAM;
}

/**
 * What PDFium would read for each of `text`'s characters if it drew the program's own glyphs: the program's advance and
 * ink box, in thousandths. The agreeing reading, which each case below moves away from in one way.
 */
function drawnAsTheProgram(text: string): Map<number, DrawnGlyph> {
  const face = new ShapingFace(program(), 0, {});
  const scale = 1000 / face.unitsPerEm;
  const drawn = new Map<number, DrawnGlyph>();
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    const glyph = face.glyphFor(point) ?? 0;
    const values = face.outline(glyph).flatMap((command) => command.values);
    const xs = values.filter((_, at) => at % 2 === 0);
    const ys = values.filter((_, at) => at % 2 === 1);
    drawn.set(point, {
      advance: face.nominalAdvance(glyph) * scale,
      box:
        xs.length === 0
          ? null
          : { x0: Math.min(...xs) * scale, y0: Math.min(...ys) * scale, x1: Math.max(...xs) * scale, y1: Math.max(...ys) * scale },
    });
  }
  return drawn;
}

function tables(font: Uint8Array): string[] {
  const face = new Face(new HarfBuzzBlob(font), 0);
  return ['fpgm', 'prep', 'cvt '].filter((tag) => (face.referenceTable(tag)?.length ?? 0) > 0);
}

describe('runFontFor', () => {
  /**
   * WHERE EVERY CHARACTER READS AS PDFium's GLYPH the run has a font: an sfnt, mapping the program's whole cmap, and with
   * the hinting gone. CONTROL: the program carries the three hinting tables, so their absence is the rebuild's doing.
   */
  it('rebuilds a program whose glyphs read as the page’s, mapping its whole cmap, with the hinting dropped', () => {
    expect(tables(program())).toStrictEqual(['fpgm', 'prep', 'cvt ']);
    const font = runFontFor(program(), drawnAsTheProgram('Hello'));
    expect(font).not.toBeNull();
    if (font === null) return;
    expect(isSfnt(font)).toBe(true);
    expect(tables(font)).toStrictEqual([]);
    // EVERY GLYPH THE PROGRAM MAPS, not only the run's: `w`, `r` and `d` are typed letters the run did not hold.
    const rebuilt = new ShapingFace(font, 0, {});
    expect(Array.from('Helloworld').every((c) => (rebuilt.glyphFor(c.codePointAt(0) ?? 0) ?? 0) > 0)).toBe(true);
  });

  /** A GLYPH THAT DOES NOT READ AS THE PAGE'S declines the whole run, by either reading, past the tolerance alone. */
  it('declines a run where one character’s advance or ink differs by more than a thousandth', () => {
    const wide = drawnAsTheProgram('Hello');
    const e = 'e'.codePointAt(0) ?? 0;
    const glyph = wide.get(e);
    if (glyph?.box == null) throw new Error('the fixture has no ink for e');
    // A QUARTER EITHER SIDE OF THE TOLERANCE (SSSSSSS-7): +2 and +0.5 left any tolerance from 0.5 to 2 green.
    wide.set(e, { ...glyph, advance: glyph.advance + 1.25 });
    expect(runFontFor(program(), wide)).toBeNull();
    const shifted = drawnAsTheProgram('Hello');
    shifted.set(e, { ...glyph, box: { ...glyph.box, x0: glyph.box.x0 + 1.25 } });
    expect(runFontFor(program(), shifted)).toBeNull();
    // CONTROL: three quarters of a thousandth is the same glyph, so the declines above are the tolerance's.
    const near = drawnAsTheProgram('Hello');
    near.set(e, { ...glyph, advance: glyph.advance + 0.75, box: { ...glyph.box, x0: glyph.box.x0 + 0.75 } });
    expect(runFontFor(program(), near)).not.toBeNull();
  });

  it('declines a run holding a character the program’s cmap does not map, and a glyph PDFium draws no ink for', () => {
    const missing = drawnAsTheProgram('Hello');
    missing.set('Q'.codePointAt(0) ?? 0, { advance: 500, box: { x0: 0, y0: 0, x1: 400, y1: 600 } });
    expect(runFontFor(program(), missing)).toBeNull();
    const blank = drawnAsTheProgram('Hello');
    const h = 'H'.codePointAt(0) ?? 0;
    blank.set(h, { advance: blank.get(h)?.advance ?? 0, box: null });
    expect(runFontFor(program(), blank)).toBeNull();
  });

  /** A PROGRAM A BROWSER CANNOT LOAD has no font: bare CFF, as PDFium's substitute for a font not embedded is. */
  it('declines a program that is not an sfnt, and one HarfBuzz cannot read', () => {
    const bareCff = new Uint8Array([0x01, 0x00, 0x04, 0x02, ...new Array<number>(64).fill(0)]);
    expect(isSfnt(bareCff)).toBe(false);
    expect(runFontFor(bareCff, drawnAsTheProgram('H'))).toBeNull();
    const broken = new Uint8Array([0x00, 0x01, 0x00, 0x00, ...new Array<number>(64).fill(0)]);
    expect(isSfnt(broken)).toBe(true);
    expect(runFontFor(broken, drawnAsTheProgram('H'))).toBeNull();
  });
});
