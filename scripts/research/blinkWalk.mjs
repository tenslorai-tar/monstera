// @ts-check
/**
 * NO PAGE EVER BLINKS (the owner's R19, Addendum 6, 2026-10-21): a page on screen is never removed, blanked or shown
 * partly drawn while its new drawing is made, and a page an action did not change keeps its exact pixels throughout.
 *
 *   node scripts/research/blinkWalk.mjs [--app-root <checkout> | --executable <Monstera.exe>] [--runs <n>] [--only <name,...>]
 *
 * ## What is read, and how
 *
 * At every animation frame from before the action until `WINDOW_MS` after its last input, every page picture on screen
 * is read where it is drawn: the main view's page canvases (`p` and the page's index), the Pages panel's thumbnails
 * (`s` and the number under the card) and Organize's cards (`g` and the number). For each: whether it is there and
 * shown, and a 32 by 40 grid of its pixels — how much of the grid carries ink, and a fingerprint of it. Each picture's
 * frames are then judged against the picture as it was before the action and as it is at the end:
 *
 * - **missing**: no canvas for a picture that had one, or one not shown;
 * - **blank**: no ink, where the picture had ink before and has ink after;
 * - **partly drawn**: ink under half of both the before and the after;
 * - **flicker**: a fingerprint the picture had left coming back — A, B, A;
 * - **untouched page changed**: any change at all on a picture of a page the action does not change.
 *
 * What is drawn on the canvas, not a DOM signal: a canvas swapped whole and a canvas cleared and painted over several
 * tasks are the same DOM.
 *
 * ## The instrument proves it can see a blink first (CLAUDE.md items 4a and 4b)
 *
 * Its only result is an absence — the reassuring answer — so before any action it hides a page's canvas for a few frames
 * and refuses to report unless it counts that as missing, and it clears a canvas to white for a few frames and refuses
 * unless it counts that as blank. A walk whose sampler could not see would otherwise report zero for everything.
 *
 * And an action must CHANGE something on screen in every run, or the run is refused: zero bad frames from a command that
 * did nothing (a title the palette did not find, a press that missed its control) is the same reading as zero from one
 * that drew without a blink. The one exception is the theme switch, whose whole claim is that no picture changes.
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
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
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

/**
 * Five Letter pages, each with its own lines, so every page draws differently and a swapped page is told apart, and a
 * bordered text field on the first, whose border a design change recolours.
 */
