// @ts-check
/**
 * Proof that the proof-coverage search can see, can refuse, and matches the
 * PATH rather than the manifest's name (finding VVV-1).
 *
 * The last of those is the load-bearing case, because it is the mistake that
 * was actually made: the first version of this search matched `proof:x` against
 * the workflow text and reported sixteen proofs missing, every one of them
 * wrong. The workflows invoke scripts by path.
 *
 * Usage: node scripts/proofs/proofCoverage.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { scan } from '../lib/proofCoverage.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** @type {string[]} */
const scratches = [];

/** The control the scan requires to be present before it reports anything. */
const CONTROL = 'scripts/proofs/composition.proof.mjs';

/**
 * @param {Record<string, string>} scripts package.json `proof:*` entries.
 * @param {string} workflow The workflow file's contents.
 * @returns {string}
 */
function fixture(scripts, workflow) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-coverage-'));
  scratches.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', scripts }, null, 2)}\n`,
    'utf8',
  );
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'guards.yml'), workflow, 'utf8');
  return root;
}

/** Every fixture needs the control invoked, or the scan refuses before judging. */
const CONTROL_STEP = `      - run: node ${CONTROL}\n`;

try {
  {
    const root = fixture(
      { 'proof:covered': 'node scripts/proofs/covered.proof.mjs' },
      `${CONTROL_STEP}      - run: node scripts/proofs/covered.proof.mjs\n`,
    );
    const result = scan({ root });
    check(
      'a proof whose PATH a workflow names is not reported',
      !result.blind && result.uninvoked.length === 0,
      `blind = ${String(result.blind)}, uninvoked = ${JSON.stringify(result.uninvoked)}`,
    );
  }

  {
    const root = fixture(
      { 'proof:orphan': 'node scripts/proofs/orphan.proof.mjs' },
      CONTROL_STEP,
    );
    const result = scan({ root });
    check(
      'a proof no workflow names is REPORTED',
      !result.blind && result.uninvoked.length === 1,
      `This is the defect: a proof registered in package.json that CI never runs. ` +
        `uninvoked = ${JSON.stringify(result.uninvoked)}`,
    );
  }

  // NAMED IN A CACHE KEY, RUN BY NOBODY (finding C1). The search used to be a
  // raw `workflows.includes(path)`, so this fixture passed — a proof mentioned
  // in `hashFiles(...)` reported as covered while running nowhere, which is
  // this file's own defect arriving through its own door. `ci.yml` already
  // carries two such lines for provisioning scripts, so the shape is not
  // hypothetical; a proof reads fixtures and would go in a cache key for the
  // same reason they do.
  {
    const root = fixture(
      { 'proof:cached': 'node scripts/proofs/cached.proof.mjs' },
      `${CONTROL_STEP}      - run: echo "\${{ hashFiles('scripts/proofs/cached.proof.mjs') }}"\n`,
    );
    const result = scan({ root });
    check(
      'a proof named only in a cache key is REPORTED, because naming is not running',
      !result.blind && result.uninvoked.length === 1,
      `uninvoked = ${JSON.stringify(result.uninvoked)}. A substring test cannot tell a step ` +
        `that runs a script from one that hashes it, and the question has an owner: ` +
        `workflowInvocations.mjs, which states that exclusion in its own header.`,
    );
  }

  // THE CONTROL FOR THE ABOVE, and it is the direction that matters: every
  // proof in ci.yml runs as `node scripts/ci/annotate.mjs <proof>`, so the
  // proof's own path is an ARGUMENT. A resolver that counted only what `node`
  // started would report all 85 as uninvoked — the opposite failure, and a
  // loud one, but loud is not the same as right.
  {
    const root = fixture(
      { 'proof:wrapped': 'node scripts/proofs/wrapped.proof.mjs' },
      `${CONTROL_STEP}      - run: node scripts/ci/annotate.mjs scripts/proofs/wrapped.proof.mjs\n`,
    );
    const result = scan({ root });
    check(
      'a proof run THROUGH a wrapper is invoked, because the wrapper runs it',
      !result.blind && result.uninvoked.length === 0,
      `uninvoked = ${JSON.stringify(result.uninvoked)}. This is how every proof in ci.yml is ` +
        `invoked, so a resolver blind to it would report the whole roster missing.`,
    );
  }

  // THE LOAD-BEARING CASE. The workflow mentions the npm NAME and never the
  // path, which is exactly what a `npm run proof:x` step would look like — and
  // exactly what the first version of this search matched on, reporting sixteen
  // proofs missing and being wrong about all sixteen.
  {
    const root = fixture(
      { 'proof:named': 'node scripts/proofs/named.proof.mjs' },
      `${CONTROL_STEP}      - run: echo about to run proof:named but not by path\n`,
    );
    const result = scan({ root });
    check(
      'a workflow naming only the npm SCRIPT NAME does not count as invoking it',
      !result.blind && result.uninvoked.length === 1,
      `The workflows invoke by path. A search matching the manifest's name for a thing ` +
        `answers about something else — and in the other direction it would call every ` +
        `path-invoked proof missing. uninvoked = ${JSON.stringify(result.uninvoked)}`,
    );
  }

  {
    const root = fixture(
      { 'proof:anything': 'node scripts/proofs/anything.proof.mjs' },
      '      - run: node scripts/proofs/anything.proof.mjs\n',
    );
    const result = scan({ root });
    check(
      'with the control proof absent from every workflow, the scan is BLIND',
      result.blind,
      `Every proof here IS invoked, so without the control this run reports a clean result ` +
        `— which is also what a broken read produces. blind = ${String(result.blind)}`,
    );
    check(
      'CONTROL: and blindness is reported instead of a clean verdict, not beside one',
      result.blind && result.uninvoked.length === 0,
      `A scan that says BLIND and lists findings invites reading the findings and ignoring ` +
        `the word. uninvoked = ${JSON.stringify(result.uninvoked)}`,
    );
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'monstera-coverage-empty-'));
    scratches.push(root);
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({ name: 'fixture', scripts: {} }, null, 2)}\n`,
      'utf8',
    );
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    let threw = false;
    try {
      scan({ root });
    } catch {
      threw = true;
    }
    check(
      'a workflow directory with no workflow files THROWS',
      threw,
      'With no workflows every proof reads as uninvoked, or none does — either way the read ' +
        'is broken rather than the repository. An empty input set is a broken lookup.',
    );
  }
} finally {
  for (const scratch of scratches) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} proof-coverage case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('proof-coverage case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
