import { describe, expect, it } from 'vitest';

import { type ScanTable, pageTablesOfScan, sawRulings } from './scanTableShape.js';
import type { PageTable } from './textStructure.js';

/**
 * Main's two decisions about a scanned table (ADR-0233): whether the engine's read saw rulings, which keeps a vector
 * table's answer, and the shape a scanned table takes for every consumer of the table read.
 */
describe('scanned-table shape', () => {
  const edges = { top: true, left: true, bottom: true, right: true };
  const none = { top: false, left: false, bottom: false, right: false };
  const unruled: PageTable = { columns: 1, rows: [[{ lines: [] }]], borders: [[none]] };

  it('a table read with a ruled side saw rulings', () => {
    expect(sawRulings([unruled, { columns: 1, rows: [[{ lines: [] }]], borders: [[{ ...none, left: true }]] }])).toBe(true);
  });

  it('CONTROL: unruled tables, tables with no borders and no tables saw none', () => {
    expect(sawRulings([unruled, { columns: 1, rows: [[{ lines: [] }]], borders: null }])).toBe(false);
    expect(sawRulings([])).toBe(false);
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
