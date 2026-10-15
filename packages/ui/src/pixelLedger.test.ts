// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import {
  givePixelsBack,
  holdPixels,
  mayHoldAhead,
  pixelsHeld,
  setPixelLimit,
  subscribePixels,
} from './pixelLedger.js';
import { PAGE_MEMORY_SETTING, pageMemoryLimit } from './settings/rendering.js';

/** The ledger is the window's one count (ADR-0247): each case leaves it empty and unlimited. */
const made: HTMLCanvasElement[] = [];
function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  made.push(element);
  return element;
}
afterEach(() => {
  for (const element of made.splice(0)) givePixelsBack(element);
  setPixelLimit(Number.POSITIVE_INFINITY);
});

describe('the page pixel ledger', () => {
  it('counts a canvas by the size it was given, once however often it is redrawn, and nothing once given back', () => {
    const page = canvas();
    holdPixels(page, 100, 50);
    expect(page.width).toBe(100);
    expect(page.height).toBe(50);
    expect(pixelsHeld()).toBe(100 * 50 * 4);
    // A REDRAW AT ANOTHER SIZE replaces its count rather than adding to it.
    holdPixels(page, 200, 50);
    expect(pixelsHeld()).toBe(200 * 50 * 4);
    const other = canvas();
    holdPixels(other, 10, 10);
    expect(pixelsHeld()).toBe(200 * 50 * 4 + 400);
    givePixelsBack(page);
    expect([page.width, page.height]).toStrictEqual([0, 0]);
    expect(pixelsHeld()).toBe(400);
  });

  it('allows the page ahead only within the limit, counting what is held', () => {
    holdPixels(canvas(), 100, 100);
    setPixelLimit(100 * 100 * 4 + 1000);
    expect(mayHoldAhead(1000, false)).toBe(true);
    // CONTROL: one byte more than the limit leaves is refused.
    expect(mayHoldAhead(1001, false)).toBe(false);
  });

  it('asks about a page ahead it already holds without counting it twice, so a page that fits stays held', () => {
    const ahead = canvas();
    holdPixels(canvas(), 100, 100);
    holdPixels(ahead, 10, 25);
    setPixelLimit(100 * 100 * 4 + 1000);
    // HELD AND WITHIN: the 1,000 bytes are already in the count.
    expect(mayHoldAhead(1000, true)).toBe(true);
    // CONTROL: the same question as if it were not held counts it twice, and would release it.
    expect(mayHoldAhead(1000, false)).toBe(false);
  });

  it('tells a subscriber when the count or the limit changes, and not when a redraw holds the same size', () => {
    const page = canvas();
    let told = 0;
    const stop = subscribePixels(() => {
      told += 1;
    });
    holdPixels(page, 10, 10);
    holdPixels(page, 10, 10);
    setPixelLimit(5000);
    stop();
    holdPixels(page, 20, 20);
    expect(told).toBe(2);
  });
});

describe('the Memory for pages setting', () => {
  it('Automatic is a quarter of physical memory, and no limit while memory is unknown', () => {
    expect(PAGE_MEMORY_SETTING.fallback).toBe('automatic');
    expect(pageMemoryLimit('automatic', 8 * 1024 ** 3)).toBe(2 * 1024 ** 3);
    expect(pageMemoryLimit('automatic', undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('each fixed choice is the figure its title names', () => {
    expect(pageMemoryLimit('mb-512', 8 * 1024 ** 3)).toBe(512 * 1024 ** 2);
    expect(pageMemoryLimit('gb-1', undefined)).toBe(1024 ** 3);
    expect(pageMemoryLimit('gb-2', undefined)).toBe(2 * 1024 ** 3);
    expect(pageMemoryLimit('gb-4', undefined)).toBe(4 * 1024 ** 3);
  });
});
