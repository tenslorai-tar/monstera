import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { ORGANIZE_FRAME_COUNT, readOrganizeFrames, recordOrganizeFrames } from './organizeFrames.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

const SECTIONS = ['tools', 'home', 'comment', 'edit', 'organize', 'forms', 'review', 'protect'] as const;

async function open(page: Page, fullPage = false, settings: Readonly<Record<string, unknown>> = {}): Promise<void> {
  const pdf = await PDFDocument.create();
  for (let at = 0; at < 5; at += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000e7');
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'pages.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings: { 'appearance.organize-grid-size': fullPage ? 'full-page' : 'thumbnail', ...settings },
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

/** The cards on show that the float bar's box crosses, by page: empty when it lies over none. */
async function barOverCards(page: Page): Promise<readonly string[]> {
  const bar = await page.locator('.m-quick-toolbar').boundingBox();
  if (bar === null) throw new Error('no float bar to measure');
  const cards = await page.locator('.m-page-grid [data-layer="shown"] [data-thumb-page]').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { page: element.getAttribute('data-thumb-page') ?? '', left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    }),
  );
  // A SEARCH, so it must have something to search: a grid with no card would cross nothing.
  if (cards.length === 0) throw new Error('no cards to measure the float bar against');
  return cards
    .filter((card) => card.left < bar.x + bar.width && bar.x < card.right && card.top < bar.y + bar.height && bar.y < card.bottom)
    .map((card) => card.page);
}

/** Whether the rail and the centre agree: Organize on the rail exactly when its grid is on show. */
async function railAndView(page: Page): Promise<{ readonly rail: string | null; readonly grid: boolean; readonly pages: boolean }> {
  return {
    rail: await page.locator('.m-ribbon__tab[aria-current="true"]').getAttribute('data-ribbon-section'),
    grid: (await page.getByRole('region', { name: 'Pages to organize' }).count()) > 0,
    pages: await page.locator('.m-page-list').first().isVisible(),
  };
}

for (const fullPage of [false, true]) {
  test(`R12: in Organize › ${fullPage ? 'Full page' : 'Thumbnail'} the float bar is on show and over no card, and every float-bar control leaves the rail and the view agreeing`, async ({ page }) => {
    await open(page, fullPage);
    // THE FLOAT BAR'S CONTROLS, read where it is shown: a search, so it must find some.
    const titles = await page.locator('.m-quick-toolbar button[aria-label]:not(.m-quick-toolbar__grip)').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? '').filter((title) => title !== ''),
    );
    expect(titles.length).toBeGreaterThan(3);
    for (const title of titles) {
      await page.locator('[data-ribbon-section="organize"]').first().click();
      await expect(page.getByRole('region', { name: 'Pages to organize' })).toBeVisible();
      // ON SHOW OVER THE GRID (the owner's answer of 2026-10-20, replacing 14a), and over no card.
      await expect(page.locator('.m-quick-toolbar')).toBeVisible();
      expect(await barOverCards(page)).toStrictEqual([]);
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
      // THE NEXT CONTROL STARTS FROM THE GRID: the loop's head chooses Organize and waits for it. Whether an armed tool is
      // put down by that choice is asserted nowhere here (audit IIIIIIII-11).
    }
  });
}

for (const fullPage of [false, true]) {
  test(`R12: in Organize › ${fullPage ? 'Full page' : 'Thumbnail'} a MOVED float bar opens where it was put, over no card — and turned off, it is not there`, async ({ page }) => {
    // NEAR THE START EDGE, a fifth of the way across: over the first column, had the grid not kept its lane.
    await open(page, fullPage, { 'appearance.float-bar-position': { x: 0.05, y: 0.4 } });
    await page.locator('[data-ribbon-section="organize"]').first().click();
    await expect(page.getByRole('region', { name: 'Pages to organize' }).locator('[data-layer="shown"] [data-thumb-page="0"]')).toBeVisible();
    const bar = page.locator('.m-quick-toolbar');
    await expect(bar).toHaveClass(/m-quick-toolbar--free/u);
    expect(await barOverCards(page)).toStrictEqual([]);
    // WHERE IT WAS PUT, not docked back: its corner is the stored share of its travel across the page area.
    const area = await page.locator('.m-canvas-area').first().boundingBox();
    const box = await bar.boundingBox();
    if (area === null || box === null) throw new Error('no page area or bar to measure');
    expect(Math.abs(box.x - (area.x + 1 + 0.05 * (area.width - 2 - box.width)))).toBeLessThan(2);
    // CONTROL: Float bar off hides it here too (Ctrl+Shift+Q, the toggle's own key).
    await page.keyboard.press('Control+Shift+Q');
    await expect(bar).toHaveCount(0);
  });
}

test('R12: leaving Organize for Edit shows NO "Opening the document…": the grid stays until the pages are drawn', async ({ page }) => {
  await open(page);
  await page.locator('[data-ribbon-section="organize"]').first().click();
  await expect(page.getByRole('region', { name: 'Pages to organize' }).locator('[data-layer="shown"] [data-thumb-page="0"] canvas')).toHaveAttribute('data-drawn', 'true');
  // EVERY FRAME WATCHED from before the press: a mutation observer sees the loading state if it is ever mounted, and a
  // frame sampler sees an area with neither the grid nor a drawn page.
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(globalThis, '__r12', seen);
    const document = Reflect.get(globalThis, 'document');
    new (Reflect.get(globalThis, 'MutationObserver'))(() => {
      if (document.querySelector('.m-page-opening') !== null) seen.push('opening');
    }).observe(document.body, { childList: true, subtree: true });
    const sample = (): void => {
      const grid = document.querySelector('.m-page-grid') !== null;
      const drawn = document.querySelector('.m-page-pane[data-first-frame="shown"]') !== null;
      if (!grid && !drawn) seen.push('empty');
      if (seen.length < 1000 && !drawn) Reflect.get(globalThis, 'requestAnimationFrame')(sample);
    };
    Reflect.get(globalThis, 'requestAnimationFrame')(sample);
  });
  await page.locator('[data-ribbon-section="edit"]').first().click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
  await expect(page.locator('.m-page-grid')).toHaveCount(0);
  expect(await page.evaluate((): unknown => Reflect.get(globalThis, '__r12'))).toStrictEqual([]);
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
