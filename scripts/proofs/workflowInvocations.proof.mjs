// @ts-check
/**
 * Proof that consolidating the two `NODE_INVOCATION` patterns changed nobody's
 * answer (rule B2, finding AAAA-10).
 *
 * ## The control is the corpus, not the unit cases
 *
 * Both retired patterns were CORRECT — one captured with the `g` flag, one
 * merely tested with neither — which is exactly why unit cases cannot settle
 * this. A consolidation that silently changes one caller's answer on one line
 * looks identical to one that worked, and a fixture I invent exercises the lines
 * I thought of. **The real workflow corpus and the real manifest are the only
 * inputs that can tell the two apart**, so the retired patterns are kept here,
 * run beside the consolidated one over every line of both, and required to agree
 * everywhere.
 *
 * The retired patterns are literals in this file deliberately. They are history
 * rather than a rule, and a proof is where history belongs — anywhere else and
 * they would be a third opinion.
 *
 * Usage: node scripts/proofs/workflowInvocations.proof.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import {
  firstInvokedScriptPath,
  invokedScriptPaths,
  invokesRepositoryScript,
} from '../lib/workflowInvocations.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** `annotateCoverage.mjs`'s pattern, as it stood before consolidation. */
const RETIRED_CAPTURING = /(?:^|[^\w-])node\s+(scripts\/[\w./-]+\.mjs)/gu;
/** `nodeModulesPlacement.mjs`'s pattern, as it stood before consolidation. */
const RETIRED_TESTING = /(?:^|[^\w-])node\s+scripts\/[\w./-]+\.mjs/u;

const ROOT = repoRoot();

/**
 * Line shapes the REAL corpus does not contain, and the reason they are here.
 *
 * The equivalence control was run against the workflows and the manifest alone,
 * and a mutation that dropped the leading `(?:^|[^\w-])` boundary — a small,
 * plausible tidy-up that changes what counts as an invocation — **passed**. No
 * line in this repository is `some-node scripts/x.mjs`, so nothing disagreed.
 *
 * **A corpus can only detect a change the corpus exercises.** That is not an
 * argument against the corpus, which catches the shapes nobody thought of; it is
 * the reason it cannot be the only input. These are the shapes that were thought
 * of, and the two run together.
 */
const ADVERSARIAL = [
  'node scripts/x.mjs',
  '  run: node scripts/x.mjs',
  'some-node scripts/x.mjs',
  'nodejs scripts/x.mjs',
  'my_node scripts/x.mjs',
  'xnode scripts/x.mjs',
  'node-18 scripts/x.mjs',
  "hashFiles('scripts/x.mjs')",
  'node scripts/a.mjs && node scripts/b.mjs',
  'echo node scripts/x.mjs',
  'node  scripts/x.mjs',
  'node scripts/nested/deep-name.proof.mjs',
  'node scripts/x.js',
  'node scripts/x.mjs extra args',
  '',
];

/** Every line of every workflow, plus every npm command, plus the shapes above. @returns {string[]} */
function corpus() {
  /** @type {string[]} */
  const lines = [];
  const dir = join(ROOT, '.github', 'workflows');
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/u.test(name));
  if (files.length === 0) {
    throw new Error('No workflow files. An empty corpus agrees with everything, which is not a result.');
  }
  for (const name of files) lines.push(...readFileSync(join(dir, name), 'utf8').split('\n'));

  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const command of Object.values(manifest.scripts ?? {})) lines.push(String(command));
  return [...lines, ...ADVERSARIAL];
}

const lines = corpus();

// The corpus must actually CONTAIN invocations, or every agreement below is
// agreement about nothing. This is the positive control and it runs first.
const withInvocations = lines.filter((line) => invokesRepositoryScript(line));
check(
  'the corpus contains invocations to agree about',
  withInvocations.length > 20,
  `only ${String(withInvocations.length)} of ${String(lines.length)} lines invoke a repository ` +
    `script. Two patterns agreeing on a corpus with nothing in it is the reassuring answer.`,
);
check(
  'CONTROL: and lines that are NOT invocations, or agreement is trivial',
  lines.length - withInvocations.length > 100,
  `every line matched, so no case here exercises a negative. hashFiles('scripts/x.mjs') and ` +
    `ordinary YAML must be in the corpus for a disagreement to be possible.`,
);

