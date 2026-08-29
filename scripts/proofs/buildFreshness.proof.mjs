// @ts-check
/**
 * Proves the staleness guard can tell a current build from an old one, and
 * cannot be satisfied by having looked at nothing.
 *
 * ## It had no proof at all until now, and that is the finding behind this file
 *
 * `refuseStaleBuild` lived inside `rendererPolicy.proof.mjs` as a private
 * function with no cases. It was load-bearing there — every runtime case in that
 * file reads an artefact, and a stale one answers every probe confidently and
 * correctly about the previous version of the shell — and it became load-bearing
 * for a second proof when `canvasPixels.proof.mjs` began reading pixels out of
 * the same bundle. A helper two proofs trust before believing anything else is
 * the last place to have no coverage of its own.
 *
 * ## The direction the cases run
 *
 * Every failure mode here produces **"the build is fine"**:
 *
 * - a source newer than its artefact, missed;
 * - a directory walk that reads nothing and returns `0`, which never exceeds a
 *   timestamp;
 * - a pair list quietly shorter than the proof needs.
 *
 * So each case has a partner asserting the guard also says **yes** when it
 * should. A guard that refused everything would satisfy the first half of this
 * file perfectly and be deleted within a week.
 *
 * Usage: node scripts/proofs/buildFreshness.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newestMtime, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];

const CASES = [
  'a source NEWER than its artefact is refused',
  'CONTROL: and the same pair with the artefact newer is accepted',
  'EQUAL timestamps pass, because a tick is not evidence of staleness',
  'a directory source is dated by the newest file BENEATH it',
  'a test file is not an input, so touching one does not refuse',
  'a source directory the walk can date NOTHING in throws rather than reading as fresh',
  'CONTROL: and a directory holding one ordinary file is dated, not refused',
  'a missing artefact is reported as missing rather than as fresh',
  'a pair count that disagrees with the call site is refused',
];

const roster = createRoster(failures, { cases: CASES.length });

/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

/**
 * Whether `refuseStaleBuild` refused, and what it said.
 *
 * @param {string} root
 * @param {[string, string][]} pairs
 * @param {number} expected
 * @returns {{ refused: boolean, message: string }}
 */
