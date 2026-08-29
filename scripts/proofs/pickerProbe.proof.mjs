// @ts-check
/**
 * Proves the picker probe's record cannot vouch for a picker nobody drove.
 *
 * ## What is being guarded, and why it is not obvious
 *
 * The record is the only evidence `documentPicker.ts` has ever executed, and it
 * is a JSON file in the repository — so every way of getting it wrong produces a
 * file that reads like evidence. Three of them:
 *
 * - **the record is missing**, and the gate says nothing;
 * - **the record says `cancelled`**, which is an honest observation of a dialog
 *   that was dismissed, and is not evidence the picker returned anything;
 * - **the record was written against different code**, so a picker edited after
 *   the run is certified by an observation that predates it.
 *
 * All three are `state !== 'observed'` and they are kept apart because they call
 * for different actions. This file asserts each one, and asserts the fourth — a
 * record that genuinely does vouch — because a state machine that answers "not
 * observed" to everything satisfies the other three perfectly.
 *
 * ## The digest's control runs towards DISAGREEMENT
 *
 * The property is *"these two agree"*, and agreement is also what **absence**
 * produces: a digest over files that do not exist is stable, so a deleted picker
 * would produce a record that never expires. Hashing an absent input therefore
 * throws, and the case asserts the throw rather than the hash — CLAUDE.md item
 * 4's direction rule, arriving in a comparison.
 *
 * Usage: node scripts/proofs/pickerProbe.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { PROBE_INPUTS, currentInputDigest, probeState, writeRecord } from '../lib/pickerProbe.mjs';

/** @type {string[]} */
const failures = [];

const CASES = [
  'no record at all is ABSENT, which is not the same as observed',
  'a record of a dismissed dialog is UNOBSERVED, however well formed',
  'a record written against different content is EXPIRED',
  'CONTROL: a record that agrees, and reports opened, is OBSERVED',
  'CONTROL: the digest MOVES when an input changes, so agreement means something',
  'an absent input THROWS rather than hashing to a stable value',
];

const roster = createRoster(failures, { cases: CASES.length });

/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

/**
 * A repository-shaped temporary tree carrying both probe inputs.
 *
 * Built rather than pointed at the real repository, because three of the six
 * cases need the inputs to be WRONG, and a proof that mutated the tree it runs
 * in is one that leaves the working copy damaged when it fails.
 *
 * @param {string} pickerBody what `documentPicker.ts` contains in this tree
 * @returns {string} the root
 */
function treeWith(pickerBody) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-picker-probe-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  for (const relative of PROBE_INPUTS) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, relative.endsWith('documentPicker.ts') ? pickerBody : 'observer\n', 'utf8');
  }
  return root;
}

/** @type {string[]} */
const roots = [];

