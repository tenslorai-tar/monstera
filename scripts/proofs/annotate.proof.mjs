// @ts-check
/**
 * Proves the annotation wrapper carries a failure's own words into a public
 * place, and stays out of the way otherwise.
 *
 * Both directions, because a wrapper that annotated everything and one that
 * annotated nothing both produce a green CI run: the first floods the summary
 * with noise from passing steps, the second is the opacity it exists to remove.
 *
 * Usage: node scripts/proofs/annotate.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = join(REPO_ROOT, 'scripts', 'ci', 'annotate.mjs');

/** A string only the fixture prints, so finding it proves the path carried it. */
const MARKER = 'the-line-only-a-failing-proof-would-print';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-annotate-'));

/**
 * Writes a fixture script and runs it through the wrapper.
 *
 * @param {string} name
 * @param {string} body
 * @param {readonly string[]} [flags]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function throughWrapper(name, body, flags = []) {
  const script = join(scratch, name);
  writeFileSync(script, body, 'utf8');
  const result = spawnSync(process.execPath, [WRAPPER, ...flags, script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

try {
  const failing = throughWrapper(
    'fails.mjs',
    [
      `process.stdout.write('${MARKER}\\n');`,
      `process.stdout.write('a second line, to prove more than one is carried\\n');`,
      `process.exit(3);`,
    ].join('\n'),
  );

  check(
    'a failing script produces an ::error annotation',
    failing.stderr.includes('::error title='),
    `stderr carried no workflow command:\n${failing.stderr.slice(0, 600)}`,
  );

  check(
    "the annotation contains the failure's OWN words",
    failing.stderr.includes(MARKER),
    `the annotation did not carry "${MARKER}". An annotation that fires without the text is ` +
      `the same opacity with a louder wrapper around it — the whole point is the message.`,
  );

  check(
    'newlines are escaped, so a multi-line failure survives as one command',
    failing.stderr.includes('%0A'),
    `no %0A in the annotation. A raw newline ends the workflow command, so everything after ` +
      `the first line would be dropped silently — which looks like a one-line failure.`,
  );

  check(
    "the wrapper preserves the script's exit code rather than inventing one",
    failing.status === 3,
    `exit ${String(failing.status)}, expected 3. A wrapper that normalised the code would make ` +
      `every failure look alike to anything reading it.`,
  );

  const passing = throughWrapper(
    'passes.mjs',
    `process.stdout.write('${MARKER}\\n');\nprocess.exit(0);\n`,
  );

  check(
    'CONTROL: a passing script is passed through with NO annotation',
    passing.status === 0 &&
      passing.stdout.includes(MARKER) &&
      !passing.stderr.includes('::error'),
    `exit ${String(passing.status)}, stdout carried the marker: ` +
      `${String(passing.stdout.includes(MARKER))}, stderr had ::error: ` +
      `${String(passing.stderr.includes('::error'))}. Without this the three cases above are ` +
      `satisfied by a wrapper that annotates unconditionally, which would bury every real ` +
      `failure under the passing ones.`,
  );

  // -------------------------------------------------------------------------
  // `--always`. It exists so a MEASUREMENT taken on a runner is readable by
  // somebody other than the owner: job logs answer 403 unauthenticated, and the
  // default carries a failing step's output only, so a green measurement lands
  // where nobody can read it (ADR-0025's note of 2026-08-27).
  //
  // The danger it introduces is the opposite of the one it fixes: a flag that
  // reports on success is one statement away from reporting success. So the
  // second case below is the load-bearing one.
  // -------------------------------------------------------------------------
  const alwaysPassing = throughWrapper(
    'always-passes.mjs',
    `process.stdout.write('${MARKER}\\n');\nprocess.exit(0);\n`,
    ['--always'],
  );

  check(
    '--always turns a PASSING run into a ::notice carrying its own words',
    alwaysPassing.status === 0 &&
      alwaysPassing.stdout.includes('::notice title=') &&
      alwaysPassing.stdout.includes(MARKER),
    `exit ${String(alwaysPassing.status)}, ::notice present: ` +
      `${String(alwaysPassing.stdout.includes('::notice title='))}, carried the marker: ` +
      `${String(alwaysPassing.stdout.includes(MARKER))}. A notice without the text is the same ` +
      `unreadable log with a louder wrapper. And a flag parsed as the target script would run ` +
      `nothing, which this case sees as a missing marker rather than as a passing run.`,
  );

  const alwaysFailing = throughWrapper(
    'always-fails.mjs',
    `process.stdout.write('${MARKER}\\n');\nprocess.exit(3);\n`,
    ['--always'],
  );

  check(
    '--always emits NO notice on a failing run, only the error',
    alwaysFailing.status === 3 &&
      alwaysFailing.stderr.includes('::error title=') &&
      !alwaysFailing.stdout.includes('::notice') &&
      !alwaysFailing.stderr.includes('::notice'),
    `exit ${String(alwaysFailing.status)}, ::error present: ` +
      `${String(alwaysFailing.stderr.includes('::error title='))}, ::notice present: ` +
      `${String(alwaysFailing.stdout.includes('::notice') || alwaysFailing.stderr.includes('::notice'))}.\n` +
      `      THE ABSENT NOTICE IS THE ASSERTION, and asserting the surviving ::error instead was ` +
      `the first version of this case: dropping the \`status === 0\` guard leaves the error ` +
      `exactly where it was, so that case passed its own mutation. A failing step that also ` +
      `announces a notice reads as reporting a result, and GitHub caps annotations per run, so ` +
      `every red step would spend one of the slots its own error needs.`,
  );

  check(
    'CONTROL: the notice comes from the FLAG, not from every passing run',
    !passing.stdout.includes('::notice') && !passing.stderr.includes('::notice'),
    `the same passing script emitted a ::notice with no --always, so the case above is ` +
      `satisfied by a wrapper that annotates unconditionally and separates nothing. GitHub ` +
      `caps annotations per run, so an unconditional notice would crowd out real errors.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} annotate failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('annotate case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failures.length > 0) process.exitCode = 1;
