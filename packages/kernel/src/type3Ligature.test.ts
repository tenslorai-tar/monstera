import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument as LibDocument, PDFName } from '@cantoo/pdf-lib';
import { blockEditOf, type BlockMarkSet, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PDFObject } from './mupdfRaw.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { ShapingFace } from './textShaping.js';

/**
 * A DRAWN (Type 3) FONT'S JOINED LETTERS KEEP THEIR UNICODE through an edit that changes only their look (item 25b): a
 * word holding the joined `ft`, whose one glyph reads as two letters through the font's `ToUnicode`, recoloured, resized
 * or moved, must still read `after` afterwards, so search and copy find it. Nobody edited its letters.
 *
 * The font is generated: Tinos' own outlines as glyph procedures, `a`, `e` and `r` one glyph each, and `ft` ONE glyph
 * drawing both letters, mapped in `ToUnicode` to the two. A second glyph, `x`, is drawn with NO `ToUnicode` entry at all,
 * the control's: nothing may invent one for it.
 *
 * Read back by MuPDF from the saved bytes, the page as a reader reads it, and by a search for the word.
 *
 * WHAT THIS FOUND ON MAIN (808e897c, 2026-11-02): the defect does not happen with this font. Each change keeps the
 * drawn font's own codes, `<61806572>`, under the colour, size or matrix it asked for, so the font and its `ToUnicode`
 * are the page's own and the word reads `after`; on one word of a run, the run is split and both halves keep their codes.
 * PDFium and PDF.js read the same saved files as `after` and `raft after` too (a scratch read, not in this file, since a
 * kernel test reaches neither). With the joined glyph's entry taken out of the fixture every case here goes red, so the
 * readings can see a lost pair.
 */

const FONTS = bundledFontsFolder();
const SIZE = 24;
const FT = 0x80;
const X = 0x78;
/** `after`, its `ft` the joined glyph. */
const AFTER = [0x61, FT, 0x65, 0x72];
/** `raft after`: two words in ONE run, each holding the joined glyph, the space a glyph of the font's own. */
const RAFT_AFTER = [0x72, 0x61, FT, 0x20, ...AFTER];

/** Tinos' outline of `character` as glyph-procedure path operators, offset `dx` across, with no `d0` of its own. */
function pathOf(face: ShapingFace, character: string, dx: number): string {
  const glyph = face.glyphFor(character.codePointAt(0) ?? 0) ?? 0;
  const parts: string[] = [];
  let pen: readonly [number, number] = [0, 0];
  const at = (x: number, y: number): string => `${(x + dx).toFixed(2)} ${y.toFixed(2)}`;
  for (const { type, values: v } of face.outline(glyph)) {
    const n = (k: number): number => v[k] ?? 0;
    if (type === 'M') {
      parts.push(`${at(n(0), n(1))} m`);
      pen = [n(0), n(1)];
    } else if (type === 'L') {
      parts.push(`${at(n(0), n(1))} l`);
      pen = [n(0), n(1)];
    } else if (type === 'Q') {
      const c1 = [pen[0] + (2 / 3) * (n(0) - pen[0]), pen[1] + (2 / 3) * (n(1) - pen[1])] as const;
      const c2 = [n(2) + (2 / 3) * (n(0) - n(2)), n(3) + (2 / 3) * (n(1) - n(3))] as const;
      parts.push(`${at(c1[0], c1[1])} ${at(c2[0], c2[1])} ${at(n(2), n(3))} c`);
      pen = [n(2), n(3)];
    } else if (type === 'C') {
      parts.push(`${at(n(0), n(1))} ${at(n(2), n(3))} ${at(n(4), n(5))} c`);
      pen = [n(4), n(5)];
    } else parts.push('h');
  }
  return parts.join('\n');
}

