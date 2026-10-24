// @ts-check
/**
 * Edit text's writer on every text block of a page, routed as the application routes it
 * ([ADR-0266](../../docs/DECISIONS/0266-edit-text-writes-only-the-edited-blocks-own-instructions.md)), counting what is
 * refused and checking that nothing else on the page is drawn differently.
 *
 * ## What is tried, on every block
 *
 * PDFium reads the page as the editor does (`textRuns`, grouped by `groupIntoBlocks`) and the operator writer edits it,
 * as `main` routes every page (ADR-0266). Then, each on a fresh copy of the page, the block is given:
 *
 * - `replace`: its first word of two letters or more replaced by another;
 * - `add`: words added at its end;
 * - `font`, `size`, `colour`: all its words set in a bundled face (Tinos), a quarter larger, and in red.
 *
 * And on every page, through `blocksReplaced`, the one function a person's Replace all and spelling replacement go
 * through (ADR-0267): `replace all` of the page's most frequent word of four letters or more, whole and as written, and
 * `spelling`, its first occurrence alone.
 *
 * ## The lines, on two pages made for them
 *
 * A block of numbered paragraphs set at uneven spacing (the editor shows each paragraph where the page has it, the cloud
 * branch's F2): a word changed must leave every line where it was, and a paragraph that grows must move the lines below
 * by one pitch, every gap below kept, each within a pixel. A code block, one show per line: a word changed in one line
 * must leave every other line as it was and merge none — and its CONTROL, the same edit sent with the lines as one
 * paragraph, must be seen to merge them.
 *
 * ## The counts, and the pixels
 *
 * A REFUSAL is any edit the writer did not make, named by its error and step. Every edit that was made is drawn by MuPDF
 * before and after at 144 dpi, and a DISTURBED edit is one that changed a pixel outside where the block may draw: its own
 * ink before, and the ink of every character MuPDF reads after the edit that it did not read before, in the block's column
 * from its top down (the edited words, wrapped and grown). It is also disturbed where a character MuPDF read outside the
 * block before is gone after, wherever it was. An edit that changed no pixel in the block is UNSEEN and counted.
 *
 * ## The documents
 *
 * The brochure (`brochureFixture.mjs`, three pages); the link-markers page (item 4's shape: a paragraph whose small raised
 * references are drawn apart from it, after the next paragraph); the repository's fixtures (the Chromium print, the font
 * kinds, a line-end hyphen); and, with `--corpus <folder>`, the owner's corpus, every page of every document, each page in
 * a process of its own (a 41 MB document opened once per edit exhausted one process's memory, 2026-10-24).
 *
 * ## Controls
 *
 * - RESOLUTION: the comparator counts exactly one pixel that differs by one level.
 * - THE INSTRUMENT SEES THE BROCHURE'S DEFECT: a page showing two fonts of one name and different encodings, its first
 *   line edited through PDFium's page rewrite (the route before ADR-0266), must be refused or disturb the second line —
 *   and edited by the application's route must be made and disturb nothing.
 * - THE OLD REPLACE: PDFium's `replaceAllText` on the same page of two fonts of one name must be refused or disturb it.
 * - BEFORE AND AFTER: `--route old` routes as before ADR-0266 (PDFium for every page not showing Type 3 text, its packed
 *   text read unpacked), so the same run prints the counts the change is measured against. The cases are the
 *   application's route's, so under `--route old` they are expected to fail: that run is a measurement.
 *
 * Prints counts and document numbers only for the corpus — never a file's name or its words.
 *
 * Usage: node scripts/proofs/editText.proof.mjs [--require-engines] [--route old] [--corpus <folder>] [--pages <n>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import { EDIT_OBJECT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { compare, charactersOf, inkOf, render } from '../lib/pageDisturbance.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { brochure } from '../research/brochureFixture.mjs';
import { FONT_KINDS, buildFixture } from '../research/fontKindFixtures.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const argv = process.argv.slice(2);
const option = (/** @type {string} */ name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
};
const OLD_ROUTE = option('--route') === 'old';
const CORPUS = option('--corpus');
const PAGES = Number(option('--pages') ?? Number.POSITIVE_INFINITY);
/** `--documents 3,6`: only these corpus numbers. */
const ONLY = option('--documents')?.split(',').map(Number) ?? null;
const CHILD = option('--child');
const CHROMIUM = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');
/** The bundled face a `font` edit sets the words in. */
const FACE = 'Tinos';
const EDITS = /** @type {const} */ (['replace', 'add', 'font', 'size', 'colour']);

const CASES = [
  'RESOLUTION: the comparator counts exactly one pixel that differs by one level',
  'THE INSTRUMENT SEES THE BROCHURE’S DEFECT: two fonts of one name, edited through PDFium’s page rewrite, are refused or disturbed',
  'and the same page edited by the application’s route is made and disturbs nothing',
  'the brochure and the link-markers page: every edit of every block is made — no refusal',
  'the brochure and the link-markers page: every edit made disturbs nothing and changes the block (not vacuous)',
  'the repository’s fixtures: every edit made disturbs nothing',
  'THE OLD REPLACE: PDFium’s replace-all on the page of two fonts of one name is refused or disturbs (ADR-0267)',
  'numbered paragraphs: a word changed leaves every line where the page has it, each paragraph’s spacing kept (within 1 px)',
  'numbered paragraphs: a paragraph that grows moves the lines below by one line’s pitch, every gap below kept (within 1 px)',
  'a code block: a word changed in one line leaves every other line as it was, and no line is merged',
  'CONTROL: the same code edit with its lines sent as one paragraph merges them, and the check above sees it',
];

