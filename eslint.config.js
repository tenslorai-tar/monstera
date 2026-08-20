import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
// From `eslint/config`, not from `@eslint/compat`. Both export a function of
// this name and @eslint/compat's is deprecated in its own docstring, which
// points here; ESLint ships this one, so taking the compat package would have
// added a dependency to reach an older copy of the code already installed.
import { globalIgnores, includeIgnoreFile } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { PLAIN_NODE_GLOB } from './scripts/lib/plainNodeScope.mjs';

/**
 * The C1 module graph, declared once and projected into lint rules below.
 *
 * These boundaries are enforced by two mechanisms that fail differently, which
 * is deliberate: TypeScript project references reject an unreferenced
 * cross-package import at compile time, and the import restrictions below
 * reject it at lint time with a message saying why. `scripts/proofs/
 * boundaries.proof.mjs` violates every one of them on purpose and fails the
 * build if any is silently permitted.
 *
 * eslint-plugin-boundaries was tried first and removed. Under npm workspaces a
 * sibling package resolves through node_modules, so the plugin classified
 * `@monstera/*` as external dependencies and its rules skipped them entirely —
 * `default: "disallow"` with an explicit disallow policy reported nothing.
 * Restoring it would mean adding a TypeScript-aware resolver whose own failure
 * mode is that same silence. Import restrictions need no resolver and were
 * proven to work before being adopted.
 */
/**
 * @typedef {'shared' | 'contract' | 'kernel' | 'ui' | 'testing' | 'desktop'} PackageName
 *
 * A union rather than `string`. Every table below is keyed by it, so a lookup is
 * provably present and `noUncheckedIndexedAccess` has nothing to widen — the
 * alternative was an index signature, which makes every lookup `| undefined`
 * and buys a dozen non-null assertions to silence a question the type can
 * simply answer.
 */

/** @type {readonly PackageName[]} */
export const PACKAGES = ['shared', 'contract', 'kernel', 'ui', 'testing', 'desktop'];

/**
 * Exported so `scripts/proofs/boundaries.proof.mjs` GENERATES its cases from
 * this table rather than restating it. A hand-maintained case list beside a
 * generated rule set is the second wiring place the registry pattern exists to
 * forbid, and it is why the previous proof covered four of six packages and one
 * of four import routes while reporting "11 boundary cases passed".
 */
/** @type {Record<PackageName, readonly PackageName[]>} */
export const ALLOWED_IMPORTS = {
  shared: [],
  contract: ['shared'],
  kernel: ['shared', 'contract'],
  ui: ['shared', 'contract'],
  testing: ['shared', 'contract'],
  desktop: ['shared', 'contract', 'kernel'],
};

/** Where each package's directory sits, relative to the repository root. */
/** @type {Record<PackageName, string>} */
export const PACKAGE_DIR = {
  shared: 'packages/shared',
  contract: 'packages/contract',
  kernel: 'packages/kernel',
  ui: 'packages/ui',
  testing: 'packages/testing',
  desktop: 'apps/desktop',
};

/**
 * Where each package's sources live.
 *
 * @type {Record<PackageName, string>}
 */
const PACKAGE_GLOB = {
  shared: 'packages/shared/**/*.{ts,tsx}',
  contract: 'packages/contract/**/*.{ts,tsx}',
  kernel: 'packages/kernel/**/*.{ts,tsx}',
  ui: 'packages/ui/**/*.{ts,tsx}',
  testing: 'packages/testing/**/*.{ts,tsx}',
  desktop: 'apps/desktop/**/*.{ts,tsx}',
};

const BOUNDARY_MESSAGE =
  'This import crosses a boundary the architecture forbids (ARCHITECTURE §1). The kernel stays headless so the document pipeline is unit-testable in plain Node; the renderer stays browser-only so it cannot hold a filesystem path. If a feature genuinely needs this, rule B4 applies: amend the architecture first, in its own commit, with the rejected alternatives.';

