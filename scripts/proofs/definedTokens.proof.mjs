// @ts-check
/**
 * Proof for the defined-token scan (`scripts/lib/definedTokens.mjs`).
 *
 * ## What a scan of this shape can fail at, and both directions are asserted
 *
 * A set difference has two failures and they pull opposite ways:
 *
 *   - it reports nothing, because the definition pattern matched everything —
 *     which is what a clean tree also prints, and this scan was written after a
 *     defect that shipped precisely because nothing looked;
 *   - it reports everything, because the definition pattern matched nothing.
 *     That passes any *can it see* control perfectly, so the fixture carries a
 *     valid reference the scan must NOT report.
 *
 * Both live in the module's own `CONTROL_FIXTURE`, so the running scan carries
 * them into every run rather than only into this file.
 *
 * ## And the near-misses the rule has no opinion about
 *
 * A `var()` with a fallback is valid whether or not the property exists — that
 * is what a fallback is for — and a reference inside a COMMENT is not a
 * reference. The second is not hypothetical: the scan's first run over this
 * repository reported `app.css`' own explanation of the `--space-3` defect.
 *
 * Usage: node scripts/proofs/definedTokens.proof.mjs
 */

import {
  CONTROL_MISSING,
  CONTROL_PRESENT,
  report,
  scan,
  scanTexts,
} from '../lib/definedTokens.mjs';
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
// THE TWO CONTROLS THE MODULE CARRIES. A run over no sources at all still has
// the fixture in it, which is what makes the scan's silence about a real tree
// worth something.
// ---------------------------------------------------------------------------
{
  const empty = scanTexts([]);
  check(
    'the fixture’s undefined reference is found, over no other input at all',
    empty.sawControl,
    `sawControl was ${String(empty.sawControl)}; the scan cannot locate ${CONTROL_MISSING}`,
  );
  check(
    'and the fixture’s DEFINED reference is not reported',
    !empty.reportedValidControl,
    `${CONTROL_PRESENT} was reported, so a scan flagging every reference would pass the ` +
      'control above while the rule was worthless',
  );
  check(
    'the fixture’s own violations never reach the report',
    empty.violations.length === 0,
    `${String(empty.violations.length)} violation(s) leaked from the control fixture into the ` +
      'result a caller reads',
  );
}

// ---------------------------------------------------------------------------
// THE RULE. A reference to something nothing declares is reported, at its line.
// ---------------------------------------------------------------------------
{
  const result = scanTexts([
    { file: 'a.css', text: ':root { --used: 1px; }\n.x { padding: var(--used); }' },
    { file: 'b.css', text: '.y { margin: 0; }\n.z { padding: var(--never-declared); }' },
  ]);
  check(
    'a reference to an undeclared property is reported',
    result.violations.length === 1 && result.violations[0]?.token === '--never-declared',
    `reported ${JSON.stringify(result.violations.map((entry) => entry.token))}`,
  );
  check(
    'at the line it is on, and in the file it is in',
    result.violations[0]?.file === 'b.css' && result.violations[0]?.line === 2,
    `reported ${result.violations[0]?.file ?? 'nothing'}:${String(result.violations[0]?.line ?? 0)}`,
  );
  check(
    'and a property declared in ANOTHER file is not reported',
    !result.violations.some((entry) => entry.token === '--used'),
    'a definition in a second file was not seen, so the scan is per-file rather than per-tree',
  );
}

// ---------------------------------------------------------------------------
// THE TWO NEAR-MISSES.
// ---------------------------------------------------------------------------
{
  const fallback = scanTexts([
    { file: 'c.css', text: '.x { padding: var(--absent, 4px); }' },
  ]);
  check(
    'a var() with a FALLBACK is not reported, because it is valid either way',
    fallback.violations.length === 0,
    `reported ${JSON.stringify(fallback.violations.map((entry) => entry.token))} — a rule that ` +
      'flagged these would push contributors into deleting fallbacks',
  );

  const commented = scanTexts([
    {
      file: 'd.css',
      // THE REAL FALSE POSITIVE, kept as its own case: the scan's first run
      // reported `app.css`' explanation of the defect it exists to catch.
      text: '/* it read var(--space-3) until it was fixed */\n.x { padding: var(--space-2); }\n:root { --space-2: 2px; }',
    },
  ]);
  check(
    'a reference inside a COMMENT is not a reference',
    commented.violations.length === 0,
    `reported ${JSON.stringify(commented.violations.map((entry) => entry.token))} — the file ` +
      'would be punished for documenting the defect',
  );
}

// ---------------------------------------------------------------------------
// The tree scan, and what it is allowed to claim.
// ---------------------------------------------------------------------------
{
  const result = scan();
  check(
    'the tree scan reports a SCOPE, so an empty run cannot read as a clean one',
    typeof result.uses === 'number' && report(result).length > 0,
    'the result carries no count of what it examined, so "no violations" from zero files and ' +
      'from a clean tree are the same sentence',
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nDefined-token scan proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      '\n\nAn undefined custom property invalidates the whole declaration and warns about ' +
      'nothing, so a scan that cannot separate the cases reads as coverage while a control ' +
      'ships with no padding.\n\n',
  );
  process.exit(1);
}

process.stdout.write(roster.format('defined-token case'));
