import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { type CommandOfKind, type EditedBlock, blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { blockFaceRunsOf } from './blockFaceAnswer.js';
import { readBlockFaces } from './blockFaces.js';
import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { runsOfContent as runsOf } from './contentRunsFixture.js';
import { bindEditFaces, bindEditFolders, loadEditFaces } from './editFaces.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { loadStandardFonts, pageFonts } from './pageFonts.js';
import { rasterisePageRgba } from './pageImages.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent } from './textOperators.js';

/**
 * WORDS THAT PAINT NOTHING OVER SOMETHING THAT SHOWS, edited through the operator writer (ADR-0289). The shape is the corpus
 * page's: a blue ground, the words drawn as white shapes, and over them a Type 3 font whose letters are all empty, so that
 * the words can be selected. The rule must find them whatever drew the white and whichever way they paint nothing, cover
 * the white with the blue there, and draw the new words white. A page where nothing shows under them keeps them unseen.
 *
 * `runsOfContent` boxes each run from a fifth of the size below its baseline to four fifths above, and half the size for each
 * letter, and the white bars are drawn in that box: what the page shows is known to the pixel.
 */

const WIDTH = 300;
const HEIGHT = 200;
const SIZE = 12;
const LEFT = 40;
const BLUE = [0, 120, 212] as const;
const WHITE = [255, 255, 255] as const;
const LINES = [
  { text: 'kept heading words', baseline: 150 },
  { text: 'held in the church hall', baseline: 120 },
] as const;
const [KEPT, EDITED] = LINES;

/** A line's box as `runsOfContent` gives it. */
const boxOf = (line: (typeof LINES)[number]): { left: number; right: number; bottom: number; top: number } => ({
  left: LEFT,
  right: LEFT + 0.5 * SIZE * line.text.length,
  bottom: line.baseline - 0.2 * SIZE,
  top: line.baseline + 0.8 * SIZE,
});

const rg = (colour: readonly [number, number, number]): string => `${colour.map((channel) => String(channel / 255)).join(' ')} rg`;
const GROUND = `q ${rg(BLUE)} 0 0 ${String(WIDTH)} ${String(HEIGHT)} re f Q`;
/** The words as shapes: a white bar in each line's box, its middle band, so a soft edge is not in question. */
const DRAWN_WORDS = LINES.map((line) => {
  const box = boxOf(line);
  return `q ${rg(WHITE)} ${String(box.left)} ${String(line.baseline)} ${String(box.right - box.left)} 7 re f Q`;
}).join('\n');
const textIn = (font: string, mode = ''): string =>
  LINES.map((line) => `BT 0 0 0 rg ${mode} /${font} ${String(SIZE)} Tf 1 0 0 1 ${String(LEFT)} ${String(line.baseline)} Tm (${line.text}) Tj ET`).join('\n');

/** A page holding `content`, with Helvetica as `F1`, a Type 3 font of empty letters as `T3`, and one of real letters as `R3`. */
async function fixture(content: string): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([WIDTH, HEIGHT]);
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const context = document.context;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const type3 = (body: string): ReturnType<typeof context.register> => {
    const procs: Record<string, ReturnType<typeof context.register>> = { space: context.register(context.flateStream('500 0 d0')) };
    for (const letter of letters) procs[letter] = context.register(context.flateStream(body));
    return context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: [0, 0, 550, 700],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: procs,
        Encoding: { Type: 'Encoding', Differences: [32, 'space', 97, ...Array.from(letters)] },
        FirstChar: 32,
        LastChar: 122,
        Widths: Array.from({ length: 91 }, (_, at) => (at === 0 ? 500 : at >= 65 ? 500 : 0)),
        Resources: {},
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
  };
  page.node.set(
    PDFName.of('Resources'),
    context.obj({
      Font: {
        F1: helvetica.ref,
        T3: type3('500 0 0 0 450 700 d1'),
        R3: type3('500 0 0 0 450 700 d1 50 0 400 700 re f'),
        // LETTERS THAT ARE IMAGE MASKS, a bitmap font, whose procedures name no path at all.
        M3: type3('500 0 0 0 450 700 d1 q 450 0 0 700 0 0 cm BI /W 1 /H 1 /IM true /BPC 1 ID x EI Q'),
      },
    }),
  );
  page.node.set(PDFName.of('Contents'), context.register(context.stream(content)));
  return document.save({ useObjectStreams: false });
}

