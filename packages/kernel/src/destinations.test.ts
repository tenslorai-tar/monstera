import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { readDestinations } from './destinations.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * The outline reader, against documents whose outline this file wrote.
 *
 * ## Built rather than found, for `pageLinks.test.ts`' reason
 *
 * Which headings exist, what they are called, how deep they sit and where they
 * point are then facts about the generator rather than opinions of the thing
 * under test. pdf-lib has no outline helper, so the `/Outlines` tree is written
 * as the format spells it — `/First`, `/Last`, `/Next`, `/Parent`, `/Count` —
 * which is also what makes the nesting real rather than implied.
 */
async function documentWithOutline(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < 4; page += 1) document.addPage([200, 200]);

  const context = document.context;
  const dest = (page: number): PDFArray => {
    const array = PDFArray.withContext(context);
    array.push(document.getPage(page).ref);
    array.push(PDFName.of('Fit'));
    return array;
  };

  // A CHILD, so the tree has a second level. Its /Parent is filled in below,
  // because the parent's reference does not exist until it is registered.
  const child = context.obj({
    Title: PDFString.of('A section'),
    Dest: dest(2),
  });
  const childRef = context.register(child);

  const first = context.obj({
    Title: PDFString.of('Chapter one'),
    Dest: dest(1),
    First: childRef,
    Last: childRef,
    Count: PDFNumber.of(1),
  });
  const firstRef = context.register(first);
  child.set(PDFName.of('Parent'), firstRef);

  // THE SECOND TOP-LEVEL ENTRY HAS NO /Dest, which is the pageless state a
  // panel must render. An outline of only resolvable entries would let a reader
  // that dropped the unresolvable ones pass.
  const second = context.obj({
    Title: PDFString.of('Somewhere unresolvable'),
    Prev: firstRef,
  });
  const secondRef = context.register(second);
  first.set(PDFName.of('Next'), secondRef);

  const outlines = context.obj({
    Type: PDFName.of('Outlines'),
    First: firstRef,
    Last: secondRef,
    Count: PDFNumber.of(2),
  });
  const outlinesRef = context.register(outlines);
  first.set(PDFName.of('Parent'), outlinesRef);
  second.set(PDFName.of('Parent'), outlinesRef);
  document.catalog.set(PDFName.of('Outlines'), outlinesRef);

  return document.save({ useObjectStreams: false });
}

describe('readDestinations', () => {
  it('flattens the tree, keeping the DEPTH and the authored order', async () => {
    const session = await mupdfWriter.open(await documentWithOutline());
    try {
      const found = await readDestinations(session);

      // DEPTH-FIRST: the child comes between its parent and the parent's
      // sibling. A breadth-first walk produces the same three entries in a
      // different order, and only asserting the order separates them.
      expect(found.map((entry) => entry.title)).toStrictEqual([
        'Chapter one',
        'A section',
        'Somewhere unresolvable',
      ]);
      expect(found.map((entry) => entry.depth)).toStrictEqual([0, 1, 0]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('resolves each destination to its own page, zero-based', async () => {
    // The pages are 1 and 2 rather than 0 and 1, so a reader that returned the
    // entry's index, or zero, or the page after, fails here.
    const session = await mupdfWriter.open(await documentWithOutline());
    try {
      const found = await readDestinations(session);
      expect(found[0]?.page).toBe(1);
      expect(found[1]?.page).toBe(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('KEEPS an entry that resolves nowhere, as a null page', async () => {
    // A gap in a table of contents is more confusing than an entry that cannot
    // be followed, and dropping it would silently renumber everything a reader
    // counts. `null` rather than a missing property, because the shape crosses
    // as JSON.
    const session = await mupdfWriter.open(await documentWithOutline());
    try {
      const found = await readDestinations(session);
      expect(found[2]).toStrictEqual({
        title: 'Somewhere unresolvable',
        page: null,
        depth: 0,
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a document with no outline answers with none, and does not throw', async () => {
    // The common case — most documents carry no outline — and the control for
    // every case above: without it, a reader that always answered `[]` would be
    // indistinguishable from one that works, since "no outline" is the
    // reassuring answer here.
    const bare = await PDFDocument.create();
    bare.addPage([200, 200]);
    const session = await mupdfWriter.open(await bare.save({ useObjectStreams: false }));
    try {
      expect(await readDestinations(session)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
