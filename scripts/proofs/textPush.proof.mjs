// @ts-check
/**
 * A paragraph that grows pushes the text below it down
 * ([ADR-0249](../../docs/DECISIONS/0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md)), proven against the
 * real PDFium writer and read back from the SAVED bytes by a second reader, MuPDF.
 *
 * ## What is built, and why each piece is there
 *
 * One Letter page set in Helvetica by pdf-lib: a heading; a paragraph of three lines on a 14-point pitch in the left
 * column; a line of small print just under it, 3 points below the paragraph's last descender, so a fourth line of the
 * paragraph lands on it; a side note in a second column level with the paragraph; and a page number in the bottom
 * margin. The paragraph is edited by appending words that wrap onto exactly one new line.
 *
 * ## The cases, and what separates each
 *
 * - The small print is read by MuPDF exactly one pitch lower, and the kernel's answer names it moved by that much.
 * - CONTROL: the same edit without the blocks below leaves the small print where it was and the new line ON it — the
 *   overlap ADR-0096 accepted, which is what this proof would read if the push were removed.
 * - The side note (another column) and the page number (the footer) are read where they were.
 * - On a page with no room under the small print, nothing moves and the paragraph is still written.
 * - A pushed block whose words differ from the page's is refused: a pushed block is never written.
 * - `pushesOf`, the one answer to *what is below*, names the small print and not the side note or the page number,
 *   from PDFium's own reading of the page.
 *
 * Fixtures are generated here; no document is read from disk.
 *
 * Usage: node scripts/proofs/textPush.proof.mjs [--require-engines]
 */
import { existsSync } from 'node:fs';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { TEXT_PUSH, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { withNoPassword } from '../lib/pdfiumNoPassword.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');

const HEADING = 'Push proof heading';
const PARAGRAPH = [
  'This paragraph is set in one column on the left of the page, and',
  'it wraps at that column’s edge, so the words that do not fit go',
  'down onto the next line of the same column, as paragraphs do here.',
];
const SMALL_PRINT = 'Small print under the paragraph, in the same column.';
const SIDE_NOTE = 'Side note';
const FOOTER = 'Page 1';
/** Words that wrap the paragraph's last line onto exactly one new one. */
const ADDED = ' These added words make it one line longer.';
/** The paragraph's pitch: the distance between its baselines, which is what one new line moves the text below by. */
const PITCH = 14;

const CASES = [
  'PREMISE: PDFium reads the page as five blocks, and pushesOf names the small print below the paragraph and nothing else',
  'the paragraph grows by one line, and MuPDF reads the small print in the saved file exactly one pitch lower',
  'the kernel answers the small print as moved, by exactly one pitch',
  'CONTROL: the same edit without the blocks below leaves the small print where it was, with the new line on top of it',
  'CONTROL: the side note in the second column is read where it was',
  'CONTROL: the page number in the footer is read where it was',
  'on a page with no room under the small print, nothing moves, and the paragraph is still written',
  'a pushed block whose words are not the page’s is refused, so a pushed block is never written',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });
