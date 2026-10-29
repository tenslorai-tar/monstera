import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument as LibDocument, PDFName } from '@cantoo/pdf-lib';
import { blockEditOf, type CommandOfKind } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { contoursOfOutline, stemOf, weightMatching } from './drawnWeight.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import type { PDFObject } from './mupdfRaw.js';
import { readTextFaces } from './textFaces.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { ShapingFace } from './textShaping.js';

/**
 * ADR-0176's corrections of 2026-10-26 (the owner's L2): a word typed beside letters drawn in a Type 3 font takes the
 * weight those letters LOOK, measured from their stems, not the number their descriptor states; and the person's own Bold
 * is set as they chose it.
 */

describe('the stem and the weight it matches', () => {
  it('reads a stem as where a line across the middle enters and leaves the ink', () => {
    // AN `l`: a stem 80 wide, 700 tall, with a foot 200 wide at its base that the middle line does not cross.
    const l = [
      [
        [0, 0],
        [200, 0],
        [200, 40],
        [140, 40],
        [140, 700],
        [60, 700],
        [60, 40],
        [0, 40],
      ] as const,
    ];
    expect(stemOf(l)).toBeCloseTo(80, 6);
  });

  it('reads a curve flattened: a quadratic and a cubic stem are as wide as the straight one', () => {
    const quadratic = contoursOfOutline([
      { type: 'M', values: [0, 0] },
      { type: 'L', values: [80, 0] },
      { type: 'Q', values: [80, 350, 80, 700] },
      { type: 'L', values: [0, 700] },
      { type: 'C', values: [0, 466, 0, 233, 0, 0] },
      { type: 'Z', values: [] },
    ]);
    expect(stemOf(quadratic)).toBeCloseTo(80, 6);
  });

  it('matches a stem between two weights by their straight line, and the end weight past either end', () => {
    const tinos = [
      { weight: 400, stem: 0.081 },
      { weight: 700, stem: 0.141 },
    ];
    expect(weightMatching(0.107, tinos)).toBe(530);
    expect(weightMatching(0.05, tinos)).toBe(400);
    expect(weightMatching(0.2, tinos)).toBe(700);
  });

  it('CONTROL: answers nothing where the family offers one stem, so nothing can be told apart', () => {
    expect(weightMatching(0.1, [{ weight: 400, stem: 0.081 }])).toBeUndefined();
    expect(weightMatching(0.1, [{ weight: 400, stem: 0.081 }, { weight: 700, stem: 0.081 }])).toBeUndefined();
  });
});

/** The letters the drawn font holds, a code each from 97, and the word the page shows in it. */
const LETTERS = 'lirnmhuedoca';
const SHOWN = 'minimum';
const FONTS = bundledFontsFolder();

/** `face`'s outline of `character` as a glyph procedure's path, in the face's own units, quadratics raised to cubics. */
function procedureOf(face: ShapingFace, character: string): string {
  const glyph = face.glyphFor(character.codePointAt(0) ?? 0) ?? 0;
  const parts = [`${String(face.nominalAdvance(glyph))} 0 d0`];
  let pen: readonly [number, number] = [0, 0];
  for (const { type, values: v } of face.outline(glyph)) {
    const n = (k: number): number => v[k] ?? 0;
    if (type === 'M') {
      parts.push(`${String(n(0))} ${String(n(1))} m`);
      pen = [n(0), n(1)];
    } else if (type === 'L') {
      parts.push(`${String(n(0))} ${String(n(1))} l`);
      pen = [n(0), n(1)];
    } else if (type === 'Q') {
      const c1 = [pen[0] + (2 / 3) * (n(0) - pen[0]), pen[1] + (2 / 3) * (n(1) - pen[1])];
      const c2 = [n(2) + (2 / 3) * (n(0) - n(2)), n(3) + (2 / 3) * (n(1) - n(3))];
      parts.push(`${[...c1, ...c2, n(2), n(3)].map((value) => value.toFixed(2)).join(' ')} c`);
      pen = [n(2), n(3)];
    } else if (type === 'C') {
      parts.push(`${[0, 1, 2, 3, 4, 5].map((k) => n(k).toFixed(2)).join(' ')} c`);
      pen = [n(4), n(5)];
    } else parts.push('h');
  }
  parts.push('f');
  return parts.join('\n');
}

/**
 * A page showing `minimum` in a Type 3 font whose glyphs are Tinos `style`'s own outlines and whose descriptor states
 * `stated`: letters that LOOK one weight and SAY another.
 */
