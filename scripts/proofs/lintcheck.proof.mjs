// @ts-check
/**
 * Proof that the lint runner separates a violating tree from a clean one, and
 * that neither the parser nor the extent can silently shrink (rule B2).
 *
 * ## The three failures worth cases
 *
 * A check that lints the repository has one reassuring answer — *no problems* —
 * and three ways to produce it without having looked:
 *
 *   - the runner reports success for a tree that violates a rule. That is the
 *     resolution test, and its fixture is one the absent guard would let
 *     through: a real violation, which nothing but ESLint catches.
 *   - the parser understands fewer segments than the authority declares, so the
 *     lint gets smaller and its output still says `ok`. `parseLintScript`
 *     returns `null` for a segment it does not understand rather than dropping
 *     it, precisely so the count can disagree.
 *   - the EXTENT shrinks with the count unmoved. This is where lint differs
 *     from the typecheck: `eslint .` narrowed to `eslint packages` is still one
 *     invocation, still parses, and lints less. `EXPECTED_TARGETS` is the
 *     literal that has to be edited for that to happen quietly, and these cases
 *     are what make the literal load-bearing rather than decorative.
 *
 * The clean fixture is not symmetry for its own sake. A runner that reported
 * failure for everything would satisfy the resolution test while blocking every
 * push, and a proof that only asked *does it go red* could not tell the two
 * apart.
 *
 * ## Fixtures are BUILT, never the repository
 *
 * The runner takes its ESLint path, invocations and working directory as
 * arguments so this can drive it against throwaway trees with their own flat
 * config. A runner that could only be exercised by linting the whole repository
 * would be exercised by nothing.
 *
 * Usage: node scripts/proofs/lintcheck.proof.mjs
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import {
  ESLINT_ENTRY,
  EXPECTED_TARGETS,
  parseLintScript,
  runLint,
  targetsOf,
} from '../lib/lintcheck.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const root = repoRoot();
const eslintPath = join(root, ESLINT_ENTRY);

// ---------------------------------------------------------------------------
// The parse, against strings rather than against the repository.
// ---------------------------------------------------------------------------
check(
  'a plain lint script parses to one invocation carrying its target',
  JSON.stringify(parseLintScript('eslint .')) === JSON.stringify([['.']]),
  `parsed ${JSON.stringify(parseLintScript('eslint .'))}`,
);

check(
  'a chained script parses to one invocation per segment',
  parseLintScript('eslint . && eslint --max-warnings 0 docs').length === 2,
  `parsed ${JSON.stringify(parseLintScript('eslint . && eslint --max-warnings 0 docs'))}. The ` +
    `count is what the caller compares against the authority's segments, so a chain that ` +
    `collapsed to one would be a lint that got smaller with nothing saying so.`,
);

check(
  'a segment that is not ESLint is null rather than dropped',
  parseLintScript('eslint . && prettier --check .')[1] === null,
  `parsed ${JSON.stringify(parseLintScript('eslint . && prettier --check .'))}. Dropping it ` +
    `would leave the counts equal and the check reporting on half the script.`,
);

check(
  "a value-taking flag's value reads as a target, and the anchor survives it",
  targetsOf([['--max-warnings', '0', '.']]).includes('.') &&
    EXPECTED_TARGETS.every((expected) =>
      targetsOf([['--max-warnings', '0', '.']]).includes(expected),
    ),
  `read ${JSON.stringify(targetsOf([['--max-warnings', '0', '.']]))}. The anchor is a SUBSET ` +
    `test, so a spurious extra is harmless — and that is the documented behaviour only because ` +
    `this case reddened against a comment claiming the stricter one. Equality would make adding ` +
    `a flag an event, and adding is a widening.`,
);

check(
  'CONTROL: a narrowed script fails the extent anchor',
  EXPECTED_TARGETS.some((expected) => !targetsOf([['packages']]).includes(expected)),
  `\`eslint packages\` yields ${JSON.stringify(targetsOf([['packages']]))} and ` +
    `EXPECTED_TARGETS is ${JSON.stringify(EXPECTED_TARGETS)}. If a narrowed script satisfied the ` +
    `anchor, the anchor is decoration — this is the case that makes the literal load-bearing.`,
);

check(
  "and this repository's own lint script satisfies it",
  EXPECTED_TARGETS.every((expected) => targetsOf([['.']]).includes(expected)),
  `EXPECTED_TARGETS ${JSON.stringify(EXPECTED_TARGETS)} is not satisfied by \`eslint .\`, which ` +
    `means the anchor refuses the script it was written for — a guard nobody can keep.`,
);

// ---------------------------------------------------------------------------
// THE RESOLUTION TEST, against fixture trees with their own flat config.
// ---------------------------------------------------------------------------
/**
 * A throwaway tree with a flat config carrying one rule.
 *
 * The rule is `no-unused-vars` from ESLint's own core, so the fixture depends on
 * no plugin and no preset — a fixture whose config could stop loading would
 * report a clean tree for the same reason a broken parse does.
 *
 * @param {string} body the single source file's contents
 * @returns {string} the tree's path
 */
