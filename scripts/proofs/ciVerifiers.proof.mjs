// @ts-check
/**
 * Proof for the CI-derived verifier roster (`scripts/lib/ciVerifiers.mjs`,
 * finding ZZZZ-1).
 *
 * ## What went wrong, and what a proof of the fix has to separate
 *
 * `checkLocal.mjs` derived its roster from `package.json` by NAME, and seven
 * real verification scripts sit outside `check:`/`proof:`. The sweep reported
 * **29 of 29 and exited 0** — a member outside the pattern produces no error and
 * no absence anybody can see, so the only observable is a smaller number that
 * looks complete against itself.
 *
 * A proof of the replacement therefore has to do three things a pass/fail run
 * cannot do on its own:
 *
 *   1. show the derivation REACHES a script the old pattern missed, by name,
 *      rather than showing that some number went up;
 *   2. show it does NOT reach a generator that shares a path with a checker —
 *      this sweep asserts afterwards that the tree is unchanged, so a roster
 *      containing `notice:generate` would rewrite `NOTICE` before the push it
 *      exists to protect;
 *   3. show the ANCHOR fires, because the derivation's own failure direction is
 *      a shrink and a derived set cannot disagree with its source (item 4c).
 *
 * ## The fixtures are workflow text, not the real corpus
 *
 * The real corpus is used for one case — that the derivation reaches
 * `notice:check` today — because that is the concrete claim ZZZZ-1 is about.
 * Everything else runs against a written fixture, since the interesting inputs
 * are a comment, a cache key, a wrapper and an ambiguous path, and the real
 * corpus contains at most one of each by accident rather than by design.
 *
 * Usage: node scripts/proofs/ciVerifiers.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ciVerifiers, verifiersNotRunByCi } from '../lib/ciVerifiers.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * Builds a repository whose workflows exercise every shape that matters.
 *
 * @param {{ manifest: Record<string, string>, workflow: string }} spec
 * @returns {string} the root, for the caller to remove
 */
function fixture(spec) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-civerifiers-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: spec.manifest }), 'utf8');
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), spec.workflow, 'utf8');
  return root;
}

/**
 * The manifest shape that matters: a shared path with a checker and a generator.
 *
 * **THE ORDER IS PART OF THE FIXTURE.** The wrong-but-plausible implementation
 * is *take the first owner of this path*, and with the checker declared first
 * that implementation is right — so the disambiguation cases below would pass
 * under the very defect they exist to catch. Measured: mutating `ownerFor` to
 * return `owners[0]` left both of them green while three real-corpus cases went
 * red, which is the fixture being one-sided rather than the cases being weak.
 *
 * So the generator and `guard:staged` are declared FIRST, and `owners[0]` is
 * now the wrong answer in both.
 */
const MANIFEST = {
  'notice:generate': 'node scripts/release/generateNotice.mjs',
  'notice:check': 'node scripts/release/generateNotice.mjs --check',
  'guard:staged': 'node scripts/hooks/guardFiles.mjs --staged',
  'guard:tree': 'node scripts/hooks/guardFiles.mjs --tree',
  'proof:thing': 'node scripts/proofs/thing.proof.mjs',
  'check:orphan': 'node scripts/lib/orphan.mjs',
  lint: 'eslint .',
};

// ---------------------------------------------------------------------------
// IT REACHES WHAT THE NAME PATTERN MISSED — the ZZZZ-1 case, on the real corpus.
// ---------------------------------------------------------------------------
{
  const { names } = ciVerifiers();

  check(
    'the real derivation reaches notice:check, which the name pattern could not',
    names.includes('notice:check'),
    `derived ${String(names.length)} name(s) and notice:check was not among them. That script ` +
      `caught a stale NOTICE and reddened the board while the sweep reported 29 of 29; if the ` +
      `replacement cannot see it either, nothing has changed.`,
  );

  check(
    '  ...and brand:check and guard:tree, the others outside the pattern',
    names.includes('brand:check') && names.includes('guard:tree'),
    `derived names are missing one of them: ${JSON.stringify(names.filter((name) => name.startsWith('brand') || name.startsWith('guard')))}. ` +
      `Reaching one of the seven and not the rest is a fix for an instance rather than a class.`,
  );

  check(
    'and it does NOT reach the generators that share those paths',
    !names.includes('notice:generate') && !names.includes('brand:generate'),
    `derived ${JSON.stringify(names.filter((name) => name.endsWith(':generate')))}. The sweep ` +
      `asserts afterwards that the working tree is as it found it, so a generator in the roster ` +
      `rewrites a tracked file before the push it exists to protect. The workflow line carries ` +
      `--check and the manifest command does too; that is what decides it.`,
  );
}

