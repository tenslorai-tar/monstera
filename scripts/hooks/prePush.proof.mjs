// @ts-check
/**
 * The pre-push gate decides from the register and from git, and refuses when it
 * cannot see (finding GG-1, third occurrence).
 *
 * Its reassuring answer is *this push changes nothing the register watches*,
 * which is also what an unreadable register, an empty glob set, a glob git no
 * longer understands, and an unparsed range all produce. Every case here exists
 * because one of those returns the same clean result as a push that genuinely
 * touches nothing.
 *
 * The ranges are decided against **fixture repositories** rather than this
 * one's history, so no case depends on a sha staying where it is.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { anyGlobResolves, decide, pushedRanges, watchedPathspecs } from './prePush.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 15 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @type {string[]} */
const scratches = [];

/** @param {string} cwd @param {readonly string[]} args */
function git(cwd, args) {
  return `${execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`;
}

/**
 * A throwaway repository carrying a register with one watched pathspec, and two
 * commits: one that touches it and one that does not.
 *
 * @param {{ globs?: string[], witnessGlobs?: string[], watchedFileExists?: boolean }} [shape]
 * @returns {{ root: string, base: string, touching: string, untouching: string }}
 */
function fixture(shape = {}) {
  const globs = shape.globs ?? ['apps/*/src/**'];
  const witnessGlobs = shape.witnessGlobs ?? ['packages/shared/src/**'];
  const dir = mkdtempSync(join(tmpdir(), 'monstera-prepush-'));
  scratches.push(dir);
  /** @param {string} path @param {string} contents */
  const put = (path, contents) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  };

  put(
    'docs/security/engine-advisories.json',
    `${JSON.stringify(
      {
        reachability: {
          'a-verdict': {
            guards: ['INVARIANT-1'],
            why: 'fixture',
            shippedPaths: globs,
            symbols: ['someSymbol'],
            witness: { someSymbol: { in: witnessGlobs, why: 'fixture' } },
          },
        },
        reachabilityControl: [{ from: witnessGlobs, symbol: 'export', why: 'fixture' }],
      },
      null,
      2,
    )}\n`,
  );
  put('README.md', 'fixture\n');
  if (shape.watchedFileExists !== false) put('apps/desktop/src/main.ts', 'export const a = 1;\n');
  put('packages/shared/src/index.ts', 'export const b = 2;\n');

  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']).trim();

  put('README.md', 'fixture, edited\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'touch nothing watched']);
  const untouching = git(dir, ['rev-parse', 'HEAD']).trim();

  put('apps/desktop/src/main.ts', 'export const a = 2;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'touch a watched path']);
  const touching = git(dir, ['rev-parse', 'HEAD']).trim();

  return { root: dir, base, touching, untouching };
}

const ZERO = '0'.repeat(40);

try {
  // -------------------------------------------------------------------------
  // GIT'S STDIN PROTOCOL. Four fields per line, and three of the four shapes
  // mean something different.
  // -------------------------------------------------------------------------
  {
    const normal = pushedRanges(`refs/heads/main abc123 refs/heads/main def456\n`);
    check(
      'a normal push line becomes a remote..local range',
      normal.ranges.length === 1 && normal.ranges[0] === 'def456..abc123' && !normal.unknown,
      `${JSON.stringify(normal)}`,
    );

    const newBranch = pushedRanges(`refs/heads/topic abc123 refs/heads/topic ${ZERO}\n`);
    check(
      'a ref that does not exist on the remote yet is UNKNOWN, not empty',
      newBranch.unknown && newBranch.ranges.length === 0,
      `${JSON.stringify(newBranch)}. There is no range to diff, and "no range" must not read ` +
        `as "nothing changed" — a new branch is the push most likely to carry the change.`,
    );

    const deletion = pushedRanges(`(delete) ${ZERO} refs/heads/gone def456\n`);
    check(
      'a DELETION publishes no content, so it is skipped rather than treated as unknown',
      deletion.ranges.length === 0 && deletion.unknown,
      `${JSON.stringify(deletion)}. It is skipped as a range; the run still falls through to ` +
        `"cannot tell", which checks. Erring toward running a 16 s check on a branch deletion ` +
        `is the cheap direction.`,
    );

    check(
      'and stdin that parses to nothing at all is UNKNOWN',
      pushedRanges('').unknown && pushedRanges('garbage\n').unknown,
      `Run by hand, or a protocol that changed. The honest answer is "cannot tell" and the safe ` +
        `one is to check.`,
    );
  }

  // -------------------------------------------------------------------------
  // THE DECISION, against a repository whose history the fixture controls.
  // -------------------------------------------------------------------------
  {
    const { root, base, touching, untouching } = fixture();
    const watched = decide(`refs/heads/main ${touching} refs/heads/main ${untouching}\n`, root);
    check(
      'a push whose range changes a watched path is checked',
      watched.check && watched.why.includes('file(s) the register watches'),
      `${JSON.stringify(watched)}`,
    );

    const unwatched = decide(`refs/heads/main ${untouching} refs/heads/main ${base}\n`, root);
    check(
      'CONTROL: and a push that changes nothing watched is NOT',
      !unwatched.check,
      `${JSON.stringify(unwatched)}. Without this the case above is satisfied by a hook that ` +
        `runs the check on every push — which is a 16 s tax on pushes that cannot break the ` +
        `register, and the way a hook becomes something people disable.`,
    );
  }

  // -------------------------------------------------------------------------
  // IT REFUSES WHEN THE MAPPING CANNOT BE READ. Each of these otherwise reports
  // "this push touches nothing watched", which is the answer everyone wants.
  // -------------------------------------------------------------------------
  {
    const dir = mkdtempSync(join(tmpdir(), 'monstera-prepush-'));
    scratches.push(dir);
    mkdirSync(join(dir, 'docs', 'security'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'security', 'engine-advisories.json'), '{}\n', 'utf8');
    let threw = false;
    try {
      watchedPathspecs(dir);
    } catch {
      threw = true;
    }
    check(
      'a register yielding NO pathspecs throws rather than watching nothing',
      threw,
      'An empty glob set answers "not touched" for every push, and it is the reassuring answer ' +
        'produced by having read nothing.',
    );
  }

  {
    // The globs parse, and match no tracked file. A glob whose syntax git
    // stopped understanding looks exactly like this.
    const { root, touching, untouching } = fixture({
      globs: ['nowhere/*/src/**'],
      witnessGlobs: ['also-nowhere/**'],
    });
    let threw = false;
    try {
      decide(`refs/heads/main ${touching} refs/heads/main ${untouching}\n`, root);
    } catch {
      threw = true;
    }
    check(
      'a watched set that matches NO tracked file makes the hook refuse',
      threw,
      'A pathspec matching nothing reports "not touched" for every push. This is the positive ' +
        'control, and it is in the instrument rather than only here, because the hook runs on ' +
        'the day someone pushes and nothing else is watching.',
    );
    check(
      'CONTROL: and the same set DOES resolve once a file exists under it',
      anyGlobResolves(['apps/*/src/**'], fixture().root),
      'Without this, the refusal above is satisfied by a resolver that always answers no.',
    );
  }

  // -------------------------------------------------------------------------
  // THIS REPOSITORY.
  // -------------------------------------------------------------------------
  {
    const globs = watchedPathspecs(ROOT);
    check(
      'THIS repository reads its watched pathspecs from the register',
      globs.length >= 5 && globs.includes('apps/*/src/**'),
      `globs = ${JSON.stringify(globs)}. \`apps/*/src/**\` is the scope the third occurrence ` +
        `came through, so its absence would mean the derivation missed the case that produced ` +
        `the finding.`,
    );
    check(
      'CONTROL: and at least one of them resolves against tracked files',
      anyGlobResolves(globs, ROOT),
      'The positive control, run against the real register rather than a fixture.',
    );
    check(
      'and the witness and control scopes are included, not only shippedPaths',
      globs.includes('packages/shared/src/**') && globs.includes('packages/kernel/src/**'),
      `globs = ${JSON.stringify(globs)}. A change that breaks a WITNESS is how a verdict goes ` +
        `green forever, and taking only the scanned scope would leave it unchecked.`,
    );
  }

  // -------------------------------------------------------------------------
  // REGISTERED. A hook nobody runs is a hook that does not exist.
  // -------------------------------------------------------------------------
  {
    const shim = readFileSync(join(ROOT, '.githooks', 'pre-push'), 'utf8');
    check(
      'the shim exists in the hooks path and runs this module',
      shim.includes('scripts/hooks/prePush.mjs'),
      `pre-push shim:\n${shim}`,
    );
    check(
      'and it refuses when node is absent rather than passing the push',
      shim.includes('Push blocked') && shim.includes('command -v node'),
      `A hook that skips itself when the runtime is missing reports success for a check that ` +
        `never ran, which is the shape the pre-commit shim already refuses.`,
    );
    const configured = `${execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: ROOT,
      encoding: 'utf8',
    })}`.trim();
    check(
      'and core.hooksPath points at the directory holding it',
      configured === '.githooks',
      `core.hooksPath = ${JSON.stringify(configured)}. The shim being tracked is not the same ` +
        `as git running it; \`npm run prepare\` sets this.`,
    );
  }
} finally {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
    : roster.format('pre-push case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
