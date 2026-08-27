// @ts-check
/**
 * Proves the type-only export scan can SEE, can SEPARATE, and cannot be blind.
 *
 * `typeOnlyExports.mjs` is the fail-closed gate for the half of ADR-0026's class
 * no lint rule covers. Three properties matter and the middle one is the load
 * bearing one:
 *
 *   1. it reports an all-inline-type re-export, wrapped or not;
 *   2. it does NOT report the four shapes that are fine — a matcher flagging
 *      every export clause passes (1) perfectly;
 *   3. it is never blind, which is the whole reason it replaced the emit scan in
 *      the pre-commit set (finding QQQQ-1).
 *
 * Usage: node scripts/proofs/typeOnlyExports.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { CONTROL_FIXTURE, CONTROL_LINES, scan, violationsIn } from '../lib/typeOnlyExports.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

try {
  const control = violationsIn(CONTROL_FIXTURE);

  check(
    'the control fixture yields exactly two violations, on the declared lines',
    control.length === 2 &&
      control.map((violation) => violation.line).join(',') === CONTROL_LINES.join(','),
    `got ${control.length} on lines ${control.map((v) => v.line).join(',') || 'none'}, expected ` +
      `2 on ${CONTROL_LINES.join(',')}.`,
  );

  check(
    'a WRAPPED all-inline-type clause is one of them',
    control.some((violation) => violation.line === 6),
    `the barrel's own occurrence was wrapped across ten lines, and a line-anchored pattern ` +
      `would miss every one of those while reporting the single-line case — item 4b's window ` +
      `axis, where the instrument reports the absence it caused.`,
  );

  // ---- The four shapes that must NOT be reported ----
  check(
    'a MIXED clause is not reported',
    violationsIn("export { Beta, type Gamma } from './b.js';").length === 0,
    `reported. One value specifier keeps the statement alive whatever the others are marked, ` +
      `so the emit carries a binding and there is no defect to report.`,
  );
  check(
    'a top-level `export type` is not reported',
    violationsIn("export type { Delta } from './c.js';").length === 0,
    `reported. That is the CORRECT form — the whole statement is erased — so flagging it would ` +
      `make the fix indistinguishable from the defect.`,
  );
  check(
    'an ordinary value re-export is not reported',
    violationsIn("export { Epsilon } from './d.js';").length === 0,
    `reported.`,
  );
  check(
    'a local export with NO `from` is not reported, however it is marked',
    violationsIn('export { Zeta, type Eta };').length === 0,
    `reported. With no module specifier there is nothing to load, so the emitted statement — if ` +
      `any survives — costs nothing. This is the shape \`channel.ts:69\` uses.`,
  );

  // ---- The empty clause, which is its own finding ----
  const empty = violationsIn("export {} from './e.js';");
  check(
    'an EMPTY clause is reported, and as its own kind rather than folded in',
    empty.length === 1 && empty[0]?.kind === 'empty',
    `got ${JSON.stringify(empty)}. Folding it into "every specifier is type-only" would be ` +
      `vacuously true — a claim about a set with no members, which is arithmetic wearing ` +
      `evidence's clothes.`,
  );

  // ---- It is never blind ----
  const live = scan();
  check(
    'the scan is never blind: it reads the index, which always exists',
    live.blind === null && live.scanned > 0,
    `blind=${String(live.blind)} scanned=${live.scanned}. This replaced a scan over \`dist\` ` +
      `precisely because that one could report "could not look" on a machine that had not ` +
      `built, and a gate with a blind state is a gate that contributes nothing there.`,
  );
  check(
    'and this repository currently has none',
    live.violations.length === 0,
    `${live.violations.length}: ${JSON.stringify(live.violations)}`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nType-only export proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('type-only export case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
