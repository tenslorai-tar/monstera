import { KEPT_NAME_IDS, nameRecordsOf, subsetFont, subsetTag, withCmap, withPostScriptName } from './fontSubset.js';
import { ShapingFace } from './textShaping.js';

/** The missing-character box, U+25A1 WHITE SQUARE: the glyph drawn for a character no face carries (ADR-0172 Decision 8). */
export const BOX = 0x25a1;

/** A one-glyph font that draws the box for one character, and the name PDFium writes it under. */
export interface BoxFont {
  readonly bytes: Uint8Array;
  readonly name: string;
}

/**
 * The box font for `character` in `face`
 * ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 7 as corrected): the face's box glyph alone, with a cmap that maps the REAL character to it.
 *
 * ## Why the cmap and not a ToUnicode of ours
 *
 * PDFium builds a loaded font's ToUnicode from its cmap (measured 2026-10-05, PDFium 155 Linux), so a box font whose cmap
 * says *this glyph is 中* is saved with a ToUnicode that says the same, and PDFium, MuPDF and pdf.js read 中 under a drawn
 * box. Nothing is written after the save.
 *
 * ## One per character, and its name from its own bytes
 *
 * One glyph has one code, and one code reads as one text: two characters under one box font would read as one of them.
 * And PDFium writes fonts of one name as one resource, so two box fonts built from one subset were measured to read as
 * the first's character: the tag is taken from the bytes AFTER the cmap names the character, so each is its own.
 *
 * @param whole the face's file; `faceIndex` and `axes` choose and pin the face as its other pieces are
 * @param postscript the face's PostScript name, which the box font's name extends
 * @returns `null` where the face has no box glyph or HarfBuzz refuses the subset: the caller tries the next face
 */
export function boxFont(
  whole: Uint8Array,
  faceIndex: number,
  axes: Readonly<Record<string, number>>,
  postscript: string,
  character: number,
): BoxFont | null {
  const subset = subsetFont(whole, { unicodes: [BOX], faceIndex, axes });
  if (subset === null) return null;
  const glyph = new ShapingFace(subset, 0, {}).glyphFor(BOX);
  if (glyph === undefined || glyph === 0) return null;
  const remapped = withCmap(subset, [[character, glyph]]);
  const name = `${subsetTag(remapped)}+${postscript === '' ? 'Font' : postscript}-Box`;
  // THE NOTICE AND THE LICENCE TRAVEL WITH IT, read from the face, `namedSubset`'s rule.
  return { bytes: withPostScriptName(remapped, name, nameRecordsOf(whole, faceIndex, KEPT_NAME_IDS)), name };
}
