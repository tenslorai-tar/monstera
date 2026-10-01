// @ts-check
/**
 * Proof that Guards' history file policy gets a range git accepts and that
 * scans what the change introduces, for every payload shape (rule B2).
 *
 * ## The control is git itself
 *
 * The defect was a value git refuses (`0000…0..sha`, exit 128) and a value git
 * answers with nothing (`..sha` from a dispatch with no `before`). Both are
 * reproduced here against a real repository before the resolved range is
 * checked, so the cases that pass for the fix are cases the unfixed range
 * fails: delete the zero test in `hasNoPreviousTip` and the range handed to git
 * is the refused one again.
 *
 * ## The fixture is one the bug cannot also pass
 *
 * `main` moves on after the branch leaves it, so the default branch's TIP is
 * not the merge base. A resolver that returned `origin/main` itself as the start
 * would agree with the merge base on a fixture where main stood still. And each
 * side adds a distinct file, so "lists the branch's blob and not main's" is
 * something only a correct range produces.
 *
 * The last case reads `guards.yml`: a module the workflow does not call
 * protects nothing, and the old inline arms would pass every other case here.
 *
 * Usage: node scripts/proofs/historyRange.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { historyRange } from '../ci/historyRange.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-history-range-'));

/** @param {string[]} args */
function run(args) {
  return spawnSync(
    'git',
    ['-c', 'user.name=proof', '-c', 'user.email=proof@invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: scratch, encoding: 'utf8' },
  );
}

/** @param {string[]} args */
function must(args) {
  const result = run(args);
  if (result.status !== 0) {
    throw new Error(`fixture: git ${args.join(' ')} exited ${String(result.status)}: ${result.stderr}`);
  }
  return `${result.stdout}`.trim();
}

/** @param {string} name @param {string} text */
function commitFile(name, text) {
  writeFileSync(join(scratch, name), text);
  must(['add', name]);
  must(['commit', '-q', '-m', name]);
  return must(['rev-parse', 'HEAD']);
}

/** Every path `rev-list --objects` names for a range, or null when git refused it. */
function pathsIn(/** @type {string} */ range) {
  const result = run(['rev-list', '--objects', range]);
  if (result.status !== 0) return null;
  return `${result.stdout}`
    .split('\n')
    .map((line) => line.slice(line.indexOf(' ') + 1).trim())
    .filter((path) => path.length > 0 && !/^[0-9a-f]{40}$/.test(path));
}

try {
  must(['init', '-q', '-b', 'main']);
  const fork = commitFile('shared.txt', 'before the branch\n');
  must(['checkout', '-q', '-b', 'work/new']);
  const sha = commitFile('branch-only.txt', 'what the branch introduces\n');
  must(['checkout', '-q', 'main']);
  const mainTip = commitFile('main-only.txt', 'main moved on\n');
  must(['update-ref', 'refs/remotes/origin/main', mainTip]);
  must(['checkout', '-q', 'work/new']);

  const zeros = '0'.repeat(40);

  // -------------------------------------------------------------------------
  // THE BUG, reproduced: what the step used to hand git.
  // -------------------------------------------------------------------------
  {
    const refused = run(['rev-list', '--objects', `${zeros}..${sha}`]);
    check(
      'CONTROL: git refuses the zero range the old step built for a new branch',
      refused.status !== 0,
      `git rev-list ${zeros}..${sha.slice(0, 8)} exited ${String(refused.status)}. If git now ` +
        `accepts it, the premise of this file changed and the cases below prove less than they say.`,
    );
  }
  {
    const vacuous = pathsIn(`..${sha}`);
    check(
      'CONTROL: the range a dispatch with no before built (..sha) scans no blob at all',
      vacuous !== null && vacuous.length === 0,
      `..${sha.slice(0, 8)} named ${JSON.stringify(vacuous)}. The checkout's HEAD is the sha, so ` +
        `this range should be empty; that emptiness is what passed as a scan.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE FIX: a push with no previous tip scans from the merge base.
  // -------------------------------------------------------------------------
  {
    const { range, rule } = historyRange({ before: zeros, sha, defaultBranch: 'main', cwd: scratch });
    const paths = pathsIn(range);
    check(
      'a push that creates the branch scans from the merge base with the default branch',
      rule === 'merge base' && range === `${fork}..${sha}`,
      `resolved ${range} by "${rule}"; expected ${fork.slice(0, 8)}..${sha.slice(0, 8)} by ` +
        `"merge base". The start is the fork point, not main's tip (${mainTip.slice(0, 8)}).`,
    );
    check(
      '  ...and git accepts that range and lists the branch blob, not main or the fork',
      paths !== null &&
        paths.includes('branch-only.txt') &&
        !paths.includes('main-only.txt') &&
        !paths.includes('shared.txt'),
      `git listed ${JSON.stringify(paths)} for ${range}.`,
    );
  }
  {
    const { rule } = historyRange({ before: '0'.repeat(64), sha, defaultBranch: 'main', cwd: scratch });
    check(
      'a SHA-256 null id (sixty-four zeros) is no previous tip either',
      rule === 'merge base',
      `resolved by "${rule}".`,
    );
  }
  {
    const { range, rule } = historyRange({ before: '', sha, defaultBranch: 'main', cwd: scratch });
    check(
      'a dispatch with no before scans from the merge base, not the empty ..sha',
      rule === 'merge base' && (pathsIn(range) ?? []).includes('branch-only.txt'),
      `resolved ${range} by "${rule}".`,
    );
  }

  // -------------------------------------------------------------------------
  // THE PATHS THAT WERE ALREADY RIGHT stay as they were.
  // -------------------------------------------------------------------------
  {
    const { range, rule } = historyRange({ before: fork, sha, defaultBranch: 'main', cwd: scratch });
    check(
      'a push with a previous tip scans before..sha and asks git nothing',
      rule === 'previous tip' && range === `${fork}..${sha}`,
      `resolved ${range} by "${rule}".`,
    );
  }
  {
    const { range, rule } = historyRange({ pullRequestBase: mainTip, before: zeros, sha, cwd: scratch });
    check(
      'a pull request scans base..sha, whatever before holds',
      rule === 'pull request' && range === `${mainTip}..${sha}`,
      `resolved ${range} by "${rule}".`,
    );
  }
  {
    let message = '';
    try {
      historyRange({ before: zeros, sha, defaultBranch: '', cwd: scratch });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check(
      'no previous tip and no default branch is refused, never guessed',
      message.includes('DEFAULT_BRANCH was empty'),
      `threw ${JSON.stringify(message)}.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE WORKFLOW TAKES IT.
  // -------------------------------------------------------------------------
  {
    const workflow = readFileSync(join(repoRoot(), '.github', 'workflows', 'guards.yml'), 'utf8');
    const start = workflow.indexOf('- name: File policy (history introduced by this change)');
    const next = workflow.indexOf('- name:', start + 1);
    const step = start === -1 ? '' : workflow.slice(start, next === -1 ? undefined : next);
    check(
      "guards.yml's history step takes its range from historyRange.mjs, with no inline arm left",
      step.includes('scripts/ci/historyRange.mjs') &&
        step.includes('--range "$range"') &&
        !/run:[\s\S]*github\.event\.before/.test(step),
      step === ''
        ? 'the step was not found by its name; it was renamed or removed.'
        : `the step reads:\n${step}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} historyRange case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('historyRange case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
