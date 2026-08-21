// @ts-check
/**
 * Runs a script and, if it fails, re-emits its output as a **public** workflow
 * annotation.
 *
 * ## The gap this closes, and it has now cost two cycles
 *
 * GitHub serves Actions **logs** only to authenticated callers. Step names,
 * conclusions and durations are public; the text a failing step printed is not.
 * So a proof that fails on a runner is fully diagnosable by the repository owner
 * and completely opaque to everyone else — including to an agent working on the
 * repository, which is how `proof:rendererpolicy` failed on windows-latest with
 * the only public evidence being `Process completed with exit code 1`.
 *
 * That is FF-2's shape one layer up: **impossible to miss, impossible to
 * attribute.** This repository already solved it once for the Install step, and
 * `docs/JOURNAL.md` records the result — *"that is what ended the guessing"*.
 * This is the same remedy, made reusable instead of copied.
 *
 * Annotations ARE public: `/repos/{owner}/{repo}/check-runs/{id}/annotations`
 * needs no token on a public repository.
 *
 * ## What it does NOT do
 *
 * It does not interpret, summarise, or decide anything about the failure. It
 * moves bytes the runner already printed from a place nobody can read to a place
 * anybody can. A wrapper that decided which lines mattered would be a second
 * opinion about what a proof said, and the proofs here are written to be read.
 *
 * Usage: node scripts/ci/annotate.mjs <script-path> [args...]
 */

import { spawnSync } from 'node:child_process';

/** How many trailing lines of a failing run to carry into the annotation. */
const TAIL_LINES = 40;

/**
 * Escapes a string for a workflow command's message field.
 *
 * The order matters: `%` must be escaped first, or it would corrupt the
 * escapes introduced after it.
 *
 * @param {string} text
 * @returns {string}
 */
function forAnnotation(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

const [target, ...rest] = process.argv.slice(2);
if (target === undefined) {
  process.stderr.write('usage: node scripts/ci/annotate.mjs <script-path> [args...]\n');
  process.exit(2);
}

const result = spawnSync(process.execPath, [target, ...rest], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

// Passed through FIRST and in full, so the annotation is an addition to the log
// rather than a replacement for it. A wrapper that swallowed output would make
// the authenticated view worse in exchange for making the public one better.
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.error !== undefined) {
  process.stderr.write(
    `::error title=${target} could not be started::${forAnnotation(String(result.error))}\n`,
  );
  process.exit(1);
}

const status = result.status ?? 1;
if (status !== 0) {
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const tail = combined.split(/\r?\n/).slice(-TAIL_LINES).join('\n');
  process.stderr.write(
    `::error title=${target} failed (exit ${String(status)})::${forAnnotation(tail)}\n`,
  );
}

process.exit(status);
