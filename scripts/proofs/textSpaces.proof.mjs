// @ts-check
/**
 * Two spaces typed stay two
 * ([ADR-0228](../../docs/DECISIONS/0228-the-formatting-set-is-whole-in-both-text-writers-and-a-tab-is-a-marked-gap.md)'s
 * correction of 2026-10-16), proven against the real PDFium writer and read back from the SAVED bytes by two readers:
 * the editor's own (PDFium's text page, through the kernel's walk), and MuPDF's page-text read, which the page's text
 * layer is built from and so is what a copy takes.
 *
 * ## The mechanism the cases separate
 *
 * PDFium's text page reads a run of drawn spaces as one, within an object and across adjacent ones, so a paragraph
 * written with two spaces reopened in the editor with one, and the next edit wrote one. The writer now draws each run
 * of two or more spaces as an object of its own marked `/Span <</ActualText (  )>>`, as a tab is, and both readers take
 * the mark as the object's text.
 *
 * ## The cases
 *
 * - The editor's reader reads two and three spaces back as two and three.
 * - MuPDF's page-text read gives the same words with ordinary spaces, U+0020, and no other kind.
 * - The saved content marks exactly the two runs of spaces, each with exactly its spaces.
 * - A second edit of the reopened words keeps both runs, so the next save does not write one space.
 * - CONTROL: the same words drawn as plain text, unmarked, read back each run one space short — the original
 *   defect, and what this proof would read if the mark were removed.
 * - CONTROL: an edit with single spaces writes no mark, so the mark is the runs' and not every edit's.
 *
 * Fixtures are generated here; no document is read from disk.
 *
 * Usage: node scripts/proofs/textSpaces.proof.mjs [--require-engines]
 */
import { existsSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { TEXT_SPACES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { withNoPassword } from '../lib/pdfiumNoPassword.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');

/** One short line of words. */
const ORIGINAL = 'Amount due now';
/**
 * The edit: a run of two spaces and a run of three, and NO single space. The walk puts back a space the text page
 * dropped by comparing against the gaps after the object's other spaces (`restoreDroppedSpaces`), so a line holding a
 * single space as well reads two correctly with or without the mark, and would separate nothing. Step 5 of the text
 * regression walk is this shape: the typed words wrap, and the doubled space is the only space on its line.
 */
const SPACED = 'Amount  due   now';

const CASES = [
  'the editor’s reader reads the saved words back with two spaces and three where they were typed',
  'MuPDF’s page-text read, which a copy takes, gives the same words, every space an ordinary U+0020',
  'the saved content marks exactly the two runs of spaces, each with exactly its own spaces',
  'a second edit of the reopened words keeps both runs, so the next save writes them again',
  'CONTROL: the same words drawn unmarked read back each run of spaces one space short',
  'CONTROL: an edit with single spaces writes no mark',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });
