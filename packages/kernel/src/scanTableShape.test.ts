import { describe, expect, it } from 'vitest';

import { viewportPoint } from '@monstera/shared';

import { type ScanTable, pageTablesOfScan, sawColumnRulings, withRuledTables } from './scanTableShape.js';
import type { PageTable, TableCell } from './textStructure.js';

/**
 * Main's decisions about a table read from rulings (ADR-0233, ADR-0297): whether the engine's read saw a rule DOWN, which
 * keeps its answer, the shape such a table takes for every consumer of the table read, and the one merge.
 */
describe('scanned-table shape', () => {
  const edges = { top: true, left: true, bottom: true, right: true };
  const none = { top: false, left: false, bottom: false, right: false };
  const unruled: PageTable = { columns: 1, rows: [[{ lines: [] }]], borders: [[none]] };

  it('a table read with a side ruled DOWN saw column rulings', () => {
    expect(sawColumnRulings([unruled, { columns: 1, rows: [[{ lines: [] }]], borders: [[{ ...none, left: true }]] }])).toBe(true);
    expect(sawColumnRulings([{ columns: 1, rows: [[{ lines: [] }]], borders: [[{ ...none, right: true }]] }])).toBe(true);
  });

  it('a table ruled only ACROSS saw no column ruling, so the page is asked for the tables its rules make (ADR-0297)', () => {
    // The old question, *any ruled side*, answered yes here and kept the engine's split answer for the Volunteers table.
    expect(sawColumnRulings([{ columns: 1, rows: [[{ lines: [] }]], borders: [[{ ...none, top: true, bottom: true }]] }])).toBe(false);
  });

  it('CONTROL: unruled tables, tables with no borders and no tables saw none', () => {
    expect(sawColumnRulings([unruled, { columns: 1, rows: [[{ lines: [] }]], borders: null }])).toBe(false);
    expect(sawColumnRulings([])).toBe(false);
  });

  const cellAt = (text: string, x: number, y: number): TableCell => ({
    lines: [
      {
        text,
        box: { topLeft: viewportPoint(x, y), bottomRight: viewportPoint(x + 40, y + 10) },
        origin: viewportPoint(x, y + 10),
        size: 10,
        font: { name: 'Helvetica', family: 'sans-serif', bold: false, italic: false },
      },
    ],
  });
  const tableOf = (cells: readonly (readonly [string, number, number])[]): PageTable => ({
    columns: 1,
    rows: cells.map(([text, x, y]) => [cellAt(text, x, y)]),
    borders: null,
  });

  it('withRuledTables: engine tables INSIDE a ruled one give way to it, top to bottom', () => {
    const first = tableOf([['Kitchen', 100, 200], ['Garden', 100, 220]]);
    const second = tableOf([['Front desk', 100, 240], ['Total', 100, 300]]);
    const ruled = tableOf([['Team', 100, 180], ['Kitchen', 100, 200], ['Total', 100, 300]]);
    // The split answer of the report's page 9: two engine tables, both inside the one ruled table.
    expect(withRuledTables([first, second], [ruled])).toStrictEqual([ruled]);
  });

  it('withRuledTables: an engine table ACROSS a ruled one gives way ROW BY ROW, and its rows outside are KEPT', () => {
    const ruled = tableOf([['Item code', 100, 180], ['CP-05', 100, 300]]);
    // The engine joined the table with its neighbours: a heading row above it, its own rows, and a clause row below.
    const swallowing = tableOf([['3. Products and Pricing', 100, 120], ['Item code', 100, 180], ['CP-05', 100, 300], ['3.2', 100, 340]]);
    const merged = withRuledTables([swallowing], [ruled]);
    expect(merged.map((table) => table.rows.map((row) => row[0]?.lines[0]?.text))).toStrictEqual([
      ['3. Products and Pricing'],
      ['Item code', 'CP-05'],
      ['3.2'],
    ]);
    // NO ROW OF THE ENGINE'S IS LOST: every word it read is in the merged answer once.
    expect(merged.flatMap((table) => table.rows).length).toBe(4);
  });

  it('CONTROL: an engine table CLEAR of every ruled one is kept, in its place on the page', () => {
    const above = tableOf([['Claims', 100, 40], ['Total', 100, 80]]);
    const ruled = tableOf([['Team', 100, 180], ['Total', 100, 300]]);
    const below = tableOf([['Notes', 100, 400], ['End', 100, 440]]);
    expect(withRuledTables([below, above], [ruled])).toStrictEqual([above, ruled, below]);
    expect(withRuledTables([above], [])).toStrictEqual([above]);
  });

  it('a scanned table becomes the table read’s shape, cell by cell, with its borders', () => {
    const scanned: ScanTable = {
      columns: 2,
      rows: [
        [
          [{ text: 'Region', box: { x0: 10, y0: 20, x1: 60, y1: 32 }, size: 13, font: { name: 'MonsteraGlyphless', family: 'sans-serif', bold: false, italic: false } }],
          [],
        ],
      ],
      borders: [[edges, edges]],
    };
    const [table] = pageTablesOfScan([scanned]);
    expect(table?.columns).toBe(2);
    expect(table?.rows[0]?.map((cell) => cell.lines.map((line) => line.text))).toStrictEqual([['Region'], []]);
    expect(table?.rows[0]?.[0]?.lines[0]?.box).toStrictEqual({ topLeft: { x: 10, y: 20 }, bottomRight: { x: 60, y: 32 } });
    expect(table?.borders).toStrictEqual([[edges, edges]]);
  });
});
