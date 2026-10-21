// @ts-check
/**
 * NO PAGE EVER BLINKS (the owner's R19, Addendum 6, 2026-10-21): a page on screen is never removed, blanked or shown
 * partly drawn while its new drawing is made, and a page an action did not change keeps its exact pixels throughout.
 *
 *   node scripts/research/blinkWalk.mjs [--app-root <checkout> | --executable <Monstera.exe>] [--runs <n>] [--only <name,...>]
 *
 * ## What is read, and how
 *
 * At every animation frame from before the action until `WINDOW_MS` after its last input, each page canvas of the main
 * view that is on screen is read where it is drawn: whether it is there and shown, and a 32 by 40 grid of its pixels —
 * how much of the grid carries ink, and a fingerprint of it. Each page's frames are then judged against the page as it
 * was before the action and as it is at the end:
 *
 * - **missing**: no canvas for a page that had one, or one not shown;
 * - **blank**: no ink, where the page had ink before and has ink after;
 * - **partly drawn**: ink under half of both the before and the after;
 * - **flicker**: a fingerprint the page had left coming back — A, B, A;
 * - **untouched page changed**: any change at all on a page the action does not change.
 *
 * What is drawn on the page's canvas, not a DOM signal: a canvas swapped whole and a canvas cleared and painted over
 * several tasks are the same DOM.
 *
 * ## The instrument proves it can see a blink first (CLAUDE.md items 4a and 4b)
 *
 * Its only result is an absence — the reassuring answer — so before any action it hides a page's canvas for a few frames
 * and refuses to report unless it counts that as missing, and it clears a canvas to white for a few frames and refuses
 * unless it counts that as blank. A walk whose sampler could not see would otherwise report zero for everything.
 *
 * ## And it sees the blink the off-screen swap exists to prevent
 *
 * Measured 2026-10-21, renderer built from 3b961da4 with one line added to `renderPage.ts`'s `renderPage`: the canvas
 * on screen sized (so cleared) when a draw starts, which is what drawing in place does. Two runs each: rotate 4 blank
 * and 2 flicker frames, zoom 3 blank, both red; without that line, both 0. A scroll stays clean either way, because a
 * page already on screen is not redrawn by one.
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { startWalk } from './liveWalk.mjs';

const WINDOW_MS = 2500;

const argv = process.argv.slice(2);
/** @param {string} name */
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const appRoot = option('--app-root');
const runs = Number(option('--runs') ?? '3');
const only = option('--only')?.split(',');
/** @param {string} name */
const wanted = (name) => only === undefined || only.includes(name);

/** Five Letter pages, each with its own lines, so every page draws differently and a swapped page is told apart. */
async function fixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 5; index += 1) {
    const page = document.addPage([612, 792]);
    for (let line = 0; line < 20 + index * 3; line += 1) {
      page.drawText(`Page ${String(index + 1)}, line ${String(line + 1)}: the quick brown fox jumps over the lazy dog.`, { x: 72, y: 720 - line * 22, size: 13, font });
    }
  }
  return document.save();
}

// A WINDOW THAT PAINTS WHILE COVERED, `markLatencyWalk`'s reason.
const switches = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
const executable = option('--executable');
const walk = await startWalk(
  'blink',
  executable !== undefined ? { executable: resolve(executable), switches } : appRoot === undefined ? { switches } : { appRoot: resolve(appRoot), switches },
);
const { page, output, command, step, finish } = walk;
const first = join(output, 'five-pages.pdf');
const second = join(output, 'second.pdf');
await writeFile(first, await fixture());
await writeFile(second, await fixture());

/**
 * @typedef {{ t: number, pages: Record<string, { shown: boolean, ink: number, sig: string }> }} Frame
 * @typedef {{ missing: number, blank: number, partial: number, flicker: number, untouchedChanged: number, pages: string[], frames: number }} Verdict
 */

