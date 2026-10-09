import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { ORGANIZE_FRAME_COUNT, readOrganizeFrames, recordOrganizeFrames } from './organizeFrames.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

const SECTIONS = ['tools', 'home', 'comment', 'edit', 'organize', 'forms', 'review', 'protect'] as const;

async function open(page: Page, fullPage = false): Promise<void> {
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 5; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e7');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.organize-grid-size': fullPage ? 'full-page' : 'thumbnail' },
    delays: { 'document.readRange': 150 },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…', exact: true }).click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

// Section changes depend on the previous section and tool, not the history of earlier sections.
// Every ordered pair covers that state space, including Tools > Home > Organize and a repeated Organize.
for (const first of SECTIONS) {
  test(`Organize returns after ${first} and every next section with a tool armed`, async ({ page }) => {
    await open(page);
    for (const second of SECTIONS) {
      await runCommand(page, 'Hand — drag to move the pages');
      await page.locator(`[data-ribbon-section="${first}"]`).first().click();
      await page.locator(`[data-ribbon-section="${second}"]`).first().click();
      await page.locator('[data-ribbon-section="organize"]').first().click();
      const grid = page.getByRole('region', { name: 'Pages to organize' });
      await expect(grid, `${first} > ${second} > Organize`).toBeVisible();
      await expect(grid.getByRole('button', { name: 'Thumbnail', exact: true })).toBeVisible();
      await expect(grid.getByRole('button', { name: 'Full page', exact: true })).toBeVisible();
      await expect(grid.locator('[data-layer="shown"] [data-thumb-page]')).toHaveCount(5);
    }
  });
}

test('rechoosing Organize puts down a kept tool, while a tool started inside it can still draw', async ({ page }) => {
  await open(page);
  await page.locator('[data-ribbon-section="forms"]').first().click();
  await page.getByRole('button', { name: /^Text field/u }).first().dblclick();
  await expect(page.locator('[data-annotation-overlay]').first()).toBeVisible();
  await page.locator('[data-ribbon-section="organize"]').first().click();
  await expect(page.getByRole('region', { name: 'Pages to organize' })).toBeVisible();
  await runCommand(page, 'Rectangle');
  await expect(page.getByLabel('Draw on page 1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pages to organize' })).toHaveCount(0);
  await page.locator('[data-ribbon-section="organize"]').first().click();
  await expect(page.getByRole('region', { name: 'Pages to organize' })).toBeVisible();
});

test('the first Thumbnail choice from Full page has no empty or undrawn frame', async ({ page }) => {
  await open(page, true);
  await page.locator('[data-ribbon-section="organize"]').first().click();
  const grid = page.getByRole('region', { name: 'Pages to organize' });
  await expect(grid.locator('[data-layer="shown"] [data-thumb-page="0"] canvas')).toHaveAttribute('data-drawn', 'true');
  await recordOrganizeFrames(page);
  const recorded = (): ReturnType<typeof readOrganizeFrames> => readOrganizeFrames(page);
  // Ensure the sampler saw the original full page before sending the real pointer event.
  await expect.poll(async () => (await recorded()).length).toBeGreaterThan(0);
  await grid.getByRole('button', { name: 'Thumbnail', exact: true }).click();
  await expect(grid).toHaveAttribute('data-page-view', 'thumbnail');
  await expect.poll(async () => (await recorded()).length).toBe(ORGANIZE_FRAME_COUNT);
  const frames = await recorded();
  expect(frames.flat().some((card) => card.width > 400)).toBe(true);
  expect(frames.flat().some((card) => card.width < 200)).toBe(true);
  expect(frames.findIndex((frame) => frame.length === 0 || frame.some((card) => card.drawn !== 'true')), JSON.stringify(frames)).toBe(-1);
});
