import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { type CommandOfKind, type EditedBlock, blockEditOf } from '@monstera/contract/host';
import { asDocVersion } from '@monstera/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bundledFontsFolder, readCatalogueOnce } from './bundledFontsForTests.js';
import { bindEditFaces, bindEditFolders } from './editFaces.js';
import { GLYPHLESS_FONT_NAME } from './glyphlessFontName.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyOcrPage } from './ocrTextLayer.js';
import type { RecognisedPage } from './ocrRecognise.js';
import type { PageRun, PageRuns } from './operatorEdit.js';
import { pageContentStreams } from './pageContent.js';
import { applyEditTextOperators } from './textOperatorEdit.js';
import { joinedContent, showOperators, textObjectCount } from './textOperators.js';

/**
 * A scan's recognised paragraph, edited by one word, written through the operator writer with the REAL recognition layer
 * under it (`applyOcrPage`): the owner's list of 2026-11-19, item 3. Editing one word of the guide's scan re-laid the
 * whole paragraph in tiny text of mixed sizes over the scan, and a one-word block was drawn in a small typewriter face.
 *
 * Three mechanisms, each with its case here, each red on the code before the fix:
 * 1. The words to be seen were set in the recognition layer's own font, a CID font with no program named only by
 *    `Identity`: a reader draws it in whatever substitute it has (MuPDF: a fixed-pitch face). It now paints nothing for
 *    that purpose (`pageFonts.ts`), and the words go to the closest normal font.
 * 2. They kept each recognised word's size and squeeze, which describe that font (its box height; its width over one em a
 *    letter): a size per word and 29 to 56 per cent of the width. Now one size for the line, read from the words that
 *    reach both up and down, and no squeeze.
 * 3. The recognition font says it is fixed-pitch, so the paragraph was read as code and never wrapped: one line past the
 *    block's edge. A scan's words are no longer code.
 * 4. The block wrapped at the scan's ink width, which the closest normal face overruns by a fraction of a point on the
 *    longest line, so its last word wrapped and every line after it moved for an edit that reached none of them. The
 *    block now wraps no shorter than its widest line as that face sets it.
 *
 * Each was confirmed by undoing it alone (2026-11-19): 1 reddens all four cases, 2 the size case and the last, 3 the wrap
 * case, 4 the last.
 *
 * The picture is grey with a dark bar where each recognised word is, so the writer reads ink under every word.
 */

const PAPER = 225;
const INK = 40;
const WIDTH = 612;
const HEIGHT = 792;
const SIZE = 10.5;
const LEFT = 72;
const LINES = [
  'The figures on this page compare the year with the one before for every building.',
  'Each building is reported separately so that changes in one are not hidden.',
  'Notes below the chart say where a figure was estimated rather than metered.',
] as const;
const BASELINES = [600, 585, 570];
/** The block's right edge: the longest line's end, as Helvetica sets it. */
let RIGHT = 0;

async function recognition(): Promise<RecognisedPage> {
  const measure = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const lines = LINES.map((text, row) => {
    const baseline = BASELINES[row] ?? 0;
    let at = LEFT;
    const words = text.split(' ').map((word) => {
      const width = measure.widthOfTextAtSize(word, SIZE);
      // A WORD'S BOX AS A RECOGNISER GIVES IT: from below its descenders to above its capitals, whatever letters it has.
      const box: [number, number, number, number] = [at, baseline - 0.21 * SIZE, at + width, baseline + 0.72 * SIZE];
      at += width + measure.widthOfTextAtSize(' ', SIZE);
      return { text: word, box, confidence: 95 };
    });
    RIGHT = Math.max(RIGHT, at);
    const first = words[0]?.box ?? [0, 0, 0, 0];
    const last = words.at(-1)?.box ?? first;
    return { text, box: [first[0], first[1], last[2], last[3]] as [number, number, number, number], words };
  });
  return { lines, confidence: 95, languages: ['eng'] };
}

