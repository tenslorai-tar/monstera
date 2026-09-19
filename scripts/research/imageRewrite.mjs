// @ts-check
/**
 * What MuPDF's own image rewriter, reached natively, does to a document — the evidence Optimize's
 * route is decided on (D10, the owner's route of 2026-09-19: `pdf_rewrite_images` through the
 * shim, from a contained host).
 *
 * For each document and each of three settings it reports the bytes before and after, whether the
 * page count held, whether a tagged document KEPT its structure tree — the property Ghostscript
 * lost on 4 of 4 tagged corpus documents (2026-09-17) — and how far page 1's pixels moved, as the
 * mean absolute difference per channel of a 50 dpi render of each, both drawn by the one engine.
 *
 * ## Two controls, because both answers this could give are the reassuring ones
 *
 * - **A document that MUST shrink**: one page carrying a 1,700-pixel-wide JPEG at quality 95 drawn
 *   two inches wide, i.e. about 850 dpi. The lowest setting subsamples above 150 dpi to 100 and
 *   re-encodes at quality 50, so a rewriter that ran and changed nothing is refused here rather than
 *   read as *this corpus has little to gain*.
 * - **A tagged document must be SEEN as tagged**: the same document with a `/StructTreeRoot` put
 *   on it, so *kept its tags* is never the answer of a detector that finds none anywhere.
 *
 * Corpus documents are named by position only (`d1`…), never by file name.
 *
 * Usage: MONSTERA_CORPUS=<dir> node scripts/research/imageRewrite.mjs
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as pdfLib from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { repoRoot } from '../lib/gitScope.mjs';
import { requireCurrentShim } from '../lib/shimBinary.mjs';

const ROOT = repoRoot();
const koffi = createRequire(join(ROOT, 'package.json'))('koffi');

/** The three settings: JPEG quality for lossy images, and subsample above `over` dpi to `to`. */
const SETTINGS = [
  { name: 'high', quality: 85, over: 300, to: 200 },
  { name: 'medium', quality: 70, over: 225, to: 150 },
  { name: 'low', quality: 50, over: 150, to: 100 },
];

const shim = koffi.load(requireCurrentShim({ root: ROOT }));
const mz_init = shim.func('int mz_init(_Out_ void **out)');
const mz_drop = shim.func('void mz_drop(void *c)');
const mz_last_error = shim.func('const char *mz_last_error(void *c)');
const mz_open = shim.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = shim.func('int mz_close(void *c, void *d)');
const mz_rewrite_images = shim.func('int mz_rewrite_images(void *c, void *d, int quality, int over, int to)');
const mz_save_compacted = shim.func('int mz_save_compacted(void *c, void *d, const char *path)');

const scratch = mkdtempSync(join(tmpdir(), 'monstera-rewrite-'));

/**
 * Rewrites `input` into `output` with one setting, natively.
 *
 * @param {string} input
 * @param {string} output
 * @param {{ quality: number, over: number, to: number }} setting
 */
function rewrite(input, output, setting) {
  const ctx = [null];
  if (mz_init(ctx) !== 0) throw new Error('mz_init failed');
  const c = ctx[0];
  try {
    const doc = [null];
    if (mz_open(c, input, doc) !== 0) throw new Error(`open: ${String(mz_last_error(c))}`);
    try {
      if (mz_rewrite_images(c, doc[0], setting.quality, setting.over, setting.to) !== 0) {
        throw new Error(`rewrite: ${String(mz_last_error(c))}`);
      }
      if (mz_save_compacted(c, doc[0], output) !== 0) throw new Error(`save: ${String(mz_last_error(c))}`);
    } finally {
      mz_close(c, doc[0]);
    }
  } finally {
    mz_drop(c);
  }
}

/** @param {Uint8Array} bytes */
function read(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pdf = doc.asPDF();
  const tagged = pdf !== null && !pdf.getTrailer().get('Root').get('StructTreeRoot').isNull();
  const page = doc.loadPage(0);
  const scale = 50 / 72;
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  // COPIED OUT, because `getPixels()` is a view into the WASM heap, and the next document opened
  // can grow that heap and detach it — measured 2026-09-19: the first run compared a detached view
  // and reported NaN for pages whose geometry and render size were identical.
  const pixels = pixmap.getPixels().slice();
  return { pages: doc.countPages(), tagged, pixels, w: pixmap.getWidth(), h: pixmap.getHeight() };
}

/** @param {ReturnType<typeof read>} a @param {ReturnType<typeof read>} b */
function meanDifference(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`page 1 rendered ${String(a.w)}x${String(a.h)} before and ${String(b.w)}x${String(b.h)} after`);
  if (a.pixels.length === 0) throw new Error('an empty render is a detached view, not a page');
  let total = 0;
  if (a.pixels.length !== b.pixels.length) throw new Error('the two renders hold different sample counts');
  for (const [i, value] of a.pixels.entries()) total += Math.abs(value - (b.pixels[i] ?? Number.NaN));
  return total / a.pixels.length;
}

