// @ts-check
/**
 * Proof that the shim-reachability walk reports REACHABLE when a path exists
 * (rule B2, and the search-instrument rule beside stage audit 4a).
 *
 * ## Why the control is the whole proof
 *
 * This instrument is a search, and a search's failure modes all point at the
 * same output: "found nothing". Here that output is the reassuring answer — no
 * OCR door reachable, verdict stands — so a broken walk and a clean result are
 * indistinguishable without a positive control. Four earlier versions of the
 * door derivation returned exactly that, each for a different broken reason, and
 * not one of them announced itself.
 *
 * The run itself carries two controls that must locate something known-present.
 * This proof adds the one they cannot: a shim that DOES reach OCR must be
 * reported as reaching it. Without that case, a walk that returned the empty set
 * for every input would satisfy every other assertion here.
 *
 * Usage: node scripts/proofs/shimReach.proof.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { shimExports, shimReach } from '../security/shimReach.mjs';

const ROOT = repoRoot();
const SOURCE = mupdfSourcePath(ROOT);
const SHIM_PROJECT = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');
const SHIM_SOURCE = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.c');
const FIXTURE_DIR = join(ROOT, '.probe', 'shim-reach');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

// The export scan, against the shape it must not miss.
{
  const synthetic = [
    '#define MZ_EXPORT __declspec(dllexport)',
    'static int helper(int x) { return x; }',
    'MZ_EXPORT int mz_thing(mz_ctx *c)',
    '{',
    '\treturn helper(1);',
    '}',
    'MZ_EXPORT const char *mz_other(mz_ctx *c)',
    '{',
    '\treturn NULL;',
    '}',
  ].join('\n');

  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, 'exports.c');
  writeFileSync(path, synthetic, 'utf8');

  const names = shimExports(path);
  check(
    'the export scan finds exports with and without pointer return types',
    names.length === 2 && names.includes('mz_thing') && names.includes('mz_other'),
    `found ${names.join(', ') || '(none)'} — the root set is what everything downstream walks ` +
      `from, and an incomplete one makes real paths invisible`,
  );
}

if (!existsSync(join(SOURCE, 'source', 'fitz', 'tessocr.h'))) {
  passed.push('SKIPPED: MuPDF source not provisioned — no reachability was measured here');
} else {
  // The real measurement.
  const real = shimReach(SOURCE, SHIM_PROJECT, SHIM_SOURCE);

  for (const control of real.controls) {
    check(`RUN CONTROL: ${control.name}`, control.passed, control.detail);
  }

  check(
    'the real shim reaches no OCR door',
    real.reachedDoors.length === 0,
    `reachable doors: ${real.reachedDoors.join(', ')}\n      ` +
      real.reachedDoors.map((door) => real.pathTo(door).join(' -> ')).join('\n      '),
  );

  check(
    'the walk reaches a substantial part of the engine, not a handful of nodes',
    real.reached > 1000,
    `${real.reached} functions reached from ${real.exports.length} exports. A walk that stalls ` +
      `early reports no doors for the same reason it reports nothing else.`,
  );

  // THE CONTROL. A shim that hands a path to the dispatcher must be reported as
  // reaching OCR. Everything above is satisfied by a walk that always returns
  // the empty set; only this case rules that out.
  {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const path = join(FIXTURE_DIR, 'reaching.c');
    writeFileSync(
      path,
      [
        '#define MZ_EXPORT __declspec(dllexport)',
        'MZ_EXPORT int mz_export_document(fz_context *ctx, const char *path)',
        '{',
        '\tfz_document_writer *w = fz_new_document_writer(ctx, path, NULL, NULL);',
        '\treturn w == NULL;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const reaching = shimReach(SOURCE, SHIM_PROJECT, path);
    check(
      'CONTROL: a shim that passes a path to the dispatcher IS reported as reaching OCR',
      reaching.reachedDoors.includes('fz_new_document_writer'),
      `reported ${reaching.reachedDoors.join(', ') || 'nothing'} — if this comes back clean, the ` +
        `walk returns the empty set regardless of input and the real measurement above means ` +
        `nothing at all`,
    );
  }

}

rmSync(FIXTURE_DIR, { recursive: true, force: true });

if (failures.length > 0) {
  process.stderr.write(
    `\nShim reachability proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} shim reachability cases passed.\n`);
