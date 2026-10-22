import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { SELECT_TOOL, armTool, samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Select pressed on a mark drawn a moment ago, while the drawing's command is still held by main.
 *
 * The press asks main for the document's marks. Main answers that read in the document's lane, after the command, so the
 * answer holds the new mark. A read taken from the renderer's cache at the version ON SHOW answers the document from
 * before the command, and the press finds nothing: the measure and comments walks, 2026-10-22, failing on a distance
 * and a link just drawn. The shim holds the command and models the lane; the mark is in its listing from version 2.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');
const HELD_MS = 2500;

/** A distance on the sample's 612 by 792 first page, in PDF space: what the drag below draws and what main then lists. */
const ENDS = [
  { x: 120, y: 650 },
  { x: 320, y: 650 },
];

test('Select pressed on a distance whose command main still holds selects it', async ({ page }) => {
  const sent: { channel: string; at: number }[] = [];
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      annotations: [{ page: 0, index: 0, kind: 'measure-distance', rect: { x0: 110, y0: 640, x1: 330, y1: 660 }, contents: '2.8 in', points: ENDS }],
      annotationsFrom: 2,
      delays: { 'document.execute': HELD_MS },
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel) => {
      sent.push({ channel, at: Date.now() });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  const [left, right] = ENDS.map((point) => ({ x: slot.x + point.x * scale, y: slot.y + (792 - point.y) * scale }));
  if (left === undefined || right === undefined) throw new Error('no ends');

  await page.getByRole('button', { name: 'Distance', exact: true }).first().click();
  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  await page.mouse.move(right.x, right.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => sent.some((call) => call.channel === 'document.execute')).toBe(true);
  const held = sent.find((call) => call.channel === 'document.execute')?.at ?? 0;

  await armTool(page, 'Select', SELECT_TOOL);
  await page.mouse.click((left.x + right.x) / 2, (left.y + right.y) / 2);
  const pressed = Date.now();
  // THE PRESS LANDED WHILE THE COMMAND WAS HELD, or this case is the easy shape: after the answer, a read at the version
  // on show already holds the mark, and the cached read this case exists to refuse would pass.
  expect(pressed - held).toBeLessThan(HELD_MS);

  await expect(page.locator('[data-selection-index="0"] [data-selection-handle]')).toHaveCount(2, { timeout: HELD_MS + 5000 });
});
