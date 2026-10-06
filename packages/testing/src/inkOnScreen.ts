import { type Rgb, channels, contrast, textContrastFloor } from '@monstera/shared';
import { type Locator, type Page, expect } from '@playwright/test';
import sharp from 'sharp';

import type { Look } from './pageBridge.js';

/**
 * Every text node inside `control` clears the theme's text floor against what is DRAWN behind it, with the opacity of
 * every element above it applied — a disabled item drawn at half opacity is half as far from its ground as its colour
 * says.
 *
 * FOR TEXT AXE DOES NOT MEASURE: its colour-contrast rule skips any node under `aria-disabled="true"` (axe-core 4.13.0,
 * `isDisabled`), so an unavailable recent file's name passes the gate however faint it is drawn. WCAG exempts an
 * inactive control; a person still has to read which file has gone.
 *
 * THE GROUND IS READ FROM THE PIXELS. A card on the start screen is translucent over a lit background, so no element's
 * `background-color` is the colour behind its words (measured 2026-10-03: `rgba(255, 255, 255, 0.45)` in light, over
 * a ground drawn at rgb(242, 246, 244)). The control's text is made transparent, the window photographed, and the
 * median pixel under each text box is its ground.
 */
export async function readsAtTextFloor(page: Page, control: Locator, look: Look): Promise<void> {
  // ON SCREEN FIRST: the photograph is of the window, and a card below the fold has no pixels in it.
  await control.scrollIntoViewIfNeeded();
  const inks = await control.evaluate((element) => {
    const found: { text: string; colour: string; opacity: number; box: { x: number; y: number; width: number; height: number } }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      const parent = node.parentElement;
      if (text === '' || parent === null) continue;
      if (parent.closest('[aria-hidden="true"]') !== null) continue;
      let opacity = 1;
      for (let at: Element | null = parent; at !== null; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity);
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      found.push({ text, colour: getComputedStyle(parent).color, opacity, box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    return found;
  });
  // A SEARCH, so it must find something: an empty walk would pass every assertion below.
  expect(inks.length, 'the control holds text to measure').toBeGreaterThan(0);

  await control.evaluate((element) => {
    element.setAttribute('data-measuring-ground', '');
    const style = document.createElement('style');
    style.id = 'measuring-ground';
    style.textContent = '[data-measuring-ground], [data-measuring-ground] * { color: transparent !important; text-shadow: none !important; }';
    document.head.append(style);
  });
  const shot = await page.screenshot({ scale: 'css' });
  await control.evaluate((element) => {
    element.removeAttribute('data-measuring-ground');
    document.querySelector('#measuring-ground')?.remove();
  });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });

  for (const ink of inks) {
    const colour = channels(ink.colour);
    if (colour === null) throw new Error(`${ink.text}: ${ink.colour} did not parse`);
    // INSIDE THE PHOTOGRAPH, or its pixels are not this text's ground.
    expect(
      ink.box.x >= 0 && ink.box.y >= 0 && ink.box.x + ink.box.width <= info.width && ink.box.y + ink.box.height <= info.height,
      `${ink.text}: its box ${JSON.stringify(ink.box)} lies in the ${String(info.width)} × ${String(info.height)} window`,
    ).toBe(true);
    const samples: Rgb[] = [];
    for (let y = Math.ceil(ink.box.y); y < Math.floor(ink.box.y + ink.box.height); y += 1) {
      for (let x = Math.ceil(ink.box.x); x < Math.floor(ink.box.x + ink.box.width); x += 1) {
        const at = (y * info.width + x) * info.channels;
        samples.push([data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0]);
      }
    }
    expect(samples.length, `${ink.text}: pixels under its box`).toBeGreaterThan(0);
    const median = (channel: 0 | 1 | 2): number => {
      const sorted = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const back: Rgb = [median(0), median(1), median(2)];
    const blend = (at: 0 | 1 | 2): number => ink.opacity * colour[at] + (1 - ink.opacity) * back[at];
    const seen: Rgb = [blend(0), blend(1), blend(2)];
    expect(
      contrast(seen, back),
      `${look.name}: "${ink.text}" in ${ink.colour} at opacity ${String(ink.opacity)} on rgb(${back.join(', ')})`,
    ).toBeGreaterThanOrEqual(textContrastFloor(look.name));
  }
}