/**
 * @typedef {import('../lib/pageDisturbance.mjs').Box} Box
 * @typedef {{ block: string, edit: string, route: string, outcome: 'made' | 'refused', disturbed: number, lost: number, inside: number, why: string }} Try
 */

/** A refusal named by its error and step, its numbers masked, so equal causes count together. @param {unknown} error */
function reasonOf(error) {
  const named = /** @type {any} */ (error);
  const name = String(named?.name ?? 'Error');
  // A TextNotWritableError names characters, which are the document's own: never printed.
  const message = name === 'TextNotWritableError' ? 'a character no face carries' : String(named?.message ?? error).replace(/\d+/gu, '#');
  return `${name}${named?.step === undefined ? '' : ` at ${String(named.step)}`}: ${message.slice(0, 160)}`;
}

/**
 * Every edit on every block of page `index` of `bytes`, each on a fresh copy, routed as the application routes it.
 * @param {any} pdfium @param {any} kernel @param {Uint8Array} bytes @param {number} index
 * @param {boolean} quotes whether a block may be named by its words: never for the owner's corpus
 * @returns {Promise<Try[]>}
 */
async function walkPage(pdfium, kernel, bytes, index, quotes) {
  const probe = await kernel.mupdfWriter.open(bytes);
  /** @type {boolean} */
  let showsType3;
  try {
    showsType3 = (await kernel.readPageRewrite(probe, index)) === 'operators';
  } finally {
    await kernel.mupdfWriter.close(probe);
  }
  const session = await pdfium.pdfiumWriter.open(bytes);
  /** @type {any} */
  let read;
  /** @type {any} */
  let runs;
  /** @type {'objects' | 'operators'} */
  let rewrite;
  /** @type {boolean} */
  let unpacked;
  try {
    const plain = await pdfium.textRuns(session, index);
    // THE ROUTE: the application's, the operator writer for every page (ADR-0266), or the one before that ADR for the
    // counts it is measured against: PDFium for every page not showing Type 3 text, its packed text read unpacked.
    rewrite = (kernel.oldRoute ?? OLD_ROUTE) && !showsType3 ? 'objects' : 'operators';
    unpacked = kernel.readsUnpacked(plain.unaddressable, rewrite);
    if (unpacked) await pdfium.unpackedIfAsked(session, index, true);
    read = unpacked ? await pdfium.textRuns(session, index) : plain;
    runs = await pdfium.pageRuns(session, index);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const grouped = kernel.groupIntoBlocks(
    read.runs.filter((/** @type {any} */ run) => kernel.isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({ ...run, setting: kernel.settingOf(run.style) })),
  );
  // WHAT EACH BLOCK PUSHES, as `main` adds it to the read (`pushesOfPage`, ADR-0249): a replacement sends it.
  const pushes = kernel.pushesOfPage(grouped.map((/** @type {any} */ block) => block.box), read);
  const blocks = grouped.map((/** @type {any} */ block, /** @type {number} */ at) => ({ ...block, push: pushes[at] ?? { below: [], room: 0 } }));
  const before = render(kernel, bytes, index);
  const beforeCharacters = charactersOf(kernel, bytes, index);
  // A CHARACTER IS ITSELF by its place AND its size: a heading made larger keeps its first letter's pen position, and that
  // letter is still new ink (the Chromium print's heading, 2026-10-24).
  const keyOf = (/** @type {{ character: string, x: number, y: number, box: Box }} */ each) =>
    `${each.character}@${String(Math.round(each.x * 2))},${String(Math.round(each.y * 2))}/${String(Math.round((each.box.top - each.box.bottom) * 2))}`;
  /** @type {Try[]} */
  const tries = [];

  /**
   * Where a block may draw after an edit, and how to tell its characters: its ink before; its column from its leftmost
   * PEN POSITION, not only its ink, since a line wrapped below starts at the pen position, which a glyph's side bearing
   * puts left of the ink (measured on the brochure's heading, 2026-10-24); and a character is the block's by the centre of
   * its glyph's box, not its pen position (the heading's own first letter stood 1.6 pt left of the ink).
   * @param {any} block
   */
  const zoneOf = (block) => {
    const ink = inkOf(kernel, bytes, index, { left: block.box.x0, bottom: block.box.y0, right: block.box.x1, top: block.box.y1 });
    const holds = (/** @type {{ box: Box }} */ each) => {
      const x = (each.box.left + each.box.right) / 2;
      const y = (each.box.bottom + each.box.top) / 2;
      return x >= ink.left - 1.5 && x <= ink.right + 1.5 && y >= ink.bottom - 1.5 && y <= ink.top + 1.5;
    };
    const own = beforeCharacters.filter(holds);
    return {
      ink,
      holds,
      left: Math.min(ink.left, ...own.map((each) => each.x)),
      right: Math.max(ink.right, ...own.map((each) => each.x)),
    };
  };
  /** @type {Map<number, ReturnType<typeof zoneOf>>} */
  const zones = new Map();
  const zone = (/** @type {number} */ at) => {
    const known = zones.get(at);
    if (known !== undefined) return known;
    const made = zoneOf(blocks[at]);
    zones.set(at, made);
    return made;
  };

  /**
   * One edit of `entries` on a fresh copy of the page, which may change the blocks at `touched`: made or refused, and
   * what its pixels say outside where those blocks may draw.
   * @param {string} name @param {string} edit @param {any[]} entries @param {number[]} touched
   */
  const attempt = async (name, edit, entries, touched) => {
    const wire = { page: index, ...kernel.blockEditOf(entries), fit: 'reflow', version: 1 };
    /** @type {Uint8Array} */
    let after;
    try {
      if (rewrite === 'operators') {
        const copy = await kernel.mupdfWriter.open(bytes);
        try {
          await kernel.applyEditTextOperators(copy, { kind: 'editTextOperators', ...wire }, runs);
          after = await kernel.mupdfWriter.serialise(copy);
        } finally {
          await kernel.mupdfWriter.close(copy);
        }
      } else {
        after = await kernel.pdfiumExecution.apply({
          session: bytes,
          command: { kind: 'editTextBlock', ...wire, ...(unpacked ? { unpack: true } : {}) },
          sources: [],
          reads: undefined,
        });
      }
    } catch (error) {
      tries.push({ block: name, edit, route: rewrite, outcome: 'refused', disturbed: 0, lost: 0, inside: 0, why: reasonOf(error) });
      return;
    }
    const areas = touched.map(zone);
    // WHERE THE BLOCKS MAY DRAW: their ink before, and the ink of every character read after and not before whose origin
    // is in one of their columns from its top down — the edited words, wrapped and grown, and a pushed block moved.
    const was = new Set(beforeCharacters.map(keyOf));
    const afterCharacters = charactersOf(kernel, after, index);
    const now = new Set(afterCharacters.map(keyOf));
    const grown = afterCharacters
      .filter((each) => !was.has(keyOf(each)))
      .filter((each) => areas.some((area) => each.x >= area.left - 1.5 && each.x <= area.right + 1.5 && each.y <= area.ink.top + 1.5))
      .map((each) => each.box);
    // A CHARACTER OUTSIDE THE BLOCKS THAT IS GONE is disturbed text wherever it went, though its pixels might be allowed.
    // Not a space: it draws nothing, and an edit sets a line's spaces again with its words.
    const lost = beforeCharacters.filter((each) => each.character.trim() !== '' && !areas.some((area) => area.holds(each)) && !now.has(keyOf(each))).length;
    const { outside, inside, farthest } = compare(before, render(kernel, after, index), [...areas.map((area) => area.ink), ...grown]);
    tries.push({
      block: name,
      edit,
      route: rewrite,
      outcome: 'made',
      disturbed: outside,
      lost,
      inside,
      why: outside > 0 || lost > 0 ? `${String(lost)} character(s) outside the block gone; pixels up to ${String(farthest / 2)} pt away` : '',
    });
  };

  for (const [at, block] of blocks.entries()) {
    const lines = block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index));
    const soft = block.lines.map((/** @type {any} */ line) => line.soft);
    const text = kernel.paragraphsOfLines(block.lines.map((/** @type {any} */ line) => ({ text: kernel.lineText(line.runs), soft: line.soft })));
    if (text.trim().length === 0) continue;
    // A BLOCK OF THE OWNER'S CORPUS IS NAMED BY ITS NUMBER: its words are the owner's and are never printed.
    const name = quotes ? `block ${String(at)} “${text.slice(0, 24)}”` : `block ${String(at)}`;
    const size = Number(block.lines[0]?.runs[0]?.style.size ?? 10);
    const whole = (/** @type {Record<string, unknown>} */ set) => ({ text, marks: [{ from: 0, to: text.length, set }] });
    /** @type {Record<(typeof EDITS)[number], Record<string, unknown> | null>} */
    const asked = {
      replace: /\p{L}{2,}/u.test(text) ? { text: text.replace(/\p{L}{2,}/u, (/** @type {string} */ word) => (word === 'Revised' ? 'Altered' : 'Revised')) } : null,
      add: { text: `${text.trimEnd()} with added words` },
      font: whole({ family: FACE }),
      size: whole({ size: Math.min(400, Math.round(size * 1.25 * 10) / 10) }),
      colour: whole({ colour: { r: 200, g: 30, b: 30 } }),
    };
    for (const edit of EDITS) {
      const rest = asked[edit];
      if (rest !== null) await attempt(name, edit, [{ lines, soft, ...rest }], [at]);
    }
  }

  // THE PAGE'S REPLACEMENTS (ADR-0267), through the one function a person's go through: Replace all of the page's most
  // frequent word of four letters or more, whole and as written, and a spelling replacement of its first occurrence.
  const counted = new Map();
  for (const block of blocks) {
    for (const word of kernel.wordsOf(block).match(/\p{L}{4,}/gu) ?? []) counted.set(word, (counted.get(word) ?? 0) + 1);
  }
  const frequent = [...counted].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (typeof frequent === 'string') {
    const compiled = kernel.compileQuery(frequent, { caseSensitive: true, wholeWord: true, normalise: 'none' });
    const matchesIn = compiled.ok ? compiled.value.matchesIn : () => [];
    const touchedBy = (/** @type {any[]} */ entries) =>
      blocks.flatMap((/** @type {any} */ each, /** @type {number} */ at) =>
        entries.some((entry) => entry.lines[0]?.[0] === each.lines[0]?.runs[0]?.index) ? [at] : []);
    const all = kernel.blocksReplaced(blocks, matchesIn, 'Altered');
    const label = quotes ? `the page’s “${frequent}”` : 'the page’s most frequent word';
    if (all.length > 0) await attempt(label, 'replace all', all, touchedBy(all));
    const first = blocks.findIndex((/** @type {any} */ each) => matchesIn(kernel.wordsOf(each)).length > 0);
    const one = first === -1 ? [] : kernel.blocksReplaced(blocks, matchesIn, 'Altered', { block: first, occurrence: 0 });
    if (one.length > 0) await attempt(label, 'spelling', one, touchedBy(one));
  }
  return tries;
}

