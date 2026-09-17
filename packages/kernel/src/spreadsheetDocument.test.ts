import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ooxmlPackage } from './ooxmlPackage.js';
import {
  MAX_CELL_STYLES,
  type SheetLayout,
  type SpreadsheetPage,
  cellValue,
  columnName,
  spreadsheetParts,
} from './spreadsheetDocument.js';
import type { PageTable, TableCell, TextLine } from './textStructure.js';
import { viewportPoint } from '@monstera/shared';

/**
 * The workbook writer, read back out of its own zip.
 *
 * What Excel makes of the file is measured, not asserted here: 2026-09-17, Excel
 * read a two-page export in both layouts through COM — values, number formats,
 * fonts, sizes, bold and all four borders as written — and refused a control
 * whose sheet XML was cut short. These cases hold the writer to that shape.
 */

function line(text: string, font: Partial<TextLine['font']> = {}, size = 10): TextLine {
  return {
    text,
    box: { topLeft: viewportPoint(0, 0), bottomRight: viewportPoint(10, 10) },
    origin: viewportPoint(0, 10),
    size,
    font: { name: 'ABCDEF+Helvetica-Bold', family: 'sans-serif', bold: false, italic: false, ...font },
  };
}

function cell(...texts: string[]): TableCell {
  return { lines: texts.map((text) => line(text)) };
}

function table(rows: readonly (readonly TableCell[])[], ruled = false): PageTable {
  const columns = Math.max(...rows.map((row) => row.length));
  const edges = { top: true, left: true, bottom: true, right: true };
  return { columns, rows, borders: ruled ? rows.map((row) => row.map(() => edges)) : null };
}

async function* pagesOf(pages: readonly SpreadsheetPage[]): AsyncIterable<SpreadsheetPage> {
  for (const page of pages) yield await Promise.resolve(page);
}

async function written(pages: readonly SpreadsheetPage[], layout: SheetLayout): Promise<Record<string, string>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of ooxmlPackage(spreadsheetParts(pagesOf(pages), layout))) chunks.push(chunk);
  const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    total.set(chunk, at);
    at += chunk.length;
  }
  return Object.fromEntries(Object.entries(unzipSync(total)).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

const TWO_PAGES: readonly SpreadsheetPage[] = [
  { page: 0, tables: [] },
  { page: 1, tables: [table([[cell('Item'), cell('Qty')], [cell('Bolt'), cell('12')]], true)] },
  { page: 3, tables: [table([[cell('a')]]), table([[cell('b')]])] },
];

describe('cellValue — a number only where the text is unmistakably one', () => {
  it('stores printed numbers as numbers, with a format that shows them as printed', () => {
    expect(cellValue('12')).toStrictEqual({ kind: 'number', value: 12, format: '0' });
    expect(cellValue(' 0.45 ')).toStrictEqual({ kind: 'number', value: 0.45, format: '0.00' });
    expect(cellValue('-1,234.50')).toStrictEqual({ kind: 'number', value: -1234.5, format: '#,##0.00' });
    expect(cellValue('12.5%')).toStrictEqual({ kind: 'number', value: 0.125, format: '0.0%' });
    expect(cellValue('7.25%')).toStrictEqual({ kind: 'number', value: 0.0725, format: '0.00%' });
  });

  it('CONTROL: keeps as text what a page alone cannot tell is a number', () => {
    // A COMMA DECIMAL is a thousands separator elsewhere; a leading zero is an
    // identifier's; a misplaced group is not a grouping.
    for (const text of ['1,5', '007', '12,34', '1.234,50', 'n/a', '', '1e5', '12 %', '1,2345']) {
      expect(cellValue(text)).toStrictEqual({ kind: 'text', text });
    }
  });
});

describe('columnName', () => {
  it('names columns as Excel does, across the one- and two-letter boundary', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toStrictEqual([
      'A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA',
    ]);
  });
});

