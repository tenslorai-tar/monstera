import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * Side by Side's behaviour after a comparison (the owner's recording of 0.1.9.0): the panes move only when the person
 * scrolls or picks a difference, and the Differences panel can be closed and the comparison stopped. Two documents of
 * different lengths, as in the recording (a 2-page document against a 5-page one), so the comparison reports inserted
 * pages and marks whole pages on the right.
 *
 * SCROLLBARS DRAWN: Playwright starts headless Chromium with `--hide-scrollbars`, and a scrollbar that takes width is
 * one way a fit-width pane can feed back on itself, so the cases run with the switch removed, as Windows draws them.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const LEFT = asDocId('00000000-0000-4000-8000-0000000000d1');
const RIGHT = asDocId('00000000-0000-4000-8000-0000000000d2');

async function pages(sizes: readonly (readonly [number, number])[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [at, size] of sizes.entries()) {
    const page = document.addPage([...size]);
    page.drawRectangle({ x: 100, y: 300, width: 200, height: 200 });
    page.drawText(`Page ${String(at + 1)}`, { x: 72, y: size[1] - 72, size: 18, font });
  }
  return document.save();
}

async function openSideBySide(page: Page, look: Look = LOOKS[0], width = 1280): Promise<Locator> {
  await page.setViewportSize({ width, height: 800 });
  const left = await pages([
    [612, 792],
    [612, 792],
  ]);
  // PAGES OF DIFFERENT SIZES on the right, as a real five-page sample has: an unvisited page's slot is an estimate
  // from its neighbour until it is drawn, so the slots change height as the panes draw.
  const right = await pages([
    [595, 842],
    [612, 792],
    [842, 595],
    [420, 595],
    [595, 842],
  ]);
  await bridgeUnder(page, look, {
    opens: [
      { kind: 'opened', docId: RIGHT, version: asDocVersion(1), byteLength: right.byteLength, name: 'sample5.pdf' },
      { kind: 'opened', docId: LEFT, version: asDocVersion(1), byteLength: left.byteLength, name: 'text-page.pdf' },
    ],
    documentBytes: new Map([
      [LEFT, left],
      [RIGHT, right],
    ]),
    documentPageLines: new Map([
      [LEFT, [['Quarterly totals'], ['Nothing further']]],
      [RIGHT, [['Quarterly totals'], ['Nothing more'], ['Three'], ['Four'], ['Five']]],
    ]),
    // A WALK THAT TAKES TIME, as one does over real pages: each page's text is held back, so the comparison runs while
    // the panes are on screen.
    delays: { 'document.pageTextLayer': 250 },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('nav.m-ribbon__rail').getByRole('button', { name: 'Review' }).click();
  await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Compare', exact: true }).click();
  const surface = page.locator('section[data-side-by-side]');
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-side-half="right"] canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  return surface;
}

/** Each pane's scroll position on every frame for `ms`. */
async function scrollsFor(page: Page, ms: number): Promise<{ left: number[]; right: number[] }> {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const left: number[] = [];
        const right: number[] = [];
        const end = performance.now() + duration;
        const read = (side: string): number =>
          document.querySelector<HTMLElement>(`[data-side-half="${side}"] .m-page-list`)?.scrollTop ?? Number.NaN;
        const step = (): void => {
          left.push(read('left'));
          right.push(read('right'));
          if (performance.now() < end) requestAnimationFrame(step);
          else resolve({ left, right });
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

/** The width a pane's scrollbar takes, which the scrollbar cases need to be more than nothing. */
async function gutterOf(surface: Locator): Promise<number> {
  return surface.locator('[data-side-half="right"] .m-page-list').evaluate((list: HTMLElement) => list.offsetWidth - list.clientWidth);
}

test('CONTROL: the recorder sees a pane move — a scroll made while it records is in what it returns', async ({ page }) => {
  const surface = await openSideBySide(page);
  await surface.locator('[data-side-half="right"] .m-page-list').evaluate((list) => {
    setTimeout(() => {
      list.scrollTop += 120;
    }, 300);
  });
  const read = await scrollsFor(page, 800);
  expect(new Set(read.right).size).toBe(2);
});

// THE OWNER'S RECORDING OF 0.1.9.0: after Compare the right pane moved up and down by itself for about 15 s. NOT
// REPRODUCED here (2026-10-02, Chromium 151 under the browser shim, at device scales 1, 1.25 and 1.5, from the top and
// part-way down, scrollbars drawn): these cases hold the behaviour and the Windows reproduction is the local agent's.
for (const [scale, from] of [
  [1, 0],
  [1.5, 600],
] as const) {
  test.describe(`at a device scale of ${String(scale)}, from ${String(from)} px down`, () => {
    test.use({ deviceScaleFactor: scale });

    test('after COMPARE neither pane moves by itself, while the walk runs and for 2 s after', async ({ page }) => {
      const surface = await openSideBySide(page);
      expect(await gutterOf(surface)).toBeGreaterThan(0);
      await surface.locator('[data-side-half="right"] .m-page-list').evaluate((list, top) => {
        list.scrollTop = top;
      }, from);
      await surface.locator('[data-side-compare]').click();
      const during = await scrollsFor(page, 1500);
      expect(new Set(during.right), JSON.stringify(during.right.slice(0, 40))).toStrictEqual(new Set([from]));
      await expect(surface.locator('[data-side-count]')).toBeVisible({ timeout: 20_000 });
      const after = await scrollsFor(page, 2000);
      expect(after.right.length).toBeGreaterThan(30);
      expect(new Set(after.right), JSON.stringify(after.right.slice(0, 40))).toStrictEqual(new Set([from]));
      expect(new Set(after.left)).toStrictEqual(new Set([after.left[0]]));
    });
  });
}

// EACH HALF READS ITS OWN DOCUMENT (DDDDDDD-4): the compare pane's case loaded one document's bytes into both halves,
// so a half that read the other's could not fail it. Here the two differ in length and in their second page's words.
test('each half shows ITS OWN document: its own pages, and its own words on the page they share a number with', async ({
  page,
}) => {
  const surface = await openSideBySide(page);
  await expect(surface.locator('[data-side-half="left"] .m-page-slot')).toHaveCount(2);
  await expect(surface.locator('[data-side-half="right"] .m-page-slot')).toHaveCount(5);
  for (const [side, own, other] of [
    ['left', 'Nothing further', 'Nothing more'],
    ['right', 'Nothing more', 'Nothing further'],
  ] as const) {
    const list = surface.locator(`[data-side-half="${side}"] .m-page-list`);
    // THE SECOND PAGE IN VIEW, so its text layer is mounted.
    await list.locator('.m-page-slot').nth(1).scrollIntoViewIfNeeded();
    await expect(list.getByText(own, { exact: true })).toBeAttached({ timeout: 10_000 });
    await expect(list.getByText(other, { exact: true })).toHaveCount(0);
  }
});

test('the Differences close hides the panel AND every mark on both halves; the comparison is still held', async ({ page }) => {
  const surface = await openSideBySide(page);
  await surface.locator('[data-side-compare]').click();
  await expect(surface.locator('[data-side-count]')).toBeVisible({ timeout: 20_000 });
  // THE INSERTED PAGES ARE MARKED on the right; choosing the first takes the half there, so its layer is drawn.
  await surface.locator('[data-side-row]').first().click();
  await expect(surface.locator('[data-difference]').first()).toBeAttached();

  await surface.getByRole('button', { name: 'Close Differences' }).click();
  await expect(surface.locator('[data-side-differences]')).toHaveCount(0);
  await expect(surface.locator('[data-difference]')).toHaveCount(0);
  // NOTHING TO WALK AGAIN: Compare shows the held list at once.
  await surface.locator('[data-side-compare]').click();
  await expect(surface.locator('[data-side-count]')).toBeVisible({ timeout: 1000 });
  await expect(surface.locator('[data-side-compare]')).toHaveAttribute('aria-disabled', 'true');
});

test('while comparing, Compare becomes Stop in its place; Esc closes the panel first, then Side by Side', async ({ page }) => {
  const surface = await openSideBySide(page);
  const compare = surface.locator('[data-side-compare]');
  const box = await compare.boundingBox();
  await compare.click();
  const stop = surface.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible();
  // IN COMPARE'S PLACE: its right edge where Compare's was, beside Close.
  const stopBox = await stop.boundingBox();
  expect(Math.abs((stopBox?.x ?? 0) + (stopBox?.width ?? 0) - (box?.x ?? 0) - (box?.width ?? 0))).toBeLessThan(1);
  await stop.click();
  await expect(compare).toBeVisible();
  await expect(surface.locator('[data-side-differences]')).toHaveCount(0);
  await expect(surface.getByText('A page could not be drawn', { exact: false })).toHaveCount(0);

  await compare.click();
  await expect(surface.locator('[data-side-count]')).toBeVisible({ timeout: 20_000 });
  // NOTHING CLICKED SINCE COMPARE: the focus is still on that button, which is where the person left it.
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-side-compare'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(surface.locator('[data-side-differences]')).toHaveCount(0);
  await expect(surface).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
});

for (const look of LOOKS) {
  for (const width of [960, 1280, 1920]) {
    test(`LOOK ${look.name} at ${String(width)}: the Differences heading and its close share one line, nothing overflows`, async ({ page }) => {
      const surface = await openSideBySide(page, look, width);
      await surface.locator('[data-side-compare]').click();
      await expect(surface.locator('[data-side-count]')).toBeVisible({ timeout: 20_000 });
      const close = surface.getByRole('button', { name: 'Close Differences' });
      const heading = surface.locator('.m-side__heading');
      const [closeBox, headingBox, listBox] = await Promise.all([
        close.boundingBox(),
        heading.boundingBox(),
        surface.locator('[data-side-differences]').boundingBox(),
      ]);
      if (closeBox === null || headingBox === null || listBox === null) throw new Error('the panel is not laid out');
      // ONE LINE: their vertical centres agree, and the close sits inside the panel at its end.
      expect(Math.abs(closeBox.y + closeBox.height / 2 - (headingBox.y + headingBox.height / 2))).toBeLessThan(2);
      expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(listBox.x + listBox.width);
      expect(closeBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
      const overflow = await surface.evaluate((root) => root.scrollWidth - root.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
