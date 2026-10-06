import { describe, expect, it } from 'vitest';

import { PAPER_RING, paperColourAround, paperCoverFor } from './paperColour.js';

/** A raster of `width` by `height` in one colour, BGRA. */
function raster(width: number, height: number, colour: readonly [number, number, number]): Uint8Array {
  const bgra = new Uint8Array(width * height * 4);
  for (let at = 0; at < bgra.length; at += 4) {
    bgra[at] = colour[2];
    bgra[at + 1] = colour[1];
    bgra[at + 2] = colour[0];
    bgra[at + 3] = 255;
  }
  return bgra;
}

function paint(bgra: Uint8Array, width: number, box: { x0: number; y0: number; x1: number; y1: number }, colour: readonly [number, number, number]): void {
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const at = (y * width + x) * 4;
      bgra[at] = colour[2];
      bgra[at + 1] = colour[1];
      bgra[at + 2] = colour[0];
    }
  }
}

describe('paperColourAround', () => {
  const CREAM = [250, 240, 200] as const;

  it('is the colour of the paper round the box, and not the ink inside it', () => {
    const bgra = raster(60, 40, CREAM);
    paint(bgra, 60, { x0: 20, y0: 15, x1: 40, y1: 25 }, [10, 10, 10]);
    expect(paperColourAround(bgra, 60, 40, { x0: 20, y0: 15, x1: 40, y1: 25 })).toStrictEqual({ r: 250, g: 240, b: 200 });
  });

  it('is the MEDIAN, so a neighbour’s ink crossing a part of the ring moves it by nothing', () => {
    const bgra = raster(60, 40, CREAM);
    // THE NEXT LINE'S INK across the ring's whole top edge: under half of the ring
    paint(bgra, 60, { x0: 17, y0: 12, x1: 43, y1: 15 }, [0, 0, 0]);
    expect(paperColourAround(bgra, 60, 40, { x0: 20, y0: 15, x1: 40, y1: 25 })).toStrictEqual({ r: 250, g: 240, b: 200 });
  });

  // THE CONTROL: the ring is outside the box, so a box of ink on paper is read as paper, and a mean would not be.
  it('would not be paper if it read the box itself', () => {
    const bgra = raster(60, 40, CREAM);
    const ink = { x0: 5, y0: 5, x1: 55, y1: 35 };
    paint(bgra, 60, ink, [10, 10, 10]);
    // a box covering nearly all the raster leaves a ring that is mostly the margin of paper
    expect(paperColourAround(bgra, 60, 40, ink).r).toBe(250);
    expect(PAPER_RING).toBeGreaterThan(0);
  });

  it('answers white where the ring is wholly off the raster', () => {
    expect(paperColourAround(raster(10, 10, CREAM), 10, 10, { x0: -50, y0: -50, x1: -20, y1: -20 })).toStrictEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });

  it('reads a box at the raster’s edge from the side that is on it', () => {
    const bgra = raster(30, 30, CREAM);
    expect(paperColourAround(bgra, 30, 30, { x0: 0, y0: 0, x1: 10, y1: 10 })).toStrictEqual({ r: 250, g: 240, b: 200 });
  });
});

/** A raster whose paper darkens to the right by `perPixel` a pixel, in every channel. */
function shaded(width: number, height: number, perPixel: number): Uint8Array {
  const bgra = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(250 - perPixel * x);
      const at = (y * width + x) * 4;
      bgra[at] = value;
      bgra[at + 1] = value;
      bgra[at + 2] = value;
      bgra[at + 3] = 255;
    }
  }
  return bgra;
}

