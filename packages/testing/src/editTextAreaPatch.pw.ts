import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * After a write, the editor lets go when the edited AREA is drawn at the new version, never waiting for the page's own
 * redraw ([ADR-0271](../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3,
 * Finishing; `AreaPatch.tsx`).
 *
 * The shim holds every view-model read for {@link MODEL_MS}, and a page does not draw a version until its view model
 * answers, so for that long after the write the page's own pixels are the old version's. The view itself, which the area
 * is drawn from, is not held. So an editor that waits for the page lets go after {@link MODEL_MS}, and one that waits for
 * its area lets go well inside it: the case separates the two by time, with the page's own redraw as the control.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000db');
const MODEL_MS = 4000;
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const BOX = { x0: 100, y0: 686, x1: 400, y1: 700 };

test('a written editor lets go when its area is drawn at the new version, long before the page redraws', async ({ page }) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('The first paragraph', { x: 100, y: 690, size: 12, font });
  const bytes = await document.save();
  const sent: string[] = [];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'One.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [{ box: BOX, lines: [{ runs: [{ index: 3, text: 'The first paragraph', style: RUN }], box: BOX, soft: false, baseline: 690 }], style: RUN, shape: { align: 'left' as const, firstIndent: 0 } }],
      delays: { 'document.viewModel': MODEL_MS },
    },
    (channel, params) => {
      if (channel === 'document.execute') sent.push(JSON.stringify(params));
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await runCommand(page, 'Edit text on the page');
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  await page.keyboard.type(' grows');

  const frame = page.locator('[data-text-edit-layer="0"] [data-kit-frame]');
  const patch = page.locator('[data-text-edit-layer="0"] [data-kit-patch="drawn"]');
  const before = await frame.boundingBox();
  if (before === null) throw new Error('no frame before finishing');
  const pressed = Date.now();
  await page.keyboard.press('Escape');
  await expect.poll(() => sent.length).toBe(1);
  // THE DECISION: the area is drawn and the editor gone while the page's own redraw is still held.
  await expect(patch).toBeVisible({ timeout: MODEL_MS });
  await expect(frame).toHaveCount(0);
  const letGo = Date.now() - pressed;
  expect(letGo).toBeLessThan(MODEL_MS / 2);
  // THE PATCH COVERS THE EDITOR AS IT STOOD: over the words, not beside them, so no old word shows past its edge.
  const drawn = await patch.boundingBox();
  if (drawn === null) throw new Error('no patch box');
  expect(drawn.x).toBeLessThanOrEqual(before.x);
  expect(drawn.y).toBeLessThanOrEqual(before.y);
  expect(drawn.x + drawn.width).toBeGreaterThanOrEqual(before.x + before.width);
  expect(drawn.y + drawn.height).toBeGreaterThanOrEqual(before.y + before.height);
  // CONTROL: once the page draws the new version itself, the patch goes, since the page then shows the same pixels.
  await expect(page.locator('[data-text-edit-layer="0"] [data-kit-patch]')).toHaveCount(0, { timeout: MODEL_MS * 3 });
  process.stdout.write(`\nfinish to area shown: ${String(letGo)} ms (page redraw held ${String(MODEL_MS)} ms)\n`);
});
