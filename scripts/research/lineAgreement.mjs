// @ts-check
/**
 * How far two engines agree about where a line ends — E2's accuracy score, and
 * what it turned out to be a score OF.
 *
 * ## The clause, and the premise under it
 *
 * `BUILD-PROMPT.md`:541-551 owes *one text-structure module, line clustering
 * implemented exactly once, tuned against the fixture corpus with a measurable
 * accuracy score* — and adds that **constants change only with a corpus score in
 * the commit message**.
 *
 * Read against the code on 2026-09-09, that clause has no constant to govern.
 * `packages/kernel/src/textStructure.ts` implements no clustering: it parses
 * MuPDF's structured-text JSON and flattens it. The clustering is MuPDF's, in
 * `stext-device.c`, and the only lever this project holds is the **option set**
 * — `segment` on, `table-hunt` off — which is a pair of flags chosen by
 * measurement on 2026-09-02, not a threshold that can be nudged.
 *
 * So the clause anticipated an implementation this build does not have, and the
 * honest response is neither to invent a constant so there is something to tune
 * nor to record the obligation as met. It is to measure the thing the clause was
 * reaching for: **is the segmentation we ship right?**
 *
 * ## The oracle, and why it is not a second opinion
 *
 * There is no labelled ground truth for a corpus PDF's lines. What there is, now
 * that `pdfiumFfi.ts` exists, is a **genuinely independent reader**: PDFium
 * extracts text with its own algorithm, its own build and its own idea of a line
 * break, and it emits `\r\n` where it thinks one is.
 *
 * That is not the B3a defect. B3a forbids a second *implementation of a rule the
 * product depends on*; nothing here ships. Two independent readers disagreeing is
 * the only evidence available about a question neither can answer alone, and
 * where they agree, both being wrong the same way is a much smaller worry than
 * one being wrong on its own.
 *
 * ## Two scores, because they fail independently
 *
 * - **Characters**: both texts stripped of all whitespace and compared. This
 *   asks *did the two engines read the same glyphs*, and is blind to line
 *   breaking by construction.
 * - **Lines**: the fraction of MuPDF lines that appear, whitespace-normalised,
 *   as a PDFium line. This asks *did they break in the same places* — and it is
 *   the score the clause wanted.
 *
 * A high character score with a low line score is a segmentation difference. A
 * low character score means the two engines are not reading the same page and no
 * line score computed from them means anything, which is why both are printed
 * and the second is suppressed when the first is poor.
 *
 * ## Its own controls
 *
 * A score's reassuring answer is a high number, so:
 *
 * 1. A **constructed page** with three known lines runs first. Both engines must
 *    find three, and both scores must be 100% — a scorer that can only report
 *    agreement passes every corpus row otherwise.
 * 2. A **resolution case**: the same scorer is fed two line sets that differ by
 *    one line and must report less than 100%. Without it, control 1 is satisfied
 *    by a function that returns 1.
 * 3. **Attribution**: a document from which both engines read zero characters is
 *    a scan, and is printed as such rather than scored — a page with no text
 *    agrees perfectly with a page with no text.
 *
 * Nothing from a corpus document is printed but its id, its size, and these
 * counts and percentages.
 *
 * Run: npm run proof:lineagreement
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import koffi from 'koffi';
import * as mupdf from 'mupdf';

import { TEXT_STRUCTURE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';
import {
  STEXT_OPTIONS,
  STEXT_OPTION_STRING,
  linesOf,
  parsePageText,
} from '../../packages/kernel/dist/textStructure.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE_PDFIUM = process.argv.includes('--require-pdfium');
const REQUIRE_CORPUS = process.argv.includes('--require-corpus');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE_PDFIUM,
    subject: 'the line-agreement score',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

// The instrument's whole subject is what the built parser produces, so a stale
// build would score the previous one and print the answer under this one's name.
refuseStaleBuild(root, TEXT_STRUCTURE, 1);

const LINES = [
  'The first line of the constructed page.',
  'A second line, set well below the first.',
  'And a third, so a miscount of one is visible.',
];

/** Everything PDFium is asked for here. */
function bindPdfium() {
  const lib = koffi.load(library);
  const api = {
    initialise: lib.func('void FPDF_InitLibrary()'),
    loadMem: lib.func('void *FPDF_LoadMemDocument(const void *data, int size, const char *pw)'),
    closeDocument: lib.func('void FPDF_CloseDocument(void *document)'),
    pageCount: lib.func('int FPDF_GetPageCount(void *document)'),
    loadPage: lib.func('void *FPDF_LoadPage(void *document, int index)'),
    closePage: lib.func('void FPDF_ClosePage(void *page)'),
    loadText: lib.func('void *FPDFText_LoadPage(void *page)'),
    closeText: lib.func('void FPDFText_ClosePage(void *textPage)'),
    countChars: lib.func('int FPDFText_CountChars(void *textPage)'),
    getText: lib.func(
      'int FPDFText_GetText(void *textPage, int start, int count, _Out_ uint16_t *buffer)',
    ),
  };
  api.initialise();
  return api;
}

