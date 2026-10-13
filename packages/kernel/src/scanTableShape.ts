import { viewportPoint } from '@monstera/shared';

import type { PageTable, TableCell, TextLine } from './textStructure.js';

/**
 * A scanned table as it crosses from the engine host, and as main hands it to the table read's consumers
 * ([ADR-0233](../../../docs/DECISIONS/0233-a-scanned-tables-rulings-are-read-from-its-pixels.md)). Apart from the reader
 * (`scanTables.ts`), which loads the engine, so that main can take the shape without loading it (ADR-0026).
 */

/** One line of a cell's words, in display space as the table read's lines are. */
export interface ScanTableLine {
  readonly text: string;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly size: number;
  readonly font: { readonly name: string; readonly family: 'serif' | 'sans-serif' | 'monospace'; readonly bold: boolean; readonly italic: boolean };
}

/** One scanned table: its cells by row, each cell's lines, and which sides of each cell are ruled. */
export interface ScanTable {
  readonly columns: number;
  readonly rows: ScanTableLine[][][];
  readonly borders: { top: boolean; left: boolean; bottom: boolean; right: boolean }[][];
}

/**
 * The tables a page's table read answers, where its own read saw no ruling and the page holds a picture: the scanned
 * tables, as the table read's shape, so the review grid and the workbook take them as they take the engine's. A cell's
 * lines carry their own words, box and type; each line's origin is its box's lower left, where a line's baseline begins.
 */
export function pageTablesOfScan(tables: readonly ScanTable[]): PageTable[] {
  return tables.map((table) => ({
    columns: table.columns,
    rows: table.rows.map((row) =>
      row.map(
        (lines): TableCell => ({
          lines: lines.map(
            (line): TextLine => ({
              text: line.text,
              box: { topLeft: viewportPoint(line.box.x0, line.box.y0), bottomRight: viewportPoint(line.box.x1, line.box.y1) },
              origin: viewportPoint(line.box.x0, line.box.y1),
              size: line.size,
              font: line.font,
            }),
          ),
        }),
      ),
    ),
    borders: table.borders,
  }));
}

/** Whether MuPDF's own table read saw any ruling: a page it did is a page whose tables are vectors, and read as such. */
export function sawRulings(tables: readonly PageTable[]): boolean {
  return tables.some((table) => (table.borders ?? []).some((row) => row.some((side) => side.top || side.left || side.bottom || side.right)));
}
