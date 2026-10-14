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
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 27, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => sent.length).toBe(1);
  expect((sent[0] as { command: unknown }).command).toMatchObject({ kind: 'placePageObjects', indices: [0, 1, 2, 3], scaleBy: { x: 1, y: 1 } });
});
