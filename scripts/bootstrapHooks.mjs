// @ts-check
/**
 * Points this clone's git hooks at the tracked .githooks/ directory, and
 * refuses to report them enabled when git would skip one.
 *
 * core.hooksPath is used rather than copying files into .git/hooks because the
 * hooks then live under version control: a fix to a hook reaches every
 * contributor on their next pull, instead of silently leaving everyone who
 * copied the old one unprotected. .git/hooks is never tracked and never
 * distributed, which is exactly why hooks installed that way rot.
 *
 * Setting the pointer is half of "hooks are enabled". The other half is that
 * git will execute what it points at: off Windows, git checks the executable
 * bit on disk and skips a hook without it, printing a hint and letting the
 * commit or push through (see scripts/lib/hookFiles.mjs). A checkout with
 * `core.fileMode=false`, a copy that dropped modes, or an index entry tracked
 * 100644 all leave the pointer set and the hook unrun, so that is checked here,
 * on every run, rather than only when the pointer is first written.
 *
 * Runs automatically from the `prepare` npm lifecycle script on install.
 * Safe to run repeatedly.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

import { indexEntries } from './lib/gitScope.mjs';
import { HOOKS_DIRECTORY, hookModeViolation, isHookPath } from './lib/hookFiles.mjs';

/**
 * @param {readonly string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(args) {
  const result = spawnSync('git', [...args], { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: `${result.stdout ?? ''}`.trim(),
    stderr: `${result.stderr ?? ''}`.trim(),
  };
}

/**
 * Why each tracked hook would not be executed on this machine; empty when every
 * one would.
 *
 * Read from the index, as the hooks a checkout carries, and judged against the
 * disk, because the disk is what git's executable test reads at hook time. The
 * index mode decides which repair the message names: a 100644 entry is fixed in
 * the index, where it will reach everyone; a 100755 entry whose file lost the
 * bit is fixed on this disk alone.
 *
 * @param {string} root
 * @returns {string[]}
 */
function unexecutableHooks(root) {
  // `cwd` is passed so the reader never roots itself: this script has already
  // asked git whether it is in a work tree and must decline quietly outside one.
  const hooks = indexEntries([HOOKS_DIRECTORY], { cwd: root }).filter((entry) =>
    isHookPath(entry.path),
  );
  /** @type {string[]} */
  const reasons = [];
  for (const { mode, path } of hooks) {
    const indexReason = hookModeViolation(path, mode);
    if (indexReason !== null) {
      reasons.push(`${path} ${indexReason}`);
      continue;
    }
    try {
      accessSync(join(root, path), constants.X_OK);
    } catch {
      reasons.push(
        `${path} is tracked ${mode} but the file on this disk is not executable, so git skips ` +
          `it here. The index is already right; restore the bit locally: chmod +x ${path}`,
      );
    }
  }
  if (hooks.length === 0) {
    reasons.push(
      `no hook is tracked under ${HOOKS_DIRECTORY}/, so core.hooksPath would point at nothing ` +
        `and every commit would pass unchecked.`,
    );
  }
  return reasons;
}

function main() {
  const inRepo = git(['rev-parse', '--is-inside-work-tree']);
  if (inRepo.status !== 0 || inRepo.stdout !== 'true') {
    // Installing from a tarball rather than a clone: there are no hooks to
    // configure and that is not an error.
    process.stderr.write('Not a git work tree — skipping hook bootstrap.\n');
    return 0;
  }

  const current = git(['config', '--local', '--get', 'core.hooksPath']);
  const alreadySet = current.status === 0 && current.stdout === HOOKS_DIRECTORY;
  if (!alreadySet) {
    const set = git(['config', '--local', 'core.hooksPath', HOOKS_DIRECTORY]);
    if (set.status !== 0) {
      process.stderr.write(`Failed to set core.hooksPath: ${set.stderr}\n`);
      return 1;
    }
  }

  // Git for Windows runs a hook whatever its mode, so the disk test has nothing
  // to report there; the index mode is still held by guardFiles at commit time
  // and in CI, where it decides what every other platform checks out.
  if (process.platform !== 'win32') {
    const reasons = unexecutableHooks(git(['rev-parse', '--show-toplevel']).stdout);
    if (reasons.length > 0) {
      process.stderr.write(
        `\nGit hooks are NOT enabled: core.hooksPath points at ${HOOKS_DIRECTORY}/, and git ` +
          `will skip the following hook(s) on this machine:\n\n` +
          reasons.map((reason) => `  - ${reason}`).join('\n\n') +
          `\n\nThis install fails rather than reporting hooks enabled, because a skipped hook ` +
          `prints one hint at commit or push time and lets the change through unchecked.\n\n`,
      );
      return 1;
    }
  }

  if (!alreadySet) process.stderr.write(`Git hooks enabled from ${HOOKS_DIRECTORY}/.\n`);
  return 0;
}

process.exit(main());
