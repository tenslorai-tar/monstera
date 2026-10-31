import { readFileSync, writeFileSync } from 'node:fs';

import { PDFDocument as PdfLibDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { MAX_TEXT_LAYER_LINE, MAX_TEXT_LAYER_LINES } from '@monstera/contract/host';
import { describe, expect, it } from 'vitest';

import { structuredTextLetters } from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { STRUCTURED_BUILDS, readPageTextJson, readPageTextWithLetters } from './pageText.js';
import { LETTERS_FILE_MAX_BYTES, LETTERS_LINE_HEADER_BYTES, type WalkedLine, pageLetters, readLetters, writeLetters } from './textLetters.js';
import { WORD_BOX_READ_OPTIONS, linesOf, parsePageText } from './textStructure.js';

const LINES = [
  'This Agreement shall commence on the Effective Date and continue for the term of',
  'twelve months, unless ended sooner under clause 9.',
  'Short line.',
  'Each party may end it on notice.',
];

/** Times, standard 14 and not embedded, 11 pt, at x 72: upright, on a page turned `rotation`, or set at `angle`. */
async function timesPage(rotation = 0, angle = 0, standard: StandardFonts = StandardFonts.TimesRoman): Promise<{ bytes: Uint8Array; widthOf: (text: string) => number }> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  page.setRotation(degrees(rotation));
  const font = await document.embedFont(standard);
  LINES.forEach((text, at) => {
    page.drawText(text, { x: 72, y: 700 - at * (angle === 0 ? 14 : 74), size: 11, font, rotate: degrees(angle) });
  });
  return { bytes: await document.save(), widthOf: (text) => font.widthOfTextAtSize(text, 11) };
}

/** A heading over two columns of short lines: segmentation nests structure blocks inside one another on it. */
async function columnsPage(): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('A heading across the page', { x: 72, y: 740, size: 18, font });
  for (let row = 0; row < 12; row += 1) {
    page.drawText(`Left column line ${String(row + 1)} of the first part`, { x: 72, y: 690 - row * 14, size: 10, font });
    page.drawText(`Right column line ${String(row + 1)} of the second`, { x: 330, y: 690 - row * 14, size: 10, font });
  }
  return document.save();
}

/** One line of 1,100 letters at 4 pt, past the text layer's `MAX_TEXT_LAYER_LINE`. */
async function longLinePage(): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([5000, 200]);
  const font = await document.embedFont(StandardFonts.Courier);
  page.drawText('abcdefghij'.repeat(110), { x: 10, y: 100, size: 4, font });
  return document.save();
}

