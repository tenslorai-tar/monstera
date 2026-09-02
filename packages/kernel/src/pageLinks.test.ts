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
async function buildDocumentWithLinks(): Promise<PDFDocument> {
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

  return document;
}

/** The flat document, saved. */
async function documentWithLinks(): Promise<Uint8Array> {
  return (await buildDocumentWithLinks()).save({ useObjectStreams: false });
}

/**
 * The same document with a NESTED page tree.
 *
 * ## The checklist's own hard shape, and it is not decoration here
 *
 * *"flat page tree → nested page tree (the reorder was wrong on nested)"* is
 * item 2's first example, and a link reader is exactly where it could bite
 * again: an internal destination names a page **object**, and turning that into
 * an index means walking the tree. A reader that counted `/Kids` at the root
 * would be right on every document pdf-lib produces and wrong on most real
 * ones, because pdf-lib builds flat trees and real producers do not.
 *
 * The tree here is `root → [ inner → [p0, p1], p2 ]`, so the destination on
 * page 0 points at a page that is a direct child of the root while the linking
 * page is two levels down. A reader confusing tree position with page index
 * cannot get 2 out of that by luck.
 *
 * ## Built from the SAME document, never copied into a new one
 *
 * The first version used `copyPages` and the nested case failed at page 0 —
 * which read exactly like a tree-walking defect. It was not. A probe on the
 * COPIED-BUT-FLAT document failed identically: `copyPages` does not carry the
 * `/Dest` reference, so the destination was already broken before anything was
 * nested. Two axes, one attributed conclusion, and the wrong one.
 *
 * That is AAAA-8's tell — *what else is different about the odd point?* — and
 * the probe is what answered it. The tree is now restructured in place, so the
 * only thing that differs from the flat fixture is the tree.
 */
async function nestedDocumentWithLinks(): Promise<Uint8Array> {
  const document = await buildDocumentWithLinks();
  const root = document.catalog.Pages();
  const kids = root.Kids();
  // THE COUNT, not three undefined-checks. `PDFArray.get` is typed as always
  // answering, so comparing each result to `undefined` is a condition the types
  // say can never hold — and the thing actually worth asserting is that the
  // fixture has the three pages this nesting assumes.
  if (kids.size() !== 3) {
    throw new Error(
      `the fixture should have three pages before nesting, not ${String(kids.size())}`,
    );
  }
  const first = kids.get(0);
  const second = kids.get(1);
  const third = kids.get(2);

  // An intermediate /Pages node holding the first two, with the third left as a
  // direct child — so the tree is genuinely uneven rather than merely deeper.
  const innerKids = PDFArray.withContext(document.context);
  innerKids.push(first);
  innerKids.push(second);
  const inner = document.context.obj({
    Type: PDFName.of('Pages'),
    Kids: innerKids,
    Count: PDFNumber.of(2),
    Parent: root.get(PDFName.of('Parent')) ?? document.catalog.get(PDFName.of('Pages')),
  });
  const innerRef = document.context.register(inner);

  const outerKids = PDFArray.withContext(document.context);
  outerKids.push(innerRef);
  outerKids.push(third);
  root.set(PDFName.of('Kids'), outerKids);

  // The two moved pages now hang off the intermediate node, not the root. A
  // /Parent left pointing at the root is a tree that disagrees with itself, and
  // MuPDF is entitled to read either direction.
  for (const ref of [first, second]) {
    const page = document.context.lookup(ref);
    if (page !== undefined && 'set' in page && typeof page.set === 'function') {
      (page as { set: (key: unknown, value: unknown) => void }).set(
        PDFName.of('Parent'),
        innerRef,
      );
    }
  }

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

  it('resolves the same destination on a NESTED page tree', async () => {
    // Item 2's first hard shape. pdf-lib builds flat trees and real producers
    // do not, so every case above exercises the layout least likely to break —
    // and a reader that confused tree position with page index would pass all
    // of them.
    const session = await mupdfWriter.open(await nestedDocumentWithLinks());
    try {
      const links = await readPageLinks(session, 0);
      expect(links[0]).toMatchObject({ kind: 'internal', page: 2 });
      // AND THE PER-PAGE ANSWER SURVIVES THE NESTING, which is the half a
      // destination-only case would miss: page 1 sits under the intermediate
      // node beside page 0, so a reader walking the tree wrongly is as likely
      // to hand back its neighbour's links as the right page's.
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
