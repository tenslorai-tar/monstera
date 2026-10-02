// @ts-check
/**
 * Proves the package's module closure (`scripts/release/shippedModules.mjs`) ships what the application loads and
 * nothing a test alone uses (decision E).
 *
 * The owner's 0.1.6.0 carried `engineHostFake.js`, a test's fake of the Win32 host surfaces, because the package took
 * every module not NAMED as a test. The closure takes what the entry reaches instead.
 *
 * - **A generated tree** holds each kind of edge once — a relative import, a workspace import through `exports`, a
 *   file named by a literal, as the shell names a preload and a host entry, that file's own import, and a package entry
 *   the code only resolves, as the shell finds the reader (0.1.7.0 shipped without it and did not start) — and a
 *   helper nothing reaches. The case
 *   asserts the closure EXACTLY, so an edge that stopped being followed and a helper that started shipping both redden.
 * - **CONTROL**: the same tree with the literal removed leaves its file out — so the literal edge is what reached it,
 *   and the exact set above is not the closure answering "everything".
 * - **CONTROL**: a module the application loads by path, but that nothing names, makes the closure REFUSE, rather than
 *   answer a package without it.
 * - **The built tree**: the repository's own `dist/`s, laid out as the package lays them. `engineHostFake.js` and the
 *   harnesses are out, and every module loaded by path is in. Unverifiable where nothing is built.
 *
 * Usage: node scripts/proofs/shippedModules.proof.mjs [--require-build]
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHIPPED_MODULES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { loadTypeScript } from '../lib/loadTypeScript.mjs';
import { formatError } from '../lib/reportError.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import { modulesLoadedByPath, moduleClosure, moduleSpecifiers } from '../release/shippedModules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The workspace packages the package ships beside the desktop's, as `packageMsix.mjs` lists them. */
const WORKSPACES = ['kernel', 'contract', 'shared', 'nodemode'];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/** @param {string} label @param {boolean} condition @param {string} detail @param {boolean} [ran] */
function check(label, condition, detail, ran = true) {
  const mark = roster.mark();
  if (ran && !condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label, ran);
}

const BUILT_CASE =
  "the built tree: engineHostFake.js and the harnesses are left out, and every module loaded by path is in, with nodemode's resolved entry";
const REQUIRE_BUILD = process.argv.includes('--require-build');
/** Why the built case did not run, or null where it ran. @type {string | null} */
let unbuilt = null;

/**
 * A tree shaped like the package: `app/dist` and one workspace package under `app/node_modules/@monstera/k`.
 *
 * @param {string} root
 * @param {{ readonly literal: boolean }} options
 */
function generatedTree(root, options) {
  /** @param {string} path @param {string} text */
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  // THE RESOLVE EDGE, as `readerHostSurface.ts` spells it: the package's entry is resolved for its directory and never
  // imported. `Promise.resolve` with a specifier-shaped string beside it is not an edge.
  put(
    'dist/entry.js',
    "import { createRequire } from 'node:module';\nimport { a } from './a.js';\nimport { k } from '@monstera/k';\n" +
      "const reader = createRequire(import.meta.url).resolve('@monstera/n');\nvoid Promise.resolve('@monstera/k/host');\n" +
      'export const run = () => [a, k, reader];\n',
  );
  put(
    'dist/a.js',
    options.literal
      ? "import { join } from 'node:path';\nexport const a = join(import.meta.dirname, 'preload.cjs');\n"
      : 'export const a = 1;\n',
  );
  // A MODULE LOADED BY PATH has its own imports followed: nothing but the preload names its part.
  put('dist/preload.cjs', "module.exports = require('./preloadPart.cjs');\n");
  put('dist/preloadPart.cjs', 'module.exports = {};\n');
  put('node_modules/@monstera/n/package.json', JSON.stringify({ name: '@monstera/n', exports: { '.': { default: './dist/index.js' } } }));
  put('node_modules/@monstera/n/dist/index.js', 'export {};\n');
  put('dist/testFake.js', "export const fake = 'imported by a test only';\n");
  put('dist/renderer/assets/index.js', 'export {};\n');
  put('node_modules/@monstera/k/package.json', JSON.stringify({ name: '@monstera/k', exports: { '.': { default: './dist/index.js' }, './host': { default: './dist/host.js' } } }));
  put('node_modules/@monstera/k/dist/index.js', "export { k } from './util.js';\n");
  put('node_modules/@monstera/k/dist/util.js', 'export const k = 2;\n');
  put('node_modules/@monstera/k/dist/host.js', 'export const unreached = true;\n');
}

/** @param {string} root @returns {(name: string) => string | null} */
const packagesUnder = (root) => (name) => {
  const directory = join(root, 'node_modules', ...name.split('/'));
  return existsSync(join(directory, 'package.json')) ? directory : null;
};

/** @param {string} root @param {Iterable<string>} paths */
const named = (root, paths) => [...paths].map((path) => path.slice(resolve(root).length + 1).replaceAll('\\', '/')).sort();