/**
 * PDFium's text for one page, split at the breaks it reports.
 *
 * @param {ReturnType<typeof bindPdfium>} api
 * @param {Uint8Array} bytes
 * @param {number} index
 * @returns {string[]}
 */
function pdfiumLines(api, bytes, index) {
  const buffer = Buffer.from(bytes);
  const document = api.loadMem(buffer, buffer.length, null);
  if (document === null) throw new Error('PDFium refused a document.');
  try {
    const page = api.loadPage(document, index);
    if (page === null) throw new Error(`PDFium could not load page ${String(index)}.`);
    try {
      const textPage = api.loadText(page);
      if (textPage === null) throw new Error('PDFium could not load a text page.');
      try {
        const count = Number(api.countChars(textPage));
        if (count <= 0) return [];
        const out = new Uint16Array(count + 1);
        const written = Number(api.getText(textPage, 0, count, out));
        const text = String.fromCharCode(...out.subarray(0, Math.max(0, written - 1)));
        return text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
      } finally {
        api.closeText(textPage);
      }
    } finally {
      api.closePage(page);
    }
  } finally {
    api.closeDocument(document);
  }
}

/**
 * The option string with `table-hunt` added, composed rather than spelt.
 *
 * ADR-0034's K.0 bans a second set of stext options anywhere, and a literal
 * `'segment,table-hunt'` here would be exactly that — a second encoding that
 * agrees with `STEXT_OPTIONS` until somebody edits one of them. This is the one
 * place in the repository that asks MuPDF for a set the product does not ship,
 * and it is built from the product's own names.
 */
const TABLE_HUNT_STRING = [STEXT_OPTIONS.segment, STEXT_OPTIONS.tableHunt].join(',');

/**
 * This application's own lines for one page, through the shipped substrate.
 *
 * @param {mupdf.PDFDocument} document
 * @param {number} index
 * @param {string} [options] what to ask the stext device for; the shipped set by
 *   default, so every caller that does not name one is measuring the product.
 * @returns {string[]}
 */
function mupdfLines(document, index, options = STEXT_OPTION_STRING) {
  const page = document.loadPage(index);
  const stext = page.toStructuredText(options);
  try {
    return linesOf(parsePageText(stext.asJSON()))
      .map((line) => line.text)
      .filter((text) => text.trim().length > 0);
  } finally {
    stext.destroy();
  }
}

/** Every non-space character, lower-cased. The character score's unit. */
const squashed = (/** @type {readonly string[]} */ lines) =>
  lines.join('').replace(/\s+/gu, '').toLowerCase();

/** One line, whitespace-collapsed. The line score's unit. */
const normalised = (/** @type {string} */ line) => line.replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * How many of each character a text holds.
 *
 * @param {string} text
 * @returns {Map<string, number>}
 */
function census(text) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  return counts;
}

/**
 * How far two readings agree.
 *
 * ## THE CHARACTER SCORE IS ORDER-INSENSITIVE, and the first version was not
 *
 * It compared the two squashed texts position by position, and reported 14.9%
 * to 47.2% over the corpus — for two engines that had, on inspection of the
 * counts, read almost exactly the same glyphs. The measure was wrong rather
 * than the reading: `FZ_STEXT_SEGMENT` **reorders** a multi-column page into
 * column-major and PDFium emits content-stream order, so a positional
 * comparison of two correct readings of a two-column page scores near zero.
 *
 * A number that low reads as *the engines disagree badly*, which is a
 * conclusion about the product drawn from a defect in the instrument. So the
 * character score is now a **multiset**: how much of each engine's character
 * census the other one has. Order cannot touch it.
 *
 * The positional measure is kept and renamed `order`, because it answers a real
 * and separate question — *did the two engines lay the page out in the same
 * sequence* — which is precisely the axis `segment` was turned on to change. A
 * high `characters` with a low `order` is the two engines reading the same page
 * in different orders, and that is a finding rather than a fault.
 *
 * ## The line score is ASYMMETRIC on purpose, so both directions are reported
 *
 * `ours` is what this application ships, so the score that matters is *how many
 * of our lines an independent reader also saw*. The reverse is reported beside
 * it because the two separate merging from splitting: if PDFium joins two of our
 * lines, our score falls and theirs does not.
 *
 * @param {readonly string[]} ours
 * @param {readonly string[]} theirs
 */
