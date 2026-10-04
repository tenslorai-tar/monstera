import { type Rgb, contrast } from '@monstera/shared';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';

import { openDocument, samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * The scroll bars (the owner's item 9a), read from what the platform PAINTS, since a scroll bar's parts are not
 * elements and no style can be read off them.
 *
 * Before the change, 2026-10-04 on Chromium 151: a 10 px bar, measured by this file's control, whose thumb, inset 3 px
 * each side by the stylesheet, was a 4 px line in the gradient hairline's colour. These cases take the page list's bar, photograph it, find the thumb as the
 * run of pixels unlike the track, and assert its width at rest and under the pointer, and its contrast against the
 * track, in every look.
 */

// THE BARS DRAWN AT ALL: Playwright launches headless Chromium with `--hide-scrollbars`, so in every other rendered
// case here no scroll bar is painted and none takes room. Without this the bar measures 0 px and there is no thumb.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

interface Thumb {
  /** Columns of the thumb across the bar, at the thumb's middle row. */
  readonly width: number;
  /** The thumb's colour against the track's, as painted. */
  readonly contrast: number;
  /** The thumb's colour at its middle, as painted. */
  readonly colour: Rgb;
  /** Where the thumb's middle is, in the window, for the pointer. */
  readonly at: { readonly x: number; readonly y: number };
}

/** The bar's box in the window: the scroller's right edge less its border, as wide as the bar. */
async function barOf(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.locator('.m-page-list').first().evaluate((scroller) => {
    if (!(scroller instanceof HTMLElement)) throw new Error('the page list is not an element that scrolls');
    const box = scroller.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const border = Number.parseFloat(style.borderRightWidth);
    const width = scroller.offsetWidth - scroller.clientWidth - border - Number.parseFloat(style.borderLeftWidth);
    return { x: box.right - border - width, y: box.top + Number.parseFloat(style.borderTopWidth), width, height: scroller.clientHeight };
  });
}

async function thumbOf(page: Page): Promise<Thumb> {
  const bar = await barOf(page);
  const shot = await page.screenshot({ scale: 'css', clip: bar });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number): Rgb => {
    const at = (y * info.width + x) * info.channels;
    return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
  };
  const differs = (a: Rgb, b: Rgb): boolean => Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? 0)))) > 24;
  const centre = Math.floor(info.width / 2);
  // THE TRACK at the bar's foot: the list starts at its top, so the thumb is at the top and the foot is bare.
  const track = pixel(centre, info.height - 2);
  const rows = [...Array(info.height).keys()].filter((y) => differs(pixel(centre, y), track));
  // A SEARCH, so it must find something: a bar with no thumb would pass every width below as zero.
  expect(rows.length, 'the thumb is painted in the bar').toBeGreaterThan(0);
  const middle = rows[Math.floor(rows.length / 2)] ?? 0;
  const width = [...Array(info.width).keys()].filter((x) => differs(pixel(x, middle), track)).length;
  const colour = pixel(centre, middle);
  return { width, contrast: contrast(colour, track), colour, at: { x: bar.x + centre, y: bar.y + middle } };
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 760, height: 560 },
]) {
  test(`at ${String(size.width)} x ${String(size.height)} no scroll bar is drawn for a pixel or two of overflow`, async ({ page }) => {
    // FOUND WHEN BARS WERE FIRST DRAWN HERE (2026-10-04): the tab row drew a vertical bar, its content 1 px taller than
    // its 39, from the tabs' 1 px offset over the title bar's edge. A bar a person can do nothing with is a stray one.
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await samplePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000a1');
    await bridgeUnder(page, LOOKS[0], {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Annual report.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
    });
    await page.goto('/');
    await openDocument(page);
    await page.setViewportSize(size);
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .flatMap((element) => {
          const style = getComputedStyle(element);
          const side = element.offsetWidth - element.clientWidth - Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth);
          const foot = element.offsetHeight - element.clientHeight - Number.parseFloat(style.borderTopWidth) - Number.parseFloat(style.borderBottomWidth);
          // A DRAWN BAR: on an axis that scrolls, and as wide as a bar rather than a rounding pixel of a fractional box.
          const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
          const found: { name: string; overflow: number }[] = [];
          if (scrolls(style.overflowY) && side >= 8) {
            found.push({ name: `${element.className} (vertical)`, overflow: element.scrollHeight - element.clientHeight });
          }
          if (scrolls(style.overflowX) && foot >= 8) {
            found.push({ name: `${element.className} (horizontal)`, overflow: element.scrollWidth - element.clientWidth });
          }
          return found;
        }),
    );
    // CONTROL: bars are drawn, and the page list's is one, so an empty list below is not a window with none.
    expect(bars.map((bar) => bar.name)).toContain('m-page-list (vertical)');
    expect(bars.filter((bar) => bar.overflow <= 2)).toStrictEqual([]);
  });
}

for (const look of LOOKS) {
  test(`${look.name}: a scroll bar is 14 px with a thumb 8 px across, 10 under the pointer, at a control's contrast`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bytes = await samplePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000a1');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Annual report.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
    });
    await page.goto('/');
    await openDocument(page);
    await page.mouse.move(2, 400);

    const bar = await barOf(page);
    expect(bar.width).toBe(14);
    const rest = await thumbOf(page);
    expect(rest.width).toBe(8);
    expect(rest.contrast).toBeGreaterThanOrEqual(3);

    await page.mouse.move(rest.at.x, rest.at.y);
    await expect.poll(async () => (await thumbOf(page)).width).toBe(10);
    // A CLEAR CHANGE under the pointer, still a control's contrast: brighter in light and dark, the accent in high
    // contrast, where white on black is already as far as it goes.
    const hover = await thumbOf(page);
    expect(hover.colour).not.toStrictEqual(rest.colour);
    expect(hover.contrast).toBeGreaterThanOrEqual(3);
    if (look.name !== 'hc') expect(hover.contrast).toBeGreaterThan(rest.contrast);
  });
}
