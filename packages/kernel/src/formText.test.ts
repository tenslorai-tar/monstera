import { PDFDocument as PdfLibDocument, PDFName, type PDFRef, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind, type FormPath } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { formPagesDocument, placementAt, textPlacements, unwrappedForm, wrappedForm } from './formText.js';
import { ColorSpace, Matrix } from './mupdfRaw.js';
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
  const form = textForm(document, formText, box);
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

/** A form showing `formText` at (72, 700) in 12 points, its box `box`. */
function textForm(document: PdfLibDocument, formText: string, box: readonly number[]): PDFRef {
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
  return document.context.register(
    document.context.stream(`BT /F1 12 Tf 72 700 Td (${formText}) Tj ET`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [...box],
      Resources: { Font: { F1: font } },
    }),
  );
}

/**
 * DOCUMENT 6'S SHAPE, one level deeper: the page draws `Fm2`, a form holding no text whose box is round one line, and
 * `Fm2` draws the text form `Fm1` through a clip rectangle that is that same line's box.
 */
async function nestedFormPage(outerContent = 'q 60 696 340 18 re W n /Fm1 Do Q'): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  const inner = textForm(document, 'Hello form', [60, 696, 400, 714]);
  const outer = document.context.register(
    document.context.stream(outerContent, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [60, 696, 400, 714],
      Resources: { XObject: { Fm1: inner } },
    }),
  );
  page.node.setXObject(PDFName.of('Fm2'), outer);
  page.node.addContentStream(document.context.register(document.context.stream('q /Fm2 Do Q')));
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

/** The wrapped content of the placement `path` names: what PDFium reads it as. */
async function wrappedOf(session: Awaited<ReturnType<typeof mupdfWriter.open>>, path: FormPath): Promise<Uint8Array> {
  return withDocument(session, (document) => {
    const placement = placementAt(document.findPage(0), path);
    if (placement === undefined) throw new Error('the fixture draws no form there');
    return wrappedForm(placement).bytes;
  });
}

