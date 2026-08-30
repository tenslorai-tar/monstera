// @ts-check
/**
 * Proof that the FEATURES row-length ratchet can SEE the rows it governs, and
 * that a row cannot escape it by being renamed (rule B2).
 *
 * ## The defect this exists for
 *
 * The ratchet keyed rows on their leading **bold** title. A row whose first
 * cell does not open in bold appeared in neither the before map nor the after
 * map, so it was compared with nothing and reported nothing. Measured on
 * 2026-08-30: `docs/FEATURES.md`'s design-substrate row grew from 390 words to
 * 498 in one edit and `check:docs` printed a clean pass; 43 rows were keyed
 * against 204 table lines, and five rows over the target were invisible.
 *
 * That is checklist item 4b's failure in a renderer rather than in a search.
 * *A row the key cannot see* and *a row that did not grow* are the same output,
 * and it is the output everybody wants — so nothing about reading it prompts a
 * second look.
 *
 * ## Why the cases are written against the JUDGEMENT and not the helpers
 *
 * `judgeRowLengths` is the whole decision over two blobs. Testing
 * `featureRowWords` alone would put the thorough coverage on the helper and
 * leave the floor comparison — the part that decides — inside a feeling of
 * coverage.
 *
 * ## The load-bearing case
 *
 * Case 2. Every other case would pass against a key that reads only bold
 * titles, because every other fixture happens to be bold. The fixture that
 * separates the fixed ratchet from the broken one is a row with **no** bold
 * opening, and the case asserts what the broken version printed for that exact
 * input: nothing.
 *
 * Usage: node scripts/proofs/rowLengthRatchet.proof.mjs
 */

import {
  featureRowKey,
  featureRowWords,
  judgeRowLengths,
  pairRenamedRows,
} from '../hooks/documentConsistency.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** Words enough to sit over the 250-word floor, and countable. */
const FILLER = 'padding '.repeat(300).trim();

/**
 * Openings long enough that appending a body does not change the key.
 *
 * A ROW'S KEY IS ITS FIRST EIGHT WORDS, so a fixture whose opening is shorter
 * than that has a key made partly of its body — and every growth case would
 * then be testing the RENAME path rather than the plain comparison. Caught by
 * mutation: deleting the rename pairing reddened the two cases that exist to
 * test growth, which is how a fixture says it is measuring something else.
 */
const SAVE = '**Save the document** to disk without losing any work at all';
const SUBSTRATE = 'Design substrate: tokens, lint rules, four primitives and a guide';

/**
 * A table under one heading.
 *
 * @param {string[]} rows
 * @returns {string}
 */
function table(rows) {
  return ['## Stage 0 — architecture substrate', '', '| Item | Status |', '|---|---|', ...rows].join(
    '\n',
  );
}

// ---------------------------------------------------------------------------
// 1. A bold row that grew past the floor is still reported.
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SAVE} short body | **done** |`]);
  const after = table([`| ${SAVE} ${FILLER} | **done** |`]);
  const found = judgeRowLengths(before, after);
  check(
    'a bolded row that grew past the floor is reported',
    found.length === 1 && found[0]?.includes('grew from') === true,
    `${String(found.length)} failure(s). This is the case the ratchet already caught before ` +
      `2026-08-30, and it is here so the fix is shown not to have traded one blindness for ` +
      `another.`,
  );
}

// ---------------------------------------------------------------------------
// 2. THE LOAD-BEARING CASE: an UNBOLDED row is seen.
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SUBSTRATE} short body | **partly** |`]);
  const after = table([`| ${SUBSTRATE} ${FILLER} | **partly** |`]);
  const found = judgeRowLengths(before, after);

  // The broken key, spelt out here rather than described: a row is keyed only
  // when its first cell opens in bold. Asserting that THIS fixture produces no
  // key under it is what makes the case separate the fix from the defect —
  // without it the case passes against the version that shipped the bug.
  const boldOnly = /^\|\s*\*\*(.+?)\*\*/u.test(`| ${SUBSTRATE} short body | **partly** |`);

  check(
    'an UNBOLDED row that grew past the floor is reported, and the old key could not see it',
    found.length === 1 && !boldOnly,
    `${String(found.length)} failure(s); the bold-only key ${boldOnly ? 'DID' : 'did not'} match ` +
      `this row. Both halves matter: the first is the fix, and the second is what stops this ` +
      `case passing against the code that had the defect.`,
  );
}

// ---------------------------------------------------------------------------
// 3. Growth that stays under the floor is not reported.
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SUBSTRATE} short body | **done** |`]);
  const after = table([`| ${SUBSTRATE} ${'word '.repeat(40).trim()} | **done** |`]);
  check(
    'a row that grew but stays under the floor is not reported',
    judgeRowLengths(before, after).length === 0,
    `the ratchet is a floor and not a freeze: a correction must be able to grow a short row. ` +
      `A rule that reported this is one people learn to read past.`,
  );
}

// ---------------------------------------------------------------------------
// 4. A long row that SHRANK is not reported.
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SAVE} ${FILLER} | **done** |`]);
  const after = table([`| ${SAVE} trimmed to almost nothing | **done** |`]);
  check(
    'a long row that shrank is not reported',
    judgeRowLengths(before, after).length === 0,
    `trimming is the action this rule exists to provoke, so it must never be what turns it red.`,
  );
}

