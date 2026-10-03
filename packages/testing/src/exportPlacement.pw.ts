import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * Export to PowerPoint beside Word and Excel (the owner's review of 0.1.9.0): it lived only in Tools › Convert, behind
 * More, with the page-images glyph. The UI half of its pair: the kernel half is `documentCommands.test.ts`' dispatch
 * case, and this one proves the control a person sees on Home is the one that dispatches it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c7');

async function openDocument(page: Page, sent: string[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'deck.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel) => {
      sent.push(channel);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
}

test('Home › Export reads Image · Word · Excel · PowerPoint · Share, and PowerPoint dispatches the PowerPoint export', async ({ page }) => {
  const sent: string[] = [];
  await openDocument(page, sent);
  await page.locator('nav.m-ribbon__rail').getByRole('button', { name: 'Home' }).click();
  const group = page
    .locator('.m-ribbon__group')
    .filter({ has: page.locator('.m-ribbon__caption').getByText('Export', { exact: true }) });
  const labels = (await group.getByRole('button').allTextContents()).map((label) => label.trim());
  const order = ['Image', 'Word', 'Excel', 'PowerPoint', 'Share'].map((name) => labels.findIndex((label) => label.startsWith(name)));
  // EVERY ONE PRESENT, and in that order: an absent one is -1, which the sort below would otherwise accept at the front.
  expect(order.every((at) => at >= 0), JSON.stringify(labels)).toBe(true);
  expect(order).toStrictEqual([...order].sort((a, b) => a - b));

  // ITS OWN GLYPH: a slide, not the page-picture one Image draws.
  const powerPoint = group.getByRole('button', { name: 'PowerPoint', exact: true });
  await expect(powerPoint.locator('svg.lucide-presentation')).toHaveCount(1);
  sent.length = 0;
  await powerPoint.click();
  await expect.poll(() => sent.includes('document.exportPowerPoint')).toBe(true);
  // CONTROL: the Word button beside it asks for its mode first and sends no PowerPoint export.
  expect(sent.filter((channel) => channel.startsWith('document.export'))).toStrictEqual(['document.exportPowerPoint']);
});

test('the Tools menu lists Export to PowerPoint… straight after Export tables to Excel…, with its glyph', async ({ page }) => {
  await openDocument(page, []);
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Tools', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const titles = await menu.locator('.m-menu-bar__title').allTextContents();
  const excel = titles.indexOf('Export tables to Excel…');
  expect(excel, JSON.stringify(titles)).toBeGreaterThanOrEqual(0);
  expect(titles[excel + 1]).toBe('Export to PowerPoint…');
  await expect(menu.getByRole('menuitem', { name: 'Export to PowerPoint…' }).locator('svg.lucide-presentation')).toHaveCount(1);
});