/** Starts sampling every frame of the main view's pages on screen. */
async function startSampling() {
  await page.evaluate(() => {
    /** @typedef {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} Box */
    /** @typedef {{ getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }} Pen */
    /** @typedef {{ width: number, height: number, getAttribute: (name: string) => string | null, getBoundingClientRect: () => Box, checkVisibility: (options: { visibilityProperty: boolean, opacityProperty: boolean }) => boolean, getContext: (kind: '2d', options: { willReadFrequently: boolean }) => Pen | null }} Surface */
    const doc = /** @type {{ querySelectorAll: (selector: string) => Iterable<Surface>, querySelector: (selector: string) => { getBoundingClientRect: () => Box } | null }} */ (Reflect.get(globalThis, 'document'));
    const view = /** @type {{ addEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void, removeEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void }} */ (Reflect.get(globalThis, 'window'));
    const nextFrame = /** @type {(callback: () => void) => number} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    /** @type {{ t: number, pages: Record<string, { shown: boolean, ink: number, sig: string }> }[]} */
    const frames = [];
    let lastInput = 0;
    const note = (/** @type {{ timeStamp: number }} */ event) => {
      lastInput = event.timeStamp;
    };
    // A WHEEL IS AN INPUT: a scroll makes no pointerup, key or click.
    for (const kind of ['pointerup', 'keydown', 'click', 'wheel']) view.addEventListener(kind, note, { capture: true });
    // THE MAIN VIEW'S SCROLLER, whose box decides what is on screen: the Pages panel's thumbnails are canvases too.
    const read = () => {
      /** @type {Record<string, { shown: boolean, ink: number, sig: string }>} */
      const pages = {};
      // READ EVERY FRAME: a tab switch puts another layer's scroller on show.
      const room = doc.querySelector('[data-document-layer="active"] .m-page-list')?.getBoundingClientRect();
      if (room === undefined) return pages;
      // THE LAYER ON SHOW ONLY: a document behind it keeps its canvases under `visibility: hidden`, and a selector list
      // answers in tree order, so naming them as a fallback read the hidden layer's page 0 whenever it came first.
      for (const canvas of doc.querySelectorAll('[data-document-layer="active"] canvas[data-page-canvas]')) {
        const key = canvas.getAttribute('data-page-canvas');
        if (key === null || key in pages) continue;
        const box = canvas.getBoundingClientRect();
        // ON SCREEN: at least a third of it inside the scroller's box.
        const visible = Math.max(0, Math.min(box.bottom, room.bottom) - Math.max(box.top, room.top));
        if (box.height === 0 || visible < box.height / 3 || box.right < room.left || box.left > room.right) continue;
        // `visibility: hidden` and `opacity: 0` hide a canvas while leaving it in the tree; the default check sees neither.
        const shown = canvas.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && canvas.width > 0 && canvas.height > 0;
        if (!shown) {
          pages[key] = { shown: false, ink: 0, sig: 'hidden' };
          continue;
        }
        const pen = canvas.getContext('2d', { willReadFrequently: true });
        const data = pen?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (data === undefined) continue;
        let ink = 0;
        let sum = 2166136261;
        for (let gx = 0; gx < 32; gx += 1) {
          for (let gy = 0; gy < 40; gy += 1) {
            const x = Math.floor(((gx + 0.5) * canvas.width) / 32);
            const y = Math.floor(((gy + 0.5) * canvas.height) / 40);
            const at = (y * canvas.width + x) * 4;
            const r = data[at] ?? 255;
            const g = data[at + 1] ?? 255;
            const b = data[at + 2] ?? 255;
            const a = data[at + 3] ?? 0;
            if (a > 0 && r + g + b < 700) ink += 1;
            sum = Math.imul(sum ^ r ^ (g << 8) ^ (b << 16) ^ (a << 24), 16777619) >>> 0;
          }
        }
        // INK ACROSS THE WHOLE CANVAS, not only the grid, so a page whose lines fall between grid points still counts.
        if (ink === 0) {
          for (let at = 0; at < data.length; at += 4 * 97) {
            if ((data[at + 3] ?? 0) > 0 && (data[at] ?? 255) + (data[at + 1] ?? 255) + (data[at + 2] ?? 255) < 700) {
              ink = 1;
              break;
            }
          }
        }
        pages[key] = { shown: true, ink, sig: String(sum) };
      }
      return pages;
    };
    let running = true;
    const tick = () => {
      if (!running) return;
      frames.push({ t: performance.now(), pages: read() });
      nextFrame(tick);
    };
    nextFrame(tick);
    Reflect.set(globalThis, 'blinkSampler', {
      stop: () => {
        running = false;
        for (const kind of ['pointerup', 'keydown', 'click', 'wheel']) view.removeEventListener(kind, note, { capture: true });
        return { frames, lastInput };
      },
    });
  });
}

/** @returns {Promise<{ frames: Frame[], lastInput: number }>} */
async function stopSampling() {
  return page.evaluate(() => /** @type {{ stop: () => { frames: Frame[], lastInput: number } }} */ (Reflect.get(globalThis, 'blinkSampler')).stop());
}

