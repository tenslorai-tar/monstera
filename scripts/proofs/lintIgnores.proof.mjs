// @ts-check
/**
 * Proof that ESLint ignores exactly the artifact paths git ignores, and still
 * lints the source (rule B2).
 *
 * The defect: ESLint carried its own hand-written ignore list, five artifact
 * paths against .gitignore's sixteen. That is not a tidiness problem — with
 * `projectService: true`, any .js or .ts outside every tsconfig is a FATAL
 * PARSE ERROR, so an unignored build directory does not warn, it fails
 * `eslint .` outright. None of dist-electron/, out/, build/ or .vite/ exists
 * yet, so the trap springs on the first Electron build, on a developer machine
 * — CI builds from a clean checkout and would not reproduce it.
 *
 * Two halves, and neither is evidence alone:
 *
 *   - every gitignored artifact directory is ignored, INCLUDING the four that
 *     the old hand-written list missed;
 *   - real source is still linted, and a planted violation still reddens the
 *     run. Without this half, a config that ignored the entire repository would
 *     satisfy every case above.
 *
 * Usage: node scripts/proofs/lintIgnores.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ESLint } from 'eslint';

import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

const eslint = new ESLint({ cwd: ROOT });

/**
 * Artifact paths that must be ignored. The first four are the ones the
 * hand-written list omitted, and are the reason this proof exists; the rest are
 * paths it did carry, kept so a regression in the derivation is visible rather
 * than being masked by the four that motivated it.
 */
const MUST_IGNORE = [
  'out/index.js',
  'dist-electron/main.js',
  'build/bundle.js',
  '.vite/deps/chunk.js',
  'packages/kernel/dist/index.js',
  'coverage/lcov-report/block.js',
  'release/win-unpacked/app.js',
  '.tools/gitleaks/wrapper.js',
  '.probe/scratch.js',
  'packages/ui/src/__boundary_probe__.ts',
  'node_modules/left-pad/index.js',
  // native/ is C we compile, declared by CLAUDE.md and ARCHITECTURE to sit
  // outside every tsconfig and every ESLint rule. The derivation does NOT cover
  // it — .gitignore re-includes native/ so the shim source can be tracked — so
  // this is held by an explicit entry, and this case is what keeps the two
  // documents' claim true rather than merely true-for-now. Before it, the first
  // .ts added under native/ would have been a fatal parse error.
  'native/mupdf-shim/probe.ts',
  'native/mupdf-shim/gen.js',
];

/**
 * Must NOT be ignored. `outbound/` is the resolution test: .gitignore says
 * `out/`, so a converter that turned it into a prefix match rather than a
 * directory match would swallow this too, and every case above would still
 * pass while real source silently stopped being linted.
 */
const MUST_LINT = [
  'packages/shared/src/result.ts',
  'packages/kernel/src/capabilityRegistry.ts',
  'eslint.config.js',
  'scripts/lib/workspaceAliases.mjs',
  'outbound/index.js',
  // Source living under a directory whose NAME matches an artifact pattern.
  // `.gitignore` carried an unanchored `release/`, which matches at any depth,
  // so scripts/release/ was untracked, unlinted and invisible to the file guard
  // at once — three failures, no error from any of them. The patterns are
  // anchored now; this is the case that notices if one comes loose again.
  'scripts/release/generateNotice.mjs',
  'scripts/build/placeholder.ts',
];

for (const relative of MUST_IGNORE) {
  const ignored = await eslint.isPathIgnored(join(ROOT, relative));
  check(`ignored: ${relative}`, ignored, 'gitignored artifact path that ESLint would try to parse');
}

for (const relative of MUST_LINT) {
  const ignored = await eslint.isPathIgnored(join(ROOT, relative));
  check(`linted:  ${relative}`, !ignored, 'this path is source, or is named to look like an artifact but is not');
}

// ---------------------------------------------------------------------------
// The control that makes the rest mean something: `eslint .` must still be able
// to fail. Everything above is answered by ESLint's own ignore logic, so a
// config that ignored the whole tree would satisfy all of it.
// ---------------------------------------------------------------------------
{
  const planted = join(ROOT, 'packages', 'shared', 'src', '__lint_ignore_probe__.ts');
  const artifact = join(ROOT, 'out', '__lint_ignore_probe__.js');

  try {
    // `any` is an error under B7, so this is a violation of a rule this project
    // actually enforces rather than a synthetic one.
    writeFileSync(planted, 'export const probe = 1 as any;\n', 'utf8');
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, 'export const built = 1 as any;\n', 'utf8');

    const run = spawnSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

    check(
      'CONTROL: a violation planted in real source still fails `eslint .`',
      run.status !== 0 && output.includes('__lint_ignore_probe__.ts'),
      `exit ${run.status}. If this passes, the ignore list swallows the source tree and every ` +
        `case above is vacuous.\n      Output tail:\n${output.slice(-800)}`,
    );

    check(
      'and the identical violation inside a build directory is not reported',
      !output.includes(join('out', '__lint_ignore_probe__.js')) &&
        !output.includes('out/__lint_ignore_probe__.js'),
      `the same code in out/ was reported, so build output is being linted:\n${output.slice(-800)}`,
    );
  } finally {
    rmSync(planted, { force: true });
    rmSync(artifact, { force: true });
    if (existsSync(dirname(artifact))) rmSync(dirname(artifact), { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nLint-ignore proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} lint-ignore cases passed.\n`);
