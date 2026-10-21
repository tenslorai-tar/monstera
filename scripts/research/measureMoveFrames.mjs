// @ts-check
/**
 * What a moved measurement shows, FRAME BY FRAME, in the running app (the owner's R17, 2026-10-20: an Area triangle
 * moved with Select showed two triangles at once during the drag, its reading missing on some frames, and after the
 * release an empty outline before the reading came back).
 *
 *   node scripts/research/measureMoveFrames.mjs [--kind area|perimeter|distance]
 *
 * ## What each frame records
 *
 * Read at every animation frame from before the press until two seconds after the release:
 *
 * - **old** and **new**: whether the PAGE's own pixels (its canvas and tiles, never an overlay) carry ink on the
 *   shape's outline where it was and where the move puts it — a few points along each edge, each a small window, read
 *   only where the two outlines do not cross;
 * - **preview**, **held** and **caption**: the overlay's moving shape, the shape it holds over a release, and the live
 *   reading's text;
 * - **readingOld** and **readingNew**: ink on the page where the saved reading sits, at the old and the new middle.
 *
 * So *shapes on screen* is old + new + preview + held, and *a reading on screen* is caption or readingOld or
 * readingNew. The record is every frame where either changes; the summary counts frames with two shapes or none, and
 * frames with no reading.
 *
 * ## Its controls, on every run
 *
 * Before anything moves, the page must show the saved shape where it was drawn (old ink, no new ink) and its reading;
 * after the move settles, the new and no old. An instrument that read no ink anywhere would otherwise report every
 * frame as having no shape, and one that read ink everywhere would report two.
 *
 * Our own one-page document, never a person's.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { startWalk } from './liveWalk.mjs';

const argv = process.argv.slice(2);
const kindAt = argv.indexOf('--kind');
const KIND = kindAt === -1 ? 'area' : String(argv[kindAt + 1]);
const COMMANDS = /** @type {Record<string, string>} */ ({ area: 'Measure area', perimeter: 'Measure perimeter', distance: 'Measure distance' });
const command_ = COMMANDS[KIND];
if (command_ === undefined) throw new Error(`--kind is one of ${Object.keys(COMMANDS).join(', ')}`);

const walk = await startWalk(`measureMoveFrames-${KIND}`);
const { page, output, open, command, step, finish } = walk;

const plan = join(output, 'input-plan.pdf');
const made = await PDFDocument.create();
const font = await made.embedFont(StandardFonts.Helvetica);
made.addPage([612, 792]).drawText('Plan: measure the room below.', { x: 72, y: 720, size: 20, font });
await writeFile(plan, await made.save());

/** Page 1's slot in window pixels, and points to pixels. */
async function slot() {
  const box = await page.locator('.m-page-slot:visible').first().boundingBox();
  if (box === null) throw new Error('page 1 has no box on screen');
  const scale = box.width / 612;
  /** @param {{ x: number; y: number }} point */
  const at = (point) => ({ x: box.x + point.x * scale, y: box.y + (792 - point.y) * scale });
  return { ...box, scale, at };
}

/** The corners in page points, the move in page points. */
const CORNERS = KIND === 'distance' ? [{ x: 150, y: 560 }, { x: 330, y: 620 }] : [{ x: 150, y: 620 }, { x: 330, y: 620 }, { x: 330, y: 520 }];
const MOVE = { x: 120, y: -150 };

/** Points along each edge, a third and two thirds of the way, in page points. @param {{ x: number; y: number }[]} corners */
function edgePoints(corners) {
  // AN AREA CLOSES BACK ON ITS FIRST CORNER; a distance and a perimeter stay open, one edge fewer than their corners.
  const starts = KIND === 'area' ? corners : corners.slice(0, -1);
  return starts.flatMap((corner, at) => {
    const next = corners[(at + 1) % corners.length] ?? corner;
    return [1 / 3, 2 / 3].map((t) => ({ x: corner.x + (next.x - corner.x) * t, y: corner.y + (next.y - corner.y) * t }));
  });
}

/** The middle a reading sits at, in page points. @param {{ x: number; y: number }[]} corners */
function middleOf(corners) {
  return { x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length, y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length };
}