// ---------------------------------------------------------------------------
// 5. A RETITLED row is paired and judged. (Ruling 3's hole.)
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SAVE} short body | **done** |`]);
  const after = table([`| **Saving a document** from end to end with nothing lost ${FILLER} | **done** |`]);
  const found = judgeRowLengths(before, after);
  check(
    'a row whose opening was rewritten is paired with the row it replaced, and judged',
    found.length === 1 && found[0]?.includes('grew from') === true,
    `${String(found.length)} failure(s). Unpaired, a retitled row reads as NEW — and a new row ` +
      `is deliberately not judged, so rewriting the first words would be a way past the target ` +
      `with the check green. That is how a full stop moved into a title once made a row pass.`,
  );
}

// ---------------------------------------------------------------------------
// 6. A genuinely new row is still not judged.
// ---------------------------------------------------------------------------
{
  const before = table([`| ${SAVE} short body | **done** |`]);
  const after = table([
    `| ${SAVE} short body | **done** |`,
    `| **A brand new row** that nothing in the previous blob names ${FILLER} | **partly** |`,
  ]);
  check(
    'CONTROL: a row that is genuinely new is not judged',
    judgeRowLengths(before, after).length === 0,
    `a new row has no previous length, so "grew" has no meaning for it. Without this control ` +
      `the pairing above could be satisfied by judging everything unmatched, which would make ` +
      `case 5 pass for the wrong reason.`,
  );
}

// ---------------------------------------------------------------------------
// 7. Two renames in one commit are REFUSED rather than skipped.
// ---------------------------------------------------------------------------
{
  const before = table([
    '| **Alpha row here** short | **done** |',
    '| **Beta row here** short | **done** |',
  ]);
  const after = table([
    `| **Alpha renamed to this** ${FILLER} | **done** |`,
    `| **Beta renamed to that** ${FILLER} | **done** |`,
  ]);
  const found = judgeRowLengths(before, after);
  check(
    'two renames in one commit are refused as ambiguous, not silently skipped',
    found.length === 1 && found[0]?.includes('refuses to guess') === true,
    `${String(found.length)} failure(s): ${found[0]?.slice(0, 80) ?? 'none'}. Pairing by order ` +
      `or by size would be the rule inventing the comparison it exists to make. "I cannot tell" ` +
      `is the honest output, and it is red rather than green because the silent version is how ` +
      `this hole worked in the first place.`,
  );
}

// ---------------------------------------------------------------------------
// 8. Two rows in one section sharing an opening THROW.
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    featureRowWords(
      // The first EIGHT words are what the key is, so the fixture has to share
      // eight and then diverge — two rows that differ inside the key are not a
      // collision, and a fixture the collision guard would let through proves
      // nothing about it.
      table([
        '| Typewriter tool one two three four five, and then this | — |',
        '| Typewriter tool one two three four five, and then that | — |',
      ]),
    );
  } catch {
    threw = true;
  }
  check(
    'two rows in one section with the same opening throw rather than overwrite',
    threw,
    `a silent overwrite would make one row's length stand in for the other's — the same ` +
      `blindness this proof exists for, one row narrower.`,
  );
}

// ---------------------------------------------------------------------------
// 9. CONTROL: the same opening under two DIFFERENT headings is fine.
// ---------------------------------------------------------------------------
{
  const document = [
    '## Annotations',
    '',
    '| Feature | Status |',
    '|---|---|',
    '| Typewriter | — |',
    '',
    '## Tools',
    '',
    '| Feature | Status |',
    '|---|---|',
    '| Typewriter | — |',
  ].join('\n');
  let threw = false;
  try {
    featureRowWords(document);
  } catch {
    threw = true;
  }
  check(
    'CONTROL: the same row name under two headings is not a collision',
    !threw,
    `docs/FEATURES.md really does carry "Typewriter" in two tables and neither is wrong. ` +
      `Without this the collision guard could be satisfied by refusing every duplicate name, ` +
      `which would make the whole check unrunnable against the document it governs.`,
  );
}

// ---------------------------------------------------------------------------
// 10. A header row is not a row, and a separator is not either.
// ---------------------------------------------------------------------------
{
  const keys = [...featureRowWords(table(['| Only one real row here | **done** |'])).keys()];
  check(
    'the header and separator lines are not keyed as rows',
    keys.length === 1 && featureRowKey('|---|---|') === '' && pairRenamedRows(
      new Map(),
      new Map(),
    ).ambiguous === null,
    `${String(keys.length)} key(s): ${keys.join(' | ')}. Every table in the document heads its ` +
      `first column identically, so keying headers collides on the second table and takes the ` +
      `check down — which is a loud failure, and the reason it is excluded structurally rather ` +
      `than by matching the word.`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} row-length-ratchet case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('row-length-ratchet case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