/**
 * A page's lines as MuPDF reads them: its drawn characters grouped by baseline (within a point), each line's words with
 * no spaces and its baseline, top down. What a person sees as lines, read from the bytes, not from what was sent.
 * @param {any} kernel @param {Uint8Array} bytes @returns {{ y: number, text: string }[]}
 */
function linesOf(kernel, bytes) {
  /** @type {{ y: number, chars: { x: number, character: string }[] }[]} */
  const rows = [];
  for (const each of charactersOf(kernel, bytes, 0).filter((one) => one.character.trim() !== '')) {
    const row = rows.find((one) => Math.abs(one.y - each.y) < 1);
    if (row === undefined) rows.push({ y: each.y, chars: [each] });
    else row.chars.push(each);
  }
  return rows
    .map((row) => ({ y: row.y, text: row.chars.sort((a, b) => a.x - b.x).map((one) => one.character).join('') }))
    .sort((a, b) => b.y - a.y);
}

/** 1 px at the proof's 144 dpi, in points: how far a line may stand from where it stood. */
const ONE_PIXEL = 0.5;

/**
 * Whether a page's lines after an edit are its lines before, but for `changed` (line number → its words after, no
 * spaces), each at the baseline it had shifted by `shift(line)`: the same count of lines, every other line's words
 * unchanged, every line within {@link ONE_PIXEL}. Answers the first difference, or `''`.
 * @param {{ y: number, text: string }[]} before @param {{ y: number, text: string }[]} after
 * @param {Map<number, string>} changed @param {(line: number) => number} [shift]
 */
