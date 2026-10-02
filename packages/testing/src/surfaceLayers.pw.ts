import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type CDPSession, type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000f8');

/**
 * The window's grain is a composited layer of its own, in a real browser — and it is still drawn.
 *
 * The grain (`app.css`, `.m-document-surface::before`) is a noise tile blended `overlay` over the whole window. Painted
 * into the surface's own layer it was rasterised again under every repaint above it, and a panel-edge drag dropped 215
 * frames, 72 with the grain on its own layer (`scripts/research/frameTimes.mjs`, 2026-10-01). What holds that is a
 * layer, so a layer is what this reads — Chromium's layer tree over the DevTools protocol, with the reasons it gives.
 *
 * THE CONTROL is the same read finding the viewport's own layer: an empty layer list is what a broken read returns, and
 * it would satisfy *no grain layer* as readily as the defect does.
 */

interface Layer {
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  /** The DOM node that owns the layer, where it has one. */
  readonly backendNodeId?: number;
}

/**
 * Every composited layer, with Chromium's reasons for compositing it.
 *
 * ## READ AGAINST THE NEWEST TREE, because a reason is asked for by layer id
 *
 * A page still drawing commits new frames, and each commit may replace the layers: a reason asked for against a tree
 * that has since been replaced is answered *"No layer matching given id found"* (CI, ubuntu, 2026-10-02, while the
 * first page was still rasterising). So the read is retried only when a NEWER tree has arrived since the one it
 * started from — that event is what makes the old ids stale — and a failure with no newer tree is thrown as itself.
 */
async function layers(page: Page, cdp: CDPSession): Promise<{ readonly layer: Layer; readonly reasons: string[] }[]> {
  let latest: { readonly tree: Layer[]; readonly generation: number } | undefined;
  let arrived: (() => void) | undefined;
  cdp.on('LayerTree.layerTreeDidChange', (event: { layers?: Layer[] }) => {
    if (event.layers === undefined || event.layers.length === 0) return;
    latest = { tree: event.layers, generation: (latest?.generation ?? 0) + 1 };
    arrived?.();
  });
  const first = new Promise<void>((settled) => {
    arrived = settled;
  });
  await cdp.send('LayerTree.enable');
  // A MOVE, so a frame is produced and the tree is reported.
  await page.mouse.move(400, 400);
  await page.mouse.move(420, 420);
  await first;
  for (;;) {
    const read = latest;
    if (read === undefined) throw new Error('no layer tree was reported');
    try {
      return await Promise.all(
        read.tree.map(async (layer) => {
          const answer = (await cdp.send('LayerTree.compositingReasons', { layerId: layer.layerId })) as {
            compositingReasonIds?: string[];
          };
          return { layer, reasons: answer.compositingReasonIds ?? [] };
        }),
      );
    } catch (error) {
      if (!String(error).includes('No layer matching given id found')) throw error;
      // THE TREE MOVED; its event may not have reached this side yet. Wait for it, bounded, and read the new tree —
      // never the same one again.
      if (latest?.generation === read.generation) {
        const next = new Promise<void>((settled) => {
          arrived = settled;
        });
        await Promise.race([next, page.waitForTimeout(2000)]);
      }
      if (latest?.generation === read.generation) throw error;
    }
  }
}

test('the grain is composited on its own layer, and still drawn over the whole window', async ({ page }) => {
  const viewport = { width: 1280, height: 800 };
  await page.setViewportSize(viewport);
  await bridge(page);
  await page.goto('/');
  await expect(page.locator('.m-title-bar')).toBeVisible();

  // STILL DRAWN: the noise image, blended over the ground. The layer is a speed property; this is the look.
  const grain = await page.evaluate(() => {
    const surface = document.querySelector('.m-document-surface');
    if (surface === null) return null;
    const style = getComputedStyle(surface, '::before');
    return { image: style.backgroundImage, blend: style.mixBlendMode, opacity: Number(style.opacity) };
  });
  // THE NOISE ITSELF, because the bundler inlines `grain.svg` as a data URL and its file name never reaches the page.
  expect(grain?.image).toContain('feTurbulence');
  expect(grain?.blend).toBe('overlay');
  expect(grain?.opacity ?? 0).toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  const found = await layers(page, cdp);

  // THE CONTROL: the read sees the viewport's own layer.
  expect(found.some(({ reasons }) => reasons.includes('Viewport'))).toBe(true);
  // THE CLAIM: a layer the size of the window, composited for its `will-change` — the grain's.
  const grainLayers = found.filter(
    ({ layer, reasons }) =>
      reasons.includes('WillChangeTransform') && layer.width === viewport.width && layer.height === viewport.height,
  );
  expect(grainLayers.length, JSON.stringify(found.map(({ layer, reasons }) => [layer.width, layer.height, reasons]))).toBe(1);
});

/**
 * The page list is a composited scroller: a layer the list's own size, composited for its `will-change`. Without it the
 * list scrolled on the main thread and repainted its area each frame (`app.css`, `.m-page-list`).
 */
test('the page list is composited on its own layer, so the compositor scrolls it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  const bytes = await document.save();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // GENEROUS, because this waits for a page to rasterise and is not a product bound (`pagePosition.pw.ts`).
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible({ timeout: 20_000 });

  const cdp = await page.context().newCDPSession(page);
  // THE LIST'S OWN NODE, by the id a layer names its owner with. A layer's bounds are not the element's box (measured
  // 2026-10-02: 575 × 558 against a 556 × 540 border box), so matching by size reports a present layer as absent.
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.m-page-list' });
  const { node } = await cdp.send('DOM.describeNode', { nodeId });
  const found = await layers(page, cdp);

  // THE CONTROL: the read sees the viewport's own layer.
  expect(found.some(({ reasons }) => reasons.includes('Viewport'))).toBe(true);
  // THE CLAIM: the page list owns a layer, composited for its `will-change`.
  const listLayers = found.filter(
    ({ layer, reasons }) => layer.backendNodeId === node.backendNodeId && reasons.includes('WillChangeTransform'),
  );
  expect(
    listLayers.length,
    JSON.stringify({ list: node.backendNodeId, layers: found.map(({ layer, reasons }) => [layer.backendNodeId, layer.width, layer.height, reasons]) }),
  ).toBe(1);
});
