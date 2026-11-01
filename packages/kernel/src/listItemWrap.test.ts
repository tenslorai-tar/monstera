import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyEditTextOperators } from './textOperatorEdit.js';

/**
 * A ONE-LINE LIST ITEM THAT WRAPS sets its next line under its words, not under its marker (the owner's C5, 2026-11-01):
 * the writer hangs it from where its words begin after the marker (`listEntryOf`, the rule the editor reads too). Each
 * page draws an item in Helvetica at 11 pt; words are added past its edge, the page is saved and opened again, and each
 * line's first letter is read where MuPDF draws it.
 */

const SIZE = 11;
const ADDED = ' and on Thursdays in the village hall';

/** `lines` drawn at 72 (the item's first) and at `hang` (any later), 14 points apart. */
async function itemPage(lines: readonly string[], hang = 72): Promise<{ readonly bytes: Uint8Array; readonly rights: readonly number[] }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const rights: number[] = [];
  lines.forEach((line, at) => {
    const x = at === 0 ? 72 : hang;
    page.drawText(line, { x, y: 700 - at * 14, size: SIZE, font });
    rights.push(x + font.widthOfTextAtSize(line, SIZE));
  });
  return { bytes: await document.save({ useObjectStreams: false }), rights };
}

/** Each line's first letter's x, top to bottom, as MuPDF reads the page: a line is the letters on one baseline. */
async function lineStarts(bytes: Uint8Array): Promise<{ readonly starts: readonly number[]; readonly firstWord: number }> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const rows: { y: number; xs: number[]; text: string }[] = [];
      document.loadPage(0).toStructuredText('preserve-whitespace').walk({
        onChar: (character, origin) => {
          if (character.trim() === '') return;
          const row = rows.find((each) => Math.abs(each.y - origin[1]) < 1);
          if (row === undefined) rows.push({ y: origin[1], xs: [origin[0]], text: character });
          else {
            row.xs.push(origin[0]);
            row.text += character;
          }
        },
      });
      rows.sort((a, b) => a.y - b.y);
      // THE ITEM'S FIRST WORD on its first line: its first letter after the marker's letters ("•", "1.", "-").
      const [first] = rows;
      const marker = first === undefined ? 0 : (/^[^A-Za-z]+/u.exec(first.text)?.[0].length ?? 0);
      return { starts: rows.map((row) => Math.min(...row.xs)), firstWord: first?.xs[marker] ?? Number.NaN };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page with `ADDED` typed at the end of its block, written by the operator writer, saved and opened again. */
async function typedPast(page: { readonly bytes: Uint8Array; readonly rights: readonly number[] }, lines: readonly string[], hang = 72): Promise<Uint8Array> {
  const read = {
    textObjects: lines.map((_, at) => at),
    runs: lines.map((text, at) => ({ index: at, members: [at], text, left: at === 0 ? 72 : hang, right: page.rights[at] ?? 300, bottom: 700 - at * 14 - 3, top: 700 - at * 14 + 9 })),
  };
  const words = lines.join(' ');
  const command: CommandOfKind<'editTextOperators'> = {
    kind: 'editTextOperators',
    page: 0,
    // A REACH SHORT OF THE ADDED WORDS, as a column's edge is, so the item wraps.
    ...blockEditOf([{ lines: lines.map((_, at) => [at]), soft: lines.map((_, at) => at < lines.length - 1), text: `${words}${ADDED}`, place: { reach: 260 } }]),
    fit: 'reflow',
    version: asDocVersion(1),
  };
  const session = await mupdfWriter.open(page.bytes);
  try {
    await applyEditTextOperators(session, command, read);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a one-line list item typed past its edge', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  for (const line of ['• Garden club meets on Mondays', '1. Garden club meets on Mondays', '- Garden club meets on Mondays']) {
    it(`wraps under its words, not its marker, after a save and a reopen: "${line.slice(0, 2)}"`, async () => {
      const page = await itemPage([line]);
      const before = await lineStarts(page.bytes);
      const after = await lineStarts(await typedPast(page, [line]));
      // NOT VACUOUS: the item did wrap, and its marker stands where it stood.
      expect(after.starts.length).toBeGreaterThan(1);
      expect(Math.abs((after.starts[0] ?? Number.NaN) - 72)).toBeLessThan(0.5);
      for (const start of after.starts.slice(1)) expect(Math.abs(start - before.firstWord)).toBeLessThan(0.5);
    });
  }

  it('CONTROL: a MULTI-line item keeps the hang it learns from its later lines, as before', async () => {
    const lines = ['• Garden club meets on Mondays and', 'Thursdays in the hall'];
    const page = await itemPage(lines, 90);
    const after = await lineStarts(await typedPast(page, lines, 90));
    expect(after.starts.length).toBeGreaterThan(2);
    for (const start of after.starts.slice(1)) expect(Math.abs(start - 90)).toBeLessThan(0.5);
  });
});
