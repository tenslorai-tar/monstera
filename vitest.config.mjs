import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { workspaceAliases } from './scripts/lib/workspaceAliases.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Every `@monstera/*` specifier resolves to TypeScript source, never to a
    // package's `dist` build. See scripts/lib/workspaceAliases.mjs for the
    // mechanism and the measurement — in short, `exports` points at
    // `./dist/index.js`, so without this a test reads the last successful build
    // instead of the code it was written for, and a mutation to the source it
    // covers leaves the suite green.
    //
    // Derived from the workspace globs, so a package added later cannot miss
    // its alias and silently fall back to `dist`.
    alias: workspaceAliases(ROOT),
  },
  test: {
    // Vitest 4 does not exclude build output by default, so without this every
    // test file is collected twice: once from `src` as TypeScript and once from
    // `dist` as its compiled copy. That is worse than slow. The `dist` copy is
    // whatever the last successful build produced, so a test can pass there
    // while the source it was written for no longer compiles — a green result
    // for code that is not the code under test.
    //
    // This governs which test FILES are collected. It says nothing about which
    // module a specifier RESOLVES to, which is the alias map's job above; the
    // comment here used to claim it closed both, and that claim cost 27 green
    // tests over a deleted line of source.
    exclude: ['**/node_modules/**', '**/dist/**', '.tools/**', '.probe/**', 'release/**'],
  },
});
