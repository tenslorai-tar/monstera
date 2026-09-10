// @ts-check
/**
 * Can Tesseract's core be driven directly, with no wrapper?
 *
 * ## The question, and why it had to be answered before a line was written
 *
 * `BUILD-PROMPT.md`:473 names `tesseract.js`, and that package cannot be a
 * production dependency of this build: its tree reaches `tr46@0.0.3`, which
 * ships **no licence file of any kind** while declaring MIT, and
 * `scripts/release/generateNotice.mjs` refuses to render a NOTICE for it —
 * *an SPDX identifier is not a licence notice; the terms have to travel with
 * the software*. `tesseract.js-core` is the package the WASM is actually in, it
 * declares **no dependencies at all**, and it ships an Apache-2.0 LICENSE.
 *
 * So the question is not *is the core smaller*. It is **does the core answer
 * the same questions**, and this file is the measurement
 * ([ADR-0050](../../docs/DECISIONS/0050-the-ocr-binding-is-tesseracts-core-driven-directly.md)).
 *
 * ## THE SUBJECT IS THE ONE THE WRAPPER WAS PROBED WITH
 *
 * Same corpus document, same page, same rasteriser, same dpi. A comparison
 * against a different page would separate nothing — the reassuring answer here
 * is *the core reads it too*, and almost any page produces that.
 *
 * ## Nothing from the document is printed
 *
 * Recognised text **is** the document's text, so rule 1 in
 * `scripts/lib/corpus.mjs` covers it exactly as it covers the filename. What is
 * printed is shape: counts, geometry coverage, confidence, and the proportion
 * of characters that are letters — which separates real words from a page of
 * noise without quoting any of it.
 *
 * Usage: MONSTERA_CORPUS=<directory> node scripts/research/ocrCore.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import * as mupdf from 'mupdf';

import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { tessdataPath } from '../provision/tessdata.mjs';

const require = createRequire(import.meta.url);

/**
 * What the page is rasterised at.
 *
 * 200, because that is what `7beee3a` measured the wrapper at. A different
 * number would make every figure below incomparable with the ones this file
 * exists to compare against.
 */
const DPI = 200;

/**
 * The core builds, most capable first.
 *
 * **Tried in order rather than feature-detected**, which is what lets this take
 * no dependency: `tesseract.js` reaches for `wasm-feature-detect` here, and the
 * question *can this runtime instantiate this module* is answered exactly by
 * instantiating it. A build that will not load throws at that point and the
 * next is tried.
 *
 * `-lstm` because `Init` below asks for the LSTM engine, which is Tesseract 4's
 * and the only one the `4.0.0_fast` models carry.
 */
const CORE_BUILDS = [
  // EACH SPECIFIER IS A LITERAL, and the loop is over thunks rather than over
  // names. A computed `require(`tesseract.js-core/${build}`)` is a site
  // `proof:electronimports` cannot read, and it reported this file on its first
  // run — correctly, since a specifier a scan cannot resolve is a place where
  // the rule has no answer. A literal is also what a bundler can follow.
  { name: 'tesseract-core-relaxedsimd-lstm', load: () => require('tesseract.js-core/tesseract-core-relaxedsimd-lstm') },
  { name: 'tesseract-core-simd-lstm', load: () => require('tesseract.js-core/tesseract-core-simd-lstm') },
  { name: 'tesseract-core-lstm', load: () => require('tesseract.js-core/tesseract-core-lstm') },
];

/** Tesseract's `OEM_LSTM_ONLY`. */
const LSTM_ONLY = 1;

/**
 * The first corpus page carrying no text — which is what OCR is for.
 *
 * @returns {{ id: string, png: Uint8Array, documents: number }}
 */
function firstImageOnlyPage() {
  const corpus = openCorpus();
  if (!corpus.available) throw new Error(corpus.outcome.text);
  for (const item of corpus.documents) {
    const document = /** @type {mupdf.PDFDocument} */ (
      mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
    );
    const page = document.loadPage(0);
    const stext = page.toStructuredText('segment');
    const json = stext.asJSON();
    stext.destroy();
    if (json.includes('"text"')) continue;
    const scale = DPI / 72;
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const png = pixmap.asPNG();
    pixmap.destroy();
    return { id: item.id, png: new Uint8Array(png), documents: corpus.documents.length };
  }
  throw new Error(
    'no corpus document has a textless first page, so there is nothing here to recognise — ' +
      'which is a corpus this measurement cannot be taken against, not a result',
  );
}

