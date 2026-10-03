import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * THE PAGE IN WINDOWS HIGH CONTRAST (the live review's HC1): the document as it is, and its text layer invisible and
 * still selectable.
 *
 * Windows high contrast reaches a page as `forced-colors: active`, and Chromium then forces every colour to the
 * system's — so the text layer's `color: transparent` became the system's text colour, and Chromium painted its
 * readability backplate, in the system's background colour, behind each line. The page showed the hidden selection text
 * in a substitute font on white bars, over a canvas that was drawn correctly the whole time (read 2026-10-03 in the
 * development build under Chromium's own forced-colours emulation: page 1's canvas held its 4,105 dark samples either
 * way, and a text line computed `rgb(0, 0, 0)`). Emulated here by the same means, `emulateMedia({ forcedColors })`.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000fc');

/** Lines long enough to cross the page's block, so text painted over it would change what is seen. */
const LINES = [
  'Quarterly report for the third quarter',
  'The first paragraph opens the report with a sentence that runs on',
  'and continues onto a second line of ordinary body text',
  'A second paragraph, shorter than the first.',
];

async function openInForcedColours(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'contrast.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
    pageLines: [LINES],
  });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line="0"]')).toHaveText(LINES[0] ?? '');
  // THE PREMISE: forced colours are on in this page, or every assertion below is about an ordinary rendering.
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
}

/** Page 1's slot as drawn, with its text layer as it is or hidden. */
async function pageImage(page: Page, layer: 'shown' | 'hidden'): Promise<Buffer> {
  // THROUGH THE ELEMENT'S STYLE OBJECT: the renderer's pinned CSP refuses an injected stylesheet, as it should.
  await page.locator('[data-text-layer="0"]').evaluate((element, hide) => {
    if (element instanceof HTMLElement) element.style.visibility = hide ? 'hidden' : '';
  }, layer === 'hidden');
  return page.locator('.m-page-slot[data-page="0"] >> visible=true').first().screenshot({ animations: 'disabled' });
}

test('in FORCED COLOURS the text layer paints nothing over the page: it looks the same with the layer hidden', async ({
  page,
}) => {
  await openInForcedColours(page);
  // THE SEPARATING ASSERTION. Without `forced-color-adjust: none` on the layer, each line was painted in the system's
  // text colour on a backplate of its background, and these two images differed wherever a line lay over the block.
  const shown = await pageImage(page, 'shown');
  const hidden = await pageImage(page, 'hidden');
  expect(shown.equals(hidden)).toBe(true);
  // AND THE PAGE IS DRAWN: an image of nothing would also be equal to itself.
  expect(shown.byteLength).toBeGreaterThan(1000);
  const colour = await page.locator('[data-text-layer="0"] [data-text-line="0"]').evaluate((line) => getComputedStyle(line).color);
  expect(colour).toBe('rgba(0, 0, 0, 0)');
});

// A GUARD, not the separating case: selection worked before the fix too. It holds the other half of the requirement —
// the layer opted out of forced colours must stay where the text can be selected, so a fix that hid it would fail here.
test('in FORCED COLOURS the text stays SELECTABLE: a drag over a line selects its text', async ({ page }) => {
  await openInForcedColours(page);
  const line = page.locator('[data-text-layer="0"] [data-text-line="1"]');
  const box = await line.boundingBox();
  if (box === null) throw new Error('the line has no box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  // PART OF THE LINE, as far as the drag reached: the shim's line boxes are narrow, so the line's text is fitted into
  // a box tens of pixels wide and a drag across it covers a run of its characters, not a guessed count of them.
  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  expect(selected.length).toBeGreaterThan(5);
  expect(LINES[1]).toContain(selected);
});
