// @ts-check
/**
 * How long a tool's result takes to be drawn AS IT REALLY LOOKS, from the release (or the key that finishes it) to the
 * last change on screen: the owner's R19 of 2026-10-20, "every tool's result takes a moment to appear" in 0.1.17.0.
 *
 *   node scripts/research/markLatencyWalk.mjs [--app-root <checkout> | --executable <Monstera.exe>] [--runs <n>]
 *     [--only <name,...>]
 *
 * `--app-root` launches another checkout's built app (a worktree at 0.1.16.0, or a bisect step); `--executable` a
 * packaged app unpacked from its MSIX and run where it lies, never installed. One instrument measures every build, so
 * no second opinion about the steps exists. Each run of a tool is undone before the next, so every run starts on the
 * same page.
 *
 * ## What is measured, and how
 *
 * The page is sampled at every animation frame from before the action until `WINDOW_MS` after its last input, and each
 * frame is fingerprinted where it is drawn: the pixels of every canvas over the result's region (the page and its
 * tiles, where a saved mark appears) and the elements on a grid of points in it (where a placeholder lives). Times run
 * from the last input's own timestamp, on the page's clock. Two are read off the sequence:
 *
 * - **first change**: the first frame that differs from the one before the action — usually a placeholder;
 * - **final**: the first frame from which every later one equals the last — the result as it really looks.
 *
 * What is drawn, not a DOM signal, because the owner's complaint is what is SEEN: a pale box that is in the DOM at once
 * and a page drawn with the real mark later are two different screens at the same DOM state.
 *
 * Measured on 2026-10-20/21 and kept in the comments where each was found: photographs taken on demand came 111-250 ms
 * apart, and Electron's frame subscription and Chromium's screencast each heard ONE frame while the page painted at 60
 * a second, which is why the sampler lives in the page.
 *
 * ## The instrument proves its resolution first (CLAUDE.md item 4a)
 *
 * Before any tool, an element appears `CONTROL_MS` and a canvas is drawn `CANVAS_MS` after a key the page hears, inside
 * a sampled region, and the walk refuses to measure anything unless it reads each within 30 ms — two frames at 60 Hz.
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { startWalk, writesIdle } from './liveWalk.mjs';

const WINDOW_MS = 3000;
const CONTROL_MS = 300;

const argv = process.argv.slice(2);
/** @param {string} name */
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const appRoot = option('--app-root');
const runs = Number(option('--runs') ?? '5');
const only = option('--only')?.split(',');
/** `--changes`: every run's change list printed, each change as its time, the part of the region and its new reading. */
const showChanges = argv.includes('--changes');
/** @param {string} name */
const wanted = (name) => only === undefined || only.includes(name);

/** Five Letter pages of lines in Helvetica, and a text field on the first: the owner's five-page shape, built here. */
async function fixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 5; index += 1) {
    const page = document.addPage([612, 792]);
    for (let line = 0; line < 8; line += 1) {
      page.drawText(`Page ${String(index + 1)}, line ${String(line + 1)}: the quick brown fox jumps over the lazy dog.`, { x: 72, y: 700 - line * 30, size: 14, font });
    }
  }
  const form = document.getForm();
  const field = form.createTextField('Name');
  field.addToPage(document.getPage(0), { x: 72, y: 150, width: 240, height: 24 });
  return document.save();
}

// A WINDOW THAT PAINTS WHILE COVERED: Chromium on Windows stops drawing a window it computes as occluded, and the walk's
// window sits behind whatever the person is working in, so a frame subscription heard one frame and no other (trial,
// 2026-10-20). A person's own window is in front; these two switches make the walk's paint as theirs does.
const switches = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
const executable = option('--executable');
const walk = await startWalk(
  'markLatency',
  executable !== undefined ? { executable: resolve(executable), switches } : appRoot === undefined ? { switches } : { appRoot: resolve(appRoot), switches },
);
const { page, output, command, section, step, finish } = walk;

const path = join(output, 'five-pages.pdf');
await writeFile(path, await fixture());
await walk.open(path);

