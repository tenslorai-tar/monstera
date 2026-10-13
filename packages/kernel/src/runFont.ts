import { MAX_RUN_FONT_BYTES } from '@monstera/contract/host';

import { subsetFont, tableTags, withBrowserTables, withCmap } from './fontSubset.js';
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

/**
 * What PDFium draws for one character: in thousandths of an em, its advance, its ink box (`null` where it draws none),
 * and every point of its path — on-curve and control alike, since PDFium's segments carry both.
 */
export interface DrawnGlyph {
  readonly advance: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  readonly points: readonly (readonly [number, number])[];
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
 * The font the run is drawn in, or `null` where it has none: `program` is not an sfnt, a character `drawn` names is
 * neither one its `cmap` maps to a glyph reading as PDFium's nor one whose glyph is found among the program's by its
 * shape, HarfBuzz refuses it, or the rebuilt font is past {@link MAX_RUN_FONT_BYTES}. The hinting is left out
 * (`dropHinting`) either way.
 *
 * Where the program's own `cmap` names every character, the font is rebuilt whole, every glyph that `cmap` maps, so a
 * letter typed that the page held nowhere draws in it too. Where it does not — a producer's subset — the rebuilt font
 * maps the page's characters alone, since only they have a glyph the page vouches for.
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
  const pairs: (readonly [number, number])[] = [];
  let ownCmap = true;
  let byAdvance: Map<number, number[]> | undefined;
  for (const [point, glyph] of drawn) {
    const id = face.glyphFor(point);
    if (id !== undefined && id !== 0 && sameGlyph(face, id, glyph, scale)) {
      pairs.push([point, id]);
      continue;
    }
    // THE PROGRAM'S CMAP DOES NOT NAME WHAT THE PAGE DRAWS: a producer's subset carries none, or one keyed by its own
    // codes (`producerSubsetFixture.ts`), and which glyph a character is lives in the PDF's ToUnicode alone. So the glyph
    // is found by its SHAPE among the program's own — its advance, its ink box, and every on-curve point of its outline
    // among the points PDFium draws, which tells a b from a d where the box alone would not.
    ownCmap = false;
    byAdvance ??= glyphsByAdvance(face, scale);
    const found = (byAdvance.get(Math.round(glyph.advance)) ?? []).find(
      (candidate) => sameGlyph(face, candidate, glyph, scale) && outlineAmong(face, candidate, glyph.points, scale),
    );
    if (found === undefined) return null;
    pairs.push([point, found]);
  }
  const rebuilt = ownCmap
    ? subsetFont(program, { unicodes: face.unicodes(), dropHinting: true })
    : mappedFont(program, face, pairs);
  return rebuilt === null || rebuilt.length > MAX_RUN_FONT_BYTES ? null : rebuilt;
}

/**
 * The program with a `cmap` naming exactly `pairs` — the characters the page draws and the glyphs found for them — and
 * the tables a browser requires that a producer's subset leaves out, then subset to those glyphs with the hinting left
 * out. A letter the page holds nowhere has no glyph the page vouches for, so it is not mapped, and the editor draws it
 * in the run's kind of face.
 */
function mappedFont(program: Uint8Array, face: ShapingFace, pairs: readonly (readonly [number, number])[]): Uint8Array | null {
  // A PROGRAM WITH NO HEAD TABLE cannot be written as a font (`withTables` refuses it): no font to offer.
  if (!tableTags(program).has('head')) return null;
  const points = pairs.map(([point]) => point);
  const metrics = face.metrics();
  const mapped = withBrowserTables(withCmap(program, pairs), 'MonsteraRunFont', {
    ascender: Math.round(metrics.ascender),
    descender: Math.round(metrics.descender),
    firstChar: Math.min(...points),
    lastChar: Math.max(...points),
  });
  return subsetFont(mapped, { unicodes: points, dropHinting: true });
}

/** Whether glyph `id` reads as `glyph`: its advance and every edge of its ink box within {@link SAME_GLYPH_TOLERANCE}. */
function sameGlyph(face: ShapingFace, id: number, glyph: DrawnGlyph, scale: number): boolean {
  if (Math.abs(face.nominalAdvance(id) * scale - glyph.advance) > SAME_GLYPH_TOLERANCE) return false;
  const ink = inkOf(face, id, scale);
  const { box } = glyph;
  if (box === null || ink === null) return box === ink;
  return (['x0', 'y0', 'x1', 'y1'] as const).every((edge) => Math.abs(ink[edge] - box[edge]) <= SAME_GLYPH_TOLERANCE);
}

/** Every glyph the face holds, by its advance rounded to a thousandth of an em, so a search compares only the near. */
function glyphsByAdvance(face: ShapingFace, scale: number): Map<number, number[]> {
  const index = new Map<number, number[]>();
  for (let id = 1; id < face.glyphCount(); id += 1) {
    const advance = Math.round(face.nominalAdvance(id) * scale);
    // EITHER SIDE OF THE ROUNDING, so an advance on a half lands in the bucket the drawn one rounds to.
    for (const key of [advance - 1, advance, advance + 1]) {
      const bucket = index.get(key);
      if (bucket === undefined) index.set(key, [id]);
      else bucket.push(id);
    }
  }
  return index;
}

/**
 * Whether every on-curve point of glyph `id`'s outline is one of `points`, within {@link SAME_GLYPH_TOLERANCE}.
 *
 * A CONTOUR WITH NO EXTENT is left out: it draws no ink, and PDFium's path leaves it out — measured 2026-10-13 on
 * Carlito's full stop, whose outline opens with a one-point contour (`M 65,0 L 65,0`) PDFium's 49 points do not hold.
 */
function outlineAmong(face: ShapingFace, id: number, points: readonly (readonly [number, number])[], scale: number): boolean {
  const contours: (readonly [number, number])[][] = [];
  for (const command of face.outline(id)) {
    if (command.values.length < 2) continue;
    const end = [(command.values[command.values.length - 2] ?? 0) * scale, (command.values[command.values.length - 1] ?? 0) * scale] as const;
    if (command.type === 'M' || contours.length === 0) contours.push([end]);
    else contours[contours.length - 1]?.push(end);
  }
  return contours
    .filter((contour) => contour.some(([x, y]) => x !== contour[0]?.[0] || y !== contour[0][1]))
    .every((contour) =>
      contour.every(([x, y]) => points.some(([px, py]) => Math.abs(px - x) <= SAME_GLYPH_TOLERANCE && Math.abs(py - y) <= SAME_GLYPH_TOLERANCE)),
    );
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
