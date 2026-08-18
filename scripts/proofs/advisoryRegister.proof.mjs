// @ts-check
/**
 * Proof that the advisory register cannot be silently disarmed (rule B2).
 *
 * ## What was wrong
 *
 * `readBaseline()` wrapped the parse in a bare `catch` and returned an empty
 * baseline. `docs/security/engine-advisories.json` is tracked, so it exists in
 * every checkout — that `catch` had no bootstrapping case, and the only states
 * it could actually reach were **missing** and **unparseable**. It converted
 * both into a clean pass. A trailing comma from a hand-edit disarmed the entire
 * reachability mechanism and printed the identical output to every verdict
 * holding.
 *
 * That is audit item 4b's corollary word for word: **an empty intermediate
 * result is a broken parse, not a clean input.**
 *
 * ## What the second half is
 *
 * Every reachability verdict is a SEARCH, and a search reports "no references"
 * for every way it can be broken: a glob matching no files, a symbol misspelt
 * in the register, `git grep` run from the wrong root. In this file "found
 * nothing" is always the answer someone hoped for, so nothing about it prompts
 * a second look.
 *
 * A count of verdicts checked is necessary and NOT sufficient — a resolver that
 * reads no files at all still produces a count. So the register declares a
 * control symbol per path glob, each known to be present, and the walk must
 * find every one of them on every run before any verdict it reports is
 * believed.
 *
 * ## Why this never edits the tracked register
 *
 * The checker takes `--baseline <path>`. Mutating the real register and
 * restoring it afterwards would leave a corrupt security register behind on any
 * crash between the two steps — the cure being worse than what it proves.
 *
 * Usage: node scripts/proofs/advisoryRegister.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
const CHECKER = join(ROOT, 'scripts', 'security', 'engineAdvisories.mjs');
const TRACKED = join(ROOT, 'docs', 'security', 'engine-advisories.json');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-advisory-'));
const pristine = readFileSync(TRACKED, 'utf8');

/**
 * Runs the real checker against a register written from `text`.
 *
 * @param {string} name
 * @param {string} text
 * @returns {{ ok: boolean, output: string }}
 */
