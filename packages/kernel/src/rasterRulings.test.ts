import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { SKEW_DPI, greyRasterOfPage } from './pageSkew.js';
import { gridsOf, rulingsOf } from './rasterRulings.js';
import { SCAN_TABLE_ROWS, buildScannedTablePdf } from './scanTableFixture.js';

/**
 * A scanned table's rulings, read from its pixels (ADR-0233). The fixture is a picture of a ruled table and nothing else
 * (`scanTableFixture.ts`), rasterised as the host rasterises a page (`greyRasterOfPage`).
 *
 * The CONTROLS are the pages that hold long straight ink and no table: words with an underline, and a lone frame's side,
 * each of which a finder that took every long run for a ruling would turn into a grid.
 */

async function rasterOf(bytes: Uint8Array): Promise<ReturnType<typeof greyRasterOfPage>> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => greyRasterOfPage(document.loadPage(0)));
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('rulings read from a scan', () => {
  it('finds the scanned table as ONE grid of its rows and columns, every side ruled', async () => {
    const grids = gridsOf(rulingsOf(await rasterOf(await buildScannedTablePdf()), SKEW_DPI), SKEW_DPI);
    expect(grids).toHaveLength(1);
    const [grid] = grids;
    expect(grid?.rows).toHaveLength(SCAN_TABLE_ROWS.length + 1);
    expect(grid?.columns).toHaveLength((SCAN_TABLE_ROWS[0]?.length ?? 0) + 1);
    expect(grid?.borders.flat().every((cell) => cell.top && cell.left && cell.bottom && cell.right)).toBe(true);
  });

  it('CONTROL: words, an underline and one long rule with nothing meeting it are no table', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('A heading with words that are not a table', { x: 72, y: 700, size: 28, font });
    page.drawLine({ start: { x: 72, y: 690 }, end: { x: 540, y: 690 }, thickness: 1.2, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 300, y: 100 }, end: { x: 300, y: 600 }, thickness: 1.2, color: rgb(0, 0, 0) });
    const rulings = rulingsOf(await rasterOf(await document.save()), SKEW_DPI);
    // THE INSTRUMENT SEES the underline and the rule, so *no grid* below is about grids and not a blind reading.
    expect(rulings.horizontal.length).toBeGreaterThanOrEqual(1);
    expect(rulings.vertical.length).toBeGreaterThanOrEqual(1);
    expect(gridsOf(rulings, SKEW_DPI)).toStrictEqual([]);
  });

  it('a solid filled box is not taken for rulings', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    page.drawRectangle({ x: 100, y: 300, width: 300, height: 200, color: rgb(0, 0, 0) });
    expect(gridsOf(rulingsOf(await rasterOf(await document.save()), SKEW_DPI), SKEW_DPI)).toStrictEqual([]);
  });
});