/** @param {string} label @param {string} path */
function measure(label, path) {
  const before = readFileSync(path);
  const original = read(before);
  const cells = SETTINGS.map((setting) => {
    const out = join(scratch, `${label}-${setting.name}.pdf`);
    const started = performance.now();
    rewrite(path, out, setting);
    const ms = performance.now() - started;
    const after = readFileSync(out);
    const rewritten = read(after);
    return {
      setting: setting.name,
      bytes: after.length,
      change: (after.length - before.length) / before.length,
      pagesHeld: rewritten.pages === original.pages,
      tagsKept: original.tagged ? rewritten.tagged : null,
      meanDiff: meanDifference(original, rewritten),
      ms,
    };
  });
  return { label, bytes: before.length, tagged: original.tagged, pages: original.pages, cells };
}

/**
 * The control document: an oversized quality-95 JPEG, drawn small, and optionally tagged.
 *
 * @param {boolean} tagged
 */
async function controlDocument(tagged) {
  const source = mupdf.Document.openDocument(
    await (async () => {
      const d = await pdfLib.PDFDocument.create();
      const p = d.addPage([400, 300]);
      for (let i = 0; i < 40; i += 1) {
        p.drawRectangle({ x: (i * 37) % 380, y: (i * 53) % 280, width: 30 + i, height: 20 + i, color: pdfLib.rgb((i * 7 % 10) / 10, (i * 3 % 10) / 10, (i * 5 % 10) / 10) });
      }
      return d.save();
    })(),
    'application/pdf',
  );
  const jpeg = source.loadPage(0).toPixmap(mupdf.Matrix.scale(4.25, 4.25), mupdf.ColorSpace.DeviceRGB, false, true).asJPEG(95);
  const d = await pdfLib.PDFDocument.create();
  d.addPage([612, 792]).drawImage(await d.embedJpg(jpeg), { x: 72, y: 500, width: 144, height: 108 });
  if (tagged) d.catalog.set(pdfLib.PDFName.of('StructTreeRoot'), d.context.register(d.context.obj({ Type: 'StructTreeRoot' })));
  const path = join(scratch, tagged ? 'control-tagged.pdf' : 'control.pdf');
  writeFileSync(path, await d.save());
  return path;
}

/** @param {ReturnType<typeof measure>} r */
function line(r) {
  const cells = r.cells
    .map((c) => `${c.setting} ${String(c.bytes)} (${(c.change * 100).toFixed(1)}%) pages ${c.pagesHeld ? 'held' : 'CHANGED'} tags ${c.tagsKept === null ? '-' : c.tagsKept ? 'kept' : 'LOST'} diff ${c.meanDiff.toFixed(2)} ${c.ms.toFixed(0)}ms`)
    .join(' | ');
  return `${r.label}: ${String(r.bytes)} bytes, ${String(r.pages)} pages, ${r.tagged ? 'tagged' : 'untagged'} | ${cells}`;
}

try {
  const control = measure('control', await controlDocument(false));
  process.stdout.write(`${line(control)}\n`);
  const low = control.cells.find((c) => c.setting === 'low');
  if (low === undefined || low.change > -0.5) {
    throw new Error('CONTROL FAILED: the oversized JPEG did not shrink by half at the lowest setting, so no reading below means anything');
  }
  const taggedControl = measure('control-tagged', await controlDocument(true));
  process.stdout.write(`${line(taggedControl)}\n`);
  if (!taggedControl.tagged) throw new Error('CONTROL FAILED: a document carrying /StructTreeRoot was not seen as tagged');

  const corpus = process.env['MONSTERA_CORPUS'];
  if (corpus === undefined || corpus === '') {
    process.stdout.write('no MONSTERA_CORPUS: controls only\n');
  } else {
    const files = readdirSync(corpus).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
    if (files.length === 0) throw new Error('the corpus directory holds no PDF, which is a broken input rather than an answer');
    let total = 0;
    const sums = SETTINGS.map(() => 0);
    let taggedLost = 0;
    for (const [i, file] of files.entries()) {
      const r = measure(`d${String(i + 1)}`, join(corpus, file));
      process.stdout.write(`${line(r)}\n`);
      total += r.bytes;
      r.cells.forEach((c, k) => {
        sums[k] = (sums[k] ?? 0) + c.bytes;
        if (c.tagsKept === false) taggedLost += 1;
      });
    }
    process.stdout.write(
      `corpus total ${String(total)} bytes; ${SETTINGS.map((s, k) => `${s.name} ${String(sums[k])} (${(((sums[k] ?? 0) - total) / total * 100).toFixed(1)}%)`).join(', ')}; tagged documents that lost their tree: ${String(taggedLost)}\n`,
    );
    process.stdout.write(`(${String(files.length)} documents, ${String(statSync(corpus).isDirectory())})\n`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
