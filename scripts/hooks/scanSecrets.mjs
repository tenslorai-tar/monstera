// @ts-check
/**
 * Full-history secret scan — the CI mirror of the pre-commit hook.
 *
 * The hook can only protect commits made through it. History reaches a public
 * repository by other routes too: the GitHub web editor, a merge, a
 * contributor who never ran `npm install`. Scanning the whole log in CI is
 * what makes the guarantee hold for the repository rather than for one
 * developer's machine.
 *
 * Usage: node scripts/hooks/scanSecrets.mjs
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { provisionGitleaks } from '../provision/gitleaks.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main() {
  const binary = await provisionGitleaks();

  const scan = spawnSync(
    binary,
    [
      'git',
      // Findings are printed with the secret redacted, so a CI log never
      // becomes a second copy of the credential it just caught (L12).
      '--redact',
      '--no-banner',
      '--exit-code',
      '1',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );

  if (scan.error !== undefined) {
    process.stderr.write(`Could not run gitleaks: ${scan.error.message}\n`);
    return 1;
  }
  return scan.status ?? 1;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
