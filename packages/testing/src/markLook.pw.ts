import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * EVERY COMMENT MARK IS ON SCREEN IN ITS FINAL LOOK FROM ITS RELEASE UNTIL THE PAGE DRAWS IT
 * ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md), the
 * owner's answer to R19).
 *
 * Each tool draws one mark on a blank page, and every animation frame from before the finishing input until the page has
 * been drawn from the command's version is read in the page: whether a held look is on screen and which parts it has, and
 * whether the overlay's ACCENT PLACEHOLDER (`.m-annotation-preview`) is. The tool's own look must be on screen within
 * 150 ms of the finishing input, and no frame after it may show neither or the placeholder.
 *
 * The shim answers a command with a new version of the SAME bytes, so the page drawn from it does not show the mark: the
 * case asserts the look up to the frame the page presents that version, which is the holder's handover. That the saved
 * mark is on the page at the handover is the live instrument's to read (`markLatencyWalk.mjs`), on the real engine.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

interface Frame {
  readonly t: number;
  readonly looks: readonly string[];
  readonly placeholder: boolean;
}

async function blankPage(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

async function open(page: Page): Promise<void> {
  const bytes = await blankPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Blank.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    settings: { 'appearance.ribbon-section': 'comment', 'appearance.status-tips': false },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

/** A point of the first page, in PDF points, on screen now. */
async function onScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  return { x: slot.x + x * scale, y: slot.y + (792 - y) * scale };
}

async function sample(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    const inputs: number[] = [];
    // THE INPUT AS DISPATCHED, not as created: `event.timeStamp` is when the browser made the event, and a frame may run
    // between that and its dispatch, before the page could have answered it.
    for (const kind of ['pointerup', 'keydown']) {
      window.addEventListener(
        kind,
        () => {
          inputs.push(performance.now());
        },
        { capture: true },
      );
    }
    // WHEN THE LOOK ENTERS THE PAGE, timed by the mutation itself: a frame's time is the browser's to choose, and this
    // browser runs frames irregularly while nothing on the page animates (frames 250 ms apart before a release, no task
    // long enough to explain them, measured 2026-10-21) — so the app's part is when the look is there to be painted.
    const inserted: number[] = [];
    new MutationObserver(() => {
      if (inserted.length === 0 && document.querySelector('[data-mark-looks] [data-mark-look]') !== null) inserted.push(performance.now());
    }).observe(document.body, { childList: true, subtree: true });
    Reflect.set(window, 'lookInserted', inserted);
    let running = true;
    const tick = (): void => {
      if (!running) return;
      frames.push({
        t: performance.now(),
        looks: [...document.querySelectorAll('[data-mark-looks] [data-mark-look]')].map((element) => element.getAttribute('data-mark-look') ?? ''),
        placeholder: document.querySelector('.m-annotation-overlay .m-annotation-preview') !== null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Reflect.set(window, 'lookSampler', {
      stop: () => {
        running = false;
        return { frames, inputs };
      },
    });
  });
}

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number], steps = 8): Promise<void> {
  const a = await onScreen(page, from[0], from[1]);
  const b = await onScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function clicks(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  for (const [x, y] of points) {
    const at = await onScreen(page, x, y);
    await page.mouse.click(at.x, at.y);
  }
}

const TRIANGLE = [
  [150, 620],
  [330, 620],
  [330, 520],
] as const;

/** Every tool the overlay serves, how it draws one mark, and the part its look must have. */
const TOOLS: readonly { readonly title: string; readonly draw: (page: Page) => Promise<void>; readonly part: string }[] = [
  { title: 'Rectangle', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'outline' },
  { title: 'Ellipse', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'outline' },
  { title: 'Line', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'poly' },
  { title: 'Arrow', draw: (page) => drag(page, [150, 600], [330, 500]), part: 'poly' },
  { title: 'Freehand', draw: (page) => drag(page, [150, 600], [330, 500], 20), part: 'poly' },
  { title: 'Polygon', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'poly' },
  { title: 'Cloud', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'poly' },
  {
    title: 'Connected lines',
    draw: async (page) => {
      await clicks(page, TRIANGLE);
      await page.keyboard.press('Enter');
    },
    part: 'poly',
  },
  { title: 'Measure distance', draw: (page) => drag(page, [150, 600], [330, 520]), part: 'caption' },
  { title: 'Measure area', draw: (page) => clicks(page, [...TRIANGLE, TRIANGLE[0]]), part: 'caption' },
  {
    title: 'Measure perimeter',
    draw: async (page) => {
      await clicks(page, TRIANGLE);
      await page.keyboard.press('Enter');
    },
    part: 'caption',
  },
  { title: 'Highlight an area of the page', draw: (page) => drag(page, [150, 600], [330, 560]), part: 'fill' },
  { title: 'Mark an area for redaction', draw: (page) => drag(page, [150, 600], [330, 560]), part: 'redact' },
];

for (const tool of TOOLS) {
  test(`${tool.title}: its final look from the release until the page draws it, never the placeholder or nothing`, async ({ page }) => {
    await open(page);
    await runCommand(page, tool.title);
    await sample(page);
    await tool.draw(page);
    // UNTIL THE PAGE HAS BEEN DRAWN FROM THE COMMAND'S VERSION, which is when the holder lets the look go.
    await expect(page.locator('[data-mark-looks]')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(100);
    const { frames, inputs } = await page.evaluate(
      () => (Reflect.get(window, 'lookSampler') as { stop: () => { frames: Frame[]; inputs: number[] } }).stop(),
    );
    const [insertedAt] = await page.evaluate(() => Reflect.get(window, 'lookInserted') as number[]);
    const finished = inputs.at(-1) ?? Number.NaN;
    const after = frames.filter((frame) => frame.t >= finished);
    const first = after.findIndex((frame) => frame.looks.length > 0);
    // THE CONTROL: a look WAS held, and it was this tool's — a run that held nothing would pass every rule below.
    expect(first, 'no frame after the release showed a held look').toBeGreaterThanOrEqual(0);
    const shown = after[first];
    expect(shown?.looks).toContain(tool.part);
    // IN THE PAGE WITHIN 150 MS of the finishing input, timed when it was inserted.
    expect(insertedAt, 'the look was never inserted').toBeDefined();
    expect(Math.round((insertedAt ?? Number.NaN) - finished), 'ms from the release to the look in the page').toBeLessThanOrEqual(150);
    // AND IN THE VERY FIRST FRAME AFTER THE RELEASE: no frame the browser ran passed without it.
    expect(first, 'frames after the release that ran before the look').toBe(0);
    // AND FROM THEN UNTIL THE HANDOVER, never the accent placeholder and never nothing.
    const last = after.findLastIndex((frame) => frame.looks.length > 0);
    const held = after.slice(first, last + 1);
    expect(held.filter((frame) => frame.placeholder).map((frame) => Math.round(frame.t - finished)), 'frames with the placeholder').toStrictEqual([]);
    expect(held.filter((frame) => frame.looks.length === 0).map((frame) => Math.round(frame.t - finished)), 'frames with nothing').toStrictEqual([]);
    expect(after.slice(0, first).filter((frame) => frame.placeholder), 'the placeholder before the look').toStrictEqual([]);
  });
}