function agreement(ours, theirs) {
  const a = squashed(ours);
  const b = squashed(theirs);

  const mine = census(a);
  const yours = census(b);
  let shared = 0;
  for (const [character, count] of mine) shared += Math.min(count, yours.get(character) ?? 0);
  const union = Math.max(a.length, b.length);

  let ordered = 0;
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) if (a[at] === b[at]) ordered += 1;

  /**
   * How many of `from`'s lines appear in `to`, as a MULTISET — two identical
   * lines on a page need two matches, where a set would score the second free.
   *
   * @param {readonly string[]} from
   * @param {readonly string[]} to
   * @returns {number}
   */
  const overlap = (from, to) => {
    /** @type {Map<string, number>} */
    const available = new Map();
    for (const line of to) {
      const key = normalised(line);
      available.set(key, (available.get(key) ?? 0) + 1);
    }
    let matched = 0;
    for (const line of from) {
      const key = normalised(line);
      const left = available.get(key) ?? 0;
      if (left > 0) {
        matched += 1;
        available.set(key, left - 1);
      }
    }
    return from.length === 0 ? (to.length === 0 ? 1 : 0) : matched / from.length;
  };

  return {
    characters: union === 0 ? 1 : shared / union,
    order: union === 0 ? 1 : ordered / union,
    lines: overlap(ours, theirs),
    reverse: overlap(theirs, ours),
    ourChars: a.length,
    theirChars: b.length,
  };
}

/**
 * A page laid out as a grid, for the one control the table-hunt reading needs.
 *
 * Every corpus delta could legitimately be `0.0`, and that is also exactly what
 * an instrument printing is: an options string that never reached the engine
 * produces *no document changed*, which reads as **the option is harmless**.
 * That is the reassuring answer arriving in a comparison rather than a search.
 *
 * So the control is a page the option must visibly change: three rows of three
 * short cells at fixed columns, which is what `FZ_STEXT_TABLE_HUNT` exists to
 * detect. If the two readings of THIS page are identical, the reading below is
 * about nothing and the instrument says so instead of printing zeroes.
 */
async function constructedTable() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const columns = [40, 160, 280];
  const cells = [
    ['Region', 'Units', 'Share'],
    ['North', '128', '41%'],
    ['South', '184', '59%'],
  ];
  cells.forEach((row, down) => {
    row.forEach((cell, across) => {
      page.drawText(cell, { x: columns[across] ?? 40, y: 230 - down * 40, size: 11, font });
    });
  });
  return document.save();
}

/** A page whose three lines are known, for the controls. */
async function constructedPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  LINES.forEach((line, at) => {
    page.drawText(line, { x: 30, y: 230 - at * 40, size: 11, font });
  });
  return document.save();
}

