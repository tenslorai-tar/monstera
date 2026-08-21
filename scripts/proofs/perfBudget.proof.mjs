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
import { runAllShapes, runBudgetGate } from '../perf/budgetGate.mjs';
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
const shapes = runAllShapes();
const baseline = shapes[0] ?? runBudgetGate();

for (const run of shapes) {
  check(
    `${run.shape}: the gate passes against the budgets the invariant actually declares`,
    run.results.every((result) => result.withinMultiplier && result.withinAbsolute),
    run.results
      .map((r) => `${r.role}: ${formatBytes(r.peakBytes)} - ${formatBytes(r.baselineBytes)} = ${r.ratio.toFixed(2)}x of ${formatBytes(run.fixture.bytes)}`)
      .join('; '),
  );
}

check(
  'both content shapes were measured, not just the easy one',
  shapes.length === 2 && shapes.some((run) => run.shape === 'object-dense'),
  `shapes run: ${shapes.map((run) => run.shape).join(', ')}. The two shapes give different ` +
    `figures for the same role, so one is not evidence about the other.`,
);

check(
  'the dense shape costs the host measurably more per byte than the image shape',
  (() => {
    /** @param {string} shape @returns {number} */
    const host = (shape) =>
      shapes.find((run) => run.shape === shape)?.results.find((r) => r.role === 'mupdf-host')?.ratio ?? 0;
    return host('object-dense') > host('image-heavy');
  })(),
  `If these came back equal the two fixtures are not actually different shapes, and running both ` +
    `proves nothing beyond running one.`,
);

check(
  'every asserted role was actually measured, INCLUDING main through the real service',
  baseline.results.length === 3 &&
    baseline.results.some((result) => result.role === 'main-service') &&
    baseline.results.every((result) => result.peakBytes > 0),
  `measured: ${baseline.results.map((r) => r.role).join(', ')}\n      ` +
    `The count is pinned so a role that stopped being measured is loud rather than absent. ` +
    `\`main-service\` is named as well as counted because it is the only role that exercises ` +
    `the retention IMPLEMENTATION — \`main\` is a model of what main should cost, and a second ` +
    `live reference inside DocumentService is invisible to it (finding LL-4). Verified by ` +
    `leaking one copy inside the service: this role doubled and breached on both content ` +
    `shapes while the model role was unmoved and passed. The figures are in the commit that ` +
    `added this role, not here — this file states no limits of its own, and its own guard ` +
    `rejects a literal shaped like one.`,
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
  // BUDGET NAMES, not role labels, and deduplicated — `main` is measured twice
  // and a declaration line naming it twice is not a line the parser accepts.
  // This built one for `main-service` when the two were assumed identical, and
  // the parser refused it as a process nobody had declared, which is that
  // check working.
  const others = [
    ...new Set(
      baseline.results
        .filter((result) => result.budget !== measured.budget)
        // Left generous, so only the role under test can decide the verdict.
        .map(
          (result) => `${result.budget} = ${String(Math.ceil(result.ratio) + 10)}x, 64 GB, base 32 GB`,
        ),
    ),
  ];

  const tooTight = (measured.ratio - 0.05).toFixed(2);
  const justEnough = (measured.ratio + 0.05).toFixed(2);

  {
    const gate = runBudgetGate({
      budgetsText: withEntries([`${measured.budget} = ${tooTight}x, 64 GB, base 32 GB`, ...others, 'renderer = provisional']),
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
      budgetsText: withEntries([`${measured.budget} = ${justEnough}x, 64 GB, base 32 GB`, ...others, 'renderer = provisional']),
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
    // The baseline term. Its whole reason for existing is that the other two
    // cannot see a regression in it — the multiple is taken above the baseline,
    // so an inflated fixed cost raises numerator and subtrahend together and
    // the ratio does not move. Both directions, because a gate that always
    // failed on the baseline would satisfy the tightening case alone.
    const belowBaselineMB = Math.max(1, Math.floor(measured.baselineBytes / MB) - 4);
    const aboveBaselineMB = Math.ceil(measured.baselineBytes / MB) + 4;
    const generousOthers = [...others, 'renderer = provisional'];

    const tight = runBudgetGate({
      documentPath: baseline.fixture.path,
      documentBytes: baseline.fixture.bytes,
      budgetsText: withEntries([
        `${measured.budget} = ${String(Math.ceil(measured.ratio) + 10)}x, 64 GB, base ${String(belowBaselineMB)} MB`,
        ...generousOthers,
      ]),
    });
    const tightRole = tight.results.find((result) => result.role === measured.role);
    check(
      `${measured.role}: a baseline budget below its measured fixed cost turns the gate red`,
      tightRole?.withinBaseline === false && tightRole.withinMultiplier === true,
      `declared base ${String(belowBaselineMB)} MB against a measured ` +
        `${formatBytes(measured.baselineBytes)}; withinBaseline=${String(tightRole?.withinBaseline)}. ` +
        `Without this the baseline is measured, subtracted and asserted by nothing — a number in a ` +
        `detail string, which is the H2 defect.`,
    );

    const loose = runBudgetGate({
      documentPath: baseline.fixture.path,
      documentBytes: baseline.fixture.bytes,
      budgetsText: withEntries([
        `${measured.budget} = ${String(Math.ceil(measured.ratio) + 10)}x, 64 GB, base ${String(aboveBaselineMB)} MB`,
        ...generousOthers,
      ]),
    });
    check(
      `${measured.role}: and a baseline budget just above it passes`,
      loose.results.find((result) => result.role === measured.role)?.withinBaseline === true,
      `declared base ${String(aboveBaselineMB)} MB against a measured ` +
        `${formatBytes(measured.baselineBytes)} and the gate still failed.`,
    );
  }

  {
    // The absolute term is a separate limit and needs its own case: a gate that
    // only ever consulted the multiplier would pass every case above.
    const belowPeakMB = Math.max(1, Math.floor(measured.peakBytes / MB) - 8);
    const gate = runBudgetGate({
      budgetsText: withEntries([
        `${measured.budget} = ${String(Math.ceil(measured.ratio) + 10)}x, ${String(belowPeakMB)} MB, ` +
          `base ${String(Math.max(1, Math.floor(measured.baselineBytes / MB) - 4))} MB`,
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
  const generous = `main = ${String(Math.ceil(main?.ratio ?? 1) + 10)}x, 64 GB, base 32 GB`;

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
  // `64 GB` and `32 GB` are deliberately unreachable stand-ins used to
  // neutralise whichever terms are not under test in a case, so that only one
  // limit can decide the verdict. They are not budgets and nothing is asserted
  // against them; every threshold that IS asserted against is computed from a
  // measurement above.
  const suspicious = declared.filter((entry) => !/^(?:64|32) GB$/u.test(entry));
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
