import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * A tab not on screen gives back its pages and keeps what brings it back quickly (the owner's run 4 item 13c; ADR-0129,
 * corrected 2026-10-14): its parse, its slots' sizes and its scroll offset stay, and no page canvas of it is held.
 *
 * ## The instrument is `closeReleases.pw.ts`'
 *
 * Every `HTMLCanvasElement` the renderer still holds, found by `Runtime.queryObjects` after three forced collections, so
 * a canvas taken out of the page and still reachable is counted as well as one in it. The positive control is the
 * first document's own canvases while it is on show.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCAN = asDocId('00000000-0000-4000-8000-0000000013c1');
const NOTE = asDocId('00000000-0000-4000-8000-0000000013c2');

async function imagePages(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const png = readFileSync(join(REPO_ROOT, 'assets', 'brand', 'logo-256.png'));
  for (let at = 0; at < count; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawImage(await document.embedPng(png), { x: 100, y: 200, width: 400, height: 400 });
  }
  return document.save();
}

/** The canvases the renderer holds after three forced collections. */
async function heldCanvases(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (let round = 0; round < 3; round += 1) await cdp.send('HeapProfiler.collectGarbage');
    const prototype = await cdp.send('Runtime.evaluate', { expression: 'HTMLCanvasElement.prototype' });
    const found = await cdp.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId ?? '' });
    const counted = await cdp.send('Runtime.callFunctionOn', {
      objectId: found.objects.objectId ?? '',
      functionDeclaration: 'function () { return this.length; }',
      returnByValue: true,
    });
    return counted.result.value as number;
  } finally {
    await cdp.detach();
  }
}

test('a thumbnail strip scrolled through forty pages holds pixels for its margin only, and a card coming back is drawn again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const scan = await imagePages(40);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: SCAN, version: asDocVersion(1), byteLength: scan.byteLength, name: 'scan.pdf' }],
    documentBytes: new Map([[SCAN, scan]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const strip = page.getByRole('navigation', { name: 'Page thumbnails' });
  const first = strip.locator('[data-thumb-page="0"] canvas');
  // THE POSITIVE CONTROL: the first card is drawn, so it holds pixels to give back.
  await expect(first).toHaveAttribute('data-drawn', 'true', { timeout: 20_000 });
  /** How many of the strip's canvases hold a backing store. */
  const holding = (): Promise<number> =>
    strip.locator('canvas.m-thumb-canvas').evaluateAll((canvases) => canvases.filter((each) => (each as HTMLCanvasElement).width > 0).length);
  for (let step = 0; step < 40; step += 1) {
    await strip.evaluate((element) => {
      element.scrollTop += element.clientHeight / 2;
    });
    await page.waitForTimeout(80);
  }
  await expect(strip.locator('[data-thumb-page="39"] canvas')).toHaveAttribute('data-drawn', 'true', { timeout: 20_000 });
  // THE FIRST CARD, far out of the margin, gave its pixels back and kept its box.
  await expect(first).toHaveAttribute('data-drawn', 'released');
  expect(await first.evaluate((element) => [(element as HTMLCanvasElement).width, element.getBoundingClientRect().height > 0])).toStrictEqual([
    0,
    true,
  ]);
  // HELD: the margin's cards, never the forty drawn on the way down.
  expect(await holding()).toBeLessThan(20);
  // AND BACK AT THE TOP, drawn again.
  await strip.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(first).toHaveAttribute('data-drawn', 'true', { timeout: 20_000 });
});

/** Says the window was hidden, or shown, as Chromium does when an Electron window is minimised and restored. */
async function windowShown(page: Page, shown: boolean): Promise<void> {
  await page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (visible ? 'visible' : 'hidden') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, shown);
}

test('the window hidden for half a minute gives the page on show back, and shown again it is drawn (item 13d)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const note = await imagePages(3);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: NOTE, version: asDocVersion(1), byteLength: note.byteLength, name: 'note.pdf' }],
    documentBytes: new Map([[NOTE, note]]),
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const pages = page.locator('[data-document-layer="active"] .m-page-list canvas.m-page');
  await expect(pages.first()).toBeVisible({ timeout: 20_000 });

  await windowShown(page, false);
  // CONTROL: hidden, but not yet for half a minute, the page is kept.
  await page.clock.runFor(20_000);
  await expect(pages).not.toHaveCount(0);
  await page.clock.runFor(11_000);
  await expect(pages).toHaveCount(0);
  expect(await heldCanvases(page)).toBe(await page.locator('canvas').count());

  await windowShown(page, true);
  await expect(pages.first()).toBeVisible({ timeout: 20_000 });
});

test('a tab behind holds no page canvas, and coming forward redraws it where the reader left it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const scan = await imagePages(40);
  const note = await imagePages(1);
  await bridge(page, {
    opens: [
      { kind: 'opened', docId: SCAN, version: asDocVersion(1), byteLength: scan.byteLength, name: 'scan.pdf' },
      { kind: 'opened', docId: NOTE, version: asDocVersion(1), byteLength: note.byteLength, name: 'note.pdf' },
    ],
    documentBytes: new Map([
      [SCAN, scan],
      [NOTE, note],
    ]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const active = page.locator('[data-document-layer="active"]');
  await expect(active.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  // SCROLLED INTO THE DOCUMENT, so the reader has a place to come back to and the margin is drawn there.
  const list = active.locator('.m-page-list');
  for (let step = 0; step < 6; step += 1) {
    await list.evaluate((element) => {
      element.scrollTop += element.clientHeight;
    });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const offset = await list.evaluate((element) => element.scrollTop);
  // THE POSITIVE CONTROL: the scan's page on show is a canvas, counted in the document and by the instrument.
  expect(await active.locator('.m-page-list canvas.m-page').count()).toBeGreaterThan(0);
  expect(await heldCanvases(page)).toBeGreaterThan(0);

  // THE SECOND DOCUMENT COMES FORWARD, and the scan goes behind.
  await page.keyboard.press('Control+o');
  await expect(page.locator('[data-document-layer]')).toHaveCount(2);
  await expect(active.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  const behind = page.locator('[data-document-layer="background"]');
  // BEHIND: its slots are there at their sizes, and no page canvas.
  await expect(behind.locator('.m-page-slot').first()).toBeAttached();
  await expect(behind.locator('canvas.m-page')).toHaveCount(0);
  // AND NONE HELD OUT OF THE PAGE: every canvas the renderer holds is one in the document, so the scan's are gone and
  // not merely detached.
  expect(await heldCanvases(page)).toBe(await page.locator('canvas').count());

  // BACK TO THE SCAN: drawn again, at the place the reader left.
  await page.locator('[data-tab-select]').first().click();
  // THE SWITCH LANDED, read before anything on the active layer: the scan stays behind until its pages are drawn
  // again (`App.arrived`), and until then the layer on show is still the note's, whose canvas is visible too.
  await expect(page.locator('[data-tab-select]').first()).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-document-layer="active"] .m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('[data-document-layer="active"] .m-page-list').evaluate((element) => element.scrollTop)).toBe(offset);
  await expect(page.locator('[data-document-layer="background"] canvas.m-page')).toHaveCount(0);
});