// EQUIVALENCE, line by line, on the real corpus.
/** @type {string[]} */
const testDisagreements = [];
/** @type {string[]} */
const captureDisagreements = [];
for (const line of lines) {
  if (invokesRepositoryScript(line) !== RETIRED_TESTING.test(line)) {
    testDisagreements.push(line.trim().slice(0, 100));
  }
  RETIRED_CAPTURING.lastIndex = 0;
  const retired = [...line.matchAll(RETIRED_CAPTURING)].map((match) => match[1]);
  const now = invokedScriptPaths(line);
  if (JSON.stringify(retired) !== JSON.stringify(now)) {
    captureDisagreements.push(`${line.trim().slice(0, 80)} :: ${JSON.stringify(retired)} vs ${JSON.stringify(now)}`);
  }
}

check(
  'the predicate answers what nodeModulesPlacement’s retired pattern answered, on every line',
  testDisagreements.length === 0,
  `${String(testDisagreements.length)} line(s) disagree:\n      ${testDisagreements.slice(0, 5).join('\n      ')}`,
);
check(
  'and the path list answers what annotateCoverage’s retired pattern answered, on every line',
  captureDisagreements.length === 0,
  `${String(captureDisagreements.length)} line(s) disagree:\n      ${captureDisagreements.slice(0, 5).join('\n      ')}`,
);

// THE THIRD EXPORT, which `annotateCoverage.mjs` uses where it wants one path.
// Left unexercised it would be a function this proof vouches for by association;
// lint reported it as an unused import, which is how the gap surfaced.
{
  const disagreements = lines.filter(
    (line) => (firstInvokedScriptPath(line) ?? undefined) !== invokedScriptPaths(line)[0],
  );
  check(
    'the first-path helper agrees with the list’s first element on every line',
    disagreements.length === 0,
    `${String(disagreements.length)} line(s) disagree, e.g. ` +
      `${JSON.stringify(disagreements.slice(0, 3).map((line) => line.trim().slice(0, 60)))}. ` +
      `Two ways of asking the same question that can differ are two questions.`,
  );
}

// THE HAZARD THE FUNCTION API REMOVES. A global pattern carries `lastIndex`, so
// the retired capturing copy returns true then false for the same input — which
// is why `annotateCoverage.mjs` reset it by hand before every `exec`. The
// consolidated predicate must be stateless, and this is the case that would
// have caught the consolidation exporting the global form instead.
{
  const line = '        run: node scripts/ci/annotate.mjs scripts/proofs/x.proof.mjs';
  const repeated = [
    invokesRepositoryScript(line),
    invokesRepositoryScript(line),
    invokesRepositoryScript(line),
  ];
  const retiredRepeated = [
    RETIRED_CAPTURING.test(line),
    RETIRED_CAPTURING.test(line),
    RETIRED_CAPTURING.test(line),
  ];
  RETIRED_CAPTURING.lastIndex = 0;
  check(
    'the predicate is STATELESS — three calls on one line give three trues',
    repeated.every((answer) => answer === true),
    `got ${JSON.stringify(repeated)}. A caller holding a global regex holds its lastIndex with ` +
      `it, and the answer alternates.`,
  );
  check(
    'CONTROL: and the retired global pattern demonstrably was not, which is why it is gone',
    !retiredRepeated.every((answer) => answer === true),
    `got ${JSON.stringify(retiredRepeated)}. If this ever passes, the hazard this API removes ` +
      `does not exist and the case is asserting nothing.`,
  );
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} workflowInvocations case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('workflowInvocations case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
