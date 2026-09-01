// @ts-check
/**
 * Waits for both workflows to COMPLETE at one commit, and says so or says why not.
 *
 * The thin fetch shell around `scripts/lib/boardStatus.mjs`. Every decision lives
 * in that module so its proof can run over recorded payloads; this file only
 * gets bytes and prints.
 *
 * ## Wait for COMPLETION, not for the run to start
 *
 * `concurrency.cancel-in-progress` cancels whatever is IN PROGRESS when the next
 * push lands — and a started run is exactly that state. Pushing one unit at a
 * time and waiting for the run to *begin* therefore buys a started run and still
 * no verdict, which is how one commit here ended up with a cancelled CI result
 * instead of a green one and another with none at all. The unit is the commit
 * (B8); a unit whose board entry says nothing undoes the argument for it.
 *
 * ## The query is varied on every poll, on purpose
 *
 * An unchanging URL is a cacheable one, and a cached board and a quiet board are
 * indistinguishable. The counter in the query string defeats that; the STALE
 * verdict catches what gets through anyway.
 *
 * ## It prints SHORT, and that is a mechanism rather than a preference (AAAA-2)
 *
 * This used to print one line per poll — up to forty of them to reach one
 * verdict. So the verdict got read through `| tail -4`, and a pipe reports the
 * exit status of its LAST command: a run that returned 2 for **no verdict**
 * printed `exited with code 0`, and was one step from being filed as a defect in
 * this file, which was behaving correctly.
 *
 * The rule *never pipe away an exit code* was already written down and did not
 * reach the moment the command was composed — which is the escape hook's
 * argument, and seven occurrences of it say that writing a rule down is not what
 * stops you. **So the reason to pipe is removed instead of the pipe being
 * forbidden.** Quiet by default: the verdict, the run numbers and the
 * conclusions. `--verbose` restores the per-poll trace for someone watching a
 * run in progress.
 *
 * Usage:
 *   node scripts/ci/board.mjs                   HEAD: wait for it, print the verdict
 *   node scripts/ci/board.mjs --verbose         one line per poll as well
 *   node scripts/ci/board.mjs --once            one look, no waiting
 *   node scripts/ci/board.mjs --sha <40 hex>    another commit, full sha only
 *
 * **No positional sha, and that is the point** (finding FFFF-6). This used to
 * take one and accept it at seven characters — a length `?head_sha=` matches
 * nothing at, so the query came back empty and the reader said *not yet* about
 * a commit it had never asked about. The guard's own message named that failure
 * in the sentence permitting it. The common case is *is what I just pushed
 * green*, so it now reads `HEAD` and the reflex is unavailable rather than
 * rejected. {@link boardTarget} decides all of this, where a proof can reach it.
 */

import { execFileSync } from 'node:child_process';

import { boardTarget, boardVerdict, parseRuns, pollDelaySeconds } from '../lib/boardStatus.mjs';
import { describeAuthorisation, githubFetch } from '../lib/githubFetch.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO = 'tenslorai-tar/monstera';

/**
 * How long to wait between polls, and how many to take.
 *
 * **Measured against what is being waited for, not chosen for responsiveness.**
 * A run on this repository takes four to twelve minutes, so at thirty seconds
 * that is eight to twenty-four requests asking a question whose answer cannot
 * have changed. Ninety is the interval, and `pollDelaySeconds` still overrides
 * it from the payload when GitHub says how long to wait.
 *
 * ## THE CEILING IS A SEPARATE NUMBER AND THE FIRST ATTEMPT GOT IT WRONG
 *
 * This read 40 polls × 30s, and was changed to 14 × 90s to spend fewer requests.
 * Its comment recorded the cost as *"up to a minute of extra latency on a
 * verdict nobody is watching in real time"*. That was true and it was not the
 * cost. **Both spellings bound the wait at about twenty-one minutes**, and on
 * the same day a push queued behind another run exceeded it: the reader printed
 * *"NO VERDICT … gave up after 14 polls. That is a timeout, not a verdict"* and
 * exited 2, correctly, on a commit that went green.
 *
 * The instrument was right and the bound was not — and the change read as an
 * improvement because the number that shrank was the one being complained
 * about. **An optimisation that trades request count for the same wall clock
 * has bought no headroom** (finding ZZZZZ-1). The quota that motivated it had
 * already been removed by other means in the same commit: `githubFetch` now
 * sends a token, so the limit is 5,000 an hour rather than 60.
 *
 * So the ceiling is derived from what is actually waited for, which is a run
 * **plus whatever it queues behind**: twelve minutes at the long end, doubled
 * for one predecessor, is twenty-four — and 27 × 90s is **forty minutes**, which
 * leaves room for a second. At 5,000 requests an hour that costs nothing worth
 * counting, and a timeout stays a timeout rather than becoming a longer silence.
 */
const POLL_SECONDS = 90;
const MAX_POLLS = 27;

