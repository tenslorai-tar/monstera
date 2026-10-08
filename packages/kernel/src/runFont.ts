import { MAX_RUN_FONT_BYTES } from '@monstera/contract/host';

import { subsetFont } from './fontSubset.js';
import { ShapingFace } from './textShaping.js';

/**
 * The font the editor draws a run in, built in the PDFium host from the run's own program
 * ([ADR-0175](../../../docs/DECISIONS/0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)).
 *
 * Pure but for HarfBuzz: what PDFium draws for each character arrives as {@link DrawnGlyph}s the caller read, so the rule
 * is proven against fixtures with no PDFium, and the PDFium host answers it with the library's own readings.
 *
 * ## The check is the decision
 *
 * A program's `cmap` names glyphs, and a PDF draws by codes it maps for itself; a producer that rewrote codes leaves a
 * `cmap` naming other glyphs than the page draws. So every character the run holds is compared, the program's `cmap`
 * glyph against PDFium's, by two readings that do not depend on each other: the ink box, edge by edge, and the advance.
 * Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build: on an Arimo subset all six characters read agree to 0.00
 * thousandths of an em on every edge and to 0.75 on the advance, and the same H in PDFium's Helvetica substitute differs
 * by 5 on its left edge. Segment counts do not compare: PDFium splits a quadratic outline into cubics.
 */

/** What PDFium draws for one character: in thousandths of an em, its advance and its ink box, `null` where it draws none. */
export interface DrawnGlyph {
  readonly advance: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
}

/** How far, in thousandths of an em, a reading may differ and still be the same glyph: one, past the 0.75 measured. */
export const SAME_GLYPH_TOLERANCE = 1;

/** The sfnt tags a browser loads as a font: TrueType (`0x00010000`, `true`) and OpenType with CFF (`OTTO`). */
const SFNT_TAGS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/** Whether `program` is an sfnt a browser can load: its first four bytes, read as one tag. */
export function isSfnt(program: Uint8Array): boolean {
  if (program.length < 12) return false;
  const tag = (((program[0] ?? 0) << 24) | ((program[1] ?? 0) << 16) | ((program[2] ?? 0) << 8) | (program[3] ?? 0)) >>> 0;
  return SFNT_TAGS.has(tag);
}

/**
 * The font the run is drawn in, or `null` where it has none: `program` is not an sfnt, a character `drawn` names is one
 * its `cmap` maps to no glyph or to a glyph that does not read as PDFium's, HarfBuzz refuses it, or the rebuilt font is
 * past {@link MAX_RUN_FONT_BYTES}. Rebuilt whole, every glyph its `cmap` maps, so a letter typed that the page held
 * nowhere draws in it too, with the hinting left out (`dropHinting`).
 *
 * @param drawn what PDFium draws for every character the run holds, by code point
 */
export function runFontFor(program: Uint8Array, drawn: ReadonlyMap<number, DrawnGlyph>): Uint8Array | null {
  if (!isSfnt(program) || drawn.size === 0) return null;
  // A PROGRAM HARFBUZZ CANNOT READ has no font to offer, and the editor draws the run in its kind of face, which is the
  // answer for every program this module declines.
  const face = ShapingFace.readable(program);
  if (face === null) return null;
  const scale = 1000 / face.unitsPerEm;
  for (const [point, glyph] of drawn) {
    const id = face.glyphFor(point);
    if (id === undefined || id === 0) return null;
    if (Math.abs(face.nominalAdvance(id) * scale - glyph.advance) > SAME_GLYPH_TOLERANCE) return null;
    const ink = inkOf(face, id, scale);
    if (glyph.box === null || ink === null) {
      if (glyph.box !== ink) return null;
      continue;
    }
    for (const edge of ['x0', 'y0', 'x1', 'y1'] as const) {
      if (Math.abs(ink[edge] - glyph.box[edge]) > SAME_GLYPH_TOLERANCE) return null;
    }
  }
  const rebuilt = subsetFont(program, { unicodes: face.unicodes(), dropHinting: true });
  return rebuilt === null || rebuilt.length > MAX_RUN_FONT_BYTES ? null : rebuilt;
}

/**
 * A glyph's ink box in thousandths of an em, from every point of its outline: the box a glyph table states and the one
 * PDFium's path points span (measured equal above). `null` for a glyph that draws nothing.
 */
function inkOf(face: ShapingFace, glyph: number, scale: number): DrawnGlyph['box'] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of face.outline(glyph)) {
    for (let at = 0; at + 1 < command.values.length; at += 2) {
      xs.push(command.values[at] ?? 0);
      ys.push(command.values[at + 1] ?? 0);
    }
  }
  if (xs.length === 0) return null;
  return {
    x0: Math.min(...xs) * scale,
    y0: Math.min(...ys) * scale,
    x1: Math.max(...xs) * scale,
    y1: Math.max(...ys) * scale,
  };
}
