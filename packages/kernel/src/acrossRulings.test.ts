import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { acrossGrids, rulesAcross } from './acrossRulings.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageTablesOfScan, sawColumnRulings, withRuledTables } from './scanTableShape.js';
import { readScanTables } from './scanTables.js';
import { type PageTable, pageTextJsonOf, parsePageTables, stextOptionsFor } from './textStructure.js';

/**
 * A table ruled only ACROSS — a shaded header band and a light hairline under every row, nothing down — is read as ONE
 * table with its header (ADR-0297; the owner's list of 2026-11-19, items 1 and 2: the Supply Agreement's products table
 * read as no table, the report's Volunteers table as two without its header).
 *
 * The page is written by a SECOND library, pdf-lib, the way such documents are drawn. The CONTROL reproduces the defect:
 * MuPDF's own table read, the only one the export asked before, finds no whole table with a header on this page. The
 * second CONTROL is the same words with no rules, which is still not read as a table: the rules are the evidence.
 */

/** The Supply Agreement's products table, its words and its geometry as measured on 2026-11-19 (`_review/tableProbe.mjs`). */
const ROWS = [
  ['Item code', 'Description', 'Min. order', 'Unit', 'Unit price'],
  ['AH-210', 'Aluminium housing, 210 mm, anodised', '500', 'each', '14.60'],
  ['AH-340', 'Aluminium housing, 340 mm, anodised', '250', 'each', '22.85'],
  ['FS-M6', 'Stainless fastener set, M6 (100 pcs)', '40', 'box', '9.40'],
  ['GK-12', 'Gasket kit for AH series', '200', 'kit', '3.15'],
  ['CP-05', 'Machined end cap, 50 mm', '1,000', 'each', '1.92'],
];
/** Each column's left edge, in points. */
const COLUMN_X = [78, 160, 370, 438, 490];
const LEFT = 72;
const RIGHT = 540;
/** PDF space (up from the bottom), as the Supply Agreement's own content stream places them (read 2026-11-19). */
const HEADER_BASELINE = 343;
const ROW_BASELINES = [321, 301, 281, 261, 241];
const RULES = [314, 294, 274, 254, 234];
const BAND = { y: 337, height: 20 };

async function tablePage(rules: boolean): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  // A CONTRACT'S CLAUSES ABOVE AND BELOW, as close as the Supply Agreement sets them: a heading, clause 3.1's number and
  // two lines hung at 102, the table six points under them, and clause 3.2 below it. It is this neighbourhood that the
  // engine's segmentation joins the table into (measured: the table alone reads as one table, with either clause beside
  // it as none).
  const clause = (number: string, baselines: readonly number[]): void => {
    page.drawText(number, { x: LEFT, y: baselines[0] ?? 0, size: 10.5, font });
    for (const baseline of baselines) {
      page.drawText('The Supplier shall supply the products listed in the table below at the unit prices stated', {
        x: 102,
        y: baseline,
        size: 10.5,
        font,
      });
    }
  };
  page.drawText('3.  Products and Pricing', { x: LEFT, y: 395, size: 11.5, font: bold });
  clause('3.1', [379, 365]);
  clause('3.2', [211, 197, 183]);
  if (rules) {
    // THE HEADER BAND: a light shading, one row tall.
    page.drawRectangle({ x: LEFT, y: BAND.y, width: RIGHT - LEFT, height: BAND.height, color: rgb(0.92, 0.95, 0.97) });
  }
  for (const [row, cells] of ROWS.entries()) {
    const baseline = row === 0 ? HEADER_BASELINE : (ROW_BASELINES[row - 1] ?? 0);
    for (const [column, text] of cells.entries()) {
      page.drawText(text, { x: COLUMN_X[column] ?? 0, y: baseline, size: 9, font: row === 0 ? bold : font });
    }
    // A HAIRLINE UNDER EVERY ROW, stroked at half a point in the light grey the Supply Agreement draws (204, 211, 222).
    const rule = RULES[row - 1];
    if (rules && rule !== undefined) {
      page.drawLine({ start: { x: LEFT, y: rule }, end: { x: RIGHT, y: rule }, thickness: 0.5, color: rgb(0.8, 0.83, 0.87) });
    }
  }
  return document.save();
}

