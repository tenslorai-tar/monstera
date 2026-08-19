// @ts-check
/**
 * Proof for the pre-commit gate as a whole (rule B2).
 *
 * guardFiles.proof.mjs covers the content policy. This covers the two things
 * only the assembled hook can demonstrate:
 *
 *   - a staged secret blocks the commit, and the finding is printed redacted,
 *     so catching a credential does not copy it into terminal scrollback and
 *     CI logs (invariant L12);
 *   - a missing scanner blocks the commit rather than waving it through. This
 *     is the case that matters most and the one a hand-written hook usually
 *     gets backwards: "scanner not found, continuing" reports success for a
 *     scan that never ran.
 *
 * Each runs against a throwaway repository, driving the real hook module.
 *
 * Usage: node scripts/hooks/preCommit.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE, configPathFor } from '../lib/secretScan.mjs';
import { provisionGitleaks } from '../provision/gitleaks.mjs';
import { NPM_VERSION } from '../lib/toolchain.mjs';
import { pathsTouchContractTypes, touchesContractTypes } from './contractDrift.mjs';
import { LOCKFILE_VALIDATING_NPM, compareVersions, explain } from './lockfileIntegrity.mjs';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), 'preCommit.mjs');

// Resolved before any throwaway repository exists, because `repoRoot()` answers
// about the process's own directory and the cases below run the hook elsewhere.
const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Shaped to match gitleaks' aws-access-token rule. Not a real credential: the
 * body is arbitrary characters chosen only to satisfy the pattern, and the
 * proof asserts it is never echoed back unredacted.
 */
const FAKE_AWS_KEY = `AKIA${'QYLPMN5HXK3TVBZR'}`;

/**
 * @param {string} cwd
 * @param {readonly string[]} args
 */
function git(cwd, args) {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
  }
}

/** @returns {string} */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-hook-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'proof@example.invalid']);
  git(root, ['config', 'user.name', 'Hook Proof']);

  // The gate scans with `--config <repo>/.gitleaks.toml` and refuses to run
  // without it, so the throwaway repository needs one. Copied from this
  // repository rather than written afresh: a stand-in config would let the two
  // drift, and the proof would then be exercising a ruleset nothing ships.
  copyFileSync(configPathFor(REAL_ROOT), join(root, CONFIG_FILE));

  // The gate also refuses when the PreToolUse guard is not registered, for the
  // same reason: a hook cannot detect its own absence, so the git hook says so.
  // Copied for the same reason as the config — a stand-in would let the fixture
  // pass against settings this project does not ship.
  mkdirSync(join(root, '.claude'), { recursive: true });
  copyFileSync(join(REAL_ROOT, '.claude', 'settings.json'), join(root, '.claude', 'settings.json'));

  writeFileSync(join(root, 'README.md'), '# scratch\n');
  git(root, ['add', 'README.md', CONFIG_FILE]);
  git(root, ['commit', '--quiet', '--no-verify', '-m', 'base']);
  return root;
}

/**
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, output: string }}
 */
