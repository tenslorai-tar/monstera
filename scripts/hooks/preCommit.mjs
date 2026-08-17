// @ts-check
/**
 * The pre-commit gate. Two checks, both blocking:
 *
 *   1. Staged content policy (guardFiles.mjs).
 *   2. Secret scan of the staged diff (gitleaks).
 *
 * Both fail *closed*. If gitleaks cannot be found, the commit is rejected with
 * instructions rather than allowed through with a warning: a scanner that
 * silently skips itself when absent reports success for a scan that never ran,
 * which is precisely the green-check-that-verifies-nothing this project bans.
 * A rejected commit costs one command; a leaked credential in a public
 * repository's permanent history cannot be undone at any price.
 */

import { spawnSync } from 'node:child_process';

import { GITLEAKS_VERSION, resolveGitleaks } from '../provision/gitleaks.mjs';
import { formatFailures, guardFiles } from './guardFiles.mjs';
import { checkLockfile, explain, touchesDependencies } from './lockfileIntegrity.mjs';

/**
 * The repository being committed to, asked of git rather than derived from
 * this file's own location. A git worktree keeps its checkout outside the
 * main clone, so a path computed from __dirname would point the scan at the
 * wrong tree — it would report success for a tree nobody committed to.
 *
 * @returns {string}
 */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Not inside a git work tree: ${`${result.stderr ?? ''}`.trim()}`);
  }
  return `${result.stdout}`.trim();
}

/**
 * @param {string} binary
 * @returns {number} Process exit code.
 */
function scanStaged(binary) {
  const scan = spawnSync(
    binary,
    [
      'git',
      '--staged',
      // Findings are printed with the secret redacted. An unredacted finding
      // would copy the credential into terminal scrollback and CI logs — the
      // very exposure the scan exists to prevent (invariant L12).
      '--redact',
      '--no-banner',
      '--exit-code',
      '1',
    ],
    { cwd: repoRoot(), stdio: 'inherit' },
  );

  if (scan.error !== undefined) {
    process.stderr.write(`\nCould not run gitleaks (${binary}): ${scan.error.message}\n`);
    return 1;
  }
  return scan.status ?? 1;
}

async function main() {
  const failures = guardFiles('staged');
  if (failures.length > 0) {
    process.stderr.write(formatFailures(failures, 'staged'));
    return 1;
  }

  // Only when the commit touches dependency resolution — it costs a few
  // seconds, and nothing else can break the lockfile.
  if (touchesDependencies()) {
    const lockfile = checkLockfile();
    if (!lockfile.ok) {
      process.stderr.write(explain(lockfile.output));
      return 1;
    }
  }

  const binary = await resolveGitleaks();
  if (binary === null) {
    process.stderr.write(
      `\nCommit blocked — the secret scanner is not installed, so nothing was scanned.\n\n` +
        `  Run:  node scripts/provision/gitleaks.mjs\n\n` +
        `That downloads gitleaks ${GITLEAKS_VERSION} against a pinned SHA-256 into .tools/ ` +
        `(gitignored — Part J forbids binaries in git).\n\n` +
        `This hook refuses to pass a commit it did not scan. Skipping the check when the ` +
        `scanner is missing would report success for a scan that never ran.\n\n`,
    );
    return 1;
  }

  const status = scanStaged(binary);
  if (status !== 0) {
    process.stderr.write(
      `\nCommit blocked — gitleaks found a secret in the staged changes (shown redacted above).\n\n` +
        `Remove it from the staged content. If it is a real credential, treat it as ` +
        `compromised and rotate it: assume anything that reaches a public repository is ` +
        `public the moment it is pushed.\n\n` +
        `If it is a genuine false positive, add a narrow rule to .gitleaks.toml in its own ` +
        `commit explaining why — never a blanket allowlist.\n\n`,
    );
  }
  return status;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(
      `\nCommit blocked — the pre-commit guard itself failed:\n` +
        `${error instanceof Error ? error.stack : String(error)}\n\n` +
        `A guard that errors is treated as a guard that found something. Fix the guard.\n\n`,
    );
    process.exit(1);
  },
);
