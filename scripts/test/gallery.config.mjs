/**
 * The dialog gallery's capture (`packages/testing/src/dialogGallery.capture.ts`): every registered dialog in every
 * sample state, in each look, photographed for review by eye. Not a test, run by hand, and written to `CAPTURE_OUT`,
 * which is never committed. The gallery is built first with `scripts/build/gallery.vite.config.mjs`.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { refuseUnwatchedCases } from '../lib/renderedCases.mjs';
import { BROWSERS_PATH } from '../provision/playwright.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4174;

process.env['PLAYWRIGHT_BROWSERS_PATH'] = BROWSERS_PATH;

// EVERY RENDERED CASE HEARS A DROPPED PICTURE (ADR-0296), as `playwright.config.mjs` refuses for the other suites.
refuseUnwatchedCases(join(REPO_ROOT, 'packages', 'testing', 'src'));

export default defineConfig({
  testDir: join(REPO_ROOT, 'packages', 'testing', 'src'),
  testMatch: '**/dialogGallery.capture.ts',
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `node ${JSON.stringify(join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))} preview --config ${JSON.stringify(join(REPO_ROOT, 'scripts', 'build', 'gallery.vite.config.mjs'))} --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}/gallery.html`,
    cwd: REPO_ROOT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
