import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyEditTextOperators } from './textOperatorEdit.js';

/**
 * A FONT THAT GIVES NO LETTER WIDTHS (ADR-0270's addition of 2026-11-01, the owner's answer): an embedded one is measured
 * by its own program, and one that is not embedded by the closest normal font, the face a word typed into it is set in.
 * Each page draws one line in Caladea, set as a simple TrueType font in WinAnsi with a ToUnicode, with the program or
 * without it and with `/Widths` or without them. The edit adds two words: one the font encodes, written into the run's
 * own string, and one it cannot (U+015D), which the typed-word rule sets in a face of its own. That second word is
 * placed where the writer's widths say the run's text ends, so its x is the one position on the page the widths decide;
 * the page is saved and opened again and its letters are read where MuPDF draws them. Until the addition both pages with
 * no `/Widths` refused the edit (`unknown-width`).
 */

const WORDS = 'Garden club meets';
/** The words the edit leaves, the one it adds in the run's own font, and the one set in a second face. */
const OWN = `${WORDS} today `;
const TYPED = `${OWN}ŝ`;
const SIZE = 12;

/** Printable ASCII, each code its own character: what most producers write for a WinAnsi subset. */
const CMAP = [
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
  '/CMapName /Ascii def /CMapType 2 def',
  '1 begincodespacerange <00> <FF> endcodespacerange',
  '1 beginbfrange <20> <7E> <0020> endbfrange',
  'endcmap CMapName currentdict /CMap defineresource pop end end',
].join('\n');

/**
 * `text` in Caladea at (72, 700): the program embedded, not, or `'unloadable'` (a `FontFile2` of bytes that are no font
 * program), and `/Widths` of `stated` for every code, or none.
 */
async function caladeaPage(embedded: boolean | 'unloadable', stated?: number, text = WORDS): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const program = embedded === 'unloadable' ? new TextEncoder().encode('not a font program') : readFileSync(join(bundledFontsFolder(), 'Caladea-Regular.ttf'));
  const descriptor = document.context.register(
    document.context.obj({
      Type: 'FontDescriptor',
      FontName: 'Caladea',
      Flags: 34,
      FontBBox: [-200, -250, 1100, 950],
      ItalicAngle: 0,
      Ascent: 900,
      Descent: -250,
      CapHeight: 650,
      StemV: 80,
      ...(embedded ? { FontFile2: document.context.register(document.context.stream(program, { Length1: program.length })) } : {}),
    }),
  );
  const font = document.context.register(
    document.context.obj({
      Type: 'Font',
      Subtype: 'TrueType',
      BaseFont: 'Caladea',
      Encoding: 'WinAnsiEncoding',
      FontDescriptor: descriptor,
      ToUnicode: document.context.register(document.context.stream(CMAP)),
      ...(stated === undefined ? {} : { FirstChar: 32, LastChar: 126, Widths: Array.from({ length: 95 }, () => stated) }),
    }),
  );
  page.node.setFontDictionary(PDFName.of('F1'), font);
  page.node.addContentStream(document.context.register(document.context.stream(`BT /F1 ${String(SIZE)} Tf 72 700 Td (${text}) Tj ET`)));
  return document.save({ useObjectStreams: false });
}

interface Letters {
  readonly xs: readonly number[];
  readonly text: string;
  readonly fonts: readonly string[];
}

