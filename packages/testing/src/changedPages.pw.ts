import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A command that changed one page redraws that page's card and no other
 * ([ADR-0262](../../../docs/DECISIONS/0262-a-command-declares-the-pages-it-changes.md) Decision 4). Every card's drawn
 * state is watched from before the mark: a card drawn again goes `stale` for the new view first, then `true`. The
 * CONTROL is the same mark answered as changing every page, which makes the other cards in view go stale — so a case
 * where they do not is the declaration read, not a strip that drew nothing.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000db');

async function staleCardsAfterAMark(page: Page, changedPages: 'all' | readonly number[]): Promise<readonly number[]> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    changedPages,
    settings: { 'appearance.ribbon-section': 'comment', 'appearance.document-panel': 'pages' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('[data-thumb-page="2"] canvas')).toHaveAttribute('data-drawn', 'true', { timeout: 20_000 });
  // EVERY CARD THAT GOES STALE from here, by its page.
  await page.evaluate(() => {
    const stale = new Set<number>();
    Reflect.set(window, 'staleCards', stale);
    new MutationObserver((records) => {
      for (const record of records) {
        const canvas = record.target as HTMLElement;
        if (canvas.dataset['drawn'] !== 'stale') continue;
        const card = canvas.closest<HTMLElement>('[data-thumb-page]');
        if (card !== null) stale.add(Number(card.dataset['thumbPage']));
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-drawn'] });
  });
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click();
  await page.mouse.move(slot.x + 120, slot.y + 120);
  await page.mouse.down();
  await page.mouse.move(slot.x + 260, slot.y + 220, { steps: 5 });
  await page.mouse.up();
  // THE NEW VIEW DRAWN: the first card shows the mark's version again.
  await expect.poll(() => page.locator('[data-thumb-page="0"] canvas').getAttribute('data-drawn'), { timeout: 10_000 }).toBe('true');
  await page.waitForTimeout(500);
  return page.evaluate(() => [...(Reflect.get(window, 'staleCards') as Set<number>)].sort((a, b) => a - b));
}

test('a mark the answer says changed page 1 redraws page 1’s card only', async ({ page }) => {
  expect(await staleCardsAfterAMark(page, [0])).toStrictEqual([0]);
});

test('CONTROL: the same mark answered as changing every page redraws the other cards in view too', async ({ page }) => {
  const stale = await staleCardsAfterAMark(page, 'all');
  expect(stale).toContain(0);
  expect(stale.filter((card) => card !== 0).length).toBeGreaterThan(0);
});