/**
 * The first page's drawing on screen, and points-to-pixels. THE MAIN VIEW'S CANVAS, which `open` waits for: a page
 * slot is also what the Pages panel's thumbnails are, and the first visible one was a thumbnail (the trial run of
 * 2026-10-20, every press landing in a 97-pixel picture).
 */
async function slot() {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the first page has no box');
  if (box.width < 300) throw new Error(`the first page is drawn ${String(Math.round(box.width))} px wide: that is not the main view`);
  return { x: box.x, y: box.y, width: box.width, height: box.height, scale: box.width / 612 };
}

/** Arms a tool by its ribbon control, unless it is armed already. @param {string} id */
async function arm(id) {
  const control = page.locator(`[data-command="${id}"]:visible`).first();
  if ((await control.getAttribute('aria-pressed')) !== 'true') await control.click();
}
/**
 * A region of the first page, in points from its top left, as a clip on screen.
 * @param {{ x: number, y: number, scale: number }} at @param {number} left @param {number} top @param {number} width @param {number} height
 */
const clipOf = (at, left, top, width, height) => ({ x: at.x + left * at.scale, y: at.y + top * at.scale, width: width * at.scale, height: height * at.scale });

/**
 * Photographs `clip` until `WINDOW_MS` after `act` ends, and reads the two times off the sequence.
 * @param {{ x: number, y: number, width: number, height: number }} clip
 * @param {() => Promise<void>} act ends at the release or the finishing key
 */
