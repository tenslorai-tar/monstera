import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter } from './mupdfWriter.js';
import { readPageLinks } from './pageLinks.js';

/**
 * The link reader, against documents whose links this file put there.
 *
 * ## The fixture is built with pdf-lib, not read from a corpus
 *
 * Which links a page carries and where they point is then a fact about the
 * generator rather than an opinion of the thing under test — the same property
 * `textStructure.mjs`' fixtures have and for the same reason. A found document
 * would make a wrong answer indistinguishable from a document nobody read.
 *
 * The annotations are written as raw PDF objects because pdf-lib has no link
 * helper. That is the format's own spelling: a `/Link` annotation with `/Dest`
 * for an internal destination and an `/A << /S /URI >>` action for an external
 * one, which is exactly the split MuPDF reports through `isExternal()`.
 */
async function documentWithLinks(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const first = document.addPage([200, 200]);
  const second = document.addPage([200, 200]);
  document.addPage([200, 200]);

  // AN INTERNAL LINK TO THE THIRD PAGE, not the second: a destination one page
  // along would be satisfied by an off-by-one, and the point of a resolved page
  // index is that it is the page the document names.
  const third = document.getPage(2);
  const internal = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: PDFArray.withContext(document.context),
    Dest: PDFArray.withContext(document.context),
  });
  const rect = internal.get(PDFName.of('Rect'));
  if (rect instanceof PDFArray) {
    for (const value of [10, 20, 90, 40]) rect.push(PDFNumber.of(value));
  }
  const dest = internal.get(PDFName.of('Dest'));
  if (dest instanceof PDFArray) {
    dest.push(third.ref);
    dest.push(PDFName.of('Fit'));
  }

  const external = document.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: PDFArray.withContext(document.context),
    A: document.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of('https://example.org/thing'),
    }),
  });
  const outerRect = external.get(PDFName.of('Rect'));
  if (outerRect instanceof PDFArray) {
    for (const value of [10, 60, 90, 80]) outerRect.push(PDFNumber.of(value));
  }

  const annots = PDFArray.withContext(document.context);
  annots.push(document.context.register(internal));
  annots.push(document.context.register(external));
  first.node.set(PDFName.of('Annots'), annots);

  // THE SECOND PAGE CARRIES NONE, which is what makes the per-page case below a
  // statement about the page rather than about the document.
  void second;

  return document.save({ useObjectStreams: false });
}

describe('readPageLinks', () => {
  it('reads both kinds, and RESOLVES an internal destination to its page', async () => {
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      const links = await readPageLinks(session, 0);

      expect(links).toHaveLength(2);
      // PAGE 2 ZERO-BASED, which is the third page — the one the destination
      // names. A reader that returned the annotation's own page, or one along,
      // fails here.
      expect(links[0]).toStrictEqual({
        kind: 'internal',
        page: 2,
        bounds: { x0: 10, y0: 160, x1: 90, y1: 180 },
      });
      expect(links[1]).toMatchObject({
        kind: 'external',
        uri: 'https://example.org/thing',
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('answers per PAGE, so a page with no links reports none', async () => {
    // The control for the case above: without it, a reader that returned every
    // link in the document would pass — and that is the answer invariant 11
    // forbids as well as the wrong one.
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      expect(await readPageLinks(session, 1)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES a page outside the document rather than answering empty', async () => {
    // Empty is what a caller reads as "no links here", so an out-of-range page
    // must not produce it — the same rule `readPageText` states, and the same
    // reason: the two are indistinguishable at the call site.
    const session = await mupdfWriter.open(await documentWithLinks());
    try {
      await expect(readPageLinks(session, 3)).rejects.toBeInstanceOf(RangeError);
      await expect(readPageLinks(session, -1)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