await step(`R17: an ${KIND} measurement moved whole, read at every frame`, async () => {
  await open(plan);
  await command(command_);
  const page1 = await slot();
  const drawn = CORNERS.map((corner) => page1.at(corner));
  const [startCorner, nextCorner] = drawn;
  if (startCorner === undefined || nextCorner === undefined) throw new Error('no corners');
  if (KIND === 'distance') {
    // A DISTANCE IS DRAWN BY A DRAG, from one end to the other.
    await page.mouse.move(startCorner.x, startCorner.y);
    await page.mouse.down();
    await page.mouse.move(nextCorner.x, nextCorner.y, { steps: 12 });
    await page.mouse.up();
  } else {
    for (const corner of drawn) await page.mouse.click(corner.x, corner.y);
    // AN AREA CLOSES on its first corner; a perimeter, which stays open, ends with Enter.
    if (KIND === 'area') await page.mouse.click(startCorner.x, startCorner.y);
    else await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  // PICKED WHERE A PRESS FINDS IT: an area inside its fill, a line or a perimeter on its first edge.
  const [c0, c1] = CORNERS;
  if (c0 === undefined || c1 === undefined) throw new Error('no corners');
  const grabAt = KIND === 'area' ? { x: 280, y: 590 } : { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 };
  const grab = page1.at(grabAt);
  await page.mouse.click(grab.x, grab.y);
  await expect(page.locator('[data-selection-handle^="point-"]').first()).toBeAttached();
  // THE SAVED MARK IS ON THE PAGE before anything is read: a drawn shape lands after its write.
  await page.waitForTimeout(1500);

  const moved = CORNERS.map((corner) => ({ x: corner.x + MOVE.x, y: corner.y + MOVE.y }));
  const probes = {
    old: edgePoints(CORNERS).map((point) => page1.at(point)),
    new: edgePoints(moved).map((point) => page1.at(point)),
    // THE SAVED READING ON THE PAGE is read for an area alone, where it sits inside the shape away from every edge. On a
    // line or a perimeter it sits on the line, where a probe cannot tell the words from the stroke.
    readingOld: KIND === 'area' ? [page1.at(middleOf(CORNERS))] : [],
    readingNew: KIND === 'area' ? [page1.at(middleOf(moved))] : [],
    half: Math.max(3, Math.round(3 * page1.scale)),
  };

  await page.evaluate((probe) => {
    // THE PAGE'S OBJECTS by name and by the shapes used here: this file is type-checked as Node, with no DOM library.
    /** @typedef {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} Box */
    /** @typedef {{ getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }} Pen */
    /** @typedef {{ width: number, height: number, getBoundingClientRect: () => Box, getContext: (kind: '2d', options: { willReadFrequently: boolean }) => Pen | null }} Surface */
    const document = /** @type {{ querySelectorAll: (selector: string) => Iterable<Surface> & { length: number }, querySelector: (selector: string) => { textContent: string | null } | null }} */ (Reflect.get(globalThis, 'document'));
    const nextFrame = /** @type {(callback: () => void) => number} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    /** Ink in a window around a point on the page's own canvases: anything well away from white. @param {{ x: number, y: number }} point */
    const inked = (point) => {
      for (const canvas of document.querySelectorAll('canvas.m-page, canvas.m-page-tile')) {
        const box = canvas.getBoundingClientRect();
        if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom || box.width === 0) continue;
        const sx = canvas.width / box.width;
        const sy = canvas.height / box.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) continue;
        const size = Math.max(1, Math.round(probe.half * 2 * sx));
        const data = context.getImageData(Math.floor((point.x - box.left) * sx - size / 2), Math.floor((point.y - box.top) * sy - size / 2), size, size).data;
        for (let at = 0; at < data.length; at += 4) if (Math.min(data[at] ?? 255, data[at + 1] ?? 255, data[at + 2] ?? 255) < 200) return true;
      }
      return false;
    };
    const share = (/** @type {{ x: number, y: number }[]} */ points) => (points.length === 0 ? 0 : points.filter(inked).length / points.length);
    /** @type {Record<string, unknown>[]} */
    const frames = [];
    /** The press and the release on the page's own clock. @type {Record<string, number>} */
    const inputs = {};
    const view = /** @type {{ addEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void }} */ (Reflect.get(globalThis, 'window'));
    for (const kind of ['pointerdown', 'pointerup']) {
      view.addEventListener(kind, (event) => {
        inputs[kind] = event.timeStamp;
      }, { capture: true });
    }
    let running = true;
    const tick = () => {
      if (!running) return;
      // THE READING ON THE DRAG'S SHAPE, or on the held look after the release (ADR-0257).
      const caption = document.querySelector('[data-annotation-caption], [data-mark-look="caption"] text');
      frames.push({
        t: performance.now(),
        old: share(probe.old),
        new: share(probe.new),
        // THE DRAG'S MOVING SHAPE is the overlay's; THE HELD LOOK is the page's look layer (ADR-0257).
        preview: document.querySelectorAll('[data-annotation-preview-path]').length,
        held: document.querySelectorAll('[data-mark-looks]').length,
        caption: caption === null ? '' : String(caption.textContent ?? ''),
        readingOld: share(probe.readingOld),
        readingNew: share(probe.readingNew),
      });
      nextFrame(tick);
    };
    nextFrame(tick);
    Reflect.set(globalThis, 'moveSampler', {
      stop: () => {
        running = false;
        return { frames, inputs };
      },
    });
  }, probes);

  await page.waitForTimeout(150);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  const to = page1.at({ x: grabAt.x + MOVE.x, y: grabAt.y + MOVE.y });
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  /** @typedef {{ t: number, old: number, new: number, preview: number, held: number, caption: string, readingOld: number, readingNew: number }} Frame */
  const { frames, inputs } = /** @type {{ frames: Frame[], inputs: Record<string, number> }} */ (
    await page.evaluate(() => /** @type {{ stop: () => unknown }} */ (Reflect.get(globalThis, 'moveSampler')).stop())
  );

  // THE CONTROLS: the first frame shows the shape where it was and not where it goes; the last, the reverse.
  const [first] = frames;
  const last = frames[frames.length - 1];
  if (first === undefined || last === undefined) throw new Error('no frames were read');
  const controls = {
    before: { old: first.old, new: first.new, reading: first.readingOld },
    after: { old: last.old, new: last.new, reading: last.readingNew },
  };
  // AND FOR AN AREA, its reading where it was before and where it went after, or a frame with no reading is unreadable.
  const readingSeen = KIND !== 'area' || (first.readingOld > 0 && first.readingNew === 0 && last.readingNew > 0 && last.readingOld === 0);
  if (!(first.old >= 0.5 && first.new === 0 && last.new >= 0.5 && last.old === 0 && readingSeen)) {
    return { REFUSING: 'the controls did not read the shape where it was before and where it went after', controls };
  }

  const shapes = (/** @type {Frame} */ frame) => (frame.old > 0 ? 1 : 0) + (frame.new > 0 ? 1 : 0) + frame.preview + frame.held;
  const reading = (/** @type {Frame} */ frame) => frame.caption !== '' || frame.readingOld > 0 || frame.readingNew > 0;
  const pressed = inputs['pointerdown'] ?? Number.NaN;
  const released = inputs['pointerup'] ?? Number.NaN;
  const phase = (/** @type {Frame} */ frame) => (frame.t < pressed ? 'before' : frame.t < released ? 'during' : 'after');
  const changes = frames.filter((frame, at) => {
    const previous = frames[at - 1];
    return previous === undefined || shapes(previous) !== shapes(frame) || reading(previous) !== reading(frame) || previous.old !== frame.old || previous.new !== frame.new || phase(previous) !== phase(frame);
  });
  /** Frames of a phase that fail a test. @param {'during' | 'after'} which @param {(frame: Frame) => boolean} failing */
  const count = (which, failing) => frames.filter((frame) => phase(frame) === which && failing(frame)).length;
  return {
    frames: { during: frames.filter((frame) => phase(frame) === 'during').length, after: frames.filter((frame) => phase(frame) === 'after').length },
    controls,
    during: { twoOrMoreShapes: count('during', (frame) => shapes(frame) >= 2), noShape: count('during', (frame) => shapes(frame) === 0), noReading: KIND === 'area' ? count('during', (frame) => !reading(frame)) : 'not read for this kind' },
    after: { twoOrMoreShapes: count('after', (frame) => shapes(frame) >= 2), noShape: count('after', (frame) => shapes(frame) === 0), noReading: KIND === 'area' ? count('after', (frame) => !reading(frame)) : 'not read for this kind' },
    timeline: changes.map((frame) => ({
      ms: Math.round(frame.t - released),
      phase: phase(frame),
      shapes: shapes(frame),
      parts: `old ${frame.old.toFixed(2)} new ${frame.new.toFixed(2)} preview ${String(frame.preview)} held ${String(frame.held)}`,
      reading: reading(frame) ? (frame.caption === '' ? `on the page (old ${frame.readingOld.toFixed(0)}, new ${frame.readingNew.toFixed(0)})` : 'overlay') : 'NONE',
    })),
  };
});

await finish();
