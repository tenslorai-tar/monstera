import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * What a read through a document leaves held (the owner's review of 0.1.9.0, item D.a; `docs/JOURNAL.md`, 2026-10-02,
 * *The GPU process's 9×*): PDF.js keeps each page's decoded images as `ImageBitmap`s until the page is cleaned up, so a
 * read to the end held every page's, about 8.2 MiB a page of a scan.
 *
 * ## The instrument
 *
 * The page's own `drawImage` and `ImageBitmap.close`, wrapped before the application loads: every bitmap PDF.js draws
 * is recorded, and every one it closes. HELD is drawn and not closed — a bitmap PDF.js still keeps for a page. The
 * canvases are counted in the page, with the ones that still have a backing store. Its positive control is the drawn
 * count itself: a fixture whose images reached no bitmap would hold none either way.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = asDocId('00000000-0000-4000-8000-0000000000e1');
const PAGES = 40;

/** `PAGES` Letter pages, each drawing its OWN image object — one image cached across pages would be held once. */
async function imagePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const png = readFileSync(join(REPO_ROOT, 'assets', 'brand', 'logo-256.png'));
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    const image = await document.embedPng(png);
    page.drawImage(image, { x: 100, y: 200 + (at % 5) * 20, width: 400, height: 400 });
  }
  return document.save();
}

async function counted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const drawn = new Set<ImageBitmap>();
    const closed = new WeakSet<ImageBitmap>();
    // THE ORIGINALS BY DESCRIPTOR, called with the receiver they were given.
    const draw = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'drawImage')?.value as (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) => void;
    const close = Object.getOwnPropertyDescriptor(ImageBitmap.prototype, 'close')?.value as (this: ImageBitmap) => void;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', {
      configurable: true,
      writable: true,
      value(this: CanvasRenderingContext2D, ...args: unknown[]): void {
        if (args[0] instanceof ImageBitmap) drawn.add(args[0]);
        draw.apply(this, args);
      },
    });
    Object.defineProperty(ImageBitmap.prototype, 'close', {
      configurable: true,
      writable: true,
      value(this: ImageBitmap): void {
        closed.add(this);
        close.call(this);
      },
    });
    (window as unknown as { bitmaps: () => { drawn: number; held: number } }).bitmaps = () => ({
      drawn: drawn.size,
      held: [...drawn].filter((bitmap) => !closed.has(bitmap)).length,
    });
  });
}

interface Held {
  readonly drawn: number;
  readonly held: number;
  readonly canvases: number;
  readonly backed: number;
}

async function heldNow(page: Page): Promise<Held> {
  return page.evaluate(() => {
    const { drawn, held } = (window as unknown as { bitmaps: () => { drawn: number; held: number } }).bitmaps();
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.m-page-list canvas.m-page')];
    return { drawn, held, canvases: canvases.length, backed: canvases.filter((canvas) => canvas.width > 0).length };
  });
}

test(`a read through ${String(PAGES)} image pages HOLDS ONLY the pages in reach, not every page drawn`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await counted(page);
  const bytes = await imagePages();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'scan.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });

  // TO THE END, a screen at a time, each screen given time to draw: what a reader does with Page Down.
  const list = page.locator('.m-page-list');
  for (let step = 0; step < 80; step += 1) {
    const atEnd = await list.evaluate((element) => {
      element.scrollTop += element.clientHeight;
      return element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    });
    await page.waitForTimeout(120);
    if (atEnd) break;
  }
  await page.waitForTimeout(1500);
  const after = await heldNow(page);
  console.log(JSON.stringify(after));

  // THE POSITIVE CONTROL: most of the document's images reached a bitmap, so a small HELD is the release, not a fixture
  // that never decoded.
  expect(after.drawn).toBeGreaterThan(PAGES * 0.75);
  // HELD: the pages in the list's margin and the strip's few, never the document. Without the release it is `drawn`.
  expect(after.held).toBeLessThanOrEqual(12);
  // CANVASES in the page are the margin's, and every one has a backing store: those outside it are gone.
  expect(after.canvases).toBeLessThanOrEqual(12);

  // AND BACK TO THE TOP: a released page is drawn again, whole, and nothing is left failed.
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  const first = page.locator('.m-page-list canvas.m-page[data-page-canvas="0"]');
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => first.evaluate((canvas: HTMLCanvasElement) => canvas.width), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('.m-page-list canvas[data-failed]')).toHaveCount(0);
  const back = await heldNow(page);
  // DRAWN AGAIN, which is the cost of the release: page 1's images decoded a second time.
  expect(back.drawn).toBeGreaterThan(after.drawn);
  expect(back.held).toBeLessThanOrEqual(12);
});
