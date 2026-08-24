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
 * @param {{
 *   rootDir: string,
 *   repoRoot: string,
 *   selected: readonly string[],
 *   runLogDir: string,
 * }} run `runLogDir` is where the caller writes its rows — passed in rather than
 *   spelt here, because this message had TWO paths in one string and one of them
 *   named a file deleted the commit before for being the defect (AAAA-28). The
 *   dependency runs caller-to-here, so this takes the value; deriving it would
 *   invert the import and create the second writer again.
 * @returns {string | null} the refusal a caller must print, or `null` to proceed
 */
export function multiProofSweepRefusal({ rootDir, repoRoot, selected, runLogDir }) {
  // SCOPED TO THE WORKING TREE, and that is the whole of the reason — not the
  // fixture, which is only its first use (finding AAAA-27).
  //
  // WWW-1's harm is to the tree the scripts run against: a killed proof leaves
  // ITS repository with a tracked file deleted. Any root that is not the one you
  // are working in contains that harm by construction, so refusing there would
  // trade a real capability for no safety at all.
  //
  // Two things depend on this and only one was written down. The fixture
  // `checkLocal.proof.mjs` builds is the exercised one (QQQ-2). The other is the
  // ONLY route to the mechanism this refusal exists over: pointed at a clone,
  // `checkLocal.mjs` runs the full multi-proof sweep through the real harness,
  // writing real rows to the clone's `.cache/`, with nothing at stake in the
  // working tree. Verified 2026-08-24 —
  // `node scripts/checkLocal.mjs --root <clone> --only proof:` selected 64
  // scripts and began executing rather than refusing.
  //
  // So a future narrowing of this comparison to fixtures-only would close the
  // one path to the answer, and no check would notice, because what it removes
  // is a capability rather than a behaviour. That is why the reason is stated
  // this wide.
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
    `measured pass and every one passed alone. WHAT they were is established as of 2026-08-24; ` +
    `WHY is not. So this run is refused rather than run with a note explaining its own false ` +
    `reds.\n\n` +
    `THEY NEVER STARTED A PROCESS (finding AAAA-6). The harness prints seconds to one decimal, ` +
    `so 0.0s means under 50ms — and the cheapest possible successful spawn of node on this ` +
    `machine, a script whose entire body is process.exit(0), measured 116ms at its FASTEST over ` +
    `15 runs: median 129ms, max 179ms, 0 of 15 under 50ms. Nothing that started node can render ` +
    `as 0.0s here. A spawnSync that fails to CREATE the process returns in about 3ms with status ` +
    `null and zero bytes of output, which is that signature exactly.\n\n` +
    `WHICH ERRNO IS STILL UNKNOWN, and it is unknown for a reason that was in this harness ` +
    `rather than in the evidence: it read spawnSync's status, signal, stdout and stderr, and ` +
    `never once read its error — the only field that says why no process appeared. So AAAA-23's ` +
    `question, what did those 35 actually print, has an answer: nothing, and nothing could have. ` +
    `The harness reads that field now, reports DID NOT START as its own state rather than as a ` +
    `failure, and stops the sweep there — for the reason it stops at a timeout, since a machine ` +
    `that just refused to create a process will refuse the next one, and the founding ` +
    `observation is thirty-five of those in a row.\n\n` +
    `THE BOUND IS EARNED, AND THAT IS DATED RATHER THAN ASSUMED. The obvious suspect is the ` +
    `harness defect this file's caller records at checkLocal.mjs — \`npm run\` under a shell, ` +
    `where the timeout killed the shell and left node running, after which twenty scripts failed ` +
    `in 0.2s with no output. Both remedies for it — invoking the interpreter directly, and ` +
    `stopping at the first kill — landed in f7dc5fb (2026-08-23T08:35+02:00). The 35-at-0.0s ` +
    `pass was recorded in 7b7824e (2026-08-23T17:20+02:00), nine hours LATER, on a harness that ` +
    `already had both. So this is not guarding a defect that was fixed.\n\n` +
    `Stop-at-first-kill rules out a cascade started by a kill INSIDE that run — the run would ` +
    `have stopped at it. It rules out nothing about an EARLIER run: the comment above the break ` +
    `in checkLocal.mjs says a timeout's orphans "accumulate", which is cross-run by construction, ` +
    `and a kill also leaves tracked files deleted after its run has ended. So the boundary is at ` +
    `most one proof because the mechanism is unknown, not because kills have been excluded.\n\n` +
    `WHAT WAS MEASURED 2026-08-24, with provenance, since a claim taken under a cap that ` +
    `manufactured kills would be worthless: a 90s-capped reproduction killed proof:hookprobe at ` +
    `90.04s with SIGTERM, its \`finally\` never ran, and docs/hook-probe.json was left DELETED in ` +
    `the working tree. That is a direct observation and does not depend on the cap.\n\n` +
    `WITHDRAWN, both previously stated here: that sequence slows a script down, and that ` +
    `orphaned proof processes were accumulating on the machine. proof:shim measured 1.5s and ` +
    `9.4s at the SAME position across two runs, so position is not what separates them and ` +
    `machine state was never isolated. And the four long-lived node processes were checked by ` +
    `command line rather than by age: two are an MCP server with LIVING parents, spawned by the ` +
    `editor and not by anything here, and the other two were never identified at all. No process ` +
    `on this machine has been shown to be proof wreckage. Nor is the 0.0s signature explained: a ` +
    `missing docs/hook-probe.json makes check:docs fail in ~130s, not instantly.\n\n` +
    `AND THE FOUNDING OBSERVATION KEPT NO EVIDENCE — which cost less than it looked like, ` +
    `because the lines it lost were empty ones. The harness prints one diagnostic line per ` +
    `failure, or "(no diagnostic line found)" when there was none; a process that never started ` +
    `produces no output at all, so all 35 said the same nothing. What separates that case from ` +
    `an import-time throw is the byte count, which the rows carry and the printed lines never ` +
    `did. Every run now writes its rows to ${runLogDir} as it goes, and a spawn that fails now ` +
    `carries its errno into both the line and the row.\n\n` +
    `Run one of these instead:\n` +
    `  npm run local -- --only check:            the pre-push sweep, no proofs, unaffected\n` +
    `  npm run local -- --only <one proof name>  a single proof has nothing to be ` +
    `contaminated by\n` +
    `  npm run board -- <full sha>               the whole set, on a machine per job\n\n` +
    `AND IF YOU ARE HERE TO INVESTIGATE THIS, run the full sweep against a CLONE:\n` +
    `  git clone . <path>\n` +
    `  npm run local -- --root <path> --only proof:\n\n` +
    `That is not a workaround. It is the real harness, running every proof, writing real rows ` +
    `to the clone's own copy of ${runLogDir} — and a killed proof deletes a tracked file in the ` +
    `CLONE, ` +
    `which is the only harm this refusal is protecting you from. It is also better evidence than ` +
    `a purpose-built reproduction, which can manufacture the kills it then measures. The rows are ` +
    `what the original 35-at-0.0s pass did not keep.\n\n` +
    `AND THE JOB OBJECT IS NOT OWED. This message used to end by naming it as the second ` +
    `condition, on the premise that a timeout leaves the killed script's children running. ` +
    `Measured 2026-08-24, three runs of each variant against this harness: an ordinary ` +
    `grandchild died with it 3 of 3, and a DETACHED one survived 3 of 3. The discriminating ` +
    `variable is detached — the signature of the job object libuv already puts an ordinary ` +
    `Windows child into — and this repository spawns nothing detached. Both halves are now ` +
    `asserted rather than recalled: checkLocal.proof.mjs runs that differential on every push, ` +
    `on each platform's own Guards leg, requiring the grandchild to be seen ADVANCING before ` +
    `anything is killed — because "it stopped" and "it never started" are the same observation ` +
    `otherwise. What a timeout really leaves behind is a CHANGED TREE, since a killed script ` +
    `never runs its finally.\n\n` +
    `Unblocked by: the ERRNO behind the 0.0s signature, and nothing else. The class is settled ` +
    `— no process was created — and stopping at the first one bounds the damage to a single ` +
    `invented failure instead of thirty-five. That is not an explanation, and the next ` +
    `occurrence is the thing that will be. ` +
    `There is no flag that turns this off.\n`
  );
}