/** @param {number} attempt */
function runsUrl(attempt) {
  return `https://api.github.com/repos/${REPO}/actions/runs?per_page=8&poll=${String(attempt)}`;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Per-poll trace. Silent unless `--verbose`, so there is nothing to pipe away.
 *
 * The final verdict is NOT written through this — a quiet mode that also
 * swallows the answer would be the same defect one layer further in.
 *
 * @param {string} line
 */
function trace(line) {
  if (process.argv.includes('--verbose')) process.stdout.write(line);
}

/**
 * The commit this shell is running in, read from git.
 *
 * The one impure half of the argument work, kept here so {@link boardTarget}
 * stays a function of literals. It is not validated here either — the shape is
 * that function's judgement, and a second opinion about what a sha looks like
 * is how the first one drifted.
 */
function headSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function main() {
  const { sha, once } = boardTarget(process.argv.slice(2), { headSha: headSha() });

  /** @type {Map<number, number>} */
  const seen = new Map();

  // Refusals are collected rather than only traced, so the give-up message can
  // say WHY it never got an answer. Quiet output must not mean a quieter
  // diagnosis: a run that spent forty polls on HTTP 403 and one that spent them
  // on a slow queue are different states, and the terse form has to keep them
  // apart or it has recreated the defect it exists to remove.
  /** @type {string[]} */
  const refusals = [];

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    /** @type {unknown} */
    let body;
    try {
      // `critical`: this is the caller the reserve exists to protect, so the
      // budget never refuses it. GitHub still can, and that is reported as
      // itself — a refusal is not a board state.
      const response = await githubFetch(runsUrl(attempt), { purpose: 'critical' });
      if (!response.ok) {
        // A refusal is not a board state. Printed as itself so an expired token
        // or a rate limit cannot spend every poll looking like a slow run — and
        // now with WHICH of the three it is: no token, a rejected one, or a
        // spent quota. They share an HTTP status and want three different
        // actions, and this token expires on a date, so an expiry that reads as
        // a network error is an afternoon on the wrong problem.
        const remaining = Number(response.headers.get('x-ratelimit-remaining'));
        const why = describeAuthorisation(
          response.status,
          Number.isNaN(remaining) ? null : remaining,
        );
        refusals.push(`HTTP ${String(response.status)} — ${why}`);
        trace(`  poll ${String(attempt)}: HTTP ${String(response.status)} — ${why}\n`);
        if (once) return 2;
        await sleep(POLL_SECONDS * 1000);
        continue;
      }
      body = await response.json();
    } catch (error) {
      refusals.push(`request failed — ${formatError(error)}`);
      trace(`  poll ${String(attempt)}: request failed — ${formatError(error)}\n`);
      if (once) return 2;
      await sleep(POLL_SECONDS * 1000);
      continue;
    }

    const { verdict, reason, green } = boardVerdict(body, { sha, seen });
    trace(`  poll ${String(attempt)}: ${verdict.toUpperCase()} — ${reason}\n`);

    if (verdict === 'complete') {
      // `green` is DERIVED IN THE DECIDER, and this line is the whole reason.
      // It used to be computed here, from the rendered `reason` string:
      // `reason.includes('=success') && !reason.includes('=failure')`. That
      // called `CI=cancelled, Guards=success` GREEN — the exact state 9292d1f
      // was in, and the state this instrument exists to make visible. It also
      // passed `timed_out` and `skipped`.
      //
      // Two things were wrong and only one of them was the predicate: greenness
      // was read off a HUMAN-READABLE SUMMARY rather than off the data, and it
      // lived in this shell, which has no proof, rather than in the module that
      // does. The shell prints what it is handed.
      process.stdout.write(`\n${green ? 'GREEN' : 'NOT GREEN'} at ${sha}: ${reason}\n`);
      return green ? 0 : 1;
    }
    if (once) return verdict === 'pending' ? 3 : 2;

    // HOW LONG TO WAIT IS DERIVED FROM THIS PAYLOAD, not from POLL_SECONDS
    // alone (finding DDDD-28). Both seats on this machine share ~60
    // unauthenticated requests an hour, and forty polls at thirty seconds spend
    // a twenty-minute window on runs that finish in a fraction of it — so most
    // of a read's cost went on asking about a run that had not finished, and
    // that is what starved the board check the reviewing seat must run.
    //
    // The decision is in `boardStatus.mjs` because this file prints what it is
    // handed: a schedule computed HERE would have no proof, which is the exact
    // mistake the greenness predicate made before it moved.
    const paced = pollDelaySeconds(parseRuns(body), {
      sha,
      nowMs: Date.now(),
      fallbackSeconds: POLL_SECONDS,
    });
    trace(
      `  poll ${String(attempt)}: waiting ${paced.seconds.toFixed(0)}s ` +
        `(derived from ${String(paced.derivedFrom)} completed run(s)` +
        `${paced.medianSeconds === null ? '' : `, median ${paced.medianSeconds.toFixed(0)}s`})\n`,
    );
    await sleep(paced.seconds * 1000);
  }

  const refused = refusals.length;
  process.stdout.write(
    `\nNO VERDICT at ${sha}: gave up after ${String(MAX_POLLS)} polls. That is a timeout, ` +
      `not a verdict.\n` +
      (refused > 0
        ? `  ${String(refused)} of them were refusals, the last being ${refusals[refused - 1] ?? ''}. ` +
          `A refusal is not a board state — the API declined to answer, so nothing here is\n` +
          `  evidence about the commit. Exit code 2, which is neither green nor red.\n`
        : `  Exit code 2, which is neither green nor red.\n`),
  );
  return 2;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  },
);
