// @ts-check
/**
 * What does MuPDF's structured text actually give us, and is it enough for E2?
 *
 * ## The question, and why it must be measured before a line is written
 *
 * `BUILD-PROMPT.md` Part E2 specifies *"one shared text-structure module in the
 * kernel — glyph runs to lines to blocks"*, with line clustering implemented
 * exactly once and tuned against a corpus score. Read alone, that says we own
 * the clustering.
 *
 * `docs/ARCHITECTURE.md` §3's matrix says text extraction is **MuPDF structured
 * text**, and [ADR-0013](../../docs/DECISIONS/0013-pdfa-export-and-text-extraction-engines.md)
 * records the open half in terms: *"whether that geometry is sufficient for
 * columns and tables is unexecuted"*. Read alone, that says MuPDF owns it.
 *
 * Both are in the founding record and they are not obviously compatible, so the
 * first thing E2 owes is not code — it is the reading that tells you which
 * question is actually open. MuPDF 1.28 makes that sharper than it was when
 * ADR-0013 was written: `FZ_STEXT_SEGMENT` (4096) segments the page,
 * `FZ_STEXT_TABLE_HUNT` (16384) hunts for tables. If those work, a hand-written
 * block clusterer here is a **second opinion about a question the engine already
 * answers**, which is B3a's exact shape and the thing this project has paid for
 * three times in one day before now.
 *
 * ## The fixture's ground truth is known INDEPENDENTLY of any clusterer
 *
 * Every run is placed by this file at a coordinate this file chose, so which
 * runs belong to which column and which baseline is a fact about the generator
 * rather than an opinion of the thing under test. That is the property an
 * accuracy score needs and the one a corpus of found documents cannot give:
 * scoring a clusterer against labels produced by a clusterer measures agreement,
 * not correctness.
 *
 * Two columns, five baselines each, with the columns' baselines DELIBERATELY
 * SHARED — left and right runs sit at identical y. That is the hard shape: a
 * grouper that keys on baseline alone merges the two columns into five wide
 * lines and reads across the gutter, which is the classic two-column extraction
 * failure. A fixture whose columns had staggered baselines would be handled
 * correctly by the broken version, and would separate nothing.
 *
 * Usage: node scripts/research/textStructure.mjs [--json]
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { scoreAgainstTruth } from '../../packages/kernel/dist/textAccuracy.js';
import { STEXT_OPTIONS, parsePageText } from '../../packages/kernel/dist/textStructure.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

// THE SHIPPED PARSER IS READ FROM `dist`, so a stale build would have this
// reporting about code nobody is running — and this session watched exactly
// that happen, when a reverted mutation left two source files newer than the
// renderer bundle.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/textStructure.ts', 'packages/kernel/dist/textStructure.js', 'tsc'],
    ['packages/kernel/src/textAccuracy.ts', 'packages/kernel/dist/textAccuracy.js', 'tsc'],
  ],
  2,
);

/**
 * The option strings this spike compares.
 *
 * ## IT WENT THROUGH THE C SHIM UNTIL 2026-09-02, and the move is the finding
 *
 * It called `mz_stext_json` over koffi with an integer flag word. That export
 * existed for this file and for nothing else, which made the flag word a
 * SECOND ENCODING of a decision the product spells as an option string — two
 * literals in `textStructure.ts` with nothing comparing them, drifting toward
 * the side nothing exercises. The export is gone and the flag word with it.
 *
 * **The instrument is stronger for it, not merely tidier.** It now reaches the
 * engine the way `pageText.ts` does, so what it measures is the path that
 * ships. A spike that measures a path the product does not use is evidence
 * about the wrong thing, however careful the reading — and ADR-0034's table was
 * exactly that until this change.
 *
 * Same engine either way: the npm package is MuPDF **1.28.0** and so is the
 * shim (`scripts/provision/mupdf.mjs`), checked 2026-09-02, which is what made
 * the move safe rather than a re-measurement of something else.
 *
 * The names come from `textStructure.ts` rather than being spelt here, because
 * a literal `'segment'` in this file would be the third opinion the deletion
 * was for.
 */
