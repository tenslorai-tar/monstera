// @ts-check
/**
 * Proof that the Stage 0 gate on the tool-use guard cannot be satisfied by
 * anything short of the guard actually firing (rule B2).
 *
 * The gate exists because `CLAUDE.md` asserts a mechanism whose only unproven
 * part is the part that matters — that the hook is ever loaded — and because the
 * first attempt to test it produced an answer that could not mean what it
 * appeared to. So the cases here are mostly about the ways a record can look
 * like evidence and not be one:
 *
 *   - no record at all;
 *   - a record about a different guard, because its inputs have since changed;
 *   - a record taken in a session whose process predates the configuration, so
 *     the guard could not have been loaded and "it ran" is indistinguishable
 *     from "there is no guard" — this is attempt 1, and it is the case the whole
 *     record format exists to reject;
 *   - a record that honestly says the guard did not fire.
 *
 * The load-bearing control is the last section: marking the gate done in
 * docs/FEATURES.md must turn `check:docs` red. Without it, every case above
 * could pass while nothing consulted them — a correct checker nobody calls,
 * which is the display-only sin this project names.
 *
 * Usage: node scripts/proofs/hookProbe.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { PROBE_INPUTS, RECORD_FILE, probeState } from '../lib/hookProbe.mjs';
import { digestInputs } from '../lib/verdict.mjs';

const ROOT = repoRoot();

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
 * A throwaway tree carrying copies of the probe's declared inputs, so a record
 * can be fabricated against known bytes without touching this repository.
 *
 * @returns {string}
 */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-probe-'));
  // A git work tree, because the recorder asks git for the root before anything
  // else. Without this the recorder dies on "not a git repository" — still
  // fail-closed, but it would let the refusal case below pass for a reason that
  // has nothing to do with the session start it is meant to be testing.
  spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  for (const input of PROBE_INPUTS) {
    if (!('file' in input)) continue;
    const destination = join(root, input.file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(ROOT, input.file), destination);
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}

/**
 * @param {string} root
 * @param {Partial<import('../lib/hookProbe.mjs').ProbeRecord>} overrides
 */
