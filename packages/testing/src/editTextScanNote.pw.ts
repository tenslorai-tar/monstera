import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A picture page's note in Edit text offers to recognise its words (W7), and a press on that offer reaches it: Edit text's
 * layer covers the whole page, after the note in the page's slot and stacked with it at no z-index of its own, so it was
 * the element under the offer and took the press. Measured in the development app on Windows, 2026-11-02: the text walk's
 * steps 9 and 9a timed out pressing the offer on a printed scan and on a handwritten page, in 1.1.2610.0 and on main, with
 * Playwright naming `m-text-edit-layer` as what intercepted the press.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000f7');

test('a press on a picture page’s offer to recognise its words reaches the offer, not Edit text’s layer over the page', async ({ page }) => {
  const scan = await PDFDocument.create();
  scan.addPage([612, 792]);
  const bytes = await scan.save();
  await page.setViewportSize({ width: 1400, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Scan.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    // A PICTURE AND NO WORDS: the shim answers `image-only` only for a page that also has no lines.
    documentPageLines: new Map([[ID, [[]]]]),
    pageImages: [1],
    textBlocks: [],
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"]')).toBeAttached();
  const offer = page.locator('[data-page-note="0"] button');
  await expect(offer).toBeVisible();
  // WHAT A HAND'S PRESS AT THE OFFER'S MIDDLE LANDS ON: the browser's own hit test, which is the question.
  const onTop = await offer.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top === null ? 'nothing' : button.contains(top) ? 'the offer' : `${top.tagName.toLowerCase()}.${top.className}`;
  });
  expect(onTop).toBe('the offer');
  // AND THE PRESS ITSELF, by the mouse rather than by the element: recognition's window opens.
  const box = await offer.boundingBox();
  if (box === null) throw new Error('the offer has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});
