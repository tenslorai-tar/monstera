// @ts-check
/**
 * The handwriting engine reads a region, end to end, with the real stack.
 *
 * ## What this proves that `ocrHandwriting.test.ts` cannot
 *
 * That file checks the two halves that need no download — the raster carries
 * ink, and each tokenizer family decodes its own pieces. Both are necessary and
 * neither says the pipeline works: a correct raster handed to a runtime that
 * will not load, or a decoder wired to the wrong output name, fails nowhere they
 * look.
 *
 * So this one runs it: MuPDF rasterises a region of a real document, the ONNX
 * runtime loads **from the downloaded files**, the encoder and decoder run, and
 * the ids come back as text.
 *
 * ## The models are not in this repository and never will be
 *
 * 67 MB at the smallest, downloaded on demand and never bundled
 * (`BUILD-PROMPT.md`:806, ADR-0052). So the cases below need a cache and say so
 * loudly when there is none: **NOT APPLICABLE is printed apart from the passes**,
 * because a run that could not look must never read as a run that looked and
 * found nothing.
 *
 * Point it at one with `MONSTERA_HANDWRITING_CACHE`. In the shipped application
 * that directory is under `userData` and the application fills it; here it is
 * whatever a reader downloaded with the manifest's own URLs and digests.
 *
 * ## What it does NOT assert, and the distinction matters
 *
 * **Not accuracy.** The fixture is drawn text in a standard font, because a
 * labelled handwriting sample is not something this repository has — the corpus
 * is not one either, since its content may not be quoted. What is asserted is
 * that the pipeline produces the *right kind of answer*: a line, at the region's
 * own box, with text in it. A recognition that reads one character wrong passes
 * here, and should: this is a wiring proof.
 *
 * **And the case that matters most is the BLANK one.** TrOCR answers an empty
 * image with a confident sentence, measured — so *it produced text* is not
 * evidence that it read anything. The pair below is what separates them.
 *
 * Usage: MONSTERA_HANDWRITING_CACHE=<directory> node scripts/proofs/ocrHandwriting.proof.mjs
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { artefactsFor } from '../../packages/kernel/dist/handwritingArtefacts.js';
import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { recogniseHandwriting } from '../../packages/kernel/dist/ocrHandwriting.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/ocrHandwriting.ts', 'packages/kernel/dist/ocrHandwriting.js', 'tsc'],
    [
      'packages/kernel/src/handwritingArtefacts.ts',
      'packages/kernel/dist/handwritingArtefacts.js',
      'tsc',
    ],
  ],
  2,
);

/** @type {string[]} */
const failures = [];

/** A LITERAL, not `CASES.length`: a case leaving the file must be loud. */
const DECLARED_CASES = 5;
const roster = createRoster(failures, { cases: DECLARED_CASES });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const SIZE = 'small';
const cache = process.env['MONSTERA_HANDWRITING_CACHE'] ?? '';
const missing =
  cache === ''
    ? ['the MONSTERA_HANDWRITING_CACHE variable is not set']
    : artefactsFor(SIZE)
        .filter((artefact) => !existsSync(join(cache, artefact.file)))
        .map((artefact) => artefact.file);

if (missing.length > 0) {
  // NOT APPLICABLE, PRINTED APART FROM ANY PASS, and exiting 0 — because a
  // machine without the download has not failed this proof, it has not run it.
  // The distinction is the one `check:unverifiablespelling` exists to keep
  // visible: "could not look" is never "looked and found nothing".
  process.stdout.write(
    `\nNOT APPLICABLE — ${String(DECLARED_CASES)} handwriting case(s) did not run.\n\n` +
      `  The handwriting stack is downloaded on demand and never bundled, so this machine may\n` +
      `  simply not have it. Missing: ${missing.join(', ')}\n\n` +
      `  Set MONSTERA_HANDWRITING_CACHE to a directory holding the manifest's files. Their\n` +
      `  URLs and SHA-256 digests are in packages/kernel/src/handwritingArtefacts.ts, which is\n` +
      `  the one place that names them.\n`,
  );
  process.exit(0);
}

/** One line of text, drawn by us — never the corpus, whose content may not be quoted. */
const LINE = 'Monstera deliciosa';
const INK_REGION = /** @type {const} */ ([30, 180, 370, 230]);
/** Well clear of the line on the same page. */
const BLANK_REGION = /** @type {const} */ ([30, 40, 370, 90]);

const document = await PDFDocument.create();
const page = document.addPage([400, 300]);
page.drawText(LINE, {
  x: 40,
  y: 195,
  size: 26,
  font: await document.embedFont(StandardFonts.Helvetica),
});
const bytes = await document.save();

const session = await mupdfWriter.open(bytes);
try {
  const read = await recogniseHandwriting(session, {
    page: 0,
    region: INK_REGION,
    size: SIZE,
    modelDirectory: cache,
  });

  check(
    'a region carrying one line comes back as ONE line with text in it',
    read.lines.length === 1 && (read.lines[0]?.text.length ?? 0) > 0,
    `lines=${String(read.lines.length)} text=${JSON.stringify(read.lines[0]?.text ?? null)}`,
  );

  check(
    'the line is at the REGION’s own box, ordered, and carries no invented word boxes',
    JSON.stringify(read.lines[0]?.box) === JSON.stringify([...INK_REGION]) &&
      read.lines[0]?.words.length === 0,
    `box=${JSON.stringify(read.lines[0]?.box)} words=${String(read.lines[0]?.words.length)}`,
  );

  check(
    'the answer names ENG, which is the model that read it rather than a language it was asked for',
    read.language === 'eng' && read.confidence > 0 && read.confidence <= 100,
    `language=${read.language} confidence=${String(read.confidence)}`,
  );

  // THE CASE THAT MATTERS MOST, and it is a negative one built from an input the
  // absent guard lets through: the same page, the same call, a region with
  // nothing in it. TrOCR answers a blank image with a fluent sentence — measured
  // 2026-09-11, when a double-applied page transform produced a white square and
  // the model read a paragraph about the United States off it.
  //
  // So what this asserts is that the RASTER is the region: an engine handed a
  // blank square still says something, and a build whose region conversion is
  // wrong would pass every case above with exactly that answer.
  const blank = await recogniseHandwriting(session, {
    page: 0,
    region: BLANK_REGION,
    size: SIZE,
    modelDirectory: cache,
  });

  check(
    'CONTROL: an empty region does NOT come back with the inked region’s text',
    blank.lines[0]?.text !== read.lines[0]?.text,
    `ink=${JSON.stringify(read.lines[0]?.text ?? null)} blank=${JSON.stringify(blank.lines[0]?.text ?? null)}`,
  );

  check(
    'the region is required: a page-scoped request is not a shape this engine accepts',
    // Reached by the TYPE at every real call site; here the value is constructed
    // to show the runtime refuses it too, rather than asserting the compiler works.
    await recogniseHandwriting(session, {
      page: 0,
      region: /** @type {never} */ ([100, 100, 100, 200]),
      size: SIZE,
      modelDirectory: cache,
    }).then(
      () => false,
      (error) => /has no area/u.test(String(error?.message)),
    ),
    'a zero-area region must be refused rather than rasterised as nothing',
  );
} catch (error) {
  failures.push(`the handwriting pipeline threw\n      ${formatError(error)}`);
} finally {
  await mupdfWriter.close(session);
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} handwriting case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('handwriting case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
