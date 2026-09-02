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
import koffi from 'koffi';

import { scoreAgainstTruth } from '../../packages/kernel/dist/textAccuracy.js';
import { parsePageText } from '../../packages/kernel/dist/textStructure.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { requireCurrentShim } from '../lib/shimBinary.mjs';

const ROOT = repoRoot();

// THE SHIPPED PARSER IS READ FROM `dist`, so a stale build would have this
// reporting about code nobody is running — and this session watched exactly
// that happen, when a reverted mutation left two source files newer than the
// renderer bundle. The shim has its own freshness guard in `requireCurrentShim`;
// this is the same question asked of the TypeScript side.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/textStructure.ts', 'packages/kernel/dist/textStructure.js', 'tsc'],
    ['packages/kernel/src/textAccuracy.ts', 'packages/kernel/dist/textAccuracy.js', 'tsc'],
  ],
  2,
);

const lib = koffi.load(requireCurrentShim({ root: ROOT }));
const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');
const mz_stext_json = lib.func(
  'int mz_stext_json(void *c, void *d, int number, int flags, _Out_ char *out, int len, _Out_ double *needed)',
);

/** MuPDF's own option bits, from `include/mupdf/fitz/structured-text.h`. */
const FZ_STEXT_SEGMENT = 4096;
const FZ_STEXT_TABLE_HUNT = 16384;

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
 * Reads one page's structured text at the given flags.
 *
 * **The buffer is grown until it fits rather than assumed large enough.** The
 * shim reports the full length in `needed`, so a short read is a measurable
 * state; treating the first answer as complete would silently truncate JSON and
 * the parse would fail somewhere unrelated.
 *
 * @param {unknown} ctx @param {unknown} doc @param {number} flags
 * @returns {string} MuPDF's JSON, unparsed, so the shipped parser can be handed
 *   exactly what the engine sent rather than a re-serialisation of it
 */
function readStextJson(ctx, doc, flags) {
  let size = 1 << 16;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const buffer = Buffer.alloc(size);
    const needed = [0];
    if (mz_stext_json(ctx, doc, 0, flags, buffer, size, needed) !== 0) {
      throw new Error(`mz_stext_json failed — ${String(mz_last_error(ctx))}`);
    }
    const full = Number(needed[0]);
    if (full < size) {
      return buffer.subarray(0, full).toString('utf8');
    }
    size = full + 1024;
  }
  throw new Error('the structured-text buffer never converged, which is a bug in this loop');
}

/** @param {unknown} ctx @param {unknown} doc @param {number} flags @returns {unknown} */
function readStext(ctx, doc, flags) {
  return JSON.parse(readStextJson(ctx, doc, flags));
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
  const ctxOut = [null];
  if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
  const ctx = ctxOut[0];

  /** @param {string} name @param {Uint8Array} bytes @returns {unknown} */
  const openFixture = (name, bytes) => {
    const path = join(workspace, `${name}.pdf`);
    writeFileSync(path, bytes);
    const docOut = [null];
    if (mz_open(ctx, path, docOut) !== 0) {
      throw new Error(`mz_open ${name} failed — ${String(mz_last_error(ctx))}`);
    }
    return docOut[0];
  };

  try {
    const wide = await buildTwoColumnFixture();
    const truth = wide.truth;
    const doc = openFixture('two-column-wide', wide.bytes);

    const settings = [
      { name: 'default (no options)', flags: 0 },
      { name: 'SEGMENT', flags: FZ_STEXT_SEGMENT },
      { name: 'SEGMENT | TABLE_HUNT', flags: FZ_STEXT_SEGMENT | FZ_STEXT_TABLE_HUNT },
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
        const raw = readStext(ctx, doc, setting.flags);
        process.stdout.write(`===== ${setting.name} =====\n${JSON.stringify(raw, null, 1)}\n\n`);
      }
      mz_close(ctx, doc);
      return;
    }

    /** @type {Array<{ fixture: string, setting: string, blocks: number, lines: number, merged: number, order: string }>} */
    const rows = [];

    /** @param {string} fixture @param {unknown} handle @param {boolean} twoColumn */
    const report = (fixture, handle, twoColumn) => {
      process.stdout.write(`  ${fixture}\n`);
      for (const setting of settings) {
        const summary = summarise(readStext(ctx, handle, setting.flags));
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
      const page = parsePageText(readStextJson(ctx, doc, setting.flags));
      const score = scoreAgainstTruth(page, columnMajorTruth);
      process.stdout.write(
        `    ${setting.name.padEnd(22)} lines ${score.lines.toFixed(2)}  order ${score.order.toFixed(2)}` +
          `${score.missing.length > 0 ? `  missing ${score.missing.join(',')}` : ''}\n`,
      );
    }
    process.stdout.write('\n');

    mz_close(ctx, doc);

    // THE HARD SHAPES. A flag measured only on the layout it was made for is
    // checklist item 2, and the two below are where a segmentation decision
    // would go wrong in opposite directions: a gutter too narrow to detect, and
    // a page that already reads correctly and can only be made worse.
    const narrow = await buildTwoColumnFixture(LEFT_X + 60);
    const narrowDoc = openFixture('two-column-narrow', narrow.bytes);
    report('two columns, 60pt gutter', narrowDoc, true);
    mz_close(ctx, narrowDoc);

    const proseDoc = openFixture('prose', await buildProseFixture());
    report('single-column prose', proseDoc, false);
    mz_close(ctx, proseDoc);

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    }
  } finally {
    mz_drop(ctx);
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