if (CASES.length !== 8) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 8`);

/** @param {number} at @param {boolean} held @param {string} detail */
function check(at, held, detail) {
  const name = CASES[at] ?? `case ${String(at)}`;
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/**
 * The page. `smallPrintAt` is the small print's baseline, and `footer` whether the page number is drawn.
 *
 * @param {{ readonly smallPrintAt: number, readonly footer: boolean }} layout
 */
async function page({ smallPrintAt, footer }) {
  const made = await PDFDocument.create({ updateMetadata: false });
  const font = await made.embedFont(StandardFonts.Helvetica);
  const sheet = made.addPage([612, 792]);
  sheet.drawText(HEADING, { x: 72, y: 720, size: 16, font });
  for (const [at, line] of PARAGRAPH.entries()) sheet.drawText(line, { x: 72, y: 690 - at * PITCH, size: 11, font });
  sheet.drawText(SIDE_NOTE, { x: 480, y: 690, size: 11, font });
  sheet.drawText(SMALL_PRINT, { x: 72, y: smallPrintAt, size: 8, font });
  if (footer) sheet.drawText(FOOTER, { x: 300, y: 36, size: 8, font });
  return new Uint8Array(await made.save());
}

/**
 * @param {any} pdfium
 * @param {any} kernel
 */
async function run(pdfium, kernel) {
  // THE WHOLE ANSWER, image and `moved` both (`applyDrawing`), since a case reads what the kernel says it moved.
  const apply = withNoPassword(kernel.localPdfiumExecution).applyDrawing;

  /** PDFium's reading of page 0 as the editor reads it: its blocks, and what each pushes. @param {Uint8Array} bytes */
  const readBlocks = async (bytes) => {
    const session = await pdfium.pdfiumWriter.open(bytes);
    try {
      const read = await pdfium.textRuns(session, 0);
      const blocks = kernel.groupIntoBlocks(
        read.runs.filter((/** @type {any} */ run) => kernel.isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({
          ...run,
          setting: kernel.settingOf(run.style),
        })),
      );
      const pushes = read.box === null ? [] : kernel.pushesOf(blocks.map((/** @type {any} */ block) => block.box), read.box);
      return { blocks, pushes };
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
  };

  /** A block's words as the editor shows them. @param {any} block */
  const wordsOf = (block) =>
    kernel.paragraphsOfLines(
      block.lines.map((/** @type {any} */ line) => ({
        text: line.runs.map((/** @type {any} */ run) => run.text).join(''),
        soft: line.soft,
      })),
    );
  /** The block whose words begin `start`. @param {readonly any[]} blocks @param {string} start */
  const blockAt = (blocks, start) => blocks.findIndex((block) => wordsOf(block).startsWith(start));
  /** @param {any} block @param {string} text */
  const edited = (block, text) => ({
    lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
    soft: block.lines.map((/** @type {any} */ line) => line.soft),
    text,
  });

  /**
   * The paragraph grown by {@link ADDED}, with the blocks below it pushed when `push` is set; `wrong` gives the pushed
   * blocks words that are not the page's.
   *
   * @param {Uint8Array} bytes @param {{ readonly push: boolean, readonly wrong?: boolean }} how
   */
  const grow = async (bytes, { push, wrong = false }) => {
    const { blocks, pushes } = await readBlocks(bytes);
    const at = blockAt(blocks, 'This paragraph');
    const paragraph = blocks[at];
    const column = pushes[at];
    if (paragraph === undefined || column === undefined) throw new Error('the paragraph was not read as a block');
    const below = push ? column.below.map((/** @type {number} */ index) => blocks[index]) : [];
    const command = {
      kind: 'editTextBlock',
      page: 0,
      ...kernel.blockEditOf([
        edited(paragraph, `${wordsOf(paragraph)}${ADDED}`),
        ...below.map((/** @type {any} */ under) => ({
          ...edited(under, wrong ? `${wordsOf(under)} changed` : wordsOf(under)),
          push: { by: 0, room: column.room },
        })),
      ]),
      fit: 'reflow',
      version: 1,
    };
    try {
      return { applied: await apply({ session: bytes, command, sources: [], reads: undefined }), error: null };
    } catch (error) {
      return { applied: null, error };
    }
  };

  /**
   * MuPDF's reading of the saved page, the second reader: each line's words and its baseline, in MuPDF's frame (down is
   * larger).
   *
   * @param {Uint8Array} bytes
   * @returns {{ readonly text: string, readonly baseline: number }[]}
   */
  const mupdfLines = (bytes) => {
    const document = kernel.mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
    const stext = document.loadPage(0).toStructuredText('preserve-whitespace');
    try {
      const json = JSON.parse(stext.asJSON());
      return json.blocks.flatMap((/** @type {any} */ block) =>
        (block.lines ?? []).map((/** @type {any} */ line) => ({ text: String(line.text), baseline: Number(line.y) })),
      );
    } finally {
      stext.destroy();
    }
  };
  /** The baseline of the line holding `words`. @param {readonly { text: string, baseline: number }[]} lines @param {string} words */
  const baselineOf = (lines, words) => lines.find((line) => line.text.includes(words))?.baseline;
  /** @param {number | undefined} a @param {number | undefined} b */
  const same = (a, b) => a !== undefined && b !== undefined && Math.abs(a - b) < 0.01;

  const original = await page({ smallPrintAt: 650, footer: true });
  const before = mupdfLines(original);
  const { blocks, pushes } = await readBlocks(original);
  const paragraphAt = blockAt(blocks, 'This paragraph');
  const named = (pushes[paragraphAt]?.below ?? []).map((/** @type {number} */ index) => wordsOf(blocks[index]));
  check(
    0,
    blocks.length === 5 && named.length === 1 && named[0] === SMALL_PRINT,
    `${String(blocks.length)} block(s); the paragraph pushes ${JSON.stringify(named)}, room ${String(pushes[paragraphAt]?.room)}`,
  );

  const pushed = await grow(original, { push: true });
  const after = pushed.applied === null ? [] : mupdfLines(pushed.applied.image);
  // ONE LINE LONGER: the added words are read on a line one pitch under the paragraph's old last line.
  const lastBefore = baselineOf(before, 'down onto');
  const added = baselineOf(after, 'These added');
  const smallBefore = baselineOf(before, 'Small print');
  const smallAfter = baselineOf(after, 'Small print');
  check(
    1,
    lastBefore !== undefined &&
      added !== undefined &&
      Math.abs(added - lastBefore - PITCH) < 0.01 &&
      smallBefore !== undefined &&
      smallAfter !== undefined &&
      Math.abs(smallAfter - smallBefore - PITCH) < 0.01,
    pushed.applied === null
      ? `the edit threw ${String(pushed.error)}`
      : `the added words at ${String(added)}, one line under ${String(lastBefore)}; the small print ${String(smallBefore)} → ${String(smallAfter)}`,
  );
  const moved = pushed.applied?.moved ?? [];
  check(
    2,
    moved.length === 1 && moved[0]?.block === 1 && Math.abs((moved[0]?.down ?? 0) - PITCH) < 0.01,
    `moved: ${JSON.stringify(moved)}`,
  );

  // THE CONTROL REPRODUCES THE DEFECT: no blocks below in the edit, which is what every edit sent before ADR-0249.
  const unpushed = await grow(original, { push: false });
  const plain = unpushed.applied === null ? [] : mupdfLines(unpushed.applied.image);
  const newLine = baselineOf(plain, 'These added');
  const smallStill = baselineOf(plain, 'Small print');
  check(
    3,
    same(smallStill, smallBefore) && newLine !== undefined && smallStill !== undefined && Math.abs(newLine - smallStill) < 8,
    `without the push the small print is at ${String(smallStill)} and the new line at ${String(newLine)}`,
  );
  check(4, same(baselineOf(after, SIDE_NOTE), baselineOf(before, SIDE_NOTE)), `side note ${String(baselineOf(before, SIDE_NOTE))} → ${String(baselineOf(after, SIDE_NOTE))}`);
  check(5, same(baselineOf(after, FOOTER), baselineOf(before, FOOTER)), `page number ${String(baselineOf(before, FOOTER))} → ${String(baselineOf(after, FOOTER))}`);

  // NO ROOM: the small print a few points above the bottom margin, which mirrors the top one (about 60 points here).
  const full = await page({ smallPrintAt: 66, footer: false });
  const fullBefore = mupdfLines(full);
  const tight = await grow(full, { push: true });
  const fullAfter = tight.applied === null ? [] : mupdfLines(tight.applied.image);
  check(
    6,
    tight.applied !== null &&
      tight.applied.moved.length === 0 &&
      same(baselineOf(fullAfter, 'Small print'), baselineOf(fullBefore, 'Small print')) &&
      baselineOf(fullAfter, 'These added') !== undefined,
    tight.applied === null
      ? `the edit threw ${String(tight.error)}`
      : `moved ${JSON.stringify(tight.applied.moved)}; small print ${String(baselineOf(fullBefore, 'Small print'))} → ${String(baselineOf(fullAfter, 'Small print'))}`,
  );

  const wrong = await grow(original, { push: true, wrong: true });
  check(7, wrong.applied === null, wrong.applied === null ? `refused: ${String(wrong.error)}` : 'it was SAVED');
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'a growing paragraph pushing the text below it, written by PDFium and read back by MuPDF',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, TEXT_PUSH, 4);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { blockEditOf } = await import('../../packages/contract/dist/commands.js');
  const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
  const { groupIntoBlocks, isEditedInPlace, pushesOf, settingOf } = await import('../../packages/kernel/dist/textLines.js');
  const { paragraphsOfLines } = await import('../../packages/shared/dist/index.js');
  const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
  await run(pdfium, { blockEditOf, localPdfiumExecution, groupIntoBlocks, isEditedInPlace, pushesOf, settingOf, paragraphsOfLines, mupdf });
  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} text push case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('text push case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
