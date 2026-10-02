import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from '@cantoo/pdf-lib';
import { MAX_RANGE_BYTES } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * A page whose ONE object is larger than one read (the large-document breakages, table A's `MAX_RANGE_BYTES` row).
 *
 * PDF.js asks for an image object whole, and the contract bounds one `document.readRange` at `MAX_RANGE_BYTES`, so a
 * scan stored as one uncompressed image past that never drew, and nothing said why. The transport now reads such a
 * range in bounded pieces and hands PDF.js the range in one call. This is the end-to-end half: real PDF.js, in
 * Chromium, through the browser shim's real contract validation, drawing the page.
 *
 * The fixture is past the bound by construction: a 2,500 × 2,500 RGB image with no filter is 18,750,000 bytes, and the
 * case asserts that before it opens anything. It is one flat colour so the drawn page is read by one pixel.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f7');
const SIDE = 2500;

async function onePageOneLargeImage(): Promise<{ bytes: Uint8Array; imageBytes: number }> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const raw = new Uint8Array(SIDE * SIDE * 3);
  // A FLAT TEAL, a colour no page or ground in the application is drawn in.
  for (let at = 0; at < raw.length; at += 3) {
    raw[at] = 0;
    raw[at + 1] = 128;
    raw[at + 2] = 128;
  }
  const image = document.context.register(
    document.context.stream(raw, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: SIDE,
      Height: SIDE,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
    }),
  );
  const name = page.node.newXObject('Im', image);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(512, 0, 0, 692, 50, 50), drawObject(name), popGraphicsState());
  // NO OBJECT STREAMS, so the image stays one plain object PDF.js asks for in one range.
  return { bytes: await document.save({ useObjectStreams: false }), imageBytes: raw.length };
}

test('a page whose ONE IMAGE is larger than one read is drawn, from bounded reads', async ({ page }) => {
  test.setTimeout(120_000);
  const { bytes, imageBytes } = await onePageOneLargeImage();
  // THE BREAKING SIZE, asserted rather than assumed: below the bound the case would pass against the old transport.
  expect(imageBytes).toBeGreaterThan(MAX_RANGE_BYTES);

  await page.setViewportSize({ width: 1280, height: 800 });
  const reads: { begin: number; end: number }[] = [];
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'scan.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel, params) => {
      if (channel === 'document.readRange') {
        const { begin, end } = params as { begin: number; end: number };
        reads.push({ begin, end });
      }
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();

  const canvas = page.locator('.m-page-list canvas[data-page-canvas="0"]');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // DRAWN: the middle of the page is the image's teal. A page that never drew is transparent there.
  await expect
    .poll(
      () =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const context = element.getContext('2d');
          if (context === null || element.width === 0) return 'no canvas';
          const [red, green, blue, alpha] = context.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data;
          return `${String(red)},${String(green)},${String(blue)},${String(alpha)}`;
        }),
      { timeout: 30_000 },
    )
    .toBe('0,128,128,255');
  await expect(page.locator('.m-page-list canvas[data-failed]')).toHaveCount(0);

  // EVERY READ WITHIN THE BOUND, and the image's range was asked for in more than one of them.
  expect(reads.every((read) => read.end - read.begin <= MAX_RANGE_BYTES)).toBe(true);
  expect(reads.filter((read) => read.end - read.begin === MAX_RANGE_BYTES).length).toBeGreaterThan(0);
});
