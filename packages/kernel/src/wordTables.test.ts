import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import { viewportPoint } from '@monstera/shared';

import type { MupdfSession } from './engineSeam.js';
import { mupdfWriter } from './mupdfWriter.js';
import { ooxmlPackage } from './ooxmlPackage.js';
import type { RecognisedLine } from './ocrRecognise.js';
import { glyphlessFont, writeRecognisedText } from './ocrTextLayer.js';
import type { PageTable, TableCell, TextLine } from './textStructure.js';
import { type WordMode, type WordPage, wordDocumentParts } from './wordDocument.js';
import { composeWordDocument } from './wordPictures.js';

/**
 * A table in a Word export is a Word table: rows and cells, not lines of text (ADR-0202's neighbour, the owner's
 * order of 2026-10-08 — Excel got cells for a handwritten table, Word got a paragraph per line).
 *
 * The end-to-end cases write a grid of INVISIBLE words — what a recognised handwritten page is — with no ruling line
 * anywhere, and read the package back.
 */

function recognised(text: string, x: number, y: number): RecognisedLine {
  const box: [number, number, number, number] = [x, y, x + 100, y + 14];
  return { text, box, words: [{ text, box, confidence: 90 }] };
}

const HEADER = ['Item', 'Qty', 'Price'];

/** A handwritten-looking page: a sentence, a 4-row grid of invisible words `columns` wide, a closing sentence. */
async function handwrittenTable(columns: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  // Typed text above and below, from a standard font, so the table is the only thing the words have in common.
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Order notes for March', { x: 100, y: 700, size: 14, font });
  page.drawText('Signed by the buyer', { x: 100, y: 100, size: 14, font });
  const lines: RecognisedLine[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const text = row === 0 ? (HEADER[column] ?? '') : `r${String(row)}c${String(column)}`;
      // Displayed space is y-down; the layer is written in user space (y-up) for an unrotated page.
      lines.push(recognised(text, 100 + column * 200, 792 - (500 + row * 30) - 14));
    }
  }
  writeRecognisedText(page, glyphlessFont(document), lines);
  return document.save();
}

async function composed(session: MupdfSession, mode: WordMode): Promise<string> {
  const { chunks } = composeWordDocument(session, mode, [0]);
  const parts: Uint8Array[] = [];
  for await (const part of chunks) parts.push(part);
  const files = unzipSync(Buffer.concat(parts));
  return strFromU8(files['word/document.xml'] ?? new Uint8Array());
}

describe('Word export — a recognised table is a Word table', () => {
  let session: MupdfSession;
  beforeAll(async () => {
    session = await mupdfWriter.open(await handwrittenTable(2));
  });

  it.each(['text', 'rich'] as const)('%s: four rows of two cells, the words in the cells', async (mode) => {
    const xml = await composed(session, mode);
    expect(xml.match(/<w:tr>/gu)).toHaveLength(4);
    expect(xml.match(/<w:tc>/gu)).toHaveLength(8);
    for (const word of ['Item', 'Qty', 'r3c1']) expect(xml).toContain(`>${word}<`);
    // Handwriting has no ruling to find, so the table is ruled all round and reads as a grid.
    expect(xml).toContain('<w:tblBorders>');
  });

  it('the table sits between the sentences it sits between, and its words are in no paragraph of their own', async () => {
    const xml = await composed(session, 'text');
    const above = xml.indexOf('Order notes for March');
    const table = xml.indexOf('<w:tbl>');
    const below = xml.indexOf('Signed by the buyer');
    expect(above).toBeGreaterThan(0);
    expect(table).toBeGreaterThan(above);
    expect(below).toBeGreaterThan(xml.indexOf('</w:tbl>'));
    // Each cell word appears once: written in its cell and not again as a line.
    expect(xml.split('>r2c1<')).toHaveLength(2);
  });

  it('CONTROL: layout mode places lines at their boxes and writes no table', async () => {
    const xml = await composed(session, 'layout');
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).toContain('r2c1');
  });
});

describe('Word export — a grid the engine reads incompletely stays text', () => {
  it('writes no table for a three-column grid the engine read as two, and keeps every word', async () => {
    // MEASURED 2026-10-08: the engine's table read answers 2 columns for this grid. A table of two columns with the third
    // left as paragraphs would lie about the page, so the export writes none and the words stay as they were.
    const session = await mupdfWriter.open(await handwrittenTable(3));
    const xml = await composed(session, 'text');
    expect(xml).not.toContain('<w:tbl>');
    for (const word of ['Price', 'r1c2', 'r3c2', 'r2c0']) expect(xml).toContain(word);
  });
});

describe('Word export — a page of prose gets no table', () => {
  it('writes none for a page the table read found nothing on', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([612, 792]);
    page.drawText('Only a sentence on this page', { x: 100, y: 700, size: 14, font: await document.embedFont(StandardFonts.Helvetica) });
    const session = await mupdfWriter.open(await document.save());
    expect(await composed(session, 'text')).not.toContain('<w:tbl>');
  });
});