async function main() {
  const out = process.stdout;
  out.write('# Where two engines agree a line ends\n\n');
  out.write(`  MuPDF, the npm build, with options "${STEXT_OPTION_STRING}"\n`);
  out.write(`  PDFium ${PDFIUM_VERSION}\n\n`);

  const api = bindPdfium();

  // CONTROL 1 — a page whose lines are known to this file.
  const constructed = await constructedPage();
  const ourControl = mupdfLines(
    /** @type {mupdf.PDFDocument} */ (mupdf.PDFDocument.openDocument(constructed, 'application/pdf')),
    0,
  );
  const theirControl = pdfiumLines(api, constructed, 0);
  const control = agreement(ourControl, theirControl);
  out.write('## Controls\n');
  out.write(
    `  a constructed page of ${String(LINES.length)} lines: ours ${String(ourControl.length)}, ` +
      `PDFium ${String(theirControl.length)}, characters ${(control.characters * 100).toFixed(1)}%, ` +
      `lines ${(control.lines * 100).toFixed(1)}%\n`,
  );
  const controlOk =
    ourControl.length === LINES.length &&
    theirControl.length === LINES.length &&
    control.lines === 1;
  if (!controlOk) {
    throw new Error(
      'CONTROL FAILED: the two engines do not agree about a page this file drew three lines on. ' +
        'Every score below would be a reading from an instrument that cannot see agreement.',
    );
  }

  // CONTROL 2 — RESOLUTION. The scorer must be able to report disagreement, or
  // control 1 is satisfied by a function that returns 1.
  const short = agreement(LINES, LINES.slice(0, 2));
  out.write(
    `  the same scorer, one line removed from the other side: lines ${(short.lines * 100).toFixed(1)}%\n`,
  );
  if (short.lines >= 1) {
    throw new Error(
      'CONTROL FAILED: the scorer reports full agreement between line sets that differ, so it separates nothing.',
    );
  }

  // AND THE CHARACTER SCORE NEEDS ITS OWN, because the corpus rows below report
  // 100% for it and a function returning 1 would too. One character changed on
  // one line, which is the smallest difference that should move it.
  const nudged = [...LINES];
  nudged[0] = `${LINES[0] ?? ''}x`;
  const differing = agreement(LINES, nudged);
  out.write(
    `  and with one character added to one line: characters ${(differing.characters * 100).toFixed(2)}%\n`,
  );
  if (differing.characters >= 1) {
    throw new Error(
      'CONTROL FAILED: the character score reports full agreement between texts differing by a ' +
        'character, so every 100% below is the scorer rather than the engines.',
    );
  }

  out.write('\n## The supplied corpus\n');
  const corpus = openCorpus({ required: REQUIRE_CORPUS });
  if (!corpus.available) {
    out.write(corpus.outcome.text);
    if (corpus.outcome.code !== 0) process.exitCode = 1;
    return;
  }

  out.write(
    '  id          pages   our lines   their lines   characters   order   ours in theirs   theirs in ours\n',
  );
  let scored = 0;
  let lineTotal = 0;
  let charTotal = 0;
  /**
   * What the table-hunt comparison needs, kept per document so the second
   * table below is the same reading rather than a second run of the engines.
   *
   * @type {{ id: string, plain: ReturnType<typeof agreement>, hunted: ReturnType<typeof agreement>, plainLines: number, huntedLines: number }[]}
   */
  const huntRows = [];
  for (const document of corpus.documents) {
    const opened = /** @type {mupdf.PDFDocument} */ (
      mupdf.PDFDocument.openDocument(document.bytes, 'application/pdf')
    );
    const pages = opened.countPages();
    /** @type {string[]} */ const ours = [];
    /** @type {string[]} */ const theirs = [];
    /** @type {string[]} */ const hunted = [];
    for (let page = 0; page < pages; page += 1) {
      ours.push(...mupdfLines(opened, page));
      theirs.push(...pdfiumLines(api, document.bytes, page));
      hunted.push(...mupdfLines(opened, page, TABLE_HUNT_STRING));
    }
    const score = agreement(ours, theirs);
    // ATTRIBUTION, not a score. Two engines reading nothing agree perfectly.
    if (score.ourChars === 0 && score.theirChars === 0) {
      out.write(
        `  ${document.id.padEnd(10)} ${String(pages).padStart(5)}   ` +
          `no text from either engine — a scan, not a disagreement\n`,
      );
      continue;
    }
    scored += 1;
    lineTotal += score.lines;
    charTotal += score.characters;
    huntRows.push({
      id: document.id,
      plain: score,
      hunted: agreement(hunted, theirs),
      plainLines: ours.length,
      huntedLines: hunted.length,
    });
    out.write(
      `  ${document.id.padEnd(10)} ${String(pages).padStart(5)}   ${String(ours.length).padStart(9)}   ` +
        `${String(theirs.length).padStart(11)}   ${(score.characters * 100).toFixed(2).padStart(9)}%   ` +
        `${(score.order * 100).toFixed(1).padStart(5)}%   ${(score.lines * 100).toFixed(1).padStart(13)}%   ` +
        `${(score.reverse * 100).toFixed(1).padStart(13)}%\n`,
    );
  }

  if (scored === 0) {
    out.write('\n  No document in this corpus carried text from either engine.\n');
  } else {
    out.write(
      `\n  Mean over the ${String(scored)} document(s) carrying text: ` +
        `characters ${((charTotal / scored) * 100).toFixed(2)}%, lines ${((lineTotal / scored) * 100).toFixed(1)}%\n`,
    );
  }
  out.write(`${corpusCaveat(corpus.documents.length)}\n`);

  // ── FZ_STEXT_TABLE_HUNT, measurable for the first time ────────────────────
  //
  // `textStructure.ts` leaves it off, and the reason recorded in ADR-0013 and in
  // §3's extraction row was *unexecuted*: no fixture contained a table, so the
  // option's damage to prose was the only half anyone had seen. The corpus now
  // carries table-bearing documents, so the trade can be scored rather than
  // asserted — ON against OFF, against the same independent reader, over BOTH
  // classes. Scoring only the table documents would answer *does it find
  // tables*, which is not the question: the option is global, so what a prose
  // page loses is part of its price.
  out.write(`\n## FZ_STEXT_TABLE_HUNT, on against off\n\n`);
  out.write(
    `  Asked for "${TABLE_HUNT_STRING}" instead of "${STEXT_OPTION_STRING}", scored against the\n` +
      `  same PDFium reading. A row whose line count does not move is a document the option\n` +
      `  found no table in, and its score cannot move either — those rows are the control.\n\n`,
  );
  out.write(
    '  id                 our lines   with hunt   ours in theirs   with hunt        delta\n',
  );
  let moved = 0;
  let deltaTotal = 0;
  for (const row of huntRows) {
    const delta = row.hunted.lines - row.plain.lines;
    if (row.huntedLines !== row.plainLines || Math.abs(delta) > 0) moved += 1;
    deltaTotal += delta;
    out.write(
      `  ${row.id.padEnd(18)}${String(row.plainLines).padStart(8)}` +
        `${String(row.huntedLines).padStart(12)}` +
        `${(row.plain.lines * 100).toFixed(1).padStart(16)}%` +
        `${(row.hunted.lines * 100).toFixed(1).padStart(11)}%` +
        `${(delta * 100).toFixed(1).padStart(13)}\n`,
    );
  }
  out.write(
    `\n  ${String(moved)} of ${String(huntRows.length)} document(s) carrying text changed at all; ` +
      `mean change in line agreement ${((deltaTotal / Math.max(1, huntRows.length)) * 100).toFixed(2)} points.\n`,
  );
  // THE CONTROL THIS READING CANNOT DO WITHOUT. Every delta above could
  // legitimately be zero, and zero is also what an option string that never
  // reached the engine produces — *no document changed* reading as *the option
  // is harmless*. So a page the option MUST change is scored first, and a
  // reading where it does not is refused rather than printed.
  const table = await constructedTable();
  const tableDocument = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(table, 'application/pdf')
  );
  const tablePlain = mupdfLines(tableDocument, 0);
  const tableHunted = mupdfLines(tableDocument, 0, TABLE_HUNT_STRING);
  const separated =
    tablePlain.length !== tableHunted.length || tablePlain.join('|') !== tableHunted.join('|');
  out.write(
    `\n  CONTROL, a constructed 3×3 grid: ${String(tablePlain.length)} line(s) without the ` +
      `option, ${String(tableHunted.length)} with — the two readings ` +
      `${separated ? 'DIFFER' : 'are identical'}.\n`,
  );
  if (!separated) {
    throw new Error(
      'CONTROL FAILED: table-hunt changes nothing on a page built as a grid, so the option is ' +
        'not reaching the engine and every delta above is the instrument rather than the trade.',
    );
  }
  // AND THE PROSE READING, which is the half ADR-0034 recorded as the reason.
  const huntedProse = mupdfLines(
    /** @type {mupdf.PDFDocument} */ (mupdf.PDFDocument.openDocument(constructed, 'application/pdf')),
    0,
    TABLE_HUNT_STRING,
  );
  out.write(
    `  The constructed PROSE page: ${String(ourControl.length)} line(s) without, ` +
      `${String(huntedProse.length)} with.\n`,
  );
  out.write(
    '\n  AND THERE IS NO CONSTANT HERE TO TUNE. textStructure.ts implements no\n' +
      '  clustering: it parses what MuPDF\'s stext device produced. The only lever\n' +
      '  this project holds is the option set, and it is a pair of flags. A score\n' +
      '  below is evidence about that choice, not a threshold to move.\n',
  );
}

await main();
