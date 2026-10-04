import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import type { CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applySetPageBackground } from './pageBackground.js';
import { applyBatesNumberPages, applyHeaderFooterPages } from './pageStamp.js';
import { applyGenerateToc } from './pageToc.js';
import { applyWatermarkPages } from './pageWatermark.js';

/**
 * The pdf-lib drawing commands place on the page AS THE READER SEES IT (CR-COR-01).
 *
 * The fixture is the hard shape on both axes at once: a Letter page whose MediaBox starts at 36,36 rather than 0,0 and
 * which carries `/Rotate 90`, so it is shown 792 points across and 612 down. Every reading is MuPDF's structured text,
 * whose boxes are in the displayed page's own frame, top-left origin — so "near the top" and "reads across" are about
 * what a reader sees, never about user space. The upright page is the CONTROL that the readings mean what they say.
 */

const SHOWN = { width: 792, height: 612 } as const;
const MARGIN = 36;

async function turnedPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.setMediaBox(36, 36, 612, 792);
  page.setRotation(degrees(90));
  return document.save();
}

async function uprightPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** A page whose CropBox lies outside its MediaBox, so it displays no region. */
async function pageShowingNothing(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  page.setCropBox(1000, 1000, 10, 10);
  return document.save();
}

interface ShownLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Each line of page 0 as MuPDF reads it, boxed in the displayed page's frame. */
async function linesOn(bytes: Uint8Array): Promise<readonly ShownLine[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const parsed = JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
        blocks?: { lines?: { text?: string; bbox?: { x: number; y: number; w: number; h: number } }[] }[];
      };
      return (parsed.blocks ?? []).flatMap((block) =>
        (block.lines ?? []).flatMap((line) =>
          line.bbox === undefined ? [] : [{ text: line.text ?? '', ...line.bbox }],
        ),
      );
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

function lineReading(lines: readonly ShownLine[], text: string): ShownLine {
  const found = lines.find((line) => line.text === text);
  if (found === undefined) throw new Error(`no line reads "${text}"; the page shows ${JSON.stringify(lines.map((line) => line.text))}`);
  return found;
}

const STAMP: CommandOfKind<'headerFooterPages'> = {
  kind: 'headerFooterPages',
  pages: 'all',
  header: { left: '', centre: 'Annual report', right: '' },
  footer: { left: '', centre: 'Page {n} of {N}', right: '' },
  fontSize: 10,
  marginPoints: MARGIN,
};

