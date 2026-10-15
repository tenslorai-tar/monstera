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
  // AND THE RAIL SAYS WHERE THE READER IS NOW (the owner's 14a): Home, where the tool draws, not Organize over pages.
  await expect(page.locator('.m-ribbon__tab[aria-current="true"]')).toHaveAttribute('data-ribbon-section', 'home');
  await page.locator('[data-ribbon-section="organize"]').first().click();
  await expect(page.getByRole('region', { name: 'Pages to organize' })).toBeVisible();
});

/** Whether the rail and the centre agree: Organize on the rail exactly when its grid is on show. */
async function railAndView(page: Page): Promise<{ readonly rail: string | null; readonly grid: boolean; readonly pages: boolean }> {
  return {
    rail: await page.locator('.m-ribbon__tab[aria-current="true"]').getAttribute('data-ribbon-section'),
    grid: (await page.getByRole('region', { name: 'Pages to organize' }).count()) > 0,
    pages: await page.locator('.m-page-list').first().isVisible(),
  };
}

for (const fullPage of [false, true]) {
  test(`14a: in Organize › ${fullPage ? 'Full page' : 'Thumbnail'} no float bar lies over the cards, and every float-bar control leaves the rail and the view agreeing`, async ({ page }) => {
    await open(page, fullPage);
    // THE FLOAT BAR'S CONTROLS, read where it is shown: a search, so it must find some.
    const titles = await page.locator('.m-quick-toolbar button[aria-label]:not(.m-quick-toolbar__grip)').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? '').filter((title) => title !== ''),
    );
    expect(titles.length).toBeGreaterThan(3);
    for (const title of titles) {
      await page.locator('[data-ribbon-section="organize"]').first().click();
      await expect(page.getByRole('region', { name: 'Pages to organize' })).toBeVisible();
      // NOT OVER THE CARDS: no float bar while the grid is on show.
      await expect(page.locator('.m-quick-toolbar')).toHaveCount(0);
      await runCommand(page, title);
      await page.keyboard.press('Escape');
      // ONE OF TWO STATES, never a third: Organize with its grid, or Home with the pages — a tool that draws takes the
      // reader to Home, a control that does not leaves Organize as it was. Polled, because a document opened straight
      // into Organize mounts its page list only when Home is first shown.
      await expect
        .poll(async () => {
          const state = await railAndView(page);
          const agrees = (state.rail === 'organize' && state.grid && !state.pages) || (state.rail === 'home' && !state.grid && state.pages);
          return agrees ? 'agrees' : `${title}: ${JSON.stringify(state)}`;
        })
        .toBe('agrees');
      // AND THE TOOL IS PUT DOWN when Organize is chosen again, so the next control starts from the grid.
    }
  });
}

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
