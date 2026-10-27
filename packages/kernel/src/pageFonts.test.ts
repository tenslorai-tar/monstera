import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import * as STANDARD from './standardFontTables.js';
import { codesFor } from './toUnicode.js';

/** The Chromium print committed as Part B's starting material (`scripts/research/chromiumType3Fixture.mjs`). */
const CHROMIUM = fileURLToPath(new URL('../../testing/fixtures/text-edit/chromium-type3.pdf', import.meta.url));

/**
 * A page with three fonts, its resources on the page TREE so the leaf inherits them: a Type 3 subset whose encoding
 * names a code with no glyph, a Type0 font over a CIDFont with both forms of `/W`, and Helvetica written with no
 * `/Widths`. Built here (B10); every value the cases assert is one this builder wrote.
 */
async function threeFonts(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 300]);
  const context = doc.context;
  const unicode = (pairs: string) =>
    context.register(
      context.flateStream(
        `1 begincodespacerange <00> <FF> endcodespacerange ${pairs}`,
      ),
    );
  const glyph = context.register(context.flateStream('500 0 0 0 400 700 d1 0 0 400 700 re f'));
  const type3 = context.obj({
    Type: 'Font',
    Subtype: 'Type3',
    FontBBox: [0, 0, 400, 700],
    FontMatrix: [0.002, 0, 0, 0.002, 0, 0],
    FirstChar: 65,
    LastChar: 67,
    Widths: [500, 600, 700],
    Encoding: context.obj({ Type: 'Encoding', Differences: [65, 'a', 'b', 'c'] }),
    CharProcs: context.obj({ a: glyph, b: glyph }),
    Resources: context.obj({}),
    ToUnicode: unicode('3 beginbfchar <41> <0041> <42> <0042> <43> <0043> endbfchar'),
    FontDescriptor: context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+LiberationSans', Flags: 4, FontWeight: 400 }),
  });
  const cid = context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'GHIJKL+LiberationSans',
    CIDSystemInfo: context.obj({ Registry: context.obj('Adobe'), Ordering: context.obj('Identity'), Supplement: 0 }),
    DW: 900,
    W: [3, [250, 300], 10, 12, 640],
    FontDescriptor: context.obj({ Type: 'FontDescriptor', FontName: 'GHIJKL+LiberationSans', Flags: 32, FontWeight: 400 }),
  });
  const type0 = context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'GHIJKL+LiberationSans',
    Encoding: 'Identity-H',
    DescendantFonts: [context.register(cid)],
  });
  const helvetica = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' });
  const fonts = context.obj({ F1: context.register(type3), F2: context.register(type0), F3: context.register(helvetica) });
  // ON THE TREE, NOT THE LEAF: a page that inherits its resources is a page this reader must still see the fonts of.
  doc.catalog.Pages().set(PDFName.of('Resources'), context.obj({ Font: fonts }));
  page.node.delete(PDFName.of('Resources'));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream('BT /F1 10 Tf (AB) Tj ET')));
  page.node.set(PDFName.of('Rotate'), PDFNumber.of(0));
  return doc.save({ useObjectStreams: false });
}