function refusal(root, pairs, expected) {
  try {
    refuseStaleBuild(root, pairs, expected);
    return { refused: false, message: '' };
  } catch (error) {
    return { refused: true, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes a file and stamps its mtime.
 *
 * TIMESTAMPS ARE SET, not produced by writing in order. Two writes can land
 * inside one filesystem tick — the guard passes ties deliberately — so a fixture
 * that relied on write order would be a fixture whose outcome depends on how
 * fast the disk is, which is the flake that gets a bound raised.
 *
 * @param {string} path
 * @param {string} body
 * @param {number} atSeconds
 */
function writeAt(path, body, atSeconds) {
  writeFileSync(path, body, 'utf8');
  utimesSync(path, atSeconds, atSeconds);
}

/** @type {string[]} */
const roots = [];

/** @returns {string} a fresh temporary root */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-freshness-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  return root;
}

const OLD = 1_700_000_000;
const NEW = 1_800_000_000;

try {
  // -------------------------------------------------------------------------
  // The plain comparison, both ways.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', NEW);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js']], 1);
    check(
      'a source NEWER than its artefact is refused',
      refused && message.includes('OLDER than'),
      `the guard ${refused ? `refused with: ${message}` : 'accepted a build older than its own ' +
        'source'}. This is the whole mechanism: a stale artefact answers every probe in the ` +
        `proofs downstream, correctly, about the previous version of the shell.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', NEW);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js']], 1);
    check(
      'CONTROL: and the same pair with the artefact newer is accepted',
      !refused,
      `a current build was refused: ${message}\n      Without this line the case above passes ` +
        `for a guard that refuses everything — which would make every proof depending on it ` +
        `permanently red, and therefore make this guard the thing somebody deletes.`,
    );
  }

  // -------------------------------------------------------------------------
  // The tie. Finding LLLLL-2: the rule was in the header and in no case.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js']], 1);
    check(
      'EQUAL timestamps pass, because a tick is not evidence of staleness',
      !refused,
      `a build whose artefact carries its source's exact timestamp was refused: ${message}\n` +
        `      The resolver's header states this rule and, until this case, nothing asserted it — ` +
        `so changing the comparison to \`>=\` reddened NOTHING while producing exactly the ` +
        `failure that sentence predicts: a guard refusing a build somebody just made, on a fast ` +
        `filesystem, intermittently. That is the shape of a check people delete.\n      ` +
        `The timestamps are SET rather than produced by writing in order, so this case is a tie ` +
        `by construction and not by how fast the disk happens to be.`,
    );
  }

  // -------------------------------------------------------------------------
  // A directory source, and what counts as being in it.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'src', 'nested', 'b.ts'), 'sibling\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD + 1);
    const { refused } = refusal(root, [['src', 'dist/bundle.js']], 1);
    check(
      'a directory source is dated by the newest file BENEATH it',
      refused,
      `an edit to src/nested/b.ts did not refuse a bundle built before it. The Vite bundle's ` +
        `inputs are every module reachable from its entry, so naming one file would be a guard ` +
        `that passes whenever the edit landed in a sibling — which is what a nested fixture is ` +
        `here to separate from a flat one.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'src', 'a.test.ts'), 'a test\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD + 1);
    const { refused, message } = refusal(root, [['src', 'dist/bundle.js']], 1);
    check(
      'a test file is not an input, so touching one does not refuse',
      !refused,
      `touching a test refused the build: ${message}\n      A test cannot change the artefact, ` +
        `so this would be the guard crying wolf on an edit that could not have staled anything ` +
        `— and a guard that cries wolf is one somebody turns off, which costs the real ` +
        `staleness it exists for.`,
    );
  }

  // -------------------------------------------------------------------------
  // Finding KKKKK-2: an empty walk is a broken lookup, not a fresh build.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    mkdirSync(join(root, 'src', 'node_modules'), { recursive: true });
    writeAt(join(root, 'src', 'node_modules', 'x.ts'), 'not source\n', NEW);
    writeAt(join(root, 'src', 'only.test.ts'), 'a test\n', NEW);
    writeAt(join(root, 'dist', 'bundle.js'), 'built\n', OLD);
    let threw = false;
    try {
      newestMtime(join(root, 'src'));
    } catch {
      threw = true;
    }
    check(
      'a source directory the walk can date NOTHING in throws rather than reading as fresh',
      threw,
      `a directory whose every entry is skipped returned a timestamp instead of refusing. It ` +
        `used to return 0, and 0 never exceeds an artefact's mtime — so the pair passed and the ` +
        `guard reported a current build having looked at nothing.\n      ` +
        `THE FIXTURE IS BUILT FROM THINGS THE SKIP LIST EATS, not from an empty directory: an ` +
        `empty one is the case nobody creates, and the one that actually happens is a skip list ` +
        `that grew until it covered everything real.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    let dated = 0;
    let threw = false;
    try {
      dated = newestMtime(join(root, 'src'));
    } catch {
      threw = true;
    }
    check(
      'CONTROL: and a directory holding one ordinary file is dated, not refused',
      !threw && dated > 0,
      `a directory with one ordinary source file ${threw ? 'threw' : `dated to ${String(dated)}`}. ` +
        `Without this the case above passes for a walk that refuses every directory, which is ` +
        `the same reading as a walk that can see none of them.`,
    );
  }

  // -------------------------------------------------------------------------
  // The two refusals that are about the call rather than the tree.
  // -------------------------------------------------------------------------
  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/never-built.js']], 1);
    check(
      'a missing artefact is reported as missing rather than as fresh',
      refused && message.includes('does not exist'),
      `an artefact that was never built ${refused ? `refused with: ${message}` : 'was accepted'}. ` +
        `"Could not compare" must not read as "compared and agreed" — the two are the same ` +
        `observation to everything downstream, and one of them means no build has happened.`,
    );
  }

  {
    const root = tree();
    writeAt(join(root, 'src', 'a.ts'), 'source\n', OLD);
    writeAt(join(root, 'dist', 'a.js'), 'built\n', NEW);
    const { refused, message } = refusal(root, [['src/a.ts', 'dist/a.js']], 2);
    check(
      'a pair count that disagrees with the call site is refused',
      refused && message.includes('declares'),
      `one pair passed against a call site declaring two: ${refused ? message : '(accepted)'}\n` +
        `      The literal is the anchor, and the danger runs toward the list being SHORT — ` +
        `GGGGG-1 was two cases that began reading the Vite bundle with no row following them. ` +
        `A count derived from the list agrees with any list, including the one missing an entry.`,
    );
  }

  if (recorded.length !== CASES.length || recorded.some((label, at) => label !== CASES[at])) {
    throw new Error(
      `CASES does not describe what ran.\n  declared:\n    ${CASES.join('\n    ')}\n  ran:\n    ` +
        `${recorded.join('\n    ')}`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} build-freshness failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('build-freshness case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
if (failures.length > 0) process.exitCode = 1;
