import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from '@cantoo/pdf-lib';
import type { PageSet } from '@monstera/contract/host';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { extractPages } from './pageExtract.js';

/**
 * Extract to a new PDF, read back with a DIFFERENT library than the one that
 * wrote.
 *
 * ## The fixture carries all four catalog entries, and that is the point
 *
 * ADR-0006 measured a rebuild dropping `/AcroForm`, `/Outlines`, `/Names` and
 * `/OCProperties`. A fixture carrying one of them would let a claim about "the
 * catalog survives" rest on one axis measured and three assumed — which is the
 * shape this project's record names as the claim that was never true.
 *
 * ## Pages are distinguishable by width
 *
 * A fixture of identical pages makes *extracted the right pages*, *extracted
 * the wrong ones* and *extracted in the wrong order* one observation.
 */
const WIDTH_BASE = 100;

/** Four pages, a text field on page 1, and all four catalog entries. */
async function richDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 4; index += 1) document.addPage([WIDTH_BASE + index, 500]);

  const form = document.getForm();
  const field = form.createTextField('applicant.name');
  const second = document.getPages()[1];
  if (second === undefined) throw new Error('the fixture should have four pages');
  field.addToPage(second, { x: 10, y: 10, width: 60, height: 16, font });

  const context = document.context;
  const child = context.obj({ Title: PDFString.of('Chapter one') });
  const childRef = context.register(child);
  const outlines = context.obj({
    Type: PDFName.of('Outlines'),
    First: childRef,
    Last: childRef,
    Count: PDFNumber.of(1),
  });
  const outlinesRef = context.register(outlines);
  child.set(PDFName.of('Parent'), outlinesRef);
  document.catalog.set(PDFName.of('Outlines'), outlinesRef);

  const groups = PDFArray.withContext(context);
  groups.push(
    context.register(context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of('A layer') })),
  );
  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({ OCGs: groups, D: context.obj({ Order: groups }) }),
  );

  const third = document.getPages()[2];
  if (third === undefined) throw new Error('the fixture should have four pages');
  const names = PDFArray.withContext(context);
  names.push(PDFString.of('anchor'));
  names.push(context.obj([third.ref, PDFName.of('Fit')]));
  document.catalog.set(PDFName.of('Names'), context.obj({ Dests: context.obj({ Names: names }) }));

  return document.save({ useObjectStreams: false });
}

/** The same pages in a NESTED tree, so inheritance is a real question. */
async function nestedDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await richDocument());
  const root = document.catalog.Pages();
  const kids = root.Kids();

  const innerKids = PDFArray.withContext(document.context);
  innerKids.push(kids.get(0));
  innerKids.push(kids.get(1));
  const inner = document.context.obj({
    Type: PDFName.of('Pages'),
    Kids: innerKids,
    Count: PDFNumber.of(2),
    Parent: document.catalog.get(PDFName.of('Pages')),
    // WHAT THE LEAVES INHERIT, and what a graft before the push-down loses.
    Rotate: PDFNumber.of(90),
  });
  const innerRef = document.context.register(inner);

  const outer = PDFArray.withContext(document.context);
  outer.push(innerRef);
  outer.push(kids.get(2));
  outer.push(kids.get(3));
  root.set(PDFName.of('Kids'), outer);
  for (const index of [0, 1]) {
    const leaf = innerKids.lookup(index);
    if (leaf !== undefined && 'set' in leaf) {
      (leaf as { set: (key: PDFName, value: unknown) => void }).set(PDFName.of('Parent'), innerRef);
    }
  }

  return document.save({ useObjectStreams: false });
}

/** Runs an extract against a live session and gives back what it wrote. */
async function extracted(bytes: Uint8Array, pages: PageSet): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await extractPages(session, pages);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Everything a reader other than MuPDF can see about the result. */
async function readBack(bytes: Uint8Array): Promise<{
  readonly widths: number[];
  readonly rotations: number[];
  readonly fields: string[];
  /**
   * How many widgets each field has — **the half `fields` cannot see**.
   *
   * Found by mutation, 2026-09-04: swapping the implementation to MuPDF's own
   * `graftPage`, which drops `/Annots`, left every case green including the one
   * named *carries the form*. pdf-lib reads a field's NAME out of `/AcroForm`'s
   * field tree, which `carryCatalog` grafts whole — so a document whose field
   * has no widget anywhere, and which no user can see or fill in, satisfies a
   * name assertion perfectly.
   */
  readonly widgets: number[];
}> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const fields = document.getForm().getFields();
  return {
    widths: document.getPages().map((page) => Math.round(page.getWidth())),
    rotations: document.getPages().map((page) => page.getRotation().angle),
    fields: fields.map((field) => field.getName()),
    widgets: fields.map((field) => field.acroField.getWidgets().length),
  };
}

