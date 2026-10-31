import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { scaledField } from './engineJsonFixture.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { readPageText } from './pageText.js';
import { PAGE_TEXT_READS, PAGE_TEXT_SCALE, linesOf, pageTextJsonOf, parsePageTables, stextOptionsFor } from './textStructure.js';

/**
 * THE PAGE TEXT'S JSON AT MuPDF's OWN PRECISION SCALE ([ADR-0280](../../../docs/DECISIONS/0280-the-text-layer-places-each-letter-where-the-engine-reads-it.md),
 * its fifth correction). MuPDF writes every box, size and origin as `(int)(value * scale)`; at scale 1 that is a whole
 * point cut toward zero, at {@link PAGE_TEXT_SCALE} a hundredth.
 */

const FIXTURES = fileURLToPath(new URL('../../testing/fixtures/', import.meta.url));

/** Lines set at a fraction of a point on both axes, at a size that is not whole: what the old cut could not carry. */
const FRACTIONAL = { x: 72.37, y: 700.71, size: 10.5 } as const;

async function fractionalPage(rotation: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.setRotation(degrees(rotation));
  const font = await document.embedFont(StandardFonts.TimesRoman);
  ['A line that starts at a fraction of a point.', 'A second line, also between whole points.'].forEach((text, at) => {
    page.drawText(text, { x: FRACTIONAL.x, y: FRACTIONAL.y - at * 20.13, size: FRACTIONAL.size, font });
  });
  return document.save();
}

/** A ruled three-by-three table, so the table read's hunt gives a grid block whose `w` and `h` are COUNTS. */
async function ruledTable(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const left = 72.5;
  const top = 700.25;
  const cell = { w: 120.5, h: 24.25 };
  for (let row = 0; row <= 3; row += 1) {
    page.drawLine({ start: { x: left, y: top - row * cell.h }, end: { x: left + 3 * cell.w, y: top - row * cell.h }, thickness: 1, color: rgb(0, 0, 0) });
  }
  for (let column = 0; column <= 3; column += 1) {
    page.drawLine({ start: { x: left + column * cell.w, y: top }, end: { x: left + column * cell.w, y: top - 3 * cell.h }, thickness: 1, color: rgb(0, 0, 0) });
  }
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      page.drawText(`R${String(row + 1)}C${String(column + 1)}`, { x: left + column * cell.w + 6.3, y: top - (row + 1) * cell.h + 8.2, size: 10, font });
    }
  }
  return document.save();
}

/** A heading over two columns: segmentation nests structure blocks, so the walk below goes through `contents`. */
async function columns(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('A heading across the page', { x: 72.4, y: 740.6, size: 18.5, font });
  for (let row = 0; row < 10; row += 1) {
    page.drawText(`Left column line ${String(row + 1)}`, { x: 72.2, y: 690.3 - row * 14.1, size: 9.5, font });
    page.drawText(`Right column line ${String(row + 1)}`, { x: 330.7, y: 690.3 - row * 14.1, size: 9.5, font });
  }
  return document.save();
}

interface Tally {
  reads: number;
  scaled: number;
  other: number;
  grids: number;
  worst: number;
  disagreements: string[];
}

/**
 * The two JSONs walked side by side: every key, every string and every unscaled number identical, so the text, the
 * structure and the order are the same; every scaled number, divided by the scale, within the old whole-point cut of
 * today's value.
 */
function compare(
  today: unknown,
  scaled: unknown,
  at: string,
  /** The key this value sits under in its holder; an array's entries take the array's. */
  ownKey: string | null,
  /** The object holding this value, and the key IT sits under. */
  holder: { readonly node: Record<string, unknown>; readonly key: string | null } | null,
  tally: Tally,
): void {
  if (typeof today === 'number' && typeof scaled === 'number') {
    if (holder !== null && ownKey !== null && scaledField(holder.key, holder.node, ownKey)) {
      tally.scaled += 1;
      const off = scaled / PAGE_TEXT_SCALE - today;
      tally.worst = Math.max(tally.worst, Math.abs(off));
      if (!(Math.abs(off) < 1)) tally.disagreements.push(`${at}: today ${String(today)}, scaled ${String(scaled)}`);
    } else {
      tally.other += 1;
      if (today !== scaled) tally.disagreements.push(`${at}: an unscaled number moved, ${String(today)} to ${String(scaled)}`);
    }
    return;
  }
  if (Array.isArray(today) && Array.isArray(scaled)) {
    if (today.length !== scaled.length) tally.disagreements.push(`${at}: ${String(today.length)} entries against ${String(scaled.length)}`);
    today.forEach((entry, k) => {
      compare(entry, scaled[k], `${at}[${String(k)}]`, ownKey, holder, tally);
    });
    return;
  }
  if (typeof today === 'object' && today !== null && typeof scaled === 'object' && scaled !== null) {
    const a = today as Record<string, unknown>;
    const b = scaled as Record<string, unknown>;
    if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(b))) tally.disagreements.push(`${at}: keys differ`);
    if (a['type'] === 'grid') tally.grids += 1;
    // EACH MEMBER IS JUDGED BY THE KEY THIS OBJECT SITS UNDER (`bbox`, `font`) and by this object itself (a line).
    for (const key of Object.keys(a)) compare(a[key], b[key], `${at}.${key}`, key, { node: a, key: ownKey }, tally);
    return;
  }
  if (today !== scaled) tally.disagreements.push(`${at}: ${JSON.stringify(today)} against ${JSON.stringify(scaled)}`);
}