/** Every letter's origin x where MuPDF draws it, in reading order, and the name of the font each is drawn in. */
async function lettersOf(bytes: Uint8Array): Promise<Letters> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const xs: number[] = [];
      const fonts: string[] = [];
      let text = '';
      document.loadPage(0).toStructuredText('preserve-whitespace').walk({
        onChar: (character, origin, font) => {
          text += character;
          xs.push(origin[0]);
          fonts.push(font.getName());
        },
      });
      return { xs, text, fonts };
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page with `text` written over its line, saved, and opened again. */
async function edited(bytes: Uint8Array, text = TYPED): Promise<Uint8Array> {
  const read = { textObjects: [0], runs: [{ index: 0, members: [0], text: WORDS, left: 72, right: 160, bottom: 695, top: 712 }] };
  const command: CommandOfKind<'editTextOperators'> = {
    kind: 'editTextOperators',
    page: 0,
    // A REACH TO THE MARGIN, as the editor sends a one-line block's, so the added words stay on the line.
    ...blockEditOf([{ lines: [[0]], soft: [false], text, place: { reach: 540 } }]),
    fit: 'reflow',
    version: asDocVersion(1),
  };
  const session = await mupdfWriter.open(bytes);
  try {
    await applyEditTextOperators(session, command, read);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The x MuPDF draws the character after `OWN` at, on a page drawing `OWN` and one more letter whole in Caladea's program. */
async function programEnd(): Promise<number> {
  const whole = await lettersOf(await caladeaPage(true, undefined, `${OWN}x`));
  return whole.xs[OWN.length] ?? Number.NaN;
}

/** The letters the edit left stand where MuPDF drew them before it, letter for letter. */
function leftInPlace(before: Letters, after: Letters): void {
  expect(after.text.replace(/\s+/gu, ' ').trim()).toBe(TYPED);
  before.xs.forEach((x, at) => {
    expect(Math.abs((after.xs[at] ?? Number.NaN) - x), `letter ${String(at)}`).toBeLessThan(0.01);
    expect(after.fonts[at], `letter ${String(at)}`).toBe('Caladea');
  });
}

describe('a font that gives no letter widths, in Edit text', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('EMBEDDED, no /Widths: the edit is written by the program\'s own advances, and the words left stand where they were', async () => {
    const page = await caladeaPage(true);
    const before = await lettersOf(page);
    const after = await lettersOf(await edited(page));
    leftInPlace(before, after);
    // THE SECOND FACE'S WORD STARTS WHERE MUPDF DRAWS THE RUN'S TEXT ENDING: the writer's widths are the program's.
    expect(Math.abs((after.xs[OWN.length] ?? Number.NaN) - (await programEnd()))).toBeLessThan(0.01);
  });

  it('NOT EMBEDDED, no /Widths: the edit is written by the closest normal font\'s widths, and the words left stand', async () => {
    const page = await caladeaPage(false);
    const before = await lettersOf(page);
    const after = await lettersOf(await edited(page));
    leftInPlace(before, after);
    // CONTROL: THE CHOSEN FACE IS THE TYPED-WORD RULE'S. The word the run's font cannot encode is set by that rule, in
    // the bundled Caladea; the widths placing it are that face's advances, the same as the embedded page's program,
    // which is that file. MuPDF draws the run's own letters in a substitute of its own, so the end of what it draws is
    // not the measure: the page drawn whole with the program is.
    expect(after.fonts[OWN.length]).toMatch(/^[A-Z]{6}\+Caladea-Regular$/u);
    expect(Math.abs((after.xs[OWN.length] ?? Number.NaN) - (await programEnd()))).toBeLessThan(0.01);
    // AND THAT IS NOT MUPDF'S SUBSTITUTE agreeing by accident: its letters stand elsewhere than the program's.
    const embedded = await lettersOf(await caladeaPage(true));
    expect(before.xs.some((x, at) => Math.abs(x - (embedded.xs[at] ?? Number.NaN)) > 0.5)).toBe(true);
  });

  it('NOT EMBEDDED, no /Widths, a word DELETED: the edit asks for no new face and is still measured by the closest font', async () => {
    const page = await caladeaPage(false);
    const before = await lettersOf(page);
    const after = await lettersOf(await edited(page, 'Garden club'));
    expect(after.text.replace(/\s+/gu, ' ').trim()).toBe('Garden club');
    after.xs.forEach((x, at) => {
      expect(Math.abs(x - (before.xs[at] ?? Number.NaN)), `letter ${String(at)}`).toBeLessThan(0.01);
      expect(after.fonts[at], `letter ${String(at)}`).toBe('Caladea');
    });
  });

  it('A PROGRAM MUPDF CANNOT LOAD, no /Widths: drawn in a substitute, it is measured as a font not embedded is', async () => {
    const page = await caladeaPage('unloadable');
    const before = await lettersOf(page);
    const after = await lettersOf(await edited(page));
    leftInPlace(before, after);
    expect(Math.abs((after.xs[OWN.length] ?? Number.NaN) - (await programEnd()))).toBeLessThan(0.01);
  });

  it('CONTROL: the same font WITH /Widths is measured by them, not by the program or the closest font', async () => {
    const page = await caladeaPage(true, 600);
    const before = await lettersOf(page);
    const after = await lettersOf(await edited(page));
    leftInPlace(before, after);
    // EVERY CODE 600 THOUSANDTHS: the run's 24 characters advance 24 × 7.2 before the second face's word.
    expect(Math.abs((after.xs[OWN.length] ?? Number.NaN) - (72 + OWN.length * 0.6 * SIZE))).toBeLessThan(0.01);
  });
});