/** `ABA` in Helvetica whose `/ToUnicode` maps B to U+1F600, written by hand so the map is the one thing it tests. */
function emojiPage(): Uint8Array {
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Monstera-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '2 beginbfchar <41> <0041> <42> <D83DDE00> endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const content = 'BT /F1 24 Tf 72 700 Td (ABA) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    `<< /Length ${String(cmap.length)} >>\nstream\n${cmap}\nendstream`,
  ];
  let text = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, at) => {
    offsets.push(text.length);
    text += `${String(at + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

interface PageRead {
  readonly today: string;
  readonly json: string;
  readonly letters: Uint8Array;
  readonly walked: number;
  readonly texts: readonly string[];
  readonly jsonLines: number;
  readonly buildsToday: number;
  readonly buildsNow: number;
}

/** Every page of `bytes`, read today's way and the text layer's new way, counting structured-text builds for each. */
async function readEvery(bytes: Uint8Array): Promise<PageRead[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    const count = await withDocument(session, (document) => document.countPages());
    const pages: PageRead[] = [];
    for (let page = 0; page < count; page += 1) {
      const before = STRUCTURED_BUILDS.count;
      const today = await readPageTextJson(session, page, 'substrate');
      const middle = STRUCTURED_BUILDS.count;
      const { json, letters, walked } = await readPageTextWithLetters(session, page);
      const lines = linesOf(parsePageText(json));
      pages.push({
        today,
        json,
        letters,
        walked,
        texts: lines.slice(0, MAX_TEXT_LAYER_LINES).map((line) => line.text.slice(0, MAX_TEXT_LAYER_LINE)),
        jsonLines: lines.length,
        buildsToday: middle - before,
        buildsNow: STRUCTURED_BUILDS.count - middle,
      });
    }
    return pages;
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Each letter's place along its line in points, from the first. */
function places(advances: readonly number[]): number[] {
  const at = [0];
  for (const advance of advances) at.push((at.at(-1) ?? 0) + advance / 100);
  return at;
}

const COMMITTED = ['chromium-type3.pdf', 'editor-fidelity.pdf'].map((name) => ({
  name,
  bytes: new Uint8Array(readFileSync(new URL(`../../testing/fixtures/text-edit/${name}`, import.meta.url))),
}));

describe('the shim writes each page’s letters from the JSON’s own structured text (ADR-0280)', () => {
  it('reads each page once, leaves its JSON exactly as today, and pairs its lines in the JSON’s order, per fixture', async () => {
    const fixtures = [
      ...COMMITTED,
      { name: 'times', bytes: (await timesPage()).bytes },
      ...(await Promise.all([90, 180, 270].map(async (rotation) => ({ name: `turned ${String(rotation)}`, bytes: (await timesPage(rotation)).bytes })))),
      { name: 'angled 30', bytes: (await timesPage(0, 30)).bytes },
      { name: 'angled 150', bytes: (await timesPage(0, 150)).bytes },
      { name: 'columns (nested structure)', bytes: await columnsPage() },
      { name: 'long line', bytes: await longLinePage() },
      { name: 'emoji', bytes: emojiPage() },
    ];
    const figures: Record<string, { lines: number; paired: number; fellBack: number; walked: number; json: number }> = {};
    for (const { name, bytes } of fixtures) {
      const tally = { lines: 0, paired: 0, fellBack: 0, walked: 0, json: 0 };
      for (const read of await readEvery(bytes)) {
        // ONE BUILD A READ, today and now.
        expect(read.buildsToday, name).toBe(1);
        expect(read.buildsNow, name).toBe(1);
        // THE SAME JSON, byte for byte: every line's text, order and box are today's.
        expect(read.json, name).toBe(read.today);
        const notes: string[] = [];
        const letters = pageLetters(read.letters, read.texts, { page: 0, walked: read.walked, json: read.jsonLines }, (entry) => notes.push(entry));
        tally.lines += read.texts.length;
        tally.paired += letters.filter((line) => line !== undefined).length;
        tally.fellBack += letters.filter((line) => line === undefined).length;
        tally.walked += read.walked;
        tally.json += read.jsonLines;
        expect(notes, name).toStrictEqual([]);
      }
      figures[name] = tally;
    }
    writeFileSync(process.env['LETTERS_FIGURES'] ?? '/dev/null', JSON.stringify(figures, null, 1));
    // EVERY LINE PAIRS ON EVERY FIXTURE: a fallback anywhere names its fixture here.
    expect(Object.entries(figures).filter(([, tally]) => tally.fellBack > 0).map(([name]) => name)).toStrictEqual([]);
    // THE NESTED FIXTURE IS NESTED: a structure block inside a structure block, so the order is tested where it can differ.
    const nested = (await readEvery(await columnsPage()))[0]?.json ?? '';
    expect(/"contents":\[[^\]]*"contents"/u.test(nested)).toBe(true);
  });

  // MEASURED, the engine against the font's own metrics, written out for the report: Times (whose substitute's widths
  // differ from the font's published metrics) and Courier (whose do not).
  it('measures how far MuPDF places non-embedded Times and Courier from the fonts’ own advances', async () => {
    const out: Record<string, number> = {};
    for (const [name, standard] of [
      ['Times', StandardFonts.TimesRoman],
      ['Courier', StandardFonts.Courier],
    ] as const) {
      const document = await PdfLibDocument.create();
      const page = document.addPage([612, 792]);
      const font = await document.embedFont(standard);
      LINES.forEach((text, at) => {
        page.drawText(text, { x: 72, y: 700 - at * 14, size: 11, font });
      });
      const [read] = await readEvery(await document.save());
      if (read === undefined) throw new Error('no page');
      const letters = pageLetters(read.letters, read.texts, { page: 0, walked: read.walked, json: read.jsonLines }, () => undefined);
      let worst = 0;
      read.texts.forEach((text, at) => {
        const got = places(letters[at]?.advances ?? []);
        for (let k = 0; k < text.length; k += 1) worst = Math.max(worst, Math.abs(font.widthOfTextAtSize(text.slice(0, k), 11) - (got[k] ?? NaN)));
      });
      out[name] = Number(worst.toFixed(3));
    }
    writeFileSync(process.env['LETTERS_DRIFT'] ?? '/dev/null', JSON.stringify(out));
    expect(out['Courier']).toBeLessThan(0.02);
  });

  // COURIER, whose substitute's widths are the font's own, so MuPDF's placement and the font's metrics are one answer
  // and the case measures the format and the walk alone. Times is measured above, where the two differ.
  it('places each letter where the font’s own advances put it, upright and at 30 degrees, to the hundredth of a point', async () => {
    for (const angle of [0, 30]) {
      const { bytes, widthOf } = await timesPage(0, angle, StandardFonts.Courier);
      const [read] = await readEvery(bytes);
      if (read === undefined) throw new Error('no page');
      const letters = pageLetters(read.letters, read.texts, { page: 0, walked: read.walked, json: read.jsonLines }, () => undefined);
      read.texts.forEach((text, at) => {
        const line = letters[at];
        if (line === undefined) throw new Error(`line ${String(at)} fell back`);
        const got = places(line.advances);
        // EACH LETTER'S START against Times' advances. The line's END is MuPDF's quad edge of its last glyph, which on
        // non-embedded Times runs past the advance (run 18 read 439.50 against 438.18), so it is the engine's answer
        // and not an advance; it is held to lie at or past the last advance and within two points of it.
        const offs = Array.from({ length: text.length }, (_, k) => Math.abs(widthOf(text.slice(0, k)) - (got[k] ?? NaN)));
        const worst = Math.max(...offs);
        const where = offs.findIndex((off) => off === worst);
        expect(worst, `${String(angle)} degrees, line ${String(at)}, letter ${String(where)} of ${JSON.stringify(text)}: ${JSON.stringify(line.advances.slice(Math.max(0, where - 3), where + 2))}`).toBeLessThan(0.02);
        const end = (got[text.length] ?? NaN) - widthOf(text);
        expect(end, `${String(angle)} degrees, line ${String(at)}, end`).toBeGreaterThan(-0.02);
        expect(end, `${String(angle)} degrees, line ${String(at)}, end`).toBeLessThan(2);
      });
    }
  });

  it('pairs a line holding a character past U+FFFF, its second unit advancing 0', async () => {
    const [read] = await readEvery(emojiPage());
    if (read === undefined) throw new Error('no page');
    expect(read.texts).toStrictEqual(['A\u{1F600}A']);
    const letters = pageLetters(read.letters, read.texts, { page: 0, walked: read.walked, json: read.jsonLines }, () => undefined);
    expect(letters[0]?.advances).toHaveLength(4);
    expect(letters[0]?.advances[2]).toBe(0);
  });

  // THE C IS THE TYPESCRIPT REFERENCE'S TWIN, compared on one page where the binding's own walk can see the letters (a
  // read with no segmentation, so no structure block): byte for byte, on a line past `MAX_TEXT_LAYER_LINE` and on Times.
  it('writes exactly what textLetters.ts’ writer writes from the same walk, on a line of 1,100 letters and on Times', async () => {
    for (const bytes of [await longLinePage(), (await timesPage()).bytes]) {
      const session = await mupdfWriter.open(bytes);
      try {
        await withDocument(session, (document) => {
          const structured = document.loadPage(0).toStructuredText(WORD_BOX_READ_OPTIONS);
          try {
            const walked: WalkedLine[] = [];
            let line: { direction: { x: number; y: number }; size: number; characters: { c: string; x: number; y: number }[]; end: { x: number; y: number } } | undefined;
            structured.walk({
              beginLine(_bbox, _wmode, direction) {
                line = { direction: { x: direction[0], y: direction[1] }, size: 0, characters: [], end: { x: 0, y: 0 } };
                walked.push(line);
              },
              onChar(c, origin, _font, size, quad) {
                if (line === undefined) return;
                if (line.characters.length === 0) line.size = size;
                line.characters.push({ c, x: origin[0], y: origin[1] });
                line.end = { x: (quad[2] + quad[6]) / 2, y: (quad[3] + quad[7]) / 2 };
              },
            });
            const out = new Uint8Array(LETTERS_FILE_MAX_BYTES);
            const shim = structuredTextLetters(structured, out, MAX_TEXT_LAYER_LINES, MAX_TEXT_LAYER_LINE);
            expect(shim.status).toBe('ok');
            expect(Array.from(out.subarray(0, shim.written))).toStrictEqual(Array.from(writeLetters(walked)));
            expect(shim.walked).toBe(walked.length);
          } finally {
            structured.destroy();
          }
        });
      } finally {
        await mupdfWriter.close(session);
      }
    }
  });

  // A BUFFER ONE BYTE TOO SMALL: the export says the page does not fit and writes nothing past the buffer. The buffer is
  // a view into a larger array whose bytes after the view are a sentinel, so a write past it would be seen.
  it('reports a page that does not fit a buffer one byte too small, and writes nothing past it', async () => {
    const session = await mupdfWriter.open((await timesPage()).bytes);
    try {
      await withDocument(session, (document) => {
        const structured = document.loadPage(0).toStructuredText(WORD_BOX_READ_OPTIONS);
        try {
          const room = new Uint8Array(LETTERS_FILE_MAX_BYTES);
          const fits = structuredTextLetters(structured, room, MAX_TEXT_LAYER_LINES, MAX_TEXT_LAYER_LINE);
          expect(fits.status).toBe('ok');
          const backing = new Uint8Array(fits.written + 64).fill(0xab);
          const short = backing.subarray(0, fits.written - 1);
          const answer = structuredTextLetters(structured, short, MAX_TEXT_LAYER_LINES, MAX_TEXT_LAYER_LINE);
          expect(answer.status).toBe('full');
          expect(answer.written).toBe(0);
          expect(Array.from(backing.subarray(fits.written - 1))).toStrictEqual(Array.from({ length: 65 }, () => 0xab));
        } finally {
          structured.destroy();
        }
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('the line-count comparison (ADR-0280’s fourth correction)', () => {
  const line = (text: string): WalkedLine => ({
    direction: { x: 1, y: 0 },
    size: 11,
    characters: Array.from(text, (c, at) => ({ c, x: 72 + at * 5, y: 700 })),
    end: { x: 72 + Array.from(text).length * 5, y: 700 },
  });
  const bytes = writeLetters([line('one'), line('two')]);

  it('uses the letters where the walk and the JSON count the same lines', () => {
    const notes: string[] = [];
    const letters = pageLetters(bytes, ['one', 'two'], { page: 2, walked: 2, json: 2 }, (entry) => notes.push(entry));
    expect(letters.map((each) => each?.advances)).toStrictEqual([
      [500, 500, 500],
      [500, 500, 500],
    ]);
    expect(notes).toStrictEqual([]);
  });

  it('places every line as today and logs an engine change where the walk gave one line fewer than the JSON', () => {
    const notes: string[] = [];
    const letters = pageLetters(bytes, ['one', 'two'], { page: 2, walked: 2, json: 3 }, (entry) => notes.push(entry));
    expect(letters).toStrictEqual([undefined, undefined]);
    expect(notes).toStrictEqual(["engine change: page 3's text has 3 lines and the letters' walk gave 2; the page's letters are placed as before"]);
    // CONTROL: without the comparison — the file read on its own — the same lines would have been used, so the fallback
    // above is the comparison's doing and nothing else's.
    const alone = readLetters(bytes, ['one', 'two']);
    if (!('lines' in alone)) throw new Error('refused');
    expect(alone.lines.every((each) => each !== undefined)).toBe(true);
  });
});

/**
 * The letters' format (ADR-0280 and its second correction): its writer, and `main`'s reading of it as from a hostile
 * host (invariant 25). The producer of walked lines is not settled (cloud run 30's report), so these cases build the
 * walked lines themselves, as a producer would hand them.
 */
describe('main reads the letters as from a hostile host (invariant 25)', () => {
  const walked = (text: string): WalkedLine => ({
    direction: { x: 1, y: 0 },
    size: 11,
    characters: Array.from(text, (c, at) => ({ c, x: 72 + at * 5, y: 700 })),
    end: { x: 72 + Array.from(text).length * 5, y: 700 },
  });

  it('refuses a file one byte past the bound, whole, before reading a line', () => {
    const past = new Uint8Array(LETTERS_FILE_MAX_BYTES + 1);
    expect(readLetters(past, ['a'])).toStrictEqual({ refused: 'past-bound' });
    // CONTROL: a file AT the bound is not refused for its size.
    expect(readLetters(new Uint8Array(LETTERS_FILE_MAX_BYTES), ['a'])).not.toStrictEqual({ refused: 'past-bound' });
  });

  it('refuses a file whose record runs past its end', () => {
    const bytes = writeLetters([walked('abc')]);
    expect(readLetters(bytes.subarray(0, bytes.length - 1), ['abc'])).toStrictEqual({ refused: 'malformed' });
    expect(readLetters(bytes.subarray(0, LETTERS_LINE_HEADER_BYTES - 1), ['abc'])).toStrictEqual({ refused: 'malformed' });
  });

  it('places a line as today where its count disagrees with its text, and pairs the lines either side', () => {
    const bytes = writeLetters([walked('one'), walked('four'), walked('six')]);
    const answer = readLetters(bytes, ['one', 'fourx', 'six']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]?.advances).toStrictEqual([500, 500, 500]);
    expect(answer.lines[1]).toBeUndefined();
    expect(answer.lines[2]?.advances).toStrictEqual([500, 500, 500]);
  });

  it('places a line as today where its characters disagree with its text, though its count agrees', () => {
    const answer = readLetters(writeLetters([walked('cat')]), ['cot']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]).toBeUndefined();
  });

  it('carries no advances for a line one of whose letters advances past what 16 bits hold, and main places it as today', () => {
    const far: WalkedLine = { ...walked('ab'), end: { x: 72 + 5 + 400, y: 700 } };
    const answer = readLetters(writeLetters([far]), ['ab']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]).toBeUndefined();
  });

  it('reads letters only for the lines the page kept, as a cut page keeps its first ones', () => {
    const answer = readLetters(writeLetters([walked('kept'), walked('cut')]), ['kept']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines).toHaveLength(1);
    expect(answer.lines[0]?.advances).toHaveLength(4);
  });

  it('keeps each letter within half a hundredth of a point of its place, however long the line', () => {
    const line: WalkedLine = {
      direction: { x: 1, y: 0 },
      size: 11,
      characters: Array.from({ length: 1000 }, (_, at) => ({ c: 'x', x: 72 + at * 5.0049, y: 700 })),
      end: { x: 72 + 1000 * 5.0049, y: 700 },
    };
    const answer = readLetters(writeLetters([line]), ['x'.repeat(1000)]);
    if (!('lines' in answer)) throw new Error('refused');
    const advances = answer.lines[0]?.advances ?? [];
    const last = advances.reduce((sum, advance) => sum + advance, 0) / 100;
    expect(Math.abs(last - 1000 * 5.0049)).toBeLessThanOrEqual(0.005);
  });

  // A LINE CLIPPED TO `MAX_TEXT_LAYER_LINE` LETTERS: its last kept letter advances to the next letter's origin, as every
  // other letter does, and not to the end of the whole line. 1,100 letters 5 pt apart: the 1,024th advances 5 pt.
  it('gives a clipped line’s last kept letter its advance to the next letter, not to the end of the line', () => {
    const long: WalkedLine = {
      direction: { x: 1, y: 0 },
      size: 11,
      characters: Array.from({ length: 1100 }, (_, at) => ({ c: 'x', x: 72 + at * 5, y: 700 })),
      end: { x: 72 + 1100 * 5, y: 700 },
    };
    const answer = readLetters(writeLetters([long]), ['x'.repeat(MAX_TEXT_LAYER_LINE)]);
    if (!('lines' in answer)) throw new Error('refused');
    const advances = answer.lines[0]?.advances;
    expect(advances).toHaveLength(MAX_TEXT_LAYER_LINE);
    expect(advances?.at(-1)).toBe(500);
  });

  // A CHARACTER PAST U+FFFF IS PAIRED, the binding's cut applied on both sides: the walk hands U+1F600 as its low 16 bits
  // (U+F600), and main cuts the JSON's code point the same way. CONTROL: a text whose character cuts to something else
  // does not pair.
  it('pairs a character past U+FFFF by the same cut on both sides, its second unit advancing 0', () => {
    const cut: WalkedLine = { ...walked('AA'), end: { x: 72 + 15, y: 700 } };
    const answer = readLetters(writeLetters([cut]), ['A\u{1F600}A']);
    if (!('lines' in answer)) throw new Error('refused');
    expect(answer.lines[0]?.advances).toStrictEqual([500, 500, 0, 500]);
    const control = readLetters(writeLetters([cut]), ['A\u{1F601}A']);
    if (!('lines' in control)) throw new Error('refused');
    expect(control.lines[0]).toBeUndefined();
  });
});
