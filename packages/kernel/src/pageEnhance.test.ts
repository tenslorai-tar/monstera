import { PDFDocument } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyEnhancePages, captureEnhancePages, enhancedPages } from './pageEnhance.js';

/**
 * Levelling a scanned page's own image, in place.
 *
 * ## THE PREMISE THIS ROW WAITED ON IS WHAT THESE CASES MEASURE
 *
 * `docs/FEATURES.md`' enhance-scans row said the build had neither a decoder nor an
 * encoder for an embedded image. The first case here decodes one, changes it,
 * re-encodes it, and reads it back **from the serialised document** — which is the
 * only reading that settles it, because an in-session change that does not survive
 * a save is a change nobody gets.
 *
 * ## The fixture's image is made by MuPDF, and that is deliberate
 *
 * A scan-shaped page needs a real JPEG, and inventing one byte by byte would make
 * these cases about a fixture builder. `Pixmap.asJPEG` is the same encoder the
 * module under test re-encodes with, so the fixture is as real as the subject and
 * the case is about the round trip rather than about either end of it.
 */

const WIDTH = 300;
const HEIGHT = 400;

/**
 * A grey page with dark bands — ink on paper, with no contrast to speak of.
 *
 * @param spacing rows between bands, so two fixtures in one document cannot be
 *   deduplicated into a shared object.
 */
function flatJpeg(spacing = 40): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, WIDTH, HEIGHT], false);
  // 200 RATHER THAN 255: a scan's paper is never white, which is the whole of what
  // levelling fixes. A fixture on pure white has nothing to stretch and would pass
  // against a command that did nothing.
  pixmap.clear(200);
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  for (let y = 20; y < HEIGHT; y += spacing) {
    for (let x = 0; x < WIDTH; x += 1) pixels[y * stride + x] = 90;
  }
  const jpeg = new Uint8Array(pixmap.asJPEG(90, false));
  pixmap.destroy();
  return jpeg;
}

/**
 * A document of `pages` pages, each showing its **own** flat scan.
 *
 * One image per page rather than one shared between them, and that is what makes
 * the page-list control a control: pages sharing an XObject are levelled together
 * whatever the command names, so a fixture that shared one could not tell a command
 * that honours the list from one that ignores it. The band spacing differs per page
 * so nothing can deduplicate them back into one object.
 */
async function scanned(pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const [index] of Array.from({ length: pages }).entries()) {
    const page = document.addPage([612, 792]);
    const image = await document.embedJpg(flatJpeg(40 + index * 7));
    page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  }
  return document.save();
}

/** The page's image, decoded from the bytes a save produced. */
function imageOf(bytes: Uint8Array, page = 0): mupdf.Pixmap {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the fixture did not parse');
  const xobjects = document.loadPage(page).getObject().getInheritable('Resources').get('XObject');
  // COLLECTED RATHER THAN ASSIGNED INSIDE THE CALLBACK, which is `textLayerOf`'s
  // note in a different file: a variable written inside a callback is invisible to
  // TypeScript's control-flow analysis, so the guard below reads as dead code and
  // lint says so. Pushing into a const array states the same fact where both a
  // reader and the compiler can see it.
  const images: mupdf.PDFObject[] = [];
  xobjects.forEach((value) => {
    if (String(value.get('Subtype')) === '/Image') images.push(value);
  });
  const object = images[0];
  if (object === undefined) throw new Error('the page carries no image XObject');
  return new mupdf.Image(object.readRawStream()).toPixmap();
}

/** The darkest and lightest samples an image carries. */
function range(pixmap: mupdf.Pixmap): { low: number; high: number } {
  let low = 255;
  let high = 0;
  for (const value of pixmap.getPixels()) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return { low, high };
}

