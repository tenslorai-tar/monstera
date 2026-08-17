import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
      group: ['electron', 'electron/**'],
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
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.tools/**',
      'release/**',
      'coverage/**',
      'DESIGN-DRAFT.html',
      // Scratch space. Proofs write probe files here and delete them in a
      // `finally`; a proof that dies before its cleanup would otherwise turn
      // the next lint run red for a file that is not part of the codebase, and
      // a red build nobody caused is a red build people learn to ignore. This
      // entry must stay in step with the `.probe/` line in .gitignore.
      '.probe/**',
      // Boundary probes must live inside a package to be matched by that
      // package's rules, so they cannot go in `.probe/`. Ignored here for the
      // same reason: a proof killed mid-run must not leave a file that turns
      // `npm run lint` and `npm run typecheck` red for code nobody wrote.
      // boundaries.proof.mjs passes `ignore: false` so it still sees them.
      '**/__boundary_probe__.ts',
    ],
  },

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
    // The bootstrap layer: plain .mjs, type-checked through JSDoc rather than
    // compiled, because it runs before dependencies exist (ARCHITECTURE §1.1).
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vitest.config.mjs'],
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
    },
  },
);
