// @ts-check
/**
 * Checks that package-lock.json can actually satisfy package.json.
 *
 * This exists because the defect it catches **regenerates**. npm resolves
 * optional platform packages lazily: on win32-x64 it records
 * `@img/sharp-wasm32` in the lockfile but does not walk into its dependencies,
 * because it will never install it here. The result is a lockfile that is
 * complete for this machine and incomplete for every other, and `npm ci` —
 * which validates the lockfile as a whole rather than per-platform — rejects it
 * everywhere.
 *
 * A full `npm install` resolves the whole graph and repairs it. Any *later*
 * incremental install re-prunes and breaks it again. So repairing it once is
 * not a fix; it happened twice here, the second time from adding a single
 * dependency to one workspace.
 *
 * The check is `npm ci --dry-run`, which is npm's own validation rather than a
 * reimplementation of it. Reimplementing npm's resolution would mean owning a
 * second, subtly different opinion about what "in sync" means, and the failure
 * mode of getting that wrong is a guard that passes broken lockfiles.
 *
 * It runs only when a manifest or the lockfile is staged, because it costs a
 * few seconds and nothing else can cause the failure.
 *
 * Usage: node scripts/hooks/lockfileIntegrity.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Locates npm's JavaScript entry point so it can be run with the current node
 * binary.
 *
 * On Windows `npm` is `npm.cmd`, which Node refuses to spawn without
 * `shell: true` (the fix for CVE-2024-27980). Reaching for `shell: true` earns
 * a DEP0190 warning saying the arguments are concatenated rather than escaped —
 * that is, it re-opens the hole the refusal exists to close. Running the JS
 * entry needs no shell and behaves identically everywhere.
 *
 * @returns {string}
 */
function npmCliPath() {
  // Set when this process was itself launched by an npm script.
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv !== undefined && fromEnv.endsWith('.js') && existsSync(fromEnv)) return fromEnv;

  // npm ships beside the node binary in every standard distribution.
  const beside = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(beside)) return beside;

  // Unix installs commonly put node in bin/ with npm one level up in lib/.
  const unix = join(
    dirname(dirname(process.execPath)),
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
  if (existsSync(unix)) return unix;

  throw new Error(
    "Could not locate npm's CLI entry point. Looked beside the node binary and in " +
      "lib/node_modules. This check refuses to fall back to a shell, because escaping " +
      'arguments through one is exactly the hazard Node blocks it for.',
  );
}

/** True when this commit touches dependency resolution at all. */
export function touchesDependencies() {
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (staged.status !== 0) return false;

  return `${staged.stdout ?? ''}`
    .split('\0')
    .some((path) => path === 'package-lock.json' || path.endsWith('package.json'));
}

/**
 * @returns {{ ok: boolean, output: string }}
 */
export function checkLockfile() {
  // --ignore-scripts because validation must not execute dependency lifecycle
  // code; --dry-run because nothing should be written.
  const result = spawnSync(
    process.execPath,
    [npmCliPath(), 'ci', '--dry-run', '--ignore-scripts'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.error !== undefined) {
    return { ok: false, output: `Could not run npm: ${result.error.message}` };
  }
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** @returns {string} */
export function explain(output) {
  return (
    `\nCommit blocked — package-lock.json cannot satisfy package.json.\n\n` +
    `${output
      .split('\n')
      .filter((line) => /^npm (error|warn)/.test(line))
      .filter((line) => !/^npm error {2,}[[-]|Run "npm help|complete log of this run/.test(line))
      .slice(0, 12)
      .join('\n')}\n\n` +
    `  Fix:  rm -rf node_modules package-lock.json && npm install\n\n` +
    `A partial "npm install <pkg>" re-prunes the tree and can drop the ` +
    `transitive dependencies of optional platform packages this machine never ` +
    `installs — leaving a lockfile that works here and fails everywhere else. ` +
    `Only a full resolve walks the whole graph.\n\n`
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { ok, output } = checkLockfile();
  if (!ok) {
    process.stderr.write(explain(output));
    process.exit(1);
  }
  process.stderr.write('Lockfile satisfies package.json.\n');
}