describe('enhancePages', () => {
  it('levels the page’s own image, and the change survives the save', async () => {
    const before = await scanned();
    const session = await mupdfWriter.open(before);
    try {
      const report = await enhancedPages(session, { kind: 'enhancePages', pages: [0] });
      expect(report).toStrictEqual([{ page: 0, enhanced: 1, skipped: 0 }]);

      // READ BACK FROM THE SERIALISED DOCUMENT, not from the session: a change that
      // does not survive the save is a change nobody gets, and that is exactly the
      // failure this row's premise would have produced.
      const after = await mupdfWriter.serialise(session);
      const levelled = range(imageOf(after));
      const original = range(imageOf(before));
      // THE PAPER GOES WHITE AND THE INK GOES BLACK. The fixture's paper is 200 and
      // its ink 90, so the stretch has somewhere to go — and both ends are asserted,
      // because a command that only brightened would pass on one of them.
      expect(original.high).toBeLessThan(230);
      expect(levelled.high).toBeGreaterThan(245);
      expect(levelled.low).toBeLessThan(original.low);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a page it was not given is untouched', async () => {
    const before = await scanned(2);
    const session = await mupdfWriter.open(before);
    try {
      await enhancedPages(session, { kind: 'enhancePages', pages: [0] });
      const after = await mupdfWriter.serialise(session);

      // THE SEPARATING CASE. A command that ignored its page list would level both
      // and pass every assertion in the case above, so page 1 is asserted to carry
      // the pixels it had — and the two pages hold their own images for exactly this
      // reason (see `scanned`).
      expect(range(imageOf(after, 1))).toStrictEqual(range(imageOf(before, 1)));
      expect(range(imageOf(after, 0)).high).toBeGreaterThan(245);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page the document does not have, and writes nothing first', async () => {
    const before = await scanned();
    const session = await mupdfWriter.open(before);
    try {
      await expect(
        enhancedPages(session, { kind: 'enhancePages', pages: [0, 7] }),
      ).rejects.toThrow(/Page 7 is outside this document, which has 1 page/u);

      // VALIDATED BEFORE THE FIRST WRITE. Without the pre-pass the command would
      // level page 0 and then refuse, which is the half-applied state every other
      // page command in this kernel refuses to produce.
      const after = await mupdfWriter.serialise(session);
      expect(range(imageOf(after))).toStrictEqual(range(imageOf(before)));
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('skips an image it cannot round-trip, and counts it', async () => {
    // A 1-BIT STENCIL: `/ImageMask true` has no greys to level, and levelling it
    // would mean inventing them. pdf-lib has no stencil API, so the mask is built
    // through MuPDF's own object API — which is also how a real document carries one.
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    const session = await mupdfWriter.open(await document.save());
    try {
      await withDocument(session, (pdf) => {
        const page = pdf.loadPage(0).getObject();
        const stencil = pdf.addStream(new Uint8Array([0b10101010]), {
          Type: 'XObject',
          Subtype: 'Image',
          Width: 8,
          Height: 1,
          ImageMask: true,
          BitsPerComponent: 1,
        });
        const resources = pdf.newDictionary();
        const xobjects = pdf.newDictionary();
        xobjects.put('Stencil', stencil);
        resources.put('XObject', xobjects);
        page.put('Resources', resources);
      });

      const report = await enhancedPages(session, { kind: 'enhancePages', pages: [0] });
      // COUNTED RATHER THAN THROWN ON. *This page's image is a kind I cannot read*
      // is an answer about the document, and the surface says it; a throw would make
      // it an incident with an id.
      expect(report).toStrictEqual([{ page: 0, enhanced: 0, skipped: 1 }]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reports nothing to do for a page carrying no image at all', async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    const session = await mupdfWriter.open(await document.save());
    try {
      expect(await enhancedPages(session, { kind: 'enhancePages', pages: [0] })).toStrictEqual([
        { page: 0, enhanced: 0, skipped: 0 },
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the apply is the same write, and answers nothing', async () => {
    const session = await mupdfWriter.open(await scanned());
    try {
      // THE EXPORTED APPLY IS THE SAME WRITE, which is what this case exists for:
      // `enhancedPages` is what every case above drives, and a second
      // implementation behind the name the routing table actually calls would be
      // green everywhere and wrong in the application (B3a).
      //
      // Its own return value is asserted by the TYPE — `Apply` for a live-session
      // writer answers `Promise<void>` — so what is asserted here is the effect.
      await applyEnhancePages(session, { kind: 'enhancePages', pages: [0] });
      const after = await mupdfWriter.serialise(session);
      expect(range(imageOf(after)).high).toBeGreaterThan(245);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('captures nothing, and says why undo will cost a checkpoint', async () => {
    const captured = await captureEnhancePages(await mupdfWriter.open(await scanned()), {
      kind: 'enhancePages',
      pages: [0],
    });

    expect(captured.captured).toBe(false);
    expect(!captured.captured && captured.reason).toMatch(/image streams themselves/u);
  });
});
