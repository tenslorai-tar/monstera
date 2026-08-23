// @ts-check
/**
 * Every `proof:*` script must be invoked by some workflow (finding VVV-1).
 *
 * ## The gap this closes, and why the neighbouring checks cannot
 *
 * `proof:stagedsyntax` shipped with thirteen cases and no job ran it. It
 * existed, it passed locally, and CI had never executed it.
 *
 * Two checks look at this area and neither can see that:
 *
 *   - `annotateCoverage.mjs` asserts that script invocations **which appear in
 *     a workflow** are wrapped by `annotate.mjs`. A proof appearing in no
 *     workflow is outside what it examines.
 *   - `nodeModulesPlacement.mjs` asks whether a step needing `node_modules` sits
 *     in a job that installs. Also about steps that exist.
 *
 * Both are correct. Neither is looking at ABSENCE, and absence is the whole
 * defect: the wired-tools rule at the level of CI registration, where a proof
 * that runs nowhere is a green board that verified nothing.
 *
 * ## Matched on the PATH, never on the npm name
 *
 * The workflows invoke scripts by path — `node scripts/proofs/x.proof.mjs` —
 * not by `npm run proof:x`. The first version of this search matched the npm
 * NAME and reported sixteen proofs missing, including `proof:escapeguard`,
 * which plainly runs on Guards. Every one of the sixteen was wrong.
 *
 * That is the recognition rule `annotateCoverage.mjs` was rewritten around one
 * range earlier, and the same mistake nearly filed as a finding one range before
 * that. **A manifest's name for a thing is not the thing that runs.**
 *
 * ## Its own positive control
 *
 * This is a search, and its reassuring answer is "all covered". A wrong pattern,
 * an empty script set, the wrong workflow directory and a read that returned
 * nothing all produce it. So a proof known to be invoked must be located on
 * every run, and the check refuses to report when it cannot.
 *
 * ## What it does NOT claim
 *
 * That the proof runs on every platform, in a job that can provision what it
 * needs, or that its job is the right one. `check:jobplacement` answers the
 * second for the `node_modules` case. This answers exactly one question — is it
 * invoked anywhere — because that is the one nothing was asking.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './gitScope.mjs';

/** A proof known to be invoked by a workflow, used as the positive control. */
const CONTROL_PATH = 'scripts/proofs/composition.proof.mjs';

/** The first repository script path on a package.json command line. */
const SCRIPT_PATH = /scripts\/[\w./-]+\.mjs/u;

/**
 * @typedef {object} CoverageResult
 * @property {string[]} uninvoked `proof:*` names whose script no workflow names.
 * @property {number} examined How many proof scripts were considered.
 * @property {boolean} blind Whether the control could not be located.
 */

/**
 * @param {{ root?: string }} [options]
 * @returns {CoverageResult}
 */
export function scan(options = {}) {
  const root = options.root ?? repoRoot();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  const directory = join(root, '.github', 'workflows');
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/u.test(name));
  if (files.length === 0) {
    throw new Error(
      '.github/workflows holds no workflow files, so every proof would report as uninvoked. ' +
        'An empty input set is a broken lookup, not an answer.',
    );
  }
  const workflows = files.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n');

  /** @type {string[]} */
  const uninvoked = [];
  let examined = 0;
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (!name.startsWith('proof:')) continue;
    const path = SCRIPT_PATH.exec(String(command))?.[0];
    // A `proof:*` entry that names no repository script is not something this
    // can answer about, and counting it would make the total a different
    // number from the set actually checked.
    if (path === undefined) continue;
    examined += 1;
    if (!workflows.includes(path)) uninvoked.push(`${name}  ->  ${path}`);
  }

  return { uninvoked, examined, blind: !workflows.includes(CONTROL_PATH) };
}

/**
 * @param {CoverageResult} result
 * @returns {string}
 */
export function report(result) {
  if (result.blind) {
    return (
      `  BLIND — ${CONTROL_PATH} was not found in any workflow.\n` +
      '        That proof is known to be invoked, so failing to locate it means the manifest\n' +
      '        read, the workflow read or the match is broken — and "all covered" would be\n' +
      '        the reassuring answer from a search that saw nothing.\n'
    );
  }
  if (result.uninvoked.length === 0) {
    return (
      `  ok  ${String(result.examined)} proof script(s) are invoked by a workflow\n` +
      '  ok  and the control proof was located, so that result means something\n'
    );
  }
  return (
    result.uninvoked.map((entry) => `  FAIL  ${entry}\n`).join('') +
    `\n${String(result.uninvoked.length)} proof(s) run in NO job. A proof CI never executes is\n` +
    `a green board that verified nothing — the wired-tools rule at the level of registration.\n`
  );
}

// `pathToFileURL`, not a hand-built `file://` string — the idiom
// `emittedTemplates.mjs` already uses, and B3a's reason for taking it. The
// hand-built version was written here first and produced `file://C:/…` where
// Node produces `file:///C:/…`, so the guard never fired: no output, exit 0,
// which is this check's own reassuring answer arriving from its main guard.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scan();
  process.stdout.write(report(result));
  process.exitCode = result.blind || result.uninvoked.length > 0 ? 1 : 0;
}
