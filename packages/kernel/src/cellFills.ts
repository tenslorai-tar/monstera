import type { PageTable, TableCell } from './textStructure.js';

/**
 * A table cell's BACKGROUND, for the Excel writer: the page's own filled shapes, read through the
 * engine (`pageFills.ts`), matched to the cells the table read found. No engine here — this is the
 * join, and it runs in `main`.
 *
 * ## The source, measured before it was written (2026-09-21)
 *
 * The row called fills a stated limit — *no engine reports a cell's background*. That is true of
 * the table read and of both services, and false of the page: a shaded cell in a born-digital PDF
 * is a filled path drawn behind the cell's text. A tracing device over a generated 3×3 ruled table
 * saw every fill at its exact colour, in the display space the structured text uses — three grey
 * header cells and one yellow data cell, and nothing for the rest. So the fills come from the
 * DRAWING and the cells from the TABLE READ, and this module joins the two; neither engine is asked
 * a question it does not answer.
 *
 * ## The join: the smallest fill that holds the cell's text
 *
 * A cell carries its lines, not a box (the engine's JSON has no box for a structure element), so a
 * cell's background is the smallest filled shape that contains all of its text. Smallest, because
 * a panel behind the whole table also contains the text and a cell's own shading sits above it.
 * **A cell with no text has no box, and so no fill** — an empty shaded cell is written plain, which
 * is this join's stated limit. White is not a fill: a page painted white behind everything would
 * otherwise shade every cell.
 */

/** One filled shape on a page: its box in display space, and its colour as RGB in 0..1. */
export interface PageFill {
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly rgb: readonly [number, number, number];
}

/** A cell's background as RGB in 0..1, or `null` for none — the table read's own field type. */
export type CellFill = NonNullable<TableCell['fill']> | null;

/** Within a point: a cell's text sits on its fill's edge often enough that exact containment misses. */
const SLACK = 1;

/** At or above this in every channel, a fill is paper rather than shading. */
const WHITE = 0.98;

/** The box around every line of a cell's text, or `null` for a cell with none. */
function textBox(cell: TableCell): PageFill['box'] | null {
  if (cell.lines.length === 0) return null;
  return {
    x0: Math.min(...cell.lines.map((line) => line.box.topLeft.x)),
    y0: Math.min(...cell.lines.map((line) => line.box.topLeft.y)),
    x1: Math.max(...cell.lines.map((line) => line.box.bottomRight.x)),
    y1: Math.max(...cell.lines.map((line) => line.box.bottomRight.y)),
  };
}

/** The background of one cell, by the join the header describes. */
export function cellFillOf(cell: TableCell, fills: readonly PageFill[]): CellFill {
  const text = textBox(cell);
  if (text === null) return null;
  let best: PageFill | null = null;
  let bestArea = Infinity;
  for (const fill of fills) {
    const { x0, y0, x1, y1 } = fill.box;
    if (x0 > text.x0 + SLACK || y0 > text.y0 + SLACK || x1 < text.x1 - SLACK || y1 < text.y1 - SLACK) continue;
    const area = (x1 - x0) * (y1 - y0);
    // `<=`, so of two equal shapes the one drawn LATER wins — it is the one painted on top.
    if (area <= bestArea) {
      best = fill;
      bestArea = area;
    }
  }
  if (best === null || best.rgb.every((channel) => channel >= WHITE)) return null;
  return best.rgb;
}

/** A page's tables with each cell's background, in the table read's own shape. */
export function withCellFills(tables: readonly PageTable[], fills: readonly PageFill[]): readonly PageTable[] {
  return tables.map((table) => ({
    ...table,
    rows: table.rows.map((row) => row.map((cell) => ({ ...cell, fill: cellFillOf(cell, fills) }))),
  }));
}
