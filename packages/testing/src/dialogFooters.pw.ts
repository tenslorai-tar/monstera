import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Every dialog's footer buttons are CENTRED (the owner's N5, 2026-10-12), and Settings keeps its own at the right.
 *
 * Measured on pinned Chromium because it is layout: happy-dom computes no grid. The footer is the one primitive every
 * dialog ends in (`DialogFooter`), so one dialog measured is the rule measured; Settings draws its own foot, and it is the
 * control that a footer at the right is still told apart from a centred one.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d5');

async function open(page: Page): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'footers.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

/** How far the buttons' centre is from their footer's, and their right edge from its, in CSS pixels. */
async function placement(footer: Locator, buttons: Locator): Promise<{ readonly offCentre: number; readonly fromRight: number }> {
  const outer = await footer.boundingBox();
  const group = await buttons.boundingBox();
  if (outer === null || group === null) throw new Error('the footer or its buttons are not drawn');
  return {
    offCentre: Math.abs(group.x + group.width / 2 - (outer.x + outer.width / 2)),
    fromRight: outer.x + outer.width - (group.x + group.width),
  };
}

test('a dialog’s Cancel and its action sit at the centre of its footer (N5)', async ({ page }) => {
  await open(page);
  await runCommand(page, 'Watermark…');
  const dialog = page.getByRole('dialog', { name: 'Watermark' });
  await expect(dialog).toBeVisible();
  const footer = dialog.locator('.m-dialog-footer');
  const buttons = footer.locator('.m-dialog-footer__buttons');
  await expect(buttons.getByRole('button')).toHaveCount(2);
  const { offCentre, fromRight } = await placement(footer, buttons);
  expect(offCentre).toBeLessThan(1);
  // NOT AT THE RIGHT: a footer that had kept `flex-end` would put the group within its padding of the edge.
  expect(fromRight).toBeGreaterThan(100);
});

test('CONTROL: Settings keeps its own footer, its buttons at the right, so the measure tells the two apart', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {});
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  const { offCentre, fromRight } = await placement(dialog.locator('.m-settings__footer'), dialog.locator('.m-settings__footer-controls'));
  expect(offCentre).toBeGreaterThan(50);
  expect(fromRight).toBeLessThan(50);
});