describe('the pdf-lib drawing commands on a turned page whose box does not start at 0,0', () => {
  it('CONTROL: the reading itself — the fixture is shown 792 across and 612 down, and shows nothing yet', async () => {
    const session = await mupdfWriter.open(await turnedPage());
    try {
      const bounds = await withDocument(session, (document) => document.loadPage(0).getBounds());
      expect([bounds[2] - bounds[0], bounds[3] - bounds[1]]).toStrictEqual([SHOWN.width, SHOWN.height]);
    } finally {
      await mupdfWriter.close(session);
    }
    expect(await linesOn(await turnedPage())).toStrictEqual([]);
  });

  it('a HEADER reads across the top and a FOOTER across the bottom, placed exactly as on an upright page', async () => {
    const turned = await linesOn(await applyHeaderFooterPages(await turnedPage(), STAMP));
    // CONTROL: the same stamp on an upright Letter page at 0,0, where the old placement was already right. MuPDF's
    // line box is the glyphs' box, about a point from the advance-width centre the command aims at, so the turned
    // page is compared with this reading rather than with the arithmetic.
    const upright = await linesOn(await applyHeaderFooterPages(await uprightPage(), STAMP));
    for (const text of ['Annual report', 'Page 1 of 1']) {
      const line = lineReading(turned, text);
      const control = lineReading(upright, text);
      // ACROSS, not down the side: a line of words is wider than it is tall.
      expect(line.w).toBeGreaterThan(line.h * 2);
      expect([line.w, line.h]).toStrictEqual([control.w, control.h]);
      // THE SAME DISTANCE FROM THE CENTRE, and from the top or the bottom, as on the upright page.
      expect(line.x + line.w / 2 - SHOWN.width / 2).toBeCloseTo(control.x + control.w / 2 - 306, 3);
    }
    expect(lineReading(turned, 'Annual report').y).toBeCloseTo(lineReading(upright, 'Annual report').y, 3);
    expect(SHOWN.height - lineReading(turned, 'Page 1 of 1').y).toBeCloseTo(792 - lineReading(upright, 'Page 1 of 1').y, 3);
    // AND AT THE TOP: within a line's height of the margin from the top edge the reader sees.
    const header = lineReading(turned, 'Annual report');
    expect(Math.abs(header.y + header.h - MARGIN)).toBeLessThan(header.h);
  });

  it('a BATES number sits in the bottom right corner the reader sees', async () => {
    const bates: CommandOfKind<'batesNumberPages'> = {
      kind: 'batesNumberPages',
      pages: 'all',
      prefix: 'ABC-',
      suffix: '',
      start: 1,
      digits: 4,
      edge: 'footer',
      slot: 'right',
      fontSize: 9,
      marginPoints: MARGIN,
    };
    const number = lineReading(await linesOn(await applyBatesNumberPages(await turnedPage(), bates)), 'ABC-0001');
    expect(number.w).toBeGreaterThan(number.h * 2);
    expect(Math.abs(number.x + number.w - (SHOWN.width - MARGIN))).toBeLessThan(1.5);
    expect(number.y + number.h).toBeGreaterThan(SHOWN.height - MARGIN);
  });

  it('a WATERMARK with no slant reads across the centre of the page the reader sees', async () => {
    const watermark: CommandOfKind<'watermarkPages'> = {
      kind: 'watermarkPages',
      pages: 'all',
      text: 'DRAFT',
      opacity: 0.3,
      rotationDegrees: 0,
      fontSize: 36,
    };
    const draft = lineReading(await linesOn(await applyWatermarkPages(await turnedPage(), watermark)), 'DRAFT');
    expect(draft.w).toBeGreaterThan(draft.h);
    expect(Math.abs(draft.x + draft.w / 2 - SHOWN.width / 2)).toBeLessThan(1);
    // THE GLYPHS' BOX, which sits about the text's height around the centre the command aims at.
    expect(Math.abs(draft.y + draft.h / 2 - SHOWN.height / 2)).toBeLessThan(draft.h / 2);
  });

  it('a BACKGROUND fills the box the page shows, from its own origin', async () => {
    const filled = await applySetPageBackground(await turnedPage(), {
      kind: 'setPageBackground',
      pages: 'all',
      red: 1,
      green: 0,
      blue: 0,
    });
    const session = await mupdfWriter.open(filled);
    try {
      const first = await withDocument(session, (document) => {
        const contents = document.findPage(0).get('Contents');
        const stream = contents.isArray() ? contents.get(0) : contents;
        return stream.readStream().asString();
      });
      const rect = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/u.exec(first);
      expect(rect?.slice(1).map(Number)).toStrictEqual([36, 36, 612, 792]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a TABLE OF CONTENTS beside the turned page takes the size the page is SHOWN at', async () => {
    const built = await applyGenerateToc(
      await turnedPage(),
      { kind: 'generateToc', at: 0 },
      [{ title: 'Front matter', page: 0, depth: 0 }],
    );
    const document = await PDFDocument.load(built);
    const table = document.getPage(0);
    expect(table.getRotation().angle).toBe(0);
    expect(table.getSize()).toStrictEqual({ width: SHOWN.width, height: SHOWN.height });
  });

  it('a page that DISPLAYS NOTHING refuses a stamp in words, and gives a table of contents the default size', async () => {
    await expect(applyHeaderFooterPages(await pageShowingNothing(), STAMP)).rejects.toThrow(/page 0 displays no region/u);
    const built = await applyGenerateToc(
      await pageShowingNothing(),
      { kind: 'generateToc', at: 0 },
      [{ title: 'Front matter', page: 0, depth: 0 }],
    );
    expect((await PDFDocument.load(built)).getPage(0).getSize()).toStrictEqual({ width: 612, height: 792 });
  });
});
