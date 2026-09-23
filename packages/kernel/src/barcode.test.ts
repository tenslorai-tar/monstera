import { PDFDocument } from '@cantoo/pdf-lib';
import type { AnnotationRect } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { barcodeRect } from './barcodePlacement.js';
import { readPageBarcodes } from './barcodeReader.js';
import { BARCODE_WRITE_FORMATS, type BarcodeWriteFormat, BarcodeTextRefusedError, writeBarcodePng } from './barcodeWriter.js';
import { ENGINE_BARCODE_TEXT_MAX } from './host/engineChannels.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyPlaceImage } from './pageAnnotations.js';

/**
 * Both halves of ADR-0076 against each other, through the command a person's placement runs: a
 * barcode is written, fitted into a dragged box, placed by `placeImage`, and read back from
 * MuPDF's raster of that page by the reader the engine host runs.
 */

async function blankPage(width = 612, height = 792): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

/**
 * A box far wider than tall, so a placement that filled it would squeeze every symbol — which
 * is the fixture the fit exists for, not one the unfitted placement also survives.
 */
const WIDE_BOX: AnnotationRect = { x0: 60, y0: 500, x1: 560, y1: 640 };

async function placedAndRead(format: BarcodeWriteFormat, text: string, bytes?: Uint8Array) {
  const session = await mupdfWriter.open(bytes ?? (await blankPage()));
  try {
    const image = await writeBarcodePng(text, format);
    await applyPlaceImage(session, {
      kind: 'placeImage',
      pages: [0],
      rect: barcodeRect(WIDE_BOX, image.width, image.height),
      bytes: image.png,
    });
    return await readPageBarcodes(session, 0);
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * One text per symbology the writer offers.
 *
 * ONE CASE PER FORMAT, since 2026-09-23. The six round trips — write, place, rasterise, read —
 * ran inside one case under the default five-second budget, and on this machine that case took
 * 5,055 ms in the full suite and 5,193 ms alone, the same day it had passed: six independent
 * measurements summed against one limit, so the budget measured their total rather than any of
 * them. Split, each case is one round trip and a failure names its format.
 */
const WRITTEN: readonly (readonly [BarcodeWriteFormat, string])[] = [
  ['QRCode', 'https://example.org/monstera?id=42'],
  ['DataMatrix', 'Invoice 2026-09-17 / 1,234.50 EUR'],
  ['Aztec', 'MONSTERA AZTEC 0042'],
  ['PDF417', 'Shipment 42 of 7,000'],
  ['Code128', 'MONSTERA-0042'],
  ['EAN13', '4006381333931'],
];

describe('barcodes — written, placed by the place-image command, and read back from the page', () => {
  it('owes a round trip for EVERY symbology the writer offers', () => {
    // Joined against the list rather than restating it, so a format added to the offer arrives
    // owing a case below.
    expect(WRITTEN.map(([format]) => format)).toStrictEqual([...BARCODE_WRITE_FORMATS]);
  });

  it.each(WRITTEN)('reads %s back with exactly the text that was written', async (format, text) => {
    expect(await placedAndRead(format, text)).toStrictEqual([{ format, text }]);
  });

  it('reads a poster-sized page by fitting the raster under the read’s pixel budget, where 200 dpi would be refused', async () => {
    // A0 is 2384 × 3370 points: at 200 dpi that is 6,622 × 9,362 pixels, twice the engine's bound
    // and four times the read's.
    const found = await placedAndRead('QRCode', 'poster', await blankPage(2384, 3370));
    expect(found).toStrictEqual([{ format: 'QRCode', text: 'poster' }]);
  });

  it('CONTROL: a page with no barcode reads none', async () => {
    const session = await mupdfWriter.open(await blankPage());
    try {
      expect(await readPageBarcodes(session, 0)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('fits a symbol into the dragged box in its own proportions, centred, whichever corner the drag began at', () => {
    const fitted = barcodeRect({ x0: 560, y0: 640, x1: 60, y1: 500 }, 100, 100);
    expect(fitted).toStrictEqual({ x0: 240, y0: 500, x1: 380, y1: 640 });
    // A linear symbol, wider than the box's proportions, is bounded by the width instead.
    expect(barcodeRect(WIDE_BOX, 1000, 100)).toStrictEqual({ x0: 60, y0: 545, x1: 560, y1: 595 });
  });

  it('REFUSES text a symbology cannot carry, in zxing-cpp’s words, rather than writing something else', async () => {
    await expect(writeBarcodePng('not digits', 'EAN13')).rejects.toBeInstanceOf(BarcodeTextRefusedError);
  });

  it('EAN-13 as the dialog tells a person: up to 13 digits, a shorter number padded with zeros', async () => {
    // Measured 2026-09-17, zint 2.16.0 inside zxing-wasm 3.1.4: twelve digits or fewer are padded
    // on the left and given a check digit; thirteen must carry the right one; fourteen are refused.
    expect(await placedAndRead('EAN13', '400638133393')).toStrictEqual([{ format: 'EAN13', text: '4006381333931' }]);
    expect(await placedAndRead('EAN13', '40063813339')).toStrictEqual([{ format: 'EAN13', text: '0400638133390' }]);
    await expect(writeBarcodePng('4006381333932', 'EAN13')).rejects.toBeInstanceOf(BarcodeTextRefusedError);
    await expect(writeBarcodePng('40063813339312', 'EAN13')).rejects.toBeInstanceOf(BarcodeTextRefusedError);
  });

  it('reports the PNG’s own size', async () => {
    const image = await writeBarcodePng('MONSTERA-0042', 'Code128');
    expect(image.width).toBeGreaterThan(image.height);
    const square = await writeBarcodePng('square', 'QRCode');
    expect(square.width).toBe(square.height);
  });

  it('the longest text any symbology carries is a QR code of 7,089 digits — the wire bound — and one more is refused', async () => {
    await expect(writeBarcodePng('7'.repeat(ENGINE_BARCODE_TEXT_MAX), 'QRCode')).resolves.toHaveProperty('png');
    await expect(writeBarcodePng('7'.repeat(ENGINE_BARCODE_TEXT_MAX + 1), 'QRCode')).rejects.toBeInstanceOf(
      BarcodeTextRefusedError,
    );
  });
});
