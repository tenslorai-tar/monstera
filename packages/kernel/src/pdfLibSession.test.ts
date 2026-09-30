import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import * as mupdf from './mupdfRaw.js';
import { applyWatermarkPages } from './pageWatermark.js';
import { appendRevision, openForWriting, openWhole } from './pdfLibSession.js';

/**
 * A pdf-lib command writes its result as an APPENDED revision (ADR-0127): the input, byte for byte, then one update.
 * The command suites assert what each command draws, and every one of them would pass against a whole rewrite as well —
 * so this is the case that separates the two routes, read back by MuPDF rather than by the library that wrote it.
 */

async function document(pages: number): Promise<Uint8Array> {
  const created = await PDFDocument.create();
  const font = await created.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < pages; at += 1) created.addPage([612, 792]).drawText(`Page ${String(at + 1)}`, { x: 72, y: 700, font });
  return created.save();
}

/** MuPDF's reading: versions, and whether it had to repair. */
function readBack(image: Uint8Array): { readonly versions: number; readonly repaired: boolean; readonly pages: number } {
  const opened = mupdf.PDFDocument.openDocument(image, 'application/pdf');
  if (!(opened instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    return { versions: opened.countVersions(), repaired: opened.wasRepaired(), pages: opened.countPages() };
  } finally {
    opened.destroy();
  }
}

const startsWith = (whole: Uint8Array, prefix: Uint8Array): boolean =>
  whole.byteLength > prefix.byteLength && prefix.every((byte, at) => whole[at] === byte);

describe('a pdf-lib command appends its revision (ADR-0127)', () => {
  it('the watermark’s result is its input, byte for byte, with ONE revision appended that MuPDF reads unrepaired', async () => {
    const input = await document(3);
    const stamped = await applyWatermarkPages(input, {
      kind: 'watermarkPages',
      pages: 'all',
      text: 'DRAFT',
      opacity: 0.3,
      rotationDegrees: 45,
      fontSize: 36,
    });

    expect(startsWith(stamped, input)).toBe(true);
    expect(readBack(stamped)).toStrictEqual({ versions: readBack(input).versions + 1, repaired: false, pages: 3 });
  });

  it('CONTROL: a whole save of the same edit is NOT its input with something appended, so the case can fail', async () => {
    const input = await document(3);
    const whole = await openWhole(input);
    whole.getPage(0).drawText('DRAFT', { x: 72, y: 72 });
    const rewritten = await whole.save();

    expect(startsWith(rewritten, input)).toBe(false);
  });

  it('appendRevision refuses a document loaded whole — the two helpers are one route', async () => {
    await expect(appendRevision(await openWhole(await document(1)))).rejects.toThrow(/forIncrementalUpdate/u);
    await expect(appendRevision(await openForWriting(await document(1)))).resolves.toBeInstanceOf(Uint8Array);
  });
});
