import { PDFDocument as PdfLibDocument, PDFName } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PageRuns } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/**
 * A PARAGRAPH IN A STANDARD FONT THE FILE DOES NOT CARRY, as pdf-lib writes one (ADR-0176's correction of 2026-10-25):
 * `/Type1 /Times-Roman`, `encoding` named, no ToUnicode, no `/Widths`. Measured in the running app on the editor-fidelity
 * page: highlighted and nothing else, it was written in a stand-in face and wrapped onto another line.
 */
async function standardPage(encoding: string): Promise<Uint8Array> {
  const document = await PdfLibDocument.create();
  const page = document.addPage([612, 792]);
  const font = document.context.register(document.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman', Encoding: encoding }));
  page.node.setFontDictionary(PDFName.of('F1'), font);
  page.node.addContentStream(document.context.register(document.context.stream('BT /F1 12 Tf 72 700 Td (Hello there) Tj ET')));
  return document.save({ useObjectStreams: false });
}

/** PDFium's reading of the page: one text object, one run holding it. */
function runsOf(content: Uint8Array): PageRuns {
  const ops = showOperators(content);
  const index = ops.find((op) => op.object !== null)?.object ?? 0;
  return {
    textObjects: Array.from({ length: textObjectCount(ops) }, (_, at) => at),
    runs: [{ index, members: [index], text: 'Hello there', left: 72, right: 128, bottom: 697, top: 709 }],
  };
}

const highlighted = (index: number): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[index]], soft: [false], text: 'Hello there', marks: [{ from: 0, to: 11, set: { highlight: { r: 255, g: 255, b: 0 } } }] }]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/**
 * The fonts the edit's new text object DRAWS its words in: each showing operator's font in force, after the highlight
 * drawn behind them. Not every `Tf` said there: the writer replays the source's own before it sets a stand-in.
 */
async function fontsWritten(bytes: Uint8Array): Promise<string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    await applyEditTextOperators(session, highlighted(runsOf(content).runs[0]?.index ?? 0), runsOf(content));
    const after = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    // LATIN-1 IS ONE CHARACTER A BYTE, so the decoded index is the byte offset.
    const from = new TextDecoder('latin1').decode(after).indexOf('MonsteraDecoration');
    if (from < 0) throw new Error('the edit drew no highlight');
    return [...new Set(showOperators(after).filter((op) => op.start > from && op.codes.length > 0).map((op) => op.state.font ?? ''))];
  } finally {
    await mupdfWriter.close(session);
  }
}

afterEach(() => {
  bindEditFaces(null);
});

describe('a paragraph in a standard font the file does not carry (ADR-0176, corrected 2026-10-25)', () => {
  it('is written in its own font when only highlighted, read through its WinAnsi encoding', async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
    expect(await fontsWritten(await standardPage('WinAnsiEncoding'))).toStrictEqual(['F1']);
  });

  it('CONTROL: in an encoding pdf-lib holds no table for, the same words go to a stand-in face', async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
    const fonts = await fontsWritten(await standardPage('MacRomanEncoding'));
    expect(fonts).not.toContain('F1');
    expect(fonts.length).toBeGreaterThan(0);
  });
});
