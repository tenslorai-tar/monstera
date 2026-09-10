// @ts-check
/**
 * What font can carry an invisible text layer, and what does each one refuse?
 *
 * ## The question, asked before the row is built
 *
 * D6 row 3 embeds the recognised text as an **invisible** layer over the page —
 * `@cantoo/pdf-lib` by §3's matrix, whose `drawText` takes
 * `renderMode: TextRenderingMode.Invisible` directly, so the *drawing* half is a
 * registration. What is not settled is the **font**, and it decides whether the
 * feature works on the documents it exists for.
 *
 * A standard PDF font is WinAnsi-encoded. The corpus holds an image-only
 * right-to-left document and an image-only handwritten one, and recognition with
 * the matching model answers characters no WinAnsi font can encode. So the
 * question is not *does it look right* — nothing is drawn — it is **what happens
 * to a character the font cannot encode**, and there are only three answers:
 * it throws, it is silently replaced, or it is silently dropped. Two of those
 * three are a text layer that claims to carry the page's words and does not.
 *
 * ## It does not guess at the remedy either
 *
 * `tesseract.js-core` ships `TessPDFRenderer`, which solves the same problem with
 * a **glyphless CID font** — every character mapped, no outlines, so the text is
 * addressable and invisible by construction. This file measures whether that
 * output is readable by MuPDF and what it weighs, because *borrow the renderer's
 * answer* and *embed a Unicode font of our own* are the two routes and only one
 * of them has a cost nobody here has measured.
 *
 * Usage: node scripts/research/textLayerFont.mjs
 */

import { PDFDocument, StandardFonts, TextRenderingMode } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import {
  CORE_DATA_DIRECTORY,
  OCR_DPI,
  ensureModel,
  loadedCore,
} from '../../packages/kernel/dist/ocrRecognise.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { tessdataDirectory } from '../provision/tessdata.mjs';

// THE CORE IS INSTANTIATED THROUGH THE KERNEL'S OWN LOADER (B3a). *Which build
// of Tesseract does this project instantiate, and how* is one question, and an
// instrument answering it separately would produce figures about a different
// engine from the one the application runs.
refuseStaleBuild(
  repoRoot(),
  [['packages/kernel/src/ocrRecognise.ts', 'packages/kernel/dist/ocrRecognise.js', 'tsc']],
  1,
);

/** The right-to-left models this corpus could need. */
const RTL_LANGUAGES = /** @type {const} */ (['ara', 'heb']);

/**
 * How confident a reading has to be before this file treats it as the language.
 *
 * Not a tuned threshold: the English model read the same page at **32**, so
 * anything materially above that is the model matching rather than the page
 * being legible. Fifty is chosen as plainly above it and plainly below a good
 * reading, and the figure it is compared against is printed beside every row.
 */
const RTL_CONFIDENCE_FLOOR = 50;

/** @param {mupdf.PDFPage} page @returns {Uint8Array} */
function pngOf(page) {
  // `OCR_DPI`, taken from the kernel rather than restated: a page rasterised at
  // a different size is a page with different readings, and the figures here are
  // meant to compare with `proof:ocrrecognise`'s.
  const scale = OCR_DPI / 72;
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false,
    true,
  );
  try {
    return new Uint8Array(pixmap.asPNG());
  } finally {
    pixmap.destroy();
  }
}

/**
 * One reading, with the given model.
 *
 * @param {import('../../packages/kernel/dist/ocrRecognise.js').TesseractCore} core
 * @param {Uint8Array} png
 * @param {'ara' | 'heb'} language
 * @returns {{ confidence: number, text: string }}
 */
function recognised(core, png, language) {
  const api = new core.TessBaseAPI();
  try {
    if (api.Init(CORE_DATA_DIRECTORY, language, 1) !== 0) return { confidence: -1, text: '' };
    core.FS.writeFile('/input', png);
    if (api.SetImageFile(1, 0) !== 0) return { confidence: -1, text: '' };
    api.Recognize(null);
    return { confidence: api.MeanTextConf(), text: api.GetUTF8Text() };
  } finally {
    api.End();
  }
}

/**
 * The core's own text-only PDF for a page, read back through MuPDF.
 *
 * @param {import('../../packages/kernel/dist/ocrRecognise.js').TesseractCore} core
 * @param {Uint8Array} png
 * @param {'ara' | 'heb'} language
 * @returns {{ spans: number, sample: string, bytes: number }}
 */
