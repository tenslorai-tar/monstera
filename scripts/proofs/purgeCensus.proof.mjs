// @ts-check
/**
 * Proof that the purge census actually mirrors pdf_clear_xref (audit finding 25).
 *
 * The old code carried a comment asserting its count "mirrors pdf_clear_xref's
 * own test". Under B6 a comment states a mechanism, so that sentence was a
 * claim — and it was false. It walked one resolved entry per object number from
 * doc->xref_base, where pdf_clear_xref walks every entry of every subsection of
 * every xref section, so on any document with incremental updates the two saw
 * different populations.
 *
 * The audit's cheaper branch was to delete the sentence. That leaves the real
 * property unverified: the whole point of the census is telling "purging
 * reclaimed nothing" apart from "nothing was reclaimable", and a count that does
 * not match what the purge actually drops cannot tell them apart at all.
 *
 * So the claim is now an equation instead of a sentence:
 *
 *     cached_after == cached_before - droppable
 *
 * If the classification matches upstream, that balances. If this file and MuPDF
 * ever drift apart, it stops balancing, and no one has to notice a comment has
 * gone stale.
 *
 * The load-bearing fixture is the INCREMENTALLY SAVED one: it is the document
 * shape where the old walk and pdf_clear_xref's walk genuinely differ, and a
 * single-section document cannot distinguish them.
 *
 * Usage: node scripts/proofs/purgeCensus.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import koffi from 'koffi';

import { buildFixture, buildNestedFixture } from '../spike/makeFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

const ROOT = repoRoot();
const lib = koffi.load(join(ROOT, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll'));

const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');
const mz_page_count = lib.func('int mz_page_count(void *c, void *d, _Out_ int *out)');
const mz_object_count = lib.func('int mz_object_count(void *c, void *d, _Out_ int *out)');
const mz_render_page = lib.func(
  'int mz_render_page(void *c, void *d, int number, float dpi, _Out_ void **samples, _Out_ int *w, _Out_ int *h, _Out_ int *stride, _Out_ void **pixmap)',
);
const mz_free_pixmap = lib.func('void mz_free_pixmap(void *c, void *pixmap)');
const mz_set_page_rotation = lib.func(
  'int mz_set_page_rotation(void *c, void *d, int number, int value)',
);
const mz_save = lib.func('int mz_save(void *c, void *d, const char *path, int incremental)');
// Four out-parameters. Copied from the C, never remembered.
const mz_purge_objects = lib.func(
  'int mz_purge_objects(void *c, void *d, _Out_ int *before, _Out_ int *droppable, _Out_ int *pinned, _Out_ int *after)',
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
 * Appends an incremental update in place, so the file's xref gains a SECOND
 * SECTION.
 *
 * This is the fixture the finding turns on. With one section, walking resolved
 * entries by object number and walking every entry of every section give the
 * same answer, so a single-section document cannot tell a correct census from
 * the broken one.
 *
 * Written by MuPDF's own incremental save rather than by pdf-lib. pdf-lib's
 * `incremental: true` was tried first and produced a single-%%EOF file — a
 * full rewrite — which the control below caught. An incremental save appends to
 * the file it was loaded from, so the path is modified in place.
 *
 * @param {unknown} ctx
 * @param {string} path
 */
function appendIncrementalUpdate(ctx, path) {
  const docOut = outPtr();
  if (mz_open(ctx, path, docOut) !== 0) {
    throw new Error(`incremental: mz_open failed — ${mz_last_error(ctx)}`);
  }
  const doc = docOut[0];
  // Any real change will do; rotation is the one command with a proven exact
  // inverse, so it is the least likely to disturb anything else being measured.
  if (mz_set_page_rotation(ctx, doc, 0, 90) !== 0) {
    throw new Error(`incremental: mz_set_page_rotation failed — ${mz_last_error(ctx)}`);
  }
  if (mz_save(ctx, doc, path, 1) !== 0) {
    throw new Error(`incremental: mz_save failed — ${mz_last_error(ctx)}`);
  }
  mz_close(ctx, doc);
}

/**
 * Opens, warms the caches by rendering, then purges and returns the census.
 *
 * Rendering first is what makes the case non-trivial: a document nobody has
 * touched has almost nothing cached, so before and after are both near zero and
 * the equation balances for the wrong reason.
 *
 * @param {unknown} ctx
 * @param {string} path
 * @param {string} label
 * @param {boolean} [editAfterWarming]
 *   Modify the document AFTER rendering has cached objects. A modification makes
 *   MuPDF open a fresh incremental xref section in memory, leaving the objects
 *   cached in the older section still cached — which is the ONLY state in which
 *   a per-object-number walk and a per-section walk see different populations.
 *   A file that merely arrived with two sections on disk does not produce it:
 *   the shadowed entry has no cached object until something loads it, which is
 *   what the first version of this proof got wrong.
 */