async function onSession<T>(bytes: Uint8Array, work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<T>): Promise<T> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await work(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** MuPDF's own table read of page 0, as `pageTables` asks it. */
async function engineTables(bytes: Uint8Array): Promise<readonly PageTable[]> {
  return onSession(bytes, (session) =>
    withDocument(session, (document) => parsePageTables(pageTextJsonOf(document.loadPage(0).toStructuredText(stextOptionsFor('table')))).tables),
  );
}

/** The page's tables as main's `pageTables` and the Word export now take them. */
async function pageTables(bytes: Uint8Array): Promise<readonly PageTable[]> {
  const engine = await engineTables(bytes);
  if (sawColumnRulings(engine)) return engine;
  return withRuledTables(engine, pageTablesOfScan(await onSession(bytes, (session) => readScanTables(session, 0))));
}

const texts = (table: PageTable | undefined): string[][] =>
  (table?.rows ?? []).map((row) => row.map((cell) => cell.lines.map((line) => line.text).join(' ')));

describe('a table ruled only across', () => {
  it('CONTROL: MuPDF’s own table read gives no single table holding the header and every row', async () => {
    const engine = await engineTables(await tablePage(true));
    expect(engine.some((table) => JSON.stringify(texts(table)) === JSON.stringify(ROWS))).toBe(false);
    // And it saw no rule down, so the page is asked for the tables its rules make.
    expect(sawColumnRulings(engine)).toBe(false);
  });

  it('is read as ONE table: the header row first, five columns, every cell its own words, the clauses outside it', async () => {
    const tables = await pageTables(await tablePage(true));
    const whole = tables.filter((table) => JSON.stringify(texts(table)) === JSON.stringify(ROWS));
    expect(whole).toHaveLength(1);
    expect(whole[0]?.columns).toBe(5);
    // RULED ACROSS, NOT DOWN, as drawn.
    expect(whole[0]?.borders?.[1]?.[1]).toStrictEqual({ top: true, left: false, bottom: true, right: false });
    // NO ROW OF IT IS ANYWHERE ELSE: the engine's rows the rules cover gave way, and what it kept is the clauses only.
    const elsewhere = tables.filter((table) => table !== whole[0]).flatMap((table) => texts(table).map((row) => row.join(' ').trim()));
    for (const row of ROWS) expect(elsewhere.some((text) => text.includes(row[0] ?? ''))).toBe(false);
  });

  it('CONTROL: the same words with no rules are not read as a table by this read', async () => {
    const tables = await onSession(await tablePage(false), (session) => readScanTables(session, 0));
    expect(tables).toHaveLength(0);
  });
});

describe('rules across, as pure rules', () => {
  const at = (y: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 66, y0: y - 0.25, x1: 500, y1: y + 0.25 });
  const characters = [
    { x0: 72, y0: 105, x1: 90, y1: 115 },
    { x0: 300, y0: 105, x1: 320, y1: 115 },
    { x0: 72, y0: 125, x1: 90, y1: 135 },
    { x0: 300, y0: 125, x1: 320, y1: 135 },
  ];

  it('a run of three rules of one width with text between is two rows and two columns', () => {
    const rules = rulesAcross([100, 120, 140].map((y) => ({ box: at(y), kind: 'stroke' as const, paper: false })));
    const [grid] = acrossGrids(rules, characters);
    expect(grid?.rows).toStrictEqual([100, 120, 140]);
    expect(grid?.columns).toHaveLength(3);
  });

  it('CONTROL: two rules are not a table, rules of the paper’s colour are no rules, and one column is no table', () => {
    expect(acrossGrids(rulesAcross([100, 140].map((y) => ({ box: at(y), kind: 'stroke' as const, paper: false }))), characters)).toHaveLength(0);
    expect(rulesAcross([100, 120, 140].map((y) => ({ box: at(y), kind: 'stroke' as const, paper: true })))).toHaveLength(0);
    const oneColumn = characters.filter((box) => box.x0 < 100);
    const rules = rulesAcross([100, 120, 140].map((y) => ({ box: at(y), kind: 'stroke' as const, paper: false })));
    expect(acrossGrids(rules, oneColumn)).toHaveLength(0);
  });

  it('CONTROL: a run with words just past its end is one column of a wider table, not a table of its own', () => {
    // A table whose every cell is shaded on its own: the first column's shading edges line up as a run, and the second
    // column's words begin a cell's padding past its right end.
    const rules = rulesAcross([100, 120, 140].map((y) => ({ box: { x0: 66, y0: y - 0.25, x1: 330, y1: y + 0.25 }, kind: 'fill' as const, paper: false })));
    const neighbour = [{ x0: 334, y0: 105, x1: 346, y1: 115 }];
    expect(acrossGrids(rules, characters)).toHaveLength(1);
    expect(acrossGrids(rules, [...characters, ...neighbour])).toHaveLength(0);
  });

  it('a shaded band’s two edges are rules, and a stroked box taller than a rule is not', () => {
    expect(rulesAcross([{ box: { x0: 66, y0: 100, x1: 500, y1: 120 }, kind: 'fill', paper: false }]).map((rule) => rule.at)).toStrictEqual([100, 120]);
    expect(rulesAcross([{ box: { x0: 66, y0: 100, x1: 500, y1: 120 }, kind: 'stroke', paper: false }])).toHaveLength(0);
  });
});