const scratch = mkdtempSync(join(tmpdir(), 'monstera-shipped-modules-'));
try {
  const ts = await loadTypeScript('the closure reads each module’s imports and literals with the compiler');

  const whole = join(scratch, 'whole');
  generatedTree(whole, { literal: true });
  const closure = moduleClosure({
    entry: join(whole, 'dist', 'entry.js'),
    roots: [join(whole, 'dist'), join(whole, 'node_modules', '@monstera', 'k', 'dist'), join(whole, 'node_modules', '@monstera', 'n', 'dist')],
    packageDir: packagesUnder(whole),
    mustReach: ['preload.cjs'],
    ts,
  });
  const expected = [
    'dist/a.js',
    'dist/entry.js',
    'dist/preload.cjs',
    'dist/preloadPart.cjs',
    'node_modules/@monstera/k/dist/index.js',
    'node_modules/@monstera/k/dist/util.js',
    'node_modules/@monstera/n/dist/index.js',
  ];
  check(
    "the closure is EXACTLY what the entry reaches: a relative import, a workspace import through exports, a file named by literal and that file's own import, and a package entry the code only RESOLVES",
    JSON.stringify(named(whole, closure.reached)) === JSON.stringify(expected),
    `reached ${JSON.stringify(named(whole, closure.reached))}, expected ${JSON.stringify(expected)}`,
  );
  check(
    'a helper nothing reaches, and an export nothing imports, are left out — and the renderer is not a candidate',
    JSON.stringify(named(whole, closure.unreached)) === JSON.stringify(['dist/testFake.js', 'node_modules/@monstera/k/dist/host.js']),
    `unreached ${JSON.stringify(named(whole, closure.unreached))}`,
  );

  const bare = join(scratch, 'bare');
  generatedTree(bare, { literal: false });
  const withoutLiteral = moduleClosure({
    entry: join(bare, 'dist', 'entry.js'),
    roots: [join(bare, 'dist'), join(bare, 'node_modules', '@monstera', 'k', 'dist'), join(bare, 'node_modules', '@monstera', 'n', 'dist')],
    packageDir: packagesUnder(bare),
    mustReach: [],
    ts,
  });
  check(
    'CONTROL: without the literal, the file it named is out, and so is its own import — the literal edge is what reached both',
    !named(bare, withoutLiteral.reached).includes('dist/preload.cjs') && !named(bare, withoutLiteral.reached).includes('dist/preloadPart.cjs'),
    `reached ${JSON.stringify(named(bare, withoutLiteral.reached))}`,
  );

  // WHAT COUNTS AS A RESOLVE, read from the parse: each receiver the shell can spell, and none of the look-alikes.
  const specifiers = moduleSpecifiers(
    [
      "import { createRequire } from 'node:module';",
      "const one = require.resolve('one');",
      "const two = createRequire(import.meta.url).resolve('two');",
      'const local = createRequire(import.meta.url);',
      "const three = local.resolve('three');",
      "void Promise.resolve('not-a');",
      "const path = { resolve: (x) => x }; void path.resolve('not-b');",
      "// require.resolve('not-c')",
      "const text = \"require.resolve('not-d')\";",
    ].join('\n'),
    ts,
  ).sort();
  check(
    "a resolve on require, on createRequire(…), or on a name bound to createRequire(…) is read; Promise.resolve, another object's resolve, a comment and a string are not",
    JSON.stringify(specifiers) === JSON.stringify(['node:module', 'one', 'three', 'two']),
    `read ${JSON.stringify(specifiers)}`,
  );

  /** @type {string} */
  let refusal = '';
  try {
    moduleClosure({
      entry: join(bare, 'dist', 'entry.js'),
      roots: [join(bare, 'dist'), join(bare, 'node_modules', '@monstera', 'k', 'dist')],
      packageDir: packagesUnder(bare),
      mustReach: ['preload.cjs'],
      ts,
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  check(
    'CONTROL: a module loaded by path that the closure cannot see makes it REFUSE, never answer without it',
    refusal.includes('preload.cjs'),
    `answered instead of refusing${refusal === '' ? '' : `: ${refusal}`}`,
  );

  const desktopDist = join(ROOT, 'apps', 'desktop', 'dist');
  if (!existsSync(join(desktopDist, 'entry.js')) || !existsSync(join(desktopDist, 'engineHostFake.js'))) {
    unbuilt = 'apps/desktop/dist is not built (or holds no engineHostFake.js to leave out). Run `npm run build`.';
    check(BUILT_CASE, false, '', false);
  } else {
    // THE BUILT TREE IS THE SUBJECT, so a stale one would answer for yesterday's modules.
    refuseStaleBuild(ROOT, SHIPPED_MODULES, 5);
    const built = moduleClosure({
      entry: join(desktopDist, 'entry.js'),
      roots: [desktopDist, ...WORKSPACES.map((name) => join(ROOT, 'packages', name, 'dist'))],
      packageDir: (name) => (name.startsWith('@monstera/') ? join(ROOT, 'packages', name.slice('@monstera/'.length)) : null),
      mustReach: await modulesLoadedByPath(desktopDist),
      ts,
    });
    const leftOut = built.unreached.map((path) => basename(path));
    // THE FILE 0.1.7.0 LEFT OUT: nodemode's entry, which the shell resolves to find the reader and nothing imports.
    const readerEntry = resolve(ROOT, 'packages', 'nodemode', 'dist', 'index.js');
    check(
      BUILT_CASE,
      leftOut.includes('engineHostFake.js') &&
        leftOut.includes('shellHarness.js') &&
        built.reached.has(resolve(desktopDist, 'entry.js')) &&
        built.reached.has(readerEntry),
      `left out ${String(leftOut.length)}: ${leftOut.slice(0, 20).join(', ')}; nodemode's entry ${built.reached.has(readerEntry) ? 'reached' : 'NOT reached'}`,
    );
    process.stdout.write(`the built tree: ${String(built.reached.size)} modules ship, ${String(built.unreached.length)} are left out\n`);
  }

  if (failures.length > 0) {
    process.stderr.write(`\nShipped-modules proof — ${failures.length} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('shipped-modules case')}\n`);
    if (unbuilt !== null) {
      const outcome = partialOutcome({ required: REQUIRE_BUILD, ran: roster.passed.length, missed: [BUILT_CASE], why: unbuilt, flag: '--require-build' });
      process[outcome.stream].write(outcome.text);
      process.exitCode = outcome.code;
    }
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
