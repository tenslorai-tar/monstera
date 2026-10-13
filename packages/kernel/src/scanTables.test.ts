import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { ooxmlPackage } from './ooxmlPackage.js';
import { pageTablesOfScan } from './scanTableShape.js';
import { spreadsheetParts } from './spreadsheetDocument.js';
import { applyOcrPage } from './ocrTextLayer.js';
import { SCAN_TABLE_ROWS, buildRuledTablePdf, buildScannedTablePdf, scanTableRecognised } from './scanTableFixture.js';
import { readScanTables } from './scanTables.js';
import { parsePageTables } from './textStructure.js';
import { stextOptionsFor } from './textStructure.js';

/**
 * The owner's O2: a printed scan of a clean ruled table, recognised on this computer, is read as that table (ADR-0233).
 *
 * The recognised layer here is written by the real writer (`applyOcrPage`) from a recognition placed at the words' true
 * places (`scanTableRecognised`) — NOT a Tesseract reading, which needs a model this environment cannot fetch; the
 * Tesseract half runs in `scripts/proofs/scanTable.proof.mjs`, on CI's provisioned models. What this proves is the table
 * read: rulings from the pixels, words from the layer, each to its cell.
 *
 * The CONTROL reproduces the defect: MuPDF's own table read, the only one the export asked before, finds NO table on the
 * same recognised scan, and finds the table on the vector original, so the difference is the rulings being pixels.
 */

async function recognisedScan(): Promise<Uint8Array> {
  return applyOcrPage(await buildScannedTablePdf(), { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' }, await scanTableRecognised());
}

async function onSession<T>(bytes: Uint8Array, work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** How many ruled cell sides MuPDF's own table read of page 0 reports, as `pageTables` asks it. */
async function engineRuledSides(bytes: Uint8Array): Promise<number> {
  return onSession(bytes, (session) =>
    withDocument(session, (document) => {
      const json = document.loadPage(0).toStructuredText(stextOptionsFor('table')).asJSON();
      return parsePageTables(json)
        .tables.flatMap((table) => table.borders ?? [])
        .flat()
        .reduce((sum, side) => sum + [side.top, side.left, side.bottom, side.right].filter(Boolean).length, 0);
    }),
  );
}

describe('a scanned ruled table, recognised on this computer', () => {
  it('CONTROL: MuPDF’s table read sees the vector original’s rulings and NONE of the recognised scan’s', async () => {
    expect(await engineRuledSides(await buildRuledTablePdf())).toBeGreaterThan(0);
    expect(await engineRuledSides(await recognisedScan())).toBe(0);
  });

  it('is read as ONE table, every cell holding its own words, every side ruled', async () => {
    const tables = await onSession(await recognisedScan(), (session) => readScanTables(session, 0));
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table?.columns).toBe(SCAN_TABLE_ROWS[0]?.length);
    const read = table?.rows.map((row) => row.map((lines) => lines.map((line) => line.text).join('\n')));
    expect(read).toStrictEqual(SCAN_TABLE_ROWS);
    expect(table?.borders.flat().every((side) => side.top && side.left && side.bottom && side.right)).toBe(true);
  });

  it('is written to the workbook with every word in its cell, ruled, and in no glyphless font', async () => {
    const tables = await onSession(await recognisedScan(), (session) => readScanTables(session, 0));
    const chunks: Uint8Array[] = [];
    const pages = (async function* () {
      yield await Promise.resolve({ page: 0, edits: [], tables: pageTablesOfScan(tables) });
    })();
    for await (const chunk of ooxmlPackage(spreadsheetParts(pages, 'one-sheet'))) chunks.push(chunk);
    const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      total.set(chunk, at);
      at += chunk.length;
    }
    const parts = Object.values(unzipSync(total)).map((bytes) => strFromU8(bytes));
    const all = parts.join('\n');
    for (const word of SCAN_TABLE_ROWS.flat()) expect(all, word).toContain(word.includes('.') || /^\d+$/u.test(word) ? word.replace(/0+$/u, '').replace(/\.$/u, '') : word);
    expect(all).not.toContain('MonsteraGlyphless');
    expect(all).toMatch(/<border><left style="thin"/u);
  });

  it('an unrecognised scan has the grid and no words, so nothing is invented', async () => {
    const tables = await onSession(await buildScannedTablePdf(), (session) => readScanTables(session, 0));
    expect(tables).toHaveLength(1);
    expect(tables[0]?.rows.flat().every((lines) => lines.length === 0)).toBe(true);
  });
});
