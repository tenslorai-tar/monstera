// @ts-check
/**
 * Proves a killed proof's leftovers are repaired by the NEXT run's startup.
 *
 * ## The case that separates, and the obvious one that does not
 *
 * *Run a proof and find a clean tree afterwards* is satisfied by the `finally`
 * that has always been there. It proves nothing about the state this exists
 * for, because in that run the `finally` ran.
 *
 * The separating case plants a leftover **by hand, before the proof starts**.
 * No `finally` in that run has anything to clean up — the file was never
 * created by it — so a clean tree afterwards can only be the startup sweep. If
 * the sweep is deleted, this case is the one that goes red, and the `finally`
 * cases stay green exactly as they do today.
 *
 * ## Driven through a REAL proof, and the cheap one on purpose
 *
 * `electronImports.proof.mjs` takes about 8 seconds; `boundaries.proof.mjs`
 * takes over 180 and is the one whose timeout caused the incident. Running the
 * slow one to prove a shared function is called would make this proof the thing
 * somebody bounds and kills, which is the failure it is about.
 *
 * BOTH NAMES ARE PLANTED and both are asserted gone, which is what makes the
 * cheap one sufficient: the sweep is shared and name-driven, so a run that
 * repairs a `__boundary_probe__.ts` from inside the import proof shows the
 * sweep is not scoped to its own caller's probe.
 *
 * Usage: node scripts/proofs/probeLeftovers.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import {
  PROBE_NAMES,
  formatProbeLeftovers,
  plantProbeLeftover,
  sweepProbeLeftovers,
} from '../lib/probeLeftovers.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {string} path @param {string} contents */
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

/** The two places a real proof plants, named the way those proofs name them. */
const BOUNDARY_LEFTOVER = join(REPO_ROOT, 'packages', 'ui', 'src', '__boundary_probe__.ts');
const IMPORT_LEFTOVER = join(REPO_ROOT, 'scripts', '__import_probe__.mjs');

try {
  check(
    'the name list carries every probe both proofs plant',
    PROBE_NAMES.includes('__boundary_probe__.ts') &&
      PROBE_NAMES.includes('__import_probe__.mjs') &&
      PROBE_NAMES.includes('__import_probe__.js'),
    `the list is ${JSON.stringify(PROBE_NAMES)}. A probe whose name is not here is planted by ` +
      `a proof and swept by nothing, which is this defect wearing a new filename.`,
  );

  // ------------------------------------------------------------------
  // The unit, before the end-to-end case: the walk itself.
  // ------------------------------------------------------------------
  plantProbeLeftover(BOUNDARY_LEFTOVER, write);
  plantProbeLeftover(IMPORT_LEFTOVER, write);

  check(
    'CONTROL: the planted leftovers really are on disk, so the sweep has a target',
    existsSync(BOUNDARY_LEFTOVER) && existsSync(IMPORT_LEFTOVER),
    `boundary=${String(existsSync(BOUNDARY_LEFTOVER))} import=${String(existsSync(IMPORT_LEFTOVER))}. ` +
      `Every case below asserts a file is ABSENT, which is what a plant that silently failed ` +
      `produces too — so the plant is checked before the sweep runs.`,
  );

  const removed = sweepProbeLeftovers(REPO_ROOT);

  check(
    'the sweep removes both, from two different directories',
    !existsSync(BOUNDARY_LEFTOVER) && !existsSync(IMPORT_LEFTOVER),
    `boundary=${String(existsSync(BOUNDARY_LEFTOVER))} import=${String(existsSync(IMPORT_LEFTOVER))}. ` +
      `The two live under \`packages/*/src\` and \`scripts/\`, which is the point: a walk rooted ` +
      `at one proof's own directory would repair that proof and leave the other's.`,
  );

  check(
    'and it reports what it removed, rather than repairing silently',
    removed.length === 2 && formatProbeLeftovers(removed, REPO_ROOT) !== null,
    `removed ${JSON.stringify(removed)}. A silent repair leaves the reader who is currently ` +
      `staring at a build error in a file they did not write with nothing to connect the two.`,
  );

  check(
    'CONTROL: on a clean tree it removes nothing and says nothing',
    (() => {
      const second = sweepProbeLeftovers(REPO_ROOT);
      return second.length === 0 && formatProbeLeftovers(second, REPO_ROOT) === null;
    })(),
    `a second sweep found something. It runs unconditionally at the top of two proofs, so a ` +
      `sweep that reported on a clean tree would print on every run and be ignored on the one ` +
      `that mattered.`,
  );

  // ------------------------------------------------------------------
  // END TO END, and this is the case the section header is about: a
  // leftover no `finally` in the run about to start can account for.
  // ------------------------------------------------------------------
  plantProbeLeftover(BOUNDARY_LEFTOVER, write);
  plantProbeLeftover(IMPORT_LEFTOVER, write);

  const run = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'proofs', 'electronImports.proof.mjs')],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  check(
    'A PROOF STARTED OVER A KILLED RUN’S LEFTOVERS REPAIRS THE TREE',
    !existsSync(BOUNDARY_LEFTOVER) && !existsSync(IMPORT_LEFTOVER),
    `boundary=${String(existsSync(BOUNDARY_LEFTOVER))} import=${String(existsSync(IMPORT_LEFTOVER))}. ` +
      `Neither file was created by that run, so its \`finally\` has nothing to do with either — ` +
      `only the startup sweep can have removed them. Delete the sweep and this is the one case ` +
      `that goes red.`,
  );

  check(
    'CONTROL: and that proof still passed, so the sweep did not break it',
    run.status === 0,
    `it exited ${String(run.status)}:\n${`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-1200)}\n` +
      `      A sweep that removed a file the run then needed would repair the tree and fail the ` +
      `proof, which is a worse trade than the leftover.`,
  );

  // FAILURES FIRST, and `format` only on the success path. `passRoster.mjs`
  // does not record a failing case — `record` returns early when a failure was
  // pushed since the mark — so calling `format` over a red run reports the
  // failures as cases that STOPPED RUNNING, which is a different and much more
  // alarming diagnosis than the true one.
  if (failures.length > 0) {
    process.stderr.write(
      `\nProbe-leftover proof — ${String(failures.length)} failure(s):\n\n` +
        `${failures.map((failure) => `  - ${failure}`).join('\n\n')}\n\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(roster.format('probe-leftover case'));
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  // This proof plants deliberately, so it cleans up deliberately — and through
  // the same sweep, because a bespoke `rmSync` pair here would be a second
  // opinion about what a leftover is.
  sweepProbeLeftovers(REPO_ROOT);
}
