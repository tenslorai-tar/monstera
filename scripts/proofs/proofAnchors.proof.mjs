// @ts-check
/**
 * Proves the anchor scan can see, can refuse, and can tell a paid debt from an
 * unpaid one.
 *
 * `check:proofanchors` answers a question whose good news is an empty list, and
 * an empty list is also what a broken walk, a wrong pattern or an empty input
 * set produces (audit item 4b). Every case here feeds it something it must find.
 *
 * Usage: node scripts/proofs/proofAnchors.proof.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { classifyProofs, hasAnchor, UNANCHORED } from '../lib/proofAnchors.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const ROOT = repoRoot();

try {
  // -------------------------------------------------------------------------
  // 1. IT CAN SEE. Both anchor spellings, and a file with neither.
  // -------------------------------------------------------------------------
  check(
    'a roster is recognised as an anchor',
    hasAnchor('const roster = createRoster(failures, { cases: 4 });'),
    'the roster is the anchor this check exists to encourage, so failing to see it would ' +
      'report every anchored proof as owing one.',
  );

  check(
    "a hand-written length guard is recognised too, because shell.proof.mjs's is one",
    hasAnchor('if (RUNTIME_CASES.length !== 14) { throw new Error("…"); }'),
    'a proof that declares a list of case names and compares its length against a literal has ' +
      'the property this asks for. Recognising only `createRoster` would report a real anchor ' +
      'as missing and push its author toward a second one.',
  );

  check(
    'CONTROL: a file with a DERIVED total carries no anchor',
    !hasAnchor('process.stdout.write(`${passed.length} cases passed.\\n`);'),
    'without this the two cases above pass against a matcher that answers true for everything, ' +
      'which reports a clean repository whatever it is given — the reassuring answer arriving ' +
      'from a broken pattern.',
  );

  // -------------------------------------------------------------------------
  // 2. IT REFUSES AN EMPTY INPUT, which would otherwise report a clean result
  //    for every question it asks.
  // -------------------------------------------------------------------------
  let refused = '';
  try {
    classifyProofs([]);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check(
    'an empty proof set is refused rather than reported clean',
    /no proofs/u.test(refused),
    `got: ${refused || 'no error, so an empty walk produced a verdict'}. A directory that ` +
      `stopped matching would report no missing anchors and no stale entries, which is this ` +
      `check's own passing answer.`,
  );

  // -------------------------------------------------------------------------
  // 3. THE TWO DIRECTIONS, and they are not the same claim.
  // -------------------------------------------------------------------------
  const unlisted = classifyProofs([{ name: 'brandNew.proof.mjs', source: 'const x = 1;' }]);
  check(
    'a NEW proof with no anchor is reported',
    unlisted.missing.includes('brandNew.proof.mjs'),
    `missing: ${unlisted.missing.join(', ') || 'none'}. The failure to fear makes this set ` +
      `bigger — a proof arriving with no anchor — which is why the allowlist is hand-kept.`,
  );

  const listed = classifyProofs([{ name: UNANCHORED[0] ?? '', source: 'const x = 1;' }]);
  check(
    'CONTROL: a proof already on the allowlist is NOT reported',
    listed.missing.length === 0,
    `missing: ${listed.missing.join(', ')}. Without this the case above passes for a check ` +
      `that reports every proof, which would be red on the day it shipped and switched off ` +
      `on the day after.`,
  );

  const paid = classifyProofs([
    { name: UNANCHORED[0] ?? '', source: 'const roster = createRoster(failures, { cases: 1 });' },
  ]);
  check(
    'an allowlist entry that GAINED an anchor is reported as stale',
    paid.stale.includes(UNANCHORED[0] ?? ''),
    `stale: ${paid.stale.join(', ') || 'none'}. A list that keeps entries after they are paid ` +
      `stops being a debt: the count stops meaning anything and the next reader cannot tell a ` +
      `stale entry from a real one.`,
  );

  // -------------------------------------------------------------------------
  // 4. THE ALLOWLIST DESCRIBES THIS TREE, which is what stops it drifting into
  //    a list of names that no longer exist.
  // -------------------------------------------------------------------------
  const present = new Set(
    readdirSync(join(ROOT, 'scripts', 'proofs')).filter((name) => name.endsWith('.proof.mjs')),
  );
  const ghosts = UNANCHORED.filter((name) => !present.has(name));
  check(
    'every allowlist entry names a proof that exists',
    ghosts.length === 0,
    `named but absent: ${ghosts.join(', ')}. An entry for a deleted proof is a debt nobody can ` +
      `pay, and it inflates the count this check prints.`,
  );

  // AND THE INSTRUMENT REPORTS IT, which is a different claim from the one
  // above and is finding ZZZZZ-3. The case above asserts the FACT — this tree's
  // allowlist is clean — and it held while `classifyProofs` could not see the
  // state at all: an entry naming a deleted file matched nothing in a walk over
  // the proofs that exist, so it was neither `missing` nor `stale`.
  //
  // A proof that checks the fact directly lets the instrument stay blind to it
  // forever, because the fact keeps being true. Asserting the report is what
  // separates them.
  const ghost = classifyProofs([{ name: 'stillHere.proof.mjs', source: 'const x = 1;' }]);
  check(
    'an allowlist entry whose FILE is gone is reported',
    ghost.gone.length === UNANCHORED.length && ghost.gone.includes(UNANCHORED[0] ?? ''),
    `gone: ${ghost.gone.join(', ') || 'none'} against an allowlist of ` +
      `${String(UNANCHORED.length)}. Every entry is absent from this one-proof input, so all of ` +
      `them must be reported — a count short of that is a filter that only looks at what it ` +
      `was handed, which is the blindness itself.`,
  );

  void readFileSync;
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} proof-anchor case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('proof-anchor case'),
);
if (failures.length > 0) process.exitCode = 1;
