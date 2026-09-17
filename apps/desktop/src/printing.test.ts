import { describe, expect, it } from 'vitest';

import { chosenPages, fittedOnPaper } from './printing.js';

describe('chosenPages — the dialog’s ranges as zero-based pages', () => {
  it('is every page when no range was typed', () => {
    expect(chosenPages(3, null)).toStrictEqual([0, 1, 2]);
  });

  it('takes one-based inclusive ranges in the order typed, each page once, reversed ranges read forwards', () => {
    expect(
      chosenPages(10, [
        { from: 3, to: 4 },
        { from: 2, to: 3 },
        { from: 9, to: 8 },
      ]),
    ).toStrictEqual([2, 3, 1, 7, 8]);
  });

  it('cuts a range at the document’s end and drops one wholly past it', () => {
    expect(
      chosenPages(4, [
        { from: 3, to: 7 },
        { from: 6, to: 9 },
      ]),
    ).toStrictEqual([2, 3]);
  });

  it('CONTROL: an empty range list is no pages, not every page', () => {
    expect(chosenPages(4, [])).toStrictEqual([]);
  });
});

describe('fittedOnPaper — a raster fitted into the printable area', () => {
  it('fits a landscape raster into a portrait area by width, centred vertically', () => {
    expect(fittedOnPaper(2000, 1000, 5100, 6600)).toStrictEqual({ x: 0, y: 2025, width: 5100, height: 2550 });
  });

  it('fits a portrait raster into a portrait area of another shape by height, centred horizontally', () => {
    expect(fittedOnPaper(1000, 2000, 5100, 6600)).toStrictEqual({ x: 900, y: 0, width: 3300, height: 6600 });
  });
});
