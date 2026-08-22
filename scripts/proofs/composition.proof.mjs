// @ts-check
/**
 * Proves the composition root's document ceiling is ADR-0007's, not a number.
 *
 * ## The direction, and it is the CSP's
 *
 * `docs/ARCHITECTURE.md` §9.17 is the writer of record for `main`'s budget and
 * `scripts/lib/memoryBudgets.mjs` is its only reader. Neither the kernel nor
 * `apps/desktop` can reach that module — it is plain Node under `scripts/` and
 * the boundary is deliberate — so the shell writes the number down and this
 * proof recomputes it from the invariant. A ceiling that drifted from the budget
 * it claims to enforce would otherwise be a guard nobody could tell was wrong.
 *
 * ## Read from the BUILD, and both sides mutated
 *
 * The constant is read from `apps/desktop/dist/budget.js` rather than restated
 * here, for the same reason the CSP is: restating it would compare a copy with
 * itself. And the derivation is checked in both directions — a control asserts
 * that a ceiling equal to the raw cap, ignoring the baseline, is REJECTED, so
 * "the two agree" cannot be satisfied by a comparison that agrees with
 * everything.
 *
 * Usage: node scripts/proofs/composition.proof.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertableBudget, memoryBudgets } from '../lib/memoryBudgets.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILT = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'budget.js');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

try {
  if (!existsSync(BUILT)) {
    throw new Error(
      `${BUILT} does not exist. This proof reads the shell's declared ceiling from the BUILD ` +
        `rather than restating it — run \`npm run build\` first.`,
    );
  }

  const main = assertableBudget(memoryBudgets(), 'main');
  const derived = main.absoluteBytes - main.baselineBytes;

  const module = await import(`file://${BUILT.replaceAll('\\', '/')}`);
  /** @type {number} */
  const declared = module.MAIN_DOCUMENT_BYTES_CEILING;

  check(
    'the invariant supplies both terms the derivation needs',
    Number.isFinite(main.absoluteBytes) &&
      Number.isFinite(main.baselineBytes) &&
      main.absoluteBytes > main.baselineBytes,
    `absolute=${String(main.absoluteBytes)} baseline=${String(main.baselineBytes)}. Without ` +
      `both, the derivation below is arithmetic on a missing value and its agreement means ` +
      `nothing (audit item 4b).`,
  );

  check(
    "the shell's document ceiling is main's absolute cap minus its declared baseline",
    declared === derived,
    `declared ${String(declared)} bytes, §9.17 derives ${String(derived)} ` +
      `(${String(main.absoluteBytes)} cap − ${String(main.baselineBytes)} base). ` +
      `§9.17 is the writer of record: change the invariant first, then derive the constant from ` +
      `it. The reverse leaves a ceiling that enforces a budget nobody declared.`,
  );

  check(
    'CONTROL: a ceiling equal to the raw cap, ignoring the baseline, is rejected',
    main.absoluteBytes !== derived,
    `the cap and the derivation are the same number, so this comparison would accept a ceiling ` +
      `that forgot to subtract the baseline. That is the shape where a guard agrees with ` +
      `everything and reads as though it checked something.`,
  );

  // ---------------------------------------------------------------------------
  // The engine host's job memory limit, from the same line and by the OPPOSITE
  // arithmetic (ADR-0023 §2).
  //
  // `MAIN_DOCUMENT_BYTES_CEILING` subtracts the baseline because it bounds
  // document bytes. A job's `ProcessMemoryLimit` bounds the whole process
  // commit — runtime, statically linked engine and document — so it is the
  // absolute cap with nothing taken off. Two constants from two terms of one
  // line, and the difference between them is the thing worth checking.
  // ---------------------------------------------------------------------------
  const host = assertableBudget(memoryBudgets(), 'mupdf-host');
  /** @type {number} */
  const declaredHostLimit = module.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES;

  check(
    "the engine host's job limit is §9.17's absolute cap, with NOTHING subtracted",
    declaredHostLimit === host.absoluteBytes,
    `declared ${String(declaredHostLimit)} bytes, §9.17 caps mupdf-host at ` +
      `${String(host.absoluteBytes)}. A job's limit bounds the process commit, so subtracting ` +
      `the ${String(host.baselineBytes)}-byte baseline would enforce a limit tighter than the ` +
      `one the invariant declares and kill the host inside its own budget.`,
  );

  check(
    'CONTROL: and it is NOT main-style arithmetic, which would silently be tighter',
    declaredHostLimit !== host.absoluteBytes - host.baselineBytes,
    `the cap and the cap-minus-baseline are the same number for mupdf-host, so this comparison ` +
      `would accept either rule. The two constants exist to differ, and a check that cannot ` +
      `tell them apart agrees with both.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} composition failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('composition case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
