import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A measurement changed in the browser (the owner's O8): a distance's END is a handle that moves that end alone, what is
 * drawn while it moves is the line and never a tinted box, and a measurement being drawn says what it measures.
 *
 * The kernel half — the saved line, the label worked out again, no fill — is `pageAnnotations.test.ts`. This holds the
 * browser's: the handles where the ends are once the CSS is applied, the press reaching the right one, and the command
 * that leaves for the document.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

/** A distance nearly flat, as a hand draws one, on the sample's 612 by 792 first page, in PDF space. */
const ENDS = [
  { x: 120, y: 650 },
  { x: 320, y: 651.5 },
];

async function openWithDistance(page: Page, sent: { channel: string; params: unknown }[]): Promise<{ x: number; y: number; scale: number }> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      annotations: [{ page: 0, index: 0, kind: 'measure-distance', rect: { x0: 110, y0: 640, x1: 330, y1: 665 }, contents: '2.8 in', points: ENDS }],
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  return { x: slot.x, y: slot.y, scale: slot.width / 612 };
}

test('a selected distance has a handle on each END; dragging one sends that end alone, and the drag shows the line, not a box', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  const slot = await openWithDistance(page, sent);
  const onScreen = (point: { x: number; y: number }) => ({ x: slot.x + point.x * slot.scale, y: slot.y + (792 - point.y) * slot.scale });
  const [left, right] = ENDS.map(onScreen);
  if (left === undefined || right === undefined) throw new Error('no ends');
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.mouse.click((left.x + right.x) / 2, (left.y + right.y) / 2);

  // THE HANDLES ARE ON THE ENDS, where the browser drew them, and the box has no corners.
  const handles = page.locator('[data-selection-index="0"] [data-selection-handle]');
  await expect(handles).toHaveCount(2);
  const end = await page.locator('[data-selection-handle="point-1"]').boundingBox();
  if (end === null) throw new Error('the end handle has no box');
  expect(Math.abs(end.x + end.width / 2 - right.x)).toBeLessThan(1.5);
  expect(Math.abs(end.y + end.height / 2 - right.y)).toBeLessThan(1.5);

  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  await page.mouse.move(right.x + 60, right.y + 30, { steps: 6 });
  // WHILE IT MOVES: the line's outline, unfilled, and no tinted box over it.
  await expect(page.locator('[data-annotation-preview-path]')).toHaveCount(1);
  await expect(page.locator('[data-annotation-preview="boxes"] rect')).toHaveCount(0);
  expect(await page.locator('[data-annotation-preview-path]').evaluate((element) => getComputedStyle(element).fill)).toBe('none');
  await page.mouse.up();

  const executed = (): unknown[] =>
    sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { readonly command: unknown }).command);
  await expect.poll(() => executed().length).toBe(1);
  const [command] = executed() as { kind: string; index: number; points?: { x: number; y: number }[] }[];
  expect(command?.kind).toBe('reshapeAnnotation');
  expect(command?.index).toBe(0);
  const points = command?.points;
  if (points === undefined) throw new Error('the end was not sent as points');
  // THE OTHER END DID NOT MOVE, and the dragged one went right by 60 pixels and down by 30, in points.
  expect(points[0]).toStrictEqual(ENDS[0]);
  expect(Math.abs((points[1]?.x ?? 0) - (320 + 60 / slot.scale))).toBeLessThan(1);
  expect(Math.abs((points[1]?.y ?? 0) - (651.5 - 30 / slot.scale))).toBeLessThan(1);
});

test('a distance being drawn says what it measures beside the pointer, before it is let go', async ({ page }) => {
  const slot = await openWithDistance(page, []);
  await page.getByRole('button', { name: 'Distance', exact: true }).first().click();
  const from = { x: slot.x + 100 * slot.scale, y: slot.y + 300 * slot.scale };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 72 points right, an inch on the page; the number and unit are whatever the scale setting makes of it.
  await page.mouse.move(from.x + 72 * slot.scale, from.y, { steps: 6 });
  const caption = page.locator('[data-annotation-caption]');
  await expect(caption).toBeVisible();
  expect(await caption.textContent()).toMatch(/^\d+\.\d [a-z]+$/u);
  // CONTROL: the reading follows the drag; a caption fixed at the press would not change.
  const first = await caption.textContent();
  await page.mouse.move(from.x + 144 * slot.scale, from.y, { steps: 6 });
  await expect(caption).not.toHaveText(first ?? '');
  await page.mouse.up();
});
