// @ts-check
/**
 * Proof that a could-not-look and a pass are not the same observation (rule B2).
 *
 * The reassuring answer here is a **zero exit**, and that is exactly what a
 * probe returns when it measured nothing. So the cases below are weighted
 * toward the direction that loses a defect: a run that could not look, on a job
 * that provisioned everything it needs, must be RED.
 *
 * Both directions are asserted rather than the strict one alone, because a rule
 * that failed everywhere would satisfy "required means red" and turn every
 * platform where the measurement is meaningless into a broken build — which is
 * how a check gets deleted rather than corrected.
 *
 * Usage: node scripts/proofs/unverifiable.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import {
  PARTIAL_MARKER,
  UNVERIFIABLE_MARKER,
  partialOutcome,
  unverifiableOutcome,
} from '../lib/unverifiable.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const asked = {
  required: true,
  subject: "invariant 25's containment",
  why: 'the build is absent',
  flag: '--require-containment',
};
const notAsked = { ...asked, required: false };

const strict = unverifiableOutcome(asked);
const permissive = unverifiableOutcome(notAsked);

check(
  'a job that REQUIRED the measurement gets a non-zero exit when it could not be taken',
  strict.code === 1,
  `code ${String(strict.code)}. This is the whole finding: a probe that exits 0 having measured ` +
    `nothing makes "could not look" and "looked and found nothing" the same observation, on the ` +
    `one job where the first cannot legitimately happen.`,
);

check(
  'and the explanation goes to stderr, where a failing step prints it',
  strict.stream === 'stderr',
  `stream ${strict.stream}. A red whose reason is on stdout is a red whose reason a reader has ` +
    `to go looking for.`,
);

check(
  'a job that did NOT require it exits zero',
  permissive.code === 0,
  `code ${String(permissive.code)}. VACUITY GUARD as much as a property: a rule that failed ` +
    `everywhere would satisfy the case above and turn every platform where the measurement is ` +
    `meaningless into a broken build — which is how a check gets turned off rather than fixed.`,
);

check(
  'the permissive text refuses to call itself a pass, and names the flag that makes it red',
  permissive.text.includes('NOT a pass') && permissive.text.includes(notAsked.flag),
  `it said ${JSON.stringify(permissive.text)}. A zero exit that reads as success is the defect ` +
    `wearing the outcome it is supposed to distinguish itself from, and a reader who cannot see ` +
    `where the strict path lives has no way to check that one exists.`,
);

check(
  'both texts carry the specific condition rather than a category',
  strict.text.includes(asked.why) && permissive.text.includes(asked.why),
  `strict: ${JSON.stringify(strict.text)}; permissive: ${JSON.stringify(permissive.text)}. ` +
    `"Could not look" without saying what stopped it sends the next reader to reproduce the ` +
    `condition before they can act on it.`,
);

// ---------------------------------------------------------------------------
// THE MARKER A HARNESS KEYS ON (finding DDDD-6).
//
// The permissive outcome exits 0, so a runner reading the exit code alone
// reports a probe that measured nothing as a pass — measured, by moving a built
// module aside. `checkLocal.mjs` now reads this marker to report a third state,
// which makes the string load-bearing rather than cosmetic.
// ---------------------------------------------------------------------------

check(
  'the permissive text carries the marker a harness can key on',
  permissive.text.includes(UNVERIFIABLE_MARKER),
  `it said ${JSON.stringify(permissive.text)}, which does not contain ` +
    `${JSON.stringify(UNVERIFIABLE_MARKER)}. A runner sees exit 0 and nothing else, so without ` +
    `this token a probe that could not look and a probe that measured everything are one ` +
    `observation.`,
);

check(
  'and the STRICT text does not, so a hard failure is never reported as could-not-look',
  !strict.text.includes(UNVERIFIABLE_MARKER),
  `the required-mode text contains the marker. It exits 1 and is a genuine failure; a harness ` +
    `that also saw the marker would downgrade the one case this whole rule exists to keep red.`,
);

check(
  'CONTROL: the marker is specific enough that ordinary output does not carry it',
  !'  ok  proof:transportwrite (1.5s)\n  14 write cases passed.\n'.includes(UNVERIFIABLE_MARKER) &&
    UNVERIFIABLE_MARKER.trim().length > 4,
  `${JSON.stringify(UNVERIFIABLE_MARKER)} matches ordinary harness output, so every passing ` +
    `script would be classified as unverifiable — the opposite error, and one that makes the ` +
    `state useless rather than absent.`,
);

// ---------------------------------------------------------------------------
// THE THIRD STATE. Four proofs assert one set of cases everywhere and another
// only where a runtime is provisioned, and filing those under the marker above
// would say they measured NOTHING — false in the direction that reads as
// coverage.
// ---------------------------------------------------------------------------

const partial = partialOutcome({
  required: false,
  ran: 20,
  missed: ['a preload cannot reach Node', 'the window paints what the shell declares'],
  why: 'The Electron runtime is missing.',
  flag: '--require-runtime',
});

check(
  'a partial carries its own marker AND the tally, which is what makes it a third state',
  partial.text.includes(PARTIAL_MARKER) &&
    partial.text.includes('20 case(s) ran, 2 could not'),
  `the permissive partial text is ${JSON.stringify(partial.text)}. Without the counts this is ` +
    `the blank state renamed: *some* and *none* are the whole distinction, and a reader ` +
    `deciding whether to trust a green sweep needs the ratio rather than the adjective.`,
);

check(
  'and it NAMES the cases it could not reach',
  partial.text.includes('a preload cannot reach Node'),
  `the text carries a count and not the names. Twenty of twenty-six says nothing about ` +
    `whether the six were the ones that mattered.`,
);

/**
 * THE CASE THE WHOLE SPLIT TURNS ON. `checkLocal.mjs` tests the blank marker
 * FIRST and the partial second, so a partial text that also carried the blank
 * one would be filed as *measured nothing* — the exact widening this state was
 * added to remove, arriving through the tokens rather than through the wording.
 */
