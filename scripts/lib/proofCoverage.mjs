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

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** A proof known to be invoked by a workflow, used as the positive control. */
const CONTROL_PATH = 'scripts/proofs/composition.proof.mjs';

/** Every repository script path on a package.json command line. */
const SCRIPT_PATHS = /scripts\/[\w./-]+\.mjs/gu;

/**
 * Every `proof:*` script this repository declares, and the file it runs.
 *
 * The one answer to "what are the proofs" (rule B3a). `package.json` is the
 * authority: a proof is a script whose name starts `proof:`, and its path is the
 * first repository script on its command line. Two callers now ask — this file,
 * which asks whether a workflow invokes each one, and `affectedProofs.mjs`,
 * which asks which of them read a file you just changed. A second parse would be
 * a second opinion about which entries count, and this project has paid three
 * times for exactly that.
 *
 * A `proof:*` entry naming no repository script is skipped rather than counted,
 * because it is not something either caller can answer about and including it
 * would make the total a different number from the set actually examined.
 *
 * **EVERY script on the command line, not the first.** `proof:guards` runs four
 * chained scripts, and taking only the head left `preCommit.proof.mjs` in no
 * proof's path set at all — so a change to it, or to anything only it reads,
 * reported "no proof affected". Measured against the exact change that reddened
 * `main` at `3a903fd`: with the head-only version the instrument named three
 * proofs and not `proof:guards`, which is the one that had failed. A resolution
 * test before it measured anything is what caught that; the report reads
 * identically either way.
 *
 * @param {string} [root]
 * @returns {readonly { name: string, paths: string[] }[]}
 */
export function proofScripts(root = repoRoot()) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  /** @type {{ name: string, paths: string[] }[]} */
  const found = [];
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (!name.startsWith('proof:')) continue;
    const paths = [...new Set(String(command).match(SCRIPT_PATHS) ?? [])];
    if (paths.length === 0) continue;
    found.push({ name, paths });
  }
  if (found.length === 0) {
    throw new Error(
      'package.json declares no proof:* script that names a repository file. An empty roster is ' +
        'a broken parse, not an answer — every caller of this would report nothing to do.',
    );
  }
  return found;
}

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
  const proofs = proofScripts(root);
  for (const { name, paths } of proofs) {
    // EVERY chained script must be invoked, not just the first. A compound
    // `proof:*` whose head runs in CI and whose tail does not is a proof
    // registered into no job wearing the head's green check — which is the
    // defect this file exists for, one level in.
    const missing = paths.filter((path) => !workflows.includes(path));
    for (const path of missing) uninvoked.push(`${name}  ->  ${path}`);
  }

  return { uninvoked, examined: proofs.length, blind: !workflows.includes(CONTROL_PATH) };
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

// THE SECOND OF THREE. The hand-built version was written here first and
// produced `file://C:/…` where Node produces `file:///C:/…`, so the guard never
// fired: no output, exit 0, this check's own reassuring answer arriving from its
// main guard. `emittedTemplates.mjs` had already paid for it and its comment was
// on the page; copying the CORRECT expression is still re-deriving the rule, and
// a third entry point got it wrong afterwards. `isMain` is the named thing
// (AAAA-5).
if (isMain(import.meta.url)) {
  const result = scan();
  process.stdout.write(report(result));
  process.exitCode = result.blind || result.uninvoked.length > 0 ? 1 : 0;
}