/** A page showing `after` (its `ft` one joined glyph) and, apart, `x` with no Unicode, in one generated Type 3 font. */
async function drawnPage(shown: readonly number[] = AFTER): Promise<Uint8Array> {
  const face = new ShapingFace(new Uint8Array(readFileSync(join(FONTS, 'Tinos-Regular.ttf'))), 0, {});
  const advance = (character: string): number => face.nominalAdvance(face.glyphFor(character.codePointAt(0) ?? 0) ?? 0);
  const glyphs: { readonly code: number; readonly name: string; readonly letters: string; readonly unicode: string | null }[] = [
    { code: 0x61, name: 'ga', letters: 'a', unicode: 'a' },
    { code: 0x65, name: 'ge', letters: 'e', unicode: 'e' },
    { code: 0x72, name: 'gr', letters: 'r', unicode: 'r' },
    { code: FT, name: 'gft', letters: 'ft', unicode: 'ft' },
    { code: X, name: 'gx', letters: 'x', unicode: null },
    { code: 0x20, name: 'gspace', letters: ' ', unicode: ' ' },
  ];
  const document = await LibDocument.create();
  const page = document.addPage([612, 792]);
  const { context } = document;
  const widthOf = (letters: string): number => Array.from(letters).reduce((sum, character) => sum + advance(character), 0);
  const procedure = (letters: string): string => {
    let dx = 0;
    const paths: string[] = [];
    for (const character of letters) {
      paths.push(pathOf(face, character, dx));
      dx += advance(character);
    }
    return `${String(widthOf(letters))} 0 d0\n${paths.join('\n')}\nf`;
  };
  const procs = context.obj(Object.fromEntries(glyphs.map((glyph) => [glyph.name, context.register(context.flateStream(procedure(glyph.letters)))])));
  const mapped = glyphs.filter((glyph) => glyph.unicode !== null);
  const hex = (text: string): string => Array.from(text, (character) => (character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')).join('');
  const unicode = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /DrawnJoined def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    `${String(mapped.length)} beginbfchar`,
    ...mapped.map((glyph) => `<${glyph.code.toString(16).padStart(2, '0')}> <${hex(glyph.unicode ?? '')}>`),
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const first = Math.min(...glyphs.map((glyph) => glyph.code));
  const last = Math.max(...glyphs.map((glyph) => glyph.code));
  const widths = Array.from({ length: last - first + 1 }, (_, at) => {
    const glyph = glyphs.find((each) => each.code === first + at);
    return glyph === undefined ? 0 : widthOf(glyph.letters);
  });
  const differences: (number | PDFName)[] = [];
  for (const glyph of [...glyphs].sort((a, b) => a.code - b.code)) differences.push(glyph.code, PDFName.of(glyph.name));
  const em = face.unitsPerEm;
  const font = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, -em, em * 2, em],
      FontMatrix: [1 / em, 0, 0, 1 / em, 0, 0],
      CharProcs: procs,
      Encoding: context.obj({ Type: 'Encoding', Differences: differences }),
      FirstChar: first,
      LastChar: last,
      Widths: widths,
      Resources: context.obj({}),
      ToUnicode: context.register(context.flateStream(unicode)),
      FontDescriptor: context.register(
        context.obj({ Type: 'FontDescriptor', FontName: 'DrawnJoined', Flags: 34, FontWeight: 400, ItalicAngle: 0, FontBBox: [0, -em, em * 2, em] }),
      ),
    }),
  );
  page.node.setFontDictionary(PDFName.of('F1'), font);
  const word = shown.map((code) => code.toString(16).padStart(2, '0')).join('');
  page.node.set(
    PDFName.of('Contents'),
    context.register(context.flateStream(`BT /F1 ${String(SIZE)} Tf 72 700 Td <${word}> Tj ET\nBT /F1 ${String(SIZE)} Tf 72 600 Td <${X.toString(16)}> Tj ET`)),
  );
  return document.save();
}

/** The page's two runs as PDFium reads them: `after`, and the `x` it reads as no letter it can name. */
const READ = {
  textObjects: [0, 1],
  runs: [{ index: 0, members: [0], text: 'after', left: 72, right: 130, bottom: 694, top: 718 }],
};

