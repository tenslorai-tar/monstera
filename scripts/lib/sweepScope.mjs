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
    `measured pass and every one passed alone. The mechanism is NOT established, so this run is ` +
    `refused rather than run with a note explaining its own false reds.\n\n` +
    `THE BOUND IS EARNED, AND THAT IS DATED RATHER THAN ASSUMED. The obvious suspect is the ` +
    `harness defect this file's caller records at checkLocal.mjs — \`npm run\` under a shell, ` +
    `where the timeout killed the shell and left node running, after which twenty scripts failed ` +
    `in 0.2s with no output. Both remedies for it — invoking the interpreter directly, and ` +
    `stopping at the first kill — landed in f7dc5fb (2026-08-23T08:35+02:00). The 35-at-0.0s ` +
    `pass was recorded in 7b7824e (2026-08-23T17:20+02:00), nine hours LATER, on a harness that ` +
    `already had both. So this is not guarding a defect that was fixed.\n\n` +
    `And stop-at-first-kill was already present, which means those 35 were ordinary non-zero ` +
    `exits rather than a cascade a kill started: had a kill come first, the run would have ` +
    `stopped there. That is why the boundary is at most one proof rather than stop at the first ` +
    `kill — the latter exists and did not prevent it.\n\n` +
    `WHAT WAS MEASURED 2026-08-24, with its provenance, since a doubling claim taken under a cap ` +
    `that manufactured kills would be worthless: a 90s-capped reproduction killed ` +
    `proof:hookprobe at 90.04s with SIGTERM, its \`finally\` never ran, and docs/hook-probe.json ` +
    `was left DELETED in the working tree. Four orphaned node processes were alive throughout, ` +
    `two started the previous day — nothing here kills a process tree. Both facts are direct ` +
    `observations and neither depends on the cap.\n\n` +
    `NOT ESTABLISHED, and previously stated here more strongly than the evidence: that running ` +
    `in sequence slows a script down. proof:hookprobe measured 308s alone and 598s ninth, but ` +
    `proof:shim measured 1.5s and 9.4s at the SAME position across the two runs, so position is ` +
    `not what separates them — the second run began with the first run's orphans alive, and ` +
    `machine state and sequence were never isolated. Nor is the 0.0s signature explained: a ` +
    `missing docs/hook-probe.json makes check:docs fail in ~130s, not instantly.\n\n` +
    `Run one of these instead:\n` +
    `  npm run local -- --only check:            the pre-push sweep, no proofs, unaffected\n` +
    `  npm run local -- --only <one proof name>  a single proof has nothing to be ` +
    `contaminated by\n` +
    `  npm run board -- <full sha>               the whole set, on a machine per job\n\n` +
    `Unblocked by: the 0.0s signature's mechanism, then a job object per script so its children ` +
    `die with it — which the orphan count above says nothing currently does. ` +
    `There is no flag that turns this off.\n`
  );
}
