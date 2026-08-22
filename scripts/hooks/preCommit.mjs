// @ts-check
/**
 * The pre-commit gate. Three checks, all blocking:
 *
 *   1. Staged content policy (guardFiles.mjs).
 *   2. Emitted-source templates carry no backtick (emittedTemplates.mjs, WW-4).
 *   3. Secret scan of the staged diff (gitleaks).
 *
 * Both fail *closed*. If gitleaks cannot be found, the commit is rejected with
 * instructions rather than allowed through with a warning: a scanner that
 * silently skips itself when absent reports success for a scan that never ran,
 * which is precisely the green-check-that-verifies-nothing this project bans.
 * A rejected commit costs one command; a leaked credential in a public
 * repository's permanent history cannot be undone at any price.
 */

import { explainAuditBudget, pendingAuditScope } from '../lib/auditWatermark.mjs';
import { scan as scanEmittedTemplates } from '../lib/emittedTemplates.mjs';
import { formatDisarmament, hookDisarmament } from '../lib/hookIntegrity.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  divergenceNotice,
  formatCanaryFailure,
  verifyScannerCapability,
} from '../lib/scannerCanary.mjs';
import { formatSuppressions, runSecretScan } from '../lib/secretScan.mjs';
import { GITLEAKS_VERSION, resolveGitleaks } from '../provision/gitleaks.mjs';
import {
  explainContractDrift,
  runContractProof,
  touchesContractTypes,
} from './contractDrift.mjs';
import { formatFailures, guardFiles } from './guardFiles.mjs';
import { checkLockfile, explain, touchesDependencies } from './lockfileIntegrity.mjs';

async function main() {
  // Before anything else: is the tool-use guard actually in force? A settings
  // file at a higher-precedence scope can carry `disableAllHooks` or a competing
  // `hooks` block, and neither appears in any diff. Checked HERE rather than in
  // the Claude Code hook because a hook cannot detect its own absence.
  const disarmed = hookDisarmament();
  if (disarmed.length > 0) {
    process.stderr.write(formatDisarmament(disarmed));
    return 1;
  }

  const failures = guardFiles('staged');
  if (failures.length > 0) {
    process.stderr.write(formatFailures(failures, 'staged'));
    return 1;
  }

  // WW-4. This scan lived only on the Guards job, and that is the wrong place
  // for it by the escape guard's own argument: a backtick in an emitted template
  // is composed at authoring time, and a check that runs at review time catches
  // it after the commit is public — which B10 makes permanent.
  //
  // Not a lament about occurrence four, which was mine, one commit after I
  // shipped the check, as its author. That is the ARGUMENT: what stopped it was
  // a hand-run `node --check`, which is me remembering, and remembering is the
  // thing a mechanism replaces. The escape guard is the precedent and it is
  // exact — the rule was written down for seven occurrences before a hook made
  // the path unavailable rather than forbidden.
  //
  // Scanned against the INDEX. Reading the working tree would pass a commit
  // whose staged content is broken.
  const templates = scanEmittedTemplates({ source: 'staged' });
  if (templates !== 0) {
    process.stderr.write(
      `\nCommit blocked — an emitted-source template carries a backtick (reported above).\n\n` +
        `A backtick pair inside a String.raw that holds a program we write to disk CLOSES the\n` +
        `literal and reopens it, so the parser blames whatever follows and names a line that is\n` +
        `fine. Four occurrences, the third in a file whose own header carried the rule and the\n` +
        `fourth one commit after this scan shipped.\n\n` +
        `Concatenate with + instead, or move the prose out of the emitted body.\n\n`,
    );
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

  // Only when the commit can change what the contract proof compiles against.
  // It costs about fifty seconds, and it is the only check here that a running
  // `typecheck` cannot substitute for — the proof's fixtures are strings. See
  // contractDrift.mjs for the two occurrences that made this a mechanism rather
  // than a rule.
  if (touchesContractTypes()) {
    const proof = runContractProof();
    if (!proof.ok) {
      process.stderr.write(explainContractDrift(proof.output));
      return 1;
    }
  }

  // The audit budget, counted WITH the commit being made. `check:docs` measures
  // watermark..HEAD, where HEAD is the parent at this moment, so the commit that
  // crosses one batch is invisible to it and the board goes red a push later.
  // Blocking here is the same move the contract-drift gate makes: a red board
  // nobody reads becomes a commit that does not happen.
  const budget = pendingAuditScope();
  if (!budget.recordsAudit && budget.overBudget.length > 0) {
    process.stderr.write(explainAuditBudget(budget));
    return 1;
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

  // The binary exists and runs. That is not the same as it being able to find a
  // secret — see scripts/lib/scannerCanary.mjs. Cached against the binary's own
  // hash, so this is a file read on all but the first commit after a scanner
  // changes.
  const canary = verifyScannerCapability({ binary, pinnedVersion: GITLEAKS_VERSION });
  if (!canary.ok) {
    process.stderr.write(formatCanaryFailure(canary, GITLEAKS_VERSION));
    return 1;
  }
  process.stderr.write(divergenceNotice(canary, GITLEAKS_VERSION));

  const scan = runSecretScan({ binary, staged: true });
  if (scan.blocked.length > 0) {
    process.stderr.write(formatSuppressions(scan.blocked));
    return 1;
  }

  const status = scan.status;
  if (status !== 0) {
    process.stderr.write(
      `\nCommit blocked — gitleaks found a secret in the staged changes (shown redacted above).\n\n` +
        `Remove it from the staged content. If it is a real credential, treat it as ` +
        `compromised and rotate it: assume anything that reaches a public repository is ` +
        `public the moment it is pushed.\n\n` +
        `If it is a genuine false positive, add a narrow [allowlist] entry to .gitleaks.toml ` +
        `in its own commit, naming the finding and why it is not a secret. That is the only ` +
        `suppression route left open: inline gitleaks:allow comments and .gitleaksignore files ` +
        `are both closed, because neither ever appears in a diff.\n\n`,
    );
  }
  return status;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(
      `\nCommit blocked — the pre-commit guard itself failed:\n` +
        `${formatError(error)}\n\n` +
        `A guard that errors is treated as a guard that found something. Fix the guard.\n\n`,
    );
    process.exit(1);
  },
);