async function fixture(name = 'Page') {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 5; index += 1) {
    const page = document.addPage([612, 792]);
    for (let line = 0; line < 20 + index * 3; line += 1) {
      page.drawText(`${name} ${String(index + 1)}, line ${String(line + 1)}: the quick brown fox jumps over the lazy dog.`, { x: 72, y: 720 - line * 22, size: 13, font });
    }
  }
  const field = document.getForm().createTextField('Name');
  field.addToPage(document.getPage(0), { x: 72, y: 150, width: 240, height: 28, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  return document.save();
}

// A WINDOW THAT PAINTS WHILE COVERED, `markLatencyWalk`'s reason.
const switches = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
const executable = option('--executable');
const walk = await startWalk(
  'blink',
  executable !== undefined ? { executable: resolve(executable), switches } : appRoot === undefined ? { switches } : { appRoot: resolve(appRoot), switches },
);
const { page, output, command, section, pickFiles, step, finish } = walk;
const first = join(output, 'five-pages.pdf');
const second = join(output, 'second.pdf');
await writeFile(first, await fixture());
// ITS OWN WORDS, so a switch between the two changes every picture: two identical documents switch with no change at all.
await writeFile(second, await fixture('Second document, page'));

/**
 * @typedef {{ t: number, pages: Record<string, { shown: boolean, ink: number, sig: string }> }} Frame
 * @typedef {{ missing: number, blank: number, partial: number, flicker: number, untouchedChanged: number, changed: number, pages: string[], frames: number, where: Record<string, number> }} Verdict
 */

/** Starts sampling every frame of the page pictures on screen. */
async function startSampling() {
  await page.evaluate(() => {
    /** @typedef {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} Box */
    /** @typedef {{ textContent: string | null, getBoundingClientRect: () => Box, querySelector: (selector: string) => Found | null, closest: (selector: string) => Found | null, getAttribute: (name: string) => string | null }} Found */
    /** @typedef {{ getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }} Pen */
    /** @typedef {Found & { width: number, height: number, checkVisibility: (options: { visibilityProperty: boolean, opacityProperty: boolean }) => boolean, getContext: (kind: '2d', options: { willReadFrequently: boolean }) => Pen | null }} Surface */
    const doc = /** @type {{ querySelectorAll: (selector: string) => Iterable<Surface>, querySelector: (selector: string) => Found | null }} */ (Reflect.get(globalThis, 'document'));
    const view = /** @type {{ innerHeight: number, innerWidth: number, addEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void, removeEventListener: (kind: string, listener: (event: { timeStamp: number }) => void, options: { capture: boolean }) => void }} */ (Reflect.get(globalThis, 'window'));
    const nextFrame = /** @type {(callback: () => void) => number} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    /** @type {{ t: number, pages: Record<string, { shown: boolean, ink: number, sig: string }> }[]} */
    const frames = [];
    let lastInput = 0;
    const note = (/** @type {{ timeStamp: number }} */ event) => {
      lastInput = event.timeStamp;
    };
    // A WHEEL IS AN INPUT: a scroll makes no pointerup, key or click.
    for (const kind of ['pointerup', 'keydown', 'click', 'wheel']) view.addEventListener(kind, note, { capture: true });
    /** @param {Surface} canvas @param {Box} room */
    const readOne = (canvas, room) => {
      const box = canvas.getBoundingClientRect();
      // ON SCREEN: at least a third of it inside its scroller's box and the window.
      const top = Math.max(box.top, room.top, 0);
      const bottom = Math.min(box.bottom, room.bottom, view.innerHeight);
      if (box.height === 0 || bottom - top < box.height / 3 || box.right < Math.max(room.left, 0) || box.left > Math.min(room.right, view.innerWidth)) return undefined;
      // `visibility: hidden` and `opacity: 0` hide a canvas while leaving it in the tree; the default check sees neither.
      if (!(canvas.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && canvas.width > 0 && canvas.height > 0)) {
        return { shown: false, ink: 0, sig: 'hidden' };
      }
      const data = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (data === undefined) return undefined;
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
      // INK ACROSS THE WHOLE CANVAS, not only the grid, so a picture whose lines fall between grid points still counts.
      if (ink === 0) {
        for (let at = 0; at < data.length; at += 4 * 97) {
          if ((data[at + 3] ?? 0) > 0 && (data[at] ?? 255) + (data[at + 1] ?? 255) + (data[at + 2] ?? 255) < 700) {
            ink = 1;
            break;
          }
        }
      }
      return { shown: true, ink, sig: String(sum) };
    };
    const read = () => {
      /** @type {Record<string, { shown: boolean, ink: number, sig: string }>} */
      const pages = {};
      // THE LAYER ON SHOW ONLY: a document behind it keeps its canvases under `visibility: hidden`, and a selector list
      // answers in tree order, so naming them as a fallback read the hidden layer's page 0 whenever it came first. Its
      // scroller is read every frame: a tab switch puts another layer's on show.
      const room = doc.querySelector('[data-document-layer="active"] .m-page-list')?.getBoundingClientRect();
      if (room !== undefined) {
        for (const canvas of doc.querySelectorAll('[data-document-layer="active"] canvas[data-page-canvas]')) {
          const key = `p${String(canvas.getAttribute('data-page-canvas'))}`;
          if (key in pages) continue;
          const one = readOne(canvas, room);
          if (one !== undefined) pages[key] = one;
        }
      }
      // THE THUMBNAILS, by the number under each card: the Pages panel's strip (`s`) and Organize's cards (`g`). Not a
      // document behind the one on show, and not Organize's layer still being laid out under the one shown.
      for (const canvas of doc.querySelectorAll('canvas.m-thumb-canvas')) {
        const layer = canvas.closest('[data-document-layer]');
        if (layer !== null && layer.getAttribute('data-document-layer') !== 'active') continue;
        if (canvas.closest('[data-layer="pending"]') !== null) continue;
        const number = canvas.closest('button')?.querySelector('.m-thumb-number')?.textContent;
        const strip = canvas.closest('nav')?.getBoundingClientRect();
        if (number === undefined || number === null || strip === undefined) continue;
        const key = `${canvas.closest('[data-page-view]') === null ? 's' : 'g'}${number}`;
        if (key in pages) continue;
        const one = readOne(canvas, strip);
        if (one !== undefined) pages[key] = one;
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
 * Judges every picture's frames from the last one before the action to the end. `untouched` names the pictures of pages
 * the action does not change, by their keys on screen before it; `null` judges none untouched.
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
  const verdict = { missing: 0, blank: 0, partial: 0, flicker: 0, untouchedChanged: 0, changed: 0, pages: keys, frames: after.length, where: {} };
  /** WHICH picture each bad frame was on, beside the totals. @param {'missing' | 'blank' | 'partial' | 'flicker' | 'untouchedChanged'} kind @param {string} key */
  const bad = (kind, key) => {
    verdict[kind] += 1;
    const named = `${key} ${kind}`;
    verdict.where[named] = (verdict.where[named] ?? 0) + 1;
  };
  for (const key of keys) {
    const was = before.pages[key];
    const end = last.pages[key];
    if (was?.sig !== end?.sig) verdict.changed += 1;
    const seen = new Set(was === undefined ? [] : [was.sig]);
    let current = was?.sig;
    for (const frame of after) {
      const now = frame.pages[key];
      // A PICTURE ON SCREEN BEFORE AND AT THE END, gone in between: missing.
      if (now === undefined) {
        if (was !== undefined && end !== undefined) bad('missing', key);
        continue;
      }
      if (!now.shown) {
        bad('missing', key);
        continue;
      }
      if (was !== undefined && end !== undefined && was.ink > 0 && end.ink > 0) {
        if (now.ink === 0) bad('blank', key);
        else if (now.ink < 0.5 * Math.min(was.ink, end.ink)) bad('partial', key);
      }
      if (untouched?.includes(key) === true && was !== undefined && now.sig !== was.sig) bad('untouchedChanged', key);
      if (now.sig !== current) {
        if (seen.has(now.sig) && now.sig !== end?.sig) bad('flicker', key);
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
 * @typedef {object} Measured
 * @property {(run: number) => Promise<readonly string[] | null>} [untouched] the pictures each run leaves alone, read before it
 * @property {() => Promise<void>} [undo] puts the document back after each run
 * @property {() => Promise<void>} [prepare] runs before each run's sampling starts
 * @property {true} [changesNothing] the action's claim is that no picture changes (the theme switch)
 * @property {number} [windowMs] how long after the last input the frames are read, where `WINDOW_MS` is too short
 */

/**
 * Runs `act` `runs` times, judging each.
 * @param {string} name @param {(run: number) => Promise<void>} act @param {Measured} [how]
 */
async function measure(name, act, how = {}) {
  if (!wanted(name)) return;
  await step(`no page blinks: ${name}`, async () => {
    /** @type {Verdict[]} */
    const verdicts = [];
    for (let run = 0; run < runs; run += 1) {
      if (how.prepare !== undefined) await how.prepare();
      const leftAlone = how.untouched === undefined ? null : await how.untouched(run);
      await startSampling();
      await page.waitForTimeout(200);
      await act(run);
      await page.waitForTimeout(how.windowMs ?? WINDOW_MS);
      const { frames, lastInput } = await stopSampling();
      if (lastInput === 0) throw new Error('the action made no input the page heard');
      const verdict = judge(frames, lastInput, leftAlone);
      if (how.changesNothing !== true && verdict.changed === 0) {
        throw new Error(`run ${String(run)} changed no picture on screen, so its zero bad frames would mean nothing: ${JSON.stringify(verdict)}`);
      }
      verdicts.push(verdict);
      if (how.undo !== undefined) await how.undo();
      await settle();
    }
    const total = (/** @type {'missing' | 'blank' | 'partial' | 'flicker' | 'untouchedChanged'} */ field) => verdicts.reduce((sum, each) => sum + each[field], 0);
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

/** The pictures on screen now, by their keys. @returns {Promise<string[]>} */
async function onScreen() {
  await startSampling();
  await page.waitForTimeout(100);
  const { frames } = await stopSampling();
  return Object.keys(frames.at(-1)?.pages ?? {});
}

/**
 * The pictures on screen of every page but `changed` (indices from 0): its main-view canvas and both strips' cards.
 * @param {readonly number[]} changed
 */
const allBut = (changed) => async () =>
  (await onScreen()).filter((key) => !changed.some((index) => key === `p${String(index)}` || key === `s${String(index + 1)}` || key === `g${String(index + 1)}`));

/** The first page's main-view canvas on screen, and points-to-pixels. */
async function slot() {
  const box = await page.locator('[data-document-layer="active"] canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the first page has no box');
  return { x: box.x, y: box.y, scale: box.width / 612 };
}
/** Arms a tool by its ribbon control, unless it is armed already. @param {string} id */
async function arm(id) {
  const control = page.locator(`[data-command="${id}"]:visible`).first();
  if ((await control.getAttribute('aria-pressed')) !== 'true') await control.click();
}
/** Puts a tool down by its ribbon control: Escape leaves some tools armed (Edit text). @param {string} id */
async function disarm(id) {
  const control = page.locator(`[data-command="${id}"]:visible`).first();
  if ((await control.getAttribute('aria-pressed')) === 'true') await control.click();
}
/** Drags on the first page between two points, in points from its top left. @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
async function dragOnPage(x0, y0, x1, y1) {
  const at = await slot();
  await page.mouse.move(at.x + x0 * at.scale, at.y + y0 * at.scale);
  await page.mouse.down();
  await page.mouse.move(at.x + x1 * at.scale, at.y + y1 * at.scale, { steps: 8 });
  await page.mouse.up();
}
/** Puts the tool down and undoes the one command the run made. */
async function putDownAndUndo() {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
}
const undo = async () => {
  await page.keyboard.press('Control+Z');
};

await walk.open(first);
await settle();

// THE CONTROL: a page hidden for a few frames, and a page cleared to white for a few frames, each counted, or nothing.
await step('the instrument counts a page hidden, and a page cleared, for a few frames', async () => {
  await startSampling();
  await page.waitForTimeout(200);
  await page.keyboard.press('Shift');
  await page.evaluate(async () => {
    const doc = /** @type {{ querySelector: (selector: string) => { style: { visibility: string }, width: number, height: number, getContext: (kind: '2d') => { getImageData: (x: number, y: number, w: number, h: number) => unknown, putImageData: (data: unknown, x: number, y: number) => void, fillStyle: string, fillRect: (x: number, y: number, w: number, h: number) => void } | null } | null }} */ (Reflect.get(globalThis, 'document'));
    const canvas = doc.querySelector('[data-document-layer="active"] canvas[data-page-canvas="0"]');
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

// THE PAGES PANEL OPEN, so every page command is judged on its thumbnails too.
await step('the Pages panel is open, and its thumbnails are read', async () => {
  if ((await page.locator('canvas.m-thumb-canvas:visible').count()) === 0) await command('Pages panel');
  await page.locator('canvas.m-thumb-canvas[data-drawn="true"]:visible').first().waitFor({ timeout: 30_000 });
  await settle();
  const keys = await onScreen();
  if (!keys.some((key) => key.startsWith('s'))) throw new Error(`no thumbnail is read: ${keys.join(', ')}`);
  return { keys };
});

// ROTATE: the page on show turns, in the view and in its thumbnail; every other picture on screen is untouched.
await measure('rotate page', () => command('Rotate page'), { untouched: allBut([0]), undo });
// MOVE: the first page goes down one; pages past the second are untouched.
await measure('move page down', () => command('Move page down'), { untouched: allBut([0, 1]), undo });
// ZOOM IN and OUT: every page in the view changes, and none may blank or show part drawn.
await measure('zoom in', () => command('Zoom in'), { undo: () => command('Zoom out') });
// SCROLL: pages arriving draw; pages on screen throughout keep their pixels.
await measure(
  'scroll',
  async () => {
    const at = await slot();
    await page.mouse.move(at.x + 200, at.y + 200);
    await page.mouse.wheel(0, 500);
  },
  {
    undo: async () => {
      await page.mouse.wheel(0, -500);
    },
  },
);
// THEME: the shell changes colour; no page picture does, and none may blank.
await measure('theme switch', () => page.locator('header button[aria-label^="Switch to"]').first().click(), {
  untouched: () => onScreen(),
  undo: () => page.locator('header button[aria-label^="Switch to"]').first().click(),
  changesNothing: true,
});

// THE MARKS: each dropped on the first page; every other page's pictures are untouched.
if (wanted('stamp') || wanted('image') || wanted('signature') || wanted('picture signature')) await section('Comment');
await measure(
  'stamp',
  () => page.getByRole('dialog', { name: 'Choose a stamp' }).getByRole('button', { name: 'Add stamp', exact: true }).click(),
  {
    prepare: async () => {
      await arm('annotate.stamp');
      await dragOnPage(80, 530, 280, 590);
      await page.getByRole('dialog', { name: 'Choose a stamp' }).waitFor({ timeout: 15_000 });
    },
    untouched: allBut([0]),
    undo: putDownAndUndo,
  },
);
const picture = join(output, 'picture.png');
await writeFile(picture, await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 120 } }));
await measure('image', () => dragOnPage(80, 530, 280, 630), {
  prepare: async () => {
    await pickFiles([picture]);
    await arm('annotate.image');
  },
  untouched: allBut([0]),
  undo: putDownAndUndo,
});
/** Places the chosen signature with a click on the first page. */
const clickToSign = async () => {
  const at = await slot();
  await page.mouse.click(at.x + 270 * at.scale, at.y + 560 * at.scale);
};
await measure('signature', clickToSign, {
  prepare: async () => {
    await command('Signature');
    const chooser = page.getByRole('dialog', { name: 'Signature' });
    await chooser.getByRole('button', { name: 'Type' }).click();
    await chooser.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace');
    await chooser.getByRole('img', { name: 'Your signature, as it will be placed' }).waitFor();
    await chooser.getByRole('button', { name: 'Use Signature' }).click();
    await chooser.waitFor({ state: 'hidden' });
  },
  untouched: allBut([0]),
  undo: putDownAndUndo,
});
await measure('picture signature', clickToSign, {
  prepare: async () => {
    await command('Signature');
    const chooser = page.getByRole('dialog', { name: 'Signature' });
    await chooser.getByRole('button', { name: 'Upload' }).click();
    await pickFiles([picture]);
    await chooser.getByRole('button', { name: 'Choose picture…' }).click();
    await chooser.getByRole('img').first().waitFor();
    await chooser.getByRole('button', { name: 'Use Signature' }).click();
    await chooser.waitFor({ state: 'hidden' });
  },
  untouched: allBut([0]),
  undo: putDownAndUndo,
});

// EDIT TEXT: a block's words changed and committed; the first page redraws, no other.
if (wanted('edit text')) await section('Edit');
await measure(
  'edit text',
  async () => {
    await page.keyboard.type(' X');
    await page.keyboard.press('Escape');
  },
  {
    prepare: async () => {
      await arm('text.edit');
      const block = page.locator('[data-text-edit-layer] [data-text-block]').first();
      await block.waitFor({ timeout: 30_000 });
      await block.click();
      await page.locator('[data-text-editor]').waitFor({ timeout: 15_000 });
      await page.keyboard.press('End');
    },
    untouched: allBut([0]),
    undo: async () => {
      await page.keyboard.press('Escape');
      await disarm('text.edit');
      await undo();
    },
    // THE FIRST EDIT IS THE COLD ONE, measured at 9.7 s from the commit to the page in 0.1.17.0.
    windowMs: 12_000,
  },
);

// A FORM FIELD'S DESIGN: the field's border recoloured from its Properties; the first page redraws, no other.
await measure('field design change', () => page.getByRole('button', { name: 'Red' }).first().click(), {
  prepare: async () => {
    await command('Edit fields');
    await page.locator('[data-field-box]').first().click();
    await page.getByRole('button', { name: 'Red' }).first().waitFor({ timeout: 15_000 });
  },
  untouched: allBut([0]),
  undo: putDownAndUndo,
});
if (wanted('edit text') || wanted('field design change')) await section('Home');

// TAB SWITCH: a second document, then back to the first; the first's pages on show again may not blank on return.
if (wanted('tab switch') || wanted('parked tab rebuild')) {
  await walk.open(second);
  await settle();
}
await measure('tab switch', () => page.locator('.m-tab').first().click(), { undo: () => page.locator('.m-tab').nth(1).click() });
if (wanted('tab switch') || wanted('parked tab rebuild')) await page.locator('.m-tab').first().click();
// A PARKED TAB COMING BACK: after `PARK_AFTER_MS` (60 s) behind with nothing to lose, a layer mounts nothing, so going
// back to it builds the layer again — which must draw behind the one on show and come forward whole. THE SECOND
// DOCUMENT is the one that parks: no command has applied to it, where the first has had every one above.
await measure(
  'parked tab rebuild',
  async () => {
    await page.locator('.m-tab').nth(1).click();
    await page.waitForSelector('[data-document-layer="parked"]', { state: 'detached', timeout: 30_000 });
  },
  {
    undo: () => page.locator('.m-tab').first().click(),
    prepare: async () => {
      await page.waitForSelector('[data-document-layer="parked"]', { state: 'attached', timeout: 120_000 });
    },
  },
);

/** Deletes the page on show, answering the dialog. */
const deleteShown = async () => {
  await command('Delete pages…');
  await page.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete pages', exact: true }).click();
};
// DELETE: the first page goes; the pages after it move up and may not blank on the way.
await measure('delete page', deleteShown, { undo });

// ORGANIZE: the same page commands, judged on its cards. The first card is chosen before each.
if (wanted('organize rotate') || wanted('organize move') || wanted('organize delete')) {
  await section('Organize');
  await page.locator('[data-page-view] canvas.m-thumb-canvas[data-drawn="true"]:visible').first().waitFor({ timeout: 30_000 });
  await settle();
}
const chooseFirstCard = async () => {
  await page.locator('[data-page-view] .m-thumbnails button').first().click();
};
await measure('organize rotate', () => command('Rotate page'), { prepare: chooseFirstCard, untouched: allBut([0]), undo });
await measure('organize move', () => command('Move page down'), { prepare: chooseFirstCard, untouched: allBut([0, 1]), undo });
await measure('organize delete', deleteShown, { prepare: chooseFirstCard, undo });

await writeFile(join(output, 'blink.json'), `${JSON.stringify({ runs, windowMs: WINDOW_MS, results }, null, 2)}\n`);
await finish();
