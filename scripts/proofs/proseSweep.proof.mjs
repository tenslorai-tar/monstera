// @ts-check
/**
 * Proof that the prose sweep sees what a line-scoped search cannot, and does
 * not see what a unit boundary separates (rule B2, items 4 and 4b).
 *
 * **The load-bearing case is the second one.** A control that a plain `grep`
 * would also find proves nothing about this instrument — it is the fixture the
 * defect handles correctly, and the whole reason this module exists over a grep
 * is the phrase that wraps. So the control text is asserted to be invisible to a
 * line-scoped matcher in the same breath as it is found by this one.
 *
 * Usage: node scripts/proofs/proseSweep.proof.mjs
 */

import { CONTROL_PATTERN, CONTROL_TEXT, findInUnits, sweep } from '../lib/proseSweep.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** A line-scoped matcher — what this module exists to replace. */
function lineScoped(/** @type {RegExp} */ pattern, /** @type {string} */ text) {
  return text.split('\n').filter((line) => pattern.test(line.toLowerCase())).length;
}

// ---------------------------------------------------------------------------
// It can see, and the control is one the thing it replaces would MISS.
// ---------------------------------------------------------------------------
check(
  'POSITIVE CONTROL: a phrase broken across a line break is found',
  findInUnits(CONTROL_PATTERN, CONTROL_TEXT).length === 1,
  `The sweep did not find its own control. Every way this can break — a unit builder that splits ` +
    `on lines, a normaliser that stops collapsing newlines — reports the same "no matches" a ` +
    `clean document set does.`,
);

check(
  'AND A LINE-SCOPED SEARCH MISSES IT, so the control separates the two',
  lineScoped(CONTROL_PATTERN, CONTROL_TEXT) === 0,
  `If a grep found this too, the control would be a fixture the defect also handles correctly — ` +
    `it would pass against a module that had quietly reverted to matching per line, which is the ` +
    `one failure this instrument exists to prevent.`,
);

// ---------------------------------------------------------------------------
// It separates. A matcher that joins everything finds every phrase.
// ---------------------------------------------------------------------------
check(
  'a phrase spanning a PARAGRAPH BREAK is not matched',
  findInUnits(/first second/u, 'alpha first\n\nsecond beta').length === 0,
  `A blank line ends the unit. Without that boundary this degenerates into matching the whole ` +
    `document as one string, which finds phrases that no paragraph actually states.`,
);

check(
  'a phrase spanning two TABLE ROWS is not matched',
  findInUnits(/alpha beta/u, '| row one alpha |\n| beta row two |').length === 0,
  `A table row is its own unit: its neighbours are different rows making different statements, ` +
    `not the continuation of this one. This is withdrawnPhrases.mjs' second false negative and ` +
    `the reason it owns the rule.`,
);

check(
  'and a phrase WITHIN one table row is matched',
  findInUnits(/row one alpha/u, '| row one alpha |\n| beta row two |').length === 1,
  `The control for the case above. Without it, a units() that returned nothing for tables would ` +
    `satisfy the separation case while seeing no table at all.`,
);

// ---------------------------------------------------------------------------
// Normalisation, which is what the caller has to write patterns against.
// ---------------------------------------------------------------------------
check(
  'matching is case-insensitive by normalisation, not by a flag',
  findInUnits(/mupdf runs contained/u, 'MuPDF Runs\nContained').length === 1,
  `The unit is lowercased before matching, so a lower-case pattern is the contract. A caller who ` +
    `writes a capitalised pattern would otherwise get silence, which is this instrument's ` +
    `reassuring answer.`,
);

check(
  'runs of whitespace collapse, so indentation and wrapping do not matter',
  findInUnits(/one two three/u, '    one   two\n\tthree').length === 1,
  `Indented list continuations are the ordinary shape in this repository's documents.`,
);

// ---------------------------------------------------------------------------
// It carries the control at RUN time, not only here, and its input set is real.
// ---------------------------------------------------------------------------
{
  const result = sweep(/this phrase appears in no tracked document at all/u);
  check(
    'the sweep carries its control itself, and scans a non-empty document set',
    result.controlFound && result.filesScanned > 1 && result.matches.length === 0,
    `control=${String(result.controlFound)} files=${String(result.filesScanned)} ` +
      `matches=${String(result.matches.length)}. The file count is asserted because an empty set ` +
      `returns "no matches" in exactly the words a clean sweep does — and the proof runs in CI ` +
      `while the instrument gets run by hand on the day somebody needs an answer.`,
  );
}

{
  // The other direction against the real tree, and it must be a HARD assertion:
  // "no matches" is this instrument's reassuring answer, so a case that tolerates
  // zero would pass for a sweep that opened no file at all.
  const result = sweep(/build the unit, normalise it, match against it/u);
  check(
    'CONTROL: a phrase this repository DOES state is found in the real document set',
    result.matches.length >= 1 && result.matches.every((match) => match.file.endsWith('.md')),
    `matches=${JSON.stringify(result.matches.map((match) => `${match.file}:${String(match.line)}`))}. ` +
      `The anchor is CLAUDE.md's quotation of withdrawnPhrases.mjs' own rule. If it has been ` +
      `reworded, re-anchor on another phrase rather than deleting this case — without it the ` +
      `empty-result case above is the only claim about the real tree, and it is satisfied by a ` +
      `sweep that reads nothing.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nProse sweep proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${String(passed.length)} prose sweep cases passed.\n`);
