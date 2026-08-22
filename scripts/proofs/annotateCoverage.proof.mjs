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

import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import {
  findWrappableInvocations,
  scan,
  wrappableEntryPoints,
} from '../lib/annotateCoverage.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 18 });

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
      findWrappableInvocations({ root });
    } catch {
      threw = true;
    }
    check(
      'a manifest with NO wrappable scripts throws, rather than finding nothing',
      threw,
      'With no names and no paths, every workflow line is unrecognised and the scan reports a ' +
        'clean tree — the reassuring answer, produced by having looked at nothing.',
    );
  }

  // -------------------------------------------------------------------------
  // FFF-2: THE SCOPE IS "WHAT THE WRAPPER CAN SPAWN", not a name prefix.
  //
  // `annotate.mjs` runs its target with process.execPath, so a step running
  // `tsc`, `eslint` or `vitest` is outside the rule as a matter of mechanism.
  // A chain like `npm run build` names no path of its own; the derivation reads
  // each command's own text and does not follow chains.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: {
        lint: 'eslint .',
        typecheck: 'tsc --build',
        build: 'npm run typecheck && npm run build:preload',
        'build:preload': 'node scripts/build/preload.mjs',
        'guard:tree': 'node scripts/hooks/guardFiles.mjs --tree',
        'check:docs': 'node scripts/hooks/documentConsistency.mjs',
      },
      workflows: { 'a.yml': 'x\n' },
    });
    const { names } = wrappableEntryPoints(root);
    check(
      'a script that runs a non-node tool is not wrappable, and neither is a chain',
      !names.includes('lint') && !names.includes('typecheck') && !names.includes('build'),
      `names = ${JSON.stringify(names)}. The wrapper spawns a node script; requiring a step to ` +
        `route \`eslint\` through it would be a rule nothing can satisfy, which is how a check ` +
        `gets disabled.`,
    );
    check(
      'CONTROL: and a script that DOES run a node file is, including one behind a chain',
      names.includes('guard:tree') &&
        names.includes('check:docs') &&
        names.includes('build:preload'),
      `names = ${JSON.stringify(names)}. Without this, the case above is satisfied by a ` +
        `derivation that recognises nothing at all — which is the same fixture reporting ` +
        `"correctly excluded" for every entry.`,
    );
  }

  // -------------------------------------------------------------------------
  // HHH-3: THE MANIFEST IS NOT THE AUTHORITY FOR WHAT A WORKFLOW RUNS.
  //
  // A workflow can invoke a script no npm script names, and one did:
  // `helper="$(node scripts/ci/sandboxHelperPath.mjs)"`. A manifest-derived path
  // set could not see it, so its failures were exit-code-only in public — the
  // gap the whole check exists to close, sitting inside the check's own blind
  // spot. Recognition is now the INVOCATION, and the manifest is consulted only
  // for what `npm run x` means.
  //
  // The second half is the word boundary. It admitted a command after
  // whitespace or a shell operator and nothing else, so a COMMAND SUBSTITUTION
  // was invisible even after the path rule was widened — two independent
  // reasons for the same silence, and fixing either alone still reports
  // nothing. Both fixtures are here for that reason.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: { 'guard:tree': 'node scripts/hooks/guardFiles.mjs --tree' },
      workflows: {
        'a.yml':
          '        run: node scripts/ci/unregistered.mjs\n' +
          '        run: node scripts/ci/annotate.mjs scripts/hooks/guardFiles.mjs --tree\n',
      },
    });
    const result = scan({ root });
    check(
      'a script NO npm script registers is still an invocation',
      result.violations.length === 1 && result.violations[0]?.line === 1,
      `violations = ${JSON.stringify(result.violations)}. package.json owns what \`npm run x\` ` +
        `means; it does not own what a workflow runs, and a set derived from it is silent about ` +
        `every line that names a path directly.`,
    );
    check(
      'and the diagnostic says the manifest does not know it',
      `${result.violations[0]?.why}`.includes('no npm script registers'),
      `why = ${JSON.stringify(result.violations[0]?.why)}. A path nothing registers is worth ` +
        `seeing on its own: it is either a step that should be a script, or the shape that was ` +
        `invisible here.`,
    );
  }

  {
    const root = tempRepo({
      scripts: { 'guard:tree': 'node scripts/hooks/guardFiles.mjs --tree' },
      workflows: {
        'a.yml':
          '          helper="$(node scripts/ci/helperPath.mjs)"\n' +
          '        run: node scripts/ci/annotate.mjs scripts/hooks/guardFiles.mjs --tree\n',
      },
    });
    const result = scan({ root });
    check(
      'a COMMAND SUBSTITUTION is an invocation — the boundary is not whitespace',
      result.violations.length === 1 && result.violations[0]?.line === 1,
      `violations = ${JSON.stringify(result.violations)}. The boundary was a guess about how a ` +
        `command can be introduced, and \`$(\` is not in it. A window chosen by hand reports ` +
        `the absence it caused.`,
    );
  }

  // -------------------------------------------------------------------------
  // A PATH IS NOT AN INVOCATION. Dropping the `proof:` filter alone reports
  // three hashFiles() cache keys in ci.yml, which name a script and run
  // nothing. The line must also invoke node on a repository script.
  // -------------------------------------------------------------------------
  {
    const root = tempRepo({
      scripts: { 'guard:tree': 'node scripts/hooks/guardFiles.mjs --tree' },
      workflows: {
        'a.yml':
          '          key: cache-${{ hashFiles(\'scripts/hooks/guardFiles.mjs\') }}\n' +
          '        run: node scripts/ci/annotate.mjs scripts/hooks/guardFiles.mjs --tree\n',
      },
    });
    const result = scan({ root });
    check(
      'a script path inside a cache key is NOT an invocation',
      result.violations.length === 0,
      `violations = ${JSON.stringify(result.violations)}. A hashFiles key names a script and ` +
        `runs nothing; reporting it would be a violation nobody can fix, on a line that cannot ` +
        `fail.`,
    );
    check(
      'CONTROL: and the wrapped line beneath it was still recognised',
      result.wrapped === 1 && !result.blind,
      `wrapped = ${String(result.wrapped)}. Without this, "no violations" above is satisfied by ` +
        `a scan that recognised neither line.`,
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
      findWrappableInvocations({ root: dir });
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
    // Asserted against the SCAN'S OWN PATH in any workflow, not against an npm
    // script name in a named file. The previous form asserted
    // `guards.yml contains "check:annotatecoverage"`, and FFF-2 broke it by
    // making the workflow name the path directly — which is what the widened
    // rule requires of every step. A registration case coupled to one spelling
    // in one file reports a de-registration when the spelling changes, and says
    // nothing when the step moves to a job that cannot run it.
    const dir = join(ROOT, '.github', 'workflows');
    const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/u.test(name));
    if (workflows.length === 0) throw new Error(`${dir} holds no workflows to read.`);
    const SCAN_PATH = 'scripts/lib/annotateCoverage.mjs';
    const runsIt = workflows.some((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      return text.split('\n').some((line) => line.includes(SCAN_PATH) && line.includes('node '));
    });
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const script = String(manifest.scripts?.['check:annotatecoverage'] ?? '');
    check(
      'and a workflow actually runs the scan, by path, on a line that invokes node',
      runsIt && script.includes(SCAN_PATH),
      `a workflow runs it: ${String(runsIt)}; check:annotatecoverage = ` +
        `${JSON.stringify(script)}. Both halves are needed — the npm script is how a person ` +
        `runs it, the workflow line is how CI does, and EEE-3 exists because a remedy written ` +
        `but not rolled out is not a remedy.`,
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