function sameLines(before, after, changed, shift = () => 0) {
  if (before.length !== after.length) return `${String(before.length)} line(s) became ${String(after.length)}`;
  for (const [at, line] of before.entries()) {
    const now = after[at];
    if (now === undefined) return `line ${String(at)} is gone`;
    const words = changed.get(at) ?? line.text;
    if (now.text !== words) return `line ${String(at)} reads differently`;
    const off = now.y - (line.y - shift(at));
    if (Math.abs(off) > ONE_PIXEL) return `line ${String(at)} stands ${off.toFixed(2)} pt from where the page had it`;
  }
  return '';
}

/**
 * The cloud branch's F2 shape (2026-10-24): one block of three numbered paragraphs, each of two lines at a 14 pt pitch,
 * the paragraphs 2 and 4 pt further apart — uneven, as a page sets them, so one even spacing cannot pass, and close
 * enough that the reading groups them as one block (3 and 6 pt apart, it made two: measured 2026-10-24).
 */
async function numberedParagraphs() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const lines = [
    ['1. The members agreed the budget for', 'the spring planting at the first meeting.'],
    ['2. The garden opens at dawn and closes', 'at dusk on every day of the week.'],
    ['3. Tools are lent to members free of', 'charge and returned the same day.'],
  ];
  let y = 700;
  lines.forEach((paragraph, at) => {
    for (const line of paragraph) {
      page.drawText(line, { x: 72, y, size: 11, font });
      y -= 14;
    }
    y -= at === 0 ? 2 : 4;
  });
  return new Uint8Array(await document.save());
}

/**
 * A code block: a monospace face, one show per line, each line a line of its own. Shaped so that a merge CAN happen: the
 * closing brace fits after the line above it, so the same edit sent with the lines as one paragraph joins them (with
 * lines of similar length nothing fits and the control could not fail: measured 2026-10-24).
 */
async function codeBlock() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Courier);
  const page = document.addPage([612, 792]);
  ['if (ready) {', '  start();', '}', 'stop();'].forEach((line, at) => {
    page.drawText(line, { x: 72, y: 700 - at * 12, size: 10, font });
  });
  return new Uint8Array(await document.save());
}

/**
 * The first block of page 0 of `bytes`, edited by `text` through the operator writer as the application sends it: the
 * read's lines and soft wraps, unless `soft` is given. Answers the bytes, or the refusal.
 * @param {any} pdfium @param {any} kernel @param {Uint8Array} bytes @param {(words: string) => string} text
 * @param {boolean[]} [soft]
 */
