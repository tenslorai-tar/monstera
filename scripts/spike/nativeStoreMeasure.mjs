// @ts-check
/**
 * Validates the rebuilt instruments, and re-measures what ADR-0010 concluded.
 *
 * Three instruments in that investigation produced confidently wrong numbers,
 * and mz_store_footprint is the fourth. So it is not trusted here: it is
 * compared, at a checkpoint where the store is genuinely full, against MuPDF's
 * own fz_debug_store summary — printed raw for a human to read rather than
 * parsed, because parsing that output is the defect being replaced.
 *
 * The gap between the summary's `size` and its `actual size` is reported
 * explicitly. That gap is the reason the old scrape could never have been
 * truthful even had it bound to the right line: an item's declared itemsize is
 * not what it cost to allocate.
 *
 * Usage: node scripts/spike/nativeStoreMeasure.mjs
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import koffi from 'koffi';

import { requireCurrentShim } from '../lib/shimBinary.mjs';
import { buildFixture } from './makeFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

const ROOT = repoRoot();

// This is the ADR-0010 instrument, and the one where a stale DLL is hardest to
// notice: the workload does not touch most of the shim, so a rebuild that never
// happened produces byte-identical totals to one that did. Batch 4 reproduced
// 155,548,924 bytes and 1,547 blocks across four rebuilds, and the run itself
// could not distinguish "recomputed and unchanged" from "never recomputed".
const DLL = requireCurrentShim({ root: ROOT });

const lib = koffi.load(DLL);

const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');
const mz_page_count = lib.func('int mz_page_count(void *c, void *d, _Out_ int *out)');
const mz_alloc_stats = lib.func(
  'int mz_alloc_stats(void *c, _Out_ double *live, _Out_ double *peak, _Out_ double *blocks, _Out_ int *invalid)',
);
const mz_store_debug = lib.func(
  'int mz_store_debug(void *c, _Out_ char *buf, int len, _Out_ double *needed)',
);
const mz_store_footprint = lib.func(
  'int mz_store_footprint(void *c, void *d, _Out_ double *freed, _Out_ int *quiescent)',
);
const mz_render_page = lib.func(
  'int mz_render_page(void *c, void *d, int number, float dpi, _Out_ void **samples, _Out_ int *w, _Out_ int *h, _Out_ int *stride, _Out_ void **pixmap)',
);
const mz_free_pixmap = lib.func('void mz_free_pixmap(void *c, void *pixmap)');
// Four out-parameters, not two: the rectangle is x0,y0,x1,y1. Declaring two
// made koffi write past the arrays it was given and the process segfaulted —
// which is the honest failure mode for a mismatched FFI declaration, and the
// reason every signature here is copied from the C rather than remembered.
const mz_page_bounds = lib.func(
  'int mz_page_bounds(void *c, void *d, int number, _Out_ float *x0, _Out_ float *y0, _Out_ float *x1, _Out_ float *y1)',
);
const mz_process_alloc_stats = lib.func(
  'void mz_process_alloc_stats(_Out_ double *allocated, _Out_ double *freed, _Out_ double *ba, _Out_ double *bf, _Out_ double *peak, _Out_ int *imbalance)',
);

/**
 * koffi writes `_Out_` parameters into element 0 of an array. Typed as a
 * one-element TUPLE rather than `number[]`, so `noUncheckedIndexedAccess` knows
 * the slot is populated — an array type would make every read `number |
 * undefined` and buy a dozen non-null assertions to answer a question the shape
 * already settles.
 *
 * @returns {[number]}
 */
const num = () => [0];

/** @returns {[unknown]} */
const ptr = () => [null];

/** @param {any} ctx */
function stats(ctx) {
  const live = num();
  const peak = num();
  const blocks = num();
  const invalid = num();
  const rc = mz_alloc_stats(ctx, live, peak, blocks, invalid);
  if (rc !== 0) throw new Error('mz_alloc_stats failed');
  return { live: live[0], peak: peak[0], blocks: blocks[0], invalid: invalid[0] === 1 };
}

/** @param {any} ctx */
function storeDebug(ctx) {
  const size = 1 << 20;
  const buf = Buffer.alloc(size);
  const needed = num();
  const rc = mz_store_debug(ctx, buf, size, needed);
  if (rc !== 0) throw new Error('mz_store_debug failed');
  return { text: buf.toString('utf8', 0, buf.indexOf(0)), needed: needed[0] };
}

/**
 * Exact bytes alongside a readable magnitude. The first version of this script
 * printed only MB to two places, which rounded a 21,500-byte store and a
 * 10,000-byte delta to the same "0.01 MB" — an instrument whose output cannot
 * distinguish the two numbers it exists to compare.
 *
 * @param {number} n
 */
const bytes = (n) => `${n.toLocaleString('en-US')} B (${(n / 1e6).toFixed(2)} MB)`;

