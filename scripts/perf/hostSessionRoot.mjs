// @ts-check
/**
 * Where one `--host` measurement puts its session root.
 *
 * ## Why this is a module and not a line in `roleMupdfHost.mjs`
 *
 * It was a line there until 2026-09-20, and the line composed
 * {@link HOST_ROOT_PREFIX} with this process's decimal PID, with the handed
 * pair named `ad-<the same pid in hex>` inside it. Two facts turn that into an
 * intermittent failure, and neither is visible from the line:
 *
 * 1. **A run that dies before its `finally` leaks the handed pair.** The pair is
 *    created before the measurement's `try`, and a killed run — a timed-out
 *    proof, an interrupted sweep — never reaches the removal. Measured
 *    2026-09-20: **535** leaked roots under `%TEMP%`, oldest 2026-08-30, of
 *    which 98 still held a file.
 * 2. **Windows recycles PIDs.** A later run that draws a recycled one composes
 *    the identical path, finds `in-ad-<hex>` already there, and
 *    `createSessionDirectories` refuses it — *correctly*, because a directory
 *    this run did not create carries a DACL it did not write, and adopting one
 *    would hand the container a grant nobody in this run made.
 *
 * The refusal is not the defect and must not be softened. The defect is that
 * two runs can ever compose the same path, and `mkdtempSync` makes that
 * unrepresentable rather than checked (B5). Measured before the change: two
 * refusals in ten host measurements across five `perf:gate` runs.
 *
 * **What this does NOT fix, stated so nobody reads it as closed:** a killed run
 * still leaks its pair. Nothing a process can be killed before can prevent
 * that, which is why the product answers the same class from the other side —
 * `sweepSessionDirectories` runs over the app's one session root at startup
 * (`engineHostPlatform.ts`). A harness cannot copy that move, because several
 * measurements run concurrently under `npm run local` and a sweep of every
 * sibling would delete a live run's root. So a leak stays possible here and is
 * now harmless to the next run, which is the property the intermittency needed.
 *
 * ## What the failure looked like, because it named the wrong thing
 *
 * `budgetGate.mjs` records an unmeasurable role in `unasserted`, and
 * `perfBudget.proof.mjs` renders that either as a skipped case — *"NOT MEASURED
 * on this runner"*, which reads as a platform that cannot do it — or, when the
 * refusal lands in one of the five differential sub-runs rather than the
 * baseline one, as a **red** case reading *"mupdf-host-real: a baseline budget
 * below its measured fixed cost turns the gate red"*. That sentence points at
 * the budget line. The cause was a directory left in `%TEMP%` by a run that had
 * been killed three weeks earlier.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The prefix every host-measurement root carries.
 *
 * Exported because it is what a reader greps for when they find these in
 * `%TEMP%`, and what the proof builds a stale root from.
 */
export const HOST_ROOT_PREFIX = 'monstera-role-host-';

/**
 * Mints a fresh session root under the system temp directory.
 *
 * Under `%TEMP%` rather than the repository, because the handed pair inside it
 * gets its own DACL naming the container and nothing here should inherit that.
 *
 * @returns An absolute path to a directory that exists and that no other run
 *   holds. `mkdtempSync` creates it, so there is no window between choosing the
 *   name and owning it.
 */
export function mintHostSessionRoot() {
  return mkdtempSync(join(tmpdir(), HOST_ROOT_PREFIX));
}

/**
 * The spelling this module replaced, kept for the control case alone.
 *
 * A proof asserting *two mints differ* is satisfied by any number of
 * implementations, including ones that were never broken. This reproduces the
 * original defect — the same process composes the same path twice — so the
 * proof fails if {@link mintHostSessionRoot} is reverted to it.
 *
 * Not called by anything that measures. It creates nothing.
 *
 * @param {number} pid The process id to compose from.
 */
export function pidKeyedRootPathForControl(pid) {
  return join(tmpdir(), `${HOST_ROOT_PREFIX}${String(pid)}`);
}
