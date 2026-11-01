// @ts-check
/**
 * Runs `packages/testing/src/shellRenders.measure.ts`, a text selection's main-thread cost on two built renderers in one
 * browser session, and nothing else. It prints readings, never a verdict.
 *
 * The two renderers are directories a `npm run build:renderer` wrote, copied aside: today's as `MONSTERA_BUNDLE_A`, the
 * one under test as `MONSTERA_BUNDLE_B`. Each is served by the suite's own `vite preview` and renderer configuration, on
 * its own port, so the server and the pinned browser are the suite's (B3a). It does not import the suite's
 * configuration, whose build-freshness check reads the one renderer directory the suite serves, which is neither.
 *
 * Run: MONSTERA_BUNDLE_A=<dir> MONSTERA_BUNDLE_B=<dir> npx playwright test --config scripts/research/shellRenders.config.mjs
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { BROWSERS_PATH } from '../provision/playwright.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env['PLAYWRIGHT_BROWSERS_PATH'] = BROWSERS_PATH;

/** @param {string} variable @returns {string} */
function bundle(variable) {
  const directory = process.env[variable];
  if (directory === undefined || directory === '') throw new Error(`${variable} names no renderer directory`);
  return resolve(directory);
}

const vite = JSON.stringify(join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'));
const config = JSON.stringify(join(REPO_ROOT, 'scripts', 'build', 'renderer.vite.config.mjs'));

/** @param {string} directory @param {number} port */
function served(directory, port) {
  return {
    command: `node ${vite} preview --config ${config} --outDir ${JSON.stringify(directory)} --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    cwd: REPO_ROOT,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}

export default defineConfig({
  testDir: join(REPO_ROOT, 'packages', 'testing', 'src'),
  testMatch: '**/shellRenders.measure.ts',
  retries: 0,
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], timezoneId: 'UTC', locale: 'en-US' },
  webServer: [served(bundle('MONSTERA_BUNDLE_A'), 4180), served(bundle('MONSTERA_BUNDLE_B'), 4181)],
});