/**
 * The catalog entries present, and how many annotations sit on each PAGE.
 *
 * **The page count is the half that took two mutations to reach.** A field's
 * name comes from `/AcroForm`'s field tree, and so does its widget list — both
 * of which `carryCatalog` grafts whole. So a document whose widget is in the
 * field tree and on **no page** satisfies *the field is named* and *the field
 * has a widget*, and is still one nobody can see or fill in. Only `/Annots` on
 * the page separates it.
 */
async function structureOf(bytes: Uint8Array): Promise<{
  readonly catalog: string[];
  readonly annots: number[];
}> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const root = document.getTrailer().get('Root');
      const annots: number[] = [];
      for (let page = 0; page < document.countPages(); page += 1) {
        const list = document.findPage(page).get('Annots');
        annots.push(list.isNull() ? 0 : list.length);
      }
      return {
        catalog: ['AcroForm', 'Outlines', 'Names', 'OCProperties'].filter(
          (key) => !root.get(key).isNull(),
        ),
        annots,
      };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('extractPages', () => {
  it('WRITES THE NAMED PAGES, in the order they were named', async () => {
    const written = await extracted(await richDocument(), [2, 0]);

    // `[102, 100]` and not `[100, 102]`: the order is the caller's, and an
    // implementation that sorted would be a different operation wearing the
    // same name. A sorted fixture makes the two identical.
    expect((await readBack(written)).widths).toStrictEqual([102, 100]);
  });

  it('CARRIES THE FOUR CATALOG ENTRIES, which the page tree does not', async () => {
    // ADR-0006's failure class, measured on the new operation. The middle route
    // this module rejects produces a document whose widget renders and whose
    // field tree is orphaned — the same widths, the same page count, and a form
    // that has stopped being one.
    const written = await extracted(await richDocument(), [1, 2]);

    const structure = await structureOf(written);
    expect(structure.catalog).toStrictEqual(['AcroForm', 'Outlines', 'Names', 'OCProperties']);
    // THE WIDGET IS ON THE PAGE, which is the assertion two weaker ones do not
    // make. The rejected `graftPage` route drops the page's `/Annots` and the
    // grafted field tree still carries the widget object — so pdf-lib names the
    // field AND counts its widget in a document where nobody can see or fill
    // it. Both of those assertions were written first and both stayed green
    // under the mutation; this is the one that reddens.
    //
    // Page 0 is the source's page 1, which is where the field was placed.
    expect(structure.annots).toStrictEqual([1, 0]);

    // AND A DIFFERENT LIBRARY AGREES. `structureOf` asks MuPDF about MuPDF's
    // own output, which says the engine is self-consistent and nothing more.
    const reopened = await readBack(written);
    expect(reopened.fields).toStrictEqual(['applicant.name']);
    expect(reopened.widgets).toStrictEqual([1]);
  });

  it('CARRIES THE INHERITED ROTATION, which a graft before the push-down does not', async () => {
    // The nested hazard, and the one that renders. Pages 0 and 1 inherit
    // `/Rotate 90`; grafted before the push-down they carry no rotation of
    // their own and resolve against the NEW document's root, which has none —
    // an upright page where a landscape one was, with the widths correct.
    const source = await nestedDocument();
    expect((await readBack(source)).rotations).toStrictEqual([90, 90, 0, 0]);

    const written = await extracted(source, [1, 3]);

    expect((await readBack(written)).widths).toStrictEqual([101, 103]);
    expect((await readBack(written)).rotations).toStrictEqual([90, 0]);
  });

  it('WRITES THE PAGES IT NAMES and not the rest of the source', async () => {
    // A graft that reaches a leaf's `/Parent` copies every page through `/Kids`, once per page grafted
    // (`pageGraft.ts`): measured 2026-10-02, a two-page extract of 160 pages wrote 966 objects — the whole source,
    // readable by anything that walks the file — and an extract of 4,100 pages was refused by MuPDF outright. Two
    // source sizes separate *these pages* from *this document*; the pages carry content, so a copy of them costs.
    async function objectsIn(pages: number): Promise<number> {
      const document = await PDFDocument.create();
      for (let index = 0; index < pages; index += 1) {
        document.addPage([WIDTH_BASE + index, 500]).drawRectangle({ x: 1, y: 1, width: 5, height: 5 });
      }
      const written = await extracted(await document.save({ useObjectStreams: false }), [0, 1]);
      const session = await mupdfWriter.open(written);
      try {
        return await withDocument(session, (out) => out.countObjects());
      } finally {
        await mupdfWriter.close(session);
      }
    }

    const small = await objectsIn(4);
    expect(await objectsIn(40)).toBe(small);
  });

  it('A PAGE NAMED TWICE IS TWO PAGES, not one object listed twice', async () => {
    // One graft map answers a second graft of the same leaf with the first copy; `/Kids` naming one object twice is
    // not a page tree, and a rotation of either page would rotate both.
    const session = await mupdfWriter.open(await extracted(await richDocument(), [2, 2]));
    try {
      const numbers = await withDocument(session, (out) => [0, 1].map((page) => out.findPage(page).asIndirect()));
      expect(numbers[0]).not.toBe(numbers[1]);
      expect((await readBack(await mupdfWriter.serialise(session))).widths).toStrictEqual([102, 102]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES an empty extract, which would write a document nothing can open', async () => {
    const session = await mupdfWriter.open(await richDocument());
    try {
      await expect(extractPages(session, [])).rejects.toThrow(/no pages/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('REFUSES a page the document does not have', async () => {
    const session = await mupdfWriter.open(await richDocument());
    try {
      await expect(extractPages(session, [0, 9])).rejects.toThrow(/Page 9 is outside this document, which has 4 page/u);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  describe('the new file carries only what the pages it takes hold (item 12b)', () => {
    const KEPT = 'answer-on-the-taken-page';
    const LEFT = 'answer-on-a-page-left-behind';

    /** Four pages, each with its own text; a filled field on page 1 and another on page 4. */
    async function filledForm(): Promise<Uint8Array> {
      const document = await PDFDocument.create();
      const font = await document.embedFont(StandardFonts.Helvetica);
      const pages = [0, 1, 2, 3].map((index) => {
        const page = document.addPage([WIDTH_BASE + index, 500]);
        page.drawText(`body of page ${String(index + 1)}`, { x: 10, y: 400, size: 12, font });
        return page;
      });
      const form = document.getForm();
      for (const [name, page, answer] of [
        ['kept.field', pages[0], KEPT],
        ['left.field', pages[3], LEFT],
      ] as const) {
        if (page === undefined) throw new Error('the fixture should have four pages');
        const field = form.createTextField(name);
        field.addToPage(page, { x: 10, y: 10, width: 120, height: 16, font });
        field.setText(answer);
      }
      return document.save({ useObjectStreams: false });
    }

    /** Every indirect object of the file, as pdf-lib walks them: which answers and how many page objects. */
    async function everyObject(bytes: Uint8Array): Promise<{ readonly answers: string[]; readonly pages: number }> {
      const document = await PDFDocument.load(bytes, { updateMetadata: false });
      const answers: string[] = [];
      let pages = 0;
      for (const [, object] of document.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFDict)) continue;
        if (object.get(PDFName.of('Type')) === PDFName.of('Page')) pages += 1;
        const value = object.get(PDFName.of('V'));
        if (value instanceof PDFString || value instanceof PDFHexString) answers.push(value.decodeText());
      }
      return { answers: answers.sort(), pages };
    }

    it('CONTROL: the source holds both answers, so an absent one means something', async () => {
      expect(await everyObject(await filledForm())).toStrictEqual({ answers: [LEFT, KEPT].sort(), pages: 4 });
    });

    it('EXTRACTING page 1 carries its field and answer, and no field, answer or page it did not take', async () => {
      const written = await extracted(await filledForm(), [0]);
      expect(await everyObject(written)).toStrictEqual({ answers: [KEPT], pages: 1 });
      const reopened = await readBack(written);
      expect(reopened.fields).toStrictEqual(['kept.field']);
      expect(reopened.widgets).toStrictEqual([1]);
    });

    it('EXTRACTING a page with no field carries no form at all', async () => {
      const written = await extracted(await filledForm(), [1, 2]);
      expect(await everyObject(written)).toStrictEqual({ answers: [], pages: 2 });
      expect((await readBack(written)).fields).toStrictEqual([]);
      expect((await structureOf(written)).catalog).not.toContain('AcroForm');
    });

    it('A DESTINATION naming a page left behind does not bring that page into the file', async () => {
      // `richDocument`'s named destination points at page 3. The outline and the names tree are grafted whole, and a
      // graft follows a reference wherever it goes, so a page the extract did not take arrives as an object of its own.
      const written = await extracted(await richDocument(), [0]);
      expect((await everyObject(written)).pages).toBe(1);
    });
  });

  it('CONTROL: the SOURCE still has all four pages afterwards', async () => {
    // An extract is a read of the open document, and the one write it makes —
    // pushing inheritables onto the source's own leaves — must not change what
    // the document resolves to. Without this the module could be implemented as
    // *delete the complement and serialise*, which produces the same output
    // file and destroys the document the user is looking at.
    const session = await mupdfWriter.open(await nestedDocument());
    try {
      await extractPages(session, [1, 3]);

      const after = await readBack(await mupdfWriter.serialise(session));
      expect(after.widths).toStrictEqual([100, 101, 102, 103]);
      expect(after.rotations).toStrictEqual([90, 90, 0, 0]);
      expect(after.fields).toStrictEqual(['applicant.name']);
      // THE TREE IS PUT BACK: the graft runs with every leaf's `/Parent` removed (`pageGraft.ts`).
      const parented = await withDocument(session, (document) =>
        [0, 1, 2, 3].map((page) => !document.findPage(page).get('Parent').isNull()),
      );
      expect(parented).toStrictEqual([true, true, true, true]);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
