import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * Dragging a panel edge adds no stylesheet to the document, in a real browser.
 *
 * `@zag-js/splitter` writes `* { cursor: … !important }` into the head on every pointer move of a drag, a
 * whole-document style recalculation per move — 3,398 ms of a 9.4 s drag, measured 2026-10-01 — for a sheet the
 * renderer's CSP refuses to draw. `splitterMachine.ts` empties the two actions that write it. happy-dom cannot carry
 * this case: it lays nothing out, and the machine's move fails before it reaches the cursor action, for the stock
 * machine too.
 *
 * THE CONTROL is the drag moving the edge: the machine processed the moves, and `setGlobalCursor` is the action it runs
 * right after the one that moved it. Measured against the stock machine: the sheet appears on the first move.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f7');

async function onePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

test('a panel-edge drag moves the edge and adds no cursor stylesheet', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await onePage();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'one.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // GENEROUS, because this waits for a page to rasterise and is not a product bound (`pagePosition.pw.ts`).
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible({ timeout: 20_000 });

  // EVERY NODE THE HEAD GAINS, from before the press: a sheet added and removed inside the drag still counts.
  await page.evaluate(() => {
    const seen: string[] = [];
    (globalThis as unknown as { __headAdded: string[] }).__headAdded = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) seen.push(`${node.tagName.toLowerCase()}#${node.id}`);
      }
    }).observe(document.head, { childList: true });
  });

  const handle = page.getByRole('separator', { name: 'Resize the document panel' });
  const before = await handle.boundingBox();
  if (before === null) throw new Error('the document panel’s edge is not on screen');
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(x + step * 6, y);
  await page.mouse.up();

  // THE CONTROL: the edge moved, so the machine ran its moves.
  const after = await handle.boundingBox();
  expect((after?.x ?? before.x) - before.x).toBeGreaterThan(40);
  // AND THE HEAD GAINED NO CURSOR SHEET.
  const added = await page.evaluate(() => (globalThis as unknown as { __headAdded: string[] }).__headAdded);
  expect(added.filter((entry) => entry.includes('splitter'))).toEqual([]);
});
