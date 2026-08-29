// @ts-check
/**
 * The renderer bundle's build.
 *
 * ## Where this file lives, and why not beside the source
 *
 * A `vite.config.ts` under `packages/ui/` would sit outside that package's
 * tsconfig, whose `include` is `src/**` — and ESLint's `projectService` makes
 * any `.ts` outside every tsconfig a **fatal parse error**, not a warning. The
 * repository already keeps its build tooling in `scripts/build/`
 * (`preload.mjs`), which is plain `.mjs` under `tsconfig.scripts.json` with
 * `checkJs`, so this is the existing seam rather than a new one.
 *
 * ## Where the OUTPUT goes, and why not `apps/desktop/renderer/`
 *
 * Into `apps/desktop/dist/renderer/`, beside the compiled main process. The
 * loaded page is a **build artefact**, so it belongs in the ignored directory
 * with the rest of them; emitting into a tracked directory would have the build
 * overwrite a file git is keeping, which is how a source file quietly becomes
 * output nobody can edit.
 *
 * ## `base: './'`, and this one is not a preference
 *
 * Vite's default `base` is `/`, which emits `<script src="/assets/…">`. Under
 * `file://` that resolves to the drive root and the bundle 404s — with the page
 * still loading, so the window opens empty and the failure looks like a mount
 * bug. Relative paths are what a `file://` document needs.
 *
 * ## electron-vite is pinned by ADR-0004 and is deliberately not used here
 *
 * That ADR pins `electron-vite@5.0.0` for a three-target build — main, preload,
 * renderer. Two of those three already exist and were built by hand for reasons
 * that were measured: `tsc` for main, and `scripts/build/preload.mjs` because a
 * sandboxed preload must be CommonJS and the ESM one Electron refuses is
 * announced on an event nothing was listening to. Adopting the wrapper now
 * would replace two working, proven steps to gain one. The pin stands; nothing
 * uses it yet, and that is stated rather than left as a dependency somebody
 * finds unreferenced.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  root: join(REPO_ROOT, 'packages', 'ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: join(REPO_ROOT, 'apps', 'desktop', 'dist', 'renderer'),
    // Emptied on every build. `renderer/` is Vite's alone — `tsc` writes its
    // siblings in `dist/`, not this directory — so a stale chunk from an earlier
    // build cannot survive here and be loaded by a hash nobody rebuilt.
    emptyOutDir: true,
  },
});
