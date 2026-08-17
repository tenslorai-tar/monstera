// @ts-check
/**
 * Proof for the withdrawn-phrase check (rule B2).
 *
 * This check unblocked Stage 0 and shipped with no proof at all. Every defect
 * found in it so far was found by running it against the real tree and noticing
 * the answer looked wrong — which only works for the instances somebody happens
 * to grep for, and three separate false negatives got through that way:
 *
 *   1. LITERAL BYTES. `× 3.7` in one document, `× ~3.7` in another.
 *   2. THE TABLE. Markdown tables have no blank lines, so paragraph-scoping let
 *      one row's "are withdrawn" exempt a different row's live assertion.
 *   3. THE LINE BREAK. Matching was per LINE while context came from the
 *      paragraph. This repository hard-wraps prose, so any phrase long enough to
 *      wrap escaped silently — and the longer the phrase, the likelier it wraps,
 *      which is exactly backwards.
 *
 * All three have a case below. They are one defect in three costumes: the unit a
 * claim is JUDGED in was not the unit it was MATCHED in.
 *
 * Usage: node scripts/lib/withdrawnPhrases.proof.mjs
 */

import { declaredPhrases, liveClaims, units } from './withdrawnPhrases.mjs';

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
 * @param {string} body
 * @param {ReadonlyArray<{ adr: string, phrase: string }>} declarations
 * @returns {ReturnType<typeof liveClaims>}
 */
function scan(body, declarations) {
  return liveClaims({ declarations, documents: new Map([['doc.md', body]]) });
}

const CEILING = [{ adr: 'adr.md', phrase: '~650 MB' }];
const MODEL = [{ adr: 'adr.md', phrase: 'stream bytes × 3.7' }];

// ---------------------------------------------------------------------------
// Declaration parsing.
// ---------------------------------------------------------------------------
{
  const adr = [
    '> **Withdrawn phrases:** `~650 MB` · `admission gate`',
    '> `machine-RAM table`',
    '>',
    '> That line is machine-read by `scripts/hooks/documentConsistency.mjs`,',
    '> which also reads `docs/FEATURES.md`.',
  ].join('\n');

  const phrases = declaredPhrases(adr);
  check(
    'phrases are read from the marker line and its continuation lines',
    phrases.join('|') === '~650 MB|admission gate|machine-RAM table',
    `got [${phrases.join(', ')}]`,
  );
  check(
    'the explanatory prose after the declaration is NOT swallowed',
    !phrases.some((phrase) => phrase.includes('.mjs') || phrase.includes('.md')),
    `got [${phrases.join(', ')}] — an earlier version captured to the end of the block, so every ` +
      `backticked path in the prose became a "withdrawn phrase" and five documents were reported ` +
      `for stating their own filenames.`,
  );
  check(
    'a document with no declaration yields none',
    declaredPhrases('# Just a document\n\nNothing declared here.\n').length === 0,
    'a false declaration would make every document fail for phrases nobody withdrew',
  );
}

// ---------------------------------------------------------------------------
// The basic pair: caught when asserted, excused when qualified.
// ---------------------------------------------------------------------------
{
  const asserted = 'The maximum supported document size is ~650 MB, enforced on open.';
  check(
    'a live claim on one line is caught',
    scan(asserted, CEILING).length === 1,
    'this is the base case; everything below is meaningless if it fails',
  );

  const qualified = 'The ~650 MB ceiling was withdrawn: it was a property of the WASM build.';
  check(
    'CONTROL: a claim qualified in the same sentence is not caught',
    scan(qualified, CEILING).length === 0,
    'a check that flags the record of a withdrawal as a claim of it flags every honest ' +
      'correction, and gets switched off',
  );
}