const NO_OPTIONS = '';
const SEGMENT = STEXT_OPTIONS.segment;
const SEGMENT_AND_TABLE_HUNT = `${STEXT_OPTIONS.segment},${STEXT_OPTIONS.tableHunt}`;

/** Page geometry, in PDF user units. The gutter is wide enough to be obvious. */
const PAGE = { width: 612, height: 792 };
const LEFT_X = 72;
const RIGHT_X = 340;
const FIRST_BASELINE = 700;
const LEADING = 24;
const SIZE = 12;

/**
 * The fixture, and the ground truth that comes with it.
 *
 * Returned together on purpose: a generator that writes a file and leaves the
 * labels to be re-derived has produced a corpus, not a fixture.
 *
 * @returns {Promise<{ bytes: Uint8Array, truth: Array<{ column: 'left' | 'right', row: number, text: string, x: number, y: number }> }>}
 */
async function buildTwoColumnFixture(rightX = RIGHT_X) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE.width, PAGE.height]);

  /** @type {Array<{ column: 'left' | 'right', row: number, text: string, x: number, y: number }>} */
  const truth = [];
  for (let row = 0; row < 5; row += 1) {
    const y = FIRST_BASELINE - row * LEADING;
    for (const [column, x] of /** @type {const} */ ([
      ['left', LEFT_X],
      ['right', rightX],
    ])) {
      // The text names its own cell, so a merged line is legible as such in the
      // output rather than needing the coordinates to be re-read.
      const text = `${column}${String(row)}`;
      page.drawText(text, { x, y, size: SIZE, font });
      truth.push({ column, row, text, x, y });
    }
  }

  return { bytes: await doc.save({ useObjectStreams: false }), truth };
}

/**
 * Single-column prose, where segmentation has nothing to gain and could lose.
 *
 * **The control on the flag itself.** A page with one column already reads
 * correctly with no options, so if `FZ_STEXT_SEGMENT` reorders or splits it, the
 * flag is not free and the two-column win is being paid for somewhere. Testing
 * only the shape a flag was made for is checklist item 2 exactly.
 *
 * @returns {Promise<Uint8Array>}
 */
async function buildProseFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  for (let row = 0; row < 5; row += 1) {
    page.drawText(`left${String(row)} and more words on the same measure`, {
      x: LEFT_X,
      y: FIRST_BASELINE - row * LEADING,
      size: SIZE,
      font,
    });
  }
  return doc.save({ useObjectStreams: false });
}

/**
 * Reads one page's structured text at the given options.
 *
 * **`asJSON` and not a walk of the object graph**, for `pageText.ts`' reason:
 * MuPDF's serialiser is the authority's own answer to *what did the structuring
 * produce*, and a walk here would be a second opinion about a format MuPDF
 * owns. It is also the same call the product makes, so what this measures is
 * the shipped path rather than a neighbouring one.
 *
 * The `StructuredText` is destroyed in `finally`: it is a native allocation
 * behind a JavaScript handle, and a spike that leaks one per reading holds
 * every page of every fixture for the length of the run.
 *
 * @param {mupdf.Document} doc @param {string} options
 * @returns {string} MuPDF's JSON, unparsed, so the shipped parser can be handed
 *   exactly what the engine sent rather than a re-serialisation of it
 */
function readStextJson(doc, options) {
  const structured = doc.loadPage(0).toStructuredText(options);
  try {
    return structured.asJSON();
  } finally {
    structured.destroy();
  }
}

/** @param {mupdf.Document} doc @param {string} options @returns {unknown} */
function readStext(doc, options) {
  return JSON.parse(readStextJson(doc, options));
}

