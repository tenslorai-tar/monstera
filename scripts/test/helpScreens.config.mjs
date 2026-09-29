// The Help centre's screenshot capture (packages/testing/src/helpScreens*.capture.ts). Run by hand: it WRITES the
// pictures the renderer bundles, so it is never part of the test sweep. The port comes from HELP_SCREENS_PORT, so two
// runs over different scene files can go side by side.
import { defineConfig } from '@playwright/test';

import accessibility from './playwright.config.mjs';

const port = Number(process.env['HELP_SCREENS_PORT'] ?? 4191);
const server = /** @type {{ command: string }} */ (accessibility.webServer);

export default defineConfig({
  ...accessibility,
  testMatch: '**/helpScreens*.capture.ts',
  reporter: [['list']],
  use: { ...accessibility.use, baseURL: `http://localhost:${String(port)}` },
  webServer: {
    ...accessibility.webServer,
    command: server.command.replace(/--port \d+/u, `--port ${String(port)}`),
    url: `http://localhost:${String(port)}`,
  },
});