// ---------------------------------------------------------------------------
// THE WRAPPER, which is where a naive derivation collapses to one script.
// ---------------------------------------------------------------------------
{
  const root = fixture({
    manifest: MANIFEST,
    workflow: [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: node scripts/ci/annotate.mjs scripts/proofs/thing.proof.mjs',
      '      - run: node scripts/ci/annotate.mjs scripts/release/generateNotice.mjs --check',
      '      - run: node scripts/ci/annotate.mjs scripts/hooks/guardFiles.mjs --tree',
      '      - run: npm run lint',
    ].join('\n'),
  });
  try {
    const result = ciVerifiers({ root });

    check(
      'a script wrapped by annotate.mjs is reached, not just the wrapper',
      result.names.includes('proof:thing'),
      `derived ${JSON.stringify(result.names)}. Every workflow step runs its script as an ` +
        `ARGUMENT to the wrapper, so the argument carries no node prefix — measured on the real ` +
        `corpus, the workflows contain ONE unique "node scripts/..." path. A derivation built ` +
        `on that alone resolves CI's whole verifier set to annotate.mjs and reports it happily.`,
    );

    check(
      '  ...and the ambiguous path resolves to the checker by its arguments',
      result.names.includes('notice:check') && !result.names.includes('notice:generate'),
      `derived ${JSON.stringify(result.names)}. Both npm scripts run the same file; only the ` +
        `line says which one, and guessing here puts a generator in a verification roster.`,
    );

    check(
      '  ...and guard:tree resolves rather than guard:staged',
      result.names.includes('guard:tree') && !result.names.includes('guard:staged'),
      `derived ${JSON.stringify(result.names)}. Same shared path, and the flag is the only ` +
        `difference — if the tail is not read, this picks one at random and is right half the time.`,
    );

    check(
      '  ...and a bare `npm run` step is reached too',
      result.names.includes('lint'),
      `derived ${JSON.stringify(result.names)}. Not every step goes through the wrapper; a ` +
        `derivation that only understood paths would drop lint, build and typecheck.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// IT TOLERATES. A mention is not an invocation, and the failures both directions
// produce here are opposite: a comment counted as a step makes the roster BIGGER
// (and would make this sweep run itself), a cache key counted makes it wrong.
// ---------------------------------------------------------------------------
{
  const root = fixture({
    manifest: MANIFEST,
    workflow: [
      'jobs:',
      '  build:',
      '    steps:',
      '      # node scripts/ci/annotate.mjs scripts/lib/orphan.mjs',
      "      - uses: actions/cache@v4",
      "        with:",
      "          key: ${{ hashFiles('scripts/lib/orphan.mjs') }}",
      '      - run: node scripts/ci/annotate.mjs scripts/proofs/thing.proof.mjs',
    ].join('\n'),
  });
  try {
    const result = ciVerifiers({ root });

    check(
      'a commented-out step is not an invocation',
      !result.names.includes('check:orphan'),
      `derived ${JSON.stringify(result.names)}. This is not hypothetical in the other ` +
        `direction: ci.yml carries a comment quoting "npm run local", and counting it would put ` +
        `the sweep in its own roster.`,
    );

    check(
      '  ...and neither is a cache key naming a script',
      !result.names.includes('check:orphan') && result.names.includes('proof:thing'),
      `derived ${JSON.stringify(result.names)}. hashFiles() names a script and runs nothing. ` +
        `The second half of this assertion is what stops it passing because the derivation ` +
        `found nothing at all.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// THE ANCHOR. The derivation's own failure direction is a SHRINK, and a set
// computed from a collection cannot disagree with that collection (item 4c).
// ---------------------------------------------------------------------------
{
  const root = fixture({
    manifest: MANIFEST,
    workflow: [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: node scripts/ci/annotate.mjs scripts/proofs/thing.proof.mjs',
    ].join('\n'),
  });
  try {
    const { orphans } = verifiersNotRunByCi({ root });

    check(
      'a check declared in the manifest and run by no workflow is named',
      orphans.includes('check:orphan') && !orphans.includes('proof:thing'),
      `orphans were ${JSON.stringify(orphans)}. Without this the roster tracks growth perfectly ` +
        `and agrees with every shrink: delete a CI step and the check leaves the sweep with it, ` +
        `silently, which is ZZZZ-1 arriving from the other side.`,
    );

    check(
      '  ...and the anchor reads the manifest, not the workflows',
      orphans.length > 0,
      `no orphan was found in a fixture whose workflow runs one script and whose manifest ` +
        `declares two check/proof scripts. An anchor derived from the same source as the roster ` +
        `is not an anchor.`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nCI-verifier roster proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThe sweep that runs before every push takes its roster from here. A derivation that ` +
      `quietly reaches fewer scripts prints a confident count either way.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(roster.format('CI-verifier case'));