async function everyRead(bytes: Uint8Array, tally: Tally): Promise<void> {
  const session = await mupdfWriter.open(bytes);
  try {
    await withDocument(session, (document) => {
      for (let page = 0; page < document.countPages(); page += 1) {
        for (const read of PAGE_TEXT_READS) {
          const structured = document.loadPage(page).toStructuredText(stextOptionsFor(read));
          try {
            compare(JSON.parse(structured.asJSON(1)), JSON.parse(pageTextJsonOf(structured)), `${read} p${String(page)}`, null, null, tally);
            tally.reads += 1;
          } finally {
            structured.destroy();
          }
        }
      }
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('the page text read at MuPDF’s own precision scale (ADR-0280, fifth correction)', () => {
  it('changes only the numbers MuPDF scales, each within the old whole-point cut, on every fixture and every read', async () => {
    const fixtures: [string, Uint8Array][] = [
      ['chromium-type3.pdf', new Uint8Array(readFileSync(`${FIXTURES}text-edit/chromium-type3.pdf`))],
      ['editor-fidelity.pdf', new Uint8Array(readFileSync(`${FIXTURES}text-edit/editor-fidelity.pdf`))],
      ...[0, 90, 180, 270].map((rotation): [string, Uint8Array] => [`fractional, ${String(rotation)}`, new Uint8Array()]),
      ['ruled table', await ruledTable()],
      ['two columns', await columns()],
    ];
    for (const entry of fixtures) {
      if (entry[0].startsWith('fractional')) entry[1] = await fractionalPage(Number(entry[0].split(', ')[1]));
    }
    const tally: Tally = { reads: 0, scaled: 0, other: 0, grids: 0, worst: 0, disagreements: [] };
    for (const [, bytes] of fixtures) await everyRead(bytes, tally);
    expect(tally.disagreements).toStrictEqual([]);
    // THE WALK SAW WHAT IT CLAIMS TO JUDGE: scaled numbers, unscaled ones, and a grid whose counts must not be divided.
    expect(tally.scaled).toBeGreaterThan(500);
    expect(tally.other).toBeGreaterThan(100);
    expect(tally.grids).toBeGreaterThanOrEqual(1);
    // AND THE SCALE MOVED SOMETHING: on fixtures set between whole points, a value reads more than a hundredth away.
    expect(tally.worst).toBeGreaterThan(0.1);
  });

  it('keeps a grid’s columns and rows as counts, through the table reader', async () => {
    const session = await mupdfWriter.open(await ruledTable());
    try {
      const tables = await withDocument(session, (document) => {
        const structured = document.loadPage(0).toStructuredText(stextOptionsFor('table'));
        try {
          return parsePageTables(pageTextJsonOf(structured)).tables;
        } finally {
          structured.destroy();
        }
      });
      expect(tables.map((table) => [table.rows.length, table.columns])).toStrictEqual([[3, 3]]);
      // THE RULED EDGES, which only the grid's own counts decide: the column count is also the longest row, so a
      // divided `w` hides there, and shows here as no borders at all.
      expect(tables[0]?.borders).not.toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads a line that starts at a fraction of a point where it starts, and its size as set', async () => {
    for (const rotation of [0, 90, 180, 270]) {
      const session = await mupdfWriter.open(await fractionalPage(rotation));
      try {
        const [page] = (await readPageText(session, [0])).pages;
        const [line] = page === undefined ? [] : linesOf(page);
        if (line === undefined) throw new Error('the fixture draws two lines');
        // THE ORIGIN IN DISPLAY SPACE: (x, 792 - y) upright, turned with the page; within a hundredth either way.
        const expected = {
          0: { x: FRACTIONAL.x, y: 792 - FRACTIONAL.y },
          90: { x: FRACTIONAL.y, y: FRACTIONAL.x },
          180: { x: 612 - FRACTIONAL.x, y: FRACTIONAL.y },
          270: { x: 792 - FRACTIONAL.y, y: 612 - FRACTIONAL.x },
        }[rotation];
        expect(Math.abs(line.origin.x - (expected?.x ?? NaN)), `${String(rotation)} degrees, origin x ${String(line.origin.x)}`).toBeLessThan(0.02);
        expect(Math.abs(line.origin.y - (expected?.y ?? NaN)), `${String(rotation)} degrees, origin y ${String(line.origin.y)}`).toBeLessThan(0.02);
        expect(Math.abs(line.size - FRACTIONAL.size), `${String(rotation)} degrees, size ${String(line.size)}`).toBeLessThan(0.02);
      } finally {
        await mupdfWriter.close(session);
      }
    }
  });
});
