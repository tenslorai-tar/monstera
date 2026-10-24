import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { EVERY_FIELD_KIND as FIELDS, formPdf } from './formFieldsFixture.js';
import { openSection } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * Review's *Accessibility check* and *Reading order* choose the left panel's own Accessibility tab, at their view, and
 * displace no other tab ([ADR-0265](../../../docs/DECISIONS/0265-accessibility-is-a-panel-of-the-left-strip.md), the
 * owner's T3). Before it, the two took over the panel's body, and the tab on show — the thumbnails, here Bookmarks — was
 * gone until a close button was found.
 *
 * Each case starts from Bookmarks chosen, runs a command, reads the strip and the view, and then chooses Bookmarks again:
 * its own panel must show, so the command took nothing away. CONTROL: on the take-over build no tab is chosen for the
 * tool and Bookmarks' tab stays the selected one, so the first assertion fails.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000c3');

async function open(page: Page): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1600, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    formFields: [FIELDS],
    settings: { 'appearance.document-panel': 'bookmarks', 'appearance.document-panel-open': true },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
}

const strip = (page: Page) => page.locator('[data-pane="document-panel"]');

for (const [command, view] of [
  ['Accessibility check', 'Check'],
  ['Reading order', 'Reading order'],
] as const) {
  test(`${command} chooses the Accessibility tab at its ${view} view, and Bookmarks before it is intact`, async ({ page }) => {
    await open(page);
    await expect(strip(page).getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true');
    await openSection(page, 'Review');
    await runCommand(page, command);

    // THE STRIP'S OWN TAB, chosen; every tab still in the strip.
    await expect(strip(page).getByRole('tab', { name: 'Accessibility' })).toHaveAttribute('aria-selected', 'true');
    await expect(strip(page).getByRole('tab')).toHaveCount(7);
    // AT THE COMMAND'S VIEW: the view's own control says which is chosen.
    await expect(strip(page).getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true');

    // NOTHING DISPLACED: Bookmarks chosen again shows its own panel, and the Accessibility tab is still there.
    await strip(page).getByRole('tab', { name: 'Bookmarks' }).click();
    await expect(strip(page).getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true');
    await expect(strip(page).locator('[data-panel="bookmarks"]')).toBeVisible();
    await expect(strip(page).getByRole('tab', { name: 'Accessibility' })).toBeVisible();
  });
}
