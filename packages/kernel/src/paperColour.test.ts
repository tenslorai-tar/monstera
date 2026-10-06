import { describe, expect, it } from 'vitest';

import { PAPER_RING, paperColourAround } from './paperColour.js';

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