/**
 * What the reading says about the two-column question.
 *
 * The one number that matters is **merged**: a line holding text from both
 * columns. `order` is the second — the concatenated reading order, which is
 * where a row-major grouping shows itself even when every line is clean.
 *
 * ## THIS WALK WAS BLIND AND REPORTED ZERO, 2026-09-02
 *
 * It read `page.blocks[].lines` only. Under `FZ_STEXT_SEGMENT` MuPDF returns
 * **nested** blocks — `{"type":"structure","contents":[…]}` — so every line sat
 * one level down and the summary said *0 lines, 0 merged*, which reads exactly
 * like a page that segmented cleanly. Item 4b in a renderer: the reassuring
 * answer, produced by a walk that could not see.
 *
 * The recursion is the fix; {@link CONTROL_PAGE} is what stops it recurring,
 * because a walk that breaks again will report zero for a shape known to hold
 * two lines and one merge.
 *
 * @param {any} node a page or a structure block
 * @returns {{ blocks: number, lines: number, merged: number, order: string[] }}
 */
function summarise(node) {
  const children = Array.isArray(node?.blocks)
    ? node.blocks
    : Array.isArray(node?.contents)
      ? node.contents
      : [];

  let blocks = 0;
  let lines = 0;
  let merged = 0;
  /** @type {string[]} */
  const order = [];

  for (const block of children) {
    if (Array.isArray(block?.contents)) {
      const inner = summarise(block);
      blocks += inner.blocks;
      lines += inner.lines;
      merged += inner.merged;
      order.push(...inner.order);
      continue;
    }
    blocks += 1;
    for (const line of block?.lines ?? []) {
      lines += 1;
      const text = String(line?.text ?? '');
      if (text.includes('left') && text.includes('right')) merged += 1;
      order.push(text);
    }
  }

  return { blocks, lines, merged, order };
}

/**
 * A page shape this walk is KNOWN to be able to read, in the nested form.
 *
 * Checklist 4b: a walk that finds nothing and a page that holds nothing produce
 * the same summary, and *nothing merged* is the answer this spike hopes for —
 * so the walk must locate something known-present on every run or its silence
 * is worthless. Two lines, one of them merged, one level down.
 */
