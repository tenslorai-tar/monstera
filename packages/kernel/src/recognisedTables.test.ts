import { describe, expect, it } from 'vitest';

import { type RecognisedCell, RecognisedTableRefused, recognisedTable } from './recognisedTables.js';

const cell = (row: number, column: number, text: string, rowSpan = 1, columnSpan = 1): RecognisedCell => ({
  row,
  column,
  rowSpan,
  columnSpan,
  text,
});

const BOUNDS = [4096, 2048] as const;

describe('a service’s table, read once', () => {
  it('accepts a grid whose cells fit it, a merged header included', () => {
    const table = recognisedTable(
      2,
      3,
      [cell(0, 0, 'Quarter', 1, 3), cell(1, 0, 'Q1'), cell(1, 1, '120'), cell(1, 2, '135')],
      ...BOUNDS,
    );
    expect(table).toStrictEqual({
      kind: 'recognised',
      rows: 2,
      columns: 3,
      cells: [cell(0, 0, 'Quarter', 1, 3), cell(1, 0, 'Q1'), cell(1, 1, '120'), cell(1, 2, '135')],
    });
  });

  it('refuses a span that runs past the grid, and CONTROL: the same span inside it is accepted', () => {
    expect(() => recognisedTable(2, 3, [cell(0, 1, 'wide', 1, 3)], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable(2, 3, [cell(0, 0, 'wide', 1, 3)], ...BOUNDS)).not.toThrow();
  });

  it('refuses two cells claiming one place, and CONTROL: neighbours that only touch are accepted', () => {
    // A merged cell reported AND the cell it covers reported too is the service contradicting its
    // own grid; placing either would be this build choosing what it meant.
    expect(() => recognisedTable(1, 3, [cell(0, 0, 'a', 1, 2), cell(0, 1, 'b')], ...BOUNDS)).toThrow(
      /two cells claim row 0, column 1/u,
    );
    expect(() => recognisedTable(1, 3, [cell(0, 0, 'a', 1, 2), cell(0, 2, 'b')], ...BOUNDS)).not.toThrow();
  });

  it('refuses a zero span, a negative index and a fractional one', () => {
    expect(() => recognisedTable(2, 2, [cell(0, 0, 'x', 0, 1)], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable(2, 2, [cell(-1, 0, 'x')], ...BOUNDS)).toThrow(RecognisedTableRefused);
    expect(() => recognisedTable(2, 2, [cell(0.5, 0, 'x')], ...BOUNDS)).toThrow(RecognisedTableRefused);
  });

  it('refuses a grid over the bound and a cell over the text bound', () => {
    expect(() => recognisedTable(100, 100, [], 4096, 2048)).toThrow(/10000 cells/u);
    expect(() => recognisedTable(1, 1, [cell(0, 0, 'x'.repeat(11))], 4096, 10)).toThrow(/11 characters/u);
  });

  it('refuses an empty grid, which no table has', () => {
    expect(() => recognisedTable(0, 3, [], ...BOUNDS)).toThrow(RecognisedTableRefused);
  });
});
