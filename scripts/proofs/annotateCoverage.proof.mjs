// @ts-check
/**
 * The annotate-coverage scan can SEE, can REFUSE, and does not fire on what is
 * already correct (finding EEE-3).
 *
 * `scripts/lib/annotateCoverage.mjs` is a search, and its reassuring answer —
 * *no violations* — is also what a wrong pattern, an empty file set and a broken
 * derivation all produce. Every case here exists because one of those ways of
 * being blind returns the same clean result as a correct tree.
 *
 * The scan is fed **text**, never the repository, except where a case is
 * explicitly about the repository. A proof that could only run against the real
 * workflows would go red the day someone adds a step, which is the coupling that
 * cost `advisoryRegister.proof.mjs` a case when a verdict was correctly retired.
 */

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { findProofInvocations, proofEntryPoints, scan } from '../lib/annotateCoverage.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 12 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * A throwaway repository shaped like this one: a package.json with proof
 * scripts and a workflow directory.
 *
 * @param {{ scripts?: Record<string, string>, workflows?: Record<string, string> }} shape
 * @returns {string}
 */
function fixture(shape) {
  const dir = mkdtempSync(join(tmpdir(), 'monstera-annotate-'));
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'fixture', scripts: shape.scripts ?? {} }, null, 2)}\n`,
    'utf8',
  );
  const workflows = join(dir, '.github', 'workflows');
  mkdirSync(workflows, { recursive: true });
  for (const [name, text] of Object.entries(shape.workflows ?? {})) {
    writeFileSync(join(workflows, name), text, 'utf8');
  }
  return dir;
}

/** @type {string[]} */
const scratches = [];
/** @param {Parameters<typeof fixture>[0]} shape */
function tempRepo(shape) {
  const dir = fixture(shape);
  scratches.push(dir);
  return dir;
}

try {
  // -------------------------------------------------------------------------
  // CAN IT SEE? An unwrapped proof step must be reported.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: { 'proof:thing': 'node scripts/proofs/thing.proof.mjs' },
      workflows: {
        'a.yml': '      - name: prove\n        run: node scripts/proofs/thing.proof.mjs\n',
      },
    });
    const result = scan({ root });
    check(
      'an UNWRAPPED proof step is reported',
      result.violations.length === 1 && result.violations[0]?.line === 2,
      `violations = ${JSON.stringify(result.violations)}`,
    );
    check(
      'and the scan says it is BLIND, because nothing wrapped was found',
      result.blind,
      'With no wrapped invocation anywhere, a clean result would be indistinguishable from a ' +
        'scan that recognised nothing. It must say so.',
    );
  }

  // -------------------------------------------------------------------------
  // DOES IT TOLERATE what is correct? A wrapped step is not a violation, and it
  // is what makes the scan non-blind.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: { 'proof:thing': 'node scripts/proofs/thing.proof.mjs' },
      workflows: {
        'a.yml':
          '      - name: prove\n' +
          '        run: node scripts/ci/annotate.mjs scripts/proofs/thing.proof.mjs\n',
      },
    });
    const result = scan({ root });
    check(
      'a WRAPPED proof step is not a violation',
      result.violations.length === 0,
      `violations = ${JSON.stringify(result.violations)}`,
    );
    check(
      'and finding one makes the scan non-blind',
      !result.blind && result.wrapped === 1,
      `wrapped = ${String(result.wrapped)}, blind = ${String(result.blind)}`,
    );
  }

  // -------------------------------------------------------------------------
  // `npm run proof:x` CAN NEVER SATISFY THE RULE. The wrapper spawns its target
  // with process.execPath, so a workflow that wants it names the path.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: { 'proof:thing': 'node scripts/proofs/thing.proof.mjs' },
      workflows: { 'a.yml': '        run: npm run proof:thing\n' },
    });
    const result = scan({ root });
    check(
      'an npm-script invocation is reported, and the diagnostic says why',
      result.violations.length === 1 &&
        `${result.violations[0]?.why}`.includes('the wrapper cannot spawn'),
      `violations = ${JSON.stringify(result.violations)}`,
    );
  }

  // -------------------------------------------------------------------------
  // THE PREFIX CASE, and it is here because the first version of this scan got
  // it wrong: `includes('npm run proof:shim')` is true of a line running
  // `proof:shimreach`, so a violation was reported against a script that was not
  // on the line. It never changed WHETHER a line was reported, so a pass/fail
  // assertion could not have caught it — only reading the output did.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: {
        'proof:shim': 'node scripts/proofs/shim.proof.mjs',
        'proof:shimreach': 'node scripts/proofs/shimReach.proof.mjs',
      },
      workflows: { 'a.yml': '        run: npm run proof:shimreach\n' },
    });
    const result = scan({ root });
    check(
      'a longer script name is not attributed to its PREFIX',
      `${result.violations[0]?.why}`.includes('proof:shimreach'),
      `why = ${JSON.stringify(result.violations[0]?.why)} — a diagnostic naming the wrong ` +
        `script sends the reader to a step that is not the one that failed.`,
    );
  }

  // -------------------------------------------------------------------------
  // BROKEN DERIVATIONS THROW rather than reporting a clean tree. Each of these
  // would otherwise produce "no violations" for a reason that is not "no
  // violations".
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({ scripts: { build: 'tsc' }, workflows: { 'a.yml': 'x\n' } });
    let threw = false;
    try {
      findProofInvocations({ root });
    } catch {
      threw = true;
    }
    check(
      'a manifest with NO proof scripts throws, rather than finding nothing',
      threw,
      'With no names and no paths, every workflow line is unrecognised and the scan reports a ' +
        'clean tree — the reassuring answer, produced by having looked at nothing.',
    );
  }

  {
    const root = tempRepo({
      scripts: { 'proof:thing': 'echo nothing-that-looks-like-a-path' },
      workflows: { 'a.yml': 'x\n' },
    });
    let threw = false;
    try {
      proofEntryPoints(root);
    } catch {
      threw = true;
    }
    check(
      'proof scripts that yield NO paths throw, because the matcher and the manifest disagree',
      threw,
      'Names without paths means the path matcher is wrong. A scan that recognises no paths ' +
        'finds no violations for the wrong reason.',
    );
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'monstera-annotate-'));
    scratches.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ scripts: { 'proof:t': 'node scripts/proofs/t.proof.mjs' } })}\n`,
      'utf8',
    );
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    let threw = false;
    try {
      findProofInvocations({ root: dir });
    } catch {
      threw = true;
    }
    check(
      'an EMPTY workflow directory throws',
      threw,
      'An empty input set is a broken lookup, not a clean result.',
    );
  }

  // -------------------------------------------------------------------------
  // AND AGAINST THIS REPOSITORY, which is the claim the check actually makes.
  // -------------------------------------------------------------------------
  {
    const result = scan({ root: ROOT });
    check(
      'THIS repository has every workflow proof step wrapped',
      result.violations.length === 0,
      `${String(result.violations.length)} unwrapped: ` +
        `${JSON.stringify(result.violations.map((entry) => `${entry.file}:${entry.line}`))}`,
    );
    check(
      'CONTROL: and it found a non-trivial number of wrapped invocations',
      result.wrapped > 10,
      `wrapped = ${String(result.wrapped)}. A count near zero means the derivation stopped ` +
        `recognising invocations, and "all wrapped" would then be true of almost nothing.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE SCAN IS REGISTERED. A check nothing runs is a check that does not exist,
  // which is the shape this whole finding is about.
  // -------------------------------------------------------------------------
  {
    const guards = readFileSync(join(ROOT, '.github', 'workflows', 'guards.yml'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const script = String(manifest.scripts?.['check:annotatecoverage'] ?? '');
    check(
      'and a workflow actually runs it, through a script that names the scan',
      guards.includes('check:annotatecoverage') &&
        script.includes('scripts/lib/annotateCoverage.mjs'),
      `guards names it: ${String(guards.includes('check:annotatecoverage'))}; ` +
        `check:annotatecoverage = ${JSON.stringify(script)}. Both halves are needed — a ` +
        `workflow running a script name that points somewhere else is registered in appearance ` +
        `only, and EEE-3 exists because a remedy written but not rolled out is not a remedy.`,
    );
  }
} finally {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
    : roster.format('annotate-coverage case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
