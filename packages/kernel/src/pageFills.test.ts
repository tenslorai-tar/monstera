import { PDFDocument, cmyk, grayscale, rgb } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { readPageFills } from './pageFills.js';

/**
 * The drawing half of a cell's background: every fill on a page, with its colour as RGB, in
 * display space. A page written by a SECOND library, so the reader is asked about a file it did
 * not make.
 */
async function page(draw: (page: ReturnType<PDFDocument['addPage']>) => void): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  draw(document.addPage([612, 792]));
  return document.save();
}

async function fillsOf(bytes: Uint8Array): Promise<Awaited<ReturnType<typeof readPageFills>>> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await readPageFills(session, 0);
  } finally {
    await mupdfWriter.close(session);
  }
}

const rounded = (values: readonly number[]): number[] => values.map((value) => Math.round(value * 100) / 100);

describe('a page’s filled shapes, read through the engine', () => {
  it('answers each fill’s box in DISPLAY space and its colour as RGB, whatever space it was drawn in', async () => {
    const fills = await fillsOf(
      await page((drawn) => {
        drawn.drawRectangle({ x: 72, y: 676, width: 120, height: 24, color: rgb(1, 1, 0.4) });
        drawn.drawRectangle({ x: 200, y: 676, width: 120, height: 24, color: grayscale(0.5) });
        drawn.drawRectangle({ x: 330, y: 676, width: 120, height: 24, color: cmyk(0, 0, 1, 0) });
      }),
    );

    expect(fills).toHaveLength(3);
    // PDF y 676..700 on a 792-point page is display y 92..116: the frame the text read uses.
    expect(rounded([fills[0]?.box.x0 ?? -1, fills[0]?.box.y0 ?? -1, fills[0]?.box.x1 ?? -1, fills[0]?.box.y1 ?? -1])).toStrictEqual([72, 92, 192, 116]);
    expect(rounded(fills[0]?.rgb ?? [])).toStrictEqual([1, 1, 0.4]);
    expect(rounded(fills[1]?.rgb ?? [])).toStrictEqual([0.5, 0.5, 0.5]);
    // CMYK yellow is RGB yellow.
    expect(rounded(fills[2]?.rgb ?? [])).toStrictEqual([1, 1, 0]);
  });

  it('composites a translucent fill over white, as a reader sees it', async () => {
    const fills = await fillsOf(
      await page((drawn) => {
        drawn.drawRectangle({ x: 72, y: 676, width: 120, height: 24, color: rgb(0, 0, 1), opacity: 0.5 });
      }),
    );
    expect(rounded(fills[0]?.rgb ?? [])).toStrictEqual([0.5, 0.5, 1]);
  });

  it('CONTROL: a page with text and strokes but no fills answers none', async () => {
    const fills = await fillsOf(
      await page((drawn) => {
        drawn.drawLine({ start: { x: 72, y: 700 }, end: { x: 400, y: 700 }, thickness: 1 });
      }),
    );
    expect(fills).toStrictEqual([]);
  });

  it('refuses a page outside the document rather than answering nothing', async () => {
    const session = await mupdfWriter.open(await page(() => undefined));
    try {
      await expect(readPageFills(session, 3)).rejects.toThrow(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