interface Edited {
  readonly written: string;
  /** The page after the edit, at a pixel a point: the colour at a point of the page, y up. */
  readonly at: (x: number, y: number) => readonly [number, number, number];
  /** The same page after a save and a reopen, in the same terms. */
  readonly reopened: (x: number, y: number) => readonly [number, number, number];
  /** The page before the edit, in the same terms. */
  readonly before: (x: number, y: number) => readonly [number, number, number];
}

const reader =
  (image: { readonly rgba: Uint8ClampedArray | Uint8Array; readonly width: number }) =>
  (x: number, y: number): readonly [number, number, number] => {
    const at = (Math.round(HEIGHT - y) * image.width + Math.round(x)) * 4;
    return [image.rgba[at] ?? -1, image.rgba[at + 1] ?? -1, image.rgba[at + 2] ?? -1];
  };

/** The second line edited to `text`. */
async function edited(content: string, text: string, change: Partial<EditedBlock> = {}): Promise<Edited> {
  const session = await mupdfWriter.open(await fixture(content));
  try {
    const original = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    const before = reader(await rasterisePageRgba(session, 0, 1));
    const block: EditedBlock = { lines: [[1]], soft: [false], text, ...change };
    const command: CommandOfKind<'editTextOperators'> = { kind: 'editTextOperators', page: 0, ...blockEditOf([block]), fit: 'reflow', version: asDocVersion(1) };
    await applyEditTextOperators(session, command, runsOf(original));
    const written = await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
    const at = reader(await rasterisePageRgba(session, 0, 1));
    const saved = await mupdfWriter.serialise(session);
    const again = await mupdfWriter.open(saved);
    try {
      const reopened = reader(await rasterisePageRgba(again, 0, 1));
      return { written, at, reopened, before };
    } finally {
      await mupdfWriter.close(again);
    }
  } finally {
    await mupdfWriter.close(session);
  }
}

type Reader = Edited['at'];
const near = (a: readonly number[], b: readonly number[], by = 3): boolean => a.every((channel, at) => Math.abs(channel - (b[at] ?? 0)) <= by);
/** Each distinct colour across a stretch of the page, keyed so a case can ask what is there. */
function coloursIn(read: Reader, box: { left: number; right: number; bottom: number; top: number }): (readonly [number, number, number])[] {
  const found = new Map<string, readonly [number, number, number]>();
  for (let y = Math.ceil(box.bottom); y <= Math.floor(box.top); y += 1) {
    for (let x = Math.ceil(box.left); x <= Math.floor(box.right); x += 1) {
      const colour = read(x, y);
      found.set(colour.join(), colour);
    }
  }
  return [...found.values()];
}

/** How many times the content says white beyond the fixture's own bars, each of which says it once: the writer's own. */
const whitesSaidPastTheFixture = (written: string): number => (written.match(/\b1 1 1 rg\b/gu) ?? []).length - LINES.length;

const oldLine = boxOf(EDITED);
const SHORT = 'held in hall';
/** Past where the shorter new line ends, inside the old white bar: only the cover can change it. */
const pastTheWords = { left: LEFT + 0.5 * SIZE * SHORT.length + 12, right: oldLine.right - 2, bottom: EDITED.baseline + 1, top: EDITED.baseline + 6 };
/** Where the new line stands, the same band. */
const underTheWords = { left: LEFT + 1, right: LEFT + 40, bottom: EDITED.baseline - 1, top: EDITED.baseline + 8 };