async function timed(clip, act) {
  await page.mouse.move(2, 2);
  // SAMPLED IN THE PAGE, at every animation frame. Photographs on demand force a frame each and came 111-250 ms apart
  // (trials, 2026-10-20), coarser than the 150 ms this is for; Electron's frame subscription and Chromium's screencast
  // each delivered ONE frame here while requestAnimationFrame ran at 60 a second (probe, same day). So each frame the
  // page draws is fingerprinted where it is drawn: the pixels of every canvas over the region — the page and its tiles,
  // which is where a saved mark appears — and the elements on a 6 x 4 grid of points in it, which is where a
  // placeholder lives. The start is the LAST INPUT's own timestamp, on the same clock.
  await page.evaluate((region) => {
    // THE PAGE'S OBJECTS by name and by the shapes used here: this file is type-checked as Node, with no DOM library, and
    // the repository reaches the page through `globalThis` rather than widening every script's types.
    /** @typedef {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} Box */
    /** @typedef {{ getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }} Pen */
    /** @typedef {{ width: number, height: number, className: string, getBoundingClientRect: () => Box, getContext: (kind: '2d', options: { willReadFrequently: boolean }) => Pen | null }} Surface */
    /** @typedef {{ tagName: string, textContent: string | null, children: { length: number }, getAttribute: (name: string) => string | null }} Element */
    const view = /** @type {{ addEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void, removeEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void }} */ (Reflect.get(globalThis, 'window'));
    const page = /** @type {{ querySelectorAll: (selector: string) => Iterable<Surface>, elementsFromPoint: (x: number, y: number) => Element[] }} */ (Reflect.get(globalThis, 'document'));
    const nextFrame = /** @type {(callback: () => void) => number} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    /** @type {{ t: number, sig: string }[]} */
    const frames = [];
    let lastInput = 0;
    const note = (/** @type {{ timeStamp: number }} */ event) => {
      lastInput = event.timeStamp;
    };
    for (const kind of ['pointerup', 'keydown', 'click']) view.addEventListener(kind, note, { capture: true });
    const fingerprint = () => {
      const parts = [];
      for (const canvas of page.querySelectorAll('canvas')) {
        const box = canvas.getBoundingClientRect();
        const left = Math.max(box.left, region.x);
        const top = Math.max(box.top, region.y);
        const right = Math.min(box.right, region.x + region.width);
        const bottom = Math.min(box.bottom, region.y + region.height);
        if (right <= left || bottom <= top || box.width === 0 || canvas.width === 0) continue;
        const sx = canvas.width / box.width;
        const sy = canvas.height / box.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null) continue;
        const data = context.getImageData(Math.floor((left - box.left) * sx), Math.floor((top - box.top) * sy), Math.max(1, Math.floor((right - left) * sx)), Math.max(1, Math.floor((bottom - top) * sy))).data;
        let sum = 2166136261;
        for (let at = 0; at < data.length; at += 4) sum = Math.imul(sum ^ (data[at] ?? 0) ^ ((data[at + 1] ?? 0) << 8) ^ ((data[at + 2] ?? 0) << 16), 16777619) >>> 0;
        parts.push(`${canvas.className}:${String(sum)}`);
      }
      for (let ix = 0; ix < 6; ix += 1) {
        for (let iy = 0; iy < 4; iy += 1) {
          const stack = page.elementsFromPoint(region.x + ((ix + 0.5) * region.width) / 6, region.y + ((iy + 0.5) * region.height) / 4);
          parts.push(stack.slice(0, 4).map((element) => `${element.tagName}.${element.getAttribute('class') ?? ''}${element.children.length === 0 ? `:${(element.textContent ?? '').slice(0, 20)}` : ''}`).join('>'));
        }
      }
      return parts.join('|');
    };
    let running = true;
    const tick = () => {
      if (!running) return;
      frames.push({ t: performance.now(), sig: fingerprint() });
      nextFrame(tick);
    };
    nextFrame(tick);
    Reflect.set(globalThis, 'latencySampler', {
      stop: () => {
        running = false;
        for (const kind of ['pointerup', 'keydown', 'click']) view.removeEventListener(kind, note, { capture: true });
        return { frames, lastInput };
      },
    });
  }, clip);
  // THE BASELINE: a few frames of the region as it was.
  await page.waitForTimeout(150);
  await act();
  await page.waitForTimeout(WINDOW_MS);
  const { frames, lastInput } = await page.evaluate(() => /** @type {{ stop: () => { frames: { t: number, sig: string }[], lastInput: number } }} */ (Reflect.get(globalThis, 'latencySampler')).stop());
  const start = lastInput;
  // EVERY CHANGE, when and in which part, for a refusal to name what the sampler actually saw.
  const changes = frames
    .map((frame, at) => ({ frame, previous: frames[at - 1] }))
    .filter(({ frame, previous }) => previous !== undefined && previous.sig !== frame.sig)
    .map(({ frame, previous }) => {
      const now = frame.sig.split('|');
      const was = previous?.sig.split('|') ?? [];
      const part = now.findIndex((piece, at) => piece !== was[at]);
      return `${String(Math.round(frame.t - start))}ms@${String(part)}:${(now[part] ?? '').slice(0, 60)}`;
    });
  const received = `${String(frames.length)} frames, ${String(frames.filter((frame) => frame.t >= start).length)} after the last input at ${String(Math.round(start))}; changes ${JSON.stringify(changes.slice(0, 8))}`;
  if (start === 0) throw new Error(`the action made no input the page heard, so there is no release to time from: ${received}`);
  const before = frames.filter((frame) => frame.t < start).at(-1);
  if (before === undefined) throw new Error(`no frame was drawn before the action, so there is nothing to compare with: ${received}`);
  const after = frames.filter((frame) => frame.t >= start).map((frame) => ({ t: frame.t - start, sum: frame.sig }));
  const lastSum = after.at(-1)?.sum ?? before.sig;
  // THE LAST CHANGE in the region: the first frame from which every later one equals the last.
  let settled = after.length - 1;
  while (settled > 0 && after[settled - 1]?.sum === lastSum) settled -= 1;
  const changed = after.find((frame) => frame.sum !== before.sig);
  const gaps = after.slice(1).map((frame, at) => frame.t - (after[at]?.t ?? 0)).sort((a, b) => a - b);
  const finalAt = after.length === 0 || lastSum === before.sig ? null : (after[settled]?.t ?? 0);
  return {
    first: changed === undefined ? null : Math.round(changed.t),
    final: finalAt === null ? 0 : Math.round(finalAt),
    // A FINAL IN THE LAST QUARTER of the window may not be final at all.
    late: (finalAt ?? 0) > WINDOW_MS * 0.75,
    unchanged: changed === undefined,
    frames: after.length,
    interval: Math.round(gaps[Math.floor(gaps.length / 2)] ?? 0),
    start,
    received,
  };
}

