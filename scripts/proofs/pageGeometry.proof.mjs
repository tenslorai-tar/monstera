// @ts-check
/**
 * Proof that the cheap page-geometry path agrees with the expensive one
 * (rule B2, audit finding 10).
 *
 * `mz_page_geometry` exists so scroll layout (invariant L21) does not have to
 * load every page. That is only sound if it produces the same answer as
 * `mz_page_bounds`, which loads the page and calls `fz_bound_page`. If the two
 * disagree, the cheap one is not an optimisation — it is a second, wrong
 * implementation of page size, sitting under every scroll offset in the viewer.
 *
 * The old implementation hand-rolled the dictionary reads and got two things
 * wrong that a FLAT fixture cannot show:
 *
 *   - /Rotate was read with pdf_dict_get_int, which sees only the page's own
 *     key. /Rotate is inheritable, so a page that inherits rotation from an
 *     ancestor Pages node reported 0 and reported portrait dimensions for a
 *     landscape page.
 *   - /CropBox was never read at all, so a page displayed at its crop reported
 *     its media size.
 *
 * So the fixtures are the proof. Two of the cases below are CONTROLS on the
 * fixtures themselves, asserting that they contain pages where the two paths
 * WOULD diverge — because against a flat, uncropped document this whole file
 * passes no matter what the implementation does, which is exactly how the defect
 * survived being "executed once".
 *
 * Usage: node scripts/proofs/pageGeometry.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import koffi from 'koffi';
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from '@cantoo/pdf-lib';

import { requireCurrentShim } from '../lib/shimBinary.mjs';
import { formatError } from '../lib/reportError.mjs';
import { buildFixture, buildNestedFixture } from '../spike/makeFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

const ROOT = repoRoot();
// Refuses if the DLL was not built from the source on disk. A geometry proof
// that passes through a stale DLL is measuring the previous implementation.
const lib = koffi.load(requireCurrentShim({ root: ROOT }));

// Every signature copied from the C, never remembered: a mismatched declaration
// makes koffi write past the arrays it was given, and the process segfaults.
const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');
const mz_page_count = lib.func('int mz_page_count(void *c, void *d, _Out_ int *out)');
const mz_page_bounds = lib.func(
  'int mz_page_bounds(void *c, void *d, int number, _Out_ float *x0, _Out_ float *y0, _Out_ float *x1, _Out_ float *y1)',
);
const mz_page_geometry = lib.func(
  'int mz_page_geometry(void *c, void *d, int number, _Out_ float *w, _Out_ float *h, _Out_ int *rotate)',
);

/** @returns {[number]} */
const out = () => /** @type {[number]} */ ([0]);
/** @returns {[unknown]} */
const outPtr = () => /** @type {[unknown]} */ ([null]);

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * A fixture whose displayed size is decided by /CropBox, not /MediaBox.
 *
 * The crop is asymmetric and inset on all four sides so that a implementation
 * reading MediaBox reports the wrong number in BOTH axes — a square inset would
 * still differ, but an off-by-one in which box is read is easier to see when the
 * two boxes share no dimension.
 *
 * @returns {Promise<Uint8Array>}
 */
async function buildCroppedFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText('cropped', { x: 60, y: 640, size: 18, font });

  // MediaBox 600x800; CropBox 300x400 offset from the origin.
  page.node.set(
    PDFName.of('CropBox'),
    doc.context.obj([PDFNumber.of(50), PDFNumber.of(100), PDFNumber.of(350), PDFNumber.of(500)]),
  );

  const second = doc.addPage([600, 800]);
  second.drawText('cropped-and-rotated', { x: 60, y: 640, size: 18, font });
  second.node.set(
    PDFName.of('CropBox'),
    doc.context.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(200), PDFNumber.of(500)]),
  );
  second.node.set(PDFName.of('Rotate'), PDFNumber.of(90));

  return doc.save({ useObjectStreams: false });
}

/**
 * @param {unknown} ctx
 * @param {string} path
 * @param {string} label
 * @returns {{ pages: number, rows: Array<{ page: number, boundsW: number, boundsH: number, geomW: number, geomH: number, rotate: number }> }}
 */
function measure(ctx, path, label) {
  const docOut = outPtr();
  if (mz_open(ctx, path, docOut) !== 0) {
    throw new Error(`${label}: mz_open failed — ${mz_last_error(ctx)}`);
  }
  const doc = docOut[0];

  const countOut = out();
  if (mz_page_count(ctx, doc, countOut) !== 0) {
    throw new Error(`${label}: mz_page_count failed — ${mz_last_error(ctx)}`);
  }

  const rows = [];
  for (let page = 0; page < countOut[0]; page += 1) {
    const x0 = out();
    const y0 = out();
    const x1 = out();
    const y1 = out();
    if (mz_page_bounds(ctx, doc, page, x0, y0, x1, y1) !== 0) {
      throw new Error(`${label}: mz_page_bounds(${page}) failed — ${mz_last_error(ctx)}`);
    }

    const w = out();
    const h = out();
    const rotate = out();
    if (mz_page_geometry(ctx, doc, page, w, h, rotate) !== 0) {
      throw new Error(`${label}: mz_page_geometry(${page}) failed — ${mz_last_error(ctx)}`);
    }

    rows.push({
      page,
      boundsW: x1[0] - x0[0],
      boundsH: y1[0] - y0[0],
      geomW: w[0],
      geomH: h[0],
      rotate: rotate[0],
    });
  }

  mz_close(ctx, doc);
  return { pages: countOut[0], rows };
}

