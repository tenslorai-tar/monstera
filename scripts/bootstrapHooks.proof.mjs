// @ts-check
/**
 * Proof that hook bootstrapping actually causes hooks to run (rule B2).
 *
 * bootstrapHooks.mjs is the single point of failure for every guard in this
 * repository: the file policy, the lockfile check and the secret scan all reach
 * a contributor's machine through it, and nothing else. It had no proof at all —
 * which is the uncomfortable shape, because a bootstrap that quietly does
 * nothing produces a repository where every commit passes and no check ever ran.
 *
 * The weak version of this proof reads `core.hooksPath` back and calls it done.
 * That asserts a string was written to a config file. The claim that matters is
 * one step further on — that git CONSULTS that setting and refuses the commit —
 * so the cases below make a real commit against a hook that fails, and the
 * control makes the same commit with the setting absent to show the difference
 * is the setting and not the hook file merely existing.
 *
 * Usage: node scripts/bootstrapHooks.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = resolve(HERE, 'bootstrapHooks.mjs');
const REPO = resolve(HERE, '..');
const HOOKS_DIRECTORY = '.githooks';

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
 * @param {string} cwd
 * @param {readonly string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(cwd, args) {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: `${result.stdout ?? ''}`.trim(),
    stderr: `${result.stderr ?? ''}`.trim(),
  };
}

/** @param {string} cwd @returns {{ status: number, output: string }} */
function runBootstrap(cwd) {
  const result = spawnSync(process.execPath, [BOOTSTRAP], { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * A throwaway repository carrying a hook that always fails, so "did the commit
 * go through" answers "did the hook run".
 *
 * @returns {string}
 */
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'monstera-hooks-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'proof@monstera.invalid']);
  git(repo, ['config', 'user.name', 'proof']);

  mkdirSync(join(repo, HOOKS_DIRECTORY), { recursive: true });
  const hook = join(repo, HOOKS_DIRECTORY, 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "guard ran" >&2\nexit 1\n', 'utf8');
  chmodSync(hook, 0o755);

  writeFileSync(join(repo, 'file.txt'), 'content\n', 'utf8');
  git(repo, ['add', '-A']);
  return repo;
}

const repos = [];
try {
  // -------------------------------------------------------------------------
  // 1. The bootstrap sets the pointer.
  // -------------------------------------------------------------------------
  const repo = makeRepo();
  repos.push(repo);

  const before = git(repo, ['config', '--local', '--get', 'core.hooksPath']);
  check(
    'a fresh clone has no hooksPath, so the bootstrap has something to do',
    before.status !== 0 || before.stdout === '',
    `found ${JSON.stringify(before.stdout)} before running the bootstrap — this case cannot ` +
      `distinguish a working bootstrap from a preconfigured repository.`,
  );

  const first = runBootstrap(repo);
  const after = git(repo, ['config', '--local', '--get', 'core.hooksPath']);
  check(
    'the bootstrap exits 0 and points core.hooksPath at the tracked directory',
    first.status === 0 && after.stdout === HOOKS_DIRECTORY,
    `exit=${first.status}, hooksPath=${JSON.stringify(after.stdout)}\n      ${first.output}`,
  );

  // -------------------------------------------------------------------------
  // 2. The mechanism fires: git consults the setting and the commit is refused.
  // -------------------------------------------------------------------------
  const blocked = git(repo, ['commit', '-m', 'should be refused']);
  check(
    'after bootstrapping, a failing hook actually blocks the commit',
    blocked.status !== 0 && git(repo, ['rev-list', '--all', '--count']).stdout === '0',
    `commit exited ${blocked.status} and the repository has ` +
      `${git(repo, ['rev-list', '--all', '--count']).stdout} commit(s). If the commit landed, ` +
      `core.hooksPath was written but never consulted — which is the state a config-only ` +
      `assertion reports as success.`,
  );

  // -------------------------------------------------------------------------
  // 3. CONTROL: the same repository, same hook file, hooksPath removed.
  // -------------------------------------------------------------------------
  const control = makeRepo();
  repos.push(control);
  const unset = git(control, ['config', '--local', '--unset', 'core.hooksPath']);
  const allowed = git(control, ['commit', '-m', 'control: no hooksPath']);
  check(
    'CONTROL: without hooksPath the identical hook does not run and the commit lands',
    allowed.status === 0 && git(control, ['rev-list', '--all', '--count']).stdout === '1',
    `unset exited ${unset.status}; commit exited ${allowed.status}. If this commit is ALSO ` +
      `blocked, case 2 is not measuring core.hooksPath and proves nothing about the bootstrap.`,
  );

  // -------------------------------------------------------------------------
  // 4. Idempotent — `prepare` runs on every install.
  // -------------------------------------------------------------------------
  const second = runBootstrap(repo);
  const third = runBootstrap(repo);
  check(
    'running the bootstrap repeatedly is safe and stays set',
    second.status === 0 &&
      third.status === 0 &&
      git(repo, ['config', '--local', '--get', 'core.hooksPath']).stdout === HOOKS_DIRECTORY,
    `second=${second.status} third=${third.status}`,
  );

  // -------------------------------------------------------------------------
  // 5. Outside a work tree it declines rather than failing the install.
  // -------------------------------------------------------------------------
  const notARepo = mkdtempSync(join(tmpdir(), 'monstera-nonrepo-'));
  repos.push(notARepo);
  const outside = runBootstrap(notARepo);
  check(
    'outside a git work tree the bootstrap declines without failing',
    outside.status === 0,
    `exit=${outside.status}. Installing from a tarball has no hooks to configure, and a ` +
      `non-zero exit there would break the install for a case that is not an error.\n      ` +
      `${outside.output}`,
  );

  // -------------------------------------------------------------------------
  // 6. What the pointer points AT, in this repository, actually exists.
  // -------------------------------------------------------------------------
  const shimPath = join(REPO, HOOKS_DIRECTORY, 'pre-commit');
  check(
    `${HOOKS_DIRECTORY}/pre-commit exists to be pointed at`,
    existsSync(shimPath),
    `core.hooksPath would name a directory with no pre-commit hook, so every commit would ` +
      `pass unchecked with no error anywhere.`,
  );

  if (existsSync(shimPath)) {
    const shim = readFileSync(shimPath, 'utf8');
    check(
      'the hook shim has an LF-only shebang',
      shim.startsWith('#!') && !shim.slice(0, shim.indexOf('\n')).includes('\r'),
      `Git for Windows' sh parses a trailing CR as part of the command word, so a CRLF hook ` +
        `dies with "/bin/sh^M: bad interpreter" — on the platform this project targets.`,
    );

    // The shim execs a Node module by path. Nothing else checks that path:
    // documentConsistency only inspects files with a text extension, and this
    // file has none.
    const referenced = [...shim.matchAll(/scripts\/[\w./-]*\.mjs/g)].map((match) => match[0]);
    check(
      'every script the shim executes exists',
      referenced.length > 0 && referenced.every((path) => existsSync(join(REPO, path))),
      `referenced [${referenced.join(', ')}] — a hook that execs a missing file fails at commit ` +
        `time on someone else's machine, and the name was wrong in two documents for this ` +
        `project's whole life before a check looked.`,
    );
  }
} finally {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nHook bootstrap proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nEvery guard in this repository reaches a contributor through this one script.\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} hook bootstrap cases passed.\n`);
