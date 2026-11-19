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

/**
 * Whether MuPDF's own table read saw a rule DOWN, on any table: a table ruled down is enclosed, MuPDF reads it exactly,
 * and the page keeps its answer. A page whose tables are ruled only across, or not at all, is asked for the tables this
 * build reads from rulings (ADR-0297, which widened ADR-0233's *any ruling*: a table ruled only across is the case the
 * engine misses).
 */
export function sawColumnRulings(tables: readonly PageTable[]): boolean {
  return tables.some((table) => (table.borders ?? []).some((row) => row.some((side) => side.left || side.right)));
}

/** The box around every line of a table, or `null` for a table with no text. */
function tableBox(table: PageTable): { x0: number; y0: number; x1: number; y1: number } | null {
  const lines = table.rows.flatMap((row) => row.flatMap((cell) => cell.lines));
  if (lines.length === 0) return null;
  return {
    x0: Math.min(...lines.map((line) => line.box.topLeft.x)),
    y0: Math.min(...lines.map((line) => line.box.topLeft.y)),
    x1: Math.max(...lines.map((line) => line.box.bottomRight.x)),
    y1: Math.max(...lines.map((line) => line.box.bottomRight.y)),
  };
}

/** Within two points: the engine's lines and the characters read here round a box's edge differently. */
const EDGE_SLACK = 2;

/**
 * A page's tables: the engine's, with every engine ROW that lies in a table read from rulings given way to that table
 * ([ADR-0297](../../../docs/DECISIONS/0297-a-table-ruled-only-across-is-read-from-its-drawn-rules.md)), top to bottom.
 * The ONE merge, taken by main's `pageTables` (the Excel export and its review grid) and by the Word export alike, so the
 * two cannot disagree about which tables a page holds.
 *
 * **By row, and never dropping a row the rules do not cover.** The rules say where the table is: an engine row inside
 * them is the engine's segmentation cutting the table (the Volunteers table, two pieces inside it) or joining it with
 * what is beside it (a contract's heading and clauses read as one table around its price list, the generated page of
 * `acrossRulings.test.ts`), and the ruled table replaces it. An engine row OUTSIDE every ruled table is kept, in a table
 * of its own with the rows next to it: measured 2026-11-19 on a corpus page, an engine table of 24 rows held 21 inside
 * two ruled tables and 3 below them with words, which a whole-table rule would have lost (the owner's *preserve, never
 * drop*). A row with no words goes with the row above it.
 */
export function withRuledTables(engine: readonly PageTable[], ruled: readonly PageTable[]): PageTable[] {
  const ruledBoxes = ruled.map(tableBox).filter((box) => box !== null);
  const covered = (row: readonly TableCell[]): boolean | null => {
    const lines = row.flatMap((cell) => cell.lines);
    if (lines.length === 0) return null;
    const x = lines.reduce((sum, line) => sum + (line.box.topLeft.x + line.box.bottomRight.x) / 2, 0) / lines.length;
    const y = lines.reduce((sum, line) => sum + (line.box.topLeft.y + line.box.bottomRight.y) / 2, 0) / lines.length;
    return ruledBoxes.some(
      (box) => x >= box.x0 - EDGE_SLACK && x <= box.x1 + EDGE_SLACK && y >= box.y0 - EDGE_SLACK && y <= box.y1 + EDGE_SLACK,
    );
  };
  const kept: PageTable[] = [];
  for (const table of engine) {
    // EACH RUN OF ROWS OUTSIDE THE RULES, by index into the table's rows.
    const runs: number[][] = [];
    let inside = false;
    for (let at = 0; at < table.rows.length; at += 1) {
      inside = covered(table.rows[at] ?? []) ?? inside;
      if (inside) continue;
      const open = runs.at(-1);
      if (open?.at(-1) === at - 1) open.push(at);
      else runs.push([at]);
    }
    for (const run of runs) {
      if (run.length === table.rows.length) {
        kept.push(table);
        continue;
      }
      kept.push({
        ...table,
        rows: run.map((at) => table.rows[at] ?? []),
        borders: table.borders === null ? null : run.map((at) => table.borders?.[at] ?? []),
      });
    }
  }
  const top = (table: PageTable): number => tableBox(table)?.y0 ?? 0;
  return [...kept, ...ruled].sort((a, b) => top(a) - top(b));
}
