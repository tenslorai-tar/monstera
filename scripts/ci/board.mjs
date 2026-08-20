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
 * Usage:
 *   node scripts/ci/board.mjs <sha>          wait for it
 *   node scripts/ci/board.mjs <sha> --once   one look, no waiting
 */

import { boardVerdict } from '../lib/boardStatus.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO = 'tenslorai-tar/monstera';
const POLL_SECONDS = 30;
const MAX_POLLS = 40;

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

async function main() {
  const sha = process.argv[2];
  const once = process.argv.includes('--once');
  if (sha === undefined || sha.length < 7) {
    throw new Error(
      'usage: node scripts/ci/board.mjs <sha> [--once]\n' +
        'Give at least 7 characters. A short sha is what made the first version of this ' +
        'instrument report zero runs and call it "not yet".',
    );
  }

  /** @type {Map<number, number>} */
  const seen = new Map();

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    /** @type {unknown} */
    let body;
    try {
      const response = await fetch(runsUrl(attempt), {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        // A refusal is not a board state. Printed as itself so an expired token
        // or a rate limit cannot spend forty polls looking like a slow run.
        process.stdout.write(`  poll ${String(attempt)}: HTTP ${String(response.status)}\n`);
        if (once) return 2;
        await sleep(POLL_SECONDS * 1000);
        continue;
      }
      body = await response.json();
    } catch (error) {
      process.stdout.write(`  poll ${String(attempt)}: request failed — ${formatError(error)}\n`);
      if (once) return 2;
      await sleep(POLL_SECONDS * 1000);
      continue;
    }

    const { verdict, reason, green } = boardVerdict(body, { sha, seen });
    process.stdout.write(`  poll ${String(attempt)}: ${verdict.toUpperCase()} — ${reason}\n`);

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
    await sleep(POLL_SECONDS * 1000);
  }

  process.stdout.write(
    `\nGave up after ${String(MAX_POLLS)} polls. That is a timeout, not a verdict.\n`,
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