/** @param {number[]} values */
const spread = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor((sorted.length - 1) / 2)], max: sorted.at(-1) };
};

/** @type {Record<string, unknown>} */
const results = {};

/**
 * Runs `name` `runs` times and records the spread; refuses a run whose result never changed the region.
 * @param {string} name @param {(run: number) => ReturnType<typeof timed>} once
 * @param {{ shownWhileTyped: boolean }} [options]
 */
async function measure(name, once, options = { shownWhileTyped: false }) {
  if (!wanted(name)) return;
  await step(`R19: ${name}`, async () => {
    /** @type {Awaited<ReturnType<typeof timed>>[]} */
    const samples = [];
    for (let run = 0; run < runs; run += 1) {
      const sample = await once(run);
      samples.push(sample);
      // WHAT CHANGED BETWEEN THE FIRST AND THE FINAL, when asked: a final later than the first is a second change on
      // screen, and only the change list says which part of the region made it.
      if (showChanges) process.stdout.write(`      ${name} run ${String(run)}: ${sample.received}\n`);
      // EACH RUN UNDONE, so every run starts on the same page: marks left from earlier runs took the next run's press
      // (a stamp's box began on a highlight and selected it), and five deletes ran out of pages (trial, 2026-10-20).
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Z');
      await writesIdle(page);
      await page.waitForTimeout(500);
    }
    const unchanged = samples.filter((each) => each.unchanged).length;
    // A FIELD SHOWS ITS WORDS AS THEY ARE TYPED, so after the key that commits them nothing need change: that is a
    // result (no wait), not a step that did nothing.
    if (unchanged > 0 && !options.shownWhileTyped) throw new Error(`${String(unchanged)} of ${String(runs)} runs changed nothing in the region: the step did not do what it names`);
    const facts = {
      final: spread(samples.map((each) => each.final)),
      first: spread(samples.map((each) => each.first ?? 0)),
      late: samples.filter((each) => each.late).length,
      interval: spread(samples.map((each) => each.interval)),
      samples: samples.map(({ first, final }) => ({ first, final })),
    };
    results[name] = facts;
    process.stdout.write(`      ${name}: final ${JSON.stringify(facts.final)} first ${JSON.stringify(facts.first)} interval ${JSON.stringify(facts.interval)} late ${String(facts.late)}\n`);
    return facts;
  });
}