/** How many dark pixels MuPDF draws across the page between heights `bottom` and `top`, at 72 per inch. */
async function inkBetween(session: Awaited<ReturnType<typeof mupdfWriter.open>>, bottom: number, top: number): Promise<number> {
  return withDocument(session, (document) => {
    const pixmap = document.loadPage(0).toPixmap(Matrix.identity, ColorSpace.DeviceGray, false, true);
    const [stride, pixels] = [pixmap.getStride(), pixmap.getPixels()];
    let dark = 0;
    for (let row = 792 - top; row < 792 - bottom; row += 1) {
      for (let x = 0; x < pixmap.getWidth(); x += 1) if ((pixels[row * stride + x] ?? 255) < 128) dark += 1;
    }
    return dark;
  });
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

  it('grows the page’s clip that frames the form alone, so words wrapped below the form’s box are shown (correction of 2026-10-25)', async () => {
    // DOCUMENT 6'S SHAPE: the page draws the form through a clip rectangle that is the form's box.
    const session = await mupdfWriter.open(await formPage(['q 60 696 340 18 re W n /Fm1 Do Q'], 'Hello form', [60, 696, 400, 714]));
    try {
      expect(await inkBetween(session, 600, 695)).toBe(0);
      const runs = formRuns(await wrappedOf(session, FM1), 'Hello form');
      await applyEditTextOperators(session, edit(FM1, runs.runs[0]?.index ?? 0, 'Hello form, and every word typed after it'), runs);
      const after = await readBack(session);
      const frame = /q (\S+) (\S+) (\S+) (\S+) re W n/u.exec(after.content)?.slice(1).map(Number) ?? [];
      // DOWN, where the wrapped lines are; its other sides where they were.
      expect(frame[1]).toBeLessThan(696);
      expect([frame[0], frame[2], (frame[1] ?? 0) + (frame[3] ?? 0)]).toStrictEqual([60, 340, 714]);
      // AND SHOWN: the wrapped lines draw below the old frame, which they did not with the box alone, and MuPDF's reading
      // through the page's clips holds every word.
      expect(await inkBetween(session, 600, 695)).toBeGreaterThan(0);
      expect(after.words).toContain('Helloform,andeverywordtypedafterit');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: leaves a clip that frames something else too, whose words below stay out of sight — the stated limit', async () => {
    // A SQUARE DRAWN INSIDE THE SAME CLIP: growing the clip would show it where its author clipped it.
    const session = await mupdfWriter.open(await formPage(['q 60 696 340 18 re W n 0 0 1 rg 300 690 20 20 re f /Fm1 Do Q'], 'Hello form', [60, 696, 400, 714]));
    try {
      const before = await readBack(session);
      const runs = formRuns(await wrappedOf(session, FM1), 'Hello form');
      await applyEditTextOperators(session, edit(FM1, runs.runs[0]?.index ?? 0, 'Hello form, and every word typed after it'), runs);
      const after = await readBack(session);
      // WRITTEN, as MuPDF reads the content past every clip; and NOT SHOWN, the clip and the page as they were.
      const written = await withDocument(session, (document) => document.loadPage(0).toStructuredText('clip=no').asText().replace(/\s/gu, ''));
      expect(written).toContain('Helloform,andeverywordtypedafterit');
      expect(after.words).not.toContain('Helloform,andeverywordtypedafterit');
      expect(after.content).toBe(before.content);
      expect(await inkBetween(session, 600, 689)).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('grows a holding form’s clip and its box too, for a form drawn inside another (correction of 2026-10-25)', async () => {
    const path: FormPath = [
      { name: 'Fm2', occurrence: 0 },
      { name: 'Fm1', occurrence: 0 },
    ];
    const session = await mupdfWriter.open(await nestedFormPage());
    try {
      const runs = formRuns(await wrappedOf(session, path), 'Hello form');
      await applyEditTextOperators(session, edit(path, runs.runs[0]?.index ?? 0, 'Hello form, and every word typed after it'), runs);
      const outer = await withDocument(session, (document) => {
        const holder = placementAt(document.findPage(0), path.slice(0, 1))?.form.resolve();
        const stated = holder?.get('BBox');
        return {
          box: stated?.isArray() === true ? [0, 1, 2, 3].map((at) => stated.get(at).asNumber()) : [],
          content: holder === undefined ? '' : new TextDecoder('latin1').decode(placementAt(document.findPage(0), path.slice(0, 1))?.content),
        };
      });
      expect(outer.box[1]).toBeLessThan(696);
      expect(Number(/q (\S+) (\S+) (\S+) (\S+) re W n/u.exec(outer.content)?.[2])).toBeLessThan(696);
      expect(await inkBetween(session, 600, 695)).toBeGreaterThan(0);
      expect((await readBack(session)).words).toContain('Helloform,andeverywordtypedafterit');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('copies a form drawn twice inside another form for the placement edited, reading the holding form’s own stream', async () => {
    // THE HOLDER IS A FORM, whose stream the copy's rename is written into: read from its reference, never its dictionary.
    const path: FormPath = [
      { name: 'Fm2', occurrence: 0 },
      { name: 'Fm1', occurrence: 0 },
    ];
    const session = await mupdfWriter.open(await nestedFormPage('q /Fm1 Do Q q 1 0 0 1 0 -300 cm /Fm1 Do Q'));
    try {
      const runs = formRuns(await wrappedOf(session, path), 'Hello form');
      await applyEditTextOperators(session, edit(path, runs.runs[0]?.index ?? 0, 'Hello world'), runs);
      const outer = await withDocument(session, (document) => new TextDecoder('latin1').decode(placementAt(document.findPage(0), path.slice(0, 1))?.content));
      expect(outer).toBe('q /MonsteraForm1 Do Q q 1 0 0 1 0 -300 cm /Fm1 Do Q');
      const written = await withDocument(session, (document) => document.loadPage(0).toStructuredText('clip=no').asText().replace(/\s/gu, ''));
      expect(written).toContain('Helloworld');
      expect(written).toContain('Helloform');
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
