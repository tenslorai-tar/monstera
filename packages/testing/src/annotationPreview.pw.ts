import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A shape being drawn or moved is a TINT over the paper, in every theme.
 *
 * `.m-annotation-preview` was filled with `--accent-soft`, a chrome token: a translucent wash in light and dark, and in
 * high contrast the opaque colour a selected row is drawn in. Over the page that hid the words beneath every preview,
 * found while looking at the select tool's move (the owner's item 14d, 2026-10-05). The property is the fill's
 * effective opacity, its colour's alpha times `fill-opacity`, read where the browser resolved both.
 */

/** A mark seeded in the walk, in PDF space on the sample's first page, for the select tool to pick and drag. */
const MARK = { x0: 100, y0: 600, x1: 250, y1: 700 };

/** The most a tint may cover the paper by and still leave the words under it readable. */
const MOST_WASH = 0.3;

for (const look of LOOKS) {
  test(`a moved mark's preview lets the page show through, ${look.name}`, async ({ page }) => {
    const bytes = await samplePdf();
    const id = asDocId('00000000-0000-4000-8000-000000000001');
    await page.setViewportSize({ width: 1280, height: 860 });
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened' as const, docId: id, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[id, bytes]]),
      annotations: [{ page: 0, index: 0, kind: 'square', rect: MARK }],
    });
    await page.goto('/');
    await page.getByRole('button', { name: /^Open PDF/u }).first().click();
    await expect(page.locator('canvas.m-page').first()).toBeAttached();
    await page.getByRole('button', { name: 'Select', exact: true }).first().click();
    const slot = await page.locator('.m-page-slot').first().boundingBox();
    if (slot === null) throw new Error('the first page has no box');
    const scale = slot.width / 612;
    const x = slot.x + ((MARK.x0 + MARK.x1) / 2) * scale;
    const y = slot.y + (792 - (MARK.y0 + MARK.y1) / 2) * scale;
    await page.mouse.click(x, y);
    await expect(page.locator('[data-selection-index="0"]')).toBeAttached();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 40, { steps: 6 });
    const preview = page.locator('[data-annotation-preview="boxes"] rect').first();
    await expect(preview).toBeAttached();

    const washes = await preview.evaluate((element) => {
      const wash = (): number => {
        const style = getComputedStyle(element);
        const alpha = /rgba\([^)]*,\s*([\d.]+)\)/u.exec(style.fill)?.[1];
        return (alpha === undefined ? 1 : Number(alpha)) * Number(style.fillOpacity);
      };
      const now = wash();
      // THE CONTROL, on the same element: the rule as it was, which must read as opaque in high contrast and as a
      // wash in the other two — or this case could not tell the fix from a theme that never had the defect.
      element.setAttribute('style', 'fill: var(--accent-soft); fill-opacity: 1');
      const before = wash();
      element.removeAttribute('style');
      return { now, before };
    });
    await page.mouse.up();

    expect(washes.now, 'the preview covers the paper by at most a tint').toBeLessThanOrEqual(MOST_WASH);
    expect(washes.now, 'and it is drawn at all').toBeGreaterThan(0);
    if (look.name === 'hc') expect(washes.before, 'the old fill was opaque in high contrast').toBe(1);
    else expect(washes.before).toBeLessThanOrEqual(MOST_WASH);
  });
}