const CONTROL_PAGE = {
  blocks: [
    {
      type: 'structure',
      contents: [
        { type: 'text', lines: [{ text: 'left9 right9' }, { text: 'left8' }] },
      ],
    },
  ],
};

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'monstera-textstructure-'));
  /** @type {mupdf.Document[]} */
  const opened = [];

  /**
   * Opens a fixture through the package, and remembers it so `finally` can
   * destroy it.
   *
   * **The bytes are also written to disk**, unchanged from when this went
   * through the shim. Nothing here reads them back; they are what makes a
   * surprising reading reproducible by hand against another tool, which is the
   * one thing a research instrument owes a reader who does not believe it.
   *
   * @param {string} name @param {Uint8Array} bytes @returns {mupdf.Document}
   */
  const openFixture = (name, bytes) => {
    writeFileSync(join(workspace, `${name}.pdf`), bytes);
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    opened.push(doc);
    return doc;
  };

  try {
    const wide = await buildTwoColumnFixture();
    const truth = wide.truth;
    const doc = openFixture('two-column-wide', wide.bytes);

    const settings = [
      { name: 'default (no options)', options: NO_OPTIONS },
      { name: 'SEGMENT', options: SEGMENT },
      { name: 'SEGMENT | TABLE_HUNT', options: SEGMENT_AND_TABLE_HUNT },
    ];

    // THE WALK PROVES IT CAN SEE BEFORE IT REPORTS ANYTHING. Nested blocks are
    // the shape it was blind to once; a summariser that has silently lost the
    // recursion again would print the same clean zeros as a clean page.
    const control = summarise(CONTROL_PAGE);
    if (control.lines !== 2 || control.merged !== 1) {
      throw new Error(
        `the summariser cannot read its own control (${JSON.stringify(control)}). Every number ` +
          `below would be a zero produced by a blind walk, which is the answer this spike ` +
          `hopes for and must never be handed for free.`,
      );
    }

    process.stdout.write(
      `\nCONTROL: the walk reads 2 lines and 1 merge from a nested page it is known to hold.\n\n` +
        `GROUND TRUTH: ${String(truth.length)} runs, 2 columns x 5 rows, columns sharing every\n` +
        `baseline. A grouper keying on baseline alone yields 5 merged lines and reads across\n` +
        `the gutter; the correct answer is 10 lines, 0 merged, and a reading order that gives\n` +
        `all five left runs before any right one.\n\n`,
    );

    if (process.argv.includes('--raw')) {
      for (const setting of settings) {
        const raw = readStext(doc, setting.options);
        process.stdout.write(`===== ${setting.name} =====\n${JSON.stringify(raw, null, 1)}\n\n`);
      }
      return;
    }

    /** @type {Array<{ fixture: string, setting: string, blocks: number, lines: number, merged: number, order: string }>} */
    const rows = [];

    /** @param {string} fixture @param {mupdf.Document} handle @param {boolean} twoColumn */
    const report = (fixture, handle, twoColumn) => {
      process.stdout.write(`  ${fixture}\n`);
      for (const setting of settings) {
        const summary = summarise(readStext(handle, setting.options));
        // COLUMN-MAJOR is the property search and extraction actually need: all
        // of one column before any of the other. Row-major reads across the
        // gutter even when every individual line is clean, which is why
        // `merged` alone would report this page as handled.
        const order = !twoColumn
          ? 'n/a'
          : summary.order.slice(0, 5).every((text) => text.startsWith('left'))
            ? 'COLUMN-major'
            : 'row-major';
        rows.push({ fixture, setting: setting.name, ...summary, order });
        process.stdout.write(
          `    ${setting.name.padEnd(22)} blocks ${String(summary.blocks).padStart(3)}  ` +
            `lines ${String(summary.lines).padStart(3)}  MERGED ${String(summary.merged).padStart(3)}  ` +
            `order ${order}\n` +
            `      ${summary.order.join(' | ')}\n`,
        );
      }
      process.stdout.write('\n');
    };

    report('two columns, 268pt gutter', doc, true);

    // THE SHIPPED PARSER AGAINST THE REAL ENGINE, not against a transcription.
    // The unit tests feed `parsePageText` a payload written by hand from a
    // reading — which is the first caller's problem in miniature: a fixture
    // that is my transcription of MuPDF can be wrong in exactly the way that
    // makes both the fixture and the parser agree. This is the only place the
    // two meet with nothing hand-copied between them.
    process.stdout.write('  THE SHIPPED PARSER, over the real engine output\n');
    const columnMajorTruth = [
      ...truth.filter((run) => run.column === 'left').map((run) => run.text),
      ...truth.filter((run) => run.column === 'right').map((run) => run.text),
    ];
    for (const setting of settings) {
      const page = parsePageText(readStextJson(doc, setting.options));
      const score = scoreAgainstTruth(page, columnMajorTruth);
      process.stdout.write(
        `    ${setting.name.padEnd(22)} lines ${score.lines.toFixed(2)}  order ${score.order.toFixed(2)}` +
          `${score.missing.length > 0 ? `  missing ${score.missing.join(',')}` : ''}\n`,
      );
    }
    process.stdout.write('\n');

    // THE HARD SHAPES. An option measured only on the layout it was made for is
    // checklist item 2, and the two below are where a segmentation decision
    // would go wrong in opposite directions: a gutter too narrow to detect, and
    // a page that already reads correctly and can only be made worse.
    const narrow = await buildTwoColumnFixture(LEFT_X + 60);
    report('two columns, 60pt gutter', openFixture('two-column-narrow', narrow.bytes), true);

    report('single-column prose', openFixture('prose', await buildProseFixture()), false);

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    }
  } finally {
    // EVERY DOCUMENT, including the ones a `--raw` run returned early past.
    // The list is appended to at open rather than tracked per branch, so a
    // future early return cannot leave one behind.
    for (const doc of opened) doc.destroy();
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