/** Floating-point equality at a tolerance far below any layout-visible amount. */
const EPSILON = 0.001;

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'monstera-geometry-'));
  const ctxOut = outPtr();
  if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
  const ctx = ctxOut[0];

  try {
    /** @type {Array<{ name: string, bytes: Uint8Array }>} */
    const fixtures = [
      { name: 'flat', bytes: await buildFixture() },
      { name: 'nested', bytes: await buildNestedFixture() },
      { name: 'cropped', bytes: await buildCroppedFixture() },
    ];

    /** @type {Record<string, ReturnType<typeof measure>>} */
    const measured = {};
    for (const fixture of fixtures) {
      const path = join(workspace, `${fixture.name}.pdf`);
      writeFileSync(path, fixture.bytes);
      measured[fixture.name] = measure(ctx, path, fixture.name);
    }

    // ---------------------------------------------------------------------
    // The controls come FIRST. Without them every case below passes against a
    // document where the two paths cannot diverge, which is how "executed once"
    // produced a green result for a broken function.
    // ---------------------------------------------------------------------
    const nested = measured['nested'];
    const inheritedLandscape = (nested?.rows ?? []).filter((row) => row.boundsW > row.boundsH);
    check(
      'CONTROL: the nested fixture contains pages that are landscape ONLY by inherited /Rotate',
      inheritedLandscape.length > 0,
      `no page in the nested fixture reports width > height, so nothing here can detect a ` +
        `non-inheritable /Rotate read. The fixture, not the assertion, is the proof.`,
    );

    const cropped = measured['cropped'];
    const cropDiffers = (cropped?.rows ?? []).filter(
      (row) => Math.abs(row.boundsW - 600) > EPSILON && Math.abs(row.boundsH - 800) > EPSILON,
    );
    check(
      'CONTROL: the cropped fixture displays at a size its MediaBox does not give',
      cropDiffers.length === (cropped?.rows.length ?? -1),
      `${cropDiffers.length} of ${cropped?.rows.length} cropped pages differ from the 600x800 ` +
        `MediaBox. A fixture whose CropBox equals its MediaBox cannot detect a missing CropBox ` +
        `read.`,
    );

    // ---------------------------------------------------------------------
    // The property itself: cheap must equal expensive, everywhere.
    // ---------------------------------------------------------------------
    for (const fixture of fixtures) {
      const result = measured[fixture.name];
      const wrong = (result?.rows ?? []).filter(
        (row) =>
          Math.abs(row.geomW - row.boundsW) > EPSILON ||
          Math.abs(row.geomH - row.boundsH) > EPSILON,
      );
      check(
        `${fixture.name}: mz_page_geometry agrees with mz_page_bounds on all ${result?.pages} pages`,
        wrong.length === 0,
        wrong
          .map(
            (row) =>
              `page ${row.page}: geometry ${row.geomW}x${row.geomH} rot=${row.rotate}, ` +
              `bounds ${row.boundsW}x${row.boundsH}`,
          )
          .join('\n      ') +
          `\n      The cheap path is the viewer's scroll-layout source (L21). A disagreement ` +
          `here is a wrong scroll offset for every page below the first bad one.`,
      );
    }

    // ---------------------------------------------------------------------
    // The rotation reported is the INHERITED one, which is the specific read
    // that was wrong.
    // ---------------------------------------------------------------------
    const rotatedByInheritance = (nested?.rows ?? []).filter((row) => row.rotate === 90);
    check(
      'nested: pages that inherit /Rotate 90 report 90, not 0',
      rotatedByInheritance.length === inheritedLandscape.length &&
        rotatedByInheritance.length > 0,
      `${rotatedByInheritance.length} page(s) report rotate=90 but ${inheritedLandscape.length} ` +
        `are landscape. pdf_dict_get_int reports 0 for an inherited key; ` +
        `pdf_dict_get_inheritable_int is the one that answers the question asked.`,
    );
  } finally {
    mz_drop(ctx);
    rmSync(workspace, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nPage-geometry proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        `\n\n`,
    );
    return 1;
  }

  for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
  process.stdout.write(`\n${passed.length} page-geometry cases passed.\n`);
  return 0;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  },
);