if (CASES.length !== 6) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 6`);

/** @param {number} at @param {boolean} held @param {string} detail */
function check(at, held, detail) {
  const name = CASES[at] ?? `case ${String(at)}`;
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/** A Letter page holding `words` on one line in Helvetica 11, drawn as pdf-lib draws text: one plain object. @param {string} words */
async function page(words) {
  const made = await PDFDocument.create({ updateMetadata: false });
  const font = await made.embedFont(StandardFonts.Helvetica);
  made.addPage([612, 792]).drawText(words, { x: 72, y: 690, size: 11, font });
  return new Uint8Array(await made.save());
}

/**
 * @param {any} pdfium
 * @param {any} kernel
 */
async function run(pdfium, kernel) {
  const apply = withNoPassword(kernel.localPdfiumExecution).apply;

  /** PDFium's reading of page 0 as the editor reads it: its blocks. @param {Uint8Array} bytes @returns {Promise<any[]>} */
  const readBlocks = async (bytes) => {
    const session = await pdfium.pdfiumWriter.open(bytes);
    try {
      const read = await pdfium.textRuns(session, 0);
      return kernel.groupIntoBlocks(
        read.runs.filter((/** @type {any} */ each) => kernel.isUpright(each.style)).map((/** @type {any} */ each) => kernel.blockableOf(each)),
      );
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
  };
  /** A block's words as the editor shows them. @param {any} block */
  const wordsOf = (block) =>
    kernel.paragraphsOfLines(
      block.lines.map((/** @type {any} */ line) => ({
        text: line.runs.map((/** @type {any} */ each) => each.text).join(''),
        soft: line.soft,
      })),
    );
  /** The words of the block that begins `Amount`, as the editor would open it. @param {Uint8Array} bytes */
  const editorWords = async (bytes) => {
    const block = (await readBlocks(bytes)).find((each) => wordsOf(each).startsWith('Amount'));
    return block === undefined ? undefined : wordsOf(block);
  };
  /** The block's words replaced by `text`, as the editor commits it. @param {Uint8Array} bytes @param {string} text */
  const edit = async (bytes, text) => {
    const block = (await readBlocks(bytes)).find((each) => wordsOf(each).startsWith('Amount'));
    if (block === undefined) throw new Error('the line was not read as a block');
    const command = {
      kind: 'editTextBlock',
      page: 0,
      ...kernel.blockEditOf([
        {
          lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ each) => each.index)),
          soft: block.lines.map((/** @type {any} */ line) => line.soft),
          text,
        },
      ]),
      fit: 'reflow',
      version: 1,
    };
    return apply({ session: bytes, command, sources: [], reads: undefined });
  };

  /** MuPDF's page-text read of page 0, the one the text layer is built from, as one string per line. @param {Uint8Array} bytes @returns {string[]} */
  const copied = (bytes) => {
    const document = kernel.mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    const stext = document.loadPage(0).toStructuredText(kernel.stextOptionsFor('substrate'));
    try {
      return kernel.parsePageText(stext.asJSON()).blocks.flatMap((/** @type {any} */ block) => block.lines.map((/** @type {any} */ line) => String(line.text)));
    } finally {
      stext.destroy();
    }
  };
  /** Every `/ActualText` string in page 0's content, as MuPDF reads the stream. @param {Uint8Array} bytes */
  const marks = (bytes) => {
    const document = kernel.mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    const contents = document.findPage(0).get('Contents');
    const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, at) => contents.get(at)) : [contents];
    const text = streams.map((/** @type {any} */ stream) => stream.readStream().asString()).join('\n');
    return [...text.matchAll(/\/ActualText\s*\(([^)]*)\)/gu)].map((match) => match[1] ?? '');
  };

  const original = await page(ORIGINAL);
  const spaced = await edit(original, SPACED);
  const read = await editorWords(spaced);
  check(0, read === SPACED, `read ${JSON.stringify(read)}`);

  const lines = copied(spaced);
  const line = lines.find((each) => each.startsWith('Amount')) ?? '';
  const spaces = [...line].filter((character) => /\s/u.test(character));
  check(
    1,
    line === SPACED && spaces.every((character) => character === ' '),
    `read ${JSON.stringify(line)}; white space ${JSON.stringify([...new Set(spaces)].map((character) => (character.codePointAt(0) ?? 0).toString(16)))}`,
  );

  const written = marks(spaced);
  check(2, JSON.stringify(written) === JSON.stringify(['  ', '   ']), `marks ${JSON.stringify(written)}`);

  // THE WORDS AS REOPENED, one changed, as a person editing the line again commits them.
  const again = await edit(spaced, (read ?? '').replace('now', 'later'));
  const reread = await editorWords(again);
  check(3, reread === SPACED.replace('now', 'later'), `read ${JSON.stringify(reread)}; marks ${JSON.stringify(marks(again))}`);

  const unmarked = await editorWords(await page(SPACED));
  // MEASURED 2026-10-16: `Amount due  now`, each run one space short.
  check(4, unmarked !== SPACED && unmarked?.replace(/ +/gu, ' ') === 'Amount due now', `read ${JSON.stringify(unmarked)}`);

  const single = await edit(original, ORIGINAL.replace('now', 'later'));
  const none = marks(single);
  check(5, none.length === 0 && (await editorWords(single)) === ORIGINAL.replace('now', 'later'), `marks ${JSON.stringify(none)}`);
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'two spaces written by PDFium and read back by the editor and by MuPDF',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, TEXT_SPACES, 4);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { blockEditOf } = await import('../../packages/contract/dist/commands.js');
  const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
  const { groupIntoBlocks, isUpright, blockableOf } = await import('../../packages/kernel/dist/textLines.js');
  const { parsePageText, stextOptionsFor } = await import('../../packages/kernel/dist/textStructure.js');
  const { paragraphsOfLines } = await import('../../packages/shared/dist/index.js');
  const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
  await run(pdfium, { blockEditOf, localPdfiumExecution, groupIntoBlocks, isUpright, blockableOf, paragraphsOfLines, parsePageText, stextOptionsFor, mupdf });
  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} text spaces case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('text spaces case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
