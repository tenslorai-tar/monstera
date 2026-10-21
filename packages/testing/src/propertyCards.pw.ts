import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { openApp, openDocument, openSection } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * EVERY PROPERTY GROUP IN A CARD, drawn (Addendum 3, 2026-10-18): the Properties tab's views read on the real stylesheet.
 *
 * A control counts as carded only where a box between it and the panel DRAWS one — a border of some width and style, and
 * a radius — so a class that drew nothing, or a token that resolved to nothing, would leave the control outside. The
 * structural check of every view the unit cases render is `propertyCards.ts`'; this is the drawing of it, in each theme.
 */

/** Every control in the Properties panel, not in its head or foot or a section's title, with no drawn card around it. */
async function uncarded(page: Page): Promise<string[]> {
  return page.locator('.m-properties').first().evaluate((panel) => {
    const drawsACard = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none' && Number.parseFloat(style.borderTopLeftRadius) > 0;
    };
    const controls = panel.querySelectorAll(
      'input, select, textarea, button, [role="slider"], [role="radio"], [role="combobox"], [role="switch"]',
    );
    return [...controls]
      .filter((control) => control.closest('.m-properties__head, .m-properties__foot, summary') === null)
      .filter((control) => {
        for (let at = control.parentElement; at !== null && at !== panel; at = at.parentElement) if (drawsACard(at)) return false;
        return true;
      })
      .map((control) => control.outerHTML.slice(0, 100));
  });
}

/** How many controls the check looked at: a view that drew none would pass with nothing checked. */
async function controlsIn(page: Page): Promise<number> {
  return page.locator('.m-properties').first().locator('input, select, button, [role="slider"], [role="radio"]').count();
}

for (const look of LOOKS) {
  test(`${look.name}: the New annotations view draws each property group in a card`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bytes = await blockedPages([612, 792], 1);
    const doc = asDocId('00000000-0000-4000-8000-0000000000c1');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId: doc, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'cards.pdf' }],
      documentBytes: new Map([[doc, bytes]]),
      settings: { 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'properties' },
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.m-properties').first()).toBeVisible();
    expect(await controlsIn(page)).toBeGreaterThan(3);
    expect(await uncarded(page)).toStrictEqual([]);
  });
}

test('the Forms section with nothing selected draws its setting in a card', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Forms');
  await expect(page.locator('.m-properties').first().getByRole('checkbox').first()).toBeVisible();
  expect(await controlsIn(page)).toBeGreaterThan(0);
  expect(await uncarded(page)).toStrictEqual([]);
});

test('CONTROL: a property group left outside a card is found, on the real stylesheet', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await expect(page.locator('.m-properties').first()).toBeVisible();
  // A GROUP AS A VIEW WOULD WRITE ONE without the card: a label and its control straight in the panel.
  await page.locator('.m-properties').first().evaluate((panel) => {
    const loose = document.createElement('div');
    loose.innerHTML = '<span>Loose</span><input data-loose-group="">';
    panel.append(loose);
  });
  expect(await uncarded(page)).toStrictEqual(['<input data-loose-group="">']);
});
