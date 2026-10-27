import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { BlockUnchangedError } from './textEditRefusals.js';
import { applyEditTextOperators } from './textOperatorEdit.js';

/**
 * Italic is a change both ways (the owner's test of milestone 1: *taking bold off, and italic both ways, must work*). The
 * writer compared a mark with `italic === true` alone, so Italic taken off an italic word was answered *unchanged* and
 * the word stayed slanted. It now compares with the slant the read showed the person (`PageRun.italic`).
 */

const WORDS = 'slanted words';

async function obliquePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.HelveticaOblique);
  document.addPage([612, 792]).drawText(WORDS, { x: 72, y: 700, size: 20, font });
  return document.save();
}

/** The page's one run as PDFium's pre-read gives it, the slant the editor showed included. */
const READ = { textObjects: [0], runs: [{ index: 0, members: [0], text: WORDS, left: 72, right: 200, bottom: 695, top: 715, italic: true as const }] };

const marked = (italic: boolean | undefined): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[0]], soft: [false], text: WORDS, ...(italic === undefined ? {} : { marks: [{ from: 0, to: WORDS.length, set: { italic } }] }) }]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/**
 * The fonts MuPDF reads the page's VISIBLE words in after the edit, by name: by its lines of text, since the old show
 * operator stays where it stood, at its advance, drawing nothing.
 */
async function facesAfter(command: CommandOfKind<'editTextOperators'>): Promise<string[]> {
  const session = await mupdfWriter.open(await obliquePage());
  try {
    await applyEditTextOperators(session, command, READ);
    return await withDocument(session, (document) => {
      const json = JSON.parse(document.loadPage(0).toStructuredText().asJSON()) as {
        blocks: { lines?: { text?: string; font?: { name?: string } }[] }[];
      };
      const lines = json.blocks.flatMap((block) => block.lines ?? []).filter((line) => (line.text ?? '').trim() !== '');
      return [...new Set(lines.map((line) => line.font?.name ?? ''))];
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('Italic taken off an italic word', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('is written upright: the page no longer shows the words in an oblique face', async () => {
    const faces = await facesAfter(marked(false));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.some((face) => /oblique|italic/iu.test(face)), JSON.stringify(faces)).toBe(false);
  });

  it('CONTROL: a mark asking Italic ON of the italic word is no change, and nothing is written', async () => {
    await expect(facesAfter(marked(true))).rejects.toBeInstanceOf(BlockUnchangedError);
  });
});