function textLine(text: string, x: number, y: number, typed = false): TextLine {
  return {
    text,
    box: { topLeft: viewportPoint(x, y), bottomRight: viewportPoint(x + 50, y + 12) },
    origin: viewportPoint(x, y + 10),
    size: 11,
    font: { name: typed ? 'Helvetica' : 'MonsteraGlyphless', family: 'sans-serif', bold: false, italic: false },
  };
}

function cell(text: string, x: number, y: number, fill?: readonly [number, number, number]): TableCell {
  return { lines: [textLine(text, x, y)], ...(fill === undefined ? {} : { fill }) };
}

async function xmlOf(tables: readonly PageTable[], mode: WordMode = 'text'): Promise<string> {
  async function* pages(): AsyncIterable<WordPage> {
    yield await Promise.resolve({
      index: 0,
      text: { blocks: [], images: 0 },
      size: { width: 612, height: 792 },
      pictures: [],
      tables,
    });
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of ooxmlPackage(wordDocumentParts(mode, pages(), () => Promise.resolve([])))) chunks.push(chunk);
  const files = unzipSync(Buffer.concat(chunks));
  return strFromU8(files['word/document.xml'] ?? new Uint8Array());
}

describe('wordTable', () => {
  it('gives the last cell of a short row the columns the row lacks, so the table stays rectangular', async () => {
    const xml = await xmlOf([
      {
        columns: 3,
        rows: [[cell('a', 72, 100), cell('b', 200, 100), cell('c', 330, 100)], [cell('wide', 72, 130), cell('x', 200, 130)]],
        borders: null,
      },
    ]);
    expect(xml.match(/<w:gridCol /gu)).toHaveLength(3);
    // The second row's last cell covers columns 2 and 3.
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml.match(/<w:gridSpan/gu)).toHaveLength(1);
  });

  it('writes a cell fill as a shade, and escapes a cell that holds markup', async () => {
    const xml = await xmlOf([
      {
        columns: 2,
        rows: [
          [cell('1 < 2 & 3', 72, 100, [1, 0, 0.5]), cell('b', 200, 100)],
          [cell('c', 72, 130), cell('d', 200, 130)],
        ],
        borders: null,
      },
    ]);
    expect(xml).toContain('w:fill="ff0080"');
    expect(xml).toContain('1 &lt; 2 &amp; 3');
  });

  it('CONTROL: typed rows with no ruling are NOT a table, however aligned — they stay paragraphs', async () => {
    const typed = (text: string, x: number, y: number): TableCell => ({ lines: [textLine(text, x, y, true)] });
    const xml = await xmlOf([
      { columns: 2, rows: [[typed('a', 72, 100), typed('b', 200, 100)], [typed('c', 72, 130), typed('d', 200, 130)]], borders: null },
    ]);
    expect(xml).not.toContain('<w:tbl>');
  });

  it('only the recognised rows of a mixed grid are a table: a typed row beside them stays out of it', async () => {
    const typed = (text: string, x: number): TableCell => ({ lines: [textLine(text, x, 50, true)] });
    const xml = await xmlOf([
      {
        columns: 2,
        rows: [
          [typed('title', 72), typed('', 200)],
          [cell('a', 72, 100), cell('b', 200, 100)],
          [cell('c', 72, 130), cell('d', 200, 130)],
        ],
        borders: null,
      },
    ]);
    expect(xml.match(/<w:tr>/gu)).toHaveLength(2);
    expect(xml).not.toContain('>title<');
  });

  it('a single recognised row is not a table', async () => {
    const xml = await xmlOf([{ columns: 2, rows: [[cell('a', 72, 100), cell('b', 200, 100)]], borders: null }]);
    expect(xml).not.toContain('<w:tbl>');
  });

  it('writes ruled edges cell by cell where the engine found ruling, and no table-wide rules', async () => {
    const xml = await xmlOf([
      {
        columns: 1,
        rows: [[cell('a', 72, 100)]],
        borders: [[{ top: true, left: false, bottom: true, right: false }]],
      },
    ]);
    expect(xml).toContain('<w:tcBorders>');
    expect(xml).not.toContain('<w:tblBorders>');
  });

  it('an empty cell is still a paragraph, which Word requires', async () => {
    const row = (y: number): TableCell[] => [cell('a', 72, y), cell('b', 200, y), { lines: [] }];
    const xml = await xmlOf([{ columns: 3, rows: [row(100), row(130)], borders: null }]);
    expect(xml.match(/<w:tc>/gu)).toHaveLength(6);
    expect(xml).toContain('</w:tcPr><w:p></w:p></w:tc>');
  });
});
