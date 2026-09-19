/**
 * A table a SERVICE read off a page's raster — Azure's Layout model, or Claude asked for
 * structured output ([ADR-0086](../../../docs/DECISIONS/0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md)).
 *
 * ## Its own shape, beside MuPDF's `PageTable` and not folded into it
 *
 * A `PageTable` is MuPDF's structure read: rows of cells in the engine's order, each cell the
 * text lines the engine moved into it, with their fonts and boxes, and **no spans**. A service's
 * table is the opposite on both counts: a grid with each cell's row, column and spans, and plain
 * text with no line, font or box. Folding one into the other would mean inventing lines for the
 * second and spans for the first. So the sheet writer takes either, and says which it was given.
 *
 * ## One reader of what a service answered, and it refuses rather than repairs
 *
 * Both services are asked for the same shape (ADR-0086 Decision 3), so {@link recognisedTable}
 * is the one place an answer becomes a table. A cell outside the grid, or two cells claiming the
 * same place in it, is an answer that got its own grid wrong; the table is refused rather than
 * placed by a rule of ours, because any placement would be this build deciding what the service
 * meant.
 */

/** One cell as a service reports it: where it starts, how far it spans, and its text. */
export interface RecognisedCell {
  /** Zero-based. */
  readonly row: number;
  readonly column: number;
  /** At least 1. A span over 1 is a merged range in the sheet. */
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly text: string;
}

/** One table a service found, as its grid. */
export interface RecognisedTable {
  readonly kind: 'recognised';
  readonly rows: number;
  readonly columns: number;
  /** Each cell once, a spanning cell at its top-left corner. */
  readonly cells: readonly RecognisedCell[];
}

/** Why an answer is not a table this build will write. */
export class RecognisedTableRefused extends Error {
  constructor(readonly detail: string) {
    super(`the service's table is not one this build can place: ${detail}`);
    this.name = 'RecognisedTableRefused';
  }
}

/**
 * Checks a service's grid and answers the table, or refuses it.
 *
 * @param maxCells the grid's bound — the same bound the review grid and the channels carry, so a
 *   service cannot hand the writer a sheet the automatic engine could never produce
 * @param maxText each cell's text bound
 */
export function recognisedTable(
  rows: number,
  columns: number,
  cells: readonly RecognisedCell[],
  maxCells: number,
  maxText: number,
): RecognisedTable {
  const whole = (value: number): boolean => Number.isInteger(value) && value >= 0;
  if (!whole(rows) || !whole(columns) || rows === 0 || columns === 0) {
    throw new RecognisedTableRefused(`a ${String(rows)}×${String(columns)} grid`);
  }
  if (rows * columns > maxCells) {
    throw new RecognisedTableRefused(`${String(rows * columns)} cells, over the ${String(maxCells)} a table may hold`);
  }

  const taken = new Set<number>();
  for (const cell of cells) {
    const fits =
      whole(cell.row) &&
      whole(cell.column) &&
      Number.isInteger(cell.rowSpan) &&
      Number.isInteger(cell.columnSpan) &&
      cell.rowSpan >= 1 &&
      cell.columnSpan >= 1 &&
      cell.row + cell.rowSpan <= rows &&
      cell.column + cell.columnSpan <= columns;
    if (!fits) {
      throw new RecognisedTableRefused(
        `a cell at row ${String(cell.row)}, column ${String(cell.column)} spanning ` +
          `${String(cell.rowSpan)}×${String(cell.columnSpan)} lies outside its ${String(rows)}×${String(columns)} grid`,
      );
    }
    if (cell.text.length > maxText) {
      throw new RecognisedTableRefused(`a cell's text is ${String(cell.text.length)} characters, over ${String(maxText)}`);
    }
    for (let y = cell.row; y < cell.row + cell.rowSpan; y += 1) {
      for (let x = cell.column; x < cell.column + cell.columnSpan; x += 1) {
        const place = y * columns + x;
        if (taken.has(place)) {
          throw new RecognisedTableRefused(`two cells claim row ${String(y)}, column ${String(x)}`);
        }
        taken.add(place);
      }
    }
  }
  return { kind: 'recognised', rows, columns, cells };
}
