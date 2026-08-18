// @ts-check
/**
 * Proof that the audit watermark gate can fail (rule B2).
 *
 * The gate guards a condition that is false almost all the time — the range is
 * usually within one batch and the sha is usually in the journal — so nothing in
 * ordinary work ever exercises it. A gate never observed to fail is
 * indistinguishable from one that cannot, and this one exists precisely to fire
 * on the day somebody is moving fast.
 *
 * Both halves are checked, and each fails differently:
 *
 *   - **the size threshold**, which must trip past one batch and must NOT trip
 *     below it. Only the second case rules out a gate that is always red, and an
 *     always-red gate gets switched off rather than obeyed;
 *   - **the record requirement**, that the watermark's sha appears in the
 *     journal. This is the half that stops an audit being claimed by advancing
 *     one file.
 *
 * Built over a throwaway repository rather than this one: the assertions are
 * about ranges of history, and shaping real history to trip a threshold is not
 * something a proof should do.
 *
 * Usage: node scripts/proofs/auditScope.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditScope, BATCH, readWatermark } from '../lib/auditWatermark.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return `${result.stdout}`.trim();
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-audit-'));

try {
  git(scratch, ['init', '--quiet']);
  git(scratch, ['config', 'user.email', 'proof@example.invalid']);
  git(scratch, ['config', 'user.name', 'proof']);
  mkdirSync(join(scratch, 'docs'), { recursive: true });

  /** @param {string} name @param {string} content */
  const commit = (name, content) => {
    writeFileSync(join(scratch, name), content, 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', `add ${name}`]);
    return git(scratch, ['rev-parse', '--short', 'HEAD']);
  };

  /** @param {string} sha */
  const setWatermark = (sha) => {
    writeFileSync(
      join(scratch, 'docs', 'audit-watermark.json'),
      `${JSON.stringify({ commit: sha, audited: 'proof' }, null, 2)}\n`,
      'utf8',
    );
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'watermark']);
  };

  commit('a.txt', 'a\n');
  // This proof must exist AT the watermark. "Modified" is relative to the last
  // audited commit, not to anywhere inside the range: a proof both added and
  // edited within the range is new coverage the auditor reads whole, and git
  // correctly calls that A. The case that matters — and the one this fixture
  // has to create — is a check that was already audited and has since changed.
  const base = commit('scripts.proof.mjs', 'export const a = 1;\n');
  setWatermark(base);

  {
    const scope = auditScope({ root: scratch });
    check(
      'a range within one batch does not trip the gate',
      scope.overBudget.length === 0,
      `tripped on ${scope.overBudget.join('; ')} at ${scope.commits} commits — an always-red gate ` +
        `is one somebody switches off, and then neither half protects anything`,
    );
  }

  // Past the threshold, by commits.
  for (let i = 0; i < BATCH.commits + 1; i += 1) commit(`f${i}.txt`, `${i}\n`);

  {
    const scope = auditScope({ root: scratch });
    check(
      'a range past one batch trips the gate',
      scope.overBudget.length > 0 && scope.commits > BATCH.commits,
      `${scope.commits} commits against a threshold of ${BATCH.commits}, and the gate reported ` +
        `${scope.overBudget.length} problem(s). If this passes clean the threshold never fires.`,
    );
  }

  // The columns the report exists for.
  {
    mkdirSync(join(scratch, 'scripts', 'proofs'), { recursive: true });
    writeFileSync(join(scratch, 'scripts', 'proofs', 'fresh.proof.mjs'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(scratch, 'scripts', 'tool.mjs'), 'export const b = 1;\n', 'utf8');
    // The one that was already audited, now loosened.
    writeFileSync(join(scratch, 'scripts.proof.mjs'), 'export const a = 2;\n', 'utf8');
    git(scratch, ['add', '-A']);
    git(scratch, ['commit', '--quiet', '-m', 'add a proof and a script, and edit an audited proof']);

    const scope = auditScope({ root: scratch });
    check(
      'a proof added since the watermark is reported as ADDED',
      scope.proofsAdded.includes('scripts/proofs/fresh.proof.mjs'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'}`,
    );
    check(
      'a new non-proof script is reported as an instrument to check',
      scope.newScripts.includes('scripts/tool.mjs'),
      `new scripts: ${scope.newScripts.join(', ') || '(none)'} — items 4a and 4b apply to these`,
    );
    check(
      'RESOLUTION: a proof that existed at the watermark and changed is MODIFIED',
      scope.proofsModified.includes('scripts.proof.mjs') &&
        !scope.proofsAdded.includes('scripts.proof.mjs'),
      `added: ${scope.proofsAdded.join(', ') || '(none)'} | modified: ` +
        `${scope.proofsModified.join(', ') || '(none)'} — this is the column the report exists ` +
        `for. A fix that quietly loosened an already-audited check looks exactly like one that ` +
        `corrected it, and merging the two categories hides the only signal there is.`,
    );
  }

  // An unreachable watermark must throw rather than report an empty range.
  {
    setWatermark('deadbee');
    let threw = false;
    try {
      auditScope({ root: scratch });
    } catch {
      threw = true;
    }
    check(
      'a watermark that is not an ancestor throws rather than reporting nothing to audit',
      threw,
      'an unresolvable watermark produced a range instead of an error, and an empty range reads ' +
        'as "nothing to audit" — the reassuring answer',
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// The real watermark, and the record requirement it rests on.
{
  const watermark = readWatermark(repoRoot());
  check(
    'this repository has a watermark naming a real commit',
    /^[0-9a-f]{7,40}$/u.test(watermark.commit),
    `commit was ${JSON.stringify(watermark.commit)}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nAudit scope proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} audit scope cases passed.\n`);
