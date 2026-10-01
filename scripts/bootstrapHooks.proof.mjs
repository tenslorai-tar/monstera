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

import { indexEntries } from './lib/gitScope.mjs';
import { HOOKS_DIRECTORY, hookModeViolation, isHookPath } from './lib/hookFiles.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = resolve(HERE, 'bootstrapHooks.mjs');
const REPO = resolve(HERE, '..');

/**
 * The hooks this repository ships, written out rather than read from the
 * directory: a hook deleted from the index would shrink a derived list along
 * with it, and every per-hook case below would then agree with the loss.
 */
const EXPECTED_HOOKS = ['pre-commit', 'pre-push'];

/**
 * Git for Windows does not consult the executable bit, so a mode case there
 * would observe nothing either way. The index-mode cases still run there; only
 * the ones that ask what git does with a file on disk are skipped, and say so.
 */
const GIT_READS_THE_BIT = process.platform !== 'win32';

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
  // 6. THE PREMISE: git skips a hook it cannot execute, and lets the commit
  //    through. Every case below about modes rests on this, so it is observed
  //    from git rather than assumed. Case 2 is its control: the same hook,
  //    executable, blocks.
  // -------------------------------------------------------------------------
  if (GIT_READS_THE_BIT) {
    const ignored = makeRepo();
    repos.push(ignored);
    git(ignored, ['config', '--local', 'core.hooksPath', HOOKS_DIRECTORY]);
    chmodSync(join(ignored, HOOKS_DIRECTORY, 'pre-commit'), 0o644);
    const through = git(ignored, ['commit', '-m', 'hook without the bit']);
    check(
      'git SKIPS a hook that is not executable, and the commit lands',
      through.status === 0 && git(ignored, ['rev-list', '--all', '--count']).stdout === '1',
      `commit exited ${through.status}. If it was refused, git ran a hook without the bit on ` +
        `this platform, and the mode rule in scripts/lib/hookFiles.mjs guards a premise that ` +
        `does not hold here.\n      ${through.stderr}`,
    );

    // -----------------------------------------------------------------------
    // 7. So the bootstrap refuses to report hooks enabled when git would skip
    //    one, in both places the bit can be lost. Case 1 is the control: an
    //    executable hook, exit 0.
    // -----------------------------------------------------------------------
    const indexLost = makeRepo();
    repos.push(indexLost);
    git(indexLost, ['update-index', '--chmod=-x', '--', `${HOOKS_DIRECTORY}/pre-commit`]);
    chmodSync(join(indexLost, HOOKS_DIRECTORY, 'pre-commit'), 0o644);
    const refusedIndex = runBootstrap(indexLost);
    check(
      'the bootstrap fails when a hook is TRACKED 100644, and names the index repair',
      refusedIndex.status === 1 &&
        refusedIndex.output.includes('git update-index --chmod=+x -- .githooks/pre-commit') &&
        !refusedIndex.output.includes('Git hooks enabled'),
      `exit=${refusedIndex.status}\n      ${refusedIndex.output}`,
    );

    const diskLost = makeRepo();
    repos.push(diskLost);
    chmodSync(join(diskLost, HOOKS_DIRECTORY, 'pre-commit'), 0o644);
    const refusedDisk = runBootstrap(diskLost);
    check(
      'and when the index says 100755 but the file on disk lost the bit, it names the disk repair',
      refusedDisk.status === 1 &&
        refusedDisk.output.includes('chmod +x .githooks/pre-commit') &&
        !refusedDisk.output.includes('update-index'),
      `exit=${refusedDisk.status}\n      ${refusedDisk.output}\n      The two states need ` +
        `different repairs: chmodding the disk over a 100644 entry fixes one machine and leaves ` +
        `every other checkout skipping the hook.`,
    );
  } else {
    process.stdout.write(
      '  --  skipped the on-disk mode cases: Git for Windows does not consult the executable ' +
        'bit, so there is nothing to observe here. They run on the Linux leg.\n',
    );
  }

  // -------------------------------------------------------------------------
  // 8. THIS repository's index records every hook at the mode git will run.
  //    The real defect: `.githooks/pre-push` was 100644 and every case above
  //    and in prePush.proof.mjs read its text, which is the same at any mode.
  // -------------------------------------------------------------------------
  const tracked = indexEntries([HOOKS_DIRECTORY], { cwd: REPO }).filter((entry) =>
    isHookPath(entry.path),
  );
  const trackedNames = tracked.map((entry) => entry.path.slice(HOOKS_DIRECTORY.length + 1));
  check(
    `the index tracks every expected hook (${EXPECTED_HOOKS.join(', ')})`,
    EXPECTED_HOOKS.every((name) => trackedNames.includes(name)),
    `tracked: [${trackedNames.join(', ')}]. A hook absent from the index is absent from every ` +
      `checkout, and the mode case below would pass over it by having nothing to read.`,
  );
  const wrongModes = tracked
    .map((entry) => {
      const reason = hookModeViolation(entry.path, entry.mode);
      return reason === null ? null : `${entry.path} ${reason}`;
    })
    .filter((reason) => reason !== null);
  check(
    'every hook in the index is 100755',
    tracked.length > 0 && wrongModes.length === 0,
    wrongModes.join('\n      ') || 'no hook entries were read at all',
  );

  // CONTROL, from a fixture rather than this index: the same reader and the
  // same rule must REPORT a 100644 entry and pass the same entry once it is
  // 100755. Without it the case above is satisfied by a reader that drops modes.
  const modeFixture = makeRepo();
  repos.push(modeFixture);
  const hookPath = `${HOOKS_DIRECTORY}/pre-commit`;
  git(modeFixture, ['update-index', '--chmod=-x', '--', hookPath]);
  const asNonExecutable = indexEntries([HOOKS_DIRECTORY], { cwd: modeFixture });
  git(modeFixture, ['update-index', '--chmod=+x', '--', hookPath]);
  const asExecutable = indexEntries([HOOKS_DIRECTORY], { cwd: modeFixture });
  check(
    'CONTROL: the reader and rule report a fixture hook at 100644 and pass it at 100755',
    asNonExecutable.length === 1 &&
      asNonExecutable[0]?.mode === '100644' &&
      hookModeViolation(hookPath, asNonExecutable[0].mode) !== null &&
      asExecutable.length === 1 &&
      hookModeViolation(hookPath, asExecutable[0]?.mode ?? '') === null,
    `read ${JSON.stringify(asNonExecutable)} then ${JSON.stringify(asExecutable)}`,
  );

  // -------------------------------------------------------------------------
  // 9. What the pointer points AT, in this repository, exists and runs, for
  //    EVERY hook. This was pre-commit only, which is part of how pre-push's
  //    mode went unseen: the per-hook cases had one hook in their set.
  // -------------------------------------------------------------------------
  for (const name of EXPECTED_HOOKS) {
    const shimPath = join(REPO, HOOKS_DIRECTORY, name);
    if (!existsSync(shimPath)) {
      check(
        `${HOOKS_DIRECTORY}/${name} exists to be pointed at`,
        false,
        `core.hooksPath would name a directory with no ${name} hook, so it would pass ` +
          `unchecked with no error anywhere.`,
      );
      continue;
    }
    const shim = readFileSync(shimPath, 'utf8');
    check(
      `${name}: the hook shim has an LF-only shebang`,
      shim.startsWith('#!') && !shim.slice(0, shim.indexOf('\n')).includes('\r'),
      `Git for Windows' sh parses a trailing CR as part of the command word, so a CRLF hook ` +
        `dies with "/bin/sh^M: bad interpreter" — on the platform this project targets.`,
    );

    // The shim execs a Node module by path. Nothing else checks that path:
    // documentConsistency only inspects files with a text extension, and this
    // file has none.
    const referenced = [...shim.matchAll(/scripts\/[\w./-]*\.mjs/g)].map((match) => match[0]);
    check(
      `${name}: every script the shim executes exists`,
      referenced.length > 0 && referenced.every((path) => existsSync(join(REPO, path))),
      `referenced [${referenced.join(', ')}] — a hook that execs a missing file fails at commit ` +
        `time on someone else's machine, and the name was wrong in two documents for this ` +
        `project's whole life before a check looked.`,
    );

    // The hook's failure MESSAGE is read at the worst possible moment — a cold
    // machine with a broken toolchain — so a pointer to a file that does not
    // exist costs exactly the person least able to absorb it. It pointed at
    // `.nvmrc` for this project's whole life; there has never been one.
    const namedFiles = [...shim.matchAll(/(?<![\w./-])\.[a-z][\w-]*(?:rc|\.json|\.yml|-versions)\b/g)]
      .map((match) => match[0])
      .filter((file) => file !== '.git');
    const absent = [...new Set(namedFiles)].filter((file) => !existsSync(join(REPO, file)));
    check(
      `${name}: every dotfile the shim names in its guidance exists`,
      absent.length === 0,
      `named but absent: ${absent.join(', ')}\n      This message is printed when the toolchain ` +
        `is already broken. Sending that reader to a file that is not there is the one moment ` +
        `the guidance had to be right.`,
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
