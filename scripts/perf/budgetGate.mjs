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

import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { assertableBudget, memoryBudgets } from '../lib/memoryBudgets.mjs';
import { buildDenseFixture, buildLargeFixture } from './largeFixture.mjs';
import { formatBytes, measurePeak } from './peakRss.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = repoRoot();

/**
 * The document-proportional cost, which is what the multiplier constrains.
 *
 * Measured, not assumed: each role is run once against a trivially small
 * document, and that peak is the role's fixed cost — the runtime, the loaded
 * shim, the process itself. Subtracting it leaves what the document actually
 * cost, which is the quantity invariant §9.17 argues about.
 *
 * Without this the ratio measures the runtime. `main` holding one copy of a
 * 25.1 MB document peaks at 72.9 MB, of which 48.7 MB is an idle Node process —
 * 2.90x file size for a process doing exactly what it should, breaching a 1.5x
 * budget on a fixed cost that has nothing to do with the document. The same
 * arithmetic makes any small document report a large multiple, which is the
 * opposite of what the multiplier is for.
 *
 * The absolute cap is deliberately NOT baseline-adjusted. It is a containment
 * limit on the whole process, and the machine pays for the baseline too.
 *
 * **Exported so a spread can be measured through THIS function** rather than
 * beside it. `baselineSpread.mjs` needs fifteen readings of the same quantity
 * the gate enforces; a second `measurePeak(script, [tiny])` written there would
 * be a second opinion about what a role's baseline is, and the two would agree
 * until one of them changed (B3a).
 *
 * `options` reaches `measurePeak` untouched, which is how that caller selects a
 * runtime — SSSS-2 measured that a figure and the runtime it was taken under
 * cannot be separated.
 *
 * @param {string} script
 * @param {string} tinyDocument
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number, runtime?: string }} [options]
 * @returns {number}
 */
export function baselineFor(script, tinyDocument, options = {}) {
  return measurePeak(script, [tinyDocument], options).peakRssBytes;
}

/**
 * The document-proportional cost of one run, or a refusal that names why there
 * is none.
 *
 * **Deliberately not clamped at zero.** A peak below the role's own baseline
 * does not mean the document cost nothing — it means noise exceeded signal and
 * the two runs are not comparable. Clamped, it yields a ratio of zero, which
 * satisfies every multiplier and reads identically to a perfect result. That is
 * the fourth entry in CLAUDE.md's list of blind instruments, verbatim
 * ("allocator counters that clamped an underflow to zero, so the failure state
 * was identical to 'everything was freed'"), and it was live in the instrument
 * that decides the Stage 0 memory gate, on a runner whose variance had just
 * produced a second finding (NN-3).
 *
 * @param {string} role
 * @param {number} peakBytes
 * @param {number} baselineBytes
 * @returns {number}
 */
export function documentCostBytes(role, peakBytes, baselineBytes) {
  const cost = peakBytes - baselineBytes;
  if (cost < 0) {
    throw new Error(
      `${role}: peak ${formatBytes(peakBytes)} came in below its own baseline ` +
        `${formatBytes(baselineBytes)}, so no document cost can be formed from these two runs. ` +
        `Noise exceeded signal and they are not comparable. This is reported rather than clamped ` +
        `to zero, because a zero cost passes every limit declared and is indistinguishable from a ` +
        `process that held the document for free.`,
    );
  }
  return cost;
}

/**
 * @typedef {{
 *   role: string,
 *   budget: string,
 *   peakBytes: number,
 *   baselineBytes: number,
 *   documentBytes: number,
 *   ratio: number,
 *   multiplierLimit: number | null,
 *   absoluteLimit: number,
 *   absoluteText: string,
 *   baselineLimit: number,
 *   baselineText: string,
 *   withinMultiplier: boolean,
 *   withinAbsolute: boolean,
 *   withinBaseline: boolean,
 *   detail: Record<string, unknown>,
 * }} RoleResult
 */