// THE RESOLUTION CONTROL, for both things the sampler reads: an element appearing CONTROL_MS after a key the page hears
// (where a placeholder lives) must be read as the FIRST change, and a canvas drawn CANVAS_MS after it (where a saved mark
// lives) as the FINAL one, each within 30 ms — two frames at 60 Hz. Not "within one interval": a coarse sampler passes
// that for anything, and the trials' photographs, 111-250 ms apart, did.
const CANVAS_MS = 500;
await step('the instrument reads an element at 300 ms and a canvas at 500 ms after the key, each within 30 ms', async () => {
  const at = await slot();
  const clip = clipOf(at, 400, 40, 120, 60);
  // PLACED BY CSSOM WRITES: the renderer's CSP (§9.27) refuses a `style` ATTRIBUTE, so a control placed by one sat
  // unstyled at the foot of the body, outside the region, and read as an instrument that saw nothing (trial,
  // 2026-10-20). `element.style.x = …` is not intercepted.
  const place = { position: 'fixed', left: `${String(clip.x)}px`, top: `${String(clip.y)}px`, width: `${String(clip.width)}px`, height: `${String(clip.height)}px`, zIndex: '99999' };
  // THE CANVAS IS THERE BEFORE THE SAMPLER STARTS, blank, so its arrival is not a change in the window measured.
  /**
   * The few page objects the control touches, by the shapes used (see the sampler's note).
   * @typedef {{ id: string, width: number, height: number, style: Record<string, string>, remove: () => void, getContext: (kind: '2d') => { fillStyle: string, fillRect: (x: number, y: number, w: number, h: number) => void } | null }} Made
   * @typedef {{ createElement: (tag: string) => Made, getElementById: (id: string) => Made | null, body: { append: (child: Made) => void } }} Page
   */
  await page.evaluate(
    ({ css, width, height }) => {
      const doc = /** @type {Page} */ (Reflect.get(globalThis, 'document'));
      const surface = doc.createElement('canvas');
      surface.id = 'latency-control-canvas';
      surface.width = width;
      surface.height = height;
      Object.assign(surface.style, css);
      doc.body.append(surface);
    },
    { css: place, width: Math.round(clip.width), height: Math.round(clip.height) },
  );
  let scheduled = 0;
  const reading = await timed(clip, async () => {
    // THE TIMERS START HERE, and the key that marks the start follows a few milliseconds later; the gap between them
    // is read on the page's clock and taken off the expected times.
    scheduled = await page.evaluate(
      ({ css, delay, canvasDelay }) => {
        const doc = /** @type {Page} */ (Reflect.get(globalThis, 'document'));
        setTimeout(() => {
          const mark = doc.createElement('div');
          mark.id = 'latency-control';
          Object.assign(mark.style, css, { width: '20px', height: '20px', background: '#c0f' });
          doc.body.append(mark);
        }, delay);
        setTimeout(() => {
          const surface = doc.getElementById('latency-control-canvas');
          const pen = surface?.getContext('2d');
          if (surface !== null && pen !== null && pen !== undefined) {
            pen.fillStyle = '#0c0';
            pen.fillRect(0, 0, surface.width, surface.height);
          }
        }, canvasDelay);
        return performance.now();
      },
      { css: place, delay: CONTROL_MS, canvasDelay: CANVAS_MS },
    );
    await page.keyboard.press('Shift');
  });
  await page.evaluate(() => {
    const doc = /** @type {Page} */ (Reflect.get(globalThis, 'document'));
    doc.getElementById('latency-control')?.remove();
    doc.getElementById('latency-control-canvas')?.remove();
  });
  const gap = reading.start - scheduled;
  const firstOff = Math.abs((reading.first ?? 0) - (CONTROL_MS - gap));
  const finalOff = Math.abs(reading.final - (CANVAS_MS - gap));
  if (firstOff > 30 || finalOff > 30) {
    throw new Error(`an element at ${String(CONTROL_MS)} ms was read at ${String(reading.first)}, a canvas at ${String(CANVAS_MS)} ms at ${String(reading.final)}, the key ${String(Math.round(gap))} ms after the timers: the instrument cannot resolve what it is for. ${reading.received}`);
  }
  results['control'] = reading;
  return reading;
});

await section('Comment');

await measure('highlight area', async (run) => {
  await arm('annotate.highlight-area');
  const at = await slot();
  const top = 330 + run * 50;
  return timed(clipOf(at, 300, top - 10, 260, 50), async () => {
    await page.mouse.move(at.x + 320 * at.scale, at.y + top * at.scale);
    await page.mouse.down();
    await page.mouse.move(at.x + 540 * at.scale, at.y + (top + 30) * at.scale, { steps: 8 });
    await page.mouse.up();
  });
});

await measure('text highlight', async (run) => {
  await arm('annotate.highlight');
  const at = await slot();
  // LINE run+2's words, its baseline at 700 - 30 * (run + 1) points from the bottom.
  const middle = 792 - (700 - 30 * (run + 1)) - 5;
  return timed(clipOf(at, 60, middle - 15, 400, 30), async () => {
    await page.mouse.move(at.x + 75 * at.scale, at.y + middle * at.scale);
    await page.mouse.down();
    await page.mouse.move(at.x + 300 * at.scale, at.y + middle * at.scale, { steps: 8 });
    await page.mouse.up();
  });
});