async function editFirstBlock(pdfium, kernel, bytes, text, soft) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  /** @type {any} */
  let read;
  /** @type {any} */
  let runs;
  try {
    read = await pdfium.textRuns(session, 0);
    runs = await pdfium.pageRuns(session, 0);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const blocks = kernel.groupIntoBlocks(read.runs.filter((/** @type {any} */ run) => kernel.isEditedInPlace(run.style)).map((/** @type {any} */ run) => ({ ...run, setting: kernel.settingOf(run.style) })));
  const block = blocks[0];
  const lines = block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index));
  const sent = soft ?? block.lines.map((/** @type {any} */ line) => line.soft);
  const words = kernel.paragraphsOfLines(block.lines.map((/** @type {any} */ line, /** @type {number} */ at) => ({ text: kernel.lineText(line.runs), soft: sent[at] ?? false })));
  const copy = await kernel.mupdfWriter.open(bytes);
  try {
    await kernel.applyEditTextOperators(copy, { kind: 'editTextOperators', page: 0, ...kernel.blockEditOf([{ lines, soft: sent, text: text(words) }]), fit: 'reflow', version: 1 }, runs);
    return { blocks: blocks.length, lines: block.lines.length, bytes: await kernel.mupdfWriter.serialise(copy) };
  } catch (error) {
    return { blocks: blocks.length, lines: block.lines.length, refused: reasonOf(error) };
  } finally {
    await kernel.mupdfWriter.close(copy);
  }
}

/** A paragraph of three lines in Helvetica 12, its first line ending in a word broken by a hyphen. */
async function lineEndHyphen() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  ['The quarterly figures were con-', 'firmed by the board at its meeting', 'on the fourth of the month.'].forEach((line, at) => {
    page.drawText(line, { x: 72, y: 700 - at * 14, size: 12, font });
  });
  return new Uint8Array(await document.save());
}

/**
 * Item 4's shape: a paragraph whose small raised references are drawn apart from it, after the paragraph below, which is
 * the order MuPDF then reads them in (the owner's document 2, measured 2026-10-24).
 */
async function linkMarkers() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.TimesRoman);
  const page = document.addPage([612, 792]);
  const first = ['Small chops and snacks, sold for events, churches and', 'weekend parties near the market.'];
  first.forEach((line, at) => page.drawText(line, { x: 72, y: 700 - at * 14, size: 10.5, font }));
  ['Baked goods from home, cakes and bread rolls for birthdays', 'and small events on the weekend.'].forEach((line, at) =>
    page.drawText(line, { x: 72, y: 664 - at * 14, size: 10.5, font }),
  );
  // THE MARKERS LAST, at the first paragraph's second line, raised and smaller.
  const end = 72 + font.widthOfTextAtSize(first[1] ?? '', 10.5) + 2;
  page.drawText('[5] [9]', { x: end, y: 686 + 3.5, size: 7.9, font });
  return new Uint8Array(await document.save());
}

/**
 * The brochure's defect in one page: two font dictionaries of ONE base name whose codes draw different glyphs — a plain
 * one and one whose `/Differences` shifts every lower-case letter by one — each showing a line. PDFium's generator names a
 * font's resource by its base name and type (`FontsMapSearch`), so a page rewrite sets the second line in the first font.
 */
async function sameNameFonts() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([612, 792]);
  const { context } = document;
  const plain = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }));
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  // CODE c DRAWS THE LETTER AFTER c's: the second font's bytes for "ifmmp" draw "hello" shifted back, read as such.
  const differences = [97, ...Array.from(letters, (_, at) => PDFName.of(letters[(at + 1) % 26] ?? 'a'))];
  const shifted = context.register(
    context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: context.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: differences }) }),
  );
  page.node.setFontDictionary(PDFName.of('F1'), plain);
  page.node.setFontDictionary(PDFName.of('F2'), shifted);
  // THE SECOND LINE'S CODES are each letter's predecessor, so through the shifted font it reads as the words below.
  const back = (/** @type {string} */ words) => Array.from(words, (character) => (letters.includes(character) ? (letters[(letters.indexOf(character) + 25) % 26] ?? character) : character)).join('');
  const content = [
    'BT /F1 12 Tf 72 700 Td (The first line of the page.) Tj ET',
    `BT /F2 12 Tf 72 680 Td (${back('the second line in its own font.')}) Tj ET`,
  ].join('\n');
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(content)));
  return new Uint8Array(await document.save());
}

/**
 * The documents a run walks, each with its pages, and whether its words may be printed (`quotes`): never for the corpus.
 * `gate` is the design's gate: no refusal, nothing disturbed, nothing unseen.
 * @returns {Promise<{ name: string, bytes: Uint8Array, pages: number[], gate: boolean, quotes: boolean }[]>}
 */
async function fixtures() {
  /** @type {{ name: string, bytes: Uint8Array, pages: number[], gate: boolean, quotes: boolean }[]} */
  const found = [];
  for (let page = 1; page <= 3; page += 1) found.push({ name: `brochure page ${String(page)}`, bytes: await brochure(page), pages: [0], gate: true, quotes: true });
  found.push({ name: 'link markers', bytes: await linkMarkers(), pages: [0], gate: true, quotes: true });
  found.push({ name: 'chromium-type3.pdf', bytes: new Uint8Array(readFileSync(CHROMIUM)), pages: [0], gate: false, quotes: true });
  for (const kind of FONT_KINDS) found.push({ name: `font kind ${kind.id}`, bytes: await buildFixture(kind.id), pages: [0], gate: false, quotes: true });
  found.push({ name: 'line-end hyphen', bytes: await lineEndHyphen(), pages: [0], gate: false, quotes: true });
  return found;
}

