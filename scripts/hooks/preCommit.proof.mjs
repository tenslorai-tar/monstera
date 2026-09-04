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
 *
 * ## WHY THIS TAKES TEN MINUTES, measured 2026-09-04 so it is not re-derived
 *
 * `npm run local` bounds a script at 10 minutes and seals the sweep
 * `failed (1 timed out)` on this file, while `npm run proof:guards` exits 0 on
 * its own. Both are true and the composition is this, timed against a faithful
 * throwaway repository with one staged file:
 *
 * | phase | cost |
 * |---|---|
 * | one whole hook invocation | **~9.2 s** |
 * | — of which: startup, file guard, emitted templates | 1.3 s |
 * | — of which: document rules | 1.5 s |
 * | — of which: test anchors | 0.6 s |
 * | — of which: **the secret scan** | **~5.8 s** |
 * | 33 cases, hook only | ~305 s |
 * | the rest: 33 x makeRepo (init, 3 configs, 4 copies, a commit) and teardown | ~290 s |
 *
 * **The secret scan is the single largest item and almost none of it is
 * scanning.** gitleaks reports `scanned ~55 bytes in 481ms`; `resolveGitleaks()`
 * is **1 ms**; a bare `gitleaks version` spawn is **0.7 s**. So roughly 4.6 s
 * per invocation is gitleaks' own start-up-to-scan work on a 21.5 MB binary,
 * outside this repository and not something a fixture can change.
 *
 * ## Two things it is NOT, each eliminated by measurement rather than argument
 *
 * - **Not the stack-ownership gate.** Its trigger is `/\bstack\b/` over staged
 *   source blobs, and **2 of the 33 cases** stage one. The gating in
 *   `preCommit.mjs` is doing exactly what it was written to do.
 * - **Not the deleted `npm_execpath`.** Timed both ways: 8.9/9.3/8.9 s with it
 *   deleted against 8.9/10.0/9.0 s with it set. The branch that correction
 *   forces is not the expensive one.
 *
 * **What made it 630 s when the 2026-09-03 run log records 183 s is NOT
 * established.** The gitleaks pin has never moved (`git log -L` on
 * `GITLEAKS_VERSION`), and this file had the same 33 cases at its last touch.
 * Nothing in the tree accounts for the change, so no cause is claimed.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAIM_DOCUMENTS } from '../lib/registeredHooks.mjs';
import { CONFIG_FILE, configPathFor } from '../lib/secretScan.mjs';
import { provisionGitleaks } from '../provision/gitleaks.mjs';
import { NPM_VERSION } from '../lib/toolchain.mjs';
import { pathsTouchContractTypes, touchesContractTypes } from './contractDrift.mjs';
import {
  LOCKFILE_VALIDATING_NPM,
  compareVersions,
  explain,
  globalPrefixOverride,
  touchesDependencies,
} from './lockfileIntegrity.mjs';

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

  // And the documents that CLAIM those hooks, because the gate's requirement is
  // now that the two agree: a hook a document names must be registered, which is
  // the anchor that makes unregistering one a red build (finding AAAA-16).
  //
  // Copied for the third time for the same reason, and the repetition is the
  // point — a stand-in claim file would drift from what this project actually
  // asserts, and the fixture would then be exercising an agreement between two
  // things nobody ships. The list comes from the resolver so that adding a
  // claim document does not silently leave this fixture behind.
  for (const document of CLAIM_DOCUMENTS) {
    const destination = join(root, document);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REAL_ROOT, document), destination);
  }

  writeFileSync(join(root, 'README.md'), '# scratch\n');
  git(root, ['add', 'README.md', CONFIG_FILE]);
  git(root, ['commit', '--quiet', '--no-verify', '-m', 'base']);
  return root;
}