describe('paperCoverFor', () => {
  const CREAM = [250, 240, 200] as const;
  const BOX = { x0: 40, y0: 30, x1: 100, y1: 46 };

  it('is one cell, the paper’s colour, over a box on flat paper with no ink outside it', () => {
    const bgra = raster(160, 80, CREAM);
    paint(bgra, 160, BOX, [20, 20, 20]);
    const cover = paperCoverFor(bgra, 160, 80, BOX, 2);
    expect(cover).toHaveLength(1);
    expect(cover[0]?.colour).toStrictEqual({ r: 250, g: 240, b: 200 });
    // ONE PIXEL PAST THE INK, which is the box itself here: a stroke's soft edge is not ink by the threshold
    expect(cover[0]?.box).toStrictEqual({ x0: 39, y0: 29, x1: 101, y1: 47 });
  });

  it('grows through the ink that touches the box, past where the recogniser said the word ends', () => {
    const bgra = raster(160, 80, CREAM);
    paint(bgra, 160, BOX, [20, 20, 20]);
    // a letter's end running 6 px right of the box and a stroke 5 px below it, both touching the ink
    paint(bgra, 160, { x0: 100, y0: 34, x1: 106, y1: 42 }, [20, 20, 20]);
    paint(bgra, 160, { x0: 60, y0: 46, x1: 66, y1: 51 }, [20, 20, 20]);
    const [cell] = paperCoverFor(bgra, 160, 80, BOX, 2);
    expect(cell?.box.x1).toBeGreaterThanOrEqual(106);
    expect(cell?.box.y1).toBeGreaterThanOrEqual(51);
  });

  // THE CONTROL: ink that does not touch it, a word's width away, is not the word's, so it must not be reached.
  it('does not grow across a gap to ink that is not touching, as a neighbouring word is', () => {
    const bgra = raster(160, 80, CREAM);
    paint(bgra, 160, BOX, [20, 20, 20]);
    paint(bgra, 160, { x0: 105, y0: 30, x1: 125, y1: 46 }, [20, 20, 20]);
    const [cell] = paperCoverFor(bgra, 160, 80, BOX, 2);
    expect(cell?.box.x1).toBeLessThan(105);
  });

  it('is a grid of cells on shaded paper, each the colour the paper has there', () => {
    const bgra = shaded(200, 80, 0.6);
    paint(bgra, 200, BOX, [20, 20, 20]);
    const cover = paperCoverFor(bgra, 200, 80, BOX, 2);
    expect(cover.length).toBeGreaterThan(1);
    const first = cover[0];
    const last = cover.at(-1);
    // the paper darkens to the right, so the cell at the right is darker than the one at the left, by about the gradient
    expect(first?.colour.r).toBeGreaterThan((last?.colour.r ?? 255) + 20);
    for (const cell of cover) {
      const centre = (cell.box.x0 + cell.box.x1) / 2;
      expect(Math.abs(cell.colour.r - (250 - 0.6 * centre))).toBeLessThanOrEqual(6);
    }
  });

  // THE CONTROL: the same paper read as one colour would be wrong at an end of the box by more than the tolerance.
  it('would be wrong at one end of the box as one flat colour', () => {
    const bgra = shaded(200, 80, 0.6);
    paint(bgra, 200, BOX, [20, 20, 20]);
    const flat = paperColourAround(bgra, 200, 80, BOX);
    expect(Math.abs(flat.r - (250 - 0.6 * BOX.x0))).toBeGreaterThan(14 / 2);
    expect(Math.abs(flat.r - (250 - 0.6 * BOX.x1))).toBeGreaterThan(14 / 2);
  });

  it('is not tilted by a neighbour’s ink crossing the ring', () => {
    const bgra = raster(160, 80, CREAM);
    paint(bgra, 160, BOX, [20, 20, 20]);
    // the next line's ink along most of the ring's top, apart from the box's own ink
    paint(bgra, 160, { x0: 30, y0: 22, x1: 110, y1: 27 }, [20, 20, 20]);
    const cover = paperCoverFor(bgra, 160, 80, BOX, 2);
    expect(cover).toHaveLength(1);
    expect(cover[0]?.colour).toStrictEqual({ r: 250, g: 240, b: 200 });
  });

  it('overlaps a cell with its right and lower neighbour by a pixel, so no seam shows what is under it', () => {
    const bgra = shaded(200, 80, 0.6);
    paint(bgra, 200, BOX, [20, 20, 20]);
    const cover = paperCoverFor(bgra, 200, 80, BOX, 2);
    const [a, b] = cover;
    expect(a !== undefined && b !== undefined && a.box.x1 > b.box.x0).toBe(true);
  });
});
