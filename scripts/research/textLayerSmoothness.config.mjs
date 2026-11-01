// @ts-check
/**
 * Runs `packages/testing/src/textLayerSmoothness.measure.ts`, the text layer's main-thread cost readings (ADR-0280), and
 * nothing else: the rendered suite's own configuration with the measurement as its only file, so the bundle, the server
 * and the pinned browser are the suite's and no second opinion about any of them is written here (B3a).
 *
 * Run: npx playwright test --config scripts/research/textLayerSmoothness.config.mjs
 *
 * It prints readings, never a verdict.
 */
import base from '../test/playwright.config.mjs';

export default {
  ...base,
  testMatch: '**/textLayerSmoothness.measure.ts',
  reporter: [['line']],
};