/**
 * The environment a spawned hook receives.
 *
 * `npm_execpath` is DELETED, and that is the difference between exercising the
 * hook and exercising this proof's own launcher.
 *
 * git sets no such variable — a real `git commit` runs the hook from a bare
 * environment. This proof runs under `npm run`, which exports `npm_execpath`
 * pointing at the npm that started it, and a spawned child inherits it. So every
 * hook case has been running with the resolution SHORT-CIRCUITED by the first
 * branch of `npmCliPath`, and the branch a committer actually takes — find npm
 * beside node, then follow it to the global prefix — was exercised by nothing.
 *
 * Measured: with the prefix redirect removed, this proof stayed green while the
 * real hook refused every commit on this machine. Item 2's "verified against the
 * easy shape only", where the easy shape was an environment variable production
 * does not have.
 *
 * ## Why this is a named function and not four lines inside `runHook`
 *
 * So that a case can assert on it. The correction above was to the HARNESS — it
 * changed what this file hands its child — and **no assertion downstream can see
 * that**, because every case reads the hook's output and the hook succeeds
 * either way. Measured on 2026-08-20: with the `delete` removed, all 22 cases
 * still passed and the proof exited 0.
 *
 * That is the general remedy for item 2's ambient-environment axis. When the
 * defect is what the harness passes, the control asserts what the harness
 * passes; asserting on results tests a path that was never wrong.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
function childEnvironment(env = {}) {
  const inherited = { ...process.env, ...env };
  delete inherited['npm_execpath'];
  return inherited;
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
    env: childEnvironment(env),
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

// ---------------------------------------------------------------------------
// WW-4: the emitted-source backtick scan, moved from the Guards job into the
// gate. Written numerically, so this file cannot contain the thing it tests for.
// ---------------------------------------------------------------------------
const TICK = String.fromCharCode(96);

/** @param {string} comment The emitted body's one comment line. */
const emittedModule = (comment) =>
  [`const BODY = String.raw${TICK}`, `  ${comment}`, `  return 1;`, `${TICK};`, ''].join('\n');

