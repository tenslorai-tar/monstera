// @ts-check
/**
 * Proves the toolchain pin is one declaration rather than three copies.
 *
 * `scripts/lib/toolchain.mjs` records the exact Node the workflows install and
 * the npm it bundles. Nothing forces a YAML file to agree with a JavaScript
 * constant, and the failure is silent in the direction that matters: a workflow
 * left on a floating `node-version: 24` keeps working, keeps passing, and keeps
 * changing the npm that validates this project's lockfile without any commit.
 * That is what happened, and the guard built for the lockfile class could not
 * see it — see the table in toolchain.mjs.
 *
 * Three cases, and the third is the one that makes the first two mean anything:
 * a floating major must be REJECTED. Without it, "every workflow names the
 * pinned version" is satisfied by a matcher that accepts any `node-version` at
 * all, which is the state being corrected.
 *
 * Usage: node scripts/proofs/toolchainPin.proof.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { NODE_FLOOR, NODE_VERSION, NPM_VERSION } from '../lib/toolchain.mjs';

const ROOT = repoRoot();

/** Every workflow that installs Node. Named, so a new one is a deliberate edit. */
const WORKFLOWS = ['ci.yml', 'guards.yml'];

/** @type {string[]} */
const passed = [];
/** @type {string[]} */
const failures = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

check(
  'the pinned Node version is exact, not a range',
  /^\d+\.\d+\.\d+$/u.test(NODE_VERSION),
  `NODE_VERSION is "${NODE_VERSION}". A major or a range reintroduces exactly the drift this ` +
    `file exists to stop: the runtime under every proof here could differ between two runs of ` +
    `the same commit.`,
);

check(
  'the bundled npm version is recorded alongside it',
  /^\d+\.\d+\.\d+$/u.test(NPM_VERSION),
  `NPM_VERSION is "${NPM_VERSION}". npm is the half that matters for the lockfile guard, and a ` +
    `Node pin whose npm nobody wrote down is the same silence one level down.`,
);

// The floor is a claim in package.json and a job in CI, and nothing but this
// keeps them the same number. A manifest promising a version nothing runs is
// what this pair exists to prevent, and drift here restores it silently.
{
  const manifest = /** @type {{ engines?: { node?: string } }} */ (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  );
  const declared = manifest.engines?.node ?? '';
  const lowerBound = declared.replace(/^>=\s*/u, '').trim();

  check(
    'package.json declares a Node floor at all',
    /^>=\s*\d+\.\d+\.\d+$/u.test(declared),
    `engines.node is ${JSON.stringify(declared)}. This proof compares against what it finds, ` +
      `so a shape it cannot read would pass every comparison below by having none to make.`,
  );

  check(
    'the tested floor is the declared floor',
    lowerBound === NODE_FLOOR,
    `engines.node says ">=${lowerBound}" and CI tests ${NODE_FLOOR}. Whichever is wrong, the ` +
      `state to avoid is the one where the manifest promises a version nothing runs.`,
  );

  check(
    'the floor is OLDER than the pinned runner Node, or the row tests nothing new',
    NODE_FLOOR !== NODE_VERSION,
    `the floor and the pin are both ${NODE_FLOOR}. A floor row that runs the same version as ` +
      `every other job is a job that costs minutes and asserts nothing.`,
  );
}

for (const workflow of WORKFLOWS) {
  const path = join('.github', 'workflows', workflow);
  const text = readFileSync(join(ROOT, path), 'utf8');
  // Narrowed HERE, where the value is produced, rather than at each use. A
  // capture group is `string | undefined` to TypeScript, and widening a
  // parameter or casting at the call site would move the uncertainty rather
  // than remove it — leaving every later reader to re-derive that these are
  // always defined.
  //
  // The filter shrinks the set, which is exactly why the emptiness check below
  // stays AFTER it: a workflow this regex no longer matches produces no
  // declarations and must fail, not pass with nothing to compare.
  /** @type {string[]} */
  const declarations = [...text.matchAll(/node-version:\s*(\S+)/gu)]
    .map((match) => match[1])
    .filter((declared) => declared !== undefined);

  // An empty set is a broken read, not a clean one — the file could have been
  // renamed, or the key spelt differently, and both report "nothing to
  // disagree with" (audit item 4b).
  check(
    `${path} declares a Node version at all`,
    declarations.length > 0,
    `No node-version key found. This proof compares against what it finds, so finding nothing ` +
      `would pass every comparison below by having none to make.`,
  );

  check(
    `${path} pins Node to ${NODE_VERSION} or the floor ${NODE_FLOOR}, and nothing else`,
    declarations.every((declared) => declared === NODE_VERSION || declared === NODE_FLOOR),
    `found ${declarations.join(', ')} — every setup-node step must name the pinned version, or ` +
      `the declared floor for the one job that tests it. One floating step is enough to change ` +
      `the npm that runs there.`,
  );

  check(
    `CONTROL: ${path} would be caught carrying a floating major`,
    !declarations.some((declared) => /^\d+$/u.test(declared)),
    `found a bare major in ${declarations.join(', ')}. This case exists so that the one above ` +
      `cannot be satisfied by a comparison that accepts anything.`,
  );

  if (workflow === 'ci.yml') {
    // The claim is only tested if something actually runs at the floor. Without
    // this, deleting the floor job leaves every other case green — the manifest
    // goes back to promising a version nothing runs, and nothing says so.
    check(
      `${path} runs at least one job at the declared floor`,
      declarations.includes(NODE_FLOOR),
      `no setup-node step names ${NODE_FLOOR}. engines.node promises it; if no job runs it, ` +
        `the promise is made by a manifest and exercised by nothing.`,
    );
  }
}

process.stdout.write(
  `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
    (failures.length > 0
      ? `\n${failures.length} toolchain pin failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : `\n${passed.length} toolchain pin cases passed.\n`),
);
process.exitCode = failures.length > 0 ? 1 : 0;
