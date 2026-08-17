// @ts-check
/**
 * Proof that a stale shim is refused rather than measured (rule B2).
 *
 * The failure this guards is the one that looks most like success. A native
 * measurement taken through a DLL built from older source still runs, still
 * prints plausible numbers, and prints them with the confidence of a fresh
 * build. Batch 4's ADR-0010 reproduction was byte-identical across four
 * rebuilds — 155,548,924 bytes, 1,547 blocks — which was correct, because none
 * of those changes touch that workload. But byte-identical is also exactly what
 * a stale DLL produces, and nothing in the run could tell the two apart.
 *
 * So the cases below are a pair. The refusal has to fire when the source moves,
 * AND it has to stay quiet when it has not — a check that refuses always is a
 * check that gets deleted the first time it blocks a real run.
 *
 * Every case operates on a COPY of the repository's shim directory under the OS
 * temp directory. Nothing here writes to the real build output, so running the
 * proof cannot itself invalidate the DLL the other proofs are about to load.
 *
 * Usage: node scripts/lib/shimBinary.proof.mjs
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { repoRoot } from './gitScope.mjs';
import { recordShimBuild, shimBuildState, requireCurrentShim } from './shimBinary.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

const REAL = repoRoot();
const workspace = mkdtempSync(join(tmpdir(), 'monstera-shimstate-'));

/**
 * A standalone copy of the shim tree: source, project file, and a stand-in for
 * the built DLL. The DLL's CONTENT is irrelevant here — nothing loads it — so a
 * placeholder keeps the proof from copying 42 MB per case.
 *
 * @returns {string}
 */
function makeTree() {
  const root = mkdtempSync(join(workspace, 'root-'));
  const shim = join(root, 'native', 'mupdf-shim');
  mkdirSync(join(shim, 'out'), { recursive: true });
  cpSync(join(REAL, 'native', 'mupdf-shim', 'monstera_mupdf.c'), join(shim, 'monstera_mupdf.c'));
  cpSync(
    join(REAL, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj'),
    join(shim, 'monstera_mupdf.vcxproj'),
  );
  writeFileSync(join(shim, 'out', 'monstera_mupdf.dll'), 'placeholder');
  return root;
}

try {
  // -------------------------------------------------------------------------
  // The quiet case first. If this fails, every refusal below is meaningless.
  // -------------------------------------------------------------------------
  const clean = makeTree();
  recordShimBuild({ root: clean, version: 'test' });
  check(
    'CONTROL: a DLL built from the current source is accepted',
    shimBuildState({ root: clean }).current,
    `refused with: ${shimBuildState({ root: clean }).reason}\n      A check that refuses ` +
      `unconditionally passes every rejection case and gets deleted the first time it blocks a ` +
      `real run.`,
  );
  check(
    'CONTROL: requireCurrentShim returns the path rather than throwing',
    (() => {
      try {
        return requireCurrentShim({ root: clean }).endsWith('monstera_mupdf.dll');
      } catch {
        return false;
      }
    })(),
    'the accept path has to work, or the proofs that call it never run at all',
  );

  // -------------------------------------------------------------------------
  // The source moves after the build.
  // -------------------------------------------------------------------------
  const editedSource = makeTree();
  recordShimBuild({ root: editedSource, version: 'test' });
  const sourcePath = join(editedSource, 'native', 'mupdf-shim', 'monstera_mupdf.c');
  writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n/* one comment */\n`, 'utf8');
  const editedState = shimBuildState({ root: editedSource });
  check(
    'a one-comment edit to the .c file makes the DLL stale',
    !editedState.current,
    'this is the whole case: the DLL is untouched and still loads, and the only way to know it ' +
      'is answering a question about different code is to compare it against the source.',
  );
  check(
    'the refusal NAMES the file that moved',
    editedState.reason.includes('monstera_mupdf.c'),
    `reason was: ${editedState.reason}\n      "something changed" sends the reader looking; ` +
      `"monstera_mupdf.c changed" sends them to the rebuild.`,
  );

  // -------------------------------------------------------------------------
  // The project file counts too: it carries the optimisation level, and /O2 is
  // exactly what makes the missing fz_var declarations matter.
  // -------------------------------------------------------------------------
  const editedProject = makeTree();
  recordShimBuild({ root: editedProject, version: 'test' });
  const projectPath = join(editedProject, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');
  writeFileSync(projectPath, `${readFileSync(projectPath, 'utf8')}\n<!-- edit -->\n`, 'utf8');
  check(
    'editing the .vcxproj also makes the DLL stale',
    !shimBuildState({ root: editedProject }).current,
    'the project file decides the optimisation level, and /O2 is what makes a missing fz_var ' +
      'change behaviour. A DLL built under different flags is a different DLL.',
  );

  // -------------------------------------------------------------------------
  // A build that never recorded anything is unknown, not assumed good.
  // -------------------------------------------------------------------------
  const unrecorded = makeTree();
  const unrecordedState = shimBuildState({ root: unrecorded });
  check(
    'a DLL with no build manifest is refused, not assumed current',
    !unrecordedState.current && unrecordedState.reason.includes('missing'),
    `reason was: ${unrecordedState.reason}\n      Defaulting to "probably fine" for a DLL that ` +
      `cannot say what it came from is the assumption this whole file exists to remove.`,
  );

  const missingDll = makeTree();
  rmSync(join(missingDll, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll'));
  check(
    'a missing DLL is reported as such, with the command that builds it',
    !shimBuildState({ root: missingDll }).current &&
      shimBuildState({ root: missingDll }).reason.includes('provision/mupdf.mjs'),
    `reason was: ${shimBuildState({ root: missingDll }).reason}`,
  );

  // -------------------------------------------------------------------------
  // Timestamps are NOT the mechanism, and this is why.
  // -------------------------------------------------------------------------
  const touched = makeTree();
  recordShimBuild({ root: touched, version: 'test' });
  const dllPath = join(touched, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
  const contents = readFileSync(join(touched, 'native', 'mupdf-shim', 'monstera_mupdf.c'), 'utf8');
  writeFileSync(join(touched, 'native', 'mupdf-shim', 'monstera_mupdf.c'), contents, 'utf8');
  check(
    'rewriting the source with IDENTICAL bytes does not make the DLL stale',
    shimBuildState({ root: touched }).current && existsSync(dllPath),
    'an mtime-based check fires here for no reason — a checkout, a restored cache or a file ' +
      'copy all rewrite timestamps without changing what would be compiled. The source bytes ' +
      'are the thing that has to match.',
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nShim-freshness proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} shim-freshness cases passed.\n`);
