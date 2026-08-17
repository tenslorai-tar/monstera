// @ts-check
/**
 * Proof that `npm test` reads package SOURCE and never a package's `dist`
 * build (rule B2).
 *
 * The defect this guards was not a missing test. Deleting `cause` propagation
 * from `packages/shared/src/result.ts` left 27/27 green; rebuilding `dist` and
 * repeating the identical mutation turned 2 tests red. The assertions existed
 * the whole time and were pointed at a stale copy of the code.
 *
 * Method: poison, don't mutate. The distinguishing question is which FILE the
 * specifier `@monstera/shared` loads, so this rewrites the built
 * `packages/shared/dist/index.js` to a module that throws on import, then runs
 * the real suite. Poisoning build output rather than tracked source matters for
 * two reasons — `dist` is gitignored, so a proof killed halfway cannot leave a
 * change that reaches a commit, and the repair is `npm run typecheck` rather
 * than a careful edit-back that could itself go wrong.
 *
 *   fixed   : suite passes — nothing loaded the poisoned file
 *   control : suite fails with the poison's own marker — the alias map is the
 *             only thing standing between the tests and the stale build
 *
 * The control runs the same suite against a generated config whose alias points
 * at `dist`, which is what the resolution did before this was fixed. It is what
 * makes the pass meaningful: without it, a green run is equally consistent with
 * a poison that never took effect, and this project has already shipped four
 * instruments that could not tell their two inputs apart (checklist 4a).
 *
 * Usage: node scripts/proofs/testResolution.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { workspaceAliases, workspacePackages } from '../lib/workspaceAliases.mjs';

const ROOT = repoRoot();
const POISON_MARKER = 'MONSTERA_LOADED_FROM_DIST';
const POISONED_DIST = join(ROOT, 'packages', 'shared', 'dist', 'index.js');
const CONTROL_CONFIG = join(ROOT, 'vitest.control.config.mjs');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * Runs a workspace tool through node directly rather than through `npm`.
 *
 * `npm` on Windows is `npm.cmd`, which Node will not spawn without `shell:true`
 * — and `shell:true` with an argument array concatenates them into a command
 * line unescaped, which is both a deprecation warning and the same
 * shell-rewrites-your-bytes hazard the project's standing rule is about.
 * Spawning the tool's own `.mjs` entry point needs no shell at all.
 *
 * @param {string} bin Path relative to the repository root.
 * @param {readonly string[]} args
 * @returns {{ ok: boolean, output: string }}
 */
function run(bin, args) {
  const result = spawnSync(process.execPath, [join(ROOT, bin), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const VITEST = join('node_modules', 'vitest', 'vitest.mjs');
const TSC = join('node_modules', 'typescript', 'bin', 'tsc');

// ---------------------------------------------------------------------------
// The alias map itself, before anything depends on it being right.
// ---------------------------------------------------------------------------
{
  const packages = workspacePackages(ROOT);
  check(
    'every workspace package is aliased',
    packages.length >= 6,
    `found ${packages.length}: [${packages.map((p) => p.name).join(', ')}]`,
  );

  const aliases = workspaceAliases(ROOT);
  const toDist = aliases.filter(({ replacement }) => replacement.replaceAll('\\', '/').includes('/dist/'));
  check(
    'no alias resolves into a dist directory',
    toDist.length === 0,
    `these point at build output: [${toDist.map((a) => a.replacement).join(', ')}]`,
  );

  // Resolution test for the regexes: a prefix-matching string alias would
  // rewrite a longer neighbouring name onto the wrong package, and the two
  // names differ by exactly the character that distinguishes them.
  const shared = aliases.find(({ find }) => find.test('@monstera/shared'));
  check(
    'an alias matches @monstera/shared',
    shared !== undefined,
    `patterns: [${aliases.map((a) => String(a.find)).join(', ')}]`,
  );
  check(
    'and does NOT also capture a longer name that merely starts with it',
    !aliases.some(({ find }) => find.test('@monstera/shared-extra')),
    'a plain string `find` matches by prefix; @monstera/shared-extra would be rewritten into ' +
      'packages/shared/src, silently testing the wrong package.',
  );
}

// ---------------------------------------------------------------------------
// End to end, against the real suite.
// ---------------------------------------------------------------------------
if (!existsSync(POISONED_DIST)) {
  const built = run(TSC, ['--build']);
  check('the workspace builds, so there is a dist to poison', built.ok, built.output.slice(-1200));
}

const original = existsSync(POISONED_DIST) ? readFileSync(POISONED_DIST, 'utf8') : null;

try {
  if (original === null) {
    failures.push(
      'packages/shared/dist/index.js is absent even after a build\n      ' +
        'Without it the control below cannot distinguish "resolved to source" from ' +
        '"dist was never there", which is the vacuous-proof shape.',
    );
  } else {
    writeFileSync(
      POISONED_DIST,
      `throw new Error(${JSON.stringify(POISON_MARKER)});\n`,
      'utf8',
    );

    const fixed = run(VITEST, ['run']);
    check(
      'the suite passes with a poisoned dist — nothing resolved through build output',
      fixed.ok && !fixed.output.includes(POISON_MARKER),
      `exit ok=${fixed.ok}. Tail:\n${fixed.output.slice(-1600)}`,
    );

    // The control. Same poison, same suite, aliases pointed where they pointed
    // before the fix. This must FAIL, and must fail by loading the poison
    // rather than for some unrelated reason.
    writeFileSync(
      CONTROL_CONFIG,
      [
        "import { defineConfig } from 'vitest/config';",
        '',
        '// Generated by scripts/proofs/testResolution.proof.mjs. Reproduces the',
        '// pre-fix resolution: @monstera/shared resolving to its dist build.',
        'export default defineConfig({',
        '  resolve: {',
        '    alias: [',
        `      { find: /^@monstera\\/shared$/u, replacement: ${JSON.stringify(
          POISONED_DIST.replaceAll('\\', '/'),
        )} },`,
        '    ],',
        '  },',
        "  test: { exclude: ['**/node_modules/**', '**/dist/**', '.tools/**', '.probe/**', 'release/**'] },",
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const control = run(VITEST, ['run', '--config', 'vitest.control.config.mjs']);
    check(
      'CONTROL: with the alias pointed at dist, the same suite loads the poison',
      !control.ok && control.output.includes(POISON_MARKER),
      `exit ok=${control.ok}, marker present=${control.output.includes(POISON_MARKER)}.\n      ` +
        `A pass here means the poison never took effect, so the case above proves nothing.\n` +
        `Tail:\n${control.output.slice(-1600)}`,
    );
  }
} finally {
  if (original !== null) writeFileSync(POISONED_DIST, original, 'utf8');
  rmSync(CONTROL_CONFIG, { force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nTest-resolution proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} test-resolution cases passed.\n`);