/**
 * A fixture that actually fills the resource store.
 *
 * The shared spike fixture is text-only, so the store holds a font and a few
 * display lists — 21,500 bytes against a 268 MB maximum. Validating a
 * store-measuring instrument against a store that is 0.008% full would prove
 * nothing about the case it exists for. The store caches DECODED IMAGES, so the
 * fixture needs images, one distinct image per page so nothing is shared.
 *
 * @param {number} pageCount
 * @param {number} edge Pixels per side; 1024 decodes to ~3 MB of RGB.
 * @returns {Promise<Uint8Array>}
 */
async function buildImageFixture(pageCount, edge) {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const sharp = (await import('sharp')).default;

  const doc = await PDFDocument.create();
  doc.setTitle('Monstera store-footprint fixture');
  doc.setSubject('Self-generated. Contains no real-world data.');

  for (let index = 0; index < pageCount; index += 1) {
    // Noise rather than flat colour: a compressible image would decode to the
    // same RGB size but is less representative, and a shared one would be
    // cached once for every page and understate the store.
    const raw = Buffer.alloc(edge * edge * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 31 + index * 97) & 0xff;
    const png = await sharp(raw, { raw: { width: edge, height: edge, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const embedded = await doc.embedPng(png);
    const page = doc.addPage([612, 792]);
    page.drawImage(embedded, { x: 0, y: 0, width: 612, height: 792 });
  }
  return doc.save();
}

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'monstera-store-'));
  const path = join(scratch, 'fixture.pdf');
  const useImages = !process.argv.includes('--text-only');
  await writeFile(path, useImages ? await buildImageFixture(8, 1024) : await buildFixture());
  process.stdout.write(useImages ? '\nfixture: image-backed\n' : '\nfixture: text-only\n');

  const ctxOut = ptr();
  if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
  const ctx = ctxOut[0];

  const docOut = ptr();
  if (mz_open(ctx, path, docOut) !== 0) throw new Error(`mz_open: ${mz_last_error(ctx)}`);
  const doc = docOut[0];

  const pages = num();
  mz_page_count(ctx, doc, pages);

  const opened = stats(ctx);
  process.stdout.write(`\nfixture: ${pages[0]} pages\n`);
  process.stdout.write(`after open        live=${bytes(opened.live)} blocks=${opened.blocks}\n`);

  // Fill the store. Rendering caches decoded fonts and display lists, which is
  // what the resource store actually holds.
  /** @type {any[]} */
  const held = [];
  for (let n = 0; n < pages[0]; n += 1) {
    const samples = ptr();
    const w = num();
    const h = num();
    const stride = num();
    const pixmap = ptr();
    if (mz_render_page(ctx, doc, n, 150, samples, w, h, stride, pixmap) !== 0) {
      throw new Error(`mz_render_page(${n}): ${mz_last_error(ctx)}`);
    }
    held.push(pixmap[0]);
  }

  const rendered = stats(ctx);
  process.stdout.write(
    `after ${pages[0]} renders   live=${bytes(rendered.live)} blocks=${rendered.blocks} ` +
      `(pixmaps still held)\n`,
  );

  // --- Condition 1: quiescence. Measure while pixmaps are outstanding, which
  // must report NOT quiescent, then again after releasing them.
  const freedBusy = num();
  const quiescentBusy = num();
  mz_store_footprint(ctx, doc, freedBusy, quiescentBusy);
  process.stdout.write(
    `\nfootprint while ${held.length} pixmaps held: freed=${bytes(freedBusy[0])} ` +
      `quiescent=${quiescentBusy[0]}  <- floor, not total\n`,
  );

  for (const pixmap of held) mz_free_pixmap(ctx, pixmap);

  // Re-fill after the eviction above, so the validation checkpoint below sees a
  // genuinely full store rather than the emptied one.
  /** @type {any[]} */
  const held2 = [];
  for (let n = 0; n < pages[0]; n += 1) {
    const samples = ptr();
    const w = num();
    const h = num();
    const stride = num();
    const pixmap = ptr();
    mz_render_page(ctx, doc, n, 150, samples, w, h, stride, pixmap);
    held2.push(pixmap[0]);
  }
  for (const pixmap of held2) mz_free_pixmap(ctx, pixmap);

  const quiet = stats(ctx);
  process.stdout.write(`\nafter releasing   live=${bytes(quiet.live)} blocks=${quiet.blocks}\n`);

  // --- Condition 2: validate against MuPDF's own summary, read by eye.
  const dump = storeDebug(ctx);
  const summary = dump.text.split('\n').filter((line) => line.includes('max=')).join('\n');
  const itemLines = dump.text.split('\n').filter((line) => line.includes('[size=')).length;
  process.stdout.write(`\n--- fz_debug_store, MuPDF's own words (${dump.needed} bytes) ---\n`);
  process.stdout.write(`${summary || '(no summary line)'}\n`);
  process.stdout.write(`cached item lines: ${itemLines}\n`);
  process.stdout.write(
    `NOTE: the old scrape searched for "size=" from the start of this buffer, so with ` +
      `${itemLines} item line(s) present it bound to the first ITEM, not the summary.\n`,
  );

  const freed = num();
  const quiescent = num();
  if (mz_store_footprint(ctx, doc, freed, quiescent) !== 0) {
    throw new Error(`mz_store_footprint: ${mz_last_error(ctx)}`);
  }
  const after = stats(ctx);

  process.stdout.write(`\n--- the new instrument ---\n`);
  process.stdout.write(`footprint freed   ${bytes(freed[0])}   quiescent=${quiescent[0]}\n`);
  process.stdout.write(`live after empty  ${bytes(after.live)} blocks=${after.blocks}\n`);
  process.stdout.write(`accounting invalid flag: ${after.invalid}\n`);

  mz_close(ctx, doc);
  const closed = stats(ctx);
  process.stdout.write(`\nafter close       live=${bytes(closed.live)} blocks=${closed.blocks}\n`);

  mz_drop(ctx);

  // --- The leak check, which per-context accounting structurally cannot answer.
  // These totals are monotonic and process-wide, so they outlive the context
  // that was just dropped. ADR-0010's "0 live blocks after the context is
  // dropped" came from counters that mz_init reset on the next call, so it
  // measured a reset rather than a release.
  {
    const a = num();
    const f = num();
    const ba = num();
    const bf = num();
    const pk = num();
    const im = num();
    mz_process_alloc_stats(a, f, ba, bf, pk, im);
    process.stdout.write(`\n--- process totals, after every context was dropped ---\n`);
    process.stdout.write(`bytes  allocated ${bytes(a[0])}\n`);
    process.stdout.write(`bytes  freed     ${bytes(f[0])}\n`);
    process.stdout.write(`blocks allocated ${ba[0].toLocaleString('en-US')}\n`);
    process.stdout.write(`blocks freed     ${bf[0].toLocaleString('en-US')}\n`);
    process.stdout.write(`peak live        ${bytes(pk[0])}\n`);
    process.stdout.write(
      `LEAK: ${a[0] === f[0] && ba[0] === bf[0] ? 'none — allocated equals freed' : `${bytes(a[0] - f[0])} in ${ba[0] - bf[0]} block(s) never returned`}` +
        `   imbalance=${im[0]}\n`,
    );
  }

  await rm(scratch, { recursive: true, force: true });
}

