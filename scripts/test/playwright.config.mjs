// @ts-check
/**
 * The Playwright run: §10.4's mandated accessibility gate.
 *
 * §10.4, verbatim: *"Accessibility is enforced at runtime, not by a static lint
 * rule. … The mandated gate is axe-core running on every Playwright-rendered
 * screen from Stage 0, with zero serious violations — which is the stronger
 * check anyway: it sees composed screens, focus order and real contrast, where
 * a static rule sees one element's props."* `BUILD-PROMPT.md:768-773` names the
 * same vehicle against the browser shim.
 *
 * ## `.pw.ts`, because `.spec.ts` is already taken
 *
 * `vitest.config.mjs` declares no `include`, so vitest uses its default, which
 * collects any file whose name ends `.test.` or `.spec.` with a js/ts
 * extension, anywhere in the tree. A Playwright spec named `.spec.ts` would
 * therefore be collected by vitest, which cannot run it. Two runners silently
 * claiming one file is the kind of overlap that produces a confusing failure in
 * whichever one loses.
 *
 * The pattern is described rather than quoted: writing the glob inside a block
 * comment puts a comment terminator in the middle of it, and the first draft
 * reached for a zero-width joiner to break that up. `guardFiles.mjs` rejected
 * the commit — correctly, since an invisible codepoint changes how text reads
 * without changing what it contains, and that is the whole class it exists for.
 *
 * ## The page is SERVED, not opened from disk
 *
 * The renderer's bundle is an ES module, and Chromium refuses module scripts
 * over `file://` — the page would load, the bundle would not, and an empty
 * document scores zero accessibility violations. That is the reassuring answer
 * arriving from a page that never mounted, so it is worth stating why this
 * costs a server at all.
 *
 * `vite preview` against the renderer's OWN build config, rather than a static
 * server written here: the thing being served is that config's `outDir`, and a
 * second opinion about where the build output lives is how the two drift (B3a).
 * Invoked by path rather than through `npx`, for the reason
 * `scripts/provision/playwright.mjs` gives about PATH choosing binaries.
 *
 * ## No retries
 *
 * A flaky accessibility gate is one nobody believes. `retries: 0` means a
 * violation is reported the first time it happens, and an intermittent one is a
 * finding rather than something the runner smooths over.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4173;

// THE BROWSER PATH IS SET HERE, so no caller has to remember it. Left to the
// environment, `npm run test:a11y` silently drives whatever browser the machine
// has in its per-user cache instead of the one `provision:playwright` put in
// `.tools/` — and it passes, against an artefact this repository never chose.
// Not overridden when already set, so a deliberate value still wins.
process.env['PLAYWRIGHT_BROWSERS_PATH'] ??= join(REPO_ROOT, '.tools', 'playwright');

export default defineConfig({
  testDir: join(REPO_ROOT, 'packages', 'testing', 'src'),
  testMatch: '**/*.pw.ts',
  // The gate is a gate: one violation fails the run, and nothing is retried
  // into a pass.
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `node ${JSON.stringify(join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))} preview --config ${JSON.stringify(join(REPO_ROOT, 'scripts', 'build', 'renderer.vite.config.mjs'))} --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    cwd: REPO_ROOT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
