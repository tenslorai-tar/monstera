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
 * ## THAT PREMISE HOLDS ONLY FOR AN NPM THAT VALIDATES, and one did not
 *
 * Occurrence 3 shipped a broken lockfile past this guard and stopped CI for two
 * days. The guard ran on every commit and said yes, because **`npm ci
 * --dry-run` answered a different question on the npm that ran it**: it
 * resolved an ideal tree and reported what it *would* install — output
 * indistinguishable from validating the recorded one.
 *
 * Bisected against a clean export holding the pre-repair lockfile:
 *
 * | npm | verdict |
 * |---|---|
 * | 11.6.2 | exit 0, `added 217 packages` — resolved an ideal tree |
 * | **11.6.3** | exit 1, `Missing: @emnapi/runtime@1.11.3 from lock file` |
 * | 11.6.4 … 11.17.0 | exit 1, the same |
 *
 * One patch release, not a platform: both CI runners rejected a lockfile this
 * machine installed cleanly, and one of those runners is `windows-latest`.
 *
 * So the guard now **refuses to answer** below {@link LOCKFILE_VALIDATING_NPM}
 * rather than reporting a pass it cannot stand behind — the same shape as
 * refusing to commit when the secret scanner is missing.
 *
 * ## Why a floor and not a pinned npm
 *
 * Provisioning a pinned npm the way `gitleaks` is pinned was the alternative,
 * and it is worse *here* for a reason specific to what this checks. The
 * question is **"will `npm ci` succeed for whoever runs it"**, and the person
 * who runs it uses the npm they have. Validating with a second, provisioned npm
 * would answer about a version nobody installs with. A floor keeps the guard
 * and the eventual install on the same tool.
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

import { NPM_VERSION } from '../lib/toolchain.mjs';

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
 * The oldest npm whose `ci --dry-run` validates the recorded tree rather than
 * resolving an ideal one.
 *
 * **Measured, not chosen.** 11.6.2 accepts the lockfile that stopped CI;
 * 11.6.3 rejects it naming the missing entries. See the table in this file's
 * header. It is deliberately not `NPM_VERSION` from `toolchain.mjs`: that is
 * what the runners happen to ship today, and requiring it would refuse
 * contributors whose npm answers this question perfectly well.
 */
export const LOCKFILE_VALIDATING_NPM = '11.6.3';

/**
 * Compares two dotted version strings numerically.
 *
 * `'11.6.10' < '11.6.3'` under string comparison, which is the ordinary way to
 * get this wrong and would let exactly one npm series through unchecked.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} negative when `left` is older
 */
export function compareVersions(left, right) {
  const parse = (/** @type {string} */ value) =>
    value.split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The npm that would run the check, or `null` when it cannot be established.
 *
 * `null` is not "assume it is fine". A version this cannot read is a version it
 * cannot compare, and the caller treats that the same as too old — for the same
 * reason an unreadable staged list arms the contract-drift gate.
 *
 * @returns {string | null}
 */
export function npmVersion() {
  const result = spawnSync(process.execPath, [npmCliPath(), '--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const reported = `${result.stdout ?? ''}`.trim();
  return /^\d+\.\d+\.\d+/u.test(reported) ? reported : null;
}

/**
 * @returns {{ ok: boolean, output: string }}
 */
export function checkLockfile() {
  // Asked BEFORE the check runs, because the answer decides whether the check
  // means anything. An npm that resolves an ideal tree reports success for a
  // lockfile it never validated, and that success is what shipped occurrence 3.
  const version = npmVersion();
  if (version === null || compareVersions(version, LOCKFILE_VALIDATING_NPM) < 0) {
    return {
      ok: false,
      output:
        `REFUSED: npm ${version ?? '(version could not be read)'} cannot validate a lockfile.\n` +
        `Its \`ci --dry-run\` resolves an ideal tree and reports what it WOULD install, which ` +
        `is indistinguishable from validating the recorded one — measured at 11.6.2, and ` +
        `fixed in ${LOCKFILE_VALIDATING_NPM}.\n`,
    };
  }

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

/**
 * @param {string} output
 * @returns {string}
 */
export function explain(output) {
  if (output.startsWith('REFUSED:')) {
    return (
      `\nCommit blocked — the lockfile check could not be run, so it was not run.\n\n` +
      `${output}\n` +
      // NOT `@latest`, and not a literal. `@latest` is a floating tag, so this
      // guard — which exists because a floating `node-version: 24` moved the
      // runners' npm without a commit — would have been advising a moving
      // target, and today that target is a MAJOR above what CI runs. Sourced
      // from the pin so it cannot drift from it.
      `  Fix:  npm install -g npm@${NPM_VERSION}\n\n` +
      `That is the npm the runners use. The MINIMUM is ${LOCKFILE_VALIDATING_NPM} — anything ` +
      `at or above it validates correctly, so a contributor already past the floor has no ` +
      `reason to move.\n\n` +
      `This is a refusal, not a failure of the lockfile: nothing here says your lockfile is ` +
      `wrong, only that this npm cannot tell. A guard that passes when it could not look is ` +
      `the green tick meaning "did not check" — and that is exactly how a broken lockfile ` +
      `reached CI and stopped it for two days while this check said yes on every commit.\n\n`
    );
  }
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
