import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Every tab of the right panel shows its icon AND its name at all times (the owner's O4): a narrow panel wraps the tabs,
 * never drops a name. Measured on pinned Chromium at the panel's minimum and default widths: each name drawn whole (not
 * cut to an ellipsis), each tab inside the header, and the collapse chevron inside it and clear of every tab.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d9');

async function open(page: Page, width: number): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await page.setViewportSize({ width: 1440, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'tabs.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    settings: { 'appearance.context-panel-open': true, 'appearance.context-panel-width': width },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-context-panel__tab').first()).toBeVisible();
}

/** What each tab draws, and whether the header holds it all. */
function read(page: Page) {
  return page.locator('.m-context-panel__header').evaluate((header) => {
    const outer = header.getBoundingClientRect();
    const chevron = header.querySelector(':scope > :not(.m-context-panel__tabs)')?.getBoundingClientRect();
    const tabs = [...header.querySelectorAll('.m-context-panel__tab')].map((tab) => {
      const box = tab.getBoundingClientRect();
      const label = tab.querySelector('.m-context-panel__tab-label');
      return {
        name: label?.textContent ?? '',
        whole: label !== null && label.scrollWidth <= label.clientWidth + 0.5,
        glyph: tab.querySelector('svg') !== null,
        inside: box.left >= outer.left - 0.5 && box.right <= outer.right + 0.5 && box.bottom <= outer.bottom + 0.5,
        clearOfChevron: chevron === undefined || box.right <= chevron.left + 0.5 || box.bottom <= chevron.top + 0.5 || box.top >= chevron.bottom - 0.5,
      };
    });
    return {
      tabs,
      chevronInside: chevron !== undefined && chevron.right <= outer.right + 0.5 && chevron.left >= outer.left - 0.5,
    };
  });
}

for (const width of [264, 326]) {
  test(`at ${String(width)} px every tab shows its glyph and its whole name, and the chevron stays clear`, async ({ page }) => {
    await open(page, width);
    const drawn = await read(page);
    expect(drawn.tabs.map((tab) => tab.name)).toStrictEqual(['Properties', 'Assistant', 'Spelling']);
    expect(drawn.tabs.every((tab) => tab.glyph && tab.whole && tab.inside && tab.clearOfChevron)).toBe(true);
    expect(drawn.chevronInside).toBe(true);
  });
}

test('CONTROL: the same panel with its tabs held to one row cuts a name, so the measure can see a cut', async ({ page }) => {
  await open(page, 264);
  await page.addStyleTag({ content: '.m-context-panel__tabs { flex-wrap: nowrap !important; }' });
  const drawn = await read(page);
  expect(drawn.tabs.some((tab) => !tab.whole)).toBe(true);
});
