import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SELECT_TOOL, armTool } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A MOVED MEASUREMENT IS ON SCREEN ONCE, WITH ITS READING, AT EVERY FRAME (the owner's R17, 2026-10-20).
 *
 * An Area triangle moved with Select showed two triangles during the drag, lost its reading for most of it, and after
 * the release showed the old one again and then nothing before the saved one came back. Read here at every animation
 * frame, in the page, on pinned Chromium:
 *
 * - **the page's mark**: the stored appearance's pixels on the page canvas (a solid box, so it is read off the canvas);
 * - **the moving shape** and **the held shape**: the overlay's drag preview, and the shape it holds over the release;
 * - **the reading**: the overlay's caption.
 *
 * The shim answers a move with a new version of the SAME bytes, so the page drawn from it shows the mark where it was:
 * the case asserts what that can tell apart — never the page's mark together with a shape the overlay draws, and never
 * neither, before the release and after it.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');
const CORNERS = [
  { x: 200, y: 600 },
  { x: 380, y: 600 },
  { x: 380, y: 480 },
];

/** A page holding one area whose stored appearance is a solid black box, and that annotation's object number. */
async function areaWithLabel(): Promise<{ bytes: Uint8Array; object: number }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const label = pdf.context.register(pdf.context.stream('0 0 0 rg 0 0 60 24 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 60, 24] }));
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Polygon',
      Rect: [300, 540, 360, 564],
      Vertices: CORNERS.flatMap((corner) => [corner.x, corner.y]),
      IT: 'PolygonDimension',
      AP: { N: label },
    }),
  );
  page.node.set(PDFName.of('Annots'), pdf.context.obj([annotation]));
  return { bytes: await pdf.save(), object: annotation.objectNumber };
}

interface Frame {
  readonly t: number;
  readonly mark: boolean;
  readonly moving: number;
  readonly held: number;
  readonly caption: boolean;
}

/**
 * Starts reading every frame: the page's mark at `at`, in PDF space, and what the overlay draws. Answers once the FIRST
 * frame has been read, so the press that follows has a frame before it: a press is dispatched when it arrives, not at a
 * frame, and this browser runs frames as much as 250 ms apart while nothing animates (`markLook.pw.ts`, measured
 * 2026-10-21), so returning at once let a press land before any frame on main's push run of 7263803b (41155774608).
 */
async function sample(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.evaluate((point) => new Promise<void>((firstRead) => {
    const frames: Frame[] = [];
    const inputs: Record<string, number> = {};
    for (const kind of ['pointerdown', 'pointerup']) {
      window.addEventListener(
        kind,
        (event) => {
          inputs[kind] = event.timeStamp;
        },
        { capture: true },
      );
    }
    let running = true;
    const tick = (): void => {
      if (!running) return;
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.m-page');
      let mark = false;
      if (canvas !== null) {
        const box = canvas.getBoundingClientRect();
        const ratio = canvas.width / box.width;
        const scale = box.width / 612;
        const pixel = canvas
          .getContext('2d', { willReadFrequently: true })
          ?.getImageData(Math.round(point.x * scale * ratio), Math.round((792 - point.y) * scale * ratio), 1, 1).data;
        mark = pixel !== undefined && (pixel[0] ?? 255) < 80;
      }
      // THE DRAG'S MOVING SHAPE is the overlay's; THE HELD ONE is the page's look layer (ADR-0257), each read by its own name.
      const moving = document.querySelectorAll('[data-annotation-preview-path]').length;
      const held = document.querySelectorAll('[data-mark-looks] [data-mark-look="poly"]').length;
      const caption = document.querySelector('[data-annotation-caption], [data-mark-look="caption"]') !== null;
      frames.push({ t: performance.now(), mark, moving, held, caption });
      if (frames.length === 1) firstRead();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Reflect.set(window, 'r17Sampler', {
      stop: () => {
        running = false;
        return { frames, inputs };
      },
    });
  }), at);
}

async function stop(page: Page): Promise<{ frames: Frame[]; pressed: number; released: number }> {
  const { frames, inputs } = await page.evaluate(
    () => (Reflect.get(window, 'r17Sampler') as { stop: () => { frames: Frame[]; inputs: Record<string, number> } }).stop(),
  );
  return { frames, pressed: inputs['pointerdown'] ?? Number.NaN, released: inputs['pointerup'] ?? Number.NaN };
}

test('an area moved with Select is on screen once, with its reading, at every frame of the drag and after the release', async ({ page }) => {
  const { bytes, object } = await areaWithLabel();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Area.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    annotations: [
      {
        page: 0,
        index: 0,
        kind: 'measure-area',
        rect: { x0: 200, y0: 480, x1: 380, y1: 600 },
        contents: '0.21 sq in',
        points: CORNERS,
        measured: { kind: 'measure-area', scale: { perPoint: 1 / 72, unit: 'in' } },
        object,
      },
    ],
    settings: { 'appearance.ribbon-section': 'comment' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();

  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  const onScreen = (x: number, y: number) => ({ x: slot.x + x * scale, y: slot.y + (792 - y) * scale });
  const label = { x: 330, y: 552 };
  await armTool(page, 'Select', SELECT_TOOL);
  const grab = onScreen(340, 570);
  await page.mouse.click(grab.x, grab.y);
  await expect(page.locator('[data-selection-handle="point-2"]')).toBeVisible();

  await sample(page, label);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 120, grab.y + 90, { steps: 20 });
  await page.mouse.up();
  // UNTIL THE HELD SHAPE HAS GONE AND THE PAGE IS DRAWN FROM THE MOVE'S VERSION.
  await expect(page.locator('[data-mark-looks]')).toHaveCount(0);
  await page.waitForTimeout(300);
  const { frames, pressed, released } = await stop(page);

  const before = frames.filter((frame) => frame.t < pressed);
  const during = frames.filter((frame) => frame.t >= pressed && frame.t < released);
  const after = frames.filter((frame) => frame.t >= released);
  // THE CONTROLS: the page's mark was read before the press, the drag drew its moving shape, and the release held one —
  // without these, every assertion below would pass on frames that saw nothing.
  expect(before.length).toBeGreaterThan(0);
  expect(before.every((frame) => frame.mark)).toBe(true);
  expect(during.some((frame) => frame.moving > 0)).toBe(true);
  expect(after.some((frame) => frame.held > 0)).toBe(true);

  const on = (frame: Frame): number => (frame.mark ? 1 : 0) + frame.moving + frame.held;
  // EACH FAILING FRAME BY ITS TIME FROM THE RELEASE AND WHAT IT HELD, so a failure says which way it failed.
  const where = (list: readonly Frame[], failing: (frame: Frame) => boolean): string[] =>
    list
      .filter(failing)
      .map((frame) => `${String(Math.round(frame.t - released))} ms: mark ${String(frame.mark)}, moving ${String(frame.moving)}, held ${String(frame.held)}`);
  // ONCE, AND NEVER NOT AT ALL.
  expect(where(during, (frame) => on(frame) !== 1), 'frames of the drag with the mark twice or not at all').toStrictEqual([]);
  expect(where(after, (frame) => on(frame) !== 1), 'frames after the release with the mark twice or not at all').toStrictEqual([]);
  // AND ITS READING: on the moving shape while it moves, which the page's own drawing carries otherwise.
  expect(where(during, (frame) => frame.moving > 0 && !frame.caption), 'frames of the drag with the moving shape and no reading').toStrictEqual([]);
});
