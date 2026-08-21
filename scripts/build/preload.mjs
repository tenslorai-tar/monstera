// @ts-check
/**
 * Bundles the preload into a CommonJS file the sandboxed renderer can load.
 *
 * ## The defect this exists to remove, measured
 *
 * `preload.js: SyntaxError: Cannot use import statement outside a module`,
 * reported by Electron's `preload-error` event and **by nothing else** — no
 * stderr line, no exception in main, no failed load. The window came up, the
 * page rendered, and `window.monstera` was simply absent. Every check this
 * repository had was structural: `preloadSurface.mjs` derives the permitted
 * import set from the file's syntax, and `contract.proof.mjs` proves the
 * channels are exhaustive. Both passed, correctly, about a file that had never
 * been executed by anything.
 *
 * That is the display-only sin with a green check on it, and it was found the
 * hour a renderer read-back existed to ask the page what it could see.
 *
 * ## Two reasons a sandboxed preload cannot be what `tsc` emits
 *
 * 1. **It is loaded as CommonJS.** Electron supports an ESM preload only at
 *    `.mjs` *and* only with `sandbox: false`. `apps/desktop` is
 *    `"type": "module"`, so `tsc` emits `dist/preload.js` as ESM and Chromium
 *    refuses it. Turning the sandbox off to make the file loadable would trade
 *    ARCHITECTURE §2's first non-negotiable for a build convenience.
 * 2. **`require` in a sandboxed preload resolves a small fixed set**, not
 *    `node_modules`. `@monstera/contract` could not be reached from there even
 *    as CommonJS, and `BRIDGE_KEY` must come from the contract rather than be
 *    retyped beside it — one writer for the bridge's name (B3a).
 *
 * Bundling answers both at once: the key is inlined at build time and the only
 * `require` left in the output is `electron`, which is in the supported set.
 *
 * ## Vite, because it is already the bundler here
 *
 * Adding a second one for a single file would be a second opinion about how
 * this project turns TypeScript into something a runtime loads. Called through
 * the JS API from `scripts/` rather than through a config file at the package
 * root, which would sit outside every tsconfig and lint glob — the hole
 * invariant 26 names, and a file put there acquires neighbours.
 *
 * ## `tsc` still emits `dist/preload.js`, and it is inert
 *
 * Type-checking the preload is what produces it. The window names
 * `preload.cjs`; pointing it back at the `.js` reproduces the exact SyntaxError
 * above, and `proof:rendererpolicy` reports the bridge as unreachable when it
 * happens, so the dead artefact cannot quietly become the live one.
 *
 * Usage: node scripts/build/preload.mjs
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESKTOP = join(REPO_ROOT, 'apps', 'desktop');

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    // NOT emptied. `tsc --build` has already written the shell into this
    // directory, and a bundler that clears its output directory would delete
    // the main process on its way past.
    emptyOutDir: false,
    outDir: join(DESKTOP, 'dist'),
    minify: false,
    lib: {
      entry: join(DESKTOP, 'src', 'preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      // The one module a sandboxed preload may reach at run time. Anything else
      // left external here would become a `require` the renderer cannot
      // resolve — the same silent absence, one layer along.
      external: ['electron'],
    },
  },
});
