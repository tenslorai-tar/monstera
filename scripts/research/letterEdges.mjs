// @ts-check
/**
 * Where PDFium's read places each letter of a line, against the page's own pen (item 2): the edges `drawnWordsOf`
 * carries for Edit text's caret, for Times with and without /Widths, Helvetica and Courier, on an upright page and one
 * turned a quarter.
 *
 * THE PEN is each letter's own advance summed from the line's start, as `drawText` sets them: it sets no kerning. A
 * string's width as pdf-lib measures it includes kerning pairs, and reading that as the pen put Times 3.7 pt off at
 * "Wav" (measured 2026-11-02), which is this instrument's RESOLUTION TEST: it must see that error before it reports.
 *
 * Measured 2026-11-02 on Linux, PDFium 155: every edge within 0.014 pt of the pen, in every face, upright and turned.
 *
 * Usage: node scripts/research/letterEdges.mjs
 */

import { PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from '@cantoo/pdf-lib';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { formatError } from '../lib/reportError.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
    ['packages/kernel/src/textLines.ts', 'packages/kernel/dist/textLines.js', 'tsc'],
  ],
  2,
);

const TEXT = 'Waving illicit MOMWAW tilt';
const SIZE = 12;
const LEFT = 72;
/** How far an edge may stand from the pen before it would move a caret visibly: the caret cases' tolerance. */
const TOLERANCE = 0.25;

/**
 * One file: the line drawn in `face`, its font's /Widths set or taken away, the page turned by `turn`; and PDFium's
 * worst distance from the pen, by the pen and by pdf-lib's kerned measure.
 *
 * @param {Record<string, unknown>} pdfium
 * @param {'TimesRoman' | 'Helvetica' | 'Courier'} face
 * @param {boolean} widths
 * @param {number} turn
 */
async function read(pdfium, face, widths, turn) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts[face]);
  const page = document.addPage([612, 792]);
  page.drawText(TEXT, { x: LEFT, y: 690, size: SIZE, font });
  if (turn !== 0) page.setRotation(degrees(turn));
  // THE FONT OBJECT EXISTS ONLY ONCE SAVED: loaded back, its /Widths set from the face's own advances, or taken away.
  const saved = await PDFDocument.load(await document.save());
  let has = false;
  for (const [, object] of saved.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || String(object.get(PDFName.of('Type'))) !== '/Font') continue;
    if (widths) {
      const codes = Array.from({ length: 95 }, (_, at) => at + 32);
      object.set(PDFName.of('FirstChar'), PDFNumber.of(32));
      object.set(PDFName.of('LastChar'), PDFNumber.of(126));
      object.set(PDFName.of('Widths'), saved.context.obj(codes.map((code) => font.widthOfTextAtSize(String.fromCharCode(code), 1000))));
    } else for (const key of ['Widths', 'FirstChar', 'LastChar']) object.delete(PDFName.of(key));
    has = object.get(PDFName.of('Widths')) !== undefined;
  }
  if (has !== widths) throw new Error(`the file's /Widths are ${String(has)}, asked ${String(widths)}`);
  const open = /** @type {(bytes: Uint8Array) => Promise<unknown>} */ (/** @type {{ open: Function }} */ (pdfium['pdfiumWriter']).open);
  const textRuns = /** @type {(session: unknown, page: number) => Promise<{ runs: { words?: { from: number, to: number, edges?: number[] }[] }[] }>} */ (pdfium['textRuns']);
  const session = await open(await saved.save());
  const { runs } = await textRuns(session, 0);
  const words = runs.flatMap((run) => run.words ?? []);
  if (words.length === 0) throw new Error(`${face}: PDFium placed no words`);
  /** @param {number} upTo */
  const pen = (upTo) => LEFT + Array.from(TEXT.slice(0, upTo)).reduce((sum, letter) => sum + font.widthOfTextAtSize(letter, SIZE), 0);
  /** @param {number} upTo */
  const kerned = (upTo) => LEFT + font.widthOfTextAtSize(TEXT.slice(0, upTo), SIZE);
  let byPen = 0;
  let byKerned = 0;
  let edges = 0;
  for (const word of words) {
    if (word.edges === undefined) throw new Error(`${face}: a word without edges`);
    for (let at = 0; at <= word.to - word.from; at += 1) {
      const edge = word.edges[at] ?? Number.NaN;
      byPen = Math.max(byPen, Math.abs(edge - pen(word.from + at)));
      byKerned = Math.max(byKerned, Math.abs(edge - kerned(word.from + at)));
      edges += 1;
    }
  }
  return { edges, byPen, byKerned };
}

async function main() {
  bindNativeEngine(ROOT);
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(pdfiumLibrary(ROOT));
  // THE RESOLUTION TEST FIRST: the kerned measure must be told apart from the pen, or a pass below means nothing.
  const control = await read(pdfium, 'TimesRoman', true, 0);
  if (!(control.byKerned > TOLERANCE)) throw new Error(`the instrument cannot see kerning: ${control.byKerned.toFixed(3)} pt by the kerned measure`);
  console.log(`resolution test: the kerned measure is ${control.byKerned.toFixed(3)} pt off PDFium's edges, so a pen error that size is seen`);
  let worst = 0;
  for (const face of /** @type {const} */ (['TimesRoman', 'Helvetica', 'Courier'])) {
    for (const widths of face === 'TimesRoman' ? [true, false] : [true]) {
      for (const turn of [0, 90]) {
        const found = await read(pdfium, face, widths, turn);
        worst = Math.max(worst, found.byPen);
        console.log(`${face.padEnd(10)} /Widths ${widths ? 'set   ' : 'absent'} turned ${String(turn).padStart(2)}: ${String(found.edges)} edges, worst ${found.byPen.toFixed(3)} pt from the pen`);
      }
    }
  }
  console.log(worst <= TOLERANCE ? `every edge within ${String(TOLERANCE)} pt of the pen` : `AN EDGE ${worst.toFixed(3)} pt FROM THE PEN`);
  return worst <= TOLERANCE ? 0 : 1;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  },
);
