// @ts-check
/**
 * The `mupdf-host` role, measured: the process that holds the parser.
 *
 * This is not yet an Electron utility process — none exists — but it is the same
 * code doing the same work in its own process, which is what the budget is
 * about. What it does NOT cover is recorded rather than glossed: Electron's own
 * baseline is not in this figure, so when the utility process lands, this must
 * be re-measured rather than assumed to carry over.
 *
 * The workload is the one the gate names: open a large document, walk every
 * page's geometry, render one page. Walking every page matters — the WASM
 * measurements that produced the withdrawn model failed *inside* `loadPage`
 * during the page walk on the object-dense fixture, never reaching the save, so
 * a workload that opens and stops would report a number for work nobody does.
 *
 * Usage: node scripts/perf/roleMupdfHost.mjs <document-path>
 */

import koffi from 'koffi';

import { repoRoot } from '../lib/gitScope.mjs';
import { requireCurrentShim } from '../lib/shimBinary.mjs';
import { peakRssBytes, reportPeak } from './peakRss.mjs';

const documentPath = process.argv[2];
if (documentPath === undefined) {
  process.stderr.write('Usage: roleMupdfHost.mjs <document-path>\n');
  process.exit(2);
}

// Refuses a DLL built from older source. A stale binary still runs and still
// prints plausible numbers, and this workload touches little enough of the shim
// that a rebuild that never happened would produce a believable figure.
const lib = koffi.load(requireCurrentShim({ root: repoRoot() }));

const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');
const mz_page_count = lib.func('int mz_page_count(void *c, void *d, _Out_ int *out)');
const mz_page_bounds = lib.func(
  'int mz_page_bounds(void *c, void *d, int number, _Out_ float *x0, _Out_ float *y0, _Out_ float *x1, _Out_ float *y1)',
);
const mz_render_page = lib.func(
  'int mz_render_page(void *c, void *d, int number, float dpi, _Out_ void **samples, _Out_ int *w, _Out_ int *h, _Out_ int *stride, _Out_ void **pixmap)',
);
const mz_free_pixmap = lib.func('void mz_free_pixmap(void *c, void *pixmap)');
const mz_alloc_stats = lib.func(
  'int mz_alloc_stats(void *c, _Out_ double *live, _Out_ double *peak, _Out_ double *blocks, _Out_ int *invalid)',
);

/** @returns {[number]} */
const num = () => [0];
/** @returns {[unknown]} */
const ptr = () => [null];

const ctxOut = ptr();
if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
const ctx = ctxOut[0];

/** @param {string} what */
const fail = (what) => {
  throw new Error(`${what}: ${String(mz_last_error(ctx))}`);
};

const docOut = ptr();
if (mz_open(ctx, documentPath, docOut) !== 0) fail('mz_open');
const doc = docOut[0];

const count = num();
if (mz_page_count(ctx, doc, count) !== 0) fail('mz_page_count');

// Every page, not the first: the page walk is where the engine actually
// materialises per-page structures, and it is where the earlier investigation's
// object-dense fixture died.
let widest = 0;
for (let page = 0; page < count[0]; page += 1) {
  const x0 = num();
  const y0 = num();
  const x1 = num();
  const y1 = num();
  if (mz_page_bounds(ctx, doc, page, x0, y0, x1, y1) !== 0) fail(`mz_page_bounds(${String(page)})`);
  widest = Math.max(widest, x1[0] - x0[0]);
}

// Every page is rendered, not the first. Rendering is what forces the engine to
// parse a content stream, and a walk of page dictionaries alone does not touch
// them: measured, bounds-only over this fixture peaks at 58.9 MB for a 200 MB
// document, which would pass a 1.2 GB budget without the engine having read the
// document at all. A gate that cannot fail is not a gate.
const dpi = Number(process.env['MONSTERA_PERF_DPI'] ?? '110');
let renderedPixels = 0;
for (let page = 0; page < count[0]; page += 1) {
  const samples = ptr();
  const width = num();
  const height = num();
  const stride = num();
  const pixmap = ptr();
  if (mz_render_page(ctx, doc, page, dpi, samples, width, height, stride, pixmap) !== 0) {
    fail(`mz_render_page(${String(page)})`);
  }
  renderedPixels += width[0] * height[0];
  mz_free_pixmap(ctx, pixmap[0]);
}

// The engine's own counters alongside the OS figure. RSS cannot separate what
// the engine retains from what the allocator is sitting on; these can, and
// reporting both means a budget breach can be diagnosed rather than merely
// noticed.
const live = num();
const allocPeak = num();
const blocks = num();
const invalid = num();
if (mz_alloc_stats(ctx, live, allocPeak, blocks, invalid) !== 0) fail('mz_alloc_stats');

const engine = {
  liveBytes: live[0],
  peakBytes: allocPeak[0],
  blocks: blocks[0],
  countersInvalid: invalid[0] === 1,
};

mz_close(ctx, doc);
mz_drop(ctx);

reportPeak({
  role: 'mupdf-host',
  document: documentPath,
  pages: count[0],
  widestPage: widest,
  dpi,
  renderedPixels,
  engine,
  rssAtEnd: peakRssBytes(),
});
