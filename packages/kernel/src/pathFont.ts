import { withTables } from './fontSubset.js';
import type { OutlineCommand } from './textShaping.js';

/**
 * An OpenType font with CFF outlines written from outlines alone, which `cidFont.ts` embeds for a CFF face, and the one
 * conversion of a HarfBuzz outline into cubic steps the composers draw with. Cubic throughout, as a CFF charstring and
 * a PDF path both are, so nothing is approximated. No font is built here from what a page draws (ADR-0271, the owner's
 * font rule).
 *
 * Pure: the outlines arrive as {@link PathGlyph}s the caller made, so the writer is proven with no engine.
 */

/** One step of an outline, in thousandths of an em, y up: a move, a line, a cubic curve; a contour's close is implied. */
export type PathStep =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'curve';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    };

/** One glyph: its width and its outline, in thousandths of an em. */
export interface PathGlyph {
  readonly advance: number;
  readonly steps: readonly PathStep[];
}
/**
 * An OpenType font with CFF outlines holding `outlines` in order — glyph 0 first, which should be `.notdef` — and no
 * `cmap`: what `cidFont.ts` embeds for a CFF face, whose codes reach their glyphs by number alone.
 */
export function cffProgram(
  outlines: readonly PathGlyph[],
  metrics: { readonly ascender: number; readonly descender: number },
  name: string,
): Uint8Array {
  const seed = sfntWithHead(headTable(boundsOf(outlines)));
  return withTables(
    seed,
    new Map([
      ['hhea', hheaTable(outlines, metrics.ascender, metrics.descender)],
      ['maxp', maxpTable(outlines.length)],
      ['hmtx', hmtxTable(outlines)],
      ['CFF ', cffTable(outlines, name)],
    ]),
  );
}

/**
 * HarfBuzz's outline of a glyph (`ShapingFace.outline`) as {@link PathStep}s, scaled by `scale`: a quadratic segment
 * becomes the cubic that draws the same curve, and a contour's close is left to whatever fills it, as both a CFF
 * charstring and a PDF fill close every contour. THE ONE conversion, for the composers' outline glyphs and for a CFF
 * face's embedded program alike.
 */
export function stepsOfOutline(outline: readonly OutlineCommand[], scale: number): PathStep[] {
  const steps: PathStep[] = [];
  let current: readonly [number, number] = [0, 0];
  let start: readonly [number, number] = [0, 0];
  for (const { type, values } of outline) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values.map((value) => value * scale);
    if (type === 'M') {
      steps.push({ kind: 'move', x: a, y: b });
      current = [a, b];
      start = current;
    } else if (type === 'L') {
      steps.push({ kind: 'line', x: a, y: b });
      current = [a, b];
    } else if (type === 'Q') {
      const [x0, y0] = current;
      steps.push({ kind: 'curve', x1: x0 + (2 / 3) * (a - x0), y1: y0 + (2 / 3) * (b - y0), x2: c + (2 / 3) * (a - c), y2: d + (2 / 3) * (b - d), x: c, y: d });
      current = [c, d];
    } else if (type === 'C') {
      steps.push({ kind: 'curve', x1: a, y1: b, x2: c, y2: d, x: e, y: f });
      current = [e, f];
    } else {
      current = start;
    }
  }
  return steps;
}

/** The ink box of every outline together, rounded outward; zero where nothing draws. */
function boundsOf(outlines: readonly PathGlyph[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const outline of outlines) {
    for (const step of outline.steps) {
      const xs = step.kind === 'curve' ? [step.x1, step.x2, step.x] : [step.x];
      const ys = step.kind === 'curve' ? [step.y1, step.y2, step.y] : [step.y];
      x0 = Math.min(x0, ...xs);
      x1 = Math.max(x1, ...xs);
      y0 = Math.min(y0, ...ys);
      y1 = Math.max(y1, ...ys);
    }
  }
  return Number.isFinite(x0) ? { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** An `OTTO` font holding `head` alone: the seed {@link withTables} adds every other table to. */
function sfntWithHead(head: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + 16 + head.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x4f54544f);
  view.setUint16(4, 1);
  view.setUint16(6, 16);
  view.setUint32(12, 0x68656164);
  view.setUint32(12 + 8, 28);
  view.setUint32(12 + 12, head.length);
  out.set(head, 28);
  return out;
}

/** `head`, version 1: a thousand units to the em, the font's box, no style bits (the editor states the style). */
function headTable(box: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const out = new Uint8Array(54);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint32(4, 0x00010000);
  view.setUint32(12, 0x5f0f3cf5);
  view.setUint16(16, 3);
  view.setUint16(18, 1000);
  view.setInt16(36, clamp16(box.x0));
  view.setInt16(38, clamp16(box.y0));
  view.setInt16(40, clamp16(box.x1));
  view.setInt16(42, clamp16(box.y1));
  view.setUint16(46, 8);
  view.setInt16(48, 2);
  return out;
}

/** `hhea`: the face's vertical metrics, and a width for every glyph. */
function hheaTable(outlines: readonly PathGlyph[], ascender: number, descender: number): Uint8Array {
  const out = new Uint8Array(36);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setInt16(4, clamp16(ascender));
  view.setInt16(6, clamp16(descender));
  view.setUint16(10, Math.min(0xffff, Math.max(0, ...outlines.map((outline) => Math.round(outline.advance)))));
  view.setInt16(18, 1);
  view.setUint16(34, outlines.length);
  return out;
}

/** `maxp` version 0.5, which an OpenType font with CFF outlines carries: the glyph count alone. */
function maxpTable(count: number): Uint8Array {
  const out = new Uint8Array(6);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00005000);
  view.setUint16(4, count);
  return out;
}