/**
 * Judges every page's frames from the last one before the action to the end. `untouched` names the pages the action
 * does not change, by their place on screen before it; `null` judges none untouched.
 * @param {Frame[]} frames @param {number} start @param {readonly string[] | null} untouched
 * @returns {Verdict}
 */
function judge(frames, start, untouched) {
  const before = frames.filter((frame) => frame.t < start).at(-1);
  const after = frames.filter((frame) => frame.t >= start);
  const last = after.at(-1);
  if (before === undefined || last === undefined) throw new Error(`no frame before the action, or none after (${String(frames.length)} frames)`);
  const keys = [...new Set([...Object.keys(before.pages), ...Object.keys(last.pages)])];
  /** @type {Verdict} */
  const verdict = { missing: 0, blank: 0, partial: 0, flicker: 0, untouchedChanged: 0, pages: keys, frames: after.length };
  for (const key of keys) {
    const was = before.pages[key];
    const end = last.pages[key];
    const seen = new Set(was === undefined ? [] : [was.sig]);
    let current = was?.sig;
    for (const frame of after) {
      const now = frame.pages[key];
      // A PAGE ON SCREEN BEFORE AND AT THE END, gone in between: missing.
      if (now === undefined) {
        if (was !== undefined && end !== undefined) verdict.missing += 1;
        continue;
      }
      if (!now.shown) {
        verdict.missing += 1;
        continue;
      }
      if (was !== undefined && end !== undefined && was.ink > 0 && end.ink > 0) {
        if (now.ink === 0) verdict.blank += 1;
        else if (now.ink < 0.5 * Math.min(was.ink, end.ink)) verdict.partial += 1;
      }
      if (untouched?.includes(key) === true && was !== undefined && now.sig !== was.sig) verdict.untouchedChanged += 1;
      if (now.sig !== current) {
        if (seen.has(now.sig) && now.sig !== end?.sig) verdict.flicker += 1;
        seen.add(now.sig);
        current = now.sig;
      }
    }
  }
  return verdict;
}

/** Waits for the frame to settle: the writes idle, then a few frames. */
async function settle() {
  await page.waitForTimeout(1200);
}

/** @type {Record<string, unknown>} */
const results = {};

/**
 * Runs `act` `runs` times, judging each; `untouched` names the pages each run leaves alone, read before the run.
 * @param {string} name @param {(run: number) => Promise<void>} act @param {(run: number) => Promise<readonly string[] | null>} untouched
 * @param {() => Promise<void>} [undo] @param {() => Promise<void>} [prepare] runs before each run's sampling starts
 */
async function measure(name, act, untouched, undo, prepare) {
  if (!wanted(name)) return;
  await step(`no page blinks: ${name}`, async () => {
    /** @type {Verdict[]} */
    const verdicts = [];
    for (let run = 0; run < runs; run += 1) {
      if (prepare !== undefined) await prepare();
      const leftAlone = await untouched(run);
      await startSampling();
      await page.waitForTimeout(200);
      await act(run);
      await page.waitForTimeout(WINDOW_MS);
      const { frames, lastInput } = await stopSampling();
      if (lastInput === 0) throw new Error('the action made no input the page heard');
      verdicts.push(judge(frames, lastInput, leftAlone));
      if (undo !== undefined) await undo();
      await settle();
    }
    const total = (/** @type {keyof Verdict} */ field) => verdicts.reduce((sum, each) => sum + Number(each[field]), 0);
    const facts = {
      missing: total('missing'),
      blank: total('blank'),
      partial: total('partial'),
      flicker: total('flicker'),
      untouchedChanged: total('untouchedChanged'),
      runs: verdicts.map((each) => ({ ...each })),
    };
    results[name] = facts;
    process.stdout.write(`      ${name}: missing ${String(facts.missing)} blank ${String(facts.blank)} partial ${String(facts.partial)} flicker ${String(facts.flicker)} untouched changed ${String(facts.untouchedChanged)}\n`);
    const bad = facts.missing + facts.blank + facts.partial + facts.flicker + facts.untouchedChanged;
    if (bad > 0) throw new Error(`${String(bad)} bad frames over ${String(runs)} runs: ${JSON.stringify(facts.runs)}`);
    return facts;
  });
}

/** The pages on screen now, by their `data-page-canvas`. @returns {Promise<string[]>} */
async function onScreen() {
  await startSampling();
  await page.waitForTimeout(100);
  const { frames } = await stopSampling();
  return Object.keys(frames.at(-1)?.pages ?? {});
}

await walk.open(first);
await settle();

