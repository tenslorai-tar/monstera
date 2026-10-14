import { expect, test } from '@playwright/test';

import { openApp, openDocument, openSection } from './helpScreensHarness.js';

/**
 * EDIT OBJECT OUTLINES WHAT SHOWS (the owner's E3): a magazine's photo placed larger than the window it is clipped to,
 * and one running past the page's edge, outlined in the shipped renderer on the page a person sees.
 *
 * The engine's walk is the shim's here, answering as PDFium's does since E3: the placement's own box, and `shown` where
 * a clip narrows it. `proof:drawnobjects` holds the engine half, where PDFium answers `shown` for a real clipped photo.
 */
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
  await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true }).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  await expect(layer.locator('.m-object')).toHaveCount(2);

  const clipped = await layer.locator('[data-object="content:0"]').boundingBox();
  const bleed = await layer.locator('[data-object="content:1"]').boundingBox();
  const sheet = await layer.boundingBox();
  if (clipped === null || bleed === null || sheet === null) throw new Error('an outline or the page is not on screen');
  // THE WINDOW'S PROPORTIONS, 200 : 150, not the placement's 380 : 190.
  expect(clipped.width / clipped.height).toBeCloseTo(200 / 150, 1);
  // INSIDE THE PAGE: its left edge on the page's, and its width the 100 points that are on the page, half its 200.
  expect(Math.abs(bleed.x - sheet.x)).toBeLessThan(1.5);
  expect(bleed.width / bleed.height).toBeCloseTo(100 / 100, 1);
});

// THE OBJECT ITSELF MOVES WITH THE POINTER (the owner's E5), not only its outline: the page's own pixels under the
// picked object, drawn at the box the drag would put it in, while the button is still down.
test('a drag in Edit object shows the object itself moving, with the page’s own ink, until it is let go', async ({ page }) => {
  // OVER THE SAMPLE PAGE'S TITLE, 22 pt at (72, 700): a box the page has ink in, so a copy of the right pixels is not
  // blank, and a copy of the wrong ones would be.
  await openApp(page, { pageObjects: [{ index: 0, kind: 'text', left: 70, bottom: 694, right: 330, top: 722, fill: { red: 0, green: 0, blue: 0, alpha: 255 } }] });
  await openDocument(page);
  await openSection(page, 'Edit');
  await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true }).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  const title = layer.locator('[data-object="content:0"]');
  await title.click();
  const box = await title.boundingBox();
  if (box === null) throw new Error('the outline is not on screen');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  const preview = layer.locator('[data-object-preview]');
  await expect(preview).toBeVisible();
  const moved = await preview.boundingBox();
  expect(moved?.x).toBeCloseTo(box.x + 40, 0);
  expect(moved?.y).toBeCloseTo(box.y + 30, 0);
  // INK IN THE COPY: dark pixels from the title, read from the preview's own canvas.
  const dark = await preview.evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
    let count = 0;
    for (let at = 0; at < data.length; at += 4) if ((data[at] ?? 255) < 128 && (data[at + 3] ?? 0) > 0) count += 1;
    return count;
  });
  expect(dark).toBeGreaterThan(20);
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
});

// THE ROTATE HANDLE AND THE SIDES (the owner's E6), in Chromium: eight square handles and a round one above the top,
// and a drag of the round one a quarter turn clockwise sends a turn of −90, as PDF measures it.
test('Edit object turns a picture by its rotate handle, and resizes by eight handles', async ({ page }) => {
  const sent: unknown[] = [];
  await openApp(page, { pageObjects: [{ index: 0, kind: 'image', left: 200, bottom: 300, right: 300, top: 400, fill: null }] }, (channel, params) => {
    if (channel === 'document.execute') sent.push(params);
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true }).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  await layer.locator('[data-object="content:0"]').click();
  await expect(layer.locator('[data-object-handle]')).toHaveCount(8);
  const rotate = layer.locator('[data-object-rotate]');
  const photo = await layer.locator('[data-object="content:0"]').boundingBox();
  const handle = await rotate.boundingBox();
  if (photo === null || handle === null) throw new Error('the photo or its rotate handle is not on screen');
  const centre = { x: photo.x + photo.width / 2, y: photo.y + photo.height / 2 };
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(centre.x + 80, centre.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => sent.length).toBe(1);
  const command = (sent[0] as { command: { kind: string; rotateBy?: number } }).command;
  expect(command.kind).toBe('placeDrawnObject');
  expect(command.rotateBy).toBeCloseTo(-90, 0);
});

// ARRANGE (the owner's E6, ADR-0244), on the path a person takes: the object's own menu offers Bring forward for the
// first of two objects and not Send backward, and choosing it sends the step for that object.
test('Edit object’s menu brings the first of two objects forward, and offers no step it cannot take', async ({ page }) => {
  const sent: unknown[] = [];
  const image = (index: number, left: number) => ({ index, kind: 'image' as const, left, bottom: 300, right: left + 100, top: 400, fill: null });
  await openApp(page, { pageObjects: [image(0, 100), image(1, 300)] }, (channel, params) => {
    if (channel === 'document.execute') sent.push(params);
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true }).click();
  const first = page.getByRole('group', { name: 'Objects on page 1' }).locator('[data-object="content:0"]');
  await first.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Bring forward' })).toBeVisible();
  // CONTROL: nothing is behind the first object, so its menu has no step that way.
  await expect(menu.getByRole('menuitem', { name: 'Send backward' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Bring forward' }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { command: unknown }).command).toMatchObject({ kind: 'arrangePageObject', index: 0, toward: 'forward' });
});

const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;

// A WORD WRITTEN ONE LETTER PER OBJECT (the owner's E4: a press on *overview* picked its final *w*). The page's block
// read names all four, so a press on one letter picks the word, and a drag sends ONE command for all of it.
test('Edit object picks a word written a letter at a time as one, and moves it as one', async ({ page }) => {
  const sent: unknown[] = [];
  const letter = (index: number, left: number) => ({ index, kind: 'text' as const, left, bottom: 600, right: left + 9, top: 612, fill: { red: 0, green: 0, blue: 0, alpha: 255 } });
  await openApp(
    page,
    {
      pageObjects: [letter(0, 100), letter(1, 110), letter(2, 120), letter(3, 130)],
      textBlocks: [
        {
          box: { x0: 100, y0: 600, x1: 139, y1: 612 },
          lines: [{ runs: [0, 1, 2, 3].map((index) => ({ index, text: 'OVER'[index] ?? '', style: RUN })), box: { x0: 100, y0: 600, x1: 139, y1: 612 }, soft: false, baseline: 602 }],
          style: RUN,
          shape: { align: 'left', firstIndent: 0 },
        },
      ],
    },
    (channel, params) => {
      if (channel === 'document.execute') sent.push(params);
    },
  );
  await openDocument(page);
  await openSection(page, 'Edit');
  await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true }).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  // ONE OUTLINE for the four letters, not four.
  await expect(layer.locator('.m-object')).toHaveCount(1);
  const word = layer.locator('[data-object="content:0"]');
  await word.click();
  await expect(word).toHaveAttribute('aria-pressed', 'true');
  const box = await word.boundingBox();
  if (box === null) throw new Error('the word is not on screen');
  // THE WORD'S MIDDLE, clear of the eight handles on its edges.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { command: unknown }).command).toMatchObject({ kind: 'placePageObjects', indices: [0, 1, 2, 3], scaleBy: { x: 1, y: 1 } });
});
