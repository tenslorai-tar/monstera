import { PDFDocument, PDFName, type PDFRef, StandardFonts } from '@cantoo/pdf-lib';

import { wholeFile } from './pdfLibSession.js';

/**
 * A page whose forms nest `levels` deep, form k showing one word and drawing form k+1 `draws` times, the page drawing
 * the first `placed` times: `placed × (draws^levels - 1) / (draws - 1)` placements of text, from a file of a few KB.
 * `draws` 2 and `levels` 16 is the 4.9 KB shape measured at 5.6 s and about 1 GB in the contained host (cloud run 27,
 * 2026-10-30); `draws` 1 is a plain chain.
 *
 * A module of its own, so the kernel's cases and the live walk in the development app build the same page. `x` is where
 * the page draws its first placement: the walk draws them mid-page, since the app's floating bar stands over the page's
 * left edge and took the walk's presses there (2026-11-02).
 */
export async function formGraph(levels: number, draws: number, placed: number, x = 20): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  let next: PDFRef | undefined;
  for (let level = levels; level >= 1; level -= 1) {
    const inner = next === undefined ? '' : Array.from({ length: draws }, (_, at) => ` q 1 0 0 1 ${String(at)} -1 cm /G Do Q`).join('');
    const resources = document.context.obj({ Font: { F1: font.ref }, ...(next === undefined ? {} : { XObject: { G: next } }) });
    next = document.context.register(
      document.context.stream(`BT /F1 3 Tf 0 0 Td (G${String(level)}) Tj ET${inner}`, { Type: 'XObject', Subtype: 'Form', BBox: [-50, -50, 50, 50], Resources: resources }),
    );
  }
  if (next === undefined) throw new Error('a graph needs a level');
  page.node.setXObject(PDFName.of('G'), next);
  const content = Array.from({ length: placed }, (_, at) => `q 1 0 0 1 ${String(x + at)} 400 cm /G Do Q`).join('\n');
  page.node.addContentStream(document.context.register(document.context.stream(content)));
  return wholeFile(document, { useObjectStreams: false });
}