try {
  process.stdout.write('# Tesseract, without the wrapper\n\n');

  const { id, png, documents } = firstImageOnlyPage();
  process.stdout.write(
    `  subject: ${id}, page 1, rasterised at ${String(DPI)} dpi through MuPDF ` +
      `(${String(png.length)} PNG bytes)\n\n`,
  );

  process.stdout.write('## Which build loads here\n\n');
  let core = null;
  for (const build of CORE_BUILDS) {
    const started = Date.now();
    try {
      const factory = build.load();
      const instance = await factory();
      process.stdout.write(`  ${build.name}: instantiated in ${String(Date.now() - started)} ms\n`);
      core = instance;
      break;
    } catch (error) {
      process.stdout.write(
        `  ${build.name}: REFUSED — ${error instanceof Error ? error.message.slice(0, 100) : String(error)}\n`,
      );
    }
  }
  if (core === null) {
    throw new Error(
      `no core build instantiated on this runtime — tried ` +
        `${CORE_BUILDS.map((build) => build.name).join(', ')}. That is a ` +
        'finding about the runtime rather than about the package, and it is a throw because a ' +
        'zero here would otherwise read as a measurement',
    );
  }

  const model = gunzipSync(readFileSync(tessdataPath(repoRoot(), 'eng')));
  process.stdout.write(`\n  eng model: ${String(model.length)} bytes decompressed\n`);
  core.FS.writeFile('/eng.traineddata', model);

  const api = new core.TessBaseAPI();
  const initStarted = Date.now();
  const status = api.Init(null, 'eng', LSTM_ONLY);
  process.stdout.write(
    `  Init(null, 'eng', LSTM_ONLY) -> ${String(status)} in ${String(Date.now() - initStarted)} ms\n`,
  );
  if (status !== 0) throw new Error(`Init refused with ${String(status)}`);

  core.FS.writeFile('/input', png);
  const setStatus = api.SetImageFile(1, 0);
  if (setStatus !== 0) throw new Error(`SetImageFile refused with ${String(setStatus)}`);

  const started = Date.now();
  api.Recognize(null);
  const recogniseMs = Date.now() - started;

  const text = api.GetUTF8Text();
  const confidence = api.MeanTextConf();
  // THE CORE'S OWN JSON RENDERER, which is what makes `dump.js` unnecessary:
  // one call answers the whole block/paragraph/line/word tree with a `bbox` on
  // every node.
  const tree = JSON.parse(api.GetJSONText());
  const blocks = tree.blocks ?? [];
  let lines = 0;
  let words = 0;
  let boxed = 0;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines += 1;
        for (const word of line.words ?? []) {
          words += 1;
          if (word.bbox !== undefined) boxed += 1;
        }
      }
    }
  }

  process.stdout.write('\n## What it read, against the wrapper at `7beee3a`\n\n');
  process.stdout.write('  measure                    wrapper        core direct\n');
  process.stdout.write(
    `  recognise one A4 page      4.8-5.2 s      ${(recogniseMs / 1000).toFixed(1)} s\n`,
  );
  // TWO SPELLINGS OF "CHARACTERS", printed because they disagree. The wrapper's
  // recorded 2,016 is NON-WHITESPACE characters; `GetUTF8Text().length` counts
  // the newlines and spaces too. A single number here would have read as a
  // difference between the two routes.
  const nonWhitespace = text.replace(/\s/gu, '').length;
  process.stdout.write(
    `  non-whitespace characters  2,016          ${String(nonWhitespace)}\n` +
      `  all characters             —              ${String(text.length)}\n` +
      `  lines / words              41 / 402       ${String(lines)} / ${String(words)}\n` +
      `  words carrying a box       all            ${String(boxed)} of ${String(words)}\n` +
      `  mean confidence            94             ${String(confidence)}\n`,
  );

  process.stdout.write('\n## The renderer that is already in the core\n\n');
  const renderer = new core.TessPDFRenderer('recognised', '/', true);
  renderer.BeginDocument('recognised');
  renderer.AddImage(api);
  renderer.EndDocument();
  const pdf = core.FS.readFile('/recognised.pdf');
  const reread = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(pdf, 'application/pdf')
  );
  const stext = reread.loadPage(0).toStructuredText('segment');
  const rendered = stext.asJSON();
  stext.destroy();
  const spans = (rendered.match(/"text"/gu) ?? []).length;
  process.stdout.write(
    `  TessPDFRenderer(textonly) wrote ${String(pdf.length)} PDF bytes, and MuPDF reads\n` +
      `  ${String(spans)} text span(s) back out of them — D6 rows 3 and 5, from the writer that\n` +
      '  already holds the characters\n',
  );
  if (spans === 0) {
    throw new Error(
      'the renderer produced a PDF this build cannot read text out of, which is the one outcome ' +
        'that would make the two rows above need a different writer',
    );
  }

  api.End();

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  process.stdout.write(
    `\n  ${((100 * letters) / Math.max(1, text.length)).toFixed(1)}% of what it read is letters, ` +
      'which is the shape of prose rather than of noise\n',
  );
  process.stdout.write(`\n${corpusCaveat(documents)}\n`);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
