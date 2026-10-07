import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * A tool that is armed owns the page, in every section (the owner's recording of 2026-10-07).
 *
 * ## The mechanism this holds shut
 *
 * Organize's canvas is a grid of page cards, and a card is DRAGGABLE: dragging one reorders the pages. A drawing tool
 * armed from another section and then Organize chosen left that grid under the tool, so the drag a person made to draw
 * a box lifted the whole page instead — and drew nothing, because the grid has no layer a tool draws on. The canvas is
 * now the pages themselves while any tool is armed, and the grid returns when it is put down.
 *
 * The control is the first assertion: with nothing armed the same section shows the grid, so the case below it is the
 * armed tool's doing and not a section that never had one.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000b8');

test('an armed tool takes the canvas from Organize’s page grid, and putting it down brings the grid back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 3);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();

  await page.getByRole('navigation').getByRole('button', { name: 'Organize', exact: true }).first().click();
  // CONTROL: nothing armed, so Organize shows its grid and the pages are not drawn on.
  await expect(page.locator('.m-thumbnails--grid')).toBeVisible();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toHaveCount(0);

  // ARM A DRAWING TOOL by its command, the way a person without the ribbon button does.
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Rectangle');
  await page.getByRole('option', { name: 'Rectangle' }).first().click();

  // THE PAGES ARE THE CANVAS NOW, the section still Organize, and the grid that would lift a page is gone.
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await expect(page.locator('.m-thumbnails--grid')).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Organize', exact: true }).first()).toHaveAttribute(
    'aria-current',
    'true',
  );

  // PUT DOWN, the grid returns.
  await page.keyboard.press('Escape');
  await expect(page.locator('.m-thumbnails--grid')).toBeVisible();
});
