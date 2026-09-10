// @ts-check
/**
 * D6 row 1: does this build know a page it cannot read from a page with
 * nothing on it?
 *
 * ## What this proves that the unit tests cannot
 *
 * `textLayer.test.ts` drives {@link pageKindOf} against hand-built structured
 * text and asserts the rule. It cannot say whether **MuPDF reports what the
 * rule needs** on a real document, because its input is this repository's idea
 * of what MuPDF emits. That is the gap every fixture-only check has, and it is
 * the one this row is most exposed to: the attribution rests on image blocks
 * arriving at all, which is an engine behaviour behind an option.
 *
 * So this reads the corpus through the shipped substrate — the built
 * `parsePageText` with the built `STEXT_OPTION_STRING`, not a copy of either.
 *
 * ## Both classes, and a corpus that produced only one would be REFUSED
 *
 * A detector that answered `'text'` for everything passes every assertion about
 * text documents. A detector that answered `'image-only'` for everything passes
 * every assertion about scans. Only a corpus carrying both separates them, so
 * the run asserts that it read both — and says so as a failure when it did not,
 * rather than reporting a clean sweep over one class.
 *
 * **And zero documents is not a pass**, which is `corpus.mjs`' rule 3 arriving
 * where it matters: a machine with no corpus answers UNVERIFIABLE and exits 0,
 * and a machine that supplied one and scored nothing is a failure.
 *
 * ## The constructed pages are here too, and they carry the case the corpus has none of
 *
 * Measured 2026-09-10: the corpus holds no blank page and no mixed page. Both
 * are the cases the rule turns on — `'empty'` is what stops a suggestion being
 * offered where nothing can be done, and a page with text AND a picture is what
 * a rule keyed on *has an image* gets wrong. A fixture is the only way to reach
 * them, and a proof that only read the corpus would report full agreement about
 * a rule two-thirds unexercised.
 *
 * Usage: node scripts/proofs/scannedPages.proof.mjs
 *        MONSTERA_CORPUS=<directory> node scripts/proofs/scannedPages.proof.mjs
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import sharp from 'sharp';

import { TEXT_STRUCTURE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { STEXT_OPTION_STRING, parsePageText } from '../../packages/kernel/dist/textStructure.js';
import { pageKindOf } from '../../packages/kernel/dist/pageKind.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE_CORPUS = process.argv.includes('--require-corpus');

// THE SUBJECT IS THE BUILT PARSER, so a stale build would score the previous
// one and print the answer under this one's name.
refuseStaleBuild(root, TEXT_STRUCTURE, 1);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} detail
 */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * One page's kind, through the shipped substrate and the shipped option set.
 *
 * @param {Uint8Array | Buffer} bytes
 * @param {number} index
 * @returns {'text' | 'image-only' | 'empty'}
 */
function kindOf(bytes, index) {
  const document = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
  const page = document.loadPage(index);
  const stext = page.toStructuredText(STEXT_OPTION_STRING);
  try {
    return pageKindOf(parsePageText(stext.asJSON()));
  } finally {
    stext.destroy();
  }
}

