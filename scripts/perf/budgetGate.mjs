// @ts-check
/**
 * The Stage 0 performance budget assertion.
 *
 * Measures each role's process in isolation against the budget invariant §9.17
 * states for it. **Every limit is read from the declared line** — nothing here
 * defines a multiplier or a ceiling, and there is no constant to drift from the
 * document (ADR-0012).
 *
 * ## What is asserted, and what is not
 *
 * `main` and `mupdf-host` are asserted. `renderer` is declared provisional in
 * the invariant and asking for its limit throws, so this reports it as
 * deliberately unasserted rather than passing it silently — an assertion that
 * covered two processes out of three while printing success is the failure the
 * whole path is built to avoid.
 *
 * These are the ROLES, in their own processes, running the code that will run in
 * Electron's — not yet Electron's processes, which do not exist. Electron's own
 * baseline is not in these figures, so this must be re-measured when the utility
 * process lands rather than assumed to carry over.
 *
 * ## The instrument
 *
 * Peak RSS from the kernel, taken in the measured process and reported out;
 * never a sampler, which cannot fire while a synchronous FFI call holds the
 * event loop and once reported 63 MB for a walk that cost 526 MB. See
 * `peakRss.mjs`, and `proof:peakrss` for the resolution test it passed before
 * being trusted with this.
 *
 * Usage: node scripts/perf/budgetGate.mjs [--json]
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { assertableBudget, memoryBudgets } from '../lib/memoryBudgets.mjs';
import { buildLargeFixture } from './largeFixture.mjs';
import { formatBytes, measurePeak } from './peakRss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = repoRoot();

/**
 * @typedef {{
 *   role: string,
 *   peakBytes: number,
 *   ratio: number,
 *   multiplierLimit: number,
 *   absoluteLimit: number,
 *   absoluteText: string,
 *   withinMultiplier: boolean,
 *   withinAbsolute: boolean,
 *   detail: Record<string, unknown>,
 * }} RoleResult
 */

/**
 * @param {{ documentPath?: string, root?: string, budgetsText?: string }} [options]
 *   `budgetsText` substitutes the document the budgets are parsed from. It
 *   exists for the proof, which mutates the declared line and requires the gate
 *   to follow it — the alternative was a proof restating the limits, which would
 *   be a fourth copy of the numbers in the place people look last.
 * @returns {{ fixture: { path: string, bytes: number }, results: RoleResult[], unasserted: Array<{ role: string, reason: string }> }}
 */
export function runBudgetGate(options = {}) {
  const root = options.root ?? ROOT;
  const budgets = memoryBudgets(
    options.budgetsText === undefined ? { root } : { text: options.budgetsText },
  );

  const fixture =
    options.documentPath === undefined
      ? buildLargeFixture({ root })
      : { path: options.documentPath, bytes: 0 };

  const documentBytes =
    fixture.bytes > 0 ? fixture.bytes : Number(process.env['MONSTERA_PERF_BYTES'] ?? '0');

  /** @type {Array<{ role: string, script: string }>} */
  const roles = [
    { role: 'main', script: join(HERE, 'roleMain.mjs') },
    { role: 'mupdf-host', script: join(HERE, 'roleMupdfHost.mjs') },
  ];

  /** @type {RoleResult[]} */
  const results = [];
  for (const { role, script } of roles) {
    const budget = assertableBudget(budgets, role);
    const measurement = measurePeak(script, [fixture.path]);
    const ratio = measurement.peakRssBytes / documentBytes;
    results.push({
      role,
      peakBytes: measurement.peakRssBytes,
      ratio,
      multiplierLimit: budget.multiplier,
      absoluteLimit: budget.absoluteBytes,
      absoluteText: budget.absoluteText,
      withinMultiplier: ratio <= budget.multiplier,
      withinAbsolute: measurement.peakRssBytes <= budget.absoluteBytes,
      detail: measurement.detail,
    });
  }

  /** @type {Array<{ role: string, reason: string }>} */
  const unasserted = [];
  for (const budget of budgets.values()) {
    if (budget.kind !== 'provisional') continue;
    try {
      assertableBudget(budgets, budget.name);
    } catch (error) {
      unasserted.push({ role: budget.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { fixture: { path: fixture.path, bytes: documentBytes }, results, unasserted };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('budgetGate.mjs')) {
  const { fixture, results, unasserted } = runBudgetGate();

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ fixture, results, unasserted }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `fixture: ${fixture.path}\n  ${formatBytes(fixture.bytes)} (${String(fixture.bytes)} bytes)\n\n`,
    );
    for (const result of results) {
      const verdict = result.withinMultiplier && result.withinAbsolute ? 'ok  ' : 'FAIL';
      process.stdout.write(
        `  ${verdict} ${result.role.padEnd(11)} peak ${formatBytes(result.peakBytes).padStart(9)} ` +
          `= ${result.ratio.toFixed(2)}x  (limits: ${String(result.multiplierLimit)}x and ${result.absoluteText})\n`,
      );
    }
    for (const entry of unasserted) {
      process.stdout.write(`  --   ${entry.role.padEnd(11)} not asserted, by declaration\n`);
    }
    process.stdout.write('\n');
  }

  const breaches = results.filter((result) => !result.withinMultiplier || !result.withinAbsolute);
  if (breaches.length > 0) {
    process.stderr.write(
      `${String(breaches.length)} budget breach(es). The budgets are stated in ARCHITECTURE §9.17 and ` +
        `argued from what each process is for. A breach is answered by finding what the process ` +
        `started doing, not by raising the number — for mupdf-host the invariant says so ` +
        `explicitly, since its limit is a containment limit whose breach means kill-and-restart.\n`,
    );
    process.exit(1);
  }
}
