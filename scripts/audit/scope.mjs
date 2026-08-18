// @ts-check
/**
 * Reports the range a stage audit is owed for, so the checklist is applied to
 * WHAT CHANGED rather than to the whole tree.
 *
 * ## Why the shape changed
 *
 * The stage audit was periodic: run it at the end of a stage, against the tree.
 * That was right for the 43-finding audit, which caught things that had sat for
 * weeks. It is the wrong shape for what this project's own record now says
 * produces most defects — they arrive **inside the proofs and instruments
 * written an hour earlier to close the previous defect**:
 *
 *   - the separator gap that gave the escape guard its only false negative, in
 *     the fragment added to make the guard separator-aware;
 *   - the crash the history-reach fix introduced in `documentConsistency`;
 *   - the `UNDER REVIEW` verdict that printed in no output at all, created by
 *     the marking that was supposed to keep it visible;
 *   - two wrong entries in a licence notice, in the generator built to stop
 *     licence claims being hand-maintained.
 *
 * A tree-wide audit run weeks later finds those only by luck. A range-scoped one
 * run per batch reads exactly the diff that introduced them.
 *
 * ## The load-bearing column
 *
 * **Proofs modified**, reported apart from proofs added. A new proof is coverage
 * arriving. A modified one is a check whose meaning changed — and a fix that
 * quietly loosened a check looks identical to one that corrected it. Nothing but
 * the diff distinguishes them, so the report names each modified proof and the
 * auditor reads it.
 *
 * ## Applying the checklist
 *
 * Run `CLAUDE.md`'s stage-audit items against this range rather than the tree.
 * Items 4, 4a and 4b pay most here: fix-induced defects live in the proofs and
 * instruments, so "is this proof non-vacuous", "can this instrument tell two
 * values apart" and "does this search find something known-present" are asked
 * about code written in the very range being audited.
 *
 * Usage:
 *   node scripts/audit/scope.mjs             report the range
 *   node scripts/audit/scope.mjs --record    advance the watermark to HEAD
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { auditScope, BATCH } from '../lib/auditWatermark.mjs';
import { git, repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
const WATERMARK = join(ROOT, 'docs', 'audit-watermark.json');

/** @param {string} title @param {readonly string[]} entries */
function section(title, entries) {
  if (entries.length === 0) return `  ${title}: none\n`;
  return `  ${title} (${entries.length}):\n${entries.map((entry) => `    ${entry}\n`).join('')}`;
}

const scope = auditScope({ root: ROOT });

if (process.argv.includes('--record')) {
  const head = `${git(['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).stdout}`.trim();
  const current = JSON.parse(readFileSync(WATERMARK, 'utf8'));
  writeFileSync(WATERMARK, `${JSON.stringify({ ...current, commit: head }, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `Watermark advanced to ${head}.\n\n` +
      `This is only half of it. check:docs requires ${head} to appear in docs/JOURNAL.md, so the\n` +
      `findings must land in the SAME commit as this file — an audit that advances the watermark\n` +
      `without a record is exactly the claim this mechanism exists to refuse.\n\n` +
      `Add a line the check can find, for example:\n\n` +
      `  Audited through ${head}.\n\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `Unaudited range: ${scope.watermark}..HEAD\n\n` +
    `  commits: ${scope.commits} (one batch is ${BATCH.commits})\n` +
    `  files:   ${scope.files.length} (one batch is ${BATCH.files})\n\n` +
    section('proofs ADDED — new coverage', scope.proofsAdded) +
    section('proofs MODIFIED — read each diff; a loosened check looks like a corrected one', scope.proofsModified) +
    section('new scripts — instruments to resolution-test (items 4a, 4b)', scope.newScripts) +
    `\n`,
);

if (scope.commits === 0) {
  process.stdout.write('  Nothing to audit.\n');
} else if (scope.overBudget.length > 0) {
  process.stdout.write(
    `  OVER ONE BATCH: ${scope.overBudget.join('; ')}\n` +
      `  Audit now. The threshold is the median of batches 4-7 rather than the maximum, because\n` +
      `  the maximum was batch 7 — the one stretch everyone agrees was too large to audit as a\n` +
      `  unit, and the reason this gate exists.\n`,
  );
} else {
  process.stdout.write('  Within one batch. An audit is not yet owed.\n');
}

process.stdout.write(
  `\nApply CLAUDE.md's stage audit to THIS RANGE, not to the tree. Items 4, 4a and 4b pay most:\n` +
    `fix-induced defects arrive inside the proofs and instruments written to close the previous\n` +
    `defect, and all four of this project's are of exactly that kind.\n`,
);
