import js from '@eslint/js';
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
const PACKAGES = ['shared', 'contract', 'kernel', 'ui', 'testing', 'desktop'];

const ALLOWED_IMPORTS = {
  shared: [],
  contract: ['shared'],
  kernel: ['shared', 'contract'],
  ui: ['shared', 'contract'],
  testing: ['shared', 'contract'],
  desktop: ['shared', 'contract', 'kernel'],
};

/** Where each package's sources live. */
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
 * Patterns that catch a forbidden package by package specifier *and* by a
 * relative path that reaches around it. Blocking only `@monstera/kernel` would
 * leave `../../kernel/src/thing.js` wide open, and a boundary with a documented
 * bypass is not a boundary.
 *
 * @param {string} target
 * @returns {string[]}
 */
function patternsFor(target) {
  return [`@monstera/${target}`, `@monstera/${target}/**`, `**/${target}/src/**`];
}

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
 * @param {string} pkg
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

  /** @type {{name: string, message: string}[]} */
  const paths = [];

  if (pkg === 'kernel' || pkg === 'ui' || pkg === 'shared' || pkg === 'contract') {
    paths.push({
      name: 'electron',
      message:
        pkg === 'ui'
          ? 'The renderer is sandboxed and reaches main only through the generated contract bridge (invariant L1).'
          : 'Only apps/desktop may import Electron. An Electron import here means this code can no longer run in plain Node, which is the entire reason for the boundary.',
    });
  }

  if (pkg === 'kernel' || pkg === 'shared' || pkg === 'contract') {
    paths.push(
      { name: 'react', message: 'This package is headless. UI state belongs in packages/ui.' },
      { name: 'react-dom', message: 'This package is headless.' },
    );
  }

  if (pkg === 'ui') {
    patterns.push({ group: NODE_BUILTINS, message: RENDERER_MESSAGE });
  }

  return {
    files: [PACKAGE_GLOB[pkg]],
    rules: {
      'no-restricted-imports': ['error', { paths, patterns }],
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
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',

      // Errors, not warnings. A warning accumulates until nobody reads the
      // output, which is how a codebase acquires hundreds of escapes.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

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
