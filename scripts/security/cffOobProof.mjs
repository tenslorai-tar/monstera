// @ts-check
/**
 * Proof that CVE-2026-7233's bounds check is present in our compiled MuPDF, and
 * that it is load-bearing (rule B2).
 *
 * Verifying by executing rather than asserting. The fix was confirmed present by
 * reading the source and tracing the call path — but "the check is in the
 * source" and "the built engine does not over-read" are different statements,
 * and using the first to skip testing the second is exactly the ass-out-of-u-
 * and-me shortcut this project bans. So:
 *
 *   1. Build cff_poc.exe against our real, pinned libmupdf and run the malformed
 *      CFF through fz_subset_cff_for_gids. Expect a CLEAN throw — the check
 *      holds, nothing crashes.
 *   2. The control. Rebuild libmupdf from a COPY of the source with the two
 *      bounds checks removed, rebuild the exe against it, run the same input.
 *      Expect a CRASH — which proves the checks in step 1 are what stopped the
 *      over-read, not something incidental. This leaves a permanent regression
 *      fixture: if a future MuPDF bump drops the checks, step 1 crashes.
 *
 * The malformed CFF is placed against a guard page (see cff_poc.c), so the small
 * over-read is a deterministic access violation rather than an unnoticed read of
 * adjacent heap.
 *
 * Usage: node scripts/security/cffOobProof.mjs
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from '../lib/msvc.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { malformedCff } from './makeCffFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

const ROOT = repoRoot();
const POC_DIR = join(ROOT, 'native', 'cff-poc');
const POC_EXE = join(POC_DIR, 'out', 'cff_poc.exe');
const POC_PROJECT = join(POC_DIR, 'cff_poc.vcxproj');

/**
 * Runs cff_poc.exe on a fixture and classifies the outcome.
 *
 * @param {string} fixture
 * @returns {{ outcome: 'caught' | 'returned' | 'crashed', code: number, output: string }}
 */
