// @ts-check
/**
 * The emitted-source backtick scan: that it sees, that it refuses, and that it
 * tolerates what it must.
 *
 * The scan carries its own positive control and exits non-zero when blinded —
 * that case is here too, because the scan runs by hand and the proof runs in CI,
 * and neither covers the other's moment.
 *
 * **The load-bearing case is the third occurrence, verbatim.** A comment naming a
 * variable in backticks inside an emitted body is what happened on 2026-08-22,
 * in the file whose own header carried the rule against it. If the scan cannot
 * see that line, it closes nothing.
 */

import {
  CONTROL_FIXTURE,
  CONTROL_LINE,
  backtickViolations,
  emittedRegions,
  plainTemplatesInResearch,
  scannedFiles,
} from '../lib/emittedTemplates.mjs';

/** Written numerically, so this file cannot contain the thing it tests for. */
const TICK = String.fromCharCode(96);

let failures = 0;

/**
 * @param {string} name @param {boolean} condition @param {string} detail
 */
function check(name, condition, detail) {
  if (condition) {
    process.stdout.write(`  ok  ${name}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`  FAIL  ${name}\n      ${detail}\n`);
}

/** @param {string[]} lines */
const emitted = (lines) => lines.join('\n');

// --- The occurrence this exists for -----------------------------------------

const OCCURRENCE_THREE = emitted([
  `const BODY = String.raw${TICK}`,
  `  return {`,
  `    // ${TICK}resumed${TICK} is the thread's PREVIOUS suspend count.`,
  `    ordering,`,
  `  };`,
  `${TICK};`,
]);

{
  const { violations } = backtickViolations(OCCURRENCE_THREE);
  check(
    'POSITIVE CONTROL: occurrence 3 verbatim — a backticked variable in an embedded comment',
    violations.length === 1 && violations[0]?.line === 3,
    `expected one violation on line 3, got ${JSON.stringify(violations)}`,
  );
}

// --- What it must NOT report, so "flags everything" cannot pass --------------

{
  const { violations } = backtickViolations(CONTROL_FIXTURE);
  check(
    'the shipped control fixture yields exactly its one known violation',
    violations.length === 1 && violations[0]?.line === CONTROL_LINE,
    `expected one on line ${CONTROL_LINE}, got ${JSON.stringify(violations)}`,
  );
}

{
  // A check that flagged every backtick in the file would report this, and it is
  // the ordinary way this repository writes prose.
  const proseOnly = emitted([
    `/** Refused with ${TICK}EPERM${TICK}, which is a real finding worth naming. */`,
    `const NOTE = 1;`,
  ]);
  check(
    'prose backticks OUTSIDE any emitted template are not reported',
    backtickViolations(proseOnly).violations.length === 0,
    'the scan is reporting ordinary documentation and would be turned off within a day',
  );
}

{
  const singleLine = emitted([
    `const SAME_LINE = String.raw${TICK}[^\\n]*${TICK};`,
    `const AFTER = 2;`,
  ]);
  const { violations, unterminated } = backtickViolations(singleLine);
  check(
    'a single-line String.raw is neither scanned nor reported as unterminated',
    violations.length === 0 && unterminated.length === 0,
    `the regex fragments in blockEscapeResolvingWrites.mjs are not emitted source: ` +
      `${JSON.stringify({ violations, unterminated })}`,
  );
}

// --- Boundaries and the fail-closed case ------------------------------------

{
  const twoRegions = emitted([
    `const A = String.raw${TICK}`,
    `x`,
    `${TICK};`,
    `const between = ${TICK}ordinary template${TICK};`,
    `const B = String.raw${TICK}`,
    `y`,
    `${TICK};`,
  ]);
  const { violations } = backtickViolations(twoRegions);
  const { regions } = emittedRegions(twoRegions);
  check(
    'RESOLUTION: two regions are found separately, and the gap between them is not scanned',
    regions.length === 2 && violations.length === 0,
    `a scan that merged the regions would swallow line 4 into one span and report it — ` +
      `got ${regions.length} region(s), ${JSON.stringify(violations)}`,
  );
}

{
  const unterminatedSource = emitted([
    `const A = String.raw${TICK}`,
    `const oops = 1;`,
    `// no terminating line at all`,
  ]);
  const { unterminated } = backtickViolations(unterminatedSource);
  check(
    'an opener with no terminator is a FINDING, not a skip',
    unterminated.length === 1 && unterminated[0] === 1,
    `its region cannot be determined, so a clean result from it would be a guess: ` +
      `${JSON.stringify(unterminated)}`,
  );
}

{
  // The delimiter lines hold backticks by definition. Reporting them would make
  // every emitted template a violation and the check unusable.
  const minimal = emitted([`const A = String.raw${TICK}`, `plain`, `${TICK};`]);
  check(
    'the opening and closing lines are delimiters, not content',
    backtickViolations(minimal).violations.length === 0,
    'the scan is reporting its own boundary markers',
  );
}

// --- VV-1: the marker, and the escape hatch it would otherwise leave --------

{
  // The state of the tree when this check FIRST PASSED: four emitted bodies
  // written as plain templates, invisible to a scan keyed on String.raw.
  const unmarked = emitted([
    `const HOST = ${TICK}`,
    `const x = 1;`,
    `${TICK};`,
  ]);
  check(
    'a plain multi-line template in scripts/research/ is a finding',
    plainTemplatesInResearch(unmarked).length === 1,
    'without this, the backtick scan is escaped by dropping String.raw — which is not ' +
      'hypothetical: it was the tree state when the scan first reported clean (VV-1)',
  );
  check(
    'and a plain template carries NO backtick violation, which is exactly why it needs its own case',
    backtickViolations(unmarked).violations.length === 0,
    'if the backtick scan saw plain templates, the marker rule would be redundant — it does not',
  );
}

{
  const marked = emitted([`const HOST = String.raw${TICK}`, `const x = 1;`, `${TICK};`]);
  check(
    'CONTROL: a MARKED template is not reported as unmarked',
    plainTemplatesInResearch(marked).length === 0,
    'a rule that flags every template flags the correct ones too and separates nothing',
  );
}

{
  // The threat-model topic fixtures carry these deliberately, and an escaped
  // backtick closes nothing. Reporting it would be a false finding, and a false
  // finding in a guard is how the guard gets switched off.
  const escaped = emitted([
    `const BODY = String.raw${TICK}`,
    `// naming \\${TICK}fz_open_document\\${TICK} safely`,
    `${TICK};`,
  ]);
  check(
    'an ESCAPED backtick inside a region is not a violation',
    backtickViolations(escaped).violations.length === 0,
    `it is not a delimiter and closes nothing: ${JSON.stringify(backtickViolations(escaped).violations)}`,
  );
}

// --- The scan reaches real files --------------------------------------------

{
  const files = scannedFiles();
  check(
    'the file list is non-empty and excludes generated output',
    files.length > 0 && files.every((entry) => !entry.includes('/dist/')),
    `an empty file list is a broken lookup, not a clean tree: ${files.length} file(s)`,
  );
  check(
    'and it reaches the research scripts, which are where all three occurrences happened',
    files.includes('scripts/research/lowboxSpike.mjs'),
    'the scan does not cover the directory the class lives in',
  );
}

process.stdout.write(
  failures === 0
    ? `\n14 emitted-template cases passed.\n`
    : `\n${failures} emitted-template case(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