describe('spreadsheetParts', () => {
  it('writes a sheet per page WITH tables, named by its printed page number', async () => {
    const files = await written(TWO_PAGES, 'sheet-per-page');

    expect(files['xl/workbook.xml']).toContain('<sheet name="2" sheetId="1" r:id="rId1"/><sheet name="4" sheetId="2" r:id="rId2"/>');
    expect(files['xl/worksheets/sheet3.xml']).toBeUndefined();
    // THE SECOND PAGE'S TWO TABLES go down one sheet with a blank row between.
    expect(files['xl/worksheets/sheet2.xml']).toContain('<row r="1"><c r="A1"');
    expect(files['xl/worksheets/sheet2.xml']).toContain('<row r="3"><c r="A3"');
    expect(files['[Content_Types].xml']).toContain('/xl/worksheets/sheet2.xml');
    expect(files['xl/_rels/workbook.xml.rels']).toContain('Target="styles.xml"');
  });

  it('writes one sheet holding every table when asked, named by the pages it spans', async () => {
    const files = await written(TWO_PAGES, 'one-sheet');

    expect(files['xl/workbook.xml']).toContain('<sheet name="2-4" sheetId="1" r:id="rId1"/></sheets>');
    const sheet = files['xl/worksheets/sheet1.xml'] ?? '';
    // Rows 1-2 the first table, 3 blank, 4 and 6 the next page's two.
    expect([...sheet.matchAll(/<row r="(\d+)">/gu)].map((match) => match[1])).toStrictEqual(['1', '2', '4', '6']);
  });

  it('writes a number as a value with its format, and text inline and escaped', async () => {
    const files = await written(
      [{ page: 0, tables: [table([[cell('East & <West>'), cell('1,234.50')]])] }],
      'sheet-per-page',
    );
    const sheet = files['xl/worksheets/sheet1.xml'] ?? '';
    const styles = files['xl/styles.xml'] ?? '';

    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">East &amp; &lt;West&gt;</t></is></c>');
    expect(sheet).toMatch(/<c r="B1" s="(\d+)"><v>1234.5<\/v><\/c>/u);
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="#,##0.00"/>');
  });

  it('carries the font MuPDF reported — base name, size, bold — and thin borders where ruled', async () => {
    const bold: TableCell = { lines: [line('Head', { bold: true }, 12.3)] };
    const files = await written([{ page: 0, tables: [table([[bold]], true)] }], 'sheet-per-page');
    const styles = files['xl/styles.xml'] ?? '';

    expect(styles).toContain('<font><b/><sz val="12.5"/><name val="Helvetica"/></font>');
    expect(styles).toContain('<left style="thin"><color auto="1"/></left>');
    expect(styles).toMatch(/<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"\/>/u);
  });

  it('CONTROL: an unruled table declares no border beyond the empty one', async () => {
    const files = await written([{ page: 0, tables: [table([[cell('x')]])] }], 'sheet-per-page');
    expect(files['xl/styles.xml']).toContain('<borders count="1">');
  });

  it('wraps a cell of several lines, each on its own line', async () => {
    const files = await written([{ page: 0, tables: [table([[cell('first', 'second')]])] }], 'sheet-per-page');
    expect(files['xl/worksheets/sheet1.xml']).toContain('first\nsecond');
    expect(files['xl/styles.xml']).toContain('<alignment wrapText="1" vertical="top"/>');
  });

  it('stops declaring styles at the bound and gives further cells the plain one', async () => {
    const rows = Array.from({ length: MAX_CELL_STYLES + 2 }, (_unused, index) => [
      { lines: [line(`v${String(index)}`, {}, 1 + index / 2)] },
    ]);
    const files = await written([{ page: 0, tables: [table(rows)] }], 'sheet-per-page');
    const sheet = files['xl/worksheets/sheet1.xml'] ?? '';

    expect(files['xl/styles.xml']).toContain(`<cellXfs count="${String(MAX_CELL_STYLES + 1)}">`);
    expect(sheet).toContain(`<c r="A${String(MAX_CELL_STYLES + 2)}" t="inlineStr">`);
  });

  it('REFUSES a document with no table in either layout, rather than writing an empty workbook', async () => {
    for (const layout of ['sheet-per-page', 'one-sheet'] as const) {
      await expect(written([{ page: 0, tables: [] }], layout)).rejects.toThrow(/no page holds a table/u);
    }
  });
});
