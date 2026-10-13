import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Every tab of the left panel fills the panel to its foot (the owner's N9): *"The Forms tab and the Bookmarks tab end
 * about halfway down, with blank space below."* Measured per tab on pinned Chromium, because it is layout: the bottom of
 * the last box the tab draws, against the bottom of the panel's body.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d8');

/** Each tab, and the box its content is drawn in: the one whose foot must be the panel's. */
const TABS = [
  ['pages', '.m-thumbnails'],
  ['bookmarks', '.m-links-panel'],
  ['comments', '.m-annotations-panel'],
  ['forms', '.m-forms-panel'],
  ['layers', '.m-layers'],
  ['search', '.m-find-bar'],
] as const;

test('every left-panel tab draws its panel down to the panel’s foot', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'panels.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();

  const gaps: Record<string, number> = {};
  for (const [tab, box] of TABS) {
    await page.locator(`[data-panel-tab="${tab}"]`).click();
    const body = page.locator(`.m-document-panel__body[data-panel="${tab}"]`);
    await expect(body).toBeVisible();
    const drawn = body.locator(box).first();
    await expect(drawn).toBeAttached();
    const [outer, inner] = await Promise.all([body.boundingBox(), drawn.boundingBox()]);
    if (outer === null || inner === null) throw new Error(`the ${tab} tab draws nothing`);
    gaps[tab] = Math.round(outer.y + outer.height - (inner.y + inner.height));
  }
  // EVERY TAB AT ONCE, so a run names each one still short rather than stopping at the first.
  expect(gaps).toStrictEqual({ pages: 0, bookmarks: 0, comments: 0, forms: 0, layers: 0, search: 0 });
});