check(
  'CONTROL: the two markers are DISJOINT, so a harness cannot file one as the other',
  !partial.text.includes(UNVERIFIABLE_MARKER) &&
    !unverifiableOutcome({
      required: false,
      subject: 'a subject',
      why: 'a reason',
      flag: '--require-it',
    }).text.includes(PARTIAL_MARKER),
  `one marker's text contains the other's token. A harness matching in either order then ` +
    `reports one state for both, which is the collapse the third state exists to prevent.`,
);

check(
  'a partial where the require flag is passed is a FAILURE, and drops the partial marker',
  partialOutcome({
    required: true,
    ran: 20,
    missed: ['a case'],
    why: 'a reason',
    flag: '--require-runtime',
  }).code === 1 &&
    !partialOutcome({
      required: true,
      ran: 20,
      missed: ['a case'],
      why: 'a reason',
      flag: '--require-runtime',
    }).text.includes(PARTIAL_MARKER),
  `the strict partial either exits 0 or still carries the marker. A job that asserts it CAN ` +
    `look must not report a partial as a tolerated state, and a harness reading the marker ` +
    `would downgrade the failure.`,
);

/**
 * A COMPLETE RUN MARKED PARTIAL IS THE SAME WIDENING POINTING THE OTHER WAY,
 * and it is refused rather than tolerated: it would make a sweep file a run that
 * measured everything as one that did not.
 */
check(
  'CONTROL: a partial with NOTHING missing is refused',
  (() => {
    try {
      partialOutcome({ required: false, ran: 3, missed: [], why: 'a reason', flag: '--f' });
      return false;
    } catch {
      return true;
    }
  })(),
  `partialOutcome accepted an empty missed list, so a run that evaluated everything can print ` +
    `a marker saying it did not.`,
);

if (failures.length > 0) {
  process.stderr.write(
    `\nUnverifiable proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`\n${roster.format('unverifiable case')}`);