describe('pageFonts reads one font object once', () => {
  it('gives names of one object one reading, each name its own entry; and two objects two readings', async () => {
    // A PAGE AS pdf-lib WRITES ONE: a new name for every line drawn, every name the same Helvetica. The text walk's dense
    // page had 39,201 such names, each read again.
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 300]);
    const helvetica = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
    const times = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman', Encoding: 'WinAnsiEncoding' }));
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helvetica, F2: helvetica, F3: helvetica, F4: times } }));
    const session = await mupdfWriter.open(await doc.save());
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      expect([...fonts.keys()]).toStrictEqual(['F1', 'F2', 'F3', 'F4']);
      expect([...fonts.values()].map((font) => font.resource)).toStrictEqual(['F1', 'F2', 'F3', 'F4']);
      // ONE READING: the measure a reading makes is the same function for every name of the object.
      expect(fonts.get('F2')?.width).toBe(fonts.get('F1')?.width);
      expect(fonts.get('F3')?.toUnicode).toBe(fonts.get('F1')?.toUnicode);
      // CONTROL: another object is read for itself.
      expect(fonts.get('F4')?.width).not.toBe(fonts.get('F1')?.width);
      expect(fonts.get('F4')?.face).toBe('Times-Roman');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('pageFonts', () => {
  it('reads each font’s kind, face and weight, the leaf inheriting the tree’s resources', async () => {
    const session = await mupdfWriter.open(await threeFonts());
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      expect([...fonts.values()].map((font) => [font.resource, font.subtype, font.face, font.weight, font.codeBytes])).toStrictEqual([
        ['F1', 'Type3', 'LiberationSans', 400, 1],
        ['F2', 'Type0', 'LiberationSans', 400, 2],
        ['F3', 'Type1', 'Helvetica', null, 1],
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('scales a Type 3 font’s widths by its FontMatrix, reads both forms of /W, and has none for a standard font in its built-in encoding', async () => {
    const session = await mupdfWriter.open(await threeFonts());
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      const width = (name: string, code: number) => fonts.get(name)?.width(code);
      // 500 x 0.002: the FontMatrix's own scale, so a Type 3 font at 0.001 and one at 0.002 differ by exactly that.
      // TO SINGLE PRECISION: MuPDF holds a PDF real as a float, measured 0.002 reading back as 0.0020000000949.
      const near = (value: number | null | undefined) => (value === null || value === undefined ? value : Number(value.toFixed(6)));
      expect([width('F1', 65), width('F1', 67), width('F1', 68)].map(near)).toStrictEqual([1, 1.4, null]);
      expect([width('F2', 4), width('F2', 11), width('F2', 99)].map(near)).toStrictEqual([0.3, 0.64, 0.9]);
      // NO /Widths AND NO ENCODING NAMED: Helvetica's built-in StandardEncoding is a table pdf-lib does not hold, so which
      // glyph a code is, and its width, would be a guess, and it answers none (ADR-0176's correction of 2026-10-25).
      expect(width('F3', 65)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  /**
   * ADR-0176's correction of 2026-10-25: a standard font the file does not carry, written as pdf-lib writes one — WinAnsi
   * named, no ToUnicode, no `/Widths`, no program — is read through its encoding and measured by its AFM widths.
   */
  it('reads a standard font with no ToUnicode through its WinAnsi encoding, and measures it by its AFM widths', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([300, 300]);
    const context = doc.context;
    const times = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman', Encoding: 'WinAnsiEncoding' });
    const mac = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman', Encoding: 'MacRomanEncoding' });
    const named = context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Arial', Encoding: 'WinAnsiEncoding', FirstChar: 65, LastChar: 65, Widths: [667] });
    page.node.setFontDictionary(PDFName.of('F1'), context.register(times));
    page.node.setFontDictionary(PDFName.of('F2'), context.register(mac));
    page.node.setFontDictionary(PDFName.of('F3'), context.register(named));
    // AN EMBEDDED SUBSET, as a word processor writes one: WinAnsi named, no ToUnicode, a program holding what it used.
    const program = context.register(context.flateStream('subset'));
    const descriptor = context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+Body', Flags: 32, FontFile2: program });
    const subset = context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Body', Encoding: 'WinAnsiEncoding', FirstChar: 65, LastChar: 65, Widths: [600], FontDescriptor: context.register(descriptor) });
    page.node.setFontDictionary(PDFName.of('F4'), context.register(subset));
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream('BT /F1 10 Tf (A) Tj ET')));
    const session = await mupdfWriter.open(await doc.save({ useObjectStreams: false }));
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      const read = (name: string) => {
        const font = fonts.get(name);
        const map = font?.toUnicode ?? null;
        return { codes: map === null ? null : codesFor(map, 'Aé€'), widths: [65, 233].map((code) => font?.width(code) ?? null) };
      };
      // TIMES' OWN AFM: A is 722 and é is 444 thousandths; WinAnsi puts é at 233 and the euro at 128.
      expect(read('F1')).toStrictEqual({ codes: [65, 233, 128], widths: [0.722, 0.444] });
      // A FONT THAT IS NOT STANDARD keeps its own /Widths, and is read through the encoding it names; it states no other.
      expect(read('F3')).toStrictEqual({ codes: [65, 233, 128], widths: [0.667, null] });
      // CONTROL: MacRoman is not a table pdf-lib holds, so that font has no known characters and no width, as before.
      expect(read('F2')).toStrictEqual({ codes: null, widths: [null, null] });
      // CONTROL: an EMBEDDED subset's encoding promises no glyph, so it has no known characters (documents 6 and 8).
      expect(read('F4')).toStrictEqual({ codes: null, widths: [0.6, null] });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('says a Type 3 font draws only the codes its CharProcs hold, and reads its ToUnicode', async () => {
    const session = await mupdfWriter.open(await threeFonts());
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      const type3 = fonts.get('F1');
      expect([65, 66, 67].map((code) => type3?.draws(code))).toStrictEqual([true, true, false]);
      // CONTROL: the ToUnicode names C, so a writer asking the ToUnicode alone would take a code with no glyph.
      const map = type3?.toUnicode ?? null;
      expect(map === null ? 'no ToUnicode' : codesFor(map, 'C')).toStrictEqual([67]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads the committed Chromium print: a Type 3 heading face and a Type0 body face, one face by name', async () => {
    const session = await mupdfWriter.open(new Uint8Array(readFileSync(CHROMIUM)));
    try {
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), STANDARD));
      const of = (name: string) => fonts.get(name);
      expect([of('F4')?.subtype, of('F4')?.face, of('F4')?.weight, of('F5')?.subtype, of('F5')?.face]).toStrictEqual([
        'Type3',
        'LiberationSans',
        400,
        'Type0',
        'LiberationSans',
      ]);
      const map = of('F4')?.toUnicode ?? null;
      expect(map === null ? 'no ToUnicode' : codesFor(map, 'Monstera')).toStrictEqual([0x30, 0x52, 0x51, 0x56, 0x57, 0x48, 0x55, 0x44]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads the page’s content through its indirect reference', async () => {
    const session = await mupdfWriter.open(await threeFonts());
    try {
      const streams = await withDocument(session, (document) => pageContentStreams(document.findPage(0)));
      expect(streams.map((stream) => new TextDecoder().decode(stream))).toStrictEqual(['BT /F1 10 Tf (AB) Tj ET']);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
