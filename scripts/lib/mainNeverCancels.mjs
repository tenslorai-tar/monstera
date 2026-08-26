/**
 * No workflow may cancel an in-progress run on `main`.
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
 * ## What this accepts, and the false positive it keeps ON PURPOSE
 *
 * A workflow passes when it has no `concurrency` block at all, when
 * `cancel-in-progress` is literally `false`, or when it is an expression
 * spelling `github.ref != 'refs/heads/main'`.
 *
 * Anything else is reported, **including an expression this scan cannot read**.
 * That is deliberate and is not to be relaxed into "mentions refs/heads/main",
 * because `github.ref == 'refs/heads/main'` mentions it and is exactly backwards
 * — it would cancel on `main` and nowhere else. A check that cannot decide must
 * report rather than pass, and a disposition nobody wrote down is one that gets
 * relitigated by whoever it inconveniences.
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

/** The one expression that protects `main`. */
const PROTECTS_MAIN = /github\.ref\s*!=\s*'refs\/heads\/main'/u;

/**
 * The known-present anchor — a **violation**, because this scan's reassuring
 * answer is "found nothing" and a matcher that can no longer see one reports
 * a clean tree in the same words as a clean tree (item 4b).
 */
export const CONTROL_TEXT = ['concurrency:', "  group: x-${{ github.ref }}", '  cancel-in-progress: true'].join(
  '\n',
);

/**
 * The top-level `cancel-in-progress` setting, or `null` where there is none.
 *
 * @param {string} text
 * @returns {{ line: number, value: string } | null}
 */
export function readCancelInProgress(text) {
  const lines = text.split('\n');
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    if (raw.trimStart().startsWith('#')) continue;
    if (/^concurrency:\s*$/u.test(raw)) {
      inBlock = true;
      continue;
    }
    // A key at column 0 ends the block. Checked before the match below so a
    // `cancel-in-progress` belonging to a later top-level key cannot be read as
    // this block's.
    if (inBlock && /^\S/u.test(raw)) inBlock = false;
    if (!inBlock) continue;
    const found = /^\s+cancel-in-progress:\s*(.+?)\s*$/u.exec(raw);
    if (found?.[1] !== undefined) return { line: index + 1, value: found[1] };
  }
  return null;
}

/**
 * @param {string} value the raw right-hand side.
 * @returns {boolean} whether `main` is protected from cancellation.
 */
export function protectsMain(value) {
  if (value === 'false') return true;
  return PROTECTS_MAIN.test(value);
}

/**
 * @param {string} [root]
 * @returns {{ violations: Array<{ file: string, line: number, value: string }>, controlFound: boolean, filesScanned: number }}
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

  /** @type {Array<{ file: string, line: number, value: string }>} */
  const violations = [];
  for (const name of files) {
    const setting = readCancelInProgress(readFileSync(join(dir, name), 'utf8'));
    if (setting === null) continue;
    if (protectsMain(setting.value)) continue;
    violations.push({ file: `${WORKFLOW_DIR}/${name}`, line: setting.line, value: setting.value });
  }

  const control = readCancelInProgress(CONTROL_TEXT);
  const controlFound = control !== null && !protectsMain(control.value);
  return { violations, controlFound, filesScanned: files.length };
}

if (process.argv[1]?.endsWith('mainNeverCancels.mjs')) {
  const { violations, controlFound, filesScanned } = scanWorkflows();

  if (!controlFound) {
    process.stderr.write(
      `The positive control was not found, so this scan cannot see a cancelling workflow and its ` +
        `silence means nothing. Fix the matcher before trusting a clean result.\n`,
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `${String(violations.length)} workflow(s) may cancel an in-progress run on main:\n\n` +
        violations
          .map(({ file, line, value }) => `  ${file}:${String(line)}  cancel-in-progress: ${value}`)
          .join('\n') +
        `\n\nA cancelled run is no verdict at all, so this destroys the previous commit's board\n` +
        `reading on every rapid push. Spell it:\n\n` +
        `  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `ok  ${String(filesScanned)} workflow(s) scanned; none cancels an in-progress run on main\n` +
      `ok  and the scan located its positive control, so that result means something\n`,
  );
}
