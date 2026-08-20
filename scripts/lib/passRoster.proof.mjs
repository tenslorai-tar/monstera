// @ts-check
/**
 * Proves that a roster line is a fact about a case that ran.
 *
 * Split out of `reportError.proof.mjs`. That file proved two modules because
 * they share one property — output that reads as a fact and was not derived
 * from one — and its own header said they shared a file by accident. They do
 * fail independently: `reportError.mjs` governs what a FAILURE says, and its
 * blind spot was an errno dropped from a wrapped error; `passRoster.mjs`
 * governs what a PASS says, and its blind spot was an `ok` line outliving the
 * case that earned it. One property, two mechanisms, two repairs.
 *
 * ## What the cases below are guarding
 *
 * Four scripts printed a fixed block of `ok` lines and a hand-written total
 * when the failure list was empty. Nothing tied a line to a case, so the roster
 * could be wrong in both directions at once, and was: `gitleaks.proof` ran
 * three cases that had no line at all, while `documentConsistency` printed `ok`
 * for a threat-model section that only applies when a threat model exists, and
 * `mupdf.proof` printed `ok` for a resolution test whose reference images are
 * absent on a non-Windows runner — where its own catch swallowed the error.
 *
 * ## Which cases are load-bearing
 *
 * The two drift cases, and they are load-bearing in opposite directions. An
 * increase that is not recorded makes the declared number rot; a DECREASE is a
 * proof that quietly checks less than it did, and before Z-4 a deleted case
 * took its line and the derived total with it and nothing anywhere noticed —
 * both figures moving together is exactly what absence produces.
 *
 * The total-is-derived case needs its control for the same reason: a constant
 * that happens to equal the line count agrees with the correct answer for one
 * input, so a second roster of a different size must move the lines and the
 * total together.
 *
 * Usage: node scripts/lib/passRoster.proof.mjs
 */

import { createRoster } from './passRoster.mjs';
import { formatError } from './reportError.mjs';

/** @type {string[]} */
const failures = [];

// EIGHT, and the number is the control on the split that produced this file:
// the two halves declare 10 and 8, and 18 is what the single file ran.
//
// This proof reports itself through the module it tests, which is circular only
// in appearance. A `format` that stopped refusing a mismatched count would leave
// this roster silent — and would fail cases 6 and 7 below, which drive that
// refusal directly. A broken roster cannot reach the line that prints one.
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

function main() {
  /** @type {string[]} */
  const rosterFailures = [];
  // TWO, not three. A case that pushed a failure earns no label at all, so it
  // lands in neither list — and no real caller reaches `format` with a
  // non-empty failure list anyway. The declared count is what a CLEAN run
  // records.
  // `fixture`, never `roster`: this file now reports itself through a roster of
  // its own, and a local one of the same name shadows it. That is not
  // hypothetical — it happened while writing this file, and the run printed the
  // FIXTURE's two lines under this proof's own heading and still exited 0. ESLint
  // has no `no-shadow` reaching `scripts/`, so running it is what caught it.
  const fixture = createRoster(rosterFailures, { cases: 2 });

  const passedMark = fixture.mark();
  fixture.record(passedMark, 'a case that ran and passed');

  const failedMark = fixture.mark();
  rosterFailures.push('something went wrong');
  fixture.record(failedMark, 'a case that pushed a failure');

  const skippedMark = fixture.mark();
  fixture.record(skippedMark, 'a case with nothing to check', false);

  check(
    'a passing case earns its label',
    fixture.passed.includes('a case that ran and passed'),
    `passed: ${fixture.passed.join(', ') || '(none)'}`,
  );

  check(
    'a FAILING case earns no label',
    !fixture.passed.includes('a case that pushed a failure') &&
      !fixture.skipped.includes('a case that pushed a failure'),
    `a case that reported a problem also announced itself as passing. The failure is the ` +
      `report; a second line saying it passed is the contradiction the roster exists to stop.`,
  );

  // The live defect, in both files that had it: "found no problems" and "did
  // not look" are the same output otherwise (audit item 4b, one level up).
  check(
    'a case with nothing to check is NOT counted as passing',
    fixture.skipped.includes('a case with nothing to check') &&
      !fixture.passed.includes('a case with nothing to check'),
    `skipped: ${fixture.skipped.join(', ') || '(none)'} — a section that had nothing to read ` +
      `has verified nothing, and reporting it as a pass is how a threat-model check that ` +
      `never ran printed ok for months.`,
  );

  const rendered = fixture.format('widget case');
  const okLines = rendered.split('\n').filter((line) => line.startsWith('  ok  ')).length;

  // The drift control. The totals this replaces were literals, and the one in
  // gitleaks.proof.mjs was hand-edited 6 to 7 to 10 inside a single audit
  // range — those are the two deletions the scope report could not see in the
  // net diff.
  check(
    'the printed total is DERIVED from the lines, not written beside them',
    rendered.includes(`\n${String(okLines)} widget case`),
    `rendered:\n${rendered}\nIt printed ${okLines} ok line(s). A total that is not the count ` +
      `of what was printed is a number nothing keeps in step.`,
  );

  check(
    'CONTROL: the total is not a constant that happens to match',
    (() => {
      // A SECOND roster rather than growing the first, because a roster now
      // declares its size and refuses to print a different one. Same control:
      // a different number of passing cases must move the lines and the total
      // together, so the case above is not satisfied by a constant that
      // happens to agree for one input.
      /** @type {string[]} */
      const otherFailures = [];
      const bigger = createRoster(otherFailures, { cases: 3 });
      bigger.record(bigger.mark(), 'one');
      bigger.record(bigger.mark(), 'two');
      bigger.record(bigger.mark(), 'three', false);
      const grown = bigger.format('widget case');
      const grownOk = grown.split('\n').filter((line) => line.startsWith('  ok  ')).length;
      return grownOk === okLines + 1 && grown.includes(`\n${String(grownOk)} widget case`);
    })(),
    `a roster with one more passing case did not move both its lines and its total, so the ` +
      `case above is satisfied by a number that agrees with the lines only for this one input.`,
  );

  // Z-4. The two directions say different things and both must fail: an
  // increase that is not recorded makes the number rot, and a DECREASE is a
  // proof that quietly checks less than it did. Before this, a deleted case
  // took its line and the total with it and nothing anywhere noticed.
  for (const [declared, expectWord] of /** @type {const} */ ([
    [3, 'STOPPED RUNNING'],
    [1, 'Raise the number'],
  ])) {
    /** @type {string[]} */
    const noFailures = [];
    const drifted = createRoster(noFailures, { cases: declared });
    drifted.record(drifted.mark(), 'only one case here');
    drifted.record(drifted.mark(), 'and one more', false);

    let refused = '';
    try {
      drifted.format('widget case');
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    check(
      `a roster declaring ${String(declared)} while recording 2 refuses to print`,
      refused.includes(expectWord),
      `it ${refused === '' ? 'printed anyway' : `said: ${refused}`}. A count that disagrees ` +
        `with the run is not evidence in either direction — and the decrease is the one that ` +
        `matters, because both the lines and the total drop together and absence is what that ` +
        `looks like.`,
    );
  }

  check(
    'a roster cannot be created without declaring how many cases it has',
    (() => {
      try {
        // @ts-expect-error — the point of the case is that this is refused.
        createRoster([], undefined);
        return false;
      } catch {
        return true;
      }
    })(),
    `an optional count is one every future caller omits, and the omission looks exactly like ` +
      `every other roster. Requiring it is what stops the check being opt-in.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} pass-roster failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('pass-roster case'),
  );
  return failures.length > 0 ? 1 : 0;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
