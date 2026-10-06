import type * as mupdf from './mupdfRaw.js';

/**
 * A redaction mark's quads, held to the lines they were made for (2a, F-R1).
 *
 * ## The mechanism, in MuPDF's own words
 *
 * `applyRedactions` removes a glyph when its box, shrunk by a tenth of its width and height, intersects any of the
 * mark's quads at all (`pdf_redact_text_filter`, `pdf-clean.c`, MuPDF 1.28.0). That box is the font's descender to
 * ascender over the glyph's advance (`pdf-op-filter.c`), which reaches well above and below the ink. A quad over one
 * line is built from the same boxes (`StructuredText.highlight`, `Page.search`), so where lines are set close
 * together a quad over one line's full box overlaps the boxes of the lines beside it, and the burn-in takes them too.
 * Measured: 11 pt Helvetica 12 pt apart, a text mark over the middle line removed every word on the page.
 *
 * ## The fix is to the quads, decided by the same rule MuPDF applies
 *
 * Each quad is narrowed, top and bottom, until no glyph of ANOTHER line touches it by that rule, and never past the
 * point where it would stop touching a glyph of its own line by that rule. The glyph boxes come from MuPDF's
 * structured text, which builds a character's box exactly as the redaction filter builds a glyph's in its default
 * mode (`stext-device.c`: the font's ascender and descender), so this predicts the burn-in rather than approximating
 * it. Where two lines overlap so far that no height keeps one and removes the other, the mark keeps removing its own
 * line: a redaction that left its words would be the worse failure.
 *
 * Only an upright quad is narrowed. A quad on rotated or skewed text is passed through as MuPDF made it.
 */

/** A box in MuPDF's displayed frame: y grows downwards. */
interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A line of the page's structured text: its glyphs' boxes, shrunk as the redaction filter shrinks them. */
export interface GlyphLine {
  readonly box: Box;
  readonly glyphs: readonly Box[];
}

/** How far inside a neighbour's box an edge is moved, in points: past MuPDF's float comparison, and invisible. */
const CLEARANCE = 0.01;

/** A glyph box as `pdf_redact_text_filter` tests it: a tenth off each side. */
function shrunk(box: Box): Box {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return { x0: box.x0 + w / 10, y0: box.y0 + h / 10, x1: box.x1 - w / 10, y1: box.y1 - h / 10 };
}

function boxOfQuad(quad: mupdf.Quad): Box {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Whether two boxes meet, edges included — `fz_is_valid_rect(fz_intersect_rect(…))`, the filter's own test. */
function meets(a: Box, b: Box): boolean {
  return Math.max(a.x0, b.x0) <= Math.min(a.x1, b.x1) && Math.max(a.y0, b.y0) <= Math.min(a.y1, b.y1);
}

/** Whether a quad is an upright rectangle: upper corners level, lower corners level, sides vertical. */
function upright(quad: mupdf.Quad): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  return near(quad[1], quad[3]) && near(quad[5], quad[7]) && near(quad[0], quad[4]) && near(quad[2], quad[6]);
}

/** The page's lines, each with its glyphs' shrunk boxes, read once from MuPDF's structured text. */
export function glyphLinesOf(text: mupdf.StructuredText): readonly GlyphLine[] {
  const lines: { box: Box; glyphs: Box[] }[] = [];
  let current: Box[] | undefined;
  text.walk({
    beginLine: (bbox) => {
      current = [];
      lines.push({ box: { x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] }, glyphs: current });
    },
    onChar: (_c, _origin, _font, _size, quad) => {
      current?.push(shrunk(boxOfQuad(quad)));
    },
    endLine: () => {
      current = undefined;
    },
  });
  return lines;
}

/** The line a quad was made over: the one its box shares most height with, among those it meets across. */
function ownLineOf(box: Box, lines: readonly GlyphLine[]): GlyphLine | undefined {
  let best: GlyphLine | undefined;
  let bestShared = 0;
  for (const line of lines) {
    if (Math.max(box.x0, line.box.x0) > Math.min(box.x1, line.box.x1)) continue;
    const shared = Math.min(box.y1, line.box.y1) - Math.max(box.y0, line.box.y0);
    if (shared > bestShared) {
      best = line;
      bestShared = shared;
    }
  }
  return best;
}

/**
 * One quad, narrowed so the burn-in removes the glyphs of its own line under it and no glyph of any other line.
 * Answered unchanged where it is not upright or names no glyph of a line.
 */
export function heldToItsLine(quad: mupdf.Quad, lines: readonly GlyphLine[]): mupdf.Quad {
  if (!upright(quad)) return quad;
  const box = boxOfQuad(quad);
  const own = ownLineOf(box, lines);
  if (own === undefined) return quad;
  const mine = own.glyphs.filter((glyph) => meets(glyph, box));
  if (mine.length === 0) return quad;

  // WHAT THE QUAD MUST STILL REACH: the top no lower than the highest bottom of its own glyphs, the bottom no higher
  // than the lowest top, so every one of them still meets it by the filter's rule.
  const mustStartBy = Math.min(...mine.map((glyph) => glyph.y1));
  const mustEndAfter = Math.max(...mine.map((glyph) => glyph.y0));
  const middle = (own.box.y0 + own.box.y1) / 2;

  let { y0, y1 } = box;
  for (const line of lines) {
    if (line === own) continue;
    for (const glyph of line.glyphs) {
      if (!meets(glyph, { ...box, y0, y1 })) continue;
      // BELOW its own line in this frame when its middle is further down, and the quad's bottom comes up above it;
      // above, and its top goes down beneath it.
      if ((glyph.y0 + glyph.y1) / 2 > middle) y1 = Math.min(y1, glyph.y0 - CLEARANCE);
      else y0 = Math.max(y0, glyph.y1 + CLEARANCE);
    }
  }
  y0 = Math.min(y0, mustStartBy);
  y1 = Math.max(y1, mustEndAfter);
  if (y0 === box.y0 && y1 === box.y1) return quad;
  // MuPDF's corner order: upper left, upper right, lower left, lower right.
  return [box.x0, y0, box.x1, y0, box.x0, y1, box.x1, y1];
}

/** Every quad of a mark, held to its line. */
export function heldToTheirLines(quads: readonly mupdf.Quad[], lines: readonly GlyphLine[]): mupdf.Quad[] {
  return quads.map((quad) => heldToItsLine(quad, lines));
}
