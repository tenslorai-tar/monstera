// @ts-check
/**
 * Runs every check and proof this repository declares, DERIVED from
 * `package.json` rather than chosen.
 *
 * ## Why deriving matters more than the running (finding PPP-1)
 *
 * A commit went red on two guards that had both passed nothing, because I picked
 * which checks to run and picked by what I thought I had touched. Neither
 * failing check was on that list and neither would ever have been: the
 * connection from *a research probe imports the build* to *prove nothing can
 * trigger an unpinned Electron download* is not one intuition makes.
 *
 * **Selecting checks by relevance is a search, and its reassuring answer is
 * "nothing to run".** So the set is taken from the manifest, the way
 * `annotateCoverage.mjs` takes its proof set from the same place — every script
 * named `check:*` or `proof:*`, with no judgement anywhere in the path.
 *
 * ## WHAT THIS DOES NOT SEE, and the limits are the point
 *
 * PPP-1's first remedy was *run the whole Guards set locally*, and the reviewing
 * seat showed it catches neither of the two defects it was written for. That is
 * recorded plainly here rather than left to be rediscovered:
 *
 *   1. **A PROVISIONING-KEYED BRANCH.** The Guards failure was a case needing
 *      `apps/desktop/dist/`, which exists on a developer machine and not on a
 *      job that builds nothing. Running everything here would have been GREEN
 *      before the fix. This is audit item 3's inverse — the richer machine is
 *      the one that hides it — and no local sweep of any completeness can reach
 *      it.
 *   2. **A CI-ONLY PROOF.** `electronImports.proof.mjs` is invoked from
 *      `ci.yml` and from no Guards job. A script that is not in the manifest, or
 *      is registered only as a workflow path, is outside this set by
 *      construction.
 *
 * **The mechanism for both is the board.** This is a way to spend a minute
 * before pushing, not a way to stop reading the board afterwards.
 *
 * ## Three states, because two would lie
 *
 * `ok`, `FAILED`, and `TIMED OUT`. A script this harness cut short has not
 * passed, and reporting it as one would be the same collapse the register
 * refuses between *could not look* and *looked and found nothing*.
 *
 * ## Why the npm script is `local` and not `check:local`
 *
 * The derivation matches every `check:*` and `proof:*` name, so a script called
 * `check:local` would derive ITSELF and recurse until the machine gives up. The
 * name is load-bearing; renaming it into the pattern it scans is the obvious
 * tidy-up and it is the one thing not to do.
 *
 * Usage: node scripts/checkLocal.mjs [--timeout <seconds>] [--only <substring>]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Below this, the derivation is broken rather than the repository small.
 *
 * A manifest that parsed to an empty object, a renamed `scripts` key, or a
 * filter that stopped matching all report the same clean "nothing failed" —
 * which is the one output every way of breaking a search shares. There were 60+
 * such scripts when this floor was written; it is set well under that so an
 * ordinary deletion does not trip it, and well over zero so a broken derivation
 * cannot pass as a quiet repository.
 */
const FLOOR = 30;

const argv = process.argv.slice(2);
const timeoutIndex = argv.indexOf('--timeout');
const TIMEOUT_MS =
  timeoutIndex === -1 ? 180_000 : Number(argv[timeoutIndex + 1] ?? '180') * 1000;
const onlyIndex = argv.indexOf('--only');
const ONLY = onlyIndex === -1 ? null : (argv[onlyIndex + 1] ?? null);

/** @type {Record<string, string>} */
let scripts;
try {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  scripts = manifest.scripts ?? {};
} catch (cause) {
  process.stderr.write(`Could not read package.json: ${String(cause)}\n`);
  process.exit(70);
}

const derived = Object.keys(scripts)
  .filter((name) => name.startsWith('check:') || name.startsWith('proof:'))
  .sort();

if (derived.length < FLOOR) {
  process.stderr.write(
    `Derived only ${String(derived.length)} check/proof scripts from package.json, under a ` +
      `floor of ${String(FLOOR)}.\nThat is a broken derivation, not a quiet repository — a ` +
      `renamed "scripts" key and a filter that stopped matching both report zero failures.\n`,
  );
  process.exit(1);
}

const selected = ONLY === null ? derived : derived.filter((name) => name.includes(ONLY));

process.stdout.write(
  `${String(selected.length)} of ${String(derived.length)} declared check/proof script(s), ` +
    `derived from package.json.\n\n`,
);

/** @type {string[]} */
const failed = [];
/** @type {string[]} */
const timedOut = [];

