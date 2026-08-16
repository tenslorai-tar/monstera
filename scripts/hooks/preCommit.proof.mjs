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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), 'preCommit.mjs');

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
  writeFileSync(join(root, 'README.md'), '# scratch\n');
  git(root, ['add', 'README.md']);
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

/** @type {string[]} */
const failures = [];

/**
 * @param {string} name
 * @param {() => string | null} run Returns a failure message, or null to pass.
 */
function check(name, run) {
  const message = run();
  if (message === null) {
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

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} hook proof failure(s):\n\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
process.stdout.write('\n3 hook cases passed.\n');
