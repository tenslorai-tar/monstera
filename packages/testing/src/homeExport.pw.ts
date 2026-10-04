import { expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * Home at 1280 x 800 (the owner's answer, cloud-4 item 9c): Comment and Signature stay on the ribbon, and Word, Excel
 * and PowerPoint are one Export button.
 *
 * Measured before, 2026-10-04 on Chromium 151: at 1280 the Quick tools showed Select, Hand, Text, Highlight and More,
 * Comment and Signature folded into More, while Export drew Image, Word, Excel, PowerPoint and Share; at 1366 both
 * showed. The three formats are one menu by ADR-0101's named-menu placement, and Tools › Convert keeps a button each.
 */

test('at 1280 x 800 Home shows Comment and Signature, and one Export button holding Word, Excel and PowerPoint', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const tools = page.getByRole('toolbar', { name: 'Tools', exact: true });
  await expect(tools.getByRole('button', { name: /^Comment\b/u })).toBeVisible();
  await expect(tools.getByRole('button', { name: /^Signature\b/u })).toBeVisible();
  // NOT FOLDED: the Quick tools group has no More of its own at this width.
  const quick = tools.locator('.m-ribbon__group').filter({ has: page.getByRole('button', { name: /^Signature\b/u }) });
  await expect(quick.getByRole('button', { name: /^More\b/u })).toHaveCount(0);
  // ONE BUTTON for the three formats, in place of a button each.
  await expect(tools.getByRole('button', { name: /^Word$/u })).toHaveCount(0);

  await tools.getByRole('button', { name: /^Export\b/u }).click();
  const menu = page.getByRole('menu');
  // EACH BY ITS FULL TITLE, as a named menu draws its members.
  await expect(menu.getByRole('menuitem')).toHaveText(['Export to Word…', 'Export tables to Excel…', 'Export to PowerPoint…']);
  // AND EACH RUNS ITS OWN COMMAND: Word opens the Word export.
  await menu.getByRole('menuitem', { name: 'Export to Word…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export to Word' })).toBeVisible();
});