function runHook(root, env = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {string} contents
 */
function stage(root, relativePath, contents) {
  writeFileSync(join(root, relativePath), contents);
  git(root, ['add', '--', relativePath]);
}

// The pass-path case needs a working scanner, because the gate is designed to
// block when none is present. That is a precondition of the proof, so the proof
// satisfies it itself rather than depending on a caller having run provisioning
// first — an ordering dependency that is invisible until the day someone runs
// the proofs on a fresh clone, or puts them first in a CI job.
await provisionGitleaks();

/** @type {string[]} */
const failures = [];

let passed = 0;

/**
 * @param {string} name
 * @param {() => string | null} run Returns a failure message, or null to pass.
 */
function check(name, run) {
  const message = run();
  if (message === null) {
    passed += 1;
    process.stdout.write(`  ok  ${name}\n`);
  } else {
    failures.push(`${name}: ${message}`);
  }
}

// Control: a clean stage must commit. Without this the two rejection cases
// below would also pass against a hook that blocked absolutely everything.
check('clean staged change passes the gate', () => {
  const root = makeRepo();
  try {
    stage(root, 'config.ts', 'export const endpoint = "https://example.invalid/api";\n');
    const { ok, output } = runHook(root);
    return ok ? null : `expected the gate to pass, it blocked:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

check('staged secret blocks the commit and is printed redacted', () => {
  const root = makeRepo();
  try {
    stage(root, 'deploy.ts', `const awsKey = "${FAKE_AWS_KEY}";\n`);
    const { ok, output } = runHook(root);
    if (ok) return 'expected the gate to block a staged AWS-shaped key, it passed.';
    if (output.includes(FAKE_AWS_KEY)) {
      return (
        'the gate blocked the commit but echoed the secret verbatim, which copies it into ' +
        `terminal scrollback and CI logs. Output:\n${output}`
      );
    }
    return null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

check('missing scanner blocks the commit instead of skipping the scan', () => {
  const root = makeRepo();
  try {
    stage(root, 'notes.md', '# nothing secret here\n');
    // Points the resolver at a binary that does not exist. Everything else is
    // clean, so a gate that passes here is a gate that would pass any commit
    // whenever the scanner is absent.
    const { ok, output } = runHook(root, {
      MONSTERA_GITLEAKS: join(root, 'no-such-gitleaks-binary'),
    });
    if (ok) return 'expected the gate to block when no scanner is available, it passed.';
    if (!output.includes('secret scanner is not installed')) {
      return `blocked, but without explaining that the scanner was missing:\n${output}`;
    }
    return null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Finding W-2: the contract proof holds its fixtures as STRINGS, so `typecheck`
// cannot see them and a contract change leaves two copies with only one in the
// fast loop. It happened twice in one range. The gate is conditional because the
// proof costs about fifty seconds, and a gate that charges that on every commit
// is one somebody switches off.
// -----------------------------------------------------------------------------

check('the contract-drift gate fires on a contract source', () => {
  return pathsTouchContractTypes(['packages/contract/src/channel.ts'])
    ? null
    : 'a staged contract source did not arm the gate, so the proof would not have run.';
});

check('the contract-drift gate fires on a shared source, because Failure lives there', () => {
  return pathsTouchContractTypes(['packages/shared/src/result.ts'])
    ? null
    : 'the wire failure type lives in packages/shared, and both occurrences of this finding ' +
        'began with a change to it.';
});

check('CONTROL: it stays quiet for documents and tests', () => {
  // Without this the predicate is satisfied by one that returns true always,
  // and then every commit pays fifty seconds — which is how a gate gets
  // switched off. Tests are excluded deliberately: `typecheck` already reads
  // them, so they cannot change what the proof compiles against.
  const quiet = [
    'docs/JOURNAL.md',
    'packages/contract/src/boundary.test.ts',
    'apps/desktop/src/documentCommands.test.ts',
    'scripts/audit/scope.mjs',
  ];
  return pathsTouchContractTypes(quiet)
    ? `the gate armed for ${quiet.join(', ')} — none of these can change what the contract ` +
        'proof compiles against.'
    : null;
});

check('CONTROL: an unreadable index arms the gate rather than skipping it', () => {
  // Fail-closed, executed rather than asserted. `touchesContractTypes` reads the
  // staged list with git; pointed somewhere git will not answer, it must return
  // TRUE. Running a check that was not needed costs fifty seconds; skipping one
  // that was costs a red main nobody reads.
  //
  // The `root` parameter exists for exactly this: the branch is unreachable from
  // inside this repository, and a property no test can reach is one the code is
  // free to lose.
  const outside = mkdtempSync(join(tmpdir(), 'monstera-nogit-'));
  try {
    // The premise of the case, checked rather than assumed — under a $TMPDIR
    // that happened to sit inside a work tree, git would answer and this would
    // be testing the ordinary path while reporting on the failure one.
    const reachable = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: outside });
    if (reachable.status === 0) {
      return `the fixture directory ${outside} is inside a git work tree, so the read does not ` +
        'fail and this case proves nothing about the fail-closed branch.';
    }
    return touchesContractTypes(outside)
      ? null
      : 'an unreadable index left the gate disarmed. A staged list that cannot be read is not ' +
          'evidence that nothing relevant is staged.';
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// The lockfile guard refuses below a MEASURED floor. Occurrence 3 of the
// regenerating lockfile defect got past this guard because `npm ci --dry-run`
// on npm 11.6.2 resolves an ideal tree and reports what it WOULD install — a
// success indistinguishable from validating the recorded one. Bisected: 11.6.2
// accepts, 11.6.3 rejects.
// -----------------------------------------------------------------------------

check('versions compare NUMERICALLY, not as strings', () => {
  // The ordinary way to get this wrong. Under string comparison '11.6.10' sorts
  // BELOW '11.6.3', which would refuse an entire npm series that answers this
  // question perfectly well — and, worse, the reverse mistake would admit one
  // that cannot.
  if (compareVersions('11.6.10', '11.6.3') <= 0) return "'11.6.10' was not treated as newer than '11.6.3'.";
  if (compareVersions('11.6.3', '11.6.10') >= 0) return 'the comparison is not antisymmetric.';
  if (compareVersions('11.6.3', '11.6.3') !== 0) return 'equal versions did not compare equal.';
  return null;
});

check('the floor admits the version that validates and refuses the one that does not', () => {
  // The resolution test, at the smallest difference that changes a decision:
  // one patch release, which is where the behaviour actually changed.
  if (compareVersions('11.6.2', LOCKFILE_VALIDATING_NPM) >= 0) {
    return `11.6.2 was admitted. It reports success for a lockfile it never validated, which is ` +
      `how the defect this guard exists for reached CI.`;
  }
  if (compareVersions('11.6.3', LOCKFILE_VALIDATING_NPM) < 0) {
    return `11.6.3 was refused. It is the measured floor — refusing it would make the guard ` +
      `unrunnable for no reason.`;
  }
  if (compareVersions('11.17.0', LOCKFILE_VALIDATING_NPM) < 0) return 'a much newer npm was refused.';
  return null;
});

check('a refusal explains that nothing was checked, not that the lockfile is wrong', () => {
  const text = explain('REFUSED: npm 11.6.2 cannot validate a lockfile.\n');
  if (!/could not be run/u.test(text)) return `the refusal reads as a lockfile failure:\n${text}`;
  if (!/npm install -g npm/u.test(text)) return `the refusal does not name the remedy:\n${text}`;
  return null;
});

check('the remedy names the PINNED npm, never a floating tag', () => {
  // The defect this case exists for: the first draft advised `npm@latest`,
  // which is today a MAJOR above what the runners run — a guard that exists
  // because a floating `node-version: 24` moved the runners' npm without a
  // commit, advising a moving target of its own, pointing the disagreement the
  // other way.
  const text = explain('REFUSED: npm 11.6.2 cannot validate a lockfile.\n');
  if (/@latest|@next|@beta/u.test(text)) {
    return `the remedy names a floating tag:\n${text}`;
  }
  if (!text.includes(`npm@${NPM_VERSION}`)) {
    return `the remedy does not name the pinned npm (${NPM_VERSION}), so it can drift from the ` +
      `version the runners actually use:\n${text}`;
  }
  if (!text.includes(LOCKFILE_VALIDATING_NPM)) {
    return `the refusal does not state the minimum separately. A contributor already past the ` +
      `floor has no reason to move, and telling them to would be advice they should ignore.`;
  }
  return null;
});

check('CONTROL: a real lockfile failure still reads as one', () => {
  // Without this, the branch above is satisfied by an `explain` that returns the
  // refusal text for everything — and then a genuinely broken lockfile would be
  // reported as a stale npm, sending the reader to the wrong fix.
  const text = explain('npm error code EUSAGE\nnpm error Missing: @emnapi/runtime@1.11.3 from lock file\n');
  if (/could not be run/u.test(text)) return `a genuine failure was reported as a refusal:\n${text}`;
  if (!/cannot satisfy package\.json/u.test(text)) return `the failure lost its message:\n${text}`;
  if (!/rm -rf node_modules/u.test(text)) return `the failure does not name the repair:\n${text}`;
  return null;
});

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} hook proof failure(s):\n\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
// Counted, not typed. A hand-written total drifts the moment a case is added,
// and it drifts SILENTLY: the number is prose, so nothing compares it to
// anything. This file has carried a stale one twice.
process.stdout.write(`\n${String(passed)} hook cases passed.\n`);