/** The scan: a picture with a dark bar under every recognised word, and the recognition layer over it. */
async function recognisedScan(): Promise<{ readonly bytes: Uint8Array; readonly recognised: RecognisedPage }> {
  const recognised = await recognition();
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([WIDTH, HEIGHT]);
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(PAPER);
  for (const word of recognised.lines.flatMap((line) => line.words)) {
    const [x0, y0, x1, y1] = word.box;
    for (let y = Math.round(HEIGHT - y1 + 1); y < Math.round(HEIGHT - y0 - 1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) pixels[y * WIDTH + x] = INK;
    }
  }
  const context = document.context;
  const picture = context.register(
    context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: WIDTH, Height: HEIGHT, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  page.node.set(PDFName.of('Resources'), context.obj({ XObject: { Im1: picture } }));
  page.node.set(PDFName.of('Contents'), context.register(context.stream(`q ${String(WIDTH)} 0 0 ${String(HEIGHT)} 0 0 cm /Im1 Do Q`)));
  const scan = await document.save({ useObjectStreams: false });
  const bytes = await applyOcrPage(scan, { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' }, recognised);
  return { bytes, recognised };
}

/**
 * PDFium's reading of the layer, as the writer is handed it: each recognised word one run, boxed where it was recognised,
 * holding the word's own show and the space the layer writes after it (every word but a line's last).
 */
function runsOf(content: Uint8Array, recognised: RecognisedPage): { readonly runs: PageRuns; readonly lines: number[][] } {
  const shown = showOperators(content).filter((op) => op.object !== null);
  const spaces = recognised.lines.reduce((sum, line) => sum + line.words.length - 1, 0);
  const words = recognised.lines.reduce((sum, line) => sum + line.words.length, 0);
  // EVERY OPERATOR ACCOUNTED FOR: a word each, and a space after all but each line's last.
  expect(shown).toHaveLength(words + spaces);
  let next = 0;
  const runs: PageRun[] = [];
  const lines = recognised.lines.map((line) =>
    line.words.map((word, at) => {
      const own = shown[next++]?.object ?? -1;
      const last = at === line.words.length - 1;
      const members = last ? [own] : [own, shown[next++]?.object ?? -1];
      const [left, bottom, right, top] = word.box;
      // FIXED-PITCH, as PDFium's `isMono` reads the layer's font: its `/Flags 5` carries the fixed-pitch bit.
      runs.push({ index: own, members, text: last ? word.text : `${word.text} `, left, right, bottom, top, fixedPitch: true });
      return own;
    }),
  );
  return { runs: { textObjects: Array.from({ length: textObjectCount(shown) }, (_, at) => at), runs }, lines };
}

/** The paragraph edited to `text`; the page's content after, as written. */
async function edited(text: string): Promise<string> {
  const { bytes, recognised } = await recognisedScan();
  const session = await mupdfWriter.open(bytes);
  try {
    const before = await withDocument(session, (document) => joinedContent(pageContentStreams(document.findPage(0))));
    const { runs, lines } = runsOf(before, recognised);
    const block: EditedBlock = { lines, soft: [true, true, false], text };
    const command: CommandOfKind<'editTextOperators'> = { kind: 'editTextOperators', page: 0, ...blockEditOf([block]), fit: 'reflow', version: asDocVersion(1) };
    await applyEditTextOperators(session, command, runs);
    return await withDocument(session, (document) => new TextDecoder('latin1').decode(joinedContent(pageContentStreams(document.findPage(0)))));
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Every text object the edit drew VISIBLE (`0 Tr`), with the font, size and squeeze in force at each of its words. */
function visibleSettings(written: string): { readonly font: string; readonly size: number; readonly scale: number; readonly y: number; readonly x: number }[] {
  const found: { font: string; size: number; scale: number; y: number; x: number }[] = [];
  let mode = 0;
  let font = '';
  let size = 0;
  let scale = 100;
  const tokens = written.split(/\s+/u);
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === 'BT') {
      mode = 0;
      scale = 100;
    } else if (token === 'Tr') mode = Number(tokens[at - 1]);
    else if (token === 'Tz') scale = Number(tokens[at - 1]);
    else if (token === 'Tf') {
      font = tokens[at - 2] ?? '';
      size = Number(tokens[at - 1]);
    } else if (token === 'Tm' && mode === 0) found.push({ font, size, scale, x: Number(tokens[at - 2]), y: Number(tokens[at - 1]) });
  }
  return found;
}

describe('a scan’s recognised paragraph, one word edited (the owner’s list of 2026-11-19, item 3)', () => {
  beforeEach(() => {
    bindEditFolders(bundledFontsFolder(), null, readCatalogueOnce);
  });
  afterEach(() => {
    bindEditFaces(null);
  });

  const longer = [LINES[0].replace('the year', 'the season'), LINES[1], LINES[2]].join(' ');

  it('draws the words it sets in a NORMAL face, never the recognition layer’s own font', async () => {
    const written = await edited(longer);
    const seen = visibleSettings(written);
    expect(seen.length).toBeGreaterThan(0);
    // THE LAYER'S FONT is a resource named for it; a word to be seen is never set in it (mechanism 1).
    const layerFonts = [...written.matchAll(/\/(\S+) [\d.]+ Tf/gu)].map((match) => match[1]).filter((name) => name?.startsWith(GLYPHLESS_FONT_NAME));
    expect(layerFonts.length).toBeGreaterThan(0);
    for (const each of seen) expect(each.font.startsWith(`/${GLYPHLESS_FONT_NAME}`)).toBe(false);
  });

  it('sets every word of a line at ONE size, the recognised text’s, unsqueezed', async () => {
    const seen = visibleSettings(await edited(longer));
    for (const each of seen) {
      // THE RECOGNISED SIZE, within a tenth: the words' boxes reach 0.93 of it (mechanism 2).
      expect(Math.abs(each.size - SIZE)).toBeLessThan(SIZE / 10);
      expect(each.scale).toBe(100);
    }
    expect(new Set(seen.map((each) => each.size.toFixed(2))).size).toBe(1);
  });

  it('WRAPS the paragraph inside its block: no line set past its right edge, and more than one line', async () => {
    const seen = visibleSettings(await edited(longer));
    // MORE THAN ONE BASELINE: read as code it was set as one line (mechanism 3).
    expect(new Set(seen.map((each) => each.y.toFixed(1))).size).toBeGreaterThan(1);
    for (const each of seen) expect(each.x).toBeLessThan(RIGHT);
  });

  it('leaves a line the edit does not reach as recognised, invisible in the layer’s own font', async () => {
    // NO WIDER (`past` is 1.89 em in Helvetica's widths, `year` 1.945), so the first line still fits on the longest line
    // and the other two are not set again. A wider word there must wrap, which moves every line after it.
    const written = await edited([LINES[0].replace('year', 'past'), LINES[1], LINES[2]].join(' '));
    const seen = visibleSettings(written);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((each) => each.y.toFixed(1))).size).toBe(1);
    expect(written).toMatch(new RegExp(`/${GLYPHLESS_FONT_NAME}\\S* [\\d.]+ Tf`, 'u'));
  });
});
