import { PDFDocument as PdfLibDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PageRuns } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { TextNotWritableError } from './textEditRefusals.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/**
 * A TAB TYPED ON A PAGE WHOSE FONT HOLDS NO SPACE (ADR-0228 Decision 2): its marked gap stands on a face's space, never on
 * nothing. The text walk's sample is this shape — a Helvetica whose codes the page never used for a space — and every tab
 * typed there was written as a gap with no mark (step 11, 2026-10-25).
 */
async function noSpacePage(): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  // PRINTABLE ASCII BUT THE SPACE: the font's own text names no code for it, so its run cannot draw one.
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /NoSpace def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfrange <21> <7E> <0021> endbfrange',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const font = document.context.register(
    document.context.obj({
      Type: 'Font',
      Subtype: 'Type1',
      BaseFont: StandardFonts.Helvetica,
      FirstChar: 33,
      LastChar: 126,
      Widths: Array.from({ length: 94 }, () => 500),
      Encoding: 'WinAnsiEncoding',
      ToUnicode: document.context.register(document.context.stream(cmap)),
    }),
  );
  page.node.setFontDictionary(PDFName.of('F1'), font);
  page.node.addContentStream(document.context.register(document.context.stream('BT /F1 12 Tf 72 700 Td (Hello) Tj ET')));
  return document.save({ useObjectStreams: false });
}

/** PDFium's reading of the page as it numbers it: one text object, one run holding it. */
function runsOf(content: Uint8Array): PageRuns {
  const ops = showOperators(content);
  const index = ops.find((op) => op.object !== null)?.object ?? 0;
  return {
    textObjects: Array.from({ length: textObjectCount(ops) }, (_, at) => at),
    runs: [{ index, members: [index], text: 'Hello', left: 0, right: 0, bottom: 0, top: 0 }],
  };
}

const edit = (index: number, text: string): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[index]], soft: [false], text }]),
  fit: 'reflow',
  version: asDocVersion(1),
});

afterEach(() => {
  bindEditFaces(null);
});

describe('a tab on a page whose font holds no space (ADR-0228 Decision 2, 2026-10-25)', () => {
  it('is written as a marked gap on a face’s space, and reads back as a tab', async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
    const session = await mupdfWriter.open(await noSpacePage());
    try {
      const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      const runs = runsOf(content);
      await applyEditTextOperators(session, edit(runs.runs[0]?.index ?? 0, 'Hel\tlo'), runs);
      const after = await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
      expect(after.match(/\/ActualText\s*<FEFF0009>/giu)).toHaveLength(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: with no face to stand it on, the tab is NAMED, never dropped unsaid', async () => {
    const session = await mupdfWriter.open(await noSpacePage());
    try {
      const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      const runs = runsOf(content);
      const refused = applyEditTextOperators(session, edit(runs.runs[0]?.index ?? 0, 'Hel\tlo'), runs);
      await expect(refused).rejects.toBeInstanceOf(TextNotWritableError);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
