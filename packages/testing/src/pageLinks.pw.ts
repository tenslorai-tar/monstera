import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A page's links, drawn where they are and followed from there (ADR-0167, the owner's item 14c).
 *
 * The unit cases hold the layer's placement arithmetic and the route's decisions against a stubbed client. What only a
 * browser can say is the rest: that the button sits over the link's words once the CSS is applied, that its edge is
 * drawn in the Comment section and not while reading, that the hover names where it goes, and that a press reaches
 * the channel — a web link only after the dialog's Open, by its place and never its address.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

/** Display space at scale 1 on the sample's 612 by 792 first page: over its title line, and over its first body line. */
const TO_PAGE_TWO = { kind: 'internal' as const, page: 1, bounds: { x0: 72, y0: 70, x1: 400, y1: 96 } };
const TO_WEB = {
  kind: 'external' as const,
  uri: 'https://example.org/annual-report',
  bounds: { x0: 72, y0: 120, x1: 500, y1: 136 },
};

async function openWithLinks(
  page: Page,
  look: (typeof LOOKS)[number],
  section: 'home' | 'comment',
  sent: { channel: string; params: unknown }[],
): Promise<void> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      pageLinks: [[TO_PAGE_TWO, TO_WEB]],
      settings: { 'appearance.ribbon-section': section },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  await expect(page.locator('[data-link-layer="0"] [data-page-link="1"]')).toBeAttached();
}

for (const look of LOOKS) {
  test(`a page's links sit over their words and are outlined only in Comment, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openWithLinks(page, look, 'home', sent);
    const slot = await page.locator('.m-page-slot').first().boundingBox();
    const link = page.locator('[data-link-layer="0"] [data-page-link="1"]');
    const box = await link.boundingBox();
    if (slot === null || box === null) throw new Error('the page or its link has no box');
    const scale = slot.width / 612;
    // OVER ITS WORDS, within a pixel: the layer's arithmetic as the browser lays it out, with the page's own CSS.
    expect(Math.abs(box.x - (slot.x + TO_WEB.bounds.x0 * scale))).toBeLessThan(1);
    expect(Math.abs(box.y - (slot.y + TO_WEB.bounds.y0 * scale))).toBeLessThan(1);
    expect(Math.abs(box.width - (TO_WEB.bounds.x1 - TO_WEB.bounds.x0) * scale)).toBeLessThan(1);

    // READING: no edge until the pointer is over it, and then the hover names where it goes.
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
    await link.hover();
    await expect(page.locator('.m-tooltip', { hasText: 'Open https://example.org/annual-report' })).toBeVisible();
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect(await link.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
  });

  test(`in the Comment section every link's edge is drawn, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openWithLinks(page, look, 'comment', sent);
    for (const index of [0, 1]) {
      const link = page.locator(`[data-link-layer="0"] [data-page-link="${String(index)}"]`);
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle), String(index)).toBe('solid');
    }
  });

  test(`a page link goes there, and a web link asks before anything is sent, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openWithLinks(page, look, 'home', sent);
    const opened = (): unknown[] => sent.filter((call) => call.channel === 'document.openLink').map((call) => call.params);

    // THE WEB LINK FIRST: the page link scrolls page 1 away, and a page off screen draws no links.
    await page.locator('[data-link-layer="0"] [data-page-link="1"]').click();
    const dialog = page.getByRole('dialog', { name: 'Open this link?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-follow-link-address]')).toHaveText('https://example.org/annual-report');
    // CONTROL: the press opened a question, not the link.
    expect(opened()).toStrictEqual([]);
    await dialog.getByRole('button', { name: 'Open link' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(opened).toStrictEqual([{ docId: ID, version: 1, page: 0, index: 1 }]);

    await page.locator('[data-link-layer="0"] [data-page-link="0"]').click();
    await expect(page.locator('[data-goto-input="true"]')).toHaveValue('2');
    // CONTROL: the page link sent nothing to main; going to a page is the renderer's own.
    expect(opened()).toHaveLength(1);
  });

  test(`a long address in the Links panel is clamped on an unpadded box, ${look.name}`, async ({ page }) => {
    // `-webkit-line-clamp` hides lines past the third outside the PADDING box only, so a clamp on a padded element
    // shows the top of the fourth line in its padding. The address is clamped on a span inside the padded button.
    const sent: { channel: string; params: unknown }[] = [];
    await openWithLinks(page, look, 'home', sent);
    await page.getByRole('tab', { name: 'Bookmarks' }).click();
    const address = page.locator('.m-links-address').first();
    await expect(address).toBeVisible();
    const read = async (selector: string): Promise<{ clamp: string; padding: string }> =>
      page.locator(selector).first().evaluate((element) => {
        const style = getComputedStyle(element);
        return { clamp: style.webkitLineClamp, padding: `${style.paddingTop} ${style.paddingBottom}` };
      });
    expect(await read('.m-links-address')).toStrictEqual({ clamp: '3', padding: '0px 0px' });
    // CONTROL: the button around it IS padded, so the reading above is of the box that matters and not of a style
    // that reports no padding anywhere.
    expect((await read('.m-links-external')).padding).not.toBe('0px 0px');
  });

  test(`a link drawn with the Web link tool is said to be added, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openWithLinks(page, look, 'comment', sent);
    await page.getByRole('button', { name: 'Web link', exact: true }).first().click();
    const slot = await page.locator('.m-page-slot').first().boundingBox();
    if (slot === null) throw new Error('the first page has no box');
    const scale = slot.width / 612;
    await page.mouse.move(slot.x + 300 * scale, slot.y + 300 * scale);
    await page.mouse.down();
    await page.mouse.move(slot.x + 420 * scale, slot.y + 330 * scale, { steps: 6 });
    await page.mouse.up();
    const address = page.getByRole('textbox', { name: 'Address' });
    await address.fill('https://example.org/added');
    // CONTROL: nothing is said before the link is made.
    await expect(page.getByText('Link added.')).toHaveCount(0);
    await address.press('Enter');
    await expect(page.getByText('Link added.')).toBeVisible();
    expect(sent.some((call) => call.channel === 'document.execute')).toBe(true);
  });
}
