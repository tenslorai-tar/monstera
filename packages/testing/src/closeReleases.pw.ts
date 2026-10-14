import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * What a closed document leaves in the renderer (the owner's run 4, item 10: the renderer kept about 137 MB and the GPU
 * process about 35 MB after every document closed).
 *
 * ## The instrument
 *
 * Every `HTMLCanvasElement` the renderer still holds, found by `Runtime.queryObjects` after three forced collections, and
 * the worker targets left. A canvas a closed document drew that is still reachable is its pixels still held. Its
 * positive control is the open document's own canvases, counted the same way before the close.
 *
 * ## What it found (2026-10-14, Chromium 151)
 *
 * The toast strip, which lives for the whole app, named the page area as its CSS anchor; Chromium's anchor-positioning
 * data on it kept the last page pane it anchored to, and through it the pane's 42 page and thumbnail canvases and about
 * 686 nodes, after the document had closed. The strip names the anchor only while a document is open (`ToastStrip`'s
 * `anchored`).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = asDocId('00000000-0000-4000-8000-0000000000e7');
const PAGES = 40;

async function imagePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const png = readFileSync(join(REPO_ROOT, 'assets', 'brand', 'logo-256.png'));
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawImage(await document.embedPng(png), { x: 100, y: 200, width: 400, height: 400 });
  }
  return document.save();
}

/** The canvases the renderer still holds, and the worker targets, after three forced collections. */
async function held(page: Page): Promise<{ canvases: number; workers: number }> {
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
    const targets = await cdp.send('Target.getTargets');
    return { canvases: counted.result.value as number, workers: targets.targetInfos.filter((target) => target.type === 'worker').length };
  } finally {
    await cdp.detach();
  }
}

test('a closed document leaves no canvas and no worker in the renderer', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await imagePages();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'scan.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  // SCROLLED THROUGH, so pages and thumbnails were drawn and had backing stores to keep.
  const list = page.locator('.m-page-list');
  for (let step = 0; step < 10; step += 1) {
    await list.evaluate((element) => {
      element.scrollTop += element.clientHeight;
    });
    await page.waitForTimeout(150);
  }
  // THE POSITIVE CONTROL: the open document's canvases are found by the same instrument.
  const open = await held(page);
  expect(open.canvases).toBeGreaterThan(10);

  await page.keyboard.press('Control+w');
  await expect(page.getByRole('button', { name: 'Open PDF…' })).toBeVisible({ timeout: 20_000 });
  const closed = await held(page);
  expect(closed, `open: ${JSON.stringify(open)}`).toStrictEqual({ canvases: 0, workers: 0 });
});
