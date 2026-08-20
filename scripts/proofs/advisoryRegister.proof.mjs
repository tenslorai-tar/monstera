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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Cases that could not run, printed as such.
 *
 * A skipped case reported as a pass is the defect `passRoster.mjs` exists for,
 * one file over: "found no problems" and "did not look" are the same output
 * otherwise.
 *
 * @type {string[]}
 */
const skipped = [];

/**
 * Whether the Electron surface derivation can run here.
 *
 * Read as a FILE rather than by importing the deriver, because importing it
 * would make this proof depend on a module whose whole job is to refuse when
 * that file is missing.
 *
 * @returns {boolean}
 */
function electronIsInstalled() {
  return existsSync(join(ROOT, 'node_modules', 'electron', 'electron.d.ts'));
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
  // THE SYMBOL, not only the glob — finding T-1.
  //
  // A control per path glob proves the walk reads files. It says nothing about
  // whether the string being searched for could ever match. Misspell a symbol
  // and the walk reports "no references" forever, which is the verdict's
  // passing answer, and the summary line still counts it as checked because it
  // counts DECLARATIONS.
  //
  // Every case below was measured against the checker before the witness rule
  // existed: the first one exited 0.
  // -------------------------------------------------------------------------

  /**
   * @param {(register: any) => void} mutate
   * @returns {string}
   */
  function register(mutate) {
    const value = parsed(pristine);
    mutate(value);
    return JSON.stringify(value);
  }

  const misspeltUnwitnessed = runAgainst(
    'misspelt-unwitnessed',
    register((value) => {
      value.reachability['engine-host-containment'].symbols[0] = 'utilityProcesss';
    }),
  );
  // BOTH WORLDS, because this verdict's symbols became DERIVED when Electron
  // landed and a derivation has a provisioning condition. Where node_modules
  // exists the misspelling is a failure; where it does not — the Guards job,
  // which runs no `npm ci` at all — the honest answer is UNVERIFIABLE, and the
  // one thing that must never happen is the misspelt symbol being passed over in
  // silence.
  //
  // Asserted in both directions rather than skipped, because a case that skips
  // where the derivation is absent is a case that stops testing on exactly the
  // job it was added to protect. The coverage change is real and is stated
  // rather than hidden: before this verdict was derived, its `in: null` witness
  // made this misspelling a failure EVERYWHERE. It is now the same posture as
  // the eleven OCR doors, and `--require-derivation` is what makes it mandatory
  // where something can look.
  const derivable = electronIsInstalled();
  check(
    derivable
      ? 'THE T-1 CASE: a symbol misspelt in the register FAILS'
      : 'THE T-1 CASE: with no derivation, a misspelt symbol is UNVERIFIABLE, never silent',
    derivable
      ? !misspeltUnwitnessed.ok &&
          /has no witness and no derivation/.test(misspeltUnwitnessed.output)
      : /utilityProcesss/.test(misspeltUnwitnessed.output) &&
          /UNVERIFIABLE/.test(misspeltUnwitnessed.output),
    'This exact mutation exited 0 before the witness rule, printing "18 symbol(s) checked" ' +
      "with invariant 25's containment verdict green forever. " +
      `Derivation available here: ${String(derivable)}.\n` +
      misspeltUnwitnessed.output,
  );

  const misspeltWitnessed = runAgainst(
    'misspelt-witnessed',
    register((value) => {
      const claim = value.reachability['renderer-facing-errors-carry-no-text'];
      claim.symbols[0] = 'toStructuredErrror';
      claim.witness['toStructuredErrror'] = claim.witness['toStructuredError'];
      delete claim.witness['toStructuredError'];
    }),
  );
  check(
    'a symbol misspelt CONSISTENTLY, in the list and its own witness, still FAILS',
    !misspeltWitnessed.ok && /NOT found in its own witness scope/.test(misspeltWitnessed.output),
    'Renaming both halves is what a careful typo looks like. The witness is a search for the ' +
      `same string in text that does not declare it, so it cannot follow the mistake.\n${misspeltWitnessed.output}`,
  );

  check(
    'a symbol with NO witness entry FAILS rather than being tolerated',
    !runAgainst(
      'no-witness',
      register((value) => {
        delete value.reachability['kernel-holds-canonical-bytes'].witness['ByteImage'];
      }),
    ).ok,
    'An unaccounted symbol is in exactly the state a misspelt one is in. Omission cannot be ' +
      'the quiet way past this rule.',
  );

  check(
    'an EMPTY witness scope FAILS',
    !runAgainst(
      'empty-scope',
      register((value) => {
        value.reachability['kernel-holds-canonical-bytes'].witness['ByteImage'].in = [];
      }),
    ).ok,
    'A scope matching nothing finds nothing by construction, which is the shape of every ' +
      'broken search in this file.',
  );

  const circular = runAgainst(
    'circular-witness',
    register((value) => {
      value.reachability['pdf_subset_fonts'].witness['pdf_subset_fonts'].in = ['docs/security/**'];
    }),
  );
  check(
    'a witness resolving to the REGISTER ITSELF FAILS as circular',
    !circular.ok && /circular/.test(circular.output),
    'A misspelling is present in the register too, so a witness that reads it finds the typo ' +
      `and reports success — a search confirming itself.\n${circular.output}`,
  );

  // -------------------------------------------------------------------------
  // `in: null` is a DERIVED state, not a declared one. These two cases are the
  // whole difference between it and a config flag.
  //
  // SYNTHETIC FIXTURES, and they had to become synthetic. They used to mutate
  // `engine-host-containment`, which was the register's only live `in: null` —
  // and on 2026-08-20 that verdict's nulls expired exactly as designed, Electron
  // became a dependency, and its symbols moved to a derivation. Three cases then
  // crashed on `witness` being undefined.
  //
  // That is finding V-1's shape: a control whose subject can disappear is a
  // control that stops testing without failing. The mechanism it guards is still
  // in the code and still reachable by any future verdict, so the fixture is now
  // built rather than borrowed.
  // -------------------------------------------------------------------------
  const bareNull = runAgainst(
    'bare-null',
    register((value) => {
      value.reachability['kernel-holds-canonical-bytes'].witness['ByteImage'] = {
        in: null,
        why: 'a null with no condition at all',
      };
    }),
  );
  check(
    'a bare in: null with NO condition FAILS',
    !bareNull.ok && /asserting an exemption/.test(bareNull.output),
    'Without a condition the register can resolve, a null is an author writing their own ' +
      `exemption — the escape hatch this rule refuses.\n${bareNull.output}`,
  );

  const staleNull = runAgainst(
    'stale-null',
    register((value) => {
      // `typescript` IS named in package.json, so this condition is false the
      // moment it is resolved — which is exactly what happened to the real one
      // when Electron landed.
      value.reachability['kernel-holds-canonical-bytes'].witness['ByteImage'] = {
        in: null,
        acceptedWhile: { absent: 'typescript', from: ['package.json'] },
        why: 'a condition that does not hold',
      };
    }),
  );
  check(
    'an in: null whose CONDITION NO LONGER HOLDS FAILS',
    !staleNull.ok && /NO LONGER HOLDS/.test(staleNull.output),
    'The null is accepted only while nothing could witness the symbol. When that stops being ' +
      'true the exemption expires by itself — the day Electron becomes a dependency, with no ' +
      `second mechanism needed.\n${staleNull.output}`,
  );

  // -------------------------------------------------------------------------
  // COMPLETENESS, which is what a derivation buys over a witness. A witness can
  // only say "the name you wrote is real"; it cannot say the list is whole. The
  // register's own why predicted this — "a correctly spelt list can still be
  // short" — and the derivation proved it on its first run, finding
  // `UtilityProcess` missing from a pair picked by hand.
  // -------------------------------------------------------------------------
  if (!derivable) {
    // A GENUINE skip, printed as one. There is nothing to assert: the
    // completeness check cannot run without electron.d.ts, so a case here would
    // be measuring its own absence. Reported rather than omitted — "did not
    // look" and "looked and found nothing" are the same output otherwise.
    skipped.push(
      'a symbol list SHORT of Electron’s spawn surface FAILS — no node_modules, so the ' +
        'derivation that computes the spawn surface cannot run',
    );
  } else {
    const shortList = runAgainst(
      'short-symbol-list',
      register((value) => {
        value.reachability['engine-host-containment'].symbols = value.reachability[
          'engine-host-containment'
        ].symbols.filter((/** @type {string} */ symbol) => symbol !== 'utilityProcess');
      }),
    );
    check(
      'a symbol list SHORT of Electron’s spawn surface FAILS',
      !shortList.ok && /does not name: utilityProcess/.test(shortList.output),
      'The spawn surface is derived from electron.d.ts by TYPE, so a name dropped from the ' +
        'register — or an entry point Electron adds later — must turn this red. A hand-picked ' +
        `list that nothing checks is the state invariant 25 was in until Electron landed.\n${shortList.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // ITEM 4b's CONTROL FOR THIS RULE, and it is not optional.
  //
  // Every case above is satisfied by a rule that verifies NOTHING and calls all
  // 18 symbols unverifiable — it would still fail each mutation, and still exit
  // 0 on the pristine register. So the rule must be shown to verify something
  // known-verifiable, on every run.
  // -------------------------------------------------------------------------
  const counts = /(\d+) verified, (\d+) unverifiable/.exec(control.output);
  check(
    'CONTROL: the walk reports a NON-ZERO verified count',
    counts !== null && Number(counts[1]) > 0,
    'A rule that verifies nothing passes every case above. "0 verified, 18 unverifiable" is ' +
      `the shape of this rule being blind.\n${control.output}`,
  );

  // -------------------------------------------------------------------------
  // ITEM 4a — RESOLUTION. Two counts that must move in opposite directions by
  // one, which is the smallest change that alters what the line means.
  // -------------------------------------------------------------------------
  const shifted = runAgainst(
    'one-fewer-witnessed',
    register((value) => {
      value.reachability['kernel-holds-canonical-bytes'].witness['ByteImage'] = {
        in: null,
        // A condition that genuinely HOLDS, so this symbol becomes unverifiable
        // rather than a failure. It used to say `absent: 'electron'`, which was
        // true until 2026-08-20 and is now false — the fixture would have moved
        // the counts by zero and reported a failure instead, which is the same
        // silent-expiry hazard the cases above were rebuilt for.
        acceptedWhile: { absent: 'monstera-not-a-dependency', from: ['package.json'] },
        why: 'resolution fixture',
      };
    }),
  );
  const moved = /(\d+) verified, (\d+) unverifiable/.exec(shifted.output);
  check(
    'RESOLUTION: moving ONE symbol from witnessed to unverifiable moves BOTH counts by one',
    counts !== null &&
      moved !== null &&
      Number(moved[1]) === Number(counts[1]) - 1 &&
      Number(moved[2]) === Number(counts[2]) + 1,
    'A single number covering both states is how T-1 stayed invisible for a whole range. ' +
      `These two must be distinguishable at a difference of one.\n${control.output}\n${shifted.output}`,
  );

  // -------------------------------------------------------------------------
  // And the tracked register is untouched, which is the point of --baseline.
  // -------------------------------------------------------------------------
  check(
    'the tracked register was never written to',
    readFileSync(TRACKED, 'utf8') === pristine,
    'This proof must not be able to leave a corrupt security register behind.',
  );

  // -------------------------------------------------------------------------
  // THE DERIVATION IS MANDATORY IN EXACTLY ONE JOB, AND OPTIONAL IN THE OTHER.
  //
  // The register reports the OCR doors as unverifiable where the MuPDF source
  // is absent, which is right — "could not look" is not "looked and found
  // nothing" — and would be a hole if it were true everywhere. The shim job has
  // the source and passes --require-derivation, so absence is a failure there.
  //
  // Two invocations, and each can be undone in its own direction: drop the flag
  // from the shim job and the doors are derived nowhere; add it to Guards and
  // every run goes red on both platforms, which is what happened for two days.
  // Neither shows up in any test, so the pair is asserted here.
  //
  // This is what CAN be proven without spawning: the branch itself runs in
  // Guards on every push and is exercised by that job's own environment. A
  // direct case needs the witness rule extracted from the script, which is owed
  // and named rather than implied.
  // -------------------------------------------------------------------------
  const shimJob = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const guardsJob = readFileSync(join(ROOT, '.github', 'workflows', 'guards.yml'), 'utf8');

  check(
    'the job that provisions MuPDF requires the derivation',
    /check:advisories -- --require-derivation/u.test(shimJob),
    'ci.yml must run check:advisories with --require-derivation in the job that provisions ' +
      'MuPDF. Without it the OCR door set is derived in no job at all, and "unverifiable ' +
      'everywhere" is a stable state nothing reports as wrong.',
  );

  check(
    'CONTROL: and the job that does NOT provision it must not require the derivation',
    guardsJob.includes('npm run check:advisories\n') &&
      !/check:advisories -- --require-derivation/u.test(guardsJob),
    'guards.yml does not provision MuPDF, so requiring the derivation there turns every run ' +
      'red on both platforms. Without this control the case above is satisfied by putting the ' +
      'flag on every invocation, which is the failure that was just fixed.',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
    skipped.map((label) => `  --  ${label}\n`).join('') +
    (failures.length > 0
      ? `\n${failures.length} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
      : `\n${passed.length} advisory-register cases passed.\n`),
);
process.exitCode = failures.length > 0 ? 1 : 0;
