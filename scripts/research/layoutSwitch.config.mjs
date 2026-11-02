// @ts-check
/**
 * Runs `packages/testing/src/layoutSwitch.measure.ts`, what a page layout switch costs (group U), and nothing else: the
 * rendered suite's own configuration with the measurement as its only file, so the bundle, the server and the pinned
 * browser are the suite's and no second opinion about any of them is written here (B3a).
 *
 * Run, against an unminified renderer for the function names:
 *   npx vite build --config scripts/build/renderer.vite.config.mjs --minify false
 *   MONSTERA_SWITCH_RESOLUTION=1 npx playwright test --config scripts/research/layoutSwitch.config.mjs
 *   MONSTERA_SWITCH_MEASURE=1 npx playwright test --config scripts/research/layoutSwitch.config.mjs
 *
 * It prints readings, never a verdict.
 */
import base from '../test/playwright.config.mjs';

export default {
  ...base,
  testMatch: '**/layoutSwitch.measure.ts',
  reporter: [['line']],
};
