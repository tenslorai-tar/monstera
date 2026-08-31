// @ts-check
/**
 * Proves the could-not-look spelling scan can SEE, REFUSE and TOLERATE.
 *
 * A scan whose good news is silence needs all three, and this one's silence is
 * the answer everybody asking wants to hear — *nobody is spelling their own*.
 *
 * - **see**: a fixture emitting the marker's shape without importing the owner
 *   is reported;
 * - **refuse**: a tree where the control file is absent is refused rather than
 *   reported clean, because a wrong root and a clean repository produce the
 *   same empty list;
 * - **tolerate**: the four shapes that are NOT run-level verdicts — the word in
 *   a regex, in fixture source, inside a per-item count, and in prose — stay
 *   unreported, because a scan that cries wolf is one somebody turns off.
 *
 * Usage: node scripts/proofs/unverifiableSpelling.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { spellingReport, withoutComments } from '../lib/unverifiableSpelling.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/**
 * A tree with a `scripts/` directory holding the named files.
 *
 * @param {Record<string, string>} files repo-relative path to contents
 * @returns {string}
 */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-spelling-'));
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
  return root;
}

/**
 * The control file's content, which must be present for any run to be believed.
 *
 * It imports the owner, so it is a file the scan must SEE and must not REPORT —
 * both halves in one fixture, which is what makes a clean result from it mean
 * something.
 */
const CONTROL_SOURCE =
  "import { PARTIAL_MARKER } from './lib/unverifiable.mjs';\n" +
  'export const seen = (text) => text.includes(PARTIAL_MARKER);\n';

const scratches = [];

try {
  // ---- SEE ----
  {
    const root = tree({
      'scripts/checkLocal.mjs': CONTROL_SOURCE,
      'scripts/proofs/offender.proof.mjs':
        'process.stdout.write(`  UNVERIFIABLE  the runtime is absent\\n`);\n',
    });
    scratches.push(root);
    const report = spellingReport({ root });
    check(
      'a script emitting the marker SHAPE without importing the owner is reported',
      report.offenders.includes('scripts/proofs/offender.proof.mjs'),
      `offenders: ${JSON.stringify(report.offenders)}. This is the whole class: the wording ` +
        `reads correctly to a person and the harness files the run as a pass.`,
    );
    check(
      'and the control file, which imports the owner, is NOT reported',
      !report.offenders.includes('scripts/checkLocal.mjs') && report.sawControl,
      `the control was ${report.sawControl ? 'seen' : 'NOT SEEN'} and offenders are ` +
        `${JSON.stringify(report.offenders)}. A scan that reports its own owner's callers is ` +
        `one nobody can leave switched on.`,
    );
  }

  // ---- SEE, the second token ----
  {
    const root = tree({
      'scripts/checkLocal.mjs': CONTROL_SOURCE,
      'scripts/proofs/partial.proof.mjs':
        'process.stdout.write(`  PARTLY MEASURED  4 of 6\\n`);\n',
    });
    scratches.push(root);
    check(
      'the PARTIAL shape is caught too, not only the blank one',
      spellingReport({ root }).offenders.includes('scripts/proofs/partial.proof.mjs'),
      `only the first token is matched, so the third state acquires exactly the second ` +
        `opinions the first one had — which is the whole reason both are exported.`,
    );
  }

  // ---- REFUSE ----
  {
    const root = tree({ 'scripts/proofs/lonely.proof.mjs': 'export const x = 1;\n' });
    scratches.push(root);
    const report = spellingReport({ root });
    check(
      'REFUSE: a tree without the control file reports sawControl false',
      !report.sawControl && report.offenders.length === 0,
      `sawControl=${String(report.sawControl)}, offenders=${JSON.stringify(report.offenders)}. ` +
        `An empty offender list is what a clean repository and a broken scan both produce, so ` +
        `the control is the only thing separating them and the CLI exits 1 on it.`,
    );
  }

  // ---- TOLERATE ----
  {
    const root = tree({
      'scripts/checkLocal.mjs': CONTROL_SOURCE,
      // Every shape the first, wider rule reported and should not have. Read
      // from the four real files it named on its first run.
      'scripts/proofs/register.proof.mjs': 'const ok = /UNVERIFIABLE/u.test(output);\n',
      'scripts/proofs/fixtures.proof.mjs': 'const source = \'return "UNVERIFIABLE";\';\n',
      'scripts/security/report.mjs':
        'process.stdout.write(`  --  ${n} symbol(s) UNVERIFIABLE — nothing can witness them\\n`);\n',
      'scripts/lib/prose.mjs': '// The honest answer here is UNVERIFIABLE, and it is printed.\nexport const x = 1;\n',
    });
    scratches.push(root);
    const report = spellingReport({ root });
    check(
      'TOLERATE: a regex, fixture source, a per-item count and prose are all left alone',
      report.offenders.length === 0,
      `reported ${JSON.stringify(report.offenders)}. None of these can be matched by a harness: ` +
        `the property is the TOKEN a harness keys on, not the word a person writes. A scan ` +
        `that reports them is one somebody turns off, which costs the real class.`,
    );
  }

  // ---- The comment stripper, which is what makes TOLERATE possible ----
  check(
    'the stripper removes block and line comments and keeps the code',
    withoutComments('/* UNVERIFIABLE */\nconst a = 1;\n// UNVERIFIABLE\nconst b = 2;\n').includes(
      'const a = 1;',
    ) &&
      !withoutComments('/*   UNVERIFIABLE   */\nconst a = 1;\n').includes('UNVERIFIABLE') &&
      !withoutComments('const a = 1;\n//   UNVERIFIABLE  \n').includes('UNVERIFIABLE'),
    `the stripper either keeps a commented token — which reports every file that explains the ` +
      `state — or eats the code, which is the blind-search failure this proof's REFUSE case ` +
      `exists to catch one level up.`,
  );

  check(
    'THIS repository passes its own scan',
    spellingReport().offenders.length === 0 && spellingReport().sawControl,
    `${JSON.stringify(spellingReport().offenders)} still spell their own. The scan is run by ` +
      `hand on the day somebody needs an answer, so it carries its own positive control.`,
  );
} catch (error) {
  process.stderr.write(`MONSTERA_SPELLING_PROOF_FAILED ${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const root of scratches) rmSync(root, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} spelling-scan case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('spelling-scan case'),
);
if (failures.length > 0) process.exitCode = 1;
