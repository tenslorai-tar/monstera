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

/**
 * The modified-proofs column, with **both** churn figures (audit finding U-2).
 *
 * The net range diff was all this printed, and that made the column a tree-wide
 * sweep at smaller scale: a line added in one commit and rewritten in a later
 * one nets to an insertion, so the deletion never appeared. The instrument that
 * exists to make a loosened check visible was itself presenting a clean end
 * state — the exact reasoning that moved this project from tree-wide audits to
 * ranges, one level down.
 *
 * Printing both is the whole fix. When they differ, the range diff is not the
 * thing to read: `git log -p <range> -- <path>` is, because the intermediate
 * states are where a loosening lived.
 *
 * **The rendering is asserted, not only the data behind it** (finding V-2).
 * `proof:auditscope` spawns this script against a fixture repository and matches
 * the hidden-deletions line, because deleting that line passed every case while
 * it only checked `auditScope`'s return value — and this line is the whole of
 * U-2's value. Two figures with nothing joining them are a subtraction the
 * reader has to do.
 *
 * Shared by both churn columns rather than copied into the second one. They
 * print the same three figures and carry the same U-2 disclosure, and two
 * renderers would be two opinions about what a rewrite inside the range looks
 * like (B3a).
 *
 * @param {string} title
 * @param {import('../lib/auditWatermark.mjs').ProofChurn[]} entries
 * @returns {string}
 */
function churnSection(title, entries) {
  if (entries.length === 0) return `  ${title}: none\n`;

  return (
    `  ${title} (${entries.length}):\n` +
    entries
      .map((entry) => {
        const net = `+${entry.net.added} -${entry.net.removed}`;
        const walked = `+${entry.perCommit.added} -${entry.perCommit.removed}`;
        const hidden = entry.perCommit.removed - entry.net.removed;
        return (
          `    ${entry.path}\n` +
          `      net ${net}   per-commit ${walked}\n` +
          (hidden > 0
            ? `      ${hidden} deletion(s) DO NOT APPEAR in the range diff — a line added and then\n` +
              `      rewritten inside this range nets to an insertion. Read: git log -p ` +
              `${scope.watermark}..HEAD -- ${entry.path}\n`
            : '')
        );
      })
      .join('')
  );
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
    churnSection(
      'proofs MODIFIED — read each diff; a loosened check looks like a corrected one',
      scope.proofChurn,
    ) +
    // Coverage LEAVING. The classifier recognised A and M only, so a deleted
    // proof appeared in no column and read as an ordinary line in the file
    // count — the limit case of the modified column's own argument.
    section('proofs REMOVED — coverage leaving; say why in the entry', scope.proofsRemoved) +
    section('source FILES ADDED — instruments to resolution-test (items 4a, 4b)', scope.newScripts) +
    churnSection(
      'source FILES CHANGED — an instrument whose behaviour moved (items 4a, 4b)',
      scope.changedScripts,
    ) +
    // DDD-1. An instrument LEAVING, which is coverage leaving exactly as a
    // deleted proof is — and this column did not exist until a 636-line
    // research instrument was deleted and appeared in none of the others.
    section(
      'source FILES REMOVED — an instrument leaving; say why in the entry',
      scope.removedScripts,
    ) +
    `    ^ WW-2 added the CHANGED column, and ADDED alone was the same "new files\n` +
    `      only" filter that hid four converted instruments in one range. DDD-1\n` +
    `      added REMOVED, because these three states existed on the proofs side\n` +
    `      and only two existed here — and a 636-line instrument was deleted into\n` +
    `      that gap. WHEN ONE HALF OF A CLASSIFIER CARRIES THREE STATES AND THE\n` +
    `      OTHER CARRIES TWO, THE ASYMMETRY IS THE FINDING: nobody audits for a\n` +
    `      column that does not exist, and an absent one reports nothing in\n` +
    `      exactly the voice of an empty one.\n` +
    `      THE FIGURES ARE NET, AND THIS IS A TWO-POINT COMPARISON RATHER THAN A\n` +
    `      HISTORY (AAAA-4). A file CORRECTED mid-range shows only the difference\n` +
    `      between the endpoints, so the correction itself is invisible — and the\n` +
    `      file where someone corrected themselves is exactly the file worth\n` +
    `      reading. Measured: win32HostSurface.ts reported +79/-2 while hiding four\n` +
    `      deletions that were a comment being rewritten one commit after it was\n` +
    `      written. Use git log -p over the range on any file here you are relying\n` +
    `      on these numbers to characterise.\n` +
    `      These columns list ordinary modules beside instruments; sort by churn\n` +
    `      and read the ones that could answer a question wrongly.\n` +
    `      Five axes of this classifier have now been DEFECTS and been fixed:\n` +
    `      pattern (W-1), root (X-1), state (Z-1), added-vs-changed (WW-2),\n` +
    `      changed-vs-removed (DDD-1).\n` +
    `\n` +
    `      WHAT REMAINS A STATED LIMIT is GRANULARITY, and it is narrower than\n` +
    `      AA-1's ruling claimed: an instrument arriving as a FUNCTION INSIDE a\n` +
    `      file listed above is not called out by name. The compensation is that\n` +
    `      the file it lives in is now named in one of these two columns whatever\n` +
    `      state it arrived in, which is what AA-1's ruling assumed and did not\n` +
    `      have. Read the diffs of the files above.\n` +
    `      IT BECOMES A DEFECT the first time an instrument is found LATE that\n` +
    `      reading those diffs did not surface. Catching one by running it is\n` +
    `      diligence and does not count as the limit holding — that reading is\n` +
    `      what kept WW-2 closed for a range longer than it should have been.\n` +
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