const edited = (change: { readonly set?: BlockMarkSet; readonly move?: { readonly x: number; readonly y: number } }): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([
    {
      lines: [[0]],
      soft: [false],
      text: 'after',
      ...(change.set === undefined ? {} : { marks: [{ from: 0, to: 5, set: change.set }] }),
      ...(change.move === undefined ? {} : { place: { move: change.move } }),
    },
  ]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/** Applies `command`, saves, reopens, and answers the page's text, whether `after` is found, and the saved bytes. */
async function readBack(
  command: CommandOfKind<'editTextOperators'>,
  shown: readonly number[] = AFTER,
  read: typeof READ = READ,
): Promise<{ readonly text: string; readonly found: number; readonly saved: Uint8Array }> {
  const session = await mupdfWriter.open(await drawnPage(shown));
  try {
    await applyEditTextOperators(session, command, read);
    const saved = await mupdfWriter.serialise(session);
    const reopened = await mupdfWriter.open(saved);
    try {
      return await withDocument(reopened, (document) => {
        const page = document.loadPage(0);
        return { text: page.toStructuredText().asText(), found: page.search('after').length, saved };
      });
    } finally {
      await mupdfWriter.close(reopened);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The page's content streams, decoded and joined. */
async function contentOf(bytes: Uint8Array): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const contents = document.findPage(0).get('Contents');
      const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, at) => contents.get(at)) : [contents];
      return streams.map((stream) => new TextDecoder('latin1').decode(stream.readStream().asUint8Array())).join('\n');
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Every `ToUnicode` map of the page's fonts, decoded. */
async function unicodeMapsOf(bytes: Uint8Array): Promise<string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const maps: string[] = [];
      document
        .findPage(0)
        .get('Resources')
        .get('Font')
        .forEach((value: PDFObject) => {
          const map = value.resolve().get('ToUnicode');
          if (!map.isNull()) maps.push(new TextDecoder('latin1').decode(map.readStream().asUint8Array()));
        });
      return maps;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a drawn font’s joined letters keep their Unicode through a change of look (item 25b)', () => {
  beforeEach(() => {
    bindEditFolders(FONTS, null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('CONTROL FIRST: the page as generated reads `after`, and a search finds it, so the readings below can say so', async () => {
    const session = await mupdfWriter.open(await drawnPage());
    try {
      const { text, found } = await withDocument(session, (document) => {
        const page = document.loadPage(0);
        return { text: page.toStructuredText().asText(), found: page.search('after').length };
      });
      expect(text).toContain('after');
      expect(found).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  for (const [name, change] of [
    ['its colour', { set: { colour: { r: 200, g: 20, b: 20 } } }],
    ['its size', { set: { size: 30 } }],
    ['its place', { move: { x: 40, y: -30 } }],
  ] as const) {
    it(`a change of ${name} keeps "after" readable and searchable after save and reopen`, async () => {
      const { text, found, saved } = await readBack(edited(change));
      expect(text).toContain('after');
      expect(found).toBe(1);
      // AND THE CHANGE WAS MADE, so a page left as it was cannot pass for one that kept its Unicode through an edit.
      expect(await contentOf(saved)).not.toBe(await contentOf(await drawnPage()));
    });
  }

  it('CONTROL: a glyph with no ToUnicode entry still has none after an edit of the word beside it: nothing is invented', async () => {
    const { saved } = await readBack(edited({ set: { colour: { r: 200, g: 20, b: 20 } } }));
    const maps = await unicodeMapsOf(saved);
    expect(maps.length).toBeGreaterThan(0);
    // THE JOINED GLYPH'S TWO LETTERS ARE THERE, so the read can see an entry it is looking for.
    expect(maps.some((map) => /<80>\s*<00660074>/u.test(map))).toBe(true);
    expect(maps.every((map) => !/<78>\s*</u.test(map))).toBe(true);
  });

  for (const [name, set] of [
    ['its colour', { colour: { r: 200, g: 20, b: 20 } }],
    ['its size', { size: 30 }],
  ] as const) {
    it(`a change of ${name} on ONE word of a run keeps both words readable and searchable after save and reopen`, async () => {
      const read = { ...READ, runs: [{ index: 0, members: [0], text: 'raft after', left: 72, right: 200, bottom: 694, top: 718 }] };
      const command: CommandOfKind<'editTextOperators'> = {
        kind: 'editTextOperators',
        page: 0,
        ...blockEditOf([{ lines: [[0]], soft: [false], text: 'raft after', marks: [{ from: 5, to: 10, set }] }]),
        fit: 'reflow',
        version: asDocVersion(1),
      };
      const { text, found, saved } = await readBack(command, RAFT_AFTER, read);
      expect(await contentOf(saved)).not.toBe(await contentOf(await drawnPage(RAFT_AFTER)));
      expect(text.replace(/\s+/gu, ' ')).toContain('raft after');
      expect(found).toBe(1);
    });
  }
});