/**
 * Every route to a forbidden package, not a list of the routes someone thought
 * of. The previous version named `**\/${target}/src/**` specifically, which left
 * `../../kernel/dist/index.js` — the package's actual entry point — resolving
 * cleanly through lint, tsc and the boundary proof alike. A boundary with a
 * documented bypass is not a boundary, and enumerating members of a class is how
 * the bypass got there.
 *
 * The four routes the generated proof cases exercise, one per forbidden edge:
 * bare specifier, subpath export, relative into src, relative into dist. The
 * last two collapse into `**\/${target}/**`, which covers any directory inside
 * the package rather than the two that were remembered.
 *
 * @param {PackageName} target
 * @returns {string[]}
 */
function patternsFor(target) {
  return [
    `@monstera/${target}`,
    `@monstera/${target}/**`,
    // The package directory itself, e.g. `../../kernel`.
    `**/${target}`,
    // Anything inside it: src, dist, a subpath, a file added next year.
    `**/${target}/**`,
  ];
}

/**
 * Packages permitted to import a host-specific runtime. Written as exceptions
 * rather than as an allowlist of the packages that are banned: the previous form
 * enumerated `kernel|ui|shared|contract`, so `testing` — where the browser shim
 * lives, which by definition must run without Electron — inherited no ban at
 * all, and any package added later would inherit none either. An exception list
 * fails safe; a membership list fails open.
 */
const MAY_IMPORT_ELECTRON = 'desktop';
const MAY_IMPORT_REACT = 'ui';

/**
 * Electron's specifier and its subpaths, in ONE place because two consumers now
 * restrict it: the per-package boundary below, and the plain-Node block at the
 * bottom of this file.
 *
 * Exported so `electronImports.proof.mjs` reads the list rather than restating
 * it — ADR-0012's rule applied to specifiers.
 *
 * MEASURED, because a proof case was written on the opposite assumption and
 * survived its own mutation: under `patterns.group`, ESLint matches
 * gitignore-style, so the bare `electron` ALREADY restricts `electron/main`.
 * The second entry is redundant and is kept only as documentation of intent —
 * do not read it as the thing that makes subpaths work, and do not write a
 * check whose only variable is its presence, because there is nothing there to
 * separate. (The exactness warning below is about `paths`, a different option,
 * and it remains true of `paths`.)
 */
export const ELECTRON_SPECIFIERS = ['electron', 'electron/**'];


/** Node built-ins the renderer must never import, with and without the prefix. */
const NODE_BUILTINS = [
  'fs',
  'fs/promises',
  'path',
  'child_process',
  'os',
  'crypto',
  'net',
  'http',
  'https',
  'worker_threads',
  'module',
  'vm',
].flatMap((name) => [name, `node:${name}`]);

const RENDERER_MESSAGE =
  'The renderer is browser-only and never touches the filesystem (invariants L1 and L2). Path-consuming operations take a FileHandle minted by CapabilityRegistry and cross the generated contract boundary.';

/**
 * @param {PackageName} pkg
 * @returns {import('eslint').Linter.Config}
 */
function boundaryConfigFor(pkg) {
  const forbidden = PACKAGES.filter(
    (other) => other !== pkg && !ALLOWED_IMPORTS[pkg].includes(other),
  );

  /** @type {{group: string[], message: string}[]} */
  const patterns = forbidden.map((target) => ({
    group: patternsFor(target),
    message: BOUNDARY_MESSAGE,
  }));

  // Subpaths, not just bare specifiers. `no-restricted-imports` `paths` matches
  // the import string exactly, so the previous form blocked `electron` while
  // `electron/main`, `electron/renderer`, `react/jsx-runtime` and
  // `react-dom/client` all passed — every one of which is how those packages are
  // actually imported.
  if (pkg !== MAY_IMPORT_ELECTRON) {
    patterns.push({
      group: ELECTRON_SPECIFIERS,
      message:
        pkg === 'ui'
          ? 'The renderer is sandboxed and reaches main only through the generated contract bridge (invariant L1).'
          : 'Only apps/desktop may import Electron. An Electron import here means this code can no longer run in plain Node, which is the entire reason for the boundary.',
    });
  }

  if (pkg !== MAY_IMPORT_REACT) {
    patterns.push({
      group: ['react', 'react/**', 'react-dom', 'react-dom/**'],
      message:
        'This package is headless. UI state and components belong in packages/ui (ARCHITECTURE §1).',
    });
  }

  if (pkg === 'ui') {
    patterns.push({ group: NODE_BUILTINS, message: RENDERER_MESSAGE });
  }

  return {
    files: [PACKAGE_GLOB[pkg]],
    rules: {
      'no-restricted-imports': ['error', { patterns }],
    },
  };
}