async function drawnPage(style: 'Regular' | 'Bold', stated: number, inForm = false): Promise<Uint8Array> {
  const face = new ShapingFace(new Uint8Array(readFileSync(join(FONTS, `Tinos-${style}.ttf`))), 0, {});
  const document = await LibDocument.create();
  const page = document.addPage([612, 792]);
  const { context } = document;
  const names = Array.from(LETTERS, (character) => `g${character}`);
  const procs = context.obj(
    Object.fromEntries(Array.from(LETTERS, (character, at) => [names[at] ?? '', context.register(context.flateStream(procedureOf(face, character)))])),
  );
  const unicode = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Drawn def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    `${String(LETTERS.length)} beginbfchar`,
    ...Array.from(LETTERS, (character, at) => `<${(97 + at).toString(16)}> <00${(character.codePointAt(0) ?? 0).toString(16)}>`),
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const em = face.unitsPerEm;
  const font = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, -em, em, em],
      FontMatrix: [1 / em, 0, 0, 1 / em, 0, 0],
      CharProcs: procs,
      Encoding: context.obj({ Type: 'Encoding', Differences: [97, ...names.map((name) => PDFName.of(name))] }),
      FirstChar: 97,
      LastChar: 96 + LETTERS.length,
      Widths: Array.from(LETTERS, (character) => face.nominalAdvance(face.glyphFor(character.codePointAt(0) ?? 0) ?? 0)),
      Resources: context.obj({}),
      ToUnicode: context.register(context.flateStream(unicode)),
      FontDescriptor: context.register(
        context.obj({ Type: 'FontDescriptor', FontName: 'DrawnSerif', Flags: 34, FontWeight: stated, ItalicAngle: 0, FontBBox: [0, -em, em, em] }),
      ),
    }),
  );
  const codes = Array.from(SHOWN, (character) => (97 + LETTERS.indexOf(character)).toString(16)).join('');
  const shows = `BT /F1 24 Tf 72 700 Td <${codes}> Tj ET`;
  if (inForm) {
    // THE SAME WORD DRAWN BY A FORM (ADR-0269), so the edit takes the form's own path through the writer.
    const form = context.register(
      context.flateStream(shows, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: { Font: { F1: font } } }),
    );
    page.node.setXObject(PDFName.of('Fm1'), form);
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream('q /Fm1 Do Q')));
  } else {
    page.node.setFontDictionary(PDFName.of('F1'), font);
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(shows)));
  }
  return document.save();
}

/** The page's one run, as PDFium reads it: the one text object, `minimum`. */
const READ = { textObjects: [0], runs: [{ index: 0, members: [0], text: SHOWN, left: 72, right: 200, bottom: 694, top: 718 }] };

const typed = (marks?: { from: number; to: number; set: { bold: boolean } }[]): CommandOfKind<'editTextOperators'> => ({
  kind: 'editTextOperators',
  page: 0,
  ...blockEditOf([{ lines: [[0]], soft: [false], text: `${SHOWN} nil`, ...(marks === undefined ? {} : { marks }) }]),
  fit: 'reflow',
  version: asDocVersion(1),
});