function writeRecordIn(root, overrides) {
  const digest = digestInputs(PROBE_INPUTS, { root });
  /** @type {import('../lib/hookProbe.mjs').ProbeRecord} */
  const record = {
    outcome: 'denied',
    command: 'node -e "console.log(\'hook test\')"',
    recordedAt: '2026-09-01T12:00:00.000Z',
    // A session that started well AFTER its inputs last changed: the healthy
    // shape, which each case below then breaks in exactly one way.
    sessionStartedAt: '2026-09-01T10:00:00.000Z',
    inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    note: 'fixture',
    verdict: {
      digest: digest.digest,
      inputs: digest.inputs.map((input) => ({ name: input.name, digest: input.digest })),
    },
    ...overrides,
  };
  writeFileSync(join(root, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// The states a record can be in.
// ---------------------------------------------------------------------------
{
  const root = makeRoot();
  try {
    check('no record at all reads as unrecorded', probeState(root).state === 'unrecorded', probeState(root).detail);

    writeRecordIn(root, {});
    check(
      'a complete record of a denial is accepted',
      probeState(root).state === 'denied',
      // The positive case has to exist, or every rejection below is satisfied by
      // a checker that rejects everything.
      probeState(root).detail,
    );

    writeRecordIn(root, { outcome: 'executed' });
    check(
      'a record saying the command RAN is not a satisfied gate',
      probeState(root).state === 'executed',
      probeState(root).detail,
    );

    // The asymmetry, which this proof originally had backwards.
    //
    // A denial cannot be produced by a session that never loaded the guard, so
    // its own timing cannot weaken it. An "it ran" is the ambiguous one. The
    // first denial this project ever observed came from a session that predated
    // its configuration by forty hours, and a symmetric rule would have thrown
    // that evidence away for being suspiciously old.
    writeRecordIn(root, {
      outcome: 'denied',
      sessionStartedAt: '2026-08-16T08:29:43.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'a DENIAL is accepted even from a session older than the guard',
      probeState(root).state === 'denied',
      `A denial is self-certifying: nothing that failed to load the guard can be blocked by it. ` +
        `${probeState(root).detail}`,
    );

    writeRecordIn(root, {
      outcome: 'executed',
      sessionStartedAt: '2026-08-16T08:29:43.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'but an EXECUTED from a session older than the guard is rejected',
      probeState(root).state === 'stale-session',
      `This is the confound that produced attempt 1's result: "it ran" cannot be told apart from ` +
        `"there is no guard". ${probeState(root).detail}`,
    );

    // Resolution test for the boundary itself: one second later must be enough
    // to be a different session, or the comparison is decorative. Run against
    // the ambiguous outcome, because that is the only one the boundary governs.
    writeRecordIn(root, {
      outcome: 'executed',
      sessionStartedAt: '2026-08-18T00:18:40.000Z',
      inputsLastChangedAt: '2026-08-18T00:18:39.000Z',
    });
    check(
      'and one second AFTER the configuration reads as executed, not stale',
      probeState(root).state === 'executed',
      `the comparison must distinguish its two inputs, not merely reject. ${probeState(root).detail}`,
    );

    // The verdict half: a record is about the guard it was taken against.
    writeRecordIn(root, {});
    const settings = join(root, '.claude', 'settings.json');
    const original = readFileSync(settings, 'utf8');
    writeFileSync(settings, `${original}\n`, 'utf8');
    check(
      'changing the settings by ONE byte invalidates the record',
      probeState(root).state === 'inputs-changed',
      probeState(root).detail,
    );
    writeFileSync(settings, original, 'utf8');

    const guard = join(root, 'scripts', 'hooks', 'blockEscapeResolvingWrites.mjs');
    const guardSource = readFileSync(guard, 'utf8');
    writeFileSync(guard, `${guardSource}\n`, 'utf8');
    check(
      'and so does changing the guard script',
      probeState(root).state === 'inputs-changed',
      'a probe run against a different script is not evidence about this one',
    );
    writeFileSync(guard, guardSource, 'utf8');

    check('restoring both bytes restores the verdict', probeState(root).state === 'denied', probeState(root).detail);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The recorder refuses what it cannot stand behind.
// ---------------------------------------------------------------------------
{
  const root = makeRoot();
  try {
    // No agent session transcript corresponds to this throwaway root, so the
    // session start cannot be established. Recording anyway would produce
    // exactly the unverifiable pass the format exists to prevent.
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'hooks', 'recordHookProbe.mjs'), 'denied'],
      { cwd: root, encoding: 'utf8' },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    check(
      'the recorder refuses when it cannot establish the session start',
      result.status !== 0 && /cannot determine|not tracked by git/iu.test(output),
      `exit ${result.status}, output:\n${output.slice(0, 500)}`,
    );

    const usage = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'hooks', 'recordHookProbe.mjs')],
      { cwd: ROOT, encoding: 'utf8' },
    );
    check(
      'and refuses an outcome it was not given',
      usage.status !== 0,
      'an unrecorded outcome must not default to the happy one',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// THE CONTROL: claiming the gate turns the document check red.
// ---------------------------------------------------------------------------
{
  const featuresPath = join(ROOT, 'docs', 'FEATURES.md');
  const original = readFileSync(featuresPath, 'utf8');

  // The gate is satisfied now, so claiming the row done is legitimate and the
  // control has to remove the EVIDENCE rather than merely make the claim. This
  // case failed the moment the first denial was recorded, which is the control
  // doing its job: its premise had changed and it said so instead of passing.
  const recordPath = join(ROOT, RECORD_FILE);
  const savedRecord = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : null;

  /** @returns {{ ok: boolean, output: string }} */
  const runDocs = () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'hooks', 'documentConsistency.mjs')],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };

  try {
    const quiet = runDocs();
    check(
      'with the gate unclaimed the check stays quiet',
      quiet.ok,
      `a gate that fails from the day it is written is a red build people learn to read past.\n${quiet.output.slice(-600)}`,
    );

    // Rewrites the status cell to done whatever it currently says. Matching only
    // the unclaimed form broke the moment the gate was genuinely satisfied,
    // which would have left the control below testing nothing.
    let rowFound = false;
    const claimed = original
      .split('\n')
      .map((line) => {
        if (!line.includes('the PreToolUse write guard has been')) return line;
        rowFound = true;
        return line.replace(/\|\s*(?:—|\*\*done\*\*|wip|partly done)\s*\|?\s*$/u, '| **done** |');
      })
      .join('\n');
    check(
      'the gate row is present and its status cell can be set',
      rowFound && /the PreToolUse write guard has been[\s\S]*?\|\s*\*\*done\*\*\s*\|/u.test(claimed),
      'the row was not found or its status cell did not match; the control below would be vacuous',
    );
    writeFileSync(featuresPath, claimed, 'utf8');
    rmSync(recordPath, { force: true });

    const red = runDocs();
    check(
      'CONTROL: claiming the gate done with no evidence fails check:docs',
      !red.ok && /observed to fire|unrecorded/iu.test(red.output),
      `exit ok=${red.ok}. If this passes, the gate is a sentence in a table that nothing reads.\n` +
        `${red.output.slice(-800)}`,
    );

    if (savedRecord !== null) writeFileSync(recordPath, savedRecord, 'utf8');
    const green = runDocs();
    check(
      'and passes again once the evidence is back',
      green.ok,
      `The control must restore what it removed, or every later run of check:docs is measuring ` +
        `this proof's leftovers.\n${green.output.slice(-600)}`,
    );
  } finally {
    writeFileSync(featuresPath, original, 'utf8');
    if (savedRecord !== null) writeFileSync(recordPath, savedRecord, 'utf8');
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nHook-probe gate proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} hook-probe gate cases passed.\n`);
