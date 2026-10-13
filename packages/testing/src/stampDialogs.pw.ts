import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { BrowserShimOptions } from './browserShim.js';
import { runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * The Watermark window on pinned Chromium (W3): text typed in its first seconds must still be there once a font is
 * picked. The walk saw it emptied when typed within about five seconds of opening, and had waited five seconds since.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000c3');

async function open(page: Page, delays: BrowserShimOptions['delays']): Promise<void> {
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 3; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'stamped.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    ...(delays === undefined ? {} : { delays }),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

async function typeThenPick(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Watermark' });
  await expect(dialog).toBeVisible();
  // AT ONCE, as a person does: no wait between the window opening and the first key, and key by key.
  await dialog.getByRole('textbox', { name: 'Text' }).pressSequentially('DRAFT');
  await dialog.getByRole('button', { name: /^Font:/u }).click();
  await dialog.locator('[data-font-choice="Courier"]').first().click();
  await expect(dialog.getByRole('button', { name: 'Font: Courier' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Text' })).toHaveValue('DRAFT');
}

test.describe('Watermark (W3)', () => {
  test('text typed at once is still there after a font is picked', async ({ page }) => {
    await open(page, undefined);
    await runCommand(page, 'Watermark…');
    await typeThenPick(page);
  });

  test('and while a command sent just before is still being written, and after it lands', async ({ page }) => {
    // THE WALK'S ORDER: step 16 restyled a text box and step 17 opened this window while that write took seconds.
    await open(page, { 'document.execute': 3000 });
    await runCommand(page, 'Rotate page');
    await runCommand(page, 'Watermark…');
    await typeThenPick(page);
    // AFTER THE WRITE ANSWERS, the words are still the person's.
    await page.waitForTimeout(3500);
    await expect(page.getByRole('dialog', { name: 'Watermark' }).getByRole('textbox', { name: 'Text' })).toHaveValue('DRAFT');
  });
});