/** The faces the edit added to the page, by their names. */
async function written(bytes: Uint8Array, command: CommandOfKind<'editTextOperators'>): Promise<string[]> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applyEditTextOperators(session, command, READ);
    return await withDocument(session, (document) => {
      const names: string[] = [];
      document
        .findPage(0)
        .get('Resources')
        .get('Font')
        .forEach((value: PDFObject, key: string | number) => {
          if (String(key) === 'F1') return;
          const font = value.resolve();
          const descendant = font.get('DescendantFonts');
          const named = (descendant.isNull() ? font : descendant.get(0).resolve()).get('BaseFont');
          names.push(named.isNull() ? '' : named.asName());
        });
      return names;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('a word typed beside drawn letters takes the weight they LOOK (ADR-0176, 2026-10-26)', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  it('letters drawn regular and stated 700: the new word is set regular, not bold', async () => {
    const names = await written(await drawnPage('Regular', 700), typed());
    expect(names.some((name) => name.endsWith('Tinos-Regular')), JSON.stringify(names)).toBe(true);
    expect(names.some((name) => name.endsWith('Tinos-Bold')), JSON.stringify(names)).toBe(false);
  });

  it('CONTROL: letters drawn bold and stated 400: the new word is set bold, so the number is not what decided', async () => {
    const names = await written(await drawnPage('Bold', 400), typed());
    expect(names.some((name) => name.endsWith('Tinos-Bold')), JSON.stringify(names)).toBe(true);
  });

  it('Bold turned OFF on the typed word beside bold letters: it is written regular', async () => {
    const names = await written(await drawnPage('Bold', 400), typed([{ from: SHOWN.length + 1, to: SHOWN.length + 4, set: { bold: false } }]));
    expect(names.some((name) => name.endsWith('Tinos-Regular')), JSON.stringify(names)).toBe(true);
    expect(names.some((name) => name.endsWith('Tinos-Bold')), JSON.stringify(names)).toBe(false);
  });

  it('Bold turned OFF on the DRAWN word itself: it is written in the regular face and reads back regular (the owner’s M1 test)', async () => {
    const off = [{ from: 0, to: SHOWN.length, set: { bold: false } }];
    const command: CommandOfKind<'editTextOperators'> = {
      kind: 'editTextOperators',
      page: 0,
      ...blockEditOf([{ lines: [[0]], soft: [false], text: SHOWN, marks: off }]),
      fit: 'reflow',
      version: asDocVersion(1),
    };
    const session = await mupdfWriter.open(await drawnPage('Bold', 400));
    try {
      await applyEditTextOperators(session, command, READ);
      const read = await readTextFaces(session, 0);
      // EVERY FONT THE PAGE STILL SHOWS TEXT IN, with the weight the read reports for it: the editor's Bold reads this.
      const shown = [...new Set(read.ranges.map((range) => range.font))].map((at) => read.fonts[at]);
      expect(shown.length, JSON.stringify(read)).toBeGreaterThan(0);
      expect(
        shown.every((font) => font !== undefined && (font.weight ?? 400) < 600),
        JSON.stringify(shown),
      ).toBe(true);
      // AND WRITTEN IN THE REGULAR FACE, not left in the drawn bold letters.
      expect(shown.some((font) => font?.face?.endsWith('Tinos-Regular') === true || font?.face === 'Tinos'), JSON.stringify(shown)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('Bold turned OFF on the drawn word INSIDE A FORM: it is written and reads back regular, as on the page', async () => {
    const command: CommandOfKind<'editTextOperators'> = {
      kind: 'editTextOperators',
      page: 0,
      ...blockEditOf([{ lines: [[0]], soft: [false], text: SHOWN, marks: [{ from: 0, to: SHOWN.length, set: { bold: false } }] }]),
      fit: 'reflow',
      version: asDocVersion(1),
      form: [{ name: 'Fm1', occurrence: 0 }],
    };
    const session = await mupdfWriter.open(await drawnPage('Bold', 400, true));
    try {
      // THE OLD CODE THREW HERE: the form's one faceless write judged Bold by the stated 400 and answered *unchanged*.
      await applyEditTextOperators(session, command, READ);
      // THE FONTS THE PAGE'S FORMS NOW NAME, by their names: the page-faces read does not look inside a form.
      const names = await withDocument(session, (document) => {
        const found: string[] = [];
        document
          .findPage(0)
          .get('Resources')
          .get('XObject')
          .forEach((form: PDFObject) => {
            form
              .resolve()
              .get('Resources')
              .get('Font')
              .forEach((value: PDFObject, key: string | number) => {
                if (String(key) === 'F1') return;
                const font = value.resolve();
                const descendant = font.get('DescendantFonts');
                const named = (descendant.isNull() ? font : descendant.get(0).resolve()).get('BaseFont');
                found.push(named.isNull() ? '' : named.asName());
              });
          });
        return found;
      });
      expect(names.some((name) => name.endsWith('Tinos-Regular')), JSON.stringify(names)).toBe(true);
      expect(names.some((name) => name.endsWith('Tinos-Bold')), JSON.stringify(names)).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a FONT chosen for the drawn word is written in that family, never left in the drawn letters (the owner’s M1 test)', async () => {
    const command: CommandOfKind<'editTextOperators'> = {
      kind: 'editTextOperators',
      page: 0,
      ...blockEditOf([{ lines: [[0]], soft: [false], text: SHOWN, marks: [{ from: 0, to: SHOWN.length, set: { family: 'Arimo' } }] }]),
      fit: 'reflow',
      version: asDocVersion(1),
    };
    const names = await written(await drawnPage('Regular', 400), command);
    expect(names.some((name) => name.includes('Arimo')), JSON.stringify(names)).toBe(true);
  });

  it('CONTROL: Bold turned ON beside regular letters: it is written bold, so the person’s choice is what is set', async () => {
    const names = await written(await drawnPage('Regular', 700), typed([{ from: SHOWN.length + 1, to: SHOWN.length + 4, set: { bold: true } }]));
    expect(names.some((name) => name.endsWith('Tinos-Bold')), JSON.stringify(names)).toBe(true);
  });

  it('the page read tells the editor the weight a word is SET at, so it draws and presses Bold as it is written', async () => {
    expect(await readWeight(await drawnPage('Regular', 700))).toBeLessThan(600);
    expect(await readWeight(await drawnPage('Bold', 400))).toBeGreaterThanOrEqual(600);
  });
});

describe('the page read with no faces given', () => {
  it('CONTROL: says the descriptor’s weight, as a write with no faces sets by it', async () => {
    bindEditFaces(null);
    expect(await readWeight(await drawnPage('Regular', 700))).toBe(700);
  });
});

/** The weight the page read reports for the drawn font: what `namedByDescriptor` makes the editor's bold of. */
async function readWeight(bytes: Uint8Array): Promise<number | null | undefined> {
  const session = await mupdfWriter.open(bytes);
  try {
    return (await readTextFaces(session, 0)).fonts[0]?.weight;
  } finally {
    await mupdfWriter.close(session);
  }
}
