/**
 * Which jobs and steps failed for one sha.
 *
 * `board.mjs` answers *is this sha green*, which is the question before a push
 * and the only one it should answer. This answers the question that follows a
 * red: **which step, in which job, on which runner image.** They are separate
 * scripts because a reader that also diagnoses is a reader whose green path has
 * more ways to be wrong.
 *
 * ## Why it exists at all, rather than a `curl` and a `grep`
 *
 * Because that grep has already cost this project a finding. `grep -A3` over a
 * runs payload was structurally pinned at zero, for every input, because the
 * field it anchored on sits five lines above `status` — a **line-scoped search
 * over a structure that has no lines**. Parsing the JSON and reading the field
 * is the unit the payload actually has, and having it in a file means the next
 * red is diagnosed rather than re-derived at the cost of a window someone picks
 * again.
 *
 * ## What this can and cannot see, from this seat
 *
 * The runs and jobs routes answer unauthenticated. **Job LOGS return 403
 * without owner authentication**, so this prints step conclusions and never a
 * log line. That limit is printed rather than left for the reader to infer from
 * an empty section — a diagnosis missing its evidence must not read like one
 * that found nothing wrong.
 *
 * ## It is a DIAGNOSTIC and has no proof, which is stated rather than implied
 *
 * Nothing gates on it and nothing is concluded from its silence, so the one
 * control it carries is the one that matters: an empty run list is refused with
 * exit 3 and a sentence saying why, because *no run lists this sha* is the same
 * output a wrong sha, an aged-out sha and a never-started run all produce
 * (item 4b). A green board is still `board.mjs`'s answer, not this file's.
 *
 * Usage: node scripts/ci/failingJobs.mjs <full sha>
 */

import { githubFetch } from '../lib/githubFetch.mjs';
import { formatError } from '../lib/reportError.mjs';

const sha = process.argv[2];
const RECENT = '--recent';
if (sha !== RECENT && (sha === undefined || !/^[0-9a-f]{40}$/.test(sha))) {
  process.stderr.write(
    'usage: node scripts/ci/failingJobs.mjs <full 40-character sha>\n' +
      '       node scripts/ci/failingJobs.mjs --recent\n',
  );
  process.exit(2);
}

const REPO = 'tenslorai-tar/monstera';

/**
 * `bulk`, and it is the right classification rather than a cautious one: this
 * walks a run's jobs and can spend several requests, while the reserve exists
 * so that a board read stays possible afterwards. A diagnosis that costs the
 * ability to verify the fix is the trade DDDD-28 named.
 *
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function json(path) {
  const response = await githubFetch(`https://api.github.com/repos/${REPO}${path}`, {
    purpose: 'bulk',
  });
  if (!response.ok) {
    throw new Error(`${path} answered ${String(response.status)} ${response.statusText}`);
  }
  return /** @type {Record<string, unknown>} */ (await response.json());
}

try {
  if (sha === RECENT) {
    // ONE REQUEST, and it answers a question the per-sha view structurally
    // cannot: whether a run EXISTS. A sha with no run and a sha whose run was
    // cancelled read very differently here and identically there, because a
    // filtered query returns an empty list for both.
    const recent = await json('/actions/runs?per_page=20');
    const list = Array.isArray(recent['workflow_runs']) ? recent['workflow_runs'] : [];
    if (list.length === 0) {
      process.stdout.write('No runs at all. That is a broken read, not a quiet repository.\n');
      process.exit(3);
    }
    for (const run of list) {
      const entry = /** @type {Record<string, unknown>} */ (run);
      process.stdout.write(
        `${String(entry['head_sha']).slice(0, 8)}  ${String(entry['name']).padEnd(10)} ` +
          `${String(entry['status']).padEnd(11)} ${String(entry['conclusion'])}` +
          `   ${String(entry['created_at'])}\n`,
      );
    }
    process.exit(0);
  }

  const runs = await json(`/actions/runs?per_page=20&head_sha=${sha}`);
  const list = Array.isArray(runs['workflow_runs']) ? runs['workflow_runs'] : [];
  if (list.length === 0) {
    // AN EMPTY LIST IS NOT A CLEAN BILL. It is the reassuring answer this
    // instrument could give for a wrong sha, an aged-out sha, or a workflow
    // that never started — and none of those is "nothing failed".
    process.stdout.write(`No workflow run lists this sha. That is NOT "nothing failed": it is the\n`);
    process.stdout.write(`same output an unknown sha, an aged-out sha and a never-started run give.\n`);
    process.exit(3);
  }

  let failures = 0;
  for (const run of list) {
    const entry = /** @type {Record<string, unknown>} */ (run);
    const name = String(entry['name']);
    const conclusion = String(entry['conclusion']);
    process.stdout.write(`\n${name}: ${String(entry['status'])} / ${conclusion}\n`);
    if (conclusion === 'success') continue;

    const jobs = await json(`/actions/runs/${String(entry['id'])}/jobs?per_page=100`);
    const jobList = Array.isArray(jobs['jobs']) ? jobs['jobs'] : [];
    for (const job of jobList) {
      const one = /** @type {Record<string, unknown>} */ (job);
      if (String(one['conclusion']) === 'success' || String(one['conclusion']) === 'skipped') continue;
      failures += 1;
      process.stdout.write(`  JOB ${String(one['name'])} — ${String(one['conclusion'])}\n`);
      const steps = Array.isArray(one['steps']) ? one['steps'] : [];
      for (const step of steps) {
        const s = /** @type {Record<string, unknown>} */ (step);
        const outcome = String(s['conclusion']);
        if (outcome === 'success' || outcome === 'skipped') continue;
        process.stdout.write(`    step ${String(s['number'])}: ${String(s['name'])} — ${outcome}\n`);
      }
    }
  }

  process.stdout.write(
    `\n${String(failures)} failing job(s). Step names only — job logs answer 403 without owner\n` +
      `authentication from this seat, so nothing above is a log line and the cause is inferred\n` +
      `from WHICH step stopped rather than from what it printed.\n`,
  );
  process.exit(failures > 0 ? 1 : 0);
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(2);
}
