import { PDFDocument } from '@cantoo/pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { WorkbookUnsplittable, joinPdfs, pdfPageCount, workbookOutline, workbookPart } from './workbookParts.js';

/**
 * Cutting a workbook into parts x2t converts whole (decision C). What is under test is the edit to `workbook.xml` —
 * which sheet shows, which is active, which rows print — and that nothing else in the package moves. That the parts
 * then convert to exactly those rows is `officeWorkbookParts.mjs`' measurement through the real converter.
 */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function workbook(options: { readonly definedNames?: string; readonly bookViews?: string } = {}): Uint8Array {
  return zipSync({
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}">${options.bookViews ?? ''}<sheets>` +
        '<sheet name="First" sheetId="1" r:id="rId1"/>' +
        '<sheet name="R&amp;D" sheetId="2" r:id="rId2" state="hidden"/>' +
        '<sheet name="Third" sheetId="3" r:id="rId3" state="veryHidden"/>' +
        '<sheet name="Fourth" sheetId="4" r:id="rId4"/>' +
        `</sheets>${options.definedNames ?? ''}</workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        [1, 2, 3, 4].map((n) => `<Relationship Id="rId${String(n)}" Type="${REL}/worksheet" Target="worksheets/sheet${String(n)}.xml"/>`).join('') +
        '</Relationships>',
    ),
    // A ROW WITH NO `r` is the one after the last, so sheet 1's last row is 7.
    'xl/worksheets/sheet1.xml': strToU8(`${XML}<worksheet xmlns="${MAIN}"><sheetData><row r="5"/><row r="6"/><row/></sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': strToU8(`${XML}<worksheet xmlns="${MAIN}"><sheetData><row r="2"/></sheetData></worksheet>`),
    'xl/worksheets/sheet3.xml': strToU8(`${XML}<worksheet xmlns="${MAIN}"><sheetData/></worksheet>`),
    'xl/worksheets/sheet4.xml': strToU8(`${XML}<worksheet xmlns="${MAIN}"><sheetData><row r="40000"/></sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`${XML}<sst xmlns="${MAIN}"/>`),
  });
}

const workbookXml = (xlsx: Uint8Array): string => strFromU8(unzipSync(xlsx)['xl/workbook.xml'] ?? new Uint8Array());

/** The sheets' states, in order, as the part's workbook says them. */
function states(xlsx: Uint8Array): string[] {
  return [...workbookXml(xlsx).matchAll(/<sheet\b[^>]*>/gu)].map((match) => /state="([^"]+)"/u.exec(match[0])?.[1] ?? 'visible');
}

describe('the outline', () => {
  it('lists every sheet in order with its state and last row, a row with no number counted as the next', () => {
    expect(workbookOutline(workbook())).toStrictEqual([
      { name: 'First', state: 'visible', lastRow: 7 },
      { name: 'R&D', state: 'hidden', lastRow: 2 },
      { name: 'Third', state: 'veryHidden', lastRow: 0 },
      { name: 'Fourth', state: 'visible', lastRow: 40000 },
    ]);
  });
});

describe('a part', () => {
  it('shows its sheet alone — the other visible sheet hidden, hidden and very hidden left as they were', () => {
    const part = workbookPart(workbook(), 3, null);
    expect(part).not.toBeNull();
    expect(states(part ?? new Uint8Array())).toStrictEqual(['hidden', 'hidden', 'veryHidden', 'visible']);
  });

  it('makes its sheet the active tab where the workbook names one', () => {
    const part = workbookPart(workbook({ bookViews: '<bookViews><workbookView activeTab="0"/></bookViews>' }), 3, null);
    expect(workbookXml(part ?? new Uint8Array())).toContain('activeTab="3"');
  });

  /** x2t prints the sheet `activeTab` names and the first where there is none — so a part with none would print sheet 1. */
  it('and GIVES the workbook an active tab, before its sheets, where it names none', () => {
    const text = workbookXml(workbookPart(workbook(), 3, null) ?? new Uint8Array());
    expect(text).toContain('<bookViews><workbookView activeTab="3"/></bookViews><sheets>');
  });

  it('prints the block of rows it is given, over the sheet’s whole width, where the author set no print area', () => {
    const part = workbookPart(workbook(), 3, { from: 20001, to: 40000 });
    expect(workbookXml(part ?? new Uint8Array())).toContain(
      `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="3">'Fourth'!$20001:$40000</definedName></definedNames>`,
    );
  });

  /** THE AUTHOR'S PRINT AREA IS INTERSECTED, never replaced: a part prints nothing the whole workbook would not. */
  it('narrows the author’s own print area to the block — columns kept, rows met — and each range of it', () => {
    const names = '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="3">Fourth!$A$2:$C$30000,Fourth!$E:$F</definedName></definedNames>';
    const part = workbookPart(workbook({ definedNames: names }), 3, { from: 20001, to: 40000 });
    expect(workbookXml(part ?? new Uint8Array())).toContain('>Fourth!$A$20001:$C$30000,Fourth!$E$20001:$F$40000<');
  });

  it('answers NOTHING TO PRINT where the author’s print area does not reach the block', () => {
    const names = '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="3">Fourth!$A$2:$C$300</definedName></definedNames>';
    expect(workbookPart(workbook({ definedNames: names }), 3, { from: 20001, to: 40000 })).toBeNull();
  });

  it('REFUSES a print area it cannot narrow, rather than guessing at it', () => {
    const names = '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="3">Fourth!MyRange</definedName></definedNames>';
    expect(() => workbookPart(workbook({ definedNames: names }), 3, { from: 1, to: 5 })).toThrow(WorkbookUnsplittable);
  });

  it('CONTROL: carries every other part of the package as the same bytes', () => {
    const original = unzipSync(workbook());
    const part = unzipSync(workbookPart(workbook(), 3, { from: 1, to: 5 }) ?? new Uint8Array());
    for (const [name, bytes] of Object.entries(original)) {
      if (name === 'xl/workbook.xml') continue;
      expect(part[name], name).toStrictEqual(bytes);
    }
  });
});

describe('joining', () => {
  async function pdf(pages: number): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    for (let page = 0; page < pages; page += 1) document.addPage([100 + page, 100]);
    return document.save();
  }

  it('joins the PDFs in order and answers each one’s page count', async () => {
    const joined = await joinPdfs([await pdf(2), await pdf(3)]);
    if (!('pdf' in joined)) throw new Error('a part was unreadable');
    expect(joined.pages).toStrictEqual([2, 3]);
    const read = await PDFDocument.load(joined.pdf);
    expect(read.getPages().map((page) => page.getWidth())).toStrictEqual([100, 101, 100, 101, 102]);
  });

  it('names the part it could not read, and counts a PDF it can', async () => {
    expect(await joinPdfs([await pdf(1), new Uint8Array([1, 2, 3])])).toStrictEqual({ unreadable: 1 });
    expect(await pdfPageCount(await pdf(4))).toBe(4);
    expect(await pdfPageCount(new Uint8Array([1]))).toBeNull();
  });
});
