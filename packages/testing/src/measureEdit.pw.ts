import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SELECT_TOOL, armTool, samplePdf } from './helpScreensHarness.js';
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
  await armTool(page, 'Select', SELECT_TOOL);
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

/**
 * A page holding one distance whose stored appearance is a solid black label box, so the label's pixels can be read off
 * the page canvas: the object the drag is meant to leave out. Answers the bytes and the annotation's object number.
 */
async function distanceWithLabel(): Promise<{ bytes: Uint8Array; object: number }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const label = pdf.context.register(
    pdf.context.stream('0 0 0 rg 0 0 120 30 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 30] }),
  );
  const annotation = pdf.context.register(
    pdf.context.obj({ Type: 'Annot', Subtype: 'Line', Rect: [200, 500, 320, 530], L: [200, 515, 320, 515], IT: 'LineDimension', AP: { N: label } }),
  );
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  return { bytes: await pdf.save(), object: annotation.objectNumber };
}

/** Whether the page canvas is dark at a point in PDF space, read from its own pixels. */
async function inkAt(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return page.locator('canvas.m-page').first().evaluate((canvas: HTMLCanvasElement, at) => {
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / box.width;
    const scale = box.width / 612;
    const pixel = canvas
      .getContext('2d', { willReadFrequently: true })
      ?.getImageData(Math.round(at.x * scale * ratio), Math.round((792 - at.y) * scale * ratio), 1, 1).data;
    return pixel !== undefined && (pixel[0] ?? 255) < 80;
  }, point);
}

for (const named of [true, false]) {
  test(`while a distance's end is dragged the page is drawn ${named ? 'WITHOUT its stored label' : 'with it when the listing names no object (CONTROL)'}`, async ({
    page,
  }) => {
    // THE OWNER'S B1 LEFTOVER: the stored appearance carried the old reading beside the live caption until release.
    const { bytes, object } = await distanceWithLabel();
    const ends = [
      { x: 200, y: 515 },
      { x: 320, y: 515 },
    ];
    await page.setViewportSize({ width: 1280, height: 860 });
    await bridgeUnder(page, LOOKS[0], {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Label.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      annotations: [
        {
          page: 0,
          index: 0,
          kind: 'measure-distance',
          rect: { x0: 200, y0: 500, x1: 320, y1: 530 },
          contents: '1.7 in',
          points: ends,
          measured: { kind: 'measure-distance', scale: { perPoint: 1 / 72, unit: 'in' } },
          ...(named ? { object } : {}),
        },
      ],
      settings: { 'appearance.ribbon-section': 'comment' },
    });
    await page.goto('/');
    await page.getByRole('button', { name: /^Open PDF/u }).first().click();
    await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
    const label = { x: 260, y: 525 };
    // THE POSITIVE CONTROL: the label is drawn before anything is pressed, so its absence below is the drag's doing.
    await expect.poll(() => inkAt(page, label)).toBe(true);

    const slot = await page.locator('.m-page-slot').first().boundingBox();
    if (slot === null) throw new Error('the first page has no box');
    const scale = slot.width / 612;
    const right = { x: slot.x + 320 * scale, y: slot.y + (792 - 515) * scale };
    await armTool(page, 'Select', SELECT_TOOL);
    await page.mouse.click(slot.x + 260 * scale, right.y);
    await expect(page.locator('[data-selection-handle="point-1"]')).toBeVisible();
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await page.mouse.move(right.x + 60, right.y + 30, { steps: 6 });
    await expect(page.locator('[data-annotation-caption]')).toBeVisible();
    if (named) {
      await expect.poll(() => inkAt(page, label)).toBe(false);
    } else {
      // THE CONTROL HOLDS ITS GROUND for a moment a redraw would have taken, rather than passing on the first read.
      await page.waitForTimeout(500);
      expect(await inkAt(page, label)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
}