function runPoc(fixture) {
  const result = spawnSync(POC_EXE, [fixture], { encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const code = result.status ?? -1;

  // A Windows access violation surfaces as a large unsigned status
  // (0xC0000005) or a negative signal; either way it is not one of the clean
  // codes the harness returns deliberately.
  if (code === 0) return { outcome: 'caught', code, output };
  if (code === 3) return { outcome: 'returned', code, output };
  return { outcome: 'crashed', code, output };
}

/** The scratch-directory prefix this proof owns, in the system temp directory. */
const SCRATCH_PREFIX = 'monstera-cff-';

/**
 * How old an abandoned scratch tree must be before it is removed.
 *
 * A complete run costs 864s and 792s (two readings, both 2026-08-31 on the
 * developer machine, from `npm run proof:cff` with no bound over it), so an
 * hour is comfortably beyond any live run and a concurrent one is never removed
 * out from under itself.
 *
 * That margin is not free and it is the right trade: the first run of this
 * swept 9 of the 10 trees present and skipped one left 50 minutes earlier by a
 * killed sweep. A tree survives until the next run, which costs disk; removing
 * one while its run is alive would delete a source tree mid-build.
 */
const ABANDONED_MS = 60 * 60 * 1000;

/**
 * Removes scratch trees an interrupted run left behind.
 *
 * Case 2 copies the whole built MuPDF source tree, and `rmSync` lives in a
 * `finally` — which a SIGTERM skips. Measured 2026-08-31: **ten** of these had
 * accumulated in the temp directory, one per killed run, each a full copy
 * including build output. `du` over them did not finish inside 300s.
 *
 * The bound that killed those runs was itself the defect and is fixed in
 * `checkLocal.mjs`, so this is not what stops the leak — it is this proof
 * owning the resource it creates, for the interruptions that remain possible:
 * a Ctrl-C, a reboot, a genuine hang. Nothing else knows this prefix, so
 * nothing else could clean it up (B3a).
 *
 * @returns {number} how many were removed, for the run's own output.
 */
function sweepAbandonedScratch() {
  const root = tmpdir();
  let removed = 0;
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    // An unreadable temp directory is not this proof's business to report: the
    // run below will fail on its own when it cannot create its scratch.
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue;
    if (entry === `${SCRATCH_PREFIX}${process.pid}`) continue;
    const path = join(root, entry);
    try {
      if (Date.now() - statSync(path).mtimeMs < ABANDONED_MS) continue;
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Held open by something, or gone since the listing. Either way the next
      // run tries again, and a tree left behind costs disk rather than
      // correctness.
    }
  }
  return removed;
}

/** @param {string} fixtureDir @returns {string} */
function writeFixture(fixtureDir) {
  mkdirSync(fixtureDir, { recursive: true });
  const fixture = join(fixtureDir, 'cff-oob-index.bin');
  writeFileSync(fixture, malformedCff());
  return fixture;
}

async function main() {
  if (process.platform !== 'win32') {
    process.stdout.write('  skip  the CFF PoC links MuPDF and is Windows-only today\n');
    return 0;
  }

  const source = mupdfSourcePath(ROOT);
  if (!existsSync(join(source, 'platform', 'win32', 'x64', 'Release', 'libmupdf.lib'))) {
    process.stderr.write(
      `\nlibmupdf is not built. Run:  npm run provision:mupdf\n\n` +
        `This proof links the pinned engine and cannot run without it.\n\n`,
    );
    return 1;
  }

  const abandoned = sweepAbandonedScratch();
  if (abandoned > 0) {
    process.stdout.write(`  swept ${String(abandoned)} scratch tree(s) an interrupted run left\n`);
  }

  const scratch = join(tmpdir(), `${SCRATCH_PREFIX}${String(process.pid)}`);
  mkdirSync(scratch, { recursive: true });
  /** @type {string[]} */
  const failures = [];
  // Each label is recorded by the case that earns it, rather than printed from
  // a fixed block that a deleted case would outlive — see
  // scripts/lib/passRoster.mjs.
  const roster = createRoster(failures, { cases: 2 });
  let mark = roster.mark();

  try {
    const fixture = writeFixture(join(scratch, 'fixtures'));

    // --- Case 1: our real, pinned build must NOT over-read.
    build({
      project: POC_PROJECT,
      properties: ['Configuration=Release', 'Platform=x64', `MupdfRoot=${source}`],
      label: 'cff_poc (against pinned libmupdf)',
    });
    const real = runPoc(fixture);
    process.stdout.write(`  pinned build: ${real.outcome} (exit ${real.code}) ${real.output.trim()}\n`);
    if (real.outcome !== 'caught') {
      failures.push(
        `the pinned engine did not cleanly reject the malformed CFF: ${real.outcome} ` +
          `(exit ${real.code}). If this is a CRASH, CVE-2026-7233's bounds check is NOT in the ` +
          `built engine.`,
      );
    }
    roster.record(mark, 'the pinned engine rejects the malformed CFF without over-reading');

    mark = roster.mark();
    // --- Case 2: the control. Remove the checks in a copy and confirm a crash.
    const patchedSource = join(scratch, 'mupdf-src');
    cpSync(source, patchedSource, { recursive: true });
    removeBoundsChecks(join(patchedSource, 'source', 'fitz', 'subset-cff.c'));

    // Rebuild only what changed: MSBuild recompiles subset-cff.c and re-archives
    // libmupdf.lib. Then relink the exe against the patched tree.
    build({
      project: join(patchedSource, 'platform', 'win32', 'mupdf.sln'),
      target: 'libmupdf',
      properties: ['Configuration=Release', 'Platform=x64', 'PlatformToolset=v143'],
      label: 'libmupdf WITHOUT the bounds checks (control)',
    });
    build({
      project: POC_PROJECT,
      properties: ['Configuration=Release', 'Platform=x64', `MupdfRoot=${patchedSource}`],
      label: 'cff_poc (against the unpatched-check control)',
    });
    const control = runPoc(fixture);
    process.stdout.write(`  control build: ${control.outcome} (exit ${control.code}) ${control.output.trim()}\n`);
    if (control.outcome !== 'crashed') {
      failures.push(
        `removing the bounds checks did NOT cause a crash (${control.outcome}, exit ` +
          `${control.code}). The checks may not be load-bearing, or the fixture no longer ` +
          `reaches them — either way case 1 proves nothing until this control crashes.`,
      );
    }
    roster.record(mark, 'removing the bounds checks makes the same input crash');
  } finally {
    // Rebuild the exe against the real tree so no artifact linked to the patched
    // libmupdf is left behind, then drop the scratch tree.
    try {
      build({
        project: POC_PROJECT,
        properties: ['Configuration=Release', 'Platform=x64', `MupdfRoot=${source}`],
        label: 'cff_poc (restore against pinned libmupdf)',
      });
    } catch {
      /* best effort */
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} CFF proof failure(s):\n\n${failures.join('\n\n')}\n\n`);
    return 1;
  }

  process.stdout.write(`\n${roster.format('CFF case')}`);
  return 0;
}

/**
 * Removes the two bounds checks CVE-2026-7233 added, in a scratch copy only.
 *
 * Matched by their throw text rather than by line number, so the control still
 * points at the right code after an upstream reshuffle. If neither is found the
 * control cannot run, and that is reported rather than passed.
 *
 * @param {string} file
 */
function removeBoundsChecks(file) {
  let text = readFileSync(file, 'utf8');
  const before = text;

  // The two guards, each an `if (...) fz_throw(..., "Truncated index");` around
  // index->data_offset. Neutralise the condition so the throw cannot fire.
  text = text.replace(
    /if \(index->data_offset > len\)\s*\n\s*fz_throw\(ctx, FZ_ERROR_FORMAT, "Truncated index"\);/,
    '/* control: data_offset > len check removed */',
  );
  text = text.replace(
    /if \(index->data_offset \+ v > len\)\s*\n\s*fz_throw\(ctx, FZ_ERROR_FORMAT, "Truncated index"\);/,
    '/* control: data_offset + v check removed */',
  );

  if (text === before) {
    throw new Error(
      `Could not find CVE-2026-7233's bounds checks in ${file} to remove them. The control ` +
        `cannot be built, so this proof would only ever show the pass path — it fails instead.`,
    );
  }
  writeFileSync(file, text);
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exit(1);
  },
);
