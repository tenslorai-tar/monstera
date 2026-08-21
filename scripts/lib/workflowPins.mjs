// @ts-check
/**
 * No workflow step may name a path inside the provisioned Electron tree.
 *
 * ## The dangerous token is the PATH, not the version
 *
 * `.tools/electron/43.4.1/electron.exe` embeds the pin in a file nothing checks
 * against `ELECTRON_VERSION`. When the pin moves, the workflow keeps naming a
 * directory that no longer exists — and the failure arrives as a missing file on
 * a runner rather than as a disagreement anybody can see in a diff. A bare
 * version literal elsewhere is untidy; a versioned *path* is a second opinion
 * about where the runtime lives (B3a), and `scripts/provision/electron.mjs` owns
 * that question through `electronBinaryPath()`.
 *
 * `.tools/electron-archives` is deliberately NOT a violation: it carries no
 * version, it is the cache path both jobs share, and conflating the two would
 * make this check reject the correct spelling along with the wrong one.
 *
 * ## The comment heuristic, and the direction it errs in
 *
 * Lines whose first non-whitespace character is `#` are dropped. That is not a
 * YAML parse and it is not meant to be — a parser is heavier than this property
 * needs. **Its false negative is a `#` that opens a content line inside a block
 * scalar**, where the text is data rather than a comment: such a line is skipped
 * and a violation inside it would go unreported.
 *
 * That errs toward **silence**, which is the more dangerous direction for a
 * check whose reassuring answer is "found nothing" — so the scan carries a
 * positive control rather than relying on the heuristic being right. Two real
 * comment occurrences exist today (`ci.yml`, the `chrome-sandbox` explanation),
 * and they are the reason the heuristic exists at all: a check that flagged them
 * is a check somebody turns off.
 *
 * Recorded as finding GG-8 and built on its convert-on-touch trigger — the first
 * commit to add or edit a workflow step touching the Electron tree.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Repo-relative directory holding the workflows this scans. */
export const WORKFLOW_DIR = '.github/workflows';

/**
 * A path inside the provisioned tree. The separator after `electron` is what
 * distinguishes it from `electron-archives`, which is a sibling and is fine.
 */
const VERSIONED_TREE = /\.tools[/\\]electron[/\\]/u;

/**
 * The known-present anchor. A search whose only output for every way it can
 * break is "found nothing" is worthless without one, and this check's silence is
 * the answer it is hoping for.
 */
export const CONTROL_LINE = '        run: ./.tools/electron/0.0.0/electron.exe --version';

/**
 * @param {string} text
 * @returns {Array<{ line: number, text: string }>}
 */
export function findProvisionedTreePaths(text) {
  /** @type {Array<{ line: number, text: string }>} */
  const found = [];
  text.split('\n').forEach((raw, index) => {
    if (raw.trimStart().startsWith('#')) return;
    if (VERSIONED_TREE.test(raw)) found.push({ line: index + 1, text: raw.trim() });
  });
  return found;
}

/**
 * Every workflow scanned, with the control appended to one of them.
 *
 * **The control travels with the scan, not only with the proof.** The proof runs
 * in CI; this function gets called by whoever needs an answer on the day, and a
 * search that cannot demonstrate it can find anything is worthless in exactly
 * that moment (item 4b).
 *
 * @param {string} [root]
 * @returns {{ violations: Array<{ file: string, line: number, text: string }>, controlFound: boolean, filesScanned: number }}
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

  /** @type {Array<{ file: string, line: number, text: string }>} */
  const violations = [];
  for (const name of files) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const hit of findProvisionedTreePaths(text)) {
      violations.push({ file: `${WORKFLOW_DIR}/${name}`, line: hit.line, text: hit.text });
    }
  }

  const controlFound = findProvisionedTreePaths(CONTROL_LINE).length === 1;
  return { violations, controlFound, filesScanned: files.length };
}

if (process.argv[1]?.endsWith('workflowPins.mjs')) {
  const { violations, controlFound, filesScanned } = scanWorkflows();

  if (!controlFound) {
    process.stderr.write(
      `The positive control was not found, so this scan cannot see anything and its silence means ` +
        `nothing. Fix the matcher before trusting a clean result.\n`,
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `${String(violations.length)} workflow line(s) name a path inside the provisioned Electron ` +
        `tree:\n\n` +
        violations.map((v) => `  ${v.file}:${String(v.line)}\n    ${v.text}`).join('\n\n') +
        `\n\nThe path embeds the pin, and nothing checks it against ELECTRON_VERSION — when the pin ` +
        `moves this names a directory that no longer exists, and the failure arrives as a missing ` +
        `file on a runner. Go through \`npm run provision:electron\` and \`electronBinaryPath()\`, ` +
        `which own where the runtime lives.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `  ok  ${String(filesScanned)} workflow file(s) name no path inside the provisioned Electron tree\n` +
      `  ok  and the scan located its positive control, so that result means something\n`,
  );
}