// THE CONTROL: a page hidden for a few frames, and a page cleared to white for a few frames, each counted, or nothing.
await step('the instrument counts a page hidden, and a page cleared, for a few frames', async () => {
  await startSampling();
  await page.waitForTimeout(200);
  await page.keyboard.press('Shift');
  await page.evaluate(async () => {
    const doc = /** @type {{ querySelector: (selector: string) => { style: { visibility: string }, width: number, height: number, getContext: (kind: '2d') => { getImageData: (x: number, y: number, w: number, h: number) => unknown, putImageData: (data: unknown, x: number, y: number) => void, fillStyle: string, fillRect: (x: number, y: number, w: number, h: number) => void } | null } | null }} */ (Reflect.get(globalThis, 'document'));
    const canvas = doc.querySelector('canvas[data-page-canvas="0"]');
    if (canvas === null) throw new Error('no page canvas to hide');
    const wait = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
    canvas.style.visibility = 'hidden';
    await wait(100);
    canvas.style.visibility = '';
    await wait(100);
    const pen = canvas.getContext('2d');
    if (pen === null) throw new Error('no context to clear');
    const kept = pen.getImageData(0, 0, canvas.width, canvas.height);
    pen.fillStyle = '#ffffff';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    await wait(100);
    pen.putImageData(kept, 0, 0);
  });
  await page.waitForTimeout(400);
  const { frames, lastInput } = await stopSampling();
  const verdict = judge(frames, lastInput, null);
  process.stdout.write(`      control: missing ${String(verdict.missing)} blank ${String(verdict.blank)}\n`);
  if (verdict.missing === 0 || verdict.blank === 0) throw new Error(`the instrument did not see the blink it was shown: ${JSON.stringify(verdict)}`);
  return { ...verdict };
});

// ROTATE: the page on show turns; every other page on screen is untouched.
await measure(
  'rotate page',
  () => command('Rotate page'),
  async () => (await onScreen()).filter((key) => key !== '0'),
  async () => {
    await page.keyboard.press('Control+Z');
  },
);
// MOVE: the first page goes down one; pages past the second are untouched.
await measure(
  'move page down',
  () => command('Move page down'),
  async () => (await onScreen()).filter((key) => key !== '0' && key !== '1'),
  async () => {
    await page.keyboard.press('Control+Z');
  },
);
// ZOOM IN and OUT: every page changes, and none may blank or show part drawn.
await measure(
  'zoom in',
  () => command('Zoom in'),
  () => Promise.resolve(null),
  () => command('Zoom out'),
);
// SCROLL: pages arriving draw; pages on screen throughout keep their pixels.
await measure(
  'scroll',
  async () => {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 500);
  },
  () => Promise.resolve(null),
  async () => {
    await page.mouse.wheel(0, -500);
  },
);
// THEME: the shell changes colour; a page's own pixels do not, and it may not blank.
await measure(
  'theme switch',
  () => page.locator('header button[aria-label^="Switch to"]').first().click(),
  async () => onScreen(),
  () => page.locator('header button[aria-label^="Switch to"]').first().click(),
);
// TAB SWITCH: a second document, then back to the first; the first's pages on show again may not blank on return.
if (wanted('tab switch') || wanted('parked tab rebuild')) {
  await walk.open(second);
  await settle();
}
await measure(
  'tab switch',
  () => page.locator('.m-tab').first().click(),
  () => Promise.resolve(null),
  () => page.locator('.m-tab').nth(1).click(),
);
// A PARKED TAB COMING BACK: after `PARK_AFTER_MS` (60 s) behind with nothing to lose, a layer mounts nothing, so going
// back to it builds the layer again — which must draw behind the one on show and come forward whole.
await measure(
  'parked tab rebuild',
  async () => {
    await page.locator('.m-tab').first().click();
    await page.waitForSelector('[data-document-layer="parked"]', { state: 'detached', timeout: 30_000 });
  },
  () => Promise.resolve(null),
  () => page.locator('.m-tab').nth(1).click(),
  async () => {
    await page.waitForSelector('[data-document-layer="parked"]', { state: 'attached', timeout: 120_000 });
  },
);
// DELETE: the first page goes; the pages after it move up and may not blank on the way.
await measure(
  'delete page',
  async () => {
    await command('Delete pages…');
    await page.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete pages', exact: true }).click();
  },
  () => Promise.resolve(null),
  async () => {
    await page.keyboard.press('Control+Z');
  },
);

await writeFile(join(output, 'blink.json'), `${JSON.stringify({ runs, windowMs: WINDOW_MS, results }, null, 2)}\n`);
await finish();
