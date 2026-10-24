import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
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
  ['accessibility', '.m-accessibility'],
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

  // EVERY TAB THE STRIP DRAWS, read from the strip: a tab added to the roster and not to this list is a red case here
  // rather than a panel nothing measures.
  const drawnTabs = await page.locator('[data-panel-tab]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-panel-tab')));
  expect([...drawnTabs].sort()).toStrictEqual(TABS.map(([tab]) => tab).sort());

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
  expect(gaps).toStrictEqual({ pages: 0, bookmarks: 0, comments: 0, forms: 0, layers: 0, search: 0, accessibility: 0 });
});

/** A text field the Fields list names, on the first page. */
function textField(index: number, name: string): ShimFormField {
  return { page: 0, index, kind: 'text', name, values: [], on: null, options: [], readOnly: false, multiline: false, rect: { x0: 72, y0: 700 - index * 40, x1: 272, y1: 720 - index * 40 } };
}

// E2: EVERY ITEM IN ITS OWN BOX, and the page heading a heading, in each look.
for (const look of LOOKS) {
  test(`E2 (${look.name}): each field of the Fields list is a bordered, rounded card, and the page heading is larger and heavier than a field's name`, async ({ page }) => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const bytes = await pdf.save();
    await page.setViewportSize({ width: 1400, height: 900 });
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'panels.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [[textField(0, 'full_name'), textField(1, 'email'), textField(2, 'phone')]],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
    await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
    await page.locator('[data-panel-tab="forms"]').click();
    const list = page.locator('.m-forms-panel');
    await expect(list.locator('.m-list-card')).toHaveCount(3);
    const read = await list.evaluate((root) => {
      const cards = [...root.querySelectorAll('.m-list-card')].map((card) => {
        const style = getComputedStyle(card);
        const panel = getComputedStyle(root);
        return {
          border: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          // THE EDGE IS SEEN: its colour is not the panel's background behind it.
          edgeShows: style.borderTopColor !== panel.backgroundColor && style.borderTopColor !== 'rgba(0, 0, 0, 0)',
        };
      });
      const heading = root.querySelector('.m-forms-page__title');
      const name = root.querySelector('.m-forms-jump__name');
      const of = (element: Element | null): { size: number; weight: number } => {
        if (element === null) return { size: 0, weight: 0 };
        const style = getComputedStyle(element);
        return { size: Number.parseFloat(style.fontSize), weight: Number(style.fontWeight) };
      };
      return { cards, heading: of(heading), name: of(name) };
    });
    expect(read.cards).toStrictEqual(Array.from({ length: 3 }, () => ({ border: '1px', radius: '8px', edgeShows: true })));
    expect(read.heading.size).toBeGreaterThan(read.name.size);
    expect(read.heading.weight).toBeGreaterThan(read.name.weight);
  });
}