/** `hmtx`: each glyph's width as PDFium draws it, and its left side bearing. */
function hmtxTable(outlines: readonly PathGlyph[]): Uint8Array {
  const out = new Uint8Array(4 * outlines.length);
  const view = new DataView(out.buffer);
  outlines.forEach((outline, at) => {
    view.setUint16(4 * at, Math.max(0, Math.min(0xffff, Math.round(outline.advance))));
    const xs = outline.steps.flatMap((step) => (step.kind === 'curve' ? [step.x1, step.x2, step.x] : [step.x]));
    view.setInt16(4 * at + 2, clamp16(xs.length === 0 ? 0 : Math.floor(Math.min(...xs))));
  });
  return out;
}

function clamp16(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)));
}

// ------------------------------------------------------------------------------------------- the CFF table (TN 5176)

/** A CFF INDEX of `items`, with four-byte offsets. */
function cffIndex(items: readonly Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);
  const data = items.reduce((total, item) => total + item.length, 0);
  const out = new Uint8Array(3 + 4 * (items.length + 1) + data);
  const view = new DataView(out.buffer);
  view.setUint16(0, items.length);
  out[2] = 4;
  let offset = 1;
  let at = 3 + 4 * (items.length + 1);
  items.forEach((item, index) => {
    view.setUint32(3 + 4 * index, offset);
    out.set(item, at);
    offset += item.length;
    at += item.length;
  });
  view.setUint32(3 + 4 * items.length, offset);
  return out;
}

/** A DICT operand as a five-byte integer, so a dict's size does not depend on the offsets written into it. */
function dictInt(value: number): number[] {
  return [29, (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

/** A Type 2 charstring integer (TN 5177, 3.2): the short forms, else 28 and two bytes. */
function charInt(value: number): number[] {
  const v = Math.round(value);
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) return [((v - 108) >> 8) + 247, (v - 108) & 255];
  if (v >= -1131 && v <= -108) return [((-v - 108) >> 8) + 251, (-v - 108) & 255];
  const clamped = clamp16(v);
  return [28, (clamped >> 8) & 255, clamped & 255];
}

/** One glyph's charstring: its width, then each step relative to the last point, then `endchar`. */
function charstring(outline: PathGlyph): Uint8Array {
  const bytes: number[] = [...charInt(outline.advance)];
  let x = 0;
  let y = 0;
  // ROUNDED ONCE, AT EACH POINT, and deltas taken between rounded points, so the error never accumulates along a contour.
  const at = (value: number): number => Math.round(value);
  for (const step of outline.steps) {
    if (step.kind === 'move') {
      bytes.push(...charInt(at(step.x) - x), ...charInt(at(step.y) - y), 21);
      [x, y] = [at(step.x), at(step.y)];
    } else if (step.kind === 'line') {
      bytes.push(...charInt(at(step.x) - x), ...charInt(at(step.y) - y), 5);
      [x, y] = [at(step.x), at(step.y)];
    } else {
      const [ax, ay] = [at(step.x1), at(step.y1)];
      const [bx, by] = [at(step.x2), at(step.y2)];
      const [cx, cy] = [at(step.x), at(step.y)];
      bytes.push(...charInt(ax - x), ...charInt(ay - y), ...charInt(bx - ax), ...charInt(by - ay), ...charInt(cx - bx), ...charInt(cy - by), 8);
      [x, y] = [cx, cy];
    }
  }
  bytes.push(14);
  return Uint8Array.from(bytes);
}

/**
 * The `CFF ` table: one font, its glyphs named `g1`… in the String INDEX (an OpenType font's `post` 3 names none, and a
 * CFF charset needs a name per glyph), widths stated in each charstring over a nominal width of zero.
 */
function cffTable(outlines: readonly PathGlyph[], name: string): Uint8Array {
  const encoder = new TextEncoder();
  const header = Uint8Array.from([1, 0, 4, 4]);
  const names = cffIndex([encoder.encode(name)]);
  const strings = cffIndex(outlines.slice(1).map((_, at) => encoder.encode(`g${String(at + 1)}`)));
  const globalSubrs = cffIndex([]);
  const charset = Uint8Array.from([0, ...outlines.slice(1).flatMap((_, at) => [((391 + at) >> 8) & 255, (391 + at) & 255])]);
  const charStrings = cffIndex(outlines.map(charstring));
  // nominalWidthX 0 (op 21), so each charstring's first operand IS its width.
  const privateDict = Uint8Array.from([...charInt(0), 21]);
  // THE TOP DICT'S SIZE IS FIXED (five-byte operands), so the offsets after it can be computed before it is written.
  const topSize = 5 + 1 + 5 + 1 + 5 + 5 + 1;
  const topIndexSize = 3 + 4 * 2 + topSize;
  const charsetAt = header.length + names.length + topIndexSize + strings.length + globalSubrs.length;
  const charStringsAt = charsetAt + charset.length;
  const privateAt = charStringsAt + charStrings.length;
  const top = Uint8Array.from([...dictInt(charsetAt), 15, ...dictInt(charStringsAt), 17, ...dictInt(privateDict.length), ...dictInt(privateAt), 18]);
  const topIndex = cffIndex([top]);
  const parts = [header, names, topIndex, strings, globalSubrs, charset, charStrings, privateDict];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