function renderedLayer(core, png, language) {
  const api = new core.TessBaseAPI();
  try {
    if (api.Init(CORE_DATA_DIRECTORY, language, 1) !== 0) {
      return { spans: 0, sample: '', bytes: 0 };
    }
    core.FS.writeFile('/input', png);
    if (api.SetImageFile(1, 0) !== 0) return { spans: 0, sample: '', bytes: 0 };
    api.Recognize(null);
    const renderer = new core.TessPDFRenderer('layer', CORE_DATA_DIRECTORY, true);
    renderer.BeginDocument('layer');
    renderer.AddImage(api);
    renderer.EndDocument();
    const pdf = core.FS.readFile('/layer.pdf');
    const opened = /** @type {mupdf.PDFDocument} */ (
      mupdf.PDFDocument.openDocument(pdf, 'application/pdf')
    );
    const stext = opened.loadPage(0).toStructuredText('segment');
    const json = stext.asJSON();
    stext.destroy();
    /** @type {string[]} */
    const found = [];
    for (const match of json.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/gu)) {
      found.push(JSON.parse(`"${match[1] ?? ''}"`));
    }
    return { spans: found.length, sample: found.join(''), bytes: pdf.length };
  } finally {
    api.End();
  }
}

/** Scripts a text layer has to carry, and what each one is. */
const SAMPLES = /** @type {const} */ ([
  { label: 'Latin, WinAnsi', text: 'Monstera deliciosa' },
  { label: 'Latin with an accent', text: 'crème brûlée' },
  { label: 'Latin ligature U+FB01', text: 'fiﬁne' },
  { label: 'Cyrillic', text: 'Монстера' },
  { label: 'Arabic, right-to-left', text: 'مونستيرا' },
  { label: 'Hebrew, right-to-left', text: 'מונסטרה' },
  { label: 'Han', text: '龍脈' },
  { label: 'Devanagari', text: 'मोन्स' },
]);

/**
 * Draws one sample invisibly and reports what happened.
 *
 * @param {string} text
 * @returns {Promise<{ outcome: string, bytes: number, readBack: string }>}
 */
async function drawn(text) {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 100]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  try {
    page.drawText(text, {
      x: 20,
      y: 40,
      size: 18,
      font,
      // THE WHOLE POINT OF THE ROW: the characters are addressable and nothing
      // is painted. pdf-lib takes this directly, so the drawing half needs no
      // operator pushing of our own.
      renderMode: TextRenderingMode.Invisible,
    });
  } catch (error) {
    return {
      outcome: `THREW — ${error instanceof Error ? error.message.slice(0, 90) : String(error)}`,
      bytes: 0,
      readBack: '',
    };
  }
  const bytes = await document.save();
  // READ BACK THROUGH MuPDF, which is the reader the application ships. A layer
  // pdf-lib wrote and nothing can extract is the failure this row exists to
  // avoid, and asking pdf-lib what it wrote would be asking the writer.
  const opened = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
  const stext = opened.loadPage(0).toStructuredText('segment');
  const json = stext.asJSON();
  stext.destroy();
  /** @type {string[]} */
  const found = [];
  for (const match of json.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/gu)) {
    const raw = match[1] ?? '';
    found.push(JSON.parse(`"${raw}"`));
  }
  return { outcome: 'drew', bytes: bytes.length, readBack: found.join('') };
}

/** Codepoints of a string, for comparing without relying on a console's fonts. */
function points(/** @type {string} */ text) {
  return [...text].map((character) => (character.codePointAt(0) ?? 0).toString(16).toUpperCase()).join(' ');
}

