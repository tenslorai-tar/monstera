import { PDFDocument, rgb } from '@cantoo/pdf-lib';

/**
 * Pages of one size, each white with a black block over its middle third — the fixture `frameInspector.ts`
 * reads: a page with no dark pixel is one painted but not yet drawn. The block sits in the middle of either
 * orientation, so it survives a rotation.
 */
export async function blockedPages(size: readonly [number, number], count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const [width, height] = size;
  const side = Math.min(width, height) / 2;
  for (let at = 0; at < count; at += 1) {
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: (width - side) / 2, y: (height - side) / 2, width: side, height: side, color: rgb(0, 0, 0) });
  }
  return document.save();
}
