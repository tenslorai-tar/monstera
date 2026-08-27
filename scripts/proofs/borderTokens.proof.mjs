// @ts-check
/**
 * Proof for the border-token scan (ADR-0003's rule, `scripts/lib/borderTokens.mjs`).
 *
 * ## Why this file carries the whole burden today
 *
 * There is no component CSS in this repository yet, so the scan examines zero
 * declarations and prints NOTHING TO SCAN. That is the honest state and it is
 * also the state in which a broken scan is indistinguishable from a working
 * one — so every claim about whether the rule can SEE lives here, on fixtures,
 * where it does not depend on a tree that has not been written.
 *
 * ## The cases that separate
 *
 * A scan for this rule has one failure that deletes it and one that hides
 * defects, and they pull in opposite directions:
 *
 *   - matching `--border` as a SUBSTRING reports `--border-control`, the correct
 *     token, on every properly written control. A check that fires on correct
 *     code is a check somebody turns off within a day.
 *   - requiring the marker to say something reduces to requiring a comment, and
 *     an empty `decorative:` would satisfy a rule that only looked for the word.
 *
 * Both directions are asserted. So is the near-miss where `var(--border)` is a
 * BACKGROUND rather than a boundary, which the rule has no opinion about.
 *
 * Usage: node scripts/proofs/borderTokens.proof.mjs
 */

import { CONTROL_FIXTURE, report, scan, scanCss } from '../lib/borderTokens.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

// ---------------------------------------------------------------------------
// THE POSITIVE CONTROL. The fixture the module ships must produce exactly one
// violation, and it must be the right line.
// ---------------------------------------------------------------------------
{
  const result = scanCss('fixture.css', CONTROL_FIXTURE);

  check(
    'the control fixture yields exactly one violation',
    result.violations.length === 1,
    `got ${String(result.violations.length)}: ${JSON.stringify(result.violations.map((v) => v.text))}. ` +
      `The fixture carries one unmarked decorative border and four lines that must not fire.`,
  );

  check(
    '  ...and it is the slider track, not one of the near-misses',
    result.violations[0]?.text.includes('slider__track') === true,
    `reported ${JSON.stringify(result.violations[0]?.text)}. Reporting the right COUNT from the ` +
      `wrong line is a scan that agrees with the answer by luck.`,
  );

  check(
    'CONTROL: --border-control does not match --border as a substring',
    !result.violations.some((violation) => violation.text.includes('--border-control')),
    `the correct token was reported as a violation. This is the failure that gets the check ` +
      `deleted: it fires on every properly written control, so the first contributor to meet it ` +
      `concludes the rule is broken — and they are right.`,
  );

  check(
    'CONTROL: a marked decorative border is accepted and counted',
    result.marked === 2,
    `counted ${String(result.marked)} marked, expected 2. If marking did not register, the case ` +
      `above passes for the wrong reason — nothing was accepted, it was simply never examined.`,
  );

  check(
    'CONTROL: var(--border) as a BACKGROUND is not a boundary and is not reported',
    !result.violations.some((violation) => violation.text.includes('background')),
    `a background painted with the token was reported. The rule is about boundaries; widening ` +
      `it to every use of the token would ban the token.`,
  );

  check(
    'the fixture exercises more declarations than it violates',
    result.declarations >= 4 && result.violations.length < result.declarations,
    `${String(result.declarations)} declaration(s) examined against ` +
      `${String(result.violations.length)} violation(s). A fixture where everything is a ` +
      `violation cannot show the scan discriminating.`,
  );
}

// ---------------------------------------------------------------------------
// The marker has to carry a REASON. A rule satisfied by the bare word reduces
// to "write a comment", which is the ceremony without the thinking.
// ---------------------------------------------------------------------------
{
  const bare = scanCss('bare.css', '.rail { border: 1px solid var(--border); } /* decorative: */');
  check(
    'a marker with no reason after it does NOT satisfy the rule',
    bare.violations.length === 1,
    `an empty \`decorative:\` was accepted. The marker exists so a reviewer can read WHY this ` +
      `boundary is not a control's; without the reason it is a keyword someone pastes.`,
  );

  const outline = scanCss('outline.css', '.tab:focus { outline: 2px solid var(--border-soft); }');
  check(
    '`outline` is a boundary too, so a focus ring cannot use the decorative token',
    outline.violations.length === 1,
    `outline was not examined. A focus ring is the most control-like boundary there is, and a ` +
      `rule covering only \`border\` is evaded by one property name.`,
  );
}

// ---------------------------------------------------------------------------
// The tree scan, and what it is allowed to claim today.
// ---------------------------------------------------------------------------
{
  const result = scan();
  check(
    'the tree scan reports a SCOPE, so an empty run cannot read as a clean one',
    typeof result.declarationsExamined === 'number' && report(result).length > 0,
    `the result carries no count of what it examined. "No violations" from zero files and ` +
      `"no violations" from a clean tree are the same sentence otherwise, and today this ` +
      `repository is the first of those.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nBorder-token scan proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nADR-0003 calls this the one token decision a contributor gets wrong by default, so a ` +
      `scan that cannot separate the cases is worse than none: it reads as coverage.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(roster.format('border-token case'));