/** @type {string[]} */
const notNode = [];
let passedCount = 0;

for (const name of selected) {
  // NODE DIRECTLY, NOT `npm run`, and this was measured rather than preferred.
  //
  // The first version spawned `npm run --silent <name>` with `shell: true` and a
  // timeout. On Windows that kills the SHELL and leaves the real node process
  // running, and every script after the first timeout then failed in 0.2s with
  // no output at all — three real timeouts followed by twenty spurious
  // failures. Run in isolation each of those passed in four seconds.
  //
  // A harness that invents failures is worse than none: this project has already
  // written that a scan which cries wolf is a scan someone relaxes. Invoking the
  // interpreter directly means the timeout kills the thing actually running.
  const command = scripts[name] ?? '';
  const parts = command.split(/\s+/u).filter((part) => part !== '');
  if (parts[0] !== 'node') {
    // Reported, not skipped. A script this harness cannot invoke is a hole in
    // the derivation, and a hole that prints nothing is the derivation lying
    // about its own coverage.
    notNode.push(`${name} (${command})`);
    process.stdout.write(`  NOT RUN  ${name} — not a bare \`node\` invocation\n`);
    continue;
  }
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, parts.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const took = `${seconds.toFixed(1)}s`;

  // `signal` is how spawnSync reports a timeout kill, and it must not be read
  // as an ordinary non-zero exit: one is "this check says no", the other is
  // "this harness stopped listening".
  // A TIMEOUT STOPS THE SWEEP. Measured, and it is not caution.
  //
  // `spawnSync`'s timeout kills the child it started and not that child's own
  // grandchildren, and several proofs here spawn node or Electron. So every
  // timeout leaves processes running, they accumulate, and the machine slows
  // under them: a run with a 60s bound reported `check:docs` — which takes two
  // seconds — as TIMED OUT, third in the list. Everything after the first
  // timeout is measuring the harness's own wreckage.
  //
  // Killing a process tree properly on Windows needs a job object, which is a
  // real unit of work and not one to bury in a convenience script. Until then
  // the honest behaviour is to stop: one unreadable measurement is a reason to
  // look, and twenty invented ones are a reason to stop using the tool.
  if (run.signal !== null && run.signal !== undefined) {
    timedOut.push(name);
    process.stdout.write(
      `  TIMED OUT  ${name} (${took})\n` +
        `      STOPPING. A timeout orphans that script's own child processes, and every\n` +
        `      result after one is measured against a machine carrying them. Re-run with\n` +
        `      --timeout raised, or --only, rather than reading what would follow.\n`,
    );
    break;
  }
  if (run.status !== 0) {
    failed.push(name);
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const firstProblem =
      output
        .split('\n')
        .find((line) => /\b(FAIL|Error|error)\b/u.test(line))
        ?.trim() ?? '(no diagnostic line found)';
    process.stdout.write(`  FAILED  ${name} (${took})\n      ${firstProblem.slice(0, 200)}\n`);
    continue;
  }
  passedCount += 1;
  process.stdout.write(`  ok  ${name} (${took})\n`);
}

// COUNTED FROM WHAT RAN, not from what was selected. The sweep stops at the
// first timeout, so `selected.length` would report every script it never
// reached as a pass — the arithmetic quietly inventing the result the operator
// was hoping for.
const attempted = failed.length + timedOut.length + notNode.length + passedCount;
process.stdout.write(
  `\n${String(passedCount)} passed, ${String(failed.length)} failed, ` +
    `${String(timedOut.length)} timed out, ${String(notNode.length)} not run — ` +
    `${String(attempted)} of ${String(selected.length)} attempted.\n`,
);
if (attempted < selected.length) {
  process.stdout.write(
    `${String(selected.length - attempted)} script(s) were never reached and are NOT passes.\n`,
  );
}
if (notNode.length > 0) {
  process.stdout.write(`Not a bare node invocation: ${notNode.join(', ')}\n`);
}
if (timedOut.length > 0) {
  process.stdout.write(
    `Timed out is NOT passed: ${timedOut.join(', ')}\n` +
      `Raise --timeout, or run those on the board.\n`,
  );
}
process.stdout.write(
  'This set cannot see a provisioning-keyed branch or a proof registered only in a ' +
    'workflow. The board is the mechanism; this is the minute before the push.\n',
);

process.exit(failed.length === 0 && timedOut.length === 0 && notNode.length === 0 ? 0 : 1);
