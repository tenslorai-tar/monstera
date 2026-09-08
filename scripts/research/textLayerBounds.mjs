// @ts-check
/**
 * What the text layer's two bounds are actually being asked to hold.
 *
 * ## The reading this owes
 *
 * `docs/FEATURES.md`'s *Select and copy* row declares `MAX_TEXT_LAYER_LINES`
 * (2,048) and `MAX_TEXT_LAYER_LINE` (1,024) and records both as **owed a corpus
 * reading**. The numbers came from one constructed fixture — a 12×70 table at
 * 6pt, which produced 840 lines because a table cell is its own line — and a
 * bound chosen from a single point is a value, not a rule
 * (`one-sample-gives-a-value-not-a-rule`).
 *
 * So this reports, per corpus document: the largest number of lines any page
 * produced, and the longest single line. Both are the substrate's own — the
 * same `parsePageText` the channel runs — so a disagreement between this and
 * the shipped answer would be a defect in one of them rather than in two
 * readings of "a line".
 *
 * ## What it deliberately does NOT do
 *
 * It does not tune the constants. Five documents build a harness and catch a
 * gross failure; they cannot say what the ninety-ninth percentile of the
 * world's PDFs looks like, and a bound moved to fit five files is a bound
 * fitted to five files. `corpusCaveat` prints that sentence beside every figure
 * rather than leaving it to whoever reads the output.
 *
 * It prints **no filename and no text** — `id`, page counts and lengths only.
 * The corpus is supplied, is not ours to publish, and this repository's history
 * is permanent.
 *
 * ## Its control
 *
 * A constructed page whose line count and longest line are properties of the
 * generator rather than of any parser. Without it, a run that read zero pages
 * out of every document — a stext option that stopped parsing, a page loop that
 * threw and was swallowed — reports small numbers under both bounds, which is
 * exactly the reassuring answer.
 *
 * Usage: MONSTERA_CORPUS=<dir> node scripts/research/textLayerBounds.mjs
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { STEXT_OPTION_STRING, linesOf, parsePageText } from '../../packages/kernel/dist/textStructure.js';

/**
 * The two figures the bounds are about, for one document — plus what the ENGINE
 * says, so a zero can be attributed.
 *
 * ## Why `engineCharacters` is here and is not redundant
 *
 * A document that yields no lines is either a page with no text on it — a scan,
 * where zero is correct and the feature has nothing to do — or a page whose
 * text this build cannot read, which is a defect. Both print `0`, and `0` is
 * the answer that reads as *nothing to worry about*.
 *
 * So the engine's own plain text is measured beside ours, through a different
 * call on the same `StructuredText`. A document where the engine has characters
 * and our parser has no lines is the defect, and it is visible in the row
 * rather than inferable from it.
 *
 * @param {Uint8Array} bytes
 * @returns {{ pages: number, maxLines: number, maxLine: number, totalLines: number,
 *   engineCharacters: number }}
 */
function measure(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const pages = document.countPages();
    let maxLines = 0;
    let maxLine = 0;
    let totalLines = 0;
    let engineCharacters = 0;
    for (let page = 0; page < pages; page += 1) {
      const loaded = document.loadPage(page);
      const stext = loaded.toStructuredText(STEXT_OPTION_STRING);
      engineCharacters += stext.asText().trim().length;
      const lines = linesOf(parsePageText(stext.asJSON()));
      maxLines = Math.max(maxLines, lines.length);
      totalLines += lines.length;
      for (const line of lines) maxLine = Math.max(maxLine, line.text.length);
    }
    return { pages, maxLines, maxLine, totalLines, engineCharacters };
  } finally {
    document.destroy();
  }
}

/**
 * A page with a known number of lines, one of them a known length.
 *
 * The control's whole job is to be a document whose answer is decided by this
 * script rather than by the engine, so a run that reports nothing for every
 * corpus document is visibly the instrument.
 *
 * @param {number} lines
 * @param {number} longest
 * @returns {Promise<Uint8Array>}
 */
