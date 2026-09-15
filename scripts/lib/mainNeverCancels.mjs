/**
 * No workflow may cost a commit on `main` its verdict — by cancelling its run, or by queueing it
 * where a later push replaces it.
 *
 * ## The mechanism, not the preference
 *
 * A cancelled run is **not a weaker green — it is no verdict at all**, and the
 * commit it belonged to carries none afterwards. Both workflows were grouped by
 * ref with `cancel-in-progress: true`, so every rapid push to `main` destroyed
 * the previous commit's verdict. Three occurrences of exactly that: `9292d1f`,
 * `142a2d6` and `53eafae`. A bisect then lands on commits CI never evaluated,
 * and "the range is green" degenerates into a fact about the tip.
 *
 * The rule was a handoff note first — *push, read the board, then push* — and it
 * failed three times, which is this repository's standing evidence that a rule
 * you must recall at the moment of acting is not a mechanism.
 *
 * ## AND A QUEUED RUN IS REPLACED, whatever `cancel-in-progress` says
 *
 * GitHub runs one run per concurrency group and queues one more. A third push to the same group
 * cancels the QUEUED run — `cancel-in-progress` governs the running one only. So `false` on
 * `main` kept a running verdict and still lost a waiting one, and this scan, which read
 * `cancel-in-progress` alone, reported the tree clean throughout.
 *
 * Measured 2026-09-15 from the runs API: CI run 35015212019 for `a3db070` was created at
 * 19:42:22Z behind a still-running `bc524eb` (run 35014333286, 19:33:26Z to 19:53:24Z), and was
 * cancelled at 19:47:44Z — three seconds after `e67988c` was pushed. Its commit has no CI verdict.
 *
 * So `main`'s group must be ONE PER COMMIT: nothing is ever queued behind a different commit's
 * run, and nothing can replace it. Branches keep grouping by ref, where superseding is the point.
 *
 * ## What this accepts, and the false positives it keeps ON PURPOSE
 *
 * A workflow passes when it has no `concurrency` block at all, or when both hold:
 *
 * - `cancel-in-progress` is absent, literally `false`, or an expression spelling
 *   `github.ref != 'refs/heads/main'`;
 * - `group` spells `github.ref == 'refs/heads/main' && github.sha || github.ref`.
 *
 * Anything else is reported, **including an expression this scan cannot read**.
 * That is deliberate and is not to be relaxed into "mentions refs/heads/main",
 * because `github.ref == 'refs/heads/main'` mentions it and is exactly backwards
 * — it would cancel on `main` and nowhere else — and a group spelling `!=` would
 * give every branch push its own group and share `main`'s. A check that cannot
 * decide must report rather than pass, and a disposition nobody wrote down is one
 * that gets relitigated by whoever it inconveniences.
 *
 * ## Scope
 *
 * Top-level `concurrency` only, recognised at column 0. A job-level block is
 * indented and is a different question — one job superseding itself does not
 * destroy a commit's verdict, because the run still reports.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { WORKFLOW_DIR } from './workflowPins.mjs';

/** The one expression that protects `main`'s running run. */
const PROTECTS_MAIN = /github\.ref\s*!=\s*'refs\/heads\/main'/u;

/** The one group spelling that gives every push to `main` a group of its own. */
const SEPARATES_MAIN = /github\.ref\s*==\s*'refs\/heads\/main'\s*&&\s*github\.sha\s*\|\|\s*github\.ref/u;

/**
 * The known-present anchor — a **violation**, because this scan's reassuring
 * answer is "found nothing" and a matcher that can no longer see one reports
 * a clean tree in the same words as a clean tree (item 4b).
 */
export const CONTROL_TEXT = ['concurrency:', "  group: x-${{ github.ref }}", '  cancel-in-progress: true'].join(
  '\n',
);

/**
 * The second anchor, and the defect found 2026-09-15: a group every push to `main` shares, with
 * a `cancel-in-progress` that protects the running run. It must be reported, or the scan is blind
 * to the queued-run replacement exactly as it was before.
 */
export const SHARED_GROUP_CONTROL = [
  'concurrency:',
  "  group: x-${{ github.ref }}",
  "  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
].join('\n');

/**
 * One top-level `concurrency` key's setting, or `null` where there is none.
 *
 * @param {string} text
 * @param {'cancel-in-progress' | 'group'} key
 * @returns {{ line: number, value: string } | null}
 */