function tree(body) {
  const at = mkdtempSync(join(tmpdir(), 'monstera-lintcheck-'));
  writeFileSync(
    join(at, 'eslint.config.mjs'),
    `export default [\n` +
      `  { files: ['**/*.mjs'], rules: { 'no-unused-vars': 'error' } },\n` +
      `];\n`,
    'utf8',
  );
  writeFileSync(join(at, 'subject.mjs'), body, 'utf8');
  return at;
}

if (!existsSync(eslintPath)) {
  process.stderr.write(
    `ESLint is not at ${ESLINT_ENTRY}. This proof drives the real linter against fixture trees, ` +
      `so without it there is nothing to separate. Run \`npm ci\`.\n`,
  );
  process.exit(1);
}

const dirty = tree('const unused = 1;\nexport const used = 2;\n');
const clean = tree('export const used = 2;\n');
try {
  const dirtyRun = runLint(eslintPath, [['.']], dirty);
  check(
    'RESOLUTION: a tree that violates a rule is reported as a failure',
    dirtyRun.failed.length === 1 &&
      dirtyRun.failed[0]?.output.includes('no-unused-vars') === true,
    `ran ${String(dirtyRun.ran)}, failed ${String(dirtyRun.failed.length)}, output ` +
      `${JSON.stringify(dirtyRun.failed[0]?.output.slice(0, 400) ?? '')}. A runner that cannot ` +
      `see a violation reports the whole repository clean, which is the answer everybody wants.`,
  );

  const cleanRun = runLint(eslintPath, [['.']], clean);
  check(
    'CONTROL: a clean tree is not reported as a failure',
    cleanRun.failed.length === 0 && cleanRun.ran === 1,
    `ran ${String(cleanRun.ran)}, failed ${String(cleanRun.failed.length)}: ` +
      `${JSON.stringify(cleanRun.failed[0]?.output.slice(0, 400) ?? '')}. Without this, "it goes ` +
      `red" is satisfied by a runner that goes red at everything — which blocks every push and ` +
      `passes the resolution test.`,
  );

  const stopped = runLint(eslintPath, [['.'], ['.']], dirty);
  check(
    'AND IT STOPS AT THE FIRST FAILURE, because && is part of what the authority said',
    stopped.ran === 1,
    `ran ${String(stopped.ran)} of 2 invocations. \`a && b\` runs b only if a succeeded, and ` +
      `continuing past a failure is a second opinion about what the manifest said — the same ` +
      `finding the typecheck runner carries as BBBB-2.`,
  );
} finally {
  rmSync(dirty, { recursive: true, force: true });
  rmSync(clean, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} lintcheck case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('lintcheck case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
