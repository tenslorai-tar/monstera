// @ts-check
/**
 * Runs the text-layer trial's measurements (cloud runs 29 and 29b) on the pinned Chromium: Playwright 1.62.1's
 * revision 1234, Chromium 151.0.7922.34. Not a suite: `packages/testing/src/textLayerTrial.measure.ts` prints figures
 * and asserts only what keeps a figure honest, so it is matched by this config alone and never by `*.pw.ts`.
 *
 * Run (from the repository root), after bundling the trial's page:
 *   npx esbuild packages/ui/src/textLayerTrial/harness.tsx --bundle --format=iife --jsx=automatic \
 *     --define:process.env.NODE_ENV='"production"' --outfile=<scratch>/harness.js
 *   TRIAL_HARNESS=<scratch>/harness.js TRIAL_OUT=<scratch>/out.jsonl TRIAL_SIZED=1 \
 *     npx playwright test --config scripts/research/textLayerTrial.config.mjs
 */
import { fileURLToPath } from 'node:url';

export default {
  testDir: fileURLToPath(new URL('../../packages/testing/src', import.meta.url)),
  testMatch: '**/textLayerTrial.measure.ts',
  timeout: 600_000,
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium', viewport: { width: 1400, height: 1000 } },
};