function runAgainst(name, text) {
  const path = join(scratch, `${name}.json`);
  writeFileSync(path, text, 'utf8');
  const result = spawnSync(process.execPath, [CHECKER, '--baseline', path], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Runs the checker against a register absent from disk. */
function runAgainstMissing() {
  const result = spawnSync(process.execPath, [CHECKER, '--baseline', join(scratch, 'gone.json')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** @param {string} text @returns {unknown} */
function parsed(text) {
  return JSON.parse(text);
}

try {
  // -------------------------------------------------------------------------
  // THE CONTROL. Without this every case below is satisfied by a checker that
  // fails unconditionally, which is the same green-check-verifies-nothing
  // failure in the other direction.
  // -------------------------------------------------------------------------
  const control = runAgainst('pristine', pristine);
  check(
    'CONTROL: the register as tracked passes',
    control.ok,
    `The unmodified register must pass, or the failures below prove nothing.\n${control.output}`,
  );
  check(
    'CONTROL: and it reports that the walk found its controls',
    /reachability walk: \d+ control\(s\) found/.test(control.output),
    'The walk must SAY it found its controls. A count nobody prints is a count ' +
      `nobody can notice going to zero.\n${control.output}`,
  );

  // -------------------------------------------------------------------------
  // A register that cannot be read is not a register with nothing in it.
  //
  // EACH OF THESE ASSERTS THE REASON, NOT ONLY THE FAILURE, and that is the
  // load-bearing part. Restoring the old bare `catch` and running these, every
  // one still went red — because an unreadable register also yields an empty
  // `reviewed` map, so all 74 advisories read as untriaged and the check failed
  // on THAT. An accidental control, and a conditional one: it holds only while
  // the advisory feed returns entries. The feed has already changed name once
  // under this project (OSV carries these under `Debian:12`, nothing under a
  // bare `mupdf`), and a feed returning zero entries plus an unreadable
  // register is a clean pass with the whole reachability mechanism disarmed.
  //
  // Asserting on the message is what makes these cases discriminate between the
  // guard working and something else happening to fail.
  // -------------------------------------------------------------------------
  const trailingComma = pristine.replace('"reachabilityControl": [', '"reachabilityControl": [,');
  const typo = runAgainst('typo', trailingComma);
  check(
    'a hand-edit typo FAILS, and fails ON THE PARSE',
    !typo.ok && /is not valid JSON/.test(typo.output),
    'One stray comma must stop the run where it happens. Failing later, on an ' +
      `empty "reviewed" map, is luck rather than a guard.\n${typo.output}`,
  );

  const missing = runAgainstMissing();
  check(
    'a MISSING register FAILS, and says the register is unreadable',
    !missing.ok && /Cannot read the advisory register/.test(missing.output),
    'The register is tracked, so absent means deleted or misrouted. Regenerating ' +
      `it would discard every triage verdict in it.\n${missing.output}`,
  );

  // -------------------------------------------------------------------------
  // Empty is not clean, at either level.
  // -------------------------------------------------------------------------
  const noVerdicts = /** @type {Record<string, unknown>} */ (parsed(pristine));
  noVerdicts['reachability'] = {};
  const emptyMap = runAgainst('no-verdicts', JSON.stringify(noVerdicts));
  check(
    'an EMPTY reachability map FAILS, naming the empty map',
    !emptyMap.ok && /declares no reachability verdicts/.test(emptyMap.output),
    'An empty map means the file was truncated or the key renamed, not that ' +
      `nothing is watched.\n${emptyMap.output}`,
  );

  const emptyControls = /** @type {Record<string, unknown>} */ (parsed(pristine));
  emptyControls['reachabilityControl'] = [];
  const uncontrolled = runAgainst('empty-controls', JSON.stringify(emptyControls));
  check(
    'an EMPTY control list FAILS, naming the missing controls',
    !uncontrolled.ok && /declares no reachability controls/.test(uncontrolled.output),
    "Without a symbol it is known to find, the walk's silence about every other " +
      `symbol is worthless.\n${uncontrolled.output}`,
  );

  // -------------------------------------------------------------------------
  // EVERY load-bearing key, not the two that each got an `if` written for them.
  //
  // `reviewed` was the key still guarded by accident, and it is the key whose
  // accidental guard corrected the premise for this whole fix: an unreadable
  // register yielded an empty `reviewed`, all 74 advisories read untriaged, and
  // the check went red for a reason unrelated to what it was guarding. Same
  // compound clean pass as before — truncated register plus a feed returning
  // zero — reached through the third key instead of the first.
  //
  // A missing key is a truncated file, at every one of them.
  // -------------------------------------------------------------------------
  for (const key of ['reviewed', 'watch', 'reachability', 'reachabilityControl']) {
    const whole = /** @type {Record<string, unknown>} */ (parsed(pristine));
    const truncated = Object.fromEntries(
      Object.entries(whole).filter(([name]) => name !== key),
    );
    const result = runAgainst(`no-${key}`, JSON.stringify(truncated));
    check(
      `a register missing "${key}" FAILS, naming that key`,
      !result.ok && new RegExp(`is missing its "${key}" key`).test(result.output),
      `A truncated file and a renamed key both land here. Reporting it by name is ` +
        `what stops the next reader debugging a TypeError.\n${result.output}`,
    );
  }

  // `typeof null === 'object'`, so a null key would slip past a shape check
  // written the obvious way and die later on a TypeError — the failure this
  // table exists to replace with a named error.
  const nulled = /** @type {Record<string, unknown>} */ (parsed(pristine));
  nulled['reviewed'] = null;
  const nullKey = runAgainst('null-reviewed', JSON.stringify(nulled));
  check(
    'a NULL key FAILS as a missing key, not as an empty one',
    !nullKey.ok && /is missing its "reviewed" key/.test(nullKey.output),
    `typeof null === 'object' is the hole here, and it is a hole the type ` +
      `checker found rather than the proof.\n${nullKey.output}`,
  );

  const noTriage = /** @type {Record<string, unknown>} */ (parsed(pristine));
  noTriage['reviewed'] = {};
  const untriaged = runAgainst('no-triage', JSON.stringify(noTriage));
  check(
    'an EMPTY reviewed map FAILS on the register, not on the advisory count',
    !untriaged.ok && /declares no triaged advisories/.test(untriaged.output),
    'This is the case that only fails loudly while the feed returns entries. ' +
      'Guarded by name, it fails whatever the feed does — which is the whole ' +
      `difference between a guard and a coincidence.\n${untriaged.output}`,
  );

  // `watch` is the one key where empty is legitimate: zero hand-curated
  // upstream items is a real state. Its KEY must still be present, and that
  // asymmetry is asserted rather than assumed.
  const noWatched = /** @type {Record<string, unknown>} */ (parsed(pristine));
  noWatched['watch'] = {};
  check(
    'an EMPTY watch map is ACCEPTED — empty is a real state there',
    runAgainst('no-watched', JSON.stringify(noWatched)).ok,
    'Without this, the rule above would be "every key must be non-empty", which ' +
      'is a stricter claim than the evidence supports and would fail a register ' +
      'that is simply up to date.',
  );

  // -------------------------------------------------------------------------
  // The control itself must be load-bearing: break it and the check must go
  // red, or it is decoration.
  // -------------------------------------------------------------------------
  const blindWalk = /** @type {{ reachabilityControl: { symbol: string }[] }} */ (
    parsed(pristine)
  );
  const firstControl = blindWalk.reachabilityControl[0];
  if (firstControl === undefined) throw new Error('fixture has no controls to break');
  firstControl.symbol = 'fz_register_document_handler_THAT_IS_NOT_THERE';
  const blind = runAgainst('blind', JSON.stringify(blindWalk));
  check(
    'a control symbol that is NOT present FAILS the walk',
    !blind.ok,
    'A control nobody checks is decoration. This is the mutation that proves it ' +
      `is load-bearing.\n${blind.output}`,
  );
  check(
    'and the failure says the WALK is broken, not that the symbol is gone',
    /says the WALK is broken/.test(blind.output),
    'The distinction is the whole finding: a search reporting nothing looks the ' +
      `same whether it works or not.\n${blind.output}`,
  );

  // -------------------------------------------------------------------------
  // Coverage is derived from the verdicts, so a new glob demands a new control
  // rather than quietly inheriting one.
  // -------------------------------------------------------------------------
  const newGlob = /** @type {{ reachability: Record<string, { shippedPaths: string[] }> }} */ (
    parsed(pristine)
  );
  const firstVerdict = Object.values(newGlob.reachability)[0];
  if (firstVerdict === undefined) throw new Error('fixture has no verdicts to extend');
  firstVerdict.shippedPaths = [...firstVerdict.shippedPaths, 'packages/testing/src/**'];
  check(
    'a verdict scanning an UNCONTROLLED glob FAILS',
    !runAgainst('new-glob', JSON.stringify(newGlob)).ok,
    'A control over native/** says nothing about whether another glob resolves. ' +
      'Requiring one per glob is what stops the coverage rule decaying into a habit.',
  );

  // -------------------------------------------------------------------------
  // And the tracked register is untouched, which is the point of --baseline.
  // -------------------------------------------------------------------------
  check(
    'the tracked register was never written to',
    readFileSync(TRACKED, 'utf8') === pristine,
    'This proof must not be able to leave a corrupt security register behind.',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
    (failures.length > 0
      ? `\n${failures.length} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
      : `\n${passed.length} advisory-register cases passed.\n`),
);
process.exitCode = failures.length > 0 ? 1 : 0;
