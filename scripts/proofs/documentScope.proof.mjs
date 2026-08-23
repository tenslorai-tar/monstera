// @ts-check
/**
 * Proof that the document checker reads from the scope it enumerates from
 * (rule B2).
 *
 * `documentConsistency.mjs` lists documents with `filesInCommit()` — the tree
 * this commit will leave — and used to read their content with `readFileSync`.
 * Those are two different scopes, and the mismatch has a state: **tracked but
 * absent from the working tree**, which crashed the checker on a stack trace
 * where its findings should have been.
 *
 * The first fix guarded that state with `existsSync` and `continue`, which is a
 * level too high: it handles the state instead of removing it, and the price is
 * a document going unchecked while the checker prints success. This is finding
 * 06 in a second file — every other rule reads the staged blob through git,
 * this one reached for the filesystem — and it is closed the same way.
 *
 * The cases below are the two directions of that alignment:
 *
 *   - a tracked document removed from the working tree is still fully checked;
 *   - a document absent from the commit never appears at all, however much of
 *     it is sitting on disk.
 *
 * Usage: node scripts/proofs/documentScope.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { filesInCommit, readStagedBlob, repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
const CHECKER = join(ROOT, 'scripts', 'hooks', 'documentConsistency.mjs');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @returns {{ ok: boolean, output: string }} */
function runChecker() {
  const result = spawnSync(process.execPath, [CHECKER], { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// A document that names a scripts/ path, so check 3 has something to say about
// it and "was it inspected" is answerable from the output.
const SUBJECT = 'docs/ENGINE-SPIKE.md';

// REPAIR BEFORE MEASURING, because `finally` does not run when a process is
// KILLED (finding WWW-1).
//
// The case below removes a TRACKED file from the working tree — deliberately,
// because the property under test is that `check:docs` reads the index, and a
// fixture would not be in the commit to read. The removal is undone in a
// `finally`, which covers every way the case can fail and not the one way the
// PROCESS can end: `checkLocal.mjs` bounds each script and kills the child at
// the bound. Measured 2026-08-23 — a 90-second sweep killed this proof here and
// left `docs/ENGINE-SPIKE.md` deleted in the working tree, where a commit about
// something else would have carried the deletion silently.
//
// So the restore is not only at the end. If the subject is absent from disk and
// present in the index, a previous run was killed mid-case and this puts it
// back before doing anything — and says so, because a repair nobody is told
// about is a defect that stops leaving evidence.
{
  const path = join(ROOT, SUBJECT);
  if (!existsSync(path)) {
    const blob = readStagedBlob(SUBJECT);
    if (blob === null) {
      process.stderr.write(
        `${SUBJECT} is absent from BOTH the working tree and the index. This proof removes it ` +
          `and restores it, so an absence in both places is not something it can repair — the ` +
          `file has to come back from git before this can run.\n`,
      );
      process.exit(1);
    }
    writeFileSync(path, blob);
    process.stdout.write(
      `  repaired ${SUBJECT} — it was missing from the working tree and present in the index,\n` +
        `           which is what a previous run of this proof being KILLED leaves behind.\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// The control: with everything in place, the checker passes. Without this the
// two cases below are satisfied by a checker that always passes.
// ---------------------------------------------------------------------------
{
  const baseline = runChecker();
  check('the checker passes against the tree as it stands', baseline.ok, baseline.output.slice(-600));
}

// ---------------------------------------------------------------------------
// A tracked document removed from the working tree is still fully checked.
// ---------------------------------------------------------------------------
{
  const path = join(ROOT, SUBJECT);
  const saved = readFileSync(path);

  try {
    rmSync(path, { force: true });

    check(
      'the subject really is gone from disk',
      !existsSync(path),
      'the case below would prove nothing if the file were still there',
    );
    check(
      'and is still enumerated, because the commit still contains it',
      filesInCommit().includes(SUBJECT),
      `${SUBJECT} dropped out of the commit scope when it left the working tree, which would make ` +
        `this case vacuous`,
    );
    check(
      'and its content is still readable, from the index',
      (readStagedBlob(SUBJECT)?.length ?? 0) > 0,
      'no blob for a path the commit contains — the two scopes disagree',
    );

    const run = runChecker();
    check(
      'the checker still passes, having inspected it rather than skipped or crashed',
      run.ok && !/ENOENT|no such file/iu.test(run.output),
      `A crash here is the original defect. A pass that came from SKIPPING the document is the ` +
        `first fix's defect, and is what the index read removes — there is no longer a code path ` +
        `that can skip.\n      ${run.output.slice(-800)}`,
    );
  } finally {
    writeFileSync(path, saved);
  }
}

// ---------------------------------------------------------------------------
// A document absent from the commit never appears, however much is on disk.
// ---------------------------------------------------------------------------
{
  // Untracked, unstaged, and containing a reference that check 3 would report
  // if it ever read it.
  const stray = join(ROOT, 'docs', '__scope_probe__.md');

  try {
    writeFileSync(stray, 'This names scripts/does-not-exist-anywhere.mjs as a live pointer.\n', 'utf8');

    check(
      'a file on disk but not in the commit is not enumerated',
      !filesInCommit().includes('docs/__scope_probe__.md'),
      'an untracked file entered the commit scope, so the checker would inspect content nobody is ' +
        'committing',
    );

    const run = runChecker();
    check(
      'and the checker does not report on it',
      run.ok && !run.output.includes('__scope_probe__'),
      `The stray names a scripts/ path that does not resolve. If the checker reports it, it is ` +
        `reading the filesystem rather than the commit.\n      ${run.output.slice(-800)}`,
    );
  } finally {
    rmSync(stray, { force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nDocument-scope proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} document-scope cases passed.\n`);