// ---------------------------------------------------------------------------
// 3. THE LINE BREAK — the defect this proof was written for.
// ---------------------------------------------------------------------------
{
  // Hard-wrapped as this repository wraps prose, with the break falling INSIDE
  // the declared phrase — between "stream" and "bytes".
  //
  // The first version of this fixture put the whole phrase on line two and only
  // looked wrapped. Mutating the matcher back to per-line showed it still
  // passing, which is how a case that proves nothing announces itself: it agrees
  // with the broken implementation and the fixed one alike.
  const wrapped = [
    'Content is the driver; file size is the wrong denominator. The model',
    'that fits every fixture is `(stream',
    'bytes × 3.7) + (object count × 4 KB)`, and admission reads both terms.',
  ].join('\n');

  check(
    'a claim WRAPPED across a line break is caught',
    scan(wrapped, MODEL).length === 1,
    `matching per line let this through in silence. Longer phrases wrap more often, so the ` +
      `check was weakest exactly where the declared claim was most specific.`,
  );

  const wrappedMidToken = [
    'The model that fits every fixture is `(stream bytes ×',
    '3.7) + (object count × 4 KB)`, and admission reads both terms.',
  ].join('\n');
  check(
    'caught when the break falls mid-token as well',
    scan(wrappedMidToken, MODEL).length === 1,
    'whitespace normalisation has to join the lines before matching, not after',
  );

  const wrappedAndQualified = [
    'The model that fits every fixture is `(stream bytes × 3.7) + (object',
    'count × 4 KB)`. Both it and the admission gate built on it were',
    'withdrawn the next day.',
  ].join('\n');
  check(
    'CONTROL: a wrapped claim qualified later in the same paragraph is not caught',
    scan(wrappedAndQualified, MODEL).length === 0,
    'the qualifier scope is the paragraph, so widening the match must not narrow the excuse',
  );

  const claims = scan(wrapped, MODEL);
  check(
    'the report points at the line where the match STARTS',
    claims[0]?.line === 2,
    // Line 2 holds "(stream", where the phrase begins; the rest is on line 3.
    `reported line ${claims[0]?.line}, expected 2. "Somewhere in this paragraph" is the kind of ` +
      `message that gets skimmed past.`,
  );
}

// ---------------------------------------------------------------------------
// 1. LITERAL BYTES — the tilde.
// ---------------------------------------------------------------------------
{
  const tilde = 'heap use is `(stream bytes × ~3.7) + (object count × ~4 KB)`, so admission reads both';
  check(
    'an approximation tilde does not let a claim through',
    scan(tilde, MODEL).length === 1,
    'the same claim is written both ways in this repository; literal matching missed one',
  );
}

// ---------------------------------------------------------------------------
// 2. THE TABLE — one row must not excuse another.
// ---------------------------------------------------------------------------
{
  const table = [
    '| Date | Amendment |',
    '|---|---|',
    '| 2026-08-16 | heap use is `(stream bytes × ~3.7) + (object count × ~4 KB)`. |',
    '| 2026-08-17 | the two-term memory model and admission gate are withdrawn. |',
  ].join('\n');

  const claims = scan(table, MODEL);
  check(
    'a table row asserting a withdrawn claim is caught despite a neighbouring row saying "withdrawn"',
    claims.length === 1 && claims[0]?.line === 3,
    `got ${claims.length} claim(s) at line(s) ${claims.map((c) => c.line).join(', ') || 'none'}. ` +
      `Tables have no blank lines, so paragraph scoping made the whole table one unit and the ` +
      `2026-08-17 row silently exempted the 2026-08-16 row.`,
  );

  check(
    'a table row that qualifies ITSELF is still excused',
    scan('| 2026-08-17 | the `stream bytes × 3.7` model is withdrawn. |', MODEL).length === 0,
    'scoping a row to itself must not make honest rows unrepresentable',
  );
}

// ---------------------------------------------------------------------------
// Structural: units, and the declaring ADR's exemption.
// ---------------------------------------------------------------------------
{
  const mixed = ['Para one line one.', 'para one line two.', '', '| a | b |', 'Para two.'].join('\n');
  const grouped = units(mixed);
  check(
    'units group wrapped prose and isolate table rows',
    grouped.length === 3 && grouped[0]?.lines.length === 2 && grouped[1]?.lines.length === 1,
    `got ${grouped.length} units with sizes [${grouped.map((u) => u.lines.length).join(', ')}]`,
  );

  const selfStated = liveClaims({
    declarations: CEILING,
    documents: new Map([['adr.md', 'The ceiling was ~650 MB when measured under WASM.']]),
  });
  check(
    'the declaring ADR is exempt from its own phrases',
    selfStated.length === 0,
    'it has to keep saying what it withdrew, and its evidence section deliberately leaves the ' +
      'original measurements standing',
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nWithdrawn-phrase proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} withdrawn-phrase cases passed.\n`);
