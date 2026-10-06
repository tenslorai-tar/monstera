/**
 * opentype.js 2.0.0, which ships no declaration of its own (its package names no `types`). `signatureFaces.ts` is the
 * one module that reads a font, and only the members it calls are declared, so a use of any other would not compile.
 * What each does is not taken from this file: `signatureFaces.test.ts` reads real faces through every member below.
 */
declare module 'opentype.js' {
  /** One drawing step of a glyph's outline: as `Glyph.path` holds it, in font units, y UP from the baseline. */
  export type PathCommand =
    | { readonly type: 'M' | 'L'; readonly x: number; readonly y: number }
    | { readonly type: 'Q'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
    | {
        readonly type: 'C';
        readonly x1: number;
        readonly y1: number;
        readonly x2: number;
        readonly y2: number;
        readonly x: number;
        readonly y: number;
      }
    | { readonly type: 'Z' };

  export interface Path {
    readonly commands: readonly PathCommand[];
  }

  export interface Glyph {
    /** The glyph's advance, in font units. */
    readonly advanceWidth: number | undefined;
    /** The glyph's own contours, as its font stores them: font units, origin at the glyph's, y up. */
    readonly path: Path;
  }

  export interface Font {
    readonly unitsPerEm: number;
    /** `hhea`'s ascender and descender, in font units; the descender is below the baseline, so negative. */
    readonly ascender: number;
    readonly descender: number;
    /** The glyph index the font's character map gives `character`; `0`, the missing glyph, when it gives none. */
    charToGlyphIndex(character: string): number;
    readonly glyphs: { get(index: number): Glyph };
    /** The pair adjustment between two of this font's glyphs, in font units. */
    getKerningValue(left: Glyph, right: Glyph): number;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