function readConcurrencyKey(text, key) {
  const lines = text.split('\n');
  const pattern = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`, 'u');
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    if (raw.trimStart().startsWith('#')) continue;
    if (/^concurrency:\s*$/u.test(raw)) {
      inBlock = true;
      continue;
    }
    // A key at column 0 ends the block. Checked before the match below so a
    // setting belonging to a later top-level key cannot be read as this block's.
    if (inBlock && /^\S/u.test(raw)) inBlock = false;
    if (!inBlock) continue;
    const found = pattern.exec(raw);
    if (found?.[1] !== undefined) return { line: index + 1, value: found[1] };
  }
  return null;
}

/**
 * The top-level `cancel-in-progress` setting, or `null` where there is none.
 *
 * @param {string} text
 * @returns {{ line: number, value: string } | null}
 */
export function readCancelInProgress(text) {
  return readConcurrencyKey(text, 'cancel-in-progress');
}

/**
 * The top-level `concurrency.group` setting, or `null` where there is none.
 *
 * @param {string} text
 * @returns {{ line: number, value: string } | null}
 */
export function readGroup(text) {
  return readConcurrencyKey(text, 'group');
}

/** Whether a workflow text has a top-level `concurrency` block at all. */
function hasConcurrencyBlock(/** @type {string} */ text) {
  return text.split('\n').some((line) => /^concurrency:\s*$/u.test(line));
}

/**
 * @param {string} value the raw right-hand side.
 * @returns {boolean} whether `main`'s running run is protected from cancellation.
 */
export function protectsMain(value) {
  if (value === 'false') return true;
  return PROTECTS_MAIN.test(value);
}

/**
 * @param {string} value the raw right-hand side of `group`.
 * @returns {boolean} whether every push to `main` gets a group of its own.
 */
export function separatesMain(value) {
  return SEPARATES_MAIN.test(value);
}

/**
 * @typedef {{ file: string, line: number, value: string, kind: 'cancels' | 'shares' }} Violation
 */

/**
 * The violations one workflow text carries.
 *
 * @param {string} file
 * @param {string} text
 * @returns {Violation[]}
 */
export function violationsIn(file, text) {
  if (!hasConcurrencyBlock(text)) return [];
  /** @type {Violation[]} */
  const found = [];
  const cancel = readCancelInProgress(text);
  if (cancel !== null && !protectsMain(cancel.value)) {
    found.push({ file, line: cancel.line, value: cancel.value, kind: 'cancels' });
  }
  const group = readGroup(text);
  if (group === null || !separatesMain(group.value)) {
    // A BLOCK WITH NO READABLE GROUP IS REPORTED, for the undecidable case's reason.
    found.push({ file, line: group?.line ?? 0, value: group?.value ?? '(no group)', kind: 'shares' });
  }
  return found;
}

/**
 * @param {string} [root]
 * @returns {{ violations: Violation[], controlFound: boolean, filesScanned: number }}
 */
export function scanWorkflows(root = repoRoot()) {
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (files.length === 0) {
    throw new Error(
      `${WORKFLOW_DIR} holds no workflow files. An empty input set is a broken lookup, not a clean ` +
        `result — every way this scan can break reports the same "found nothing" a clean tree does.`,
    );
  }

  /** @type {Violation[]} */
  const violations = [];
  for (const name of files) {
    violations.push(...violationsIn(`${WORKFLOW_DIR}/${name}`, readFileSync(join(dir, name), 'utf8')));
  }

  // BOTH ANCHORS, one per kind: a scan that could see only a cancelling workflow is the scan that
  // passed a queued-run replacement for three weeks.
  const controlFound =
    violationsIn('control', CONTROL_TEXT).some((violation) => violation.kind === 'cancels') &&
    violationsIn('control', SHARED_GROUP_CONTROL).some((violation) => violation.kind === 'shares');
  return { violations, controlFound, filesScanned: files.length };
}

if (process.argv[1]?.endsWith('mainNeverCancels.mjs')) {
  const { violations, controlFound, filesScanned } = scanWorkflows();

  if (!controlFound) {
    process.stderr.write(
      `A positive control was not found, so this scan cannot see a cancelling workflow or a shared ` +
        `group, and its silence means nothing. Fix the matcher before trusting a clean result.\n`,
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `${String(violations.length)} workflow setting(s) can cost a commit on main its verdict:\n\n` +
        violations
          .map(({ file, line, value, kind }) =>
            kind === 'cancels'
              ? `  ${file}:${String(line)}  cancel-in-progress: ${value}`
              : `  ${file}:${String(line)}  group: ${value}  (shared by pushes to main)`,
          )
          .join('\n') +
        `\n\nA cancelled or replaced run is no verdict at all. Spell them:\n\n` +
        `  group: <name>-\${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}\n` +
        `  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `ok  ${String(filesScanned)} workflow(s) scanned; none cancels or queues away a run on main\n` +
      `ok  and the scan located both positive controls, so that result means something\n`,
  );
}