await measure('stamp', async (run) => {
  await arm('annotate.stamp');
  const at = await slot();
  // TWO ROWS AND THEN ACROSS: a third row at 680 points began below the page's visible foot at this window's scale
  // (measured 2026-10-21: the press landed at 874 px, the page ended at 846), and the chooser never opened.
  const top = 560 + (run % 2) * 60;
  const left = 80 + Math.floor(run / 2) * 250;
  // A BOX DRAGGED, then the chooser's default stamp added: the time runs from the press on "Add stamp".
  await page.mouse.move(at.x + left * at.scale, at.y + (top - 30) * at.scale);
  await page.mouse.down();
  await page.mouse.move(at.x + (left + 200) * at.scale, at.y + (top + 30) * at.scale, { steps: 8 });
  await page.mouse.up();
  const chooser = page.getByRole('dialog', { name: 'Choose a stamp' });
  await chooser.waitFor({ timeout: 15_000 });
  return timed(clipOf(at, left - 20, top - 40, 240, 80), async () => {
    await chooser.getByRole('button', { name: 'Add stamp', exact: true }).click();
  });
});

await measure('text box', async (run) => {
  await arm('annotate.text-box');
  const at = await slot();
  const top = 330 + run * 50;
  return timed(clipOf(at, 60, top - 10, 220, 50), async () => {
    await page.mouse.move(at.x + 70 * at.scale, at.y + top * at.scale);
    await page.mouse.down();
    await page.mouse.move(at.x + 260 * at.scale, at.y + (top + 30) * at.scale, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.type('Hello');
    // A PRESS ON THE PAGE FINISHES the words (`pageWriting.pw.ts`): an empty corner of it.
    await page.mouse.click(at.x + 590 * at.scale, at.y + 780 * at.scale);
  });
});

await page.keyboard.press('Escape');
await section('Home');

await measure('form fill', async (run) => {
  const at = await slot();
  const box = clipOf(at, 72, 792 - 174, 240, 24);
  return timed(clipOf(at, 62, 792 - 184, 260, 44), async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`Filled ${String(run)}`);
    await page.keyboard.press('Tab');
  });
}, { shownWhileTyped: true });

await measure('rotate page', async () => {
  const at = await slot();
  return timed({ x: at.x, y: at.y, width: Math.min(at.width, at.height), height: Math.min(at.width, at.height) }, async () => {
    await command('Rotate page');
  });
});

// A PAGE MOVED: the first page goes down one, so the region at the top of the view shows page 2's lines.
await measure('move page', async () => {
  const at = await slot();
  return timed({ x: at.x, y: at.y, width: at.width, height: Math.min(at.height, 400) }, async () => {
    await command('Move page down');
  });
});

// A FIELD'S DESIGN: its border recoloured from its Properties, the press on the swatch being the input. The unscoped first
// `Red` is the Border colour's (`formsWalk`'s note of 2026-10-13).
await measure('field design change', async () => {
  if ((await page.locator('[data-field-box]').count()) === 0) await command('Edit fields');
  await page.locator('[data-field-box]').first().click();
  const red = page.getByRole('button', { name: 'Red' }).first();
  await red.waitFor({ timeout: 15_000 });
  const at = await slot();
  return timed(clipOf(at, 62, 792 - 184, 260, 44), () => red.click());
});
if (wanted('field design change')) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

await measure('edit text', async (run) => {
  await section('Edit');
  // ARMED BY ITS CONTROL, not the palette: the command toggles, so a second run turned the tool off (trial, 2026-10-20).
  await arm('text.edit');
  const block = page.locator('[data-text-edit-layer] [data-text-block]').nth(run);
  await block.waitFor({ timeout: 30_000 });
  const area = await block.boundingBox();
  if (area === null) throw new Error('the block has no box');
  return timed({ x: area.x - 6, y: area.y - 6, width: area.width + 60, height: area.height + 12 }, async () => {
    await block.click();
    await page.locator('[data-text-editor]').waitFor({ timeout: 15_000 });
    await page.keyboard.press('End');
    await page.keyboard.type(' X');
    await page.keyboard.press('Escape');
  });
});

await page.keyboard.press('Escape');

await measure('page delete', async () => {
  const at = await slot();
  return timed({ x: at.x, y: at.y, width: at.width, height: Math.min(at.height, 400) }, async () => {
    await command('Delete page');
    await page.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete pages', exact: true }).click();
  });
});

await writeFile(join(output, 'latency.json'), `${JSON.stringify({ appRoot: appRoot ?? '.', runs, windowMs: WINDOW_MS, results }, null, 2)}\n`);
await finish();
