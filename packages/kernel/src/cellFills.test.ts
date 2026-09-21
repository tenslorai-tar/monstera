import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type PageFill, cellFillOf, withCellFills } from './cellFills.js';
import type { PageTable, TableCell, TextLine } from './textStructure.js';

/** A line of text at a box, in display space. */
function line(x0: number, y0: number, x1: number, y1: number): TextLine {
  return {
    text: 'x',
    box: { topLeft: viewportPoint(x0, y0), bottomRight: viewportPoint(x1, y1) },
    origin: viewportPoint(x0, y1),
    size: 10,
    font: { name: 'Helvetica', family: 'sans-serif', bold: false, italic: false },
  };
}

const cell = (...lines: TextLine[]): TableCell => ({ lines });
const fill = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): PageFill => ({
  box: { x0, y0, x1, y1 },
  rgb,
});

const YELLOW: [number, number, number] = [1, 1, 0.4];
const GREY: [number, number, number] = [0.85, 0.85, 0.85];

describe('a table cell’s background, joined from the page’s fills', () => {
  it('takes the SMALLEST fill that holds the cell’s text, not a panel behind the whole table', () => {
    // A grey panel behind the table, drawn first, and the cell's own yellow above it. Taking the
    // first or the largest containing fill would answer grey.
    const fills = [fill(0, 0, 500, 300, GREY), fill(100, 100, 220, 124, YELLOW)];
    expect(cellFillOf(cell(line(106, 104, 150, 116)), fills)).toStrictEqual(YELLOW);
  });

  it('takes the panel for a cell with no shading of its own', () => {
    const fills = [fill(0, 0, 500, 300, GREY), fill(100, 100, 220, 124, YELLOW)];
    expect(cellFillOf(cell(line(306, 104, 350, 116)), fills)).toStrictEqual(GREY);
  });

  it('holds the WHOLE text: a fill under one line of two does not shade the cell', () => {
    const fills = [fill(100, 100, 220, 112, YELLOW)];
    expect(cellFillOf(cell(line(106, 102, 150, 110), line(106, 114, 150, 122)), fills)).toBeNull();
  });

  it('treats white as paper, not shading', () => {
    expect(cellFillOf(cell(line(106, 104, 150, 116)), [fill(0, 0, 612, 792, [1, 1, 1])])).toBeNull();
  });

  it('allows a point of slack where text sits on its fill’s edge', () => {
    expect(cellFillOf(cell(line(99.5, 104, 150, 116)), [fill(100, 100, 220, 124, YELLOW)])).toStrictEqual(YELLOW);
  });

  it('CONTROL: an empty cell, and a page with no fills, have no background', () => {
    expect(cellFillOf(cell(), [fill(0, 0, 500, 300, YELLOW)])).toBeNull();
    expect(cellFillOf(cell(line(106, 104, 150, 116)), [])).toBeNull();
  });

  it('writes each cell’s fill into the table read’s own shape, and keeps its borders', () => {
    const table: PageTable = {
      columns: 2,
      rows: [[cell(line(106, 104, 150, 116)), cell(line(226, 104, 270, 116))]],
      borders: [[{ top: true, left: true, bottom: true, right: false }, { top: true, left: false, bottom: true, right: true }]],
    };
    const [joined] = withCellFills([table], [fill(100, 100, 220, 124, YELLOW)]);
    expect(joined?.rows[0]?.map((each) => each.fill)).toStrictEqual([YELLOW, null]);
    expect(joined?.borders).toBe(table.borders);
  });
});
