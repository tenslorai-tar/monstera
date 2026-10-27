import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { blockFaceRunsOf } from './blockFaceAnswer.js';
import { readBlockFaces } from './blockFaces.js';
import { runsOfContent as runsOf } from './contentRunsFixture.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { editOperators, pageFontsAsRead } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { loadStandardFonts, pageFonts } from './pageFonts.js';
import { OperatorFaceSet } from './operatorFaces.js';
import { editFaces } from './editFaces.js';
import { joinedContent } from './textOperators.js';

/**
 * The read on open (`blockFaces.ts`, ADR-0271 section 5) on a page of two lines: one in Helvetica, which the page names
 * and does not embed, and one in a Type 3 font whose letters are drawn. Each answer is held against the writer's own:
 * the face the read says a new word goes to is the face the operator writer sets one in.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The page: a Helvetica line, then a line in a Type 3 font drawing every lower-case letter and the space. */
async function fixture(): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([300, 200]);
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const context = document.context;
  const procs: Record<string, ReturnType<typeof context.register>> = {};
  for (const letter of LETTERS) procs[letter] = context.register(context.flateStream('600 0 0 0 550 700 d1 50 0 450 700 re f'));
  procs['space'] = context.register(context.flateStream('500 0 d0'));
  const drawn = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type3',
      FontBBox: [0, 0, 550, 700],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: procs,
      Encoding: { Type: 'Encoding', Differences: [32, 'space', 97, ...Array.from(LETTERS)] },
      FirstChar: 32,
      LastChar: 122,
      Widths: Array.from({ length: 91 }, (_, at) => (at === 0 ? 500 : at >= 65 ? 600 : 0)),
      Resources: {},
      // ITS TEXT NAMED, so the drawn font CAN carry a new word of these letters: only the font rule keeps one out of it.
      ToUnicode: context.register(
        context.stream(
          [
            '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
            '/CMapName /Drawn def /CMapType 2 def',
            '1 begincodespacerange <00> <FF> endcodespacerange',
            '2 beginbfrange <20> <20> <0020> <61> <7A> <0061> endbfrange',
            'endcmap CMapName currentdict /CMap defineresource pop end end',
          ].join('\n'),
        ),
      ),
    }),
  );
  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: helvetica.ref, T3: drawn } }));
  const content = ['BT /F1 12 Tf 1 0 0 1 40 150 Tm (plain words here) Tj ET', 'BT /T3 12 Tf 1 0 0 1 40 120 Tm (drawn words here) Tj ET'].join('\n');
  page.node.set(PDFName.of('Contents'), context.register(context.stream(content)));
  return document.save({ useObjectStreams: false });
}

describe('the read on open: what the writer does with a new word in each of a block’s fonts', () => {
  beforeAll(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterAll(() => {
    bindEditFaces(null);
  });

  it('says an ordinary font may carry a new word and a drawn one may not, and names a face for each, its family first among the nearest', async () => {
    const session = await mupdfWriter.open(await fixture());
    try {
      const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      const answer = await readBlockFaces(session, { page: 0 }, blockFaceRunsOf(runsOf(content), [0, 1]));
      expect(answer.runs).toStrictEqual([0, 1]);
      const [plain, drawn] = answer.fonts;
      expect(plain?.own).toBe(true);
      // CONTROL: the drawn font is told apart, so the first line's answer is the font's and not every font's.
      expect(drawn?.own).toBe(false);
      for (const font of [plain, drawn]) {
        expect(font?.chosen).not.toBeNull();
        expect(font?.candidates[0]).toStrictEqual(font?.chosen);
        expect(font?.candidates.length).toBeLessThanOrEqual(5);
        expect(new Set(font?.candidates.map((each) => each.family)).size).toBe(font?.candidates.length);
        expect(font?.chosen?.styles.length).toBeGreaterThan(0);
      }
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('names the face the writer then sets a new word in, in the drawn line, and the writer never sets it in the drawn font', async () => {
    const session = await mupdfWriter.open(await fixture());
    try {
      const content = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
      const read = runsOf(content);
      const answer = await readBlockFaces(session, { page: 0 }, blockFaceRunsOf(read, [1]));
      const standard = await loadStandardFonts();
      const written = await withDocument(session, (document) => {
        const leaf = document.findPage(0);
        const fonts = pageFontsAsRead(pageFonts(leaf, standard), content, read);
        const source = editFaces();
        if (source === null) throw new Error('the faces were bound and read as none');
        const faces = new OperatorFaceSet(document, source, fonts);
        // A NEW WORD in the drawn line, whose letters the drawn font has every one of: only the rule keeps it out.
        const made = editOperators(content, fonts, read, [{ lines: [[1]], soft: [false], text: 'drawn zebra words here' }], faces.faces);
        if (!made.ok) throw new Error(`refused: ${JSON.stringify(made.error)}`);
        return {
          text: new TextDecoder('latin1').decode(made.value.content),
          added: [...faces.pageFonts.keys()],
          faces: [...faces.pageFonts.values()].map((font) => font.face),
          weights: [...faces.pageFonts.values()].map((font) => font.weight),
        };
      });
      // THE NEW WORD IS IN A FONT THE EDIT ADDED, and the words the line already said stay in the drawn one.
      expect(written.added.length).toBe(1);
      expect(written.text).toMatch(new RegExp(`/${written.added[0] ?? 'none'} \\d+(\\.\\d+)? Tf`, 'u'));
      expect(written.text).toMatch(/\/T3 12 Tf/u);
      // AND IT IS THE FACE THE READ NAMED: the editor draws a new word in the face it will be written in.
      expect(answer.fonts[0]?.own).toBe(false);
      expect(written.faces).toStrictEqual([answer.fonts[0]?.chosen?.family]);
      // AT THE WEIGHT IT NAMED, which is what separates asking about THIS font from asking about none: every font asked
      // answers the same family here, and only the drawn font's stems make it bold (the stage audit's ZZZZZZZZ-7).
      expect(written.weights).toStrictEqual([answer.fonts[0]?.chosen?.weight]);
      expect(answer.fonts[0]?.chosen?.weight).toBeGreaterThanOrEqual(600);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