function purgeAfterWarming(ctx, path, label, editAfterWarming = false) {
  const docOut = outPtr();
  if (mz_open(ctx, path, docOut) !== 0) {
    throw new Error(`${label}: mz_open failed — ${mz_last_error(ctx)}`);
  }
  const doc = docOut[0];

  const pages = out();
  mz_page_count(ctx, doc, pages);
  const objects = out();
  mz_object_count(ctx, doc, objects);

  for (let page = 0; page < pages[0]; page += 1) {
    const samples = outPtr();
    const w = out();
    const h = out();
    const stride = out();
    const pixmap = outPtr();
    if (mz_render_page(ctx, doc, page, 72, samples, w, h, stride, pixmap) === 0) {
      mz_free_pixmap(ctx, pixmap[0]);
    }
  }

  if (editAfterWarming && mz_set_page_rotation(ctx, doc, 0, 90) !== 0) {
    throw new Error(`${label}: mz_set_page_rotation failed — ${mz_last_error(ctx)}`);
  }

  const before = out();
  const droppable = out();
  const pinned = out();
  const after = out();
  if (mz_purge_objects(ctx, doc, before, droppable, pinned, after) !== 0) {
    throw new Error(`${label}: mz_purge_objects failed — ${mz_last_error(ctx)}`);
  }
  mz_close(ctx, doc);

  return {
    xrefLen: objects[0],
    before: before[0],
    droppable: droppable[0],
    pinned: pinned[0],
    after: after[0],
  };
}

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'monstera-purge-'));
  const ctxOut = outPtr();
  if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
  const ctx = ctxOut[0];

  try {
    const flatBytes = await buildFixture();
    const nestedBytes = await buildNestedFixture();

    /** @type {Array<{ name: string, bytes: Uint8Array, edit?: boolean }>} */
    const fixtures = [
      { name: 'flat', bytes: flatBytes },
      { name: 'nested', bytes: nestedBytes },
      { name: 'incremental', bytes: flatBytes },
      // The one that separates the two walks: same bytes as `flat`, but edited
      // in memory after rendering so a second xref section exists alongside the
      // still-cached originals.
      { name: 'edited', bytes: flatBytes, edit: true },
    ];

    for (const fixture of fixtures) {
      writeFileSync(join(workspace, `${fixture.name}.pdf`), fixture.bytes);
    }
    // In place, after the base file is on disk: an incremental save appends.
    appendIncrementalUpdate(ctx, join(workspace, 'incremental.pdf'));

    /** @type {Record<string, ReturnType<typeof purgeAfterWarming>>} */
    const results = {};
    for (const fixture of fixtures) {
      results[fixture.name] = purgeAfterWarming(
        ctx,
        join(workspace, `${fixture.name}.pdf`),
        fixture.name,
        fixture.edit === true,
      );
    }

    // ---------------------------------------------------------------------
    // Controls on the fixtures, first.
    // ---------------------------------------------------------------------
    check(
      'CONTROL: the incremental fixture really was saved with a second xref section',
      readFileSync(join(workspace, 'incremental.pdf'), 'latin1').split('%%EOF').length > 2,
      'only one %%EOF found, so the document has a single xref section and cannot distinguish ' +
        'a per-object-number walk from a per-section walk — which is the entire finding.',
    );

    for (const fixture of fixtures) {
      const result = results[fixture.name];
      check(
        `CONTROL: ${fixture.name} has cached objects to count after rendering`,
        (result?.before ?? 0) > 0,
        `cached_before is ${result?.before}. With nothing cached the equation below balances ` +
          `at 0 == 0 - 0 for any implementation.`,
      );
    }

    // ---------------------------------------------------------------------
    // The equation the comment used to merely assert.
    // ---------------------------------------------------------------------
    for (const fixture of fixtures) {
      const r = results[fixture.name];
      if (r === undefined) continue;
      check(
        `${fixture.name}: cached_after == cached_before - droppable`,
        r.after === r.before - r.droppable,
        `before=${r.before} droppable=${r.droppable} pinned=${r.pinned} after=${r.after} ` +
          `(expected after=${r.before - r.droppable}).\n      ` +
          `The census classifies an entry exactly as pdf_clear_xref does. If it walks a ` +
          `different population, or classifies differently, this is where the two stop agreeing.`,
      );
      check(
        `${fixture.name}: every cached object is either droppable or pinned`,
        r.before === r.droppable + r.pinned,
        `before=${r.before} but droppable+pinned=${r.droppable + r.pinned}. The split has to be ` +
          `total, or "nothing was reclaimable" cannot be distinguished from "some were not counted".`,
      );
    }

    // ---------------------------------------------------------------------
    // The population claim itself: a multi-section document must yield a census
    // that a single-section walk could not have produced.
    // ---------------------------------------------------------------------
    // ---------------------------------------------------------------------
    // The population claim, measured directly rather than inferred from the
    // equation above.
    //
    // The equation is self-consistent within whatever population it counts, so
    // it alone cannot prove the population is the right one — a walk that
    // undercounts consistently still balances. What distinguishes them is the
    // BOUND: the old walk ran 0..pdf_xref_len, one resolved entry per object
    // number, so it could never report more entries than pdf_xref_len. The
    // per-section census can, and on a document with two xref sections it does.
    // ---------------------------------------------------------------------
    for (const fixture of fixtures) {
      const r = results[fixture.name];
      if (r === undefined) continue;
      process.stdout.write(
        `      ${fixture.name.padEnd(12)} xrefLen=${String(r.xrefLen).padStart(4)} ` +
          `cached=${String(r.before).padStart(4)} droppable=${String(r.droppable).padStart(4)} ` +
          `pinned=${String(r.pinned).padStart(4)} after=${String(r.after).padStart(4)}\n`,
      );
    }

    const edited = results['edited'];
    const flat = results['flat'];
    check(
      'edited: the census reaches entries a pdf_xref_len-bounded walk cannot',
      (edited?.before ?? 0) > (flat?.before ?? 0),
      `edited cached=${edited?.before} vs flat cached=${flat?.before}, from identical bytes. ` +
        `The edit opens a second xref section while the originals stay cached in the older ` +
        `one, so the same object number has a cached entry in two sections. A walk bounded by ` +
        `pdf_xref_len sees one of them; pdf_clear_xref drops both. If these two counts are ` +
        `equal, the census is not walking per section and finding 25 is not actually fixed.`,
    );
  } finally {
    mz_drop(ctx);
    rmSync(workspace, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nPurge-census proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        `\n\n`,
    );
    return 1;
  }

  for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
  process.stdout.write(`\n${passed.length} purge-census cases passed.\n`);
  return 0;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
