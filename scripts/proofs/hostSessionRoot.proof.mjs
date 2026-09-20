// @ts-check
/**
 * Proves that two host measurements cannot compose the same session root.
 *
 * ## The defect this exists for
 *
 * `roleMupdfHost.mjs --host` composed its root and its handed pair from the
 * process PID. A run killed before its `finally` leaks the pair, Windows
 * recycles PIDs, and a later run drawing a recycled one is refused by
 * `createSessionDirectories` — correctly, because a directory it did not create
 * carries a DACL it did not write. Measured 2026-09-20: 535 leaked roots under
 * `%TEMP%`, oldest 2026-08-30, and two refusals in ten host measurements.
 *
 * The refusal is the mechanism working. What is proven here is that nothing can
 * put it in that position.
 *
 * ## Why the control is a reimplementation rather than a mutation
 *
 * *Two mints differ* is satisfied by implementations that were never broken, so
 * on its own it separates nothing — it would pass against a version that had
 * simply never collided on this runner. `pidKeyedRootPathForControl` is the
 * spelling that was replaced, so case 2 asserts the original defect is
 * REPRODUCIBLE and case 1 asserts the shipped mint does not have it. Revert
 * `mintHostSessionRoot` to the old spelling and case 1 goes red; delete the
 * control and the proof declares four cases and gets three.
 *
 * Case 3 is the one that names the actual failure rather than a proxy: a stale
 * directory sitting at exactly the path the old spelling would have chosen must
 * not affect a fresh mint. Its own control is case 4 — the same stale directory
 * DOES collide with the old spelling — without which case 3 passes for a run
 * where the stale directory was never created.
 *
 * Runs everywhere: `mkdtempSync` and `join` are platform-agnostic, and this
 * proof creates no handed pair and no container, so there is nothing Win32
 * about it. The Win32 half — that a pair whose directory already exists is
 * refused — is `sessionDirectories.test.ts`'s and `sessionSweep.proof.mjs`'s.
 *
 * Usage: node scripts/proofs/hostSessionRoot.proof.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  HOST_ROOT_PREFIX,
  mintHostSessionRoot,
  pidKeyedRootPathForControl,
} from '../perf/hostSessionRoot.mjs';

/**
 * The cases, named rather than counted. A count taken from the checks that ran
 * agrees with any deletion (audit item 4c), and this file's whole subject is a
 * collision that only shows up occasionally — the shape where a quietly
 * shrinking proof would never be noticed.
 */
const CASES = [
  'two mints in one process are different directories',
  'CONTROL: the spelling this replaced composes the SAME path twice',
  'a stale directory at the old path does not affect a fresh mint',
  'CONTROL: the same stale directory IS what the old spelling would have chosen',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: CASES.length });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @type {string[]} */
const made = [];
/** A pid no process has, so the stale root this proof builds is its own. */
const ABSENT_PID = 0x7ffffff;

try {
  const first = mintHostSessionRoot();
  made.push(first);
  const second = mintHostSessionRoot();
  made.push(second);

  check(
    CASES[0] ?? '',
    first !== second && existsSync(first) && existsSync(second),
    `minted ${first} and ${second}. Both must exist — a mint that returned a name without ` +
      `creating it leaves a window in which two runs can still choose the same one, which is ` +
      `the defect with an extra step.`,
  );

  const controlA = pidKeyedRootPathForControl(ABSENT_PID);
  const controlB = pidKeyedRootPathForControl(ABSENT_PID);
  check(
    CASES[1] ?? '',
    controlA === controlB,
    `the replaced spelling gave ${controlA} and ${controlB} for one pid. If these differ the ` +
      `control no longer reproduces the original defect, and case 1 above is asserting nothing ` +
      `a broken version would have failed.`,
  );

  // THE STALE DIRECTORY, built at exactly the path a recycled pid would compose.
  // Both halves of the pair, because the refusal that was measured came from the
  // snapshot half specifically.
  const stale = pidKeyedRootPathForControl(ABSENT_PID);
  mkdirSync(join(stale, `in-ad-${ABSENT_PID.toString(16)}`), { recursive: true });
  mkdirSync(join(stale, `out-ad-${ABSENT_PID.toString(16)}`), { recursive: true });
  made.push(stale);

  const afterStale = mintHostSessionRoot();
  made.push(afterStale);
  check(
    CASES[2] ?? '',
    afterStale !== stale && existsSync(afterStale),
    `with ${stale} on disk, the mint answered ${afterStale}. A mint that can land on a ` +
      `directory somebody else's run created is the whole defect: the pair inside it carries a ` +
      `grant nobody in this run made, and createSessionDirectories refuses it.`,
  );

  check(
    CASES[3] ?? '',
    existsSync(stale) && pidKeyedRootPathForControl(ABSENT_PID) === stale,
    `the stale root is at ${stale} and the old spelling now answers ` +
      `${pidKeyedRootPathForControl(ABSENT_PID)}. Without this, case 3 passes on a run where ` +
      `nothing stale was ever created — refusal and impossibility reading the same, which is ` +
      `what a negative probe has to separate.`,
  );

  // The prefix is what a reader greps for in %TEMP% and what this proof's own
  // cleanup keys on, so a rename that broke the tie would leave this file
  // deleting nothing while still passing.
  const underTemp = made.every(
    (path) => dirname(path) === dirname(pidKeyedRootPathForControl(ABSENT_PID)),
  );
  if (!underTemp) {
    failures.push(
      `a minted root landed outside the temp directory the control composes: ${made.join(', ')}`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} host-session-root case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('host-session-root case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
  process.stderr.write(`MONSTERA_HOST_SESSION_ROOT_FAILED ${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const path of made) {
    if (path.includes(HOST_ROOT_PREFIX)) {
      rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
