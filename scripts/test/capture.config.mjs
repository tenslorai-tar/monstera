// SCRATCH, not committed to main: the redesign review's capture (packages/testing/src/redesign.capture.ts).
import { defineConfig } from '@playwright/test';

import accessibility from './playwright.config.mjs';

export default defineConfig({
  ...accessibility,
  testMatch: '**/*.capture.ts',
  reporter: [['list']],
});
