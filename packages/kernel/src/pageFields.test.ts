import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { applyDeleteFormFields } from './formFields.js';
import { mupdfWriter } from './mupdfWriter.js';
import { applyReplacePage } from './pageMerge.js';
import { applyDeletePages, applyDuplicatePage, invertDuplicatePage } from './pageOrder.js';

/**
 * A page that leaves takes its form fields with it, and the save keeps nothing it no longer contains
 * ([ADR-0151](../../../docs/DECISIONS/0151-every-full-save-collects-and-a-deleted-page-takes-its-fields.md); the
 * owner's item 12a).
 *
 * ## The observable is EVERY OBJECT, read by a different library
 *
 * MuPDF writes the bytes and `@cantoo/pdf-lib` reads them, walking `enumerateIndirectObjects` rather than the catalog.
 * A walk from the catalog is the fixture the bug also passes: once a widget is unlinked the catalog no longer reaches
 * it, while a plain save still wrote it into the file. So each case counts the widget dictionaries, the objects whose
 * `/V` is the answer, and the page objects, wherever they sit.
 *
 * ## The answer is an unusual string on purpose
 *
 * So no other object can hold it by chance, and a count of one is the field and nothing else.
 */

const ANSWER = 'answer-only-the-field-holds';

/** What a file holds, counted over every indirect object. */
interface Held {
  readonly fields: readonly string[];
  readonly widgets: number;
  readonly answers: number;
  readonly pages: number;
}

async function held(bytes: Uint8Array): Promise<Held> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let widgets = 0;
  let answers = 0;
  let pages = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of('Subtype')) === PDFName.of('Widget')) widgets += 1;
    if (object.get(PDFName.of('Type')) === PDFName.of('Page')) pages += 1;
    const value = object.get(PDFName.of('V'));
    if ((value instanceof PDFString || value instanceof PDFHexString) && value.decodeText() === ANSWER) answers += 1;
  }
  return { fields: document.getForm().getFields().map((field) => field.getName()), widgets, answers, pages };
}

/**
 * Pages, each with a line of text, and one filled text field with a widget on each page `on` names.
 *
 * Saved without object streams so pdf-lib's own reading of the input is the same walk as of the output.
 */
async function form(pageCount: number, on: readonly number[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = Array.from({ length: pageCount }, (_unused, at) => {
    const page = document.addPage([400, 600]);
    page.drawText(`page ${String(at + 1)}`, { x: 50, y: 550, size: 12, font });
    return page;
  });
  const field = document.getForm().createTextField('applicant.name');
  for (const at of on) {
    const page = pages[at];
    if (page === undefined) throw new Error(`the fixture has no page ${String(at)}`);
    field.addToPage(page, { x: 50, y: 400, width: 200, height: 20, font });
  }
  field.setText(ANSWER);
  return await document.save({ useObjectStreams: false });
}

/** Opens `bytes`, runs `work` on the session, and answers what the saved bytes hold. */
async function afterSaving(
  bytes: Uint8Array,
  work: (session: Awaited<ReturnType<typeof mupdfWriter.open>>) => Promise<void>,
): Promise<Held> {
  const session = await mupdfWriter.open(bytes);
  try {
    await work(session);
    return await held(await mupdfWriter.serialise(session));
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a page that leaves takes its form fields with it (ADR-0151, item 12a)', () => {
  it('CONTROL: the fixture holds what the cases look for, so an empty count means something', async () => {
    expect(await held(await form(2, [1]))).toStrictEqual({ fields: ['applicant.name'], widgets: 1, answers: 1, pages: 2 });
  });

  it('DELETING the page that holds a filled field leaves no field, no widget, no answer and no page in the file', async () => {
    const after = await afterSaving(await form(2, [1]), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [1] }),
    );
    expect(after).toStrictEqual({ fields: [], widgets: 0, answers: 0, pages: 1 });
  });

  it('PRESERVES a field that still has a widget on a page that stays, with its value', async () => {
    // THE OTHER DIRECTION, and the one a helper that cleared every field on the document would fail: only an emptied
    // `/Kids` is pruned, so the widget on page 1 and the answer it shows survive the delete of page 2.
    const after = await afterSaving(await form(2, [0, 1]), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [1] }),
    );
    expect(after).toStrictEqual({ fields: ['applicant.name'], widgets: 1, answers: 1, pages: 1 });
  });

  it('CONTROL: deleting a page that holds NO field leaves the form as it was', async () => {
    const after = await afterSaving(await form(3, [2]), (session) =>
      applyDeletePages(session, { kind: 'deletePages', pages: [0] }),
    );
    expect(after).toStrictEqual({ fields: ['applicant.name'], widgets: 1, answers: 1, pages: 2 });
  });

  it('REPLACING the page that holds a field takes the field with the page it replaces', async () => {
    const source = await mupdfWriter.open(await form(1, []));
    try {
      const after = await afterSaving(await form(2, [1]), (session) =>
        applyReplacePage(
          session,
          { kind: 'replacePage', source: asDocId('s'), version: asDocVersion(1), at: 1 },
          source,
        ),
      );
      expect(after).toStrictEqual({ fields: [], widgets: 0, answers: 0, pages: 2 });
    } finally {
      await mupdfWriter.close(source);
    }
  });

  it('UNDOING a duplicate takes the copy’s widgets with it, and the original’s stay', async () => {
    // WHAT THIS SEPARATES IS THE COLLECTION, measured: a duplicate's widgets are not added to `/AcroForm`, so once the
    // copy leaves the page tree nothing reaches them and the collecting save drops them. With the plain save the
    // copy's page and widget were written out; with the widget removal disabled this case still passes.
    const after = await afterSaving(await form(1, [0]), async (session) => {
      await applyDuplicatePage(session, { kind: 'duplicatePage', pages: [0] });
      await invertDuplicatePage(session, { at: [1] });
    });
    expect(after).toStrictEqual({ fields: ['applicant.name'], widgets: 1, answers: 1, pages: 1 });
  });

  it('DELETING A FIELD leaves no copy of its answer in the file, which a plain save wrote as an orphan', async () => {
    // THE SIBLING the measurement found: `deleteFormFields` already pruned the tree, and the plain save still wrote
    // the unlinked widget with its `/V`. Every full save collects now, so this one does too.
    const after = await afterSaving(await form(2, [1]), (session) =>
      applyDeleteFormFields(session, { kind: 'deleteFormFields', page: 1, indices: [0], version: asDocVersion(1) }),
    );
    expect(after).toStrictEqual({ fields: [], widgets: 0, answers: 0, pages: 2 });
  });
});