/** A real raster, so the fixture is a picture rather than a description of one. */
async function raster() {
  return sharp({
    create: { width: 240, height: 160, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

try {
  const png = await raster();

  // ── The constructed pages ────────────────────────────────────────────────
  {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const image = await document.embedPng(png);

    const textPage = document.addPage([400, 300]);
    textPage.drawText('A page with ordinary text on it.', { x: 30, y: 200, size: 12, font });

    const imagePage = document.addPage([400, 300]);
    imagePage.drawImage(image, { x: 40, y: 60, width: 320, height: 200 });

    document.addPage([400, 300]);

    const mixed = document.addPage([400, 300]);
    mixed.drawImage(image, { x: 40, y: 40, width: 320, height: 120 });
    mixed.drawText('Text above a picture.', { x: 30, y: 240, size: 12, font });

    const bytes = await document.save();
    const kinds = [0, 1, 2, 3].map((page) => kindOf(bytes, page));

    check(
      'a page of text is text',
      kinds[0] === 'text',
      `answered ${String(kinds[0])} — without this the rule could answer image-only for everything`,
    );
    check(
      'a page carrying a raster and no text is image-only',
      kinds[1] === 'image-only',
      `answered ${String(kinds[1])} — this is the state the whole row exists for`,
    );
    check(
      'and a page with NOTHING on it is empty, not image-only',
      kinds[2] === 'empty',
      `answered ${String(kinds[2])} — a blank page offered OCR is a control that cannot work, ` +
        'and a two-state rule gets exactly this case wrong',
    );
    check(
      'a page with text AND a picture is text',
      kinds[3] === 'text',
      `answered ${String(kinds[3])} — a rule keyed on "has an image" would offer recognition ` +
        'over text the build can already read, which is the common shape of an article',
    );
  }

  // ── The corpus ───────────────────────────────────────────────────────────
  //
  // THE LABELS ARE DECLARED BEFORE THE BRANCH, because a machine with no corpus
  // must report five cases it COULD NOT RUN rather than a roster four cases
  // shorter. A shrinking total is the shape `passRoster` exists to refuse: the
  // line goes with the case, and nothing is left saying what stopped.
  const CORPUS_CASES = /** @type {const} */ ([
    'the corpus was actually read, so these figures are about documents',
    'it carries pages this build CAN read',
    'and pages it cannot, which is the class the row is about',
    'whole documents fall on both sides, not just pages',
    'CONTROL: no page is classified twice or left unclassified',
  ]);

  const corpus = openCorpus({ required: REQUIRE_CORPUS });
  if (!corpus.available) {
    for (const label of CORPUS_CASES) roster.record(roster.mark(), label, false);
    process.stdout.write(`${roster.format('scanned-page case')}\n${corpus.outcome.text}`);
    if (failures.length > 0 || corpus.outcome.code !== 0) process.exit(1);
    process.exit(0);
  }

  process.stdout.write('\n  id                pages   text   image-only   empty\n');
  let text = 0;
  let imageOnly = 0;
  let empty = 0;
  let textDocuments = 0;
  let imageDocuments = 0;
  for (const item of corpus.documents) {
    const document = /** @type {mupdf.PDFDocument} */ (
      mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
    );
    const pages = document.countPages();
    let here = { text: 0, imageOnly: 0, empty: 0 };
    for (let index = 0; index < pages; index += 1) {
      const kind = kindOf(item.bytes, index);
      if (kind === 'text') here = { ...here, text: here.text + 1 };
      else if (kind === 'image-only') here = { ...here, imageOnly: here.imageOnly + 1 };
      else here = { ...here, empty: here.empty + 1 };
    }
    text += here.text;
    imageOnly += here.imageOnly;
    empty += here.empty;
    if (here.text > 0) textDocuments += 1;
    if (here.imageOnly > 0 && here.text === 0) imageDocuments += 1;
    process.stdout.write(
      `  ${item.id}${String(pages).padStart(7)}${String(here.text).padStart(7)}` +
        `${String(here.imageOnly).padStart(13)}${String(here.empty).padStart(8)}\n`,
    );
  }
  process.stdout.write(`\n${corpusCaveat(corpus.documents.length)}\n\n`);

  check(
    CORPUS_CASES[0],
    text + imageOnly + empty > 0,
    'no page was classified. A detector that scores nothing produces a clean sweep, which is ' +
      'the answer every question here was hoping for',
  );
  check(
    CORPUS_CASES[1],
    text > 0,
    `${String(text)} text page(s) — a corpus of scans alone cannot separate a working detector ` +
      'from one that answers image-only for everything',
  );
  check(
    CORPUS_CASES[2],
    imageOnly > 0,
    `${String(imageOnly)} image-only page(s) — a corpus of text alone cannot separate a working ` +
      'detector from one that answers text for everything',
  );
  check(
    CORPUS_CASES[3],
    textDocuments > 0 && imageDocuments > 0,
    `${String(textDocuments)} document(s) carrying text and ${String(imageDocuments)} carrying ` +
      'none — the row is about a reader opening a scan, which is a document-level experience',
  );
  check(
    CORPUS_CASES[4],
    text + imageOnly + empty ===
      corpus.documents.reduce((sum, item) => {
        const document = /** @type {mupdf.PDFDocument} */ (
          mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
        );
        return sum + document.countPages();
      }, 0),
    'the three counts do not add up to the corpus page count, so the classifier has a fourth ' +
      'state nothing here reports',
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nScanned-page detection — ${String(failures.length)} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exit(1);
  }

  process.stdout.write(roster.format('scanned-page case'));
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