describe('words that paint nothing over something that shows (ADR-0289)', () => {
  // THE CATALOGUE READ ONCE HERE, which a first case would otherwise pay for inside its own time.
  beforeAll(async () => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
    await loadEditFaces();
  }, 60_000);
  afterAll(() => {
    bindEditFaces(null);
  });

  const EMPTY_LETTERS = `${GROUND}\n${DRAWN_WORDS}\n${textIn('T3')}`;

  it('a font says its letters paint nothing only where every one of them does: a real font and a bitmap font do not', async () => {
    const session = await mupdfWriter.open(await fixture(GROUND));
    try {
      const standard = await loadStandardFonts();
      const fonts = await withDocument(session, (document) => pageFonts(document.findPage(0), standard));
      expect(['T3', 'R3', 'M3', 'F1'].map((name) => fonts.get(name)?.paintsNothing)).toStrictEqual([true, undefined, undefined, undefined]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the read on open says the colour the writer will draw, so the editor draws it too; and says none over nothing that shows', async () => {
    const inkFor = async (content: string): Promise<unknown> => {
      const session = await mupdfWriter.open(await fixture(content));
      try {
        const read = await withDocument(session, (document) => runsOf(joinedContent(pageContentStreams(document.findPage(0)))));
        const answer = await readBlockFaces(session, { page: 0 }, blockFaceRunsOf(read, [1]));
        return answer.fonts[0]?.ink;
      } finally {
        await mupdfWriter.close(session);
      }
    };
    expect(await inkFor(EMPTY_LETTERS)).toStrictEqual({ r: 255, g: 255, b: 255 });
    expect(await inkFor(`${GROUND}\n${textIn('T3')}`)).toBeUndefined();
    expect(await inkFor(`${GROUND}\n${DRAWN_WORDS}\n${textIn('R3')}`)).toBeUndefined();
  });

  it('FIXTURE: the white words are there before the edit, and the font of empty letters paints no black on them', async () => {
    const { before } = await edited(EMPTY_LETTERS, SHORT);
    expect(near(before(pastTheWords.left, EDITED.baseline + 3), WHITE)).toBe(true);
    expect(coloursIn(before, underTheWords).every((colour) => near(colour, WHITE) || near(colour, BLUE, 40))).toBe(true);
  });

  it('covers the drawn words with the blue that is there, and draws the new words WHITE, not the black in force in the content', async () => {
    const { at, written } = await edited(EMPTY_LETTERS, SHORT);
    expect(coloursIn(at, pastTheWords).every((colour) => near(colour, BLUE))).toBe(true);
    const under = coloursIn(at, underTheWords);
    expect(under.some((colour) => near(colour, WHITE, 20))).toBe(true);
    expect(under.some((colour) => near(colour, BLUE, 10))).toBe(true);
    // NO BLACK, the defect itself: the darkest pixel across the new words is no darker than the blue's own red channel allows.
    expect(under.every((colour) => colour[1] >= BLUE[1] - 10)).toBe(true);
    expect(whitesSaidPastTheFixture(written)).toBeGreaterThan(0);
  });

  it('holds after a save and a reopen', async () => {
    const { reopened } = await edited(EMPTY_LETTERS, SHORT);
    expect(coloursIn(reopened, pastTheWords).every((colour) => near(colour, BLUE))).toBe(true);
    const under = coloursIn(reopened, underTheWords);
    expect(under.some((colour) => near(colour, WHITE, 20))).toBe(true);
    expect(under.every((colour) => colour[1] >= BLUE[1] - 10)).toBe(true);
  });

  it('sets the words it kept in another font as well: left in the empty font they would be drawn by nothing', async () => {
    const { written, at } = await edited(EMPTY_LETTERS, SHORT);
    const line = written.slice(written.lastIndexOf('1 1 1 rg'));
    expect(line.slice(0, line.indexOf('ET'))).not.toMatch(/\/T3\b/u);
    expect(line.slice(0, line.indexOf('ET'))).toMatch(/\bTf\b/u);
    // THE KEPT WORDS' OWN PLACE: `held` is the page's own word and it is white on blue, with both colours across it.
    expect(coloursIn(at, { left: LEFT, right: LEFT + 20, bottom: EDITED.baseline, top: EDITED.baseline + 7 }).some((colour) => near(colour, BLUE, 20))).toBe(true);
  });

  it('a colour the person chose wins over the colour of the words', async () => {
    const { written } = await edited(EMPTY_LETTERS, SHORT, { marks: [{ from: 0, to: SHORT.length, set: { colour: { r: 255, g: 0, b: 0 } } }] });
    expect(written).toMatch(/\b1 0 0 rg\b/u);
    expect(whitesSaidPastTheFixture(written)).toBe(0);
  });

  it('CONTROL: the line nobody edited keeps its bytes and its pixels', async () => {
    const { written, at, before } = await edited(EMPTY_LETTERS, SHORT);
    expect(written).toContain(`/T3 12 Tf 1 0 0 1 40 ${String(KEPT.baseline)} Tm (${KEPT.text}) Tj ET`);
    const kept = boxOf(KEPT);
    for (let y = Math.ceil(kept.bottom); y <= Math.floor(kept.top); y += 1) {
      for (let x = Math.ceil(kept.left); x <= Math.floor(kept.right); x += 1) expect(at(x, y)).toStrictEqual(before(x, y));
    }
  });

  it('CONTROL: empty letters with nothing under them stay unseen: nothing covered, nothing drawn, whatever was typed', async () => {
    const { written, at } = await edited(`${GROUND}\n${textIn('T3')}`, 'held in the hall zebra');
    expect(coloursIn(at, { left: oldLine.left, right: oldLine.right + 20, bottom: oldLine.bottom, top: oldLine.top }).every((colour) => near(colour, BLUE))).toBe(true);
    expect(written).not.toMatch(/\b1 1 1 rg\b/u);
    expect(written.match(/\bre f\b/gu) ?? []).toHaveLength(1);
  });

  it('CONTROL: real letters over the same drawing are not this case: nothing is covered and the bars stay', async () => {
    const { written, at } = await edited(`${GROUND}\n${DRAWN_WORDS}\n${textIn('R3')}`, SHORT);
    expect(written.match(/\bre f\b/gu) ?? []).toHaveLength(LINES.length + 1);
    expect(coloursIn(at, pastTheWords).every((colour) => near(colour, WHITE))).toBe(true);
  });

  it('RENDER MODE 3 over a DRAWING is the same rule, with no picture on the page', async () => {
    const { at, written } = await edited(`${GROUND}\n${DRAWN_WORDS}\n${textIn('F1', '3 Tr')}`, SHORT);
    expect(coloursIn(at, pastTheWords).every((colour) => near(colour, BLUE))).toBe(true);
    expect(written).toMatch(/\b0 Tr\b/u);
    expect(whitesSaidPastTheFixture(written)).toBeGreaterThan(0);
  });

  it('CONTROL: render mode 3 over a page filled white stays invisible: a rectangle under it is not words a person sees', async () => {
    const fill = `q ${rg(WHITE)} 0 0 ${String(WIDTH)} ${String(HEIGHT)} re f Q`;
    const { written, at } = await edited(`${fill}\n${textIn('F1', '3 Tr')}`, SHORT);
    expect(written).not.toMatch(/\b0 Tr\b/u);
    expect(written.match(/\bre f\b/gu) ?? []).toHaveLength(1);
    expect(coloursIn(at, underTheWords).every((colour) => near(colour, WHITE))).toBe(true);
  });

  it('an uneven ground is covered by what is there at each place: the cover shades with it, and leaves no patch', async () => {
    // BLUE GOING TO A DARKER BLUE across the page, in one-point strips, the corpus page's own shape on an uneven ground.
    const strips = Array.from({ length: WIDTH }, (_, x) => `q 0 ${String((120 - (x / WIDTH) * 60) / 255)} ${String((212 - (x / WIDTH) * 90) / 255)} rg ${String(x)} 0 1 ${String(HEIGHT)} re f Q`).join('\n');
    const { at, before } = await edited(`${strips}\n${DRAWN_WORDS}\n${textIn('T3')}`, SHORT);
    // ACROSS THE COVER, each pixel within reach of the ground above the line at the same place, which nothing edited.
    for (let x = Math.ceil(pastTheWords.left); x <= Math.floor(pastTheWords.right); x += 1) {
      const ground = before(x, EDITED.baseline + 15);
      expect(near(at(x, EDITED.baseline + 3), ground, 14)).toBe(true);
    }
  });
});