/**
 * Re-runs ADR-0010's own checkpoints, with the prediction stated BEFORE the
 * numbers.
 *
 * PREDICTION. The old reader searched fz_debug_store's buffer for "size=" from
 * the start, so it bound to the first CACHED ITEM line and reached the summary
 * only when there were no item lines at all. It could therefore return a
 * plausible small number only when the store was genuinely empty. ADR-0010
 * recorded a store of 0 at every checkpoint — so the store really was empty
 * there, and its conclusion "not the resource store" is confirmed by deduction
 * rather than merely probable.
 *
 * The corrected instrument must therefore ALSO report ~0 at those checkpoints.
 * If it reports anything substantial, the deduction is wrong, there is a third
 * defect, and that is the finding.
 *
 * ADR-0010's checkpoints never rendered: they opened, walked page geometry, and
 * held pages. That is reproduced here exactly — no mz_render_page.
 */
async function replayAdrCheckpoints() {
  const scratch = await mkdtemp(join(tmpdir(), 'monstera-adr-'));
  const path = join(scratch, 'fixture.pdf');
  await writeFile(path, await buildFixture());

  const ctxOut = ptr();
  mz_init(ctxOut);
  const ctx = ctxOut[0];
  const docOut = ptr();
  mz_open(ctx, path, docOut);
  const doc = docOut[0];

  const pages = num();
  mz_page_count(ctx, doc, pages);

  process.stdout.write(`\n=== ADR-0010 checkpoints replayed (open + walk, never render) ===\n`);
  process.stdout.write(`PREDICTION: the store footprint is ~0 at every checkpoint below.\n\n`);

  /** @param {string} label */
  const checkpoint = (label) => {
    const freed = num();
    const quiescent = num();
    mz_store_footprint(ctx, doc, freed, quiescent);
    const s = stats(ctx);
    process.stdout.write(
      `  ${label.padEnd(22)} store=${bytes(freed[0]).padEnd(24)} ` +
        `live=${bytes(s.live)} quiescent=${quiescent[0]}\n`,
    );
    return freed[0];
  };

  const observed = [checkpoint('after open')];

  for (let n = 0; n < pages[0]; n += 1) {
    const x0 = num();
    const y0 = num();
    const x1 = num();
    const y1 = num();
    mz_page_bounds(ctx, doc, n, x0, y0, x1, y1);
  }
  observed.push(checkpoint('after page walk'));

  mz_close(ctx, doc);
  mz_drop(ctx);
  await rm(scratch, { recursive: true, force: true });

  const worst = Math.max(...observed);
  process.stdout.write(
    `\n  VERDICT: largest store footprint at any checkpoint = ${bytes(worst)}\n` +
      `  ${worst < 100_000 ? 'Prediction HELD. ADR-0010’s "not the resource store" is confirmed.' : 'Prediction FAILED — a third defect, and this is the finding.'}\n`,
  );
}

await replayAdrCheckpoints();

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
