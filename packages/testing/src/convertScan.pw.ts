import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Convert a scan, each outcome a row of its own (the owner's N1): *"Buttons and text are so close to each other."* There
 * was no rule for the dialog's classes, so each button ran on from the end of its sentence. Measured on pinned Chromium
 * because it is layout.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d6');

test('each outcome is a row: its name and line on the left, its button at the right with room between', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'scan.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
  await runCommand(page, 'Convert a scan…');
  const dialog = page.getByRole('dialog', { name: 'Convert a scan' });
  await expect(dialog).toBeVisible();

  const rows = await dialog.locator('.m-convert-scan__row').evaluateAll((items) =>
    items.map((item) => {
      const text = item.querySelector('.m-convert-scan__text')?.getBoundingClientRect();
      const button = item.querySelector('button')?.getBoundingClientRect();
      return {
        gap: text === undefined || button === undefined ? -1 : button.left - text.right,
        buttonRight: button?.right ?? -1,
        rowRight: item.getBoundingClientRect().right,
        bullet: getComputedStyle(item).listStyleType,
      };
    }),
  );
  expect(rows).toHaveLength(3);
  // ROOM BETWEEN: the button starts at least the row's gap after its text ends.
  expect(rows.every((row) => row.gap >= 16)).toBe(true);
  // AT THE RIGHT, all three on one edge: the row's own right.
  expect(rows.every((row) => Math.abs(row.buttonRight - row.rowRight) < 1)).toBe(true);
  // NO BULLETS: a list drawn with the browser's markers is the defect's own look.
  expect(rows.every((row) => row.bullet === 'none')).toBe(true);
});