export default tseslint.config(
  // Build output and scratch space are ignored by DERIVING the list from
  // .gitignore, not by maintaining a second copy of it.
  //
  // The second copy had drifted to five artifact paths against .gitignore's
  // sixteen, and the gap is not a style problem: `projectService: true` makes
  // any .js or .ts outside every tsconfig a FATAL PARSE ERROR, so an unignored
  // build directory does not produce a lint warning, it fails `eslint .`
  // outright. Reproduced on a one-line `out/index.js`, which is gitignored and
  // was not in the list. None of `dist-electron/`, `out/`, `build/` or `.vite/`
  // exists yet, so the trap springs on whoever runs the first Electron build —
  // on a developer machine, since CI builds from a clean checkout and would not
  // reproduce it.
  //
  // Deriving is what removes the class. A divergence check between two lists
  // was the alternative and it keeps both lists, so it can only report the
  // drift it was going to have anyway. The conversion is ESLint's own rather
  // than hand-written, because anchoring, `**` and trailing slashes are a
  // specification and a hand parser of it looks right while being quietly
  // wrong.
  //
  // Measured limit, not a claim: this translates gitignore patterns into flat
  // config `ignores`, and the two do not agree on re-inclusion. `!.env.example`
  // and `!.vscode/extensions.json` are both still ignored afterwards. Neither
  // is lintable, so nothing turns on it here — but do not read the derivation
  // as gitignore semantics, only as gitignore's *paths*.
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),

  // Paths git keeps but ESLint must not read. Not a second copy of the list
  // above: those are artifacts git discards, these are tracked files that are
  // not lintable source, which is why the list is short and each entry has a
  // reason.
  globalIgnores([
    // Not code.
    'DESIGN-DRAFT.html',
    // C we compile. CLAUDE.md and ARCHITECTURE both state that native/ sits
    // outside every tsconfig and every ESLint rule, with the compiler as its
    // only check — and the config did not say so, which meant the claim was
    // true only because native/ happens to hold no .ts or .js today. The first
    // one added would have been a fatal parse error under projectService, the
    // same trap as the build directories above, and the derivation does not
    // cover it: .gitignore re-includes native/ so its source can be tracked.
    'native/**',
  ]),

  js.configs.recommended,

  // Type-aware linting everywhere. B7 makes `any` an error rather than a
  // warning, and the rules that actually catch `any` crossing a boundary —
  // no-unsafe-assignment, no-unsafe-argument, no-unsafe-member-access — exist
  // only in the type-checked configs. The untyped preset would leave B7
  // enforced by review alone.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      // Without a resolver, import-x falls back to Node resolution — and
      // NodeNext plus verbatimModuleSyntax force every intra-package specifier
      // to be written `./foo.js`, a file that does not exist on disk. The graph
      // walk stopped at the first edge, so `no-cycle` and `no-self-import` below
      // were configured as errors and could never fire: all 13 relative
      // specifiers in packages/**/src were unresolvable, and both rules returned
      // silently rather than reporting that they had failed to look.
      //
      // The header of this file rejected eslint-plugin-boundaries because a
      // TypeScript-aware resolver's "own failure mode is that same silence" —
      // then adopted two rules that need one, and got that silence. The answer
      // is not to avoid the resolver but to make its silence audible, which is
      // what `no-unresolved` below does.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          // The root project, which carries `references` to every package.
          // Listing the package tsconfigs individually also works but makes the
          // resolver warn about multiple projects on every run, and a warning
          // printed on every run is one nobody reads.
          project: 'tsconfig.json',
          alwaysTryTypes: true,
        }),
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',

      // Errors, not warnings. A warning accumulates until nobody reads the
      // output, which is how a codebase acquires hundreds of escapes.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Permanent, and load-bearing for the two rules beneath it. If the
      // resolver ever goes blind again, this turns the build red instead of
      // quietly muting cycle detection. It is the alarm on the silence.
      'import-x/no-unresolved': 'error',
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-self-import': 'error',
    },
  },

  ...PACKAGES.map(boundaryConfigFor),

  {
    // React rules, scoped to the one package that may import React.
    //
    // These were asserted as enforced in two documents while ESLint configured
    // no React rule at all: `eslint --print-config packages/ui/src/index.ts`
    // returned an empty list, and the plugin was installed but never imported.
    // Harmless on the day it was found — react is not yet a dependency and this
    // package holds one `export {}` file — and unfixable in practice the moment
    // it stops being harmless, which is B9's whole argument: a rule that governs
    // how components are WRITTEN cannot be retrofitted across a codebase that
    // was written without it.
    //
    // Turning them on against an empty package costs nothing, which is exactly
    // why it must happen now rather than at the first .tsx.
    //
    // `recommended-latest` rather than a hand-listed set: the rules that make up
    // the React Compiler's requirements change between plugin versions — v7.1.1
    // ships 17 where the documents claimed "four" — and a hand-maintained list
    // is a second place to update that will drift the way every other one has.
    //
    // `configs.flat['recommended-latest']`, not `configs['recommended-latest']`:
    // the plugin ships both, and the top-level one is eslintrc-shaped with
    // `plugins` as an array of strings. ESLint 10 rejects it outright, which is
    // the good failure — the alternative shape would have loaded and silently
    // enforced nothing.
    files: ['packages/ui/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    rules: {
      // The plugin ships four of its rules as warnings. This project has no
      // warning tier — a warning is a finding nobody is required to act on — so
      // they are raised here, deliberately and in one place.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
    },
  },

  {
    // The bootstrap layer: plain .mjs, type-checked through JSDoc rather than
    // compiled, because it runs before dependencies exist (ARCHITECTURE §1.1).
    //
    // THE BOUNDARY ABOVE IS PER-PACKAGE; THIS ONE IS PER-RUNTIME, and the two
    // are not the same axis. `boundaryConfigFor` exempts `desktop` because
    // apps/desktop is where Electron may be imported — but "may import Electron"
    // is a property of code that RUNS INSIDE Electron, and package membership is
    // only a proxy for that. Everything under `scripts/` is started by plain
    // `node`, where importing `electron` resolves to `index.js`, whose
    // `module.exports` IS `getElectronPath()` — so the import downloads an
    // unpinned binary through `install.js`. Spawn the provisioned path instead.
    files: [PLAIN_NODE_GLOB, 'eslint.config.js', 'vitest.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // ESLint owns the four STATIC shapes and only those. Measured against
      // 10.8.1: the rule's visitor object is `ImportDeclaration`,
      // `ExportNamedDeclaration`, `ExportAllDeclaration`,
      // `TSImportEqualsDeclaration` — `ImportExpression` appears nowhere in the
      // file, so `import('electron')` is NOT covered, and no `CallExpression`
      // visitor means `require('electron')` is not either.
      //
      // Those two are covered by `scriptsLoadingAtRuntime`, and the split is
      // deliberate: this half is the authority's own answer (B3a), the other
      // half is the residue the authority does not claim. Neither is a second
      // opinion about what the first one says.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ELECTRON_SPECIFIERS,
              message:
                'Plain Node must never import Electron: the import itself resolves to index.js, whose module.exports is getElectronPath(), which downloads an unpinned binary. Spawn electronBinaryPath() from scripts/provision/electron.mjs instead.',
            },
          ],
        },
      ],
    },
  },
);
