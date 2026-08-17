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

import {
  divergenceNotice,
  formatCanaryFailure,
  verifyScannerCapability,
} from '../lib/scannerCanary.mjs';
import { formatSuppressions, runSecretScan } from '../lib/secretScan.mjs';
import { GITLEAKS_VERSION, provisionGitleaks } from '../provision/gitleaks.mjs';

async function main() {
  const binary = await provisionGitleaks();

  // Capability before use, here as well as in the hook. CI provisions the pinned
  // build, so this normally passes from cache — but "normally" is exactly the
  // assumption that makes a check worth keeping: this job is the only thing
  // standing between a credential that arrived by some route the hook never saw
  // and a permanent public history.
  const canary = verifyScannerCapability({ binary, pinnedVersion: GITLEAKS_VERSION });
  if (!canary.ok) {
    process.stderr.write(formatCanaryFailure(canary, GITLEAKS_VERSION));
    return 1;
  }
  process.stderr.write(divergenceNotice(canary, GITLEAKS_VERSION));

  // The whole history, not the working tree: a blob committed and later deleted
  // is retained by GitHub forever, which is the case B10 exists for.
  const scan = runSecretScan({ binary, staged: false });
  if (scan.blocked.length > 0) {
    process.stderr.write(formatSuppressions(scan.blocked));
    return 1;
  }
  return scan.status;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