try {
  process.stdout.write('# What font can carry an invisible text layer?\n\n');
  process.stdout.write(
    '  Drawn with `renderMode: Invisible` through @cantoo/pdf-lib and a STANDARD font,\n' +
      '  then read back through MuPDF — the reader this application ships.\n\n',
  );

  let refused = 0;
  let mangled = 0;
  for (const sample of SAMPLES) {
    const result = await drawn(sample.text);
    const faithful = result.readBack === sample.text;
    if (result.outcome.startsWith('THREW')) refused += 1;
    else if (!faithful) mangled += 1;
    process.stdout.write(`  ${sample.label.padEnd(24)} ${result.outcome}\n`);
    if (result.outcome === 'drew') {
      process.stdout.write(
        `  ${' '.repeat(24)} asked for  ${points(sample.text)}\n` +
          `  ${' '.repeat(24)} read back  ${points(result.readBack)}` +
          `${faithful ? '  — identical' : '  — DIFFERENT'}\n`,
      );
    }
  }

  process.stdout.write(
    `\n  ${String(refused)} of ${String(SAMPLES.length)} refused outright, ` +
      `${String(mangled)} drew something the reader did not get back.\n`,
  );
  if (refused === 0 && mangled === 0) {
    // THE REASSURING ANSWER, REFUSED. A standard font encoding Arabic and Han is
    // not a thing that happens, so an all-clear here means this file is not
    // measuring what it claims — most likely the read-back parse found nothing
    // and compared two empty strings.
    throw new Error(
      'every sample round-tripped through a WinAnsi standard font, including Arabic and Han. ' +
        'That cannot be true, so this instrument is not reading what it thinks it is.',
    );
  }
  process.stdout.write(
    '\n  A standard font is therefore not the answer for the documents this row exists for:\n' +
      '  the corpus holds an image-only right-to-left document, and recognition with the\n' +
      '  matching model answers characters no WinAnsi font can encode.\n',
  );

  // ── THE REMEDY TESSERACT ALREADY SHIPS ────────────────────────────────────
  //
  // `TessPDFRenderer` writes a text-only PDF with a GLYPHLESS CID font: every
  // character mapped, no outlines. That is the same problem solved, by the
  // library this build already depends on — so the question is whether its
  // output carries a non-Latin reading back through MuPDF, because if it does
  // then row 3's font is a resource to graft rather than a file to adopt.
  process.stdout.write('\n## The glyphless font Tesseract already ships\n\n');
  const corpus = openCorpus();
  if (!corpus.available) {
    process.stdout.write(`  ${corpus.outcome.text}\n`);
  } else {
    const core = await loadedCore();
    for (const language of RTL_LANGUAGES) ensureModel(core, tessdataDirectory(repoRoot()), language);
    /** @type {{ id: string, language: string, confidence: number, spans: number, faithful: boolean, bytes: number }[]} */
    const rows = [];
    for (const item of corpus.documents) {
      const opened = /** @type {mupdf.PDFDocument} */ (
        mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
      );
      const page = opened.loadPage(0);
      const stext = page.toStructuredText('segment');
      const json = stext.asJSON();
      stext.destroy();
      if (json.includes('"text"')) continue;

      const png = pngOf(page);
      // EVERY RIGHT-TO-LEFT MODEL IS TRIED, and the best confidence identifies
      // the document. Picking one by hand would be this file asserting which
      // corpus document is which, which is a claim nothing here can check.
      /** @type {{ language: 'ara' | 'heb', confidence: number, text: string }} */
      let best = { language: RTL_LANGUAGES[0], confidence: -1, text: '' };
      for (const language of RTL_LANGUAGES) {
        const read = recognised(core, png, language);
        if (read.confidence > best.confidence) best = { language, ...read };
      }
      if (best.confidence < RTL_CONFIDENCE_FLOOR) continue;
      if (![...best.text].some((character) => /[֐-ࣿ]/u.test(character))) continue;

      const layer = renderedLayer(core, png, best.language);
      rows.push({
        id: item.id,
        language: best.language,
        confidence: best.confidence,
        spans: layer.spans,
        faithful: layer.sample !== '' && /[֐-ࣿ]/u.test(layer.sample),
        bytes: layer.bytes,
      });
    }
    if (rows.length === 0) {
      process.stdout.write(
        '  No image-only corpus page read as right-to-left script above the confidence floor,\n' +
          '  so the question this section exists for cannot be measured against this corpus.\n',
      );
    } else {
      process.stdout.write('  id                model   confidence   PDF bytes   spans   script survives\n');
      for (const row of rows) {
        process.stdout.write(
          `  ${row.id.padEnd(16)} ${row.language.padEnd(6)} ${String(row.confidence).padStart(11)}` +
            `${String(row.bytes).padStart(12)}${String(row.spans).padStart(8)}   ${row.faithful ? 'YES' : 'NO'}\n`,
        );
      }
      process.stdout.write(
        `\n  ${corpusCaveat(corpus.documents.length)}\n` +
          '  A YES means the core wrote a layer whose right-to-left characters MuPDF reads back,\n' +
          '  which is the property a standard font fails above. That makes row 3 a question about\n' +
          '  GRAFTING a font resource rather than adopting a font file.\n',
      );
    }
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
