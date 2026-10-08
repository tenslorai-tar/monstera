import { describe, expect, it } from 'vitest';

import { type RecognisedCell, RecognisedTableRefused, placedTables, recognisedTable } from './recognisedTables.js';

const cell = (row: number, column: number, text: string, rowSpan = 1, columnSpan = 1): RecognisedCell => ({
  row,
  column,
  rowSpan,
  columnSpan,
  text,
});

const BOUNDS = [4096, 2048] as const;

describe('a service’s table, read once (ADR-0222)', () => {
  it('is the extent of its cells, a merged header included', () => {
    const table = recognisedTable([cell(0, 0, 'Quarter', 1, 3), cell(1, 0, 'Q1'), cell(1, 1, '120'), cell(1, 2, '135')], ...BOUNDS);
    expect(table).toStrictEqual({
      kind: 'recognised',
      rows: 2,
      columns: 3,
      cells: [cell(0, 0, 'Quarter', 1, 3), cell(1, 0, 'Q1'), cell(1, 1, '120'), cell(1, 2, '135')],
    });
  });

  it('WRITES A RAGGED ANSWER WHOLE: a header of three cells over rows of four is four columns, as the owner’s page was', () => {
    // Claude merged "Names Hours" into one header cell, declared three columns, and returned four cells in every data row.
    const header = [cell(0, 0, 'Names Hours'), cell(0, 1, 'Minutes'), cell(0, 2, 'Seconds')];
    const data = [
      [cell(1, 0, 'John'), cell(1, 1, '7'), cell(1, 2, '20'), cell(1, 3, '36')],
      [cell(2, 0, 'Mike'), cell(2, 1, '6'), cell(2, 2, '10'), cell(2, 3, '12')],
    ].flat();
    const table = recognisedTable([...header, ...data], ...BOUNDS);
    expect(table.columns).toBe(4);
    expect(table.rows).toBe(3);
    expect(table.cells).toHaveLength(header.length + data.length);
    // EVERY CELL IS KEPT where it was put, the fourth column's included.
    expect(table.cells.filter((each) => each.column === 3).map((each) => each.text)).toStrictEqual(['36', '12']);
    // CONTROL: the rule this replaced — a grid declared three wide — would have refused exactly this answer.
    const declaredColumns = 3;
    expect(table.cells.some((each) => each.column + each.columnSpan > declaredColumns)).toBe(true);
  });

  it('leaves a place no cell covers as an empty cell, never as a refusal', () => {
    const table = recognisedTable([cell(0, 0, 'a'), cell(2, 2, 'b')], ...BOUNDS);
    expect(table.rows).toBe(3);
    expect(table.columns).toBe(3);
    expect(table.cells.map((each) => each.text)).toStrictEqual(['a', 'b']);
  });

  it('a span past the other cells widens the grid and is kept whole', () => {
    expect(recognisedTable([cell(0, 1, 'wide', 1, 3)], ...BOUNDS)).toMatchObject({ rows: 1, columns: 4 });
  });

  it('joins two cells claiming one place and drops neither, and cuts a span back to the places still free', () => {
    const joined = recognisedTable([cell(0, 0, 'a', 1, 2), cell(0, 1, 'b'), cell(0, 2, 'c')], ...BOUNDS);
    expect(joined.cells).toStrictEqual([cell(0, 0, 'a b', 1, 2), cell(0, 2, 'c')]);
    // A SPAN INTO A PLACE ALREADY TAKEN is cut back to what is free.
    const cut = recognisedTable([cell(0, 1, 'x'), cell(0, 0, 'wide', 1, 3)], ...BOUNDS);
    expect(cut.cells).toStrictEqual([cell(0, 1, 'x'), cell(0, 0, 'wide')]);
    // CONTROL: neighbours that only touch are placed exactly as given.
    expect(recognisedTable([cell(0, 0, 'a', 1, 2), cell(0, 2, 'b')], ...BOUNDS).cells).toStrictEqual([cell(0, 0, 'a', 1, 2), cell(0, 2, 'b')]);
  });

  it('reads a span that is not a whole number of at least one as one', () => {
    expect(recognisedTable([cell(0, 0, 'x', 0, 1)], ...BOUNDS).cells).toStrictEqual([cell(0, 0, 'x')]);
    expect(recognisedTable([cell(0, 0, 'x', 1, Number.NaN)], ...BOUNDS).cells).toStrictEqual([cell(0, 0, 'x')]);
  });

  it('refuses only what cannot be placed at all: no cell, a negative or fractional index, a grid or a text over its bound', () => {
    expect(() => recognisedTable([], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable([cell(-1, 0, 'x')], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable([cell(0.5, 0, 'x')], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable([cell(99, 99, 'x')], 4096, 2048)).toThrow(/10000 cells/u);
    expect(() => recognisedTable([cell(0, 0, 'x'.repeat(11))], 4096, 10)).toThrow(/11 characters/u);
  });
});

describe('placedTables — each table is its own answer', () => {
  it('keeps the tables that were placed and leaves out the one that cannot be', () => {
    const placed = placedTables([[cell(0, 0, 'a')], [cell(-1, 0, 'bad')], [cell(0, 0, 'c')]], ...BOUNDS);
    expect(placed.map((table) => table.cells[0]?.text)).toStrictEqual(['a', 'c']);
  });

  it('refuses the answer, with the first sentence, only when none could be placed — and answers nothing for no table', () => {
    expect(() => placedTables([[cell(-1, 0, 'bad')], []], ...BOUNDS)).toThrow(/row -1/u);
    // CONTROL: a page with no table is an empty answer, not a refusal.
    expect(placedTables([], ...BOUNDS)).toStrictEqual([]);
  });
});