/**
 * @param {{ documentPath?: string, documentBytes?: number, root?: string, budgetsText?: string }} [options]
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
      : { path: options.documentPath, bytes: options.documentBytes ?? statSync(options.documentPath).size };

  const documentBytes = fixture.bytes;
  if (!Number.isFinite(documentBytes) || documentBytes <= 0) {
    throw new Error('The gate needs the document size to form a ratio; it will not assume one.');
  }

  /**
   * A role's LABEL and the budget it is asserted against are separate, and the
   * second role is why.
   *
   * `main` is measured twice: once as a model of what it is supposed to cost
   * (`roleMain.mjs` — read, hash, hold) and once through the real
   * `DocumentService`. Both are `main` and both answer to `main`'s budget; only
   * the second is evidence about the retention implementation, and a divergence
   * between them is the finding (LL-4).
   *
   * @type {Array<{ role: string, budget?: string, script: string }>}
   */
  const roles = [
    { role: 'main', script: join(HERE, 'roleMain.mjs') },
    { role: 'main-service', budget: 'main', script: join(HERE, 'roleMainService.mjs') },
    { role: 'mupdf-host', script: join(HERE, 'roleMupdfHost.mjs') },
  ];

  // A document small enough that its own cost is noise, used to establish each
  // role's fixed cost. Generated by the same generator as the real fixture, so
  // the baseline run exercises the same code path.
  const tiny = buildLargeFixture({ root, targetBytes: 64 * 1024, pages: 1, name: 'perf-baseline.pdf' });

  /** @type {RoleResult[]} */
  const results = [];
  for (const { role, budget: budgetName, script } of roles) {
    const budget = assertableBudget(budgets, budgetName ?? role);
    const baselineBytes = baselineFor(script, tiny.path);
    const measurement = measurePeak(script, [fixture.path]);
    const documentCost = documentCostBytes(role, measurement.peakRssBytes, baselineBytes);
    const ratio = documentCost / documentBytes;
    results.push({
      role,
      // WHICH BUDGET THIS WAS ASSERTED AGAINST, carried rather than inferred
      // from the label. They stopped being the same thing when `main` began
      // being measured twice, and `perfBudget.proof.mjs` synthesises budget
      // declarations from results — it built one for `main-service`, which the
      // parser correctly refused as a process nobody had declared.
      budget: budgetName ?? role,
      peakBytes: measurement.peakRssBytes,
      baselineBytes,
      documentBytes,
      ratio,
      multiplierLimit: budget.multiplier,
      absoluteLimit: budget.absoluteBytes,
      absoluteText: budget.absoluteText,
      baselineLimit: budget.baselineBytes,
      baselineText: budget.baselineText,
      // TRUE WHEN THERE IS NO TERM, and that is not the same as "passed".
      // `multiplierLimit` above is `null` in that case, so the report can say
      // which of the two it is; a verdict that folded them together would read
      // as a ratio checked and cleared for a budget that has no ratio.
      // ADR-0033 withdrew `mupdf-host`'s, and what it gives up — amplification
      // detection, a small hostile document producing a large parse — is
      // recorded there rather than implied by a `true` here.
      withinMultiplier: budget.multiplier === null || ratio <= budget.multiplier,
      withinAbsolute: measurement.peakRssBytes <= budget.absoluteBytes,
      // The measured baseline is now part of the verdict rather than merely
      // subtracted and printed. It was the latter for one commit, which is the
      // shape of a flag computed into a detail string and left out of the pass
      // expression — the exact defect closed in the H2 spike case.
      withinBaseline: baselineBytes <= budget.baselineBytes,
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

/**
 * Both content shapes, because they are not interchangeable evidence.
 *
 * Stage-audit item 2 is "was it verified against the easy shape only", and
 * image-heavy is the easy shape: it gave 1.59x where object-dense gave 5.98x of
 * total RSS against a 6x limit. Running one and calling the gate satisfied is
 * exactly the failure that item was written for.
 *
 * @returns {Array<{ shape: string, fixture: { path: string, bytes: number }, results: RoleResult[], unasserted: Array<{ role: string, reason: string }> }>}
 */
export function runAllShapes(root = ROOT) {
  const image = buildLargeFixture({ root });
  const dense = buildDenseFixture({ root });
  return [
    { shape: 'image-heavy', ...runBudgetGate({ root, documentPath: image.path, documentBytes: image.bytes }) },
    { shape: 'object-dense', ...runBudgetGate({ root, documentPath: dense.path, documentBytes: dense.bytes }) },
  ];
}

if (process.argv[1]?.endsWith('budgetGate.mjs')) {
  const runs = runAllShapes();

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
  } else {
    for (const { shape, fixture, results, unasserted } of runs) {
      process.stdout.write(
        `${shape}: ${formatBytes(fixture.bytes)} (${String(fixture.bytes)} bytes)\n`,
      );
      for (const result of results) {
        const verdict =
          result.withinMultiplier && result.withinAbsolute && result.withinBaseline ? 'ok  ' : 'FAIL';
        process.stdout.write(
          `  ${verdict} ${result.role.padEnd(11)} peak ${formatBytes(result.peakBytes).padStart(9)} ` +
            `- baseline ${formatBytes(result.baselineBytes).padStart(9)}${result.withinBaseline ? '' : ' OVER'} ` +
            // THE RATIO IS STILL PRINTED WHERE THERE IS NO LIMIT FOR IT, and
            // the limit says so in words. `nullx` was the first rendering, and
            // it reads as a limit that exists and is null rather than a term
            // that was withdrawn — which is the same conflation the verdict
            // avoids by keeping `multiplierLimit` nullable. A measured ratio
            // with nothing to check it against is worth showing: it is the
            // number ADR-0033's successor term would be derived from.
            `= ${result.ratio.toFixed(2)}x  (limits: ` +
            `${result.multiplierLimit === null ? 'no multiple' : `${String(result.multiplierLimit)}x`}, ` +
            `${result.absoluteText}, base ${result.baselineText})\n`,
        );
      }
      for (const entry of unasserted) {
        process.stdout.write(`  --   ${entry.role.padEnd(11)} not asserted, by declaration\n`);
      }
      process.stdout.write('\n');
    }
  }

  const breaches = runs.flatMap(({ shape, results }) =>
    results
      .filter((result) => !result.withinMultiplier || !result.withinAbsolute || !result.withinBaseline)
      .map((result) => ({ shape, result })),
  );
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
