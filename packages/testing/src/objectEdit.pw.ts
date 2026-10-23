import { expect, test } from '@playwright/test';

import { openApp, openDocument, openSection } from './helpScreensHarness.js';

/**
 * EDIT OBJECT in the shipped renderer, against the browser shim
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)).
 *
 * The shim's engine answers the page's objects as PDFium's walk does: each object's box, and `shown` where a clip narrows
 * it. The writers' half is the kernel's (`proof:editobject`); these see what a person sees and which command leaves.
 */

const face = (page: import('@playwright/test').Page) =>
  page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true });

test('Edit object outlines a clipped photo by its window, and a photo bleeding off the page inside the page', async ({ page }) => {
  await openApp(page, {
    pageObjects: [
      // PLACED 380 by 190 and shown through a 200 by 150 window: the two boxes have different shapes, so an outline
      // drawn from the placement is told from one drawn from the window by its proportions alone.
      { index: 0, kind: 'image', left: 20, bottom: 300, right: 400, top: 490, shown: { left: 200, bottom: 300, right: 400, top: 450 }, fill: null },
      // PAST THE LEFT EDGE by 100 points, with no clip: the page's crop is its window.
      { index: 1, kind: 'image', left: -100, bottom: 100, right: 100, top: 200, fill: null },
    ],
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  await face(page).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  await expect(layer.locator('.m-object')).toHaveCount(2);

  const clipped = await layer.locator('[data-object="drawn:0"]').boundingBox();
  const bleed = await layer.locator('[data-object="drawn:1"]').boundingBox();
  const sheet = await layer.boundingBox();
  if (clipped === null || bleed === null || sheet === null) throw new Error('an outline or the page is not on screen');
  // THE WINDOW'S PROPORTIONS, 200 : 150, not the placement's 380 : 190.
  expect(clipped.width / clipped.height).toBeCloseTo(200 / 150, 1);
  // INSIDE THE PAGE: its left edge on the page's, and its width the 100 points that are on the page, half its 200.
  expect(Math.abs(bleed.x - sheet.x)).toBeLessThan(1.5);
  expect(bleed.width / bleed.height).toBeCloseTo(100 / 100, 1);
});

// THE OBJECT IS LIFTED (Decision 9): its own pixels follow the pointer with the paper laid over the place it left, and
// on release the same look is held while the command is sent.
test('a drag in Edit object moves the object’s own pixels, and the release holds them where it sent the object', async ({ page }) => {
  const sent: unknown[] = [];
  // OVER THE SAMPLE PAGE'S TITLE, 22 pt at (72, 700): a box the page has ink in, so a copy of the right pixels is not
  // blank, and a copy of the wrong ones would be. A path, so the shim's missing text engine does not hide it.
  await openApp(page, { pageObjects: [{ index: 0, kind: 'path', left: 70, bottom: 694, right: 330, top: 722, fill: { red: 0, green: 0, blue: 0, alpha: 255 } }] }, (channel, params) => {
    if (channel === 'document.execute') sent.push(params);
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  await face(page).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  const title = layer.locator('[data-object="drawn:0"]');
  await title.click();
  const box = await title.boundingBox();
  if (box === null) throw new Error('the outline is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  const lifted = layer.locator('[data-object-lifted]');
  await expect(lifted).toBeVisible();
  const moved = await lifted.boundingBox();
  expect(moved?.x).toBeCloseTo(box.x + 40, 0);
  expect(moved?.y).toBeCloseTo(box.y + 30, 0);
  // INK IN THE COPY: dark pixels from the title, read from the lifted canvas itself.
  const dark = await lifted.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
    let count = 0;
    for (let at = 0; at < data.length; at += 4) if ((data[at] ?? 255) < 128 && (data[at + 3] ?? 0) > 0) count += 1;
    return count;
  });
  expect(dark).toBeGreaterThan(20);
  // THE PAPER OVER THE PLACE IT LEFT, the page's own white round the title.
  await expect(layer.locator('[data-object-left]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.mouse.up();
  await expect(lifted).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { command: unknown }).command).toMatchObject({ kind: 'editDrawnObject', index: 0, object: 'path', ordinal: 0, edit: { op: 'place' } });
  // CONTROL: a press that does not travel sends nothing and lifts nothing.
  await title.click();
  await expect(layer.locator('[data-object-lifted]')).toHaveCount(0);
  expect(sent).toHaveLength(1);
});

// ARRANGE (Decision 3) on the path a person takes: the object's own menu offers Bring forward for the lower of two
// overlapping pictures and not Send backward, and choosing it sends the step past the one over it.
test('Edit object’s menu brings the lower of two overlapping pictures forward, and offers no step it cannot take', async ({ page }) => {
  const sent: unknown[] = [];
  const image = (index: number, left: number) => ({ index, kind: 'image' as const, left, bottom: 300, right: left + 150, top: 400, fill: null });
  await openApp(page, { pageObjects: [image(0, 100), image(1, 200)] }, (channel, params) => {
    if (channel === 'document.execute') sent.push(params);
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  await face(page).click();
  const lower = page.getByRole('group', { name: 'Objects on page 1' }).locator('[data-object="drawn:0"]');
  const box = await lower.boundingBox();
  if (box === null) throw new Error('the outline is not on screen');
  // ITS LEFT THIRD, which the upper picture does not cover, so the press names the lower one.
  await page.mouse.click(box.x + box.width / 6, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Bring forward' })).toBeVisible();
  // CONTROL: nothing overlapping is behind it, so its menu has no step that way.
  await expect(menu.getByRole('menuitem', { name: 'Send backward' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Bring forward' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { command: unknown }).command).toMatchObject({
    kind: 'editDrawnObject',
    index: 0,
    object: 'image',
    ordinal: 0,
    edit: { op: 'arrange', to: 'forward', past: { kind: 'image', ordinal: 1 } },
  });
});
