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
 * ## The grid is the extent of the cells the service RETURNED
 *
 * One reader of what a service answered, and **its own counts are only a hint** (corrected 2026-10-09,
 * [ADR-0222](../../../docs/DECISIONS/0222-a-recognised-table-is-the-extent-of-its-cells-and-is-never-refused-for-a-count.md)).
 * Until then a cell outside the DECLARED grid refused the whole table: Claude read a handwritten page whose header
 * "Names Hours" it merged into one cell, declared three columns, and returned four cells in every data row — and the
 * four-column table a person could plainly use was refused for it. The cells are the evidence; the declared
 * counts are a summary of them that the service can get wrong. So the grid is the largest row and column any cell reaches,
 * a place no cell covers stays an empty cell, and only what cannot be placed at all is refused.
 *
 * Two cells claiming one place do not refuse the table either, because refusing it drops every other cell for one
 * disagreement: the second cell's words are joined onto the first at that place (nothing the service read is lost), and a
 * span that would cover a place already taken is cut back to the places still free.
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
 * Builds the table a service's cells make, or refuses what cannot be placed at all.
 *
 * Refused: no cell, a cell whose row or column is not a whole number from zero, a grid over `maxCells`, a cell's text over
 * `maxText`. Nothing else is: a ragged answer is written whole.
 *
 * @param maxCells the grid's bound — the same bound the review grid and the channels carry, so a
 *   service cannot hand the writer a sheet the automatic engine could never produce
 * @param maxText each cell's text bound
 */
export function recognisedTable(cells: readonly RecognisedCell[], maxCells: number, maxText: number): RecognisedTable {
  const whole = (value: number): boolean => Number.isInteger(value) && value >= 0;
  if (cells.length === 0) throw new RecognisedTableRefused('a table with no cell');
  // A SPAN THAT IS NOT A WHOLE NUMBER OF AT LEAST ONE IS ONE: the cell is real, and what it spans is the service's guess.
  const spanOf = (span: number): number => (Number.isInteger(span) && span >= 1 ? span : 1);

  for (const cell of cells) {
    if (!whole(cell.row) || !whole(cell.column)) {
      throw new RecognisedTableRefused(`a cell at row ${String(cell.row)}, column ${String(cell.column)}`);
    }
    if (cell.text.length > maxText) {
      throw new RecognisedTableRefused(`a cell's text is ${String(cell.text.length)} characters, over ${String(maxText)}`);
    }
  }
  // THE EXTENT OF WHAT WAS RETURNED, spans included.
  const rows = Math.max(...cells.map((cell) => cell.row + spanOf(cell.rowSpan)));
  const columns = Math.max(...cells.map((cell) => cell.column + spanOf(cell.columnSpan)));
  if (rows * columns > maxCells) {
    throw new RecognisedTableRefused(`${String(rows * columns)} cells, over the ${String(maxCells)} a table may hold`);
  }

  const taken = new Set<number>();
  const placed = new Map<number, { row: number; column: number; rowSpan: number; columnSpan: number; text: string }>();
  for (const cell of cells) {
    const start = cell.row * columns + cell.column;
    const occupant = placed.get(start);
    if (occupant !== undefined || taken.has(start)) {
      // THE SAME PLACE CLAIMED TWICE: the words are joined onto the first claimant, never dropped. A place covered by a
      // span rather than started there takes the words at the cell that covers it.
      const holder = occupant ?? [...placed.values()].find((each) => covers(each, cell.row, cell.column));
      if (holder !== undefined && cell.text !== '') holder.text = holder.text === '' ? cell.text : `${holder.text} ${cell.text}`;
      continue;
    }
    let rowSpan = spanOf(cell.rowSpan);
    let columnSpan = spanOf(cell.columnSpan);
    // A SPAN IS CUT BACK to the places still free: along the row first, then down.
    for (let x = 1; x < columnSpan; x += 1) {
      if (taken.has(cell.row * columns + cell.column + x)) {
        columnSpan = x;
        break;
      }
    }
    for (let y = 1; y < rowSpan; y += 1) {
      let free = true;
      for (let x = 0; x < columnSpan; x += 1) free = free && !taken.has((cell.row + y) * columns + cell.column + x);
      if (!free) {
        rowSpan = y;
        break;
      }
    }
    for (let y = 0; y < rowSpan; y += 1) {
      for (let x = 0; x < columnSpan; x += 1) taken.add((cell.row + y) * columns + cell.column + x);
    }
    placed.set(start, { row: cell.row, column: cell.column, rowSpan, columnSpan, text: cell.text });
  }
  return { kind: 'recognised', rows, columns, cells: [...placed.values()] };
}

/**
 * Every table a service answered, each placed on its own: a table that cannot be placed is left out and the others are kept
 * (ADR-0222 Decision 4). The answer is refused only when the service returned tables and NONE could be placed — the first
 * refusal, whose sentence says why — so a page whose second table is unusable still gives its first.
 */
export function placedTables(
  tables: readonly (readonly RecognisedCell[])[],
  maxCells: number,
  maxText: number,
): readonly RecognisedTable[] {
  const placed: RecognisedTable[] = [];
  let firstRefusal: RecognisedTableRefused | undefined;
  for (const cells of tables) {
    try {
      placed.push(recognisedTable(cells, maxCells, maxText));
    } catch (thrown) {
      if (!(thrown instanceof RecognisedTableRefused)) throw thrown;
      firstRefusal ??= thrown;
    }
  }
  if (placed.length === 0 && firstRefusal !== undefined) throw firstRefusal;
  return placed;
}

/** Whether `cell`'s span covers the place at `row`, `column`. */
function covers(cell: { row: number; column: number; rowSpan: number; columnSpan: number }, row: number, column: number): boolean {
  return row >= cell.row && row < cell.row + cell.rowSpan && column >= cell.column && column < cell.column + cell.columnSpan;
}