check('a backtick inside an emitted-source template blocks the commit', () => {
  const root = makeRepo();
  try {
    stage(root, 'emit.mjs', emittedModule(`// the ${TICK}lower${TICK} flag, which closes this`));
    const { ok, output } = runHook(root);
    if (ok) return `expected the gate to block occurrence four's shape, it passed.`;
    return output.includes('emitted-source')
      ? null
      : `blocked, but not by this check — nothing named the class:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * THE LOAD-BEARING CASE, and the fixture is built so a disk-reading guard
 * cannot produce it: the violation is STAGED and then repaired in the working
 * tree.
 *
 * A guard reading the working copy sees a clean file and passes a commit whose
 * content is broken — `git add -p`, or any edit after staging. The two guards
 * are indistinguishable on every other input, which is why the ordinary case
 * above separates nothing here.
 */
check('CONTROL: the scan reads the INDEX, so repairing the working tree does not unblock it', () => {
  const root = makeRepo();
  try {
    stage(root, 'emit.mjs', emittedModule(`// the ${TICK}lower${TICK} flag, which closes this`));
    writeFileSync(join(root, 'emit.mjs'), emittedModule('// repaired on disk, not in the index'));
    const { ok, output } = runHook(root);
    return ok
      ? 'the gate passed a commit whose STAGED content carries the violation, because it read ' +
          'the working copy. A pre-commit guard that checks something other than what is being ' +
          'committed is checking the wrong bytes.'
      : output.includes('emitted-source')
        ? null
        : `blocked, but not by this check:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The other direction. Without it, "bans backticks in emitted templates" and
 * "bans backticks" pass the two cases above identically — and the second would
 * reject most of this repository.
 */
check('CONTROL: a backtick in ordinary code, outside any emitted region, still commits', () => {
  const root = makeRepo();
  try {
    stage(root, 'plain.mjs', `export const greet = (who) => ${TICK}hello \${who}${TICK};\n`);
    const { ok, output } = runHook(root);
    return ok ? null : `expected an ordinary template literal to pass, it blocked:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// UUU-2: the syntax parse. `stagedSyntax.proof.mjs` proves the SCAN; these
// prove the HOOK calls it, which is the other half of the wired-tools pair — a
// correct scan nothing invokes is the display-only sin with a green check on it.
// ---------------------------------------------------------------------------
check('a staged file that does not parse blocks the commit', () => {
  const root = makeRepo();
  try {
    stage(root, 'broken.mjs', 'export const a = ;\n');
    const { ok, output } = runHook(root);
    if (ok) return 'the gate passed a commit whose staged JavaScript does not parse.';
    return output.includes('does not parse')
      ? null
      : `blocked, but not by this check — nothing named the class:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The same index-versus-disk shape the template scan carries, for the same
 * reason: staged broken, repaired on disk. A guard reading the working tree
 * passes this, and the broken bytes go into the commit.
 */
check('CONTROL: the parse reads the INDEX, so repairing the working tree does not unblock it', () => {
  const root = makeRepo();
  try {
    stage(root, 'broken.mjs', 'export const a = ;\n');
    writeFileSync(join(root, 'broken.mjs'), 'export const a = 1;\n');
    const { ok, output } = runHook(root);
    return ok
      ? 'the gate passed a commit whose STAGED content does not parse, because it read the disk.'
      : output.includes('does not parse')
        ? null
        : `blocked, but not by this check:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The other direction, and it is the one that decides whether this guard
 * survives contact with the repository: TypeScript must still commit. V8 refuses
 * a type annotation, so a scope that reached `.ts` would block every commit
 * touching one — the shape that gets a guard switched off rather than fixed.
 */
check('CONTROL: a staged TypeScript file with type annotations still commits', () => {
  const root = makeRepo();
  try {
    stage(root, 'typed.ts', 'export const a: number = 1;\nexport function f(x: string): string { return x; }\n');
    const { ok, output } = runHook(root);
    return ok ? null : `expected an ordinary TypeScript file to pass, it blocked:\n${output}`;
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

// -----------------------------------------------------------------------------
// The trigger asks what CHANGED, not what the file is called.
//
// `touchesDependencies` was `path.endsWith('package.json')`, which asks nothing
// about the contents — the same filename-as-a-check shape corrected twice in the
// audit-scope classifier. A `scripts`-only edit cannot invalidate a lockfile,
// and it was arming a fifty-second validation whose whole subject is whether the
// recorded tree is still satisfiable.
//
// Five directions, because an allowlist is only as good as its worst entry and
// the failure is silent in the direction that matters: a key wrongly called
// inert switches this guard off for the change that needed it.
// -----------------------------------------------------------------------------
{
  const repo = mkdtempSync(join(tmpdir(), 'monstera-trigger-'));
  const manifest = (/** @type {Record<string, unknown>} */ value) =>
    `${JSON.stringify(value, null, 2)}\n`;

  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.email', 'proof@example.invalid']);
  git(repo, ['config', 'user.name', 'Hook Proof']);
  writeFileSync(
    join(repo, 'package.json'),
    manifest({ name: 'x', version: '1.0.0', scripts: { a: 'echo a' }, dependencies: { left: '^1' } }),
  );
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '--no-verify', '-m', 'base']);

  /** @param {Record<string, unknown>} value */
  const stage = (value) => {
    writeFileSync(join(repo, 'package.json'), manifest(value));
    git(repo, ['add', '-A']);
  };
  const reset = () => git(repo, ['reset', '--quiet', '--hard', 'HEAD']);

  const base = { name: 'x', version: '1.0.0', scripts: { a: 'echo a' }, dependencies: { left: '^1' } };

  check('a scripts-only edit does NOT arm the lockfile check', () => {
    stage({ ...base, scripts: { a: 'echo a', b: 'node scripts/thing.mjs' } });
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? 'a scripts edit armed a check whose subject is whether the lockfile can satisfy ' +
          'package.json. The lockfile root entry records name, version, license, workspaces and ' +
          'the dependency blocks — and not scripts, which is why this one key is on the list.'
      : null;
  });

  check('CONTROL: a dependency edit still arms it', () => {
    stage({ ...base, dependencies: { left: '^2' } });
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? null
      : 'the narrowing switched the guard off for the change it exists for. Without this the ' +
          'case above is satisfied by a trigger that never fires.';
  });

  check('an UNRECOGNISED top-level key arms it, rather than being assumed inert', () => {
    // `license` is the reason the allowlist has one entry and not seven: it
    // reads as inert and npm copies it into the lock. Everything not
    // demonstrated inert must trip, so being wrong costs fifty seconds.
    stage({ ...base, license: 'MIT' });
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? null
      : 'a key nobody has classified was treated as inert. The trip set is deliberately NOT ' +
          'derived from the lockfile root keys either — `overrides` never appears there and ' +
          'unquestionably changes resolution, so derivation under-triggers on the key most ' +
          'likely to matter.';
  });

  check('an ADDED manifest arms it, having no pair of blobs to compare', () => {
    mkdirSync(join(repo, 'packages', 'new'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'new', 'package.json'), manifest({ name: 'new' }));
    git(repo, ['add', '-A']);
    const armed = touchesDependencies({ root: repo });
    reset();
    rmSync(join(repo, 'packages'), { recursive: true, force: true });
    return armed
      ? null
      : 'a new workspace manifest is the most resolution-relevant change there is, and there is ' +
          'no before-blob to compare it against.';
  });

  check('a RENAMED manifest arms it', () => {
    mkdirSync(join(repo, 'packages', 'moved'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'moved', 'package.json'), manifest({ name: 'moved' }));
    // Sorts before `package.json`, so the rename below lands EARLIER in the
    // --name-status list than the root manifest. That ordering is what the
    // desync control needs.
    writeFileSync(join(repo, 'notes.md'), 'notes\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', 'a second manifest and a document']);
    git(repo, ['mv', 'packages/moved/package.json', 'packages/moved/renamed.json']);
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? null
      : 'a manifest that moved was treated as unchanged. There is no pair of blobs at one path ' +
          'to compare, and where a workspace manifest lives is itself resolution input.';
  });

  check('CONTROL: a rename earlier in the list does not hide a later dependency change', () => {
    // With -z a rename is `R100\0old\0new` and everything else is `X\0path`.
    // Consuming one field instead of two shifts every entry after it, and the
    // symptom is a wrong answer for a path the walk never properly reached.
    //
    // THE DIRECTION IS THE WHOLE CASE. Pairing the rename with a scripts-only
    // edit would prove nothing: a desync that loses the manifest entirely
    // returns false, which is exactly what an inert change returns. So the
    // later change must be one that MUST arm, and the rename is of an unrelated
    // document that sorts ahead of it.
    git(repo, ['mv', 'notes.md', 'notes-renamed.md']);
    stage({ ...base, dependencies: { left: '^3' } });
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? null
      : 'a rename ahead of it swallowed a dependency change. That is what a misaligned field ' +
          'walk looks like from the outside — not a crash, a quiet no.';
  });

  check('an UNPARSEABLE manifest arms it rather than being read as unchanged', () => {
    writeFileSync(join(repo, 'package.json'), '{ this is not json\n');
    git(repo, ['add', '-A']);
    const armed = touchesDependencies({ root: repo });
    reset();
    return armed
      ? null
      : 'a manifest that could not be parsed was reported as an inert change. "Cannot say" must ' +
          'never read as "no" — the same reason an unreadable staged list arms the ' +
          'contract-drift gate.';
  });

  rmSync(repo, { recursive: true, force: true });
}

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

// ---------------------------------------------------------------------------
// npm's OWN resolution has a second step, and this guard implemented only the
// first. Measured: `npm --version` reported 11.17.0 while the pre-commit hook
// resolved 11.6.2, in the same repository at the same moment — `npm run
// check:lockfile` validated the lockfile and the hook refused to look at it.
//
// npm's shim asks the npm beside `node` for the GLOBAL PREFIX and re-points at
// the npm installed there. `npm install -g npm@x` leaves the bundled copy in
// place, so a guard that stops at the bundled one asks a different npm than the
// developer does.
//
// The fixture is a candidate script that PRINTS a prefix, so no real npm is
// involved and the rule is tested rather than the environment.
// ---------------------------------------------------------------------------

/**
 * A temp directory this file will remove when it finishes.
 *
 * THESE FOUR HAD NO CLEANUP AT ALL, and the reason nobody noticed is worth more
 * than the fix: this file removes a temp directory in nine other places, so any
 * question of the form *does this file clean up* answers yes. Measured
 * 2026-08-27: **126 `monstera-npmpath-*` and 84 `monstera-npmprefix-*`**
 * directories in `%TEMP%`, from a proof that runs on every commit.
 *
 * A collected list rather than a `finally` per case, because three of the four
 * are created inside `check` callbacks whose return value is the verdict — a
 * `finally` there would have to be written three times, and the fourth site is
 * a helper whose caller cannot see what it made.
 *
 * @param {string} prefix
 * @returns {string}
 */
function tempDir(prefix) {
  const made = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(made);
  return made;
}

/** @type {string[]} */
const scratchDirs = [];

/**
 * @param {string} prefix What the fake npm reports for `prefix -g`.
 * @param {boolean} installThere Whether an npm exists under that prefix.
 * @returns {{ candidate: string, installed: string, resolved: string }}
 */
function resolveWithFakeNpm(prefix, installThere) {
  const scratch = tempDir('monstera-npmpath-');
  const candidate = join(scratch, 'npm-cli.js');
  writeFileSync(candidate, `process.stdout.write(${JSON.stringify(prefix)});\n`, 'utf8');

  const installed = join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (installThere) {
    mkdirSync(dirname(installed), { recursive: true });
    writeFileSync(installed, 'process.stdout.write("11.99.0");\n', 'utf8');
  }
  return { candidate, installed, resolved: globalPrefixOverride(candidate) };
}

check('a globally installed npm WINS over the one bundled beside node', () => {
  const prefix = tempDir('monstera-npmprefix-');
  const { installed, resolved } = resolveWithFakeNpm(prefix, true);
  if (resolved !== installed) {
    return (
      `resolved ${resolved}, expected ${installed}. npm's own shim re-points at the prefix, so ` +
      `stopping at the bundled copy asks a DIFFERENT npm than the developer does — measured at ` +
      `11.6.2 against a reported 11.17.0, with check:lockfile and the hook disagreeing.`
    );
  }
  return null;
});

check('CONTROL: with no npm under the prefix, the candidate stands', () => {
  const prefix = tempDir('monstera-npmprefix-');
  const { candidate, resolved } = resolveWithFakeNpm(prefix, false);
  if (resolved !== candidate) {
    return (
      `resolved ${resolved}, expected the candidate ${candidate}. Without this the case above is ` +
      `satisfied by a rule that always redirects, which would break every machine that has no ` +
      `global npm install — which is every CI runner here.`
    );
  }
  return null;
});

check('a prefix that cannot be read leaves the candidate in place', () => {
  const scratch = tempDir('monstera-npmpath-');
  const candidate = join(scratch, 'npm-cli.js');
  writeFileSync(candidate, 'process.exit(3);\n', 'utf8');
  const resolved = globalPrefixOverride(candidate);
  if (resolved !== candidate) {
    return (
      `resolved ${resolved} from an npm that exits non-zero. A prefix this cannot read is not ` +
      `evidence that none exists — and failing closed here would block every commit on a machine ` +
      `where \`prefix -g\` is sandboxed, for a redirect that is usually a no-op.`
    );
  }
  return null;
});

// FINDING BB-4's CONTROL, and it asserts an INPUT because the defect was one.
//
// The three cases above exercise `globalPrefixOverride` in isolation, which is
// the function the fix added. None of them exercises the thing the fix actually
// changed: that this file spawns the hook the way git does, from an environment
// with no `npm_execpath`. Measured on 2026-08-20 — with the `delete` removed,
// every case above still passed and the proof exited 0.
//
// So `9e185ec` shipped a change to which npm a guard resolves with no control,
// on a commit CI never evaluated (total_count 0 — it went out behind a0ebd81 and
// the concurrency group ran only the head). Its whole evidence was one Windows
// machine, and following the global prefix is exactly what differs on POSIX.
// B2: a fix without a control case is not finished.
//
// The case sets the variable rather than trusting the runner to have set it, so
// it proves the deletion happens rather than that the ambient environment
// happened to lack it — the same distinction the fix is about, one level up.
check('CONTROL: the environment a spawned hook receives carries no npm_execpath', () => {
  const previous = process.env['npm_execpath'];
  process.env['npm_execpath'] = join('nowhere', 'npm', 'bin', 'npm-cli.js');
  try {
    const bare = childEnvironment();
    const withExtra = childEnvironment({ MONSTERA_PROOF_MARKER: 'set' });
    if (bare['npm_execpath'] !== undefined || withExtra['npm_execpath'] !== undefined) {
      return (
        `the child would inherit npm_execpath=${String(bare['npm_execpath'])}, so every hook ` +
        `case below takes npmCliPath's FIRST branch and the branch a real \`git commit\` takes ` +
        `is exercised by nothing. This assertion is on the harness, not the hook, because the ` +
        `hook succeeds either way — which is why 22 cases passed with the fix reverted.`
      );
    }
    if (withExtra['MONSTERA_PROOF_MARKER'] !== 'set') {
      return (
        `the per-case overrides stopped reaching the child, so this control would pass by ` +
        `handing the hook nothing at all. An empty environment satisfies "no npm_execpath" ` +
        `vacuously (audit item 4b).`
      );
    }
    return null;
  } finally {
    if (previous === undefined) delete process.env['npm_execpath'];
    else process.env['npm_execpath'] = previous;
  }
});

// ---------------------------------------------------------------------------
// HHH-2: the stack-ownership scan runs from the gate, and only when the staged
// content can introduce the defect.
//
// The pair is what makes either case mean anything. The trigger costs 21 s when
// it fires — measured, against 1.0 s for the template scan — so a version that
// always fired and a version that never fired are both wrong, and the two cases
// below fail in opposite directions.
//
// A fixture repository has no TypeScript projects, so the scan REFUSES there.
// That is the observation: a hook that reached the scan reports its refusal, and
// a hook that never reached it walks on to the scanner. Asserting the refusal
// proves the wiring AND that the wiring fails closed, which is the property a
// textual "the hook names the module" assertion could never reach.
// ---------------------------------------------------------------------------
check('a staged source file naming the property reaches the stack-ownership scan', () => {
  const root = makeRepo();
  try {
    stage(root, 'reporter.mjs', 'export const show = (e) => e.stack ?? e.message;\n');
    const { ok, output } = runHook(root);
    if (ok) {
      return (
        'the gate passed without reaching the scan. The trigger reads staged blobs for the ' +
        'token, and this file carries it on the only line it has.'
      );
    }
    return /stack-ownership|tsconfig|project references/iu.test(output)
      ? null
      : `blocked, but not by this check — nothing named it:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

check('CONTROL: a staged source file that does NOT name it never pays for the scan', () => {
  const root = makeRepo();
  try {
    stage(root, 'plain.mjs', 'export const add = (a, b) => a + b;\n');
    const { ok, output } = runHook(root);
    return ok
      ? null
      : `expected the gate to pass a file with no stack read, it blocked:\n${output}\n\n` +
          `Without this the case above is satisfied by a hook that runs the scan on every ` +
          `commit, which is the version that gets bypassed.`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

check('CONTROL: and the trigger reads the INDEX, not the working tree', () => {
  const root = makeRepo();
  try {
    stage(root, 'reporter.mjs', 'export const show = (e) => e.stack ?? e.message;\n');
    writeFileSync(join(root, 'reporter.mjs'), 'export const show = (e) => String(e);\n');
    const { ok, output } = runHook(root);
    return ok
      ? 'the gate passed a commit whose STAGED content names the property, because the ' +
          'trigger read the working copy. Deciding whether to look from bytes other than the ' +
          'ones being committed is deciding from the wrong file.'
      : /stack-ownership|tsconfig|project references/iu.test(output)
        ? null
        : `blocked, but not by this check:\n${output}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// BEFORE the verdict, and unconditionally: a run that fails leaves as much
// behind as one that passes, and `process.exit` below would skip anything
// written after it.
while (scratchDirs.length > 0) {
  const made = scratchDirs.pop();
  if (made !== undefined) rmSync(made, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} hook proof failure(s):\n\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
// Counted, not typed. A hand-written total drifts the moment a case is added,
// and it drifts SILENTLY: the number is prose, so nothing compares it to
// anything. This file has carried a stale one twice.
process.stdout.write(`\n${String(passed)} hook cases passed.\n`);
