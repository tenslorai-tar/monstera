import { expect, test } from '@playwright/test';

import { openApp, openDocument, openSection, runCommand, shoot } from './helpScreensHarness.js';

// THE PILOT SCENES, which prove the harness before the rest are written: a dialog from the palette, a rail section,
// and a dialog reached from a tool on the page. Each test is one screenshot id, named as the article names it.

test('about-monstera-1', async ({ page }) => {
  await openApp(page, { installChannel: 'store' });
  await runCommand(page, 'About');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await shoot(page, 'about-monstera-1', dialog);
});

test('rotate-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await shoot(page, 'rotate-pages-1', 'window');
});
