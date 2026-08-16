// @ts-check
/**
 * Points this clone's git hooks at the tracked .githooks/ directory.
 *
 * core.hooksPath is used rather than copying files into .git/hooks because the
 * hooks then live under version control: a fix to a hook reaches every
 * contributor on their next pull, instead of silently leaving everyone who
 * copied the old one unprotected. .git/hooks is never tracked and never
 * distributed, which is exactly why hooks installed that way rot.
 *
 * Runs automatically from the `prepare` npm lifecycle script on install.
 * Safe to run repeatedly.
 */

import { spawnSync } from 'node:child_process';

const HOOKS_PATH = '.githooks';

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

function main() {
  const inRepo = git(['rev-parse', '--is-inside-work-tree']);
  if (inRepo.status !== 0 || inRepo.stdout !== 'true') {
    // Installing from a tarball rather than a clone: there are no hooks to
    // configure and that is not an error.
    process.stderr.write('Not a git work tree — skipping hook bootstrap.\n');
    return 0;
  }

  const current = git(['config', '--local', '--get', 'core.hooksPath']);
  if (current.status === 0 && current.stdout === HOOKS_PATH) return 0;

  const set = git(['config', '--local', 'core.hooksPath', HOOKS_PATH]);
  if (set.status !== 0) {
    process.stderr.write(`Failed to set core.hooksPath: ${set.stderr}\n`);
    return 1;
  }

  process.stderr.write(`Git hooks enabled from ${HOOKS_PATH}/.\n`);
  return 0;
}

process.exit(main());