async function constructed(lines, longest) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  // TALL AND WIDE ENOUGH for the lines to be separate and the long one to fit
  // without wrapping. A page that clipped them would make this control report
  // fewer lines than it drew, which is the same output as a broken parser.
  const page = document.addPage([2400, lines * 14 + 40]);
  for (let index = 0; index < lines; index += 1) {
    page.drawText(index === 0 ? 'x'.repeat(longest) : `line ${String(index)}`, {
      x: 20,
      y: page.getHeight() - 20 - index * 14,
      size: 8,
      font,
    });
  }
  return document.save();
}

const CONTROL_LINES = 37;
const CONTROL_LONGEST = 300;

const control = measure(await constructed(CONTROL_LINES, CONTROL_LONGEST));
if (control.maxLines !== CONTROL_LINES || control.maxLine !== CONTROL_LONGEST) {
  process.stderr.write(
    `CONTROL FAILED: a constructed page of ${String(CONTROL_LINES)} lines whose longest is ` +
      `${String(CONTROL_LONGEST)} characters was read as ${String(control.maxLines)} and ` +
      `${String(control.maxLine)}. Every corpus figure below would be this instrument's, not ` +
      `the documents'.\n`,
  );
  process.exitCode = 1;
}

const corpus = openCorpus();
if (!corpus.available) {
  // THE SHARED SPELLING, taken whole. `check:unverifiablespelling` exists
  // because a script that writes its own could-not-look verdict writes a second
  // opinion about what unverifiable means — and the field names here are the
  // module's, not ones this file invented (that mistake printed `undefined` on
  // its first run, which is the reassuring answer arriving as a literal).
  const stream = corpus.outcome.stream === 'stderr' ? process.stderr : process.stdout;
  stream.write(`${corpus.outcome.text}\n`);
  process.exitCode = corpus.outcome.code;
} else {
  process.stdout.write(
    `CONTROL: a constructed page reads as ${String(control.maxLines)} lines, longest ` +
      `${String(control.maxLine)} characters — the numbers it was drawn with.\n\n`,
  );
  process.stdout.write(
    '  id          pages   max lines/page   longest line   total lines   engine chars\n',
  );
  let worstLines = 0;
  let worstLine = 0;
  /** @type {string[]} Documents where the engine has text and we produced none. */
  const unread = [];
  /** @type {string[]} Documents with no text at all — a scan; zero is right. */
  const textless = [];
  for (const entry of corpus.documents) {
    const reading = measure(entry.bytes);
    worstLines = Math.max(worstLines, reading.maxLines);
    worstLine = Math.max(worstLine, reading.maxLine);
    if (reading.totalLines === 0) {
      (reading.engineCharacters > 0 ? unread : textless).push(entry.id);
    }
    process.stdout.write(
      `  ${entry.id.padEnd(12)}${String(reading.pages).padStart(5)}` +
        `${String(reading.maxLines).padStart(17)}${String(reading.maxLine).padStart(15)}` +
        `${String(reading.totalLines).padStart(14)}${String(reading.engineCharacters).padStart(15)}\n`,
    );
  }
  process.stdout.write(
    `\n  Worst across the corpus: ${String(worstLines)} lines on a page, ` +
      `${String(worstLine)} characters in a line.\n`,
  );
  if (textless.length > 0) {
    process.stdout.write(
      `  ${String(textless.length)} document(s) carry NO TEXT at all (${textless.join(', ')}) — ` +
        `a scan. Zero lines is the right answer there and Stage 6 is what changes it.\n`,
    );
  }
  if (unread.length > 0) {
    process.stdout.write(
      `  DEFECT: ${String(unread.length)} document(s) (${unread.join(', ')}) have text the ` +
        `engine can read and produced NO LINES here. That is this build's parser, not the ` +
        `document.\n`,
    );
    process.exitCode = 1;
  }
  process.stdout.write(`${corpusCaveat(corpus.documents.length)}\n`);
}
