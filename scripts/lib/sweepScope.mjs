// @ts-check
/**
 * The one decision `checkLocal.mjs` makes before it runs anything: whether this
 * run is the mode that invents failures (finding WWW-2).
 *
 * Split out for the reason `win32Handle.mjs` is split out — the JUDGEMENT is the
 * half a proof can drive directly, and here it is the half with a BOUNDARY. The
 * end-to-end case can only exercise one side of that boundary cheaply: the
 * refusing side costs nothing because nothing runs, and the permitted side costs
 * however long the selected scripts take. A guard whose permitted side is
 * untested is the one that eventually blocks `--only check:` and gets turned
 * off, which is the failure this project has already paid for in the escape
 * hook's false positives.
 *
 * The message lives here rather than at the call site so there is one writer for
 * it, and so the proof asserts the text a reader will actually meet.
 */

/**
 * @param {{ rootDir: string, repoRoot: string, selected: readonly string[] }} run
 * @returns {string | null} the refusal a caller must print, or `null` to proceed
 */
export function multiProofSweepRefusal({ rootDir, repoRoot, selected }) {
  // Scoped to THIS repository. A fixture repository built by
  // `checkLocal.proof.mjs` has a handful of trivial scripts and no wreckage, the
  // measurement was never taken there, and refusing it would block the only way
  // this harness's own failure paths can be exercised (QQQ-2).
  if (rootDir !== repoRoot) return null;

  // THE BOUNDARY IS WHERE THE DEFECT CANNOT OCCUR, not a round number. The
  // failures are cross-script contamination, so a run executing at most one
  // `proof:*` script has nothing to be contaminated BY. `--only check:` — the
  // habitual pre-push sweep, eleven scripts, repeatedly green — selects no
  // proofs at all, which is the evidence that the check half does not
  // contaminate.
  const proofs = selected.filter((name) => name.startsWith('proof:'));
  if (proofs.length <= 1) return null;

  return (
    `Refusing to sweep ${String(proofs.length)} proof scripts in one run (finding WWW-2).\n\n` +
    `A full sweep of this repository invents failures: 35 scripts failed in 0.0s on one ` +
    `measured pass and every one passed alone. Something a COMPLETED script leaves behind is ` +
    `enough, and the mechanism is not established — so this run is refused rather than run ` +
    `with a note explaining its own false reds.\n\n` +
    `Run one of these instead:\n` +
    `  npm run local -- --only check:            the pre-push sweep, no proofs, unaffected\n` +
    `  npm run local -- --only <one proof name>  a single proof has nothing to be ` +
    `contaminated by\n` +
    `  npm run board -- <full sha>               the whole set, on a machine per job\n\n` +
    `Unblocked by: the mechanism, then a job object per script so its children die with it. ` +
    `There is no flag that turns this off.\n`
  );
}
