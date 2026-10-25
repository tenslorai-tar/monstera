import { PDFDocument as PdfLibDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind, type FormPath } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { formPagesDocument, placementAt, textPlacements, unwrappedForm, wrappedForm } from './formText.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PageRuns } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/**
 * Text inside a form XObject, edited in the form's own content (ADR-0269): a page whose only text is drawn by a form,
 * placed once or twice, built here so every byte of it is known.
 */
async function formPage(placements: readonly string[], formText = 'Hello form', box: readonly number[] = [0, 0, 612, 792]): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  // A FONT THAT STATES ITS WIDTHS AND ITS TEXT, as the operator writer needs to set new words in it (`pageFonts.ts`):
  // printable ASCII, each code its own character, each 500 thousandths wide.
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Ascii def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfrange <20> <7E> <0020> endbfrange',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const font = document.context.register(
    document.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: StandardFonts.Helvetica,
      FirstChar: 32,
      LastChar: 126,
      Widths: Array.from({ length: 95 }, () => 500),
      Encoding: 'WinAnsiEncoding',
      ToUnicode: document.context.register(document.context.stream(cmap)),
    }),
  );
  const form = document.context.register(
    document.context.stream(`BT /F1 12 Tf 72 700 Td (${formText}) Tj ET`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [...box],
      Resources: { Font: { F1: font } },
    }),
  );
  // A LOGO-LIKE FORM WITH NO TEXT beside it, which is no placement of text.
  const picture = document.context.register(
    document.context.stream('0 0 1 rg 0 0 50 50 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50] }),
  );
  page.node.setXObject(PDFName.of('Fm1'), form);
  page.node.setXObject(PDFName.of('Logo'), picture);
  const content = [...placements, 'q /Logo Do Q'].join('\n');
  page.node.addContentStream(document.context.register(document.context.stream(content)));
  return document.save({ useObjectStreams: false });
}

/** PDFium's reading of a placement's page, as it numbers it: one text object, one run holding it. */
function formRuns(wrapped: Uint8Array, text: string): PageRuns {
  const ops = showOperators(wrapped);
  const index = ops.find((op) => op.object !== null)?.object ?? 0;
  return {
    textObjects: Array.from({ length: textObjectCount(ops) }, (_, at) => at),
    runs: [{ index, members: [index], text, left: 0, right: 0, bottom: 0, top: 0 }],
  };
}

const edit = (form: FormPath, index: number, text: string): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[index]], soft: [false], text }]),
  fit: 'reflow',
  version: asDocVersion(1),
  form,
});

const FM1: FormPath = [{ name: 'Fm1', occurrence: 0 }];

/** The page's words as MuPDF reads them, every white space removed, and the page's own content. */
async function readBack(session: Awaited<ReturnType<typeof mupdfWriter.open>>): Promise<{ words: string; content: string }> {
  return withDocument(session, (document) => ({
    words: document.loadPage(0).toStructuredText().asText().replace(/\s/gu, ''),
    content: new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))),
  }));
}