/** @param {Try[]} tries */
function counts(tries) {
  const made = tries.filter((each) => each.outcome === 'made');
  return {
    tries: tries.length,
    refused: tries.length - made.length,
    disturbed: made.filter((each) => each.disturbed > 0 || each.lost > 0).length,
    unseen: made.filter((each) => each.inside === 0 && each.disturbed === 0).length,
  };
}

/** @param {string} document @param {Try[]} tries */
function report(document, tries) {
  const { tries: all, refused, disturbed, unseen } = counts(tries);
  process.stdout.write(`  ${document}: ${String(all)} edit(s), ${String(refused)} refused, ${String(disturbed)} disturbed, ${String(unseen)} unseen\n`);
  /** @type {Map<string, number>} */
  const reasons = new Map();
  for (const each of tries) {
    if (each.outcome === 'made' && each.disturbed === 0 && each.lost === 0) continue;
    const key = `${each.edit} (${each.route}): ${each.outcome === 'made' ? `disturbed — ${each.why.replace(/\d+(\.\d+)?/gu, '#')}` : each.why}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  for (const [key, count] of reasons) process.stdout.write(`      ${String(count)} × ${key}\n`);
  // `--detail`: every try that was not clean, with its numbers (never a corpus block's words: those are named by number).
  if (argv.includes('--detail')) {
    for (const each of tries.filter((one) => one.outcome !== 'made' || one.disturbed > 0 || one.lost > 0)) {
      process.stdout.write(`        ${each.block} ${each.edit}: ${each.outcome}, ${String(each.disturbed)} pixel(s); ${each.why}\n`);
    }
  }
}

/** @param {any} pdfium @param {any} kernel */
async function run(pdfium, kernel) {
  /** @type {string[]} */
  const failures = [];
  const roster = createRoster(failures, { cases: 11 });
  if (CASES.length !== 11) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 11`);
  const check = (/** @type {string} */ name, /** @type {boolean} */ held, /** @type {string} */ detail) => {
    const mark = roster.mark();
    if (!held) failures.push(`${name}\n      ${detail}`);
    roster.record(mark, name);
  };

  // RESOLUTION: one pixel, one level.
  const blank = { width: 4, height: 4, rgb: new Uint8Array(48).fill(255), toDevice: (/** @type {number} */ x, /** @type {number} */ y) => /** @type {[number, number]} */ ([x, y]) };
  const one = { ...blank, rgb: Uint8Array.from(blank.rgb, (value, at) => (at === 30 ? value - 1 : value)) };
  const resolved = compare(blank, one, []);
  check(CASES[0] ?? '', resolved.outside === 1 && resolved.inside === 0, `counted ${JSON.stringify(resolved)}`);

  // THE INSTRUMENT SEES THE BROCHURE'S DEFECT, through the old route and not through the new.
  const same = await sameNameFonts();
  // THE WORDS REPLACED, the owner's edit: the control asks of that one edit what the brochure showed.
  const viaPdfium = (await walkPageRouted(pdfium, kernel, same, true)).filter((each) => each.block.startsWith('block 0') && each.edit === 'replace');
  const viaApp = (await walkPageRouted(pdfium, kernel, same, false)).filter((each) => each.block.startsWith('block 0'));
  const seen = viaPdfium.length > 0 && viaPdfium.every((each) => each.outcome === 'refused' || each.disturbed > 0 || each.lost > 0);
  process.stdout.write(`  the control, two fonts of one name through PDFium's page rewrite: ${viaPdfium.map((each) => `${each.edit} ${each.outcome === 'made' ? `made, disturbed ${String(each.disturbed)}` : each.why}`).join('; ')}\n`);
  check(CASES[1] ?? '', seen, JSON.stringify(viaPdfium));
  const viaAppClean = viaApp.length > 0 && viaApp.every((each) => each.route === 'operators' && each.outcome === 'made' && each.disturbed === 0 && each.lost === 0);
  check(CASES[2] ?? '', viaAppClean, JSON.stringify(viaApp));

  /** @type {{ document: string, gate: boolean, tries: Try[] }[]} */
  const results = [];
  for (const document of await fixtures()) {
    /** @type {Try[]} */
    const tries = [];
    for (const page of document.pages) tries.push(...(await walkPage(pdfium, kernel, document.bytes, page, document.quotes)));
    results.push({ document: document.name, gate: document.gate, tries });
    report(document.name, tries);
  }
  const gate = results.filter((result) => result.gate).flatMap((result) => result.tries);
  const rest = results.filter((result) => !result.gate).flatMap((result) => result.tries);
  const describe = (/** @type {Try[]} */ list) => list.map((each) => `${each.block} ${each.edit}: ${each.outcome} ${each.why}`).join('; ') || 'none';
  const gateCounts = counts(gate);
  check(CASES[3] ?? '', gate.length > 0 && gateCounts.refused === 0, describe(gate.filter((each) => each.outcome === 'refused')));
  check(
    CASES[4] ?? '',
    gateCounts.disturbed === 0 && gateCounts.unseen === 0,
    describe(gate.filter((each) => each.outcome === 'made' && (each.disturbed > 0 || each.lost > 0 || each.inside === 0))),
  );
  check(CASES[5] ?? '', rest.length > 0 && counts(rest).disturbed === 0, describe(rest.filter((each) => each.disturbed > 0 || each.lost > 0)));

  // THE OLD REPLACE (ADR-0267's control): PDFium's replace-all of a word of the first line, the same length so the line
  // need not move, on the page of two fonts of one name — its page rewrite sets the second line in the first font.
  /** @type {string} */
  let oldReplace;
  try {
    const replaced = await kernel.pdfiumExecution.apply({
      session: same,
      command: { kind: 'replaceAllText', find: 'first', replace: 'other', caseSensitive: true, wholeWord: true },
      sources: [],
      reads: undefined,
    });
    const gone = sameLines(linesOf(kernel, same), linesOf(kernel, replaced), new Map([[0, 'Theotherlineofthepage.']]));
    oldReplace = gone === '' ? 'made and disturbed nothing' : `made, and ${gone}`;
  } catch (error) {
    oldReplace = `refused: ${reasonOf(error)}`;
  }
  process.stdout.write(`  the old replace, PDFium's replace-all on two fonts of one name: ${oldReplace}\n`);
  check(CASES[6] ?? '', oldReplace !== 'made and disturbed nothing', oldReplace);

  // NUMBERED PARAGRAPHS (the cloud branch's F2): the editor shows each paragraph where the page has it, so the writer must
  // write it there. A word of the first line swapped for one of the same length, then a paragraph made a line longer.
  const numbered = await numberedParagraphs();
  const numberedBefore = linesOf(kernel, numbered);
  const swapped = await editFirstBlock(pdfium, kernel, numbered, (words) => words.replace('budget', 'income'));
  const swapCheck = swapped.bytes === undefined ? `refused: ${swapped.refused ?? ''}` : sameLines(numberedBefore, linesOf(kernel, swapped.bytes), new Map([[0, '1.Themembersagreedtheincomefor']]));
  check(CASES[7] ?? '', swapped.blocks === 1 && swapped.lines === 6 && swapCheck === '', `${String(swapped.blocks)} block(s), ${String(swapped.lines)} line(s) in the first: ${swapCheck}`);
  const grown = await editFirstBlock(pdfium, kernel, numbered, (words) => words.replace('the first meeting.', 'the first meeting of the whole committee in the hall.'));
  /** @type {string} */
  let growCheck;
  if (grown.bytes === undefined) growCheck = `refused: ${grown.refused ?? ''}`;
  else {
    const after = linesOf(kernel, grown.bytes);
    // ONE LINE MORE, and every line from the second paragraph down where it stood less exactly the first's new line's pitch.
    const pitch = after.length === numberedBefore.length + 1 ? (numberedBefore[2]?.y ?? 0) - (after[3]?.y ?? 0) : Number.NaN;
    const below = numberedBefore.slice(2).map((line, at) => ({ was: line, now: after[at + 3] }));
    const off = below.find((each) => each.now === undefined || each.now.text !== each.was.text || Math.abs(each.was.y - pitch - each.now.y) > ONE_PIXEL);
    growCheck = after.length !== numberedBefore.length + 1 ? `${String(numberedBefore.length)} line(s) became ${String(after.length)}` : Math.abs(pitch - 14) > ONE_PIXEL ? `the lines below moved ${pitch.toFixed(2)} pt, not one pitch` : off === undefined ? '' : 'a line below did not keep its gap';
  }
  check(CASES[8] ?? '', growCheck === '', growCheck);

  // A CODE BLOCK: one line's word changed, every other line as it was, none merged — and its CONTROL, the same edit sent
  // with the lines as one paragraph, which the same check must see merged.
  const code = await codeBlock();
  const codeBefore = linesOf(kernel, code);
  const renamed = (/** @type {string} */ words) => words.replace('ready', 'other');
  const changedCode = await editFirstBlock(pdfium, kernel, code, renamed);
  const codeCheck = changedCode.bytes === undefined ? `refused: ${changedCode.refused ?? ''}` : sameLines(codeBefore, linesOf(kernel, changedCode.bytes), new Map([[0, 'if(other){']]));
  check(CASES[9] ?? '', changedCode.lines === 4 && codeCheck === '', `${String(changedCode.blocks)} block(s), ${String(changedCode.lines)} line(s) in the first: ${codeCheck}`);
  const merged = await editFirstBlock(pdfium, kernel, code, renamed, Array.from({ length: changedCode.lines }, () => true));
  const mergeCheck = merged.bytes === undefined ? `refused: ${merged.refused ?? ''}` : sameLines(codeBefore, linesOf(kernel, merged.bytes), new Map([[0, 'if(other){']]));
  process.stdout.write(`  the code block's control, its lines sent as one paragraph: ${mergeCheck === '' ? 'read back as the page’s own lines' : mergeCheck}\n`);
  check(CASES[10] ?? '', mergeCheck !== '', 'the merged edit read back as the page’s own lines, so the check cannot see a merge');

  if (CORPUS !== null) corpus();

  process.stdout.write(
    failures.length > 0 ? `\n${String(failures.length)} Edit text case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n` : roster.format('Edit text case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * A page walked with the route forced, for the control: `old` is the route before ADR-0266.
 * @param {any} pdfium @param {any} kernel @param {Uint8Array} bytes @param {boolean} old
 */
async function walkPageRouted(pdfium, kernel, bytes, old) {
  return await walkPage(pdfium, { ...kernel, oldRoute: old }, bytes, 0, true);
}

/**
 * The owner's corpus, every page of every document, each page in a process of its own; reported per document number.
 * Not gated: CI has no corpus, and the owner reads the counts.
 */
function corpus() {
  if (CORPUS === null) return;
  const files = readdirSync(CORPUS).filter((each) => each.toLowerCase().endsWith('.pdf')).sort();
  process.stdout.write(`\n  THE OWNER'S CORPUS, ${OLD_ROUTE ? 'routed as before ADR-0266' : 'routed as the application routes it'}:\n`);
  /** @type {Try[]} */
  const all = [];
  for (const [at, file] of files.entries()) {
    // BY NUMBER, NEVER BY NAME: the number is the file's place in the folder sorted by name.
    if (ONLY !== null && !ONLY.includes(at + 1)) continue;
    const label = `corpus document ${String(at + 1)} of ${String(files.length)}`;
    const path = join(CORPUS, file);
    const pages = childRun([path, '--count']);
    if (typeof pages !== 'number') {
      process.stdout.write(`  ${label}: could not be opened, not counted\n`);
      continue;
    }
    /** @type {Try[]} */
    const tries = [];
    let failed = 0;
    for (let page = 0; page < Math.min(pages, PAGES); page += 1) {
      const answer = childRun([path, '--page', String(page)]);
      if (Array.isArray(answer)) tries.push(...answer);
      else failed += 1;
    }
    report(`${label}, ${String(Math.min(pages, PAGES))} of ${String(pages)} page(s)${failed > 0 ? `, ${String(failed)} page(s) whose walk FAILED` : ''}`, tries);
    all.push(...tries);
  }
  const total = counts(all);
  process.stdout.write(`\n  CORPUS: ${String(total.tries)} edit(s), ${String(total.refused)} refused, ${String(total.disturbed)} disturbed, ${String(total.unseen)} unseen\n\n`);
}

/**
 * This script on one page of one file, in a process of its own: its answer, or `null` where the walk failed.
 * @param {string[]} rest @returns {unknown}
 */
function childRun(rest) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', ...rest, ...(OLD_ROUTE ? ['--route', 'old'] : [])], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const last = (child.stdout ?? '').trim().split('\n').at(-1) ?? '';
  try {
    return child.status === 0 ? JSON.parse(last) : null;
  } catch {
    return null;
  }
}

/** One page of one corpus file, answered as one line of JSON (`--child <file> --page <n>`, or `--count`). */
async function child(/** @type {any} */ pdfium, /** @type {any} */ kernel) {
  const bytes = new Uint8Array(readFileSync(CHILD ?? ''));
  if (argv.includes('--count')) {
    const session = await pdfium.pdfiumWriter.open(bytes);
    try {
      process.stdout.write(`${JSON.stringify(await pdfium.pageCount(session))}\n`);
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(await walkPage(pdfium, kernel, bytes, Number(option('--page') ?? 0), false))}\n`);
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null || !existsSync(fontsDirectory(ROOT))) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'Edit text’s writer on every block of the brochure, the link-markers page and the repository’s fixtures',
    why:
      `${String(CASES.length)} case(s) need both engines and the bundled fonts:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (!existsSync(library)
        ? 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'
        : shim === null
          ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.'
          : 'The bundled fonts are not provisioned. Run `node scripts/provision/fonts.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, EDIT_OBJECT, 4);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { blockEditOf, readsUnpacked } = await import('../../packages/contract/dist/commands.js');
  const { groupIntoBlocks, isEditedInPlace, settingOf, pushesOfPage } = await import('../../packages/kernel/dist/textLines.js');
  const { paragraphsOfLines, lineText, compileQuery } = await import('../../packages/shared/dist/index.js');
  const { blocksReplaced, wordsOf } = await import('../../packages/contract/dist/blockReplace.js');
  const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
  const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
  const { readPageRewrite } = await import('../../packages/kernel/dist/pageRewrite.js');
  const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
  const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
  const { bindEditFolders, loadEditFaces } = await import('../../packages/kernel/dist/editFaces.js');
  const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');
  const { withNoPassword } = await import('../lib/pdfiumNoPassword.mjs');
  // THE BUNDLED FONTS BOUND AS THE HOST BINDS THEM, so a word the page's fonts cannot carry is set in the closest face.
  bindEditFolders(fontsDirectory(ROOT), null, readCatalogueApart);
  // AND READ, as the PDFium host reads them before its first write: the operator writer loads them on first need itself.
  await loadEditFaces();
  const kernel = {
    blockEditOf,
    readsUnpacked,
    compileQuery,
    blocksReplaced,
    wordsOf,
    groupIntoBlocks,
    pushesOfPage,
    isEditedInPlace,
    settingOf,
    paragraphsOfLines,
    lineText,
    mupdf,
    mupdfWriter,
    readPageRewrite,
    applyEditTextOperators,
    pdfiumExecution: withNoPassword(localPdfiumExecution),
  };
  if (CHILD !== null) await child(pdfium, kernel);
  else await run(pdfium, kernel);
}
