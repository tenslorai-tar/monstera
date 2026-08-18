// @ts-check
/**
 * Proof that the Stage 0 performance gate follows the budgets §9.17 declares
 * (rule B2, ADR-0012).
 *
 * **No limit is written down here.** That is the point of the proof, not a
 * stylistic preference: restating "1.5x" and "1.5 GB" in this file would be a
 * fourth copy of the numbers — after the invariant, the parser and the gate —
 * sitting in the one place people forget to look when a budget changes. A proof
 * that carries its own copy of the thing under test passes forever while the
 * document says something else.
 *
 * So every case works the way `proof:budgets` already does with 1.5x against
 * 1.6x: mutate the declared line, and require the gate's verdict to move with
 * it. The thresholds are derived from what was actually measured — a limit a
 * hair below the observed figure must fail, the same limit a hair above must
 * pass — so the proof states no number of its own and still pins the behaviour
 * exactly.
 *
 * Usage: node scripts/proofs/perfBudget.proof.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { SOURCE_FILE } from '../lib/memoryBudgets.mjs';
import { runBudgetGate } from '../perf/budgetGate.mjs';
import { formatBytes } from '../perf/peakRss.mjs';

const ROOT = repoRoot();
const REAL = readFileSync(join(ROOT, SOURCE_FILE), 'utf8');
const MB = 1024 ** 2;

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
 * Rewrites the declared line's entries, leaving the rest of the document alone.
 *
 * @param {ReadonlyArray<string>} entries
 * @returns {string}
 */
function withEntries(entries) {
  return REAL.replace(
    /(^\s*>\s*\*\*Memory budgets:\*\*)[\s\S]*?(?=\n\s*>\s*\n)/mu,
    `$1 ${entries.map((entry) => `\`${entry}\``).join(' · ')}`,
  );
}

// ---------------------------------------------------------------------------
// The control: against the real invariant, the gate passes and reports the
// renderer as deliberately unasserted.
// ---------------------------------------------------------------------------
const baseline = runBudgetGate();

check(
  'the gate passes against the budgets the invariant actually declares',
  baseline.results.every((result) => result.withinMultiplier && result.withinAbsolute),
  baseline.results
    .map((r) => `${r.role}: ${formatBytes(r.peakBytes)} = ${r.ratio.toFixed(2)}x of ${formatBytes(baseline.fixture.bytes)}`)
    .join('; '),
);

check(
  'both asserted roles were actually measured',
  baseline.results.length === 2 && baseline.results.every((result) => result.peakBytes > 0),
  `measured: ${baseline.results.map((r) => r.role).join(', ')}`,
);

check(
  'the renderer is reported unasserted rather than silently passed',
  baseline.unasserted.some((entry) => entry.role === 'renderer' && /provisional/iu.test(entry.reason)),
  `unasserted: ${JSON.stringify(baseline.unasserted)}. A gate that skips a declared budget while ` +
    `printing success is the failure this whole path exists to avoid.`,
);

// ---------------------------------------------------------------------------
// The gate follows the line. For each asserted role, a limit derived from what
// that role actually used must flip the verdict in both directions.
// ---------------------------------------------------------------------------
for (const measured of baseline.results) {
  const others = baseline.results
    .filter((result) => result.role !== measured.role)
    // Left generous, so only the role under test can decide the verdict.
    .map((result) => `${result.role} = ${String(Math.ceil(result.ratio) + 10)}x, 64 GB`);

  const tooTight = (measured.ratio - 0.05).toFixed(2);
  const justEnough = (measured.ratio + 0.05).toFixed(2);

  {
    const gate = runBudgetGate({
      budgetsText: withEntries([`${measured.role} = ${tooTight}x, 64 GB`, ...others, 'renderer = provisional']),
    });
    const role = gate.results.find((result) => result.role === measured.role);
    check(
      `${measured.role}: a multiplier just below what it used turns the gate red`,
      role?.withinMultiplier === false,
      `declared ${tooTight}x against a measured ${measured.ratio.toFixed(2)}x, and the gate still ` +
        `passed. The gate is not reading the line.`,
    );
  }

  {
    const gate = runBudgetGate({
      budgetsText: withEntries([`${measured.role} = ${justEnough}x, 64 GB`, ...others, 'renderer = provisional']),
    });
    const role = gate.results.find((result) => result.role === measured.role);
    check(
      `${measured.role}: and a multiplier just above it passes`,
      role?.withinMultiplier === true,
      `declared ${justEnough}x against a measured ${measured.ratio.toFixed(2)}x and the gate failed. ` +
        `Without this the case above is satisfied by a gate that always fails.`,
    );
  }

  {
    // The absolute term is a separate limit and needs its own case: a gate that
    // only ever consulted the multiplier would pass every case above.
    const belowPeakMB = Math.max(1, Math.floor(measured.peakBytes / MB) - 8);
    const gate = runBudgetGate({
      budgetsText: withEntries([
        `${measured.role} = ${String(Math.ceil(measured.ratio) + 10)}x, ${String(belowPeakMB)} MB`,
        ...others,
        'renderer = provisional',
      ]),
    });
    const role = gate.results.find((result) => result.role === measured.role);
    check(
      `${measured.role}: an absolute ceiling below its peak turns the gate red, with the multiplier generous`,
      role?.withinAbsolute === false && role.withinMultiplier === true,
      `declared ${String(belowPeakMB)} MB against a measured ${formatBytes(measured.peakBytes)}; ` +
        `withinAbsolute=${String(role?.withinAbsolute)} withinMultiplier=${String(role?.withinMultiplier)}. ` +
        `The absolute term must be consulted independently of the ratio.`,
    );
  }
}

// ---------------------------------------------------------------------------
// A budget the invariant stops declaring is not a budget that stops applying.
// ---------------------------------------------------------------------------
{
  const main = baseline.results.find((result) => result.role === 'main');
  const generous = `main = ${String(Math.ceil(main?.ratio ?? 1) + 10)}x, 64 GB`;

  let threw = false;
  let message = '';
  try {
    runBudgetGate({ budgetsText: withEntries([generous, 'renderer = provisional']) });
  } catch (error) {
    threw = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    'dropping mupdf-host from the line fails rather than measuring one role',
    threw && /no budget declared for mupdf-host/u.test(message),
    `Got: ${message.slice(0, 200)}. Silently measuring fewer processes than the invariant names is ` +
      `how a process stops being budgeted.`,
  );
}

// ---------------------------------------------------------------------------
// The proof states no limits of its own.
// ---------------------------------------------------------------------------
{
  // Checked mechanically, because "I did not hardcode the numbers" is exactly
  // the kind of claim that decays on the next edit.
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('const ROOT ='));
  const declared = [...body.matchAll(/(\d+(?:\.\d+)?)\s*(?:x|GB\b)/gu)].map((match) => match[0]);
  // `64 GB` is a deliberately unreachable stand-in used to neutralise the term
  // not under test in a case; it is not a budget and is not asserted against.
  const suspicious = declared.filter((entry) => !/^64 GB$/u.test(entry));
  check(
    'this proof states no budget of its own',
    suspicious.length === 0,
    `found literals that look like limits: ${suspicious.join(', ')}. Every threshold here must be ` +
      `derived from what was measured, or the proof becomes a fourth copy of the numbers.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nPerformance-budget gate proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} performance-budget gate cases passed.\n`);