describe('text inside a form (ADR-0269)', () => {
  it('pages each placement of a form that shows text, and no form that does not', async () => {
    const session = await mupdfWriter.open(await formPage(['q 1 0 0 1 10 20 cm /Fm1 Do Q']));
    try {
      const { paths, bytes } = await withDocument(session, (document) => formPagesDocument(document, 0));
      expect(paths).toStrictEqual([FM1]);
      expect(bytes.length).toBeGreaterThan(0);
      // THE WRAPPER PLACES IT where the page draws it: the Do's own `cm`, then the form's identity matrix.
      const placement = await withDocument(session, (document) => placementAt(document.findPage(0), FM1));
      expect(placement?.chain).toStrictEqual([
        [1, 0, 0, 1, 10, 20],
        [1, 0, 0, 1, 0, 0],
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
    // CONTROL: a page whose only form draws no text pages nothing.
    const plain = await mupdfWriter.open(await formPage([]));
    try {
      expect(await withDocument(plain, (document) => textPlacements(document.findPage(0)).length)).toBe(0);
    } finally {
      await mupdfWriter.close(plain);
    }
  });

  it('writes a word edited in a form into the form’s own stream, and leaves the page’s content as it was', async () => {
    const session = await mupdfWriter.open(await formPage(['q 1 0 0 1 10 20 cm /Fm1 Do Q']));
    try {
      const before = await readBack(session);
      const wrapped = await withDocument(session, (document) => {
        const placement = placementAt(document.findPage(0), FM1);
        if (placement === undefined) throw new Error('the fixture draws no form');
        return wrappedForm(placement).bytes;
      });
      const runs = formRuns(wrapped, 'Hello form');
      const drawn = await applyEditTextOperators(session, edit(FM1, runs.runs[0]?.index ?? 0, 'Hello world'), runs);
      expect(drawn.noted).toStrictEqual([]);
      const after = await readBack(session);
      expect(after.words).toContain('Helloworld');
      expect(after.words).not.toContain('Helloform');
      // THE PAGE'S OWN CONTENT, byte for byte: only the form's stream was written.
      expect(after.content).toBe(before.content);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('gives a form drawn twice a copy for the placement edited, so the other placement still reads as it did', async () => {
    const session = await mupdfWriter.open(await formPage(['q 1 0 0 1 10 20 cm /Fm1 Do Q', 'q 1 0 0 1 10 -300 cm /Fm1 Do Q']));
    try {
      const wrapped = await withDocument(session, (document) => {
        const placement = placementAt(document.findPage(0), FM1);
        if (placement === undefined) throw new Error('the fixture draws no form');
        return wrappedForm(placement).bytes;
      });
      const runs = formRuns(wrapped, 'Hello form');
      await applyEditTextOperators(session, edit(FM1, runs.runs[0]?.index ?? 0, 'Hello world'), runs);
      const after = await readBack(session);
      // BOTH: the edited placement's new words and the other's old ones.
      expect(after.words).toContain('Helloworld');
      expect(after.words).toContain('Helloform');
      // THE ONE BYTE OUTSIDE THE FORM: the first `Do` renamed to the copy, the second still the shared form.
      expect(after.content).toContain('/MonsteraForm1 Do');
      expect(after.content.match(/\/Fm1 Do/gu)).toHaveLength(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('grows a box drawn round one line, so words an edit wraps below it are shown — and only grows it (correction of 2026-10-25)', async () => {
    // THE BROCHURE'S SHAPE: a box a few points round one 12-point line at y 700, as its pull quote's is.
    const session = await mupdfWriter.open(await formPage(['q /Fm1 Do Q'], 'Hello form', [60, 696, 400, 714]));
    try {
      const wrapped = await withDocument(session, (document) => {
        const placement = placementAt(document.findPage(0), FM1);
        if (placement === undefined) throw new Error('the fixture draws no form');
        return wrappedForm(placement).bytes;
      });
      const runs = formRuns(wrapped, 'Hello form');
      // LONGER THAN THE BLOCK IS WIDE, so the writer wraps it onto lines below the box.
      await applyEditTextOperators(session, edit(FM1, runs.runs[0]?.index ?? 0, 'Hello form, and every word typed after it'), runs);
      const after = await readBack(session);
      expect(after.words).toContain('Helloform,andeverywordtypedafterit');
      const box = await withDocument(session, (document) => {
        const stated = placementAt(document.findPage(0), FM1)?.form.resolve().get('BBox');
        return stated?.isArray() === true ? [0, 1, 2, 3].map((at) => stated.get(at).asNumber()) : [];
      });
      // DOWN, where the wrapped lines are; its other sides where they were.
      expect(box[1]).toBeLessThan(696);
      expect([box[0], box[2], box[3]]).toStrictEqual([60, 400, 714]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads a form in the state it inherits at its Do, leaving out what names the page’s resources (correction of 2026-10-25)', async () => {
    // THE BROCHURE'S SHAPE: the page sets character spacing before the form, which the form's text is drawn with. A
    // colour and a graphics state by name come too; the name is the page's resource, which the form's need not hold.
    const session = await mupdfWriter.open(await formPage(['0.3 Tc 0.2 0.4 0.6 rg /GS1 gs q /Fm1 Do Q']));
    try {
      const placement = await withDocument(session, (document) => placementAt(document.findPage(0), FM1));
      expect(placement?.states).toStrictEqual(['0.3 Tc 0.2 0.4 0.6 rg']);
      const wrapped = placement === undefined ? '' : new TextDecoder().decode(wrappedForm(placement).bytes);
      // THE STATE FIRST, then the matrices, so the form's text is laid out as the page draws it.
      expect(wrapped.startsWith('q 0.3 Tc 0.2 0.4 0.6 rg 1 0 0 1 0 0 cm 1 0 0 1 0 0 cm\n')).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses to unwrap an edit that changed the wrapper, which the operator writer never writes', () => {
    const wrapped = wrappedForm({ chain: [[1, 0, 0, 1, 10, 20], [1, 0, 0, 1, 0, 0]], states: ['0.3 Tc'], content: new TextEncoder().encode('BT ET') });
    expect(new TextDecoder().decode(unwrappedForm(wrapped.bytes, wrapped))).toBe('BT ET');
    const changed = new Uint8Array(wrapped.bytes);
    changed[2] = 0x39;
    expect(() => unwrappedForm(changed, wrapped)).toThrow(/wrapper/u);
  });
});