try {
  // -------------------------------------------------------------------------
  // Absent.
  // -------------------------------------------------------------------------
  {
    const root = treeWith('picker v1\n');
    roots.push(root);
    const { state } = probeState(root);
    check(
      'no record at all is ABSENT, which is not the same as observed',
      state === 'absent',
      `a tree with both inputs and no docs/picker-probe.json reported "${state}". Nobody having ` +
        `run the probe must never read as the probe having succeeded — that is the reassuring ` +
        `answer arriving through absence, and it is the state this whole record exists to stop.`,
    );
  }

  // -------------------------------------------------------------------------
  // Unobserved: a dialog that was dismissed.
  // -------------------------------------------------------------------------
  {
    const root = treeWith('picker v1\n');
    roots.push(root);
    writeRecord(
      {
        outcome: 'cancelled',
        pathArrived: false,
        painted: 0,
        recordedAt: '2026-08-29T00:00:00.000Z',
        verdict: currentInputDigest(root),
      },
      root,
    );
    const { state } = probeState(root);
    check(
      'a record of a dismissed dialog is UNOBSERVED, however well formed',
      state === 'unobserved',
      `a record with outcome "cancelled" and a CURRENT digest reported "${state}". This is the ` +
        `case the fixture has to be built carefully for: the digest agrees and the file is ` +
        `well formed, so everything except the outcome says evidence. A dismissal is an honest ` +
        `observation and it is not evidence the dialog returned a path.`,
    );
  }

  // -------------------------------------------------------------------------
  // Expired: the code moved under the observation.
  // -------------------------------------------------------------------------
  {
    const root = treeWith('picker v1\n');
    roots.push(root);
    writeRecord(
      {
        outcome: 'opened',
        pathArrived: true,
        painted: 500_990,
        recordedAt: '2026-08-29T00:00:00.000Z',
        verdict: currentInputDigest(root),
      },
      root,
    );
    // THE MUTATION IS ON THE SUBJECT, not on the record. A record edited to
    // disagree would test that this reads a field; a picker edited after a
    // successful run is the thing that actually happens.
    writeFileSync(join(root, PROBE_INPUTS[0] ?? ''), 'picker v2\n', 'utf8');
    const { state } = probeState(root);
    check(
      'a record written against different content is EXPIRED',
      state === 'expired',
      `after documentPicker.ts changed under a record that says "opened", the state was ` +
        `"${state}". A run certifies the code that ran, and a record that survives an edit to ` +
        `its own subject is a claim about a program that no longer exists.`,
    );
  }

  // -------------------------------------------------------------------------
  // CONTROL: the state machine can say yes.
  // -------------------------------------------------------------------------
  {
    const root = treeWith('picker v1\n');
    roots.push(root);
    writeRecord(
      {
        outcome: 'opened',
        pathArrived: true,
        painted: 500_990,
        width: 595,
        height: 842,
        recordedAt: '2026-08-29T00:00:00.000Z',
        verdict: currentInputDigest(root),
      },
      root,
    );
    const { state } = probeState(root);
    check(
      'CONTROL: a record that agrees, and reports opened, is OBSERVED',
      state === 'observed',
      `a current record reporting "opened" was read as "${state}". Without this line every case ` +
        `above passes for a function that answers "not observed" to everything — which would ` +
        `make the gate permanently red and therefore permanently deleted.`,
    );
  }

  // -------------------------------------------------------------------------
  // CONTROL: the digest separates. Mutated towards DISAGREEMENT.
  // -------------------------------------------------------------------------
  {
    const root = treeWith('picker v1\n');
    roots.push(root);
    const before = currentInputDigest(root).digest;
    writeFileSync(join(root, PROBE_INPUTS[0] ?? ''), 'picker v2\n', 'utf8');
    const after = currentInputDigest(root).digest;
    check(
      'CONTROL: the digest MOVES when an input changes, so agreement means something',
      before !== after,
      `two different pickers hashed to the same digest ${before}. The expiry case above would ` +
        `then be passing for a reason it does not name, and every record would agree with every ` +
        `tree — the shape where a comparison and a missing comparison are one observation.`,
    );
  }

  // -------------------------------------------------------------------------
  // An absent input is refused rather than hashed.
  // -------------------------------------------------------------------------
  {
    const root = mkdtempSync(join(tmpdir(), 'monstera-picker-probe-empty-'));
    roots.push(root);
    let threw = false;
    try {
      currentInputDigest(root);
    } catch {
      threw = true;
    }
    check(
      'an absent input THROWS rather than hashing to a stable value',
      threw,
      `hashing a tree with no ${PROBE_INPUTS.join(' and no ')} produced a digest instead of ` +
        `refusing. Files that do not exist hash the same way tomorrow as today, so a deleted ` +
        `picker would produce a record that can never expire — agreement manufactured by ` +
        `absence, which is exactly what the expiry mechanism must not be able to report.`,
    );
  }

  if (recorded.length !== CASES.length || recorded.some((label, at) => label !== CASES[at])) {
    throw new Error(
      `CASES does not describe what ran.\n  declared:\n    ${CASES.join('\n    ')}\n  ran:\n    ` +
        `${recorded.join('\n    ')}`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} picker-probe failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('picker-probe case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
if (failures.length > 0) process.exitCode = 1;
