// @ts-check
/**
 * Proves the test-case-count instrument can SEE, and does not report what it
 * should not.
 *
 * ## Why it needs one at all
 *
 * Its output on an ordinary commit is *none lost a case*, and that is the
 * reassuring answer — identical to what a wrong pattern prints, what an empty
 * path list prints, and what a comparison against the wrong revision prints.
 * Checklist 4b: a search is not finished until it must locate something it is
 * known to be able to find.
 *
 * The check carries its own positive control at the point of use, because it is
 * run by hand and in a hook where this proof is not there. This file is the
 * other half: it drives the counter and the comparison over constructed blobs,
 * in both directions.
 *
 * ## The fixtures are BUILT rather than taken from the repository
 *
 * A case pinned to a real file's case count is pinned to something designed to
 * change, and the mutation would land nowhere the day somebody adds a test.
 *
 * Usage: node scripts/proofs/testAnchors.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { countCases, findShrunkCases, formatShrunkCases } from '../lib/testCaseCounts.mjs';

/** @type {string[]} */
const failures = [];

const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** Four cases in four spellings, so no one branch of the pattern carries them all. */
const FOUR = [
  "describe('a suite', () => {",
  "  it('plain', () => {});",
  "  it.each([1, 2])('parameterised %i', () => {});",
  "  test('the other name', () => {});",
  "  it.skip('skipped but present', () => {});",
  '});',
].join('\n');

/** The same file with the plain case removed. */
const THREE = FOUR.split('\n')
  .filter((line) => !line.includes("it('plain'"))
  .join('\n');

try {
  check(
    'the counter finds every spelling: it, it.each, test and it.skip',
    countCases(FOUR) === 4,
    `counted ${String(countCases(FOUR))} in a source declaring 4. A pattern that missed one ` +
      `spelling would under-count both sides equally and hide a removal in that spelling.`,
  );

  check(
    'CONTROL: it does not count `describe`, or a word ending in it',
    countCases("describe('x', () => {});\nsubmit(1);\nawait();\nconst omit = () => {};") === 0,
    `counted ${String(
      countCases("describe('x', () => {});\nsubmit(1);\nawait();\nconst omit = () => {};"),
    )} in a source with no cases. \`submit(\` and \`omit\` both end in "it", and a pattern ` +
      `without the word-boundary guard reports every call in the repository.`,
  );

  // ------------------------------------------------------------------
  // The comparison, in both directions. A reporter that flagged everything
  // passes the shrink case perfectly and is noise nobody reads.
  // ------------------------------------------------------------------
  const shrank = findShrunkCases({
    paths: ['a.test.ts'],
    head: () => FOUR,
    staged: () => THREE,
  });

  check(
    'a file that LOST a case is reported, with both numbers',
    shrank.shrunk.length === 1 &&
      shrank.shrunk[0]?.before === 4 &&
      shrank.shrunk[0]?.after === 3,
    `reported ${JSON.stringify(shrank.shrunk)}. The numbers are the report's whole value: ` +
      `"a test file changed" is true of every commit and tells nobody anything.`,
  );

  const grew = findShrunkCases({
    paths: ['a.test.ts'],
    head: () => THREE,
    staged: () => FOUR,
  });

  check(
    'CONTROL: a file that GAINED a case is not reported',
    grew.shrunk.length === 0,
    `reported ${JSON.stringify(grew.shrunk)}. Adding a case is the ordinary event; an ` +
      `instrument that flagged it would print on nearly every commit and be ignored on the one ` +
      `that mattered.`,
  );

  const same = findShrunkCases({
    paths: ['a.test.ts'],
    head: () => FOUR,
    staged: () => FOUR.replace('a suite', 'a renamed suite'),
  });

  check(
    'CONTROL: a file edited without losing a case is not reported',
    same.shrunk.length === 0,
    `reported ${JSON.stringify(same.shrunk)}. Most edits to a test file change assertions ` +
      `rather than the case set, and reporting those is the same noise.`,
  );

  // ------------------------------------------------------------------
  // The two states that are NOT a shrink, and which a naive comparison
  // reports as the largest one it has ever seen.
  // ------------------------------------------------------------------
  const added = findShrunkCases({ paths: ['new.test.ts'], head: () => null, staged: () => FOUR });

  check(
    'CONTROL: a file ADDED by this commit is not a shrink from nothing',
    added.shrunk.length === 0 && added.compared === 0,
    `reported ${JSON.stringify(added.shrunk)} over ${String(added.compared)} comparison(s). ` +
      `A new test file has no previous count, and treating its absence as zero would report ` +
      `every new file as the biggest removal in the commit.`,
  );

  const removed = findShrunkCases({ paths: ['gone.test.ts'], head: () => FOUR, staged: () => null });

  check(
    'CONTROL: a file DELETED by this commit is left to the diff',
    removed.shrunk.length === 0 && removed.compared === 0,
    `reported ${JSON.stringify(removed.shrunk)}. A whole file leaving is visible without help; ` +
      `routing it through a compensation written for a case that vanished INSIDE one would bury ` +
      `the signal this exists for.`,
  );

  check(
    'the report names the file and the direction, and says it is not a refusal',
    (() => {
      const text = formatShrunkCases(shrank.shrunk) ?? '';
      return (
        text.includes('a.test.ts') &&
        text.includes('4 case(s) at HEAD, 3 staged') &&
        text.includes('Not a refusal')
      );
    })(),
    `the report was ${JSON.stringify(formatShrunkCases(shrank.shrunk))}. It has to carry the ` +
      `numbers THIS run computed — that is what separates a compensation from a disclaimer — ` +
      `and it has to say it is not blocking, or the next person removes the check instead of ` +
      `the case.`,
  );

  // FAILURES FIRST, and `format` only on the success path — see
  // `probeLeftovers.proof.mjs` for the diagnosis this ordering prevents: a
  // failing case is not RECORDED, so formatting over a red run reports it as a
  // case that stopped running.
  if (failures.length > 0) {
    process.stderr.write(
      `\nTest-anchor proof — ${String(failures.length)} failure(s):\n\n` +
        `${failures.map((failure) => `  - ${failure}`).join('\n\n')}\n\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(roster.format('test-anchor case'));
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
