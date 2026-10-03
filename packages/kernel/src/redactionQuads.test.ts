import { describe, expect, it } from 'vitest';

import type * as mupdf from './mupdfRaw.js';
import { type GlyphLine, heldToItsLine } from './redactionQuads.js';

/**
 * The quad rule's edges, on boxes written out. The burn-in itself, over MuPDF's own boxes and text extraction, is
 * `redactionLeading.test.ts`; these are the cases a real page does not reach on demand.
 *
 * Boxes are in MuPDF's displayed frame, y growing down, and already shrunk as the redaction filter shrinks them.
 */
const rect = (x0: number, y0: number, x1: number, y1: number): mupdf.Quad => [x0, y0, x1, y0, x0, y1, x1, y1];

/** A line of glyphs ten wide, from x 0, between y0 and y1 (their shrunk boxes). */
function line(count: number, y0: number, y1: number, offset = 0): GlyphLine {
  const glyphs = Array.from({ length: count }, (_unused, at) => ({ x0: offset + at * 10 + 1, y0, x1: offset + at * 10 + 9, y1 }));
  return { box: { x0: offset, y0, x1: offset + count * 10, y1 }, glyphs };
}

describe('heldToItsLine', () => {
  it('lifts the bottom above the next line’s glyphs and lowers the top beneath the line above’s', () => {
    const above = line(5, 0, 12);
    const own = line(5, 10, 22);
    const below = line(5, 20, 32);
    const held = heldToItsLine(rect(0, 9, 50, 23), [above, own, below]);
    // BETWEEN THE NEIGHBOURS' GLYPHS, by the clearance.
    expect(held[1]).toBeCloseTo(12.01, 5);
    expect(held[5]).toBeCloseTo(19.99, 5);
    // AND STILL ACROSS ITS OWN GLYPHS (10 to 22), so the burn-in still removes them.
    expect(held[1]).toBeLessThanOrEqual(22);
    expect(held[5]).toBeGreaterThanOrEqual(10);
  });

  it('CONTROL: a quad that touches no other line is answered unchanged', () => {
    const quad = rect(0, 10, 50, 22);
    expect(heldToItsLine(quad, [line(5, 0, 8), line(5, 10, 22), line(5, 30, 40)])).toBe(quad);
  });

  it('a neighbour beside the quad but not across from it is not a reason to narrow it', () => {
    // THE NEXT LINE STARTS AT x 100, past where this quad ends: overlapping heights, no common column.
    const quad = rect(0, 10, 50, 22);
    expect(heldToItsLine(quad, [line(5, 10, 22), line(5, 20, 32, 100)])).toBe(quad);
  });

  it('where lines overlap so far no height keeps one and removes the other, it KEEPS REMOVING its own line', () => {
    // THE NEIGHBOUR'S GLYPHS reach up past the middle of this line's: holding the quad off them would leave it
    // touching none of its own, and a redaction that left its words is the worse failure.
    // Here the neighbour's glyphs (9 to 30) start above this line's (10 to 22), so a bottom above them would be above
    // every glyph of this line too.
    const own = line(5, 10, 22);
    const below = line(5, 9, 30);
    const held = heldToItsLine(rect(0, 10, 50, 22), [own, below]);
    // HELD AT THE LAST HEIGHT THAT STILL MEETS ITS OWN GLYPHS, their top edge, and no further.
    expect(held[1]).toBe(10);
    expect(held[5]).toBe(10);
  });

  it('a quad on turned text is passed through as MuPDF made it', () => {
    const turned: mupdf.Quad = [0, 0, 10, 10, 5, -5, 15, 5];
    expect(heldToItsLine(turned, [line(5, 0, 12), line(5, 10, 22)])).toBe(turned);
  });
});
