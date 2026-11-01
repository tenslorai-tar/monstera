// @ts-check
/**
 * The text layer walk (cloud run 30, ADR-0280; LOCAL-MERGE-RUN-30.md and LOCAL-RUN-30-TAKEOVER.md step 5): presses,
 * drags, double and triple clicks, search, the markups, the redaction, Copy, the assistant's items and the exports,
 * done in the running app with a real mouse and keyboard, each step screenshotted and recorded by `liveWalk.mjs`.
 *
 * Every expectation is a letter's place as the engine reads it, stated from the fixture's own font metrics: the page is
 * set in the standard Times, whose widths `textLetters.test.ts` holds MuPDF to within 0.005 pt. So a step that lands on
 * the browser's layout of the substitute face, or on a whole point, lands visibly away from what is asserted.
 *
 * ## The same walk, two builds
 *
 * `--app-root <checkout>` launches another checkout's built app — a worktree of `main`, for the merge's *nothing that
 * worked before breaks* — while the walk, its fixtures and its output stay here. Each step records what it read, so the
 * two reports are compared step by step. A step whose rule the earlier build never had (the engine's letters) is
 * expected to differ there, and its record says what that build did.
 *
 * `--reopen <saved.pdf>` opens a file an earlier run saved, and screenshots its first page: a markup saved by one build
 * and opened by the other, which must look the same.
 *
 * No AI service is called: the assistant's items are taken to the point where they would send, never past it.
 *
 *   node scripts/research/textLayerWalk.mjs [--app-root <checkout>] [--reopen <saved.pdf>]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { root, startWalk, writesDone, writesLanded } from './liveWalk.mjs';
import { savedWords } from './savedPdf.mjs';

refuseStaleBuild(root, [['packages/kernel/src/producerSubsetFixture.ts', 'packages/kernel/dist/producerSubsetFixture.js', 'tsc']], 1);

const expect = defaultExpect.configure({ timeout: 30_000 });

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const SIZE = 12;
const X0 = 72;
const WIDTH = 612;
const HEIGHT = 792;
/** The lines every turned page carries, each at x 72, in Times 12. */
const LINES = [
  { text: 'This Agreement shall commence on the Effective Date and continue for the term of', baseline: 700 },
  { text: 'twelve months, unless ended sooner under clause 9.', baseline: 684 },
  { text: 'Notice must be given in writing to the other party.', baseline: 668 },
  { text: 'Recieve the notise promptly.', baseline: 652 },
];
const ROTATIONS = /** @type {const} */ ([0, 90, 180, 270]);
/** The angled page's one line, turned 20 degrees about its start. */
const ANGLE = 20;
const ANGLED = { x: 72, y: 400 };

/** Each UTF-16 boundary of `text` along its baseline, from its start, in points. @param {import('@cantoo/pdf-lib').PDFFont} font @param {string} text */
function boundaries(font, text) {
  const places = [0];
  for (const letter of text) places.push((places.at(-1) ?? 0) + font.widthOfTextAtSize(letter, SIZE));
  return places;
}

/** The walk's document: the four lines on pages turned 0, 90, 180 and 270, and the first line angled on a fifth. */
async function layerPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.TimesRoman);
  for (const rotation of ROTATIONS) {
    const page = document.addPage([WIDTH, HEIGHT]);
    page.setRotation(degrees(rotation));
    for (const line of LINES) page.drawText(line.text, { x: X0, y: line.baseline, size: SIZE, font });
  }
  const angled = document.addPage([WIDTH, HEIGHT]);
  angled.drawText(LINES[0]?.text ?? '', { x: ANGLED.x, y: ANGLED.y, size: SIZE, font, rotate: degrees(ANGLE) });
  return { bytes: await document.save(), places: LINES.map((line) => boundaries(font, line.text)) };
}

/** A page with one picture placed off whole points and one line of text, for the exports. */
async function picturePdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([WIDTH, HEIGHT]);
  // A PNG drawn on the app's own canvas, two colours in two halves, so the picture has an encoder's real bytes.
  const base64 = await page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    const canvas = w.document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    const pen = canvas.getContext('2d');
    if (pen === null) throw new Error('the renderer has no 2d canvas');
    pen.fillStyle = '#2b6cb0';
    pen.fillRect(0, 0, 30, 40);
    pen.fillStyle = '#e8a33d';
    pen.fillRect(30, 0, 30, 40);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  const image = await document.embedPng(Buffer.from(base64, 'base64'));
  sheet.drawImage(image, { x: 72.37, y: 500.41, width: 144.25, height: 96.13 });
  sheet.drawText('A picture placed off whole points stands above this line.', { x: 72, y: 470, size: 12, font });
  return document.save();
}

const appRoot = option('app-root');
const reopen = option('reopen');
const walk = await startWalk('text-layer', appRoot === undefined ? {} : { appRoot });
const { app, page, output, open, saveTo, command, step, finish } = walk;

const { bytes, places } = await layerPdf();
const documentPath = join(output, 'layer.pdf');
await writeFile(documentPath, bytes);
const picturePath = join(output, 'picture.pdf');
await writeFile(picturePath, await picturePdf());
const { buildProducerSubsetPdf } = await import('../../packages/kernel/dist/producerSubsetFixture.js');
const { fontsDirectory } = await import('../provision/fonts.mjs');
const fonts = fontsDirectory(root);
const uninstalledPath = join(output, 'uninstalled-font.pdf');
await writeFile(
  uninstalledPath,
  await buildProducerSubsetPdf(await readFile(join(fonts, 'Caladea-Regular.ttf')), await readFile(join(fonts, 'Caladea-Bold.ttf')), {
    regular: 'Caladea',
    bold: 'Caladea-Bold',
  }),
);

/**
 * The text layer of page `index` in the document on show, its lines arrived, and its box on the window. A page further
 * down has no layer until it is near the window, so it is gone to first through the status bar's *Go to page*, as a
 * person types a page number. VISIBLE ONLY: a document in another tab keeps its layers, hidden. @param {number} index
 */
async function layerOf(index) {
  const layer = page.locator(`[data-text-layer="${String(index)}"]:visible`);
  if ((await layer.count()) === 0) {
    const field = page.getByRole('textbox', { name: 'Go to page' });
    await field.fill(String(index + 1));
    await field.press('Enter');
    await expect(layer).toHaveCount(1);
  }
  await layer.scrollIntoViewIfNeeded();
  await expect(layer.locator('[data-text-line]').first()).toBeAttached();
  await page.waitForTimeout(300);
  const box = await layer.boundingBox();
  if (box === null) throw new Error(`page ${String(index + 1)}'s text layer has no box`);
  return box;
}

/**
 * Where a point of page `index` in PDF user space is on the window: through the page's turn, in the turned page's
 * display space, scaled to the layer's box. @param {number} index @param {number} x @param {number} y
 */
async function onScreen(index, x, y) {
  const box = await layerOf(index);
  const rotation = index < ROTATIONS.length ? (ROTATIONS[index] ?? 0) : 0;
  const shown = rotation === 90 || rotation === 270 ? { width: HEIGHT, height: WIDTH } : { width: WIDTH, height: HEIGHT };
  const scale = box.width / shown.width;
  const display =
    rotation === 0 ? { x, y: HEIGHT - y } : rotation === 90 ? { x: y, y: x } : rotation === 180 ? { x: WIDTH - x, y } : { x: HEIGHT - y, y: WIDTH - x };
  return { x: box.x + display.x * scale, y: box.y + display.y * scale };
}

/** The middle-height point `fraction` along letter `letter` of line `line` on page `index`. @param {number} index @param {number} line @param {number} letter @param {number} fraction */
async function onLetter(index, line, letter, fraction) {
  const at = places[line] ?? [];
  const along = (at[letter] ?? 0) + ((at[letter + 1] ?? 0) - (at[letter] ?? 0)) * fraction;
  const baseline = LINES[line]?.baseline ?? 0;
  if (index === ROTATIONS.length) {
    const angle = (ANGLE * Math.PI) / 180;
    const up = SIZE / 3;
    return onScreen(index, ANGLED.x + along * Math.cos(angle) - up * Math.sin(angle), ANGLED.y + along * Math.sin(angle) + up * Math.cos(angle));
  }
  return onScreen(index, X0 + along, baseline + SIZE / 3);
}

/** The selection's two ends as page, line and offset, and its text. */
function readSelection() {
  return page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    const selection = w.document.getSelection();
    /** @param {any} node @param {number} offset */
    const where = (node, offset) => {
      const element = (node instanceof w.Element ? node : (node?.parentElement ?? null))?.closest('[data-text-line]') ?? null;
      const layer = element?.closest('[data-text-layer]') ?? null;
      if (element === null || layer === null) return null;
      const inText = node?.nodeType === w.Node.TEXT_NODE ? offset : offset === 0 ? 0 : (element.textContent ?? '').length;
      return { page: Number(layer.getAttribute('data-text-layer')), line: Number(element.getAttribute('data-text-line')), offset: inText };
    };
    return {
      anchor: where(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
      focus: where(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
      collapsed: selection?.isCollapsed ?? true,
      text: selection?.toString() ?? '',
    };
  });
}

/** The painted selection's polygons on page `index`, each as its points on the window. @param {number} index @param {'selection' | 'matches'} surface */
function painted(index, surface = 'selection') {
  return page.evaluate(
    ({ at, which }) => {
      const w = /** @type {any} */ (globalThis);
      const svg = [...w.document.querySelectorAll(`[data-text-layer="${String(at)}"] .m-text-layer__${which}`)].find(
        (/** @type {any} */ each) => each.closest('[data-text-layer]').getBoundingClientRect().width > 0,
      );
      if (svg === undefined) return [];
      const origin = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('polygon')].map((/** @type {any} */ polygon) =>
        String(polygon.getAttribute('points') ?? '')
          .trim()
          .split(/\s+/u)
          .map((pair) => pair.split(',').map(Number))
          .map(([x = 0, y = 0]) => ({ x: origin.left + x, y: origin.top + y })),
      );
    },
    { at: index, which: surface },
  );
}

/**
 * A drag by a hand: a click away on blank paper first, so the press does not land inside the last selection (which the
 * browser would start dragging as text), then down at `from`, through `via` in `steps` moves a leg, up at the last. The
 * paper is the middle of the page `from` is on, which every page of this walk's document leaves blank, kept inside the
 * window. @param {{ x: number, y: number }} from @param {{ x: number, y: number }[]} via @param {number} steps
 */
async function drag(from, via, steps) {
  for (const layer of await page.locator('[data-text-layer]:visible').all()) {
    const box = await layer.boundingBox();
    if (box === null || from.x < box.x || from.x > box.x + box.width || from.y < box.y || from.y > box.y + box.height) continue;
    await page.mouse.click(box.x + box.width / 2, Math.min(Math.max(box.y + box.height / 2, 240), 840));
    await page.waitForTimeout(700);
    break;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const to of via) await page.mouse.move(to.x, to.y, { steps });
  const held = await readSelection();
  await page.mouse.up();
  return held;
}

/** Waits out the double-click interval, so the next press is a first one. */
const apart = () => page.waitForTimeout(700);

/** A selection's end, written as the expectation is. @param {{ page: number, line: number, offset: number } | null} end */
const named = (end) => (end === null ? 'nowhere' : `page ${String(end.page + 1)} line ${String(end.line)} offset ${String(end.offset)}`);

await step('open the walk’s document: four turned pages and an angled line, in Times, each page fitted to the window', async () => {
  await open(documentPath);
  // FITTED, so a turned page's text is on the window: at 100% the 90-degree page's line stands under the side panel and
  // the 180-degree page's below the window's foot.
  await page.getByRole('button', { name: 'Fit page', exact: true }).first().click();
  for (let index = 0; index <= ROTATIONS.length; index += 1) await layerOf(index);
});

for (const [index, rotation] of ROTATIONS.entries()) {
  await step(`PRESS at a letter's start, middle and end on the page turned ${String(rotation)}: the caret is the engine's`, async () => {
    const misses = [];
    // LETTERS, NOT SPACES: a space is 2.4 px wide on the fitted page, so 0.65 along one is 0.36 px past its middle,
    // inside the 0.4 px this walk's own mapping rounds by on a page measured from its right edge (turned 180).
    for (const letter of [3, 22, 40]) {
      for (const fraction of [0.1, 0.35, 0.65, 0.9]) {
        const at = await onLetter(index, 0, letter, fraction);
        await page.mouse.click(at.x, at.y);
        const read = await readSelection();
        const wanted = { page: index, line: 0, offset: letter + (fraction > 0.5 ? 1 : 0) };
        if (!read.collapsed || named(read.focus) !== named(wanted)) misses.push(`letter ${String(letter)} at ${String(fraction)}: ${named(read.focus)}, wanted ${named(wanted)}`);
        await apart();
      }
    }
    if (misses.length > 0) throw new Error(`${String(misses.length)} of 12 presses missed: ${misses.join('; ')}`);
    return { presses: 12 };
  });
}

for (const index of [0, 2]) {
  const rotation = ROTATIONS[index] ?? 0;
  for (const [pace, steps] of /** @type {const} */ ([['slow', 30], ['fast', 2]])) {
    await step(`DRAG ${pace} on the page turned ${String(rotation)}: across a line end and back, and off the page and back`, async () => {
      const start = await onLetter(index, 0, 10, 0.65);
      // LETTER 5 OF *twelve months*, its last *e*: a letter, for the presses' reason.
      const down = await onLetter(index, 1, 5, 0.65);
      const back = await onLetter(index, 0, 30, 0.65);
      const box = await layerOf(index);
      const away = { x: box.x + box.width + 60, y: back.y };
      const across = await drag(start, [down], steps);
      await apart();
      const there = await drag(start, [down, back], steps);
      await apart();
      const off = await drag(start, [away, back], steps);
      const shapes = await painted(index);
      const problems = [];
      const anchor = named({ page: index, line: 0, offset: 11 });
      if (named(across.anchor) !== anchor || named(across.focus) !== named({ page: index, line: 1, offset: 6 })) problems.push(`across: ${named(across.anchor)} to ${named(across.focus)}`);
      for (const [label, read] of /** @type {const} */ ([['back', there], ['off the page and back', off]])) {
        if (named(read.anchor) !== anchor || named(read.focus) !== named({ page: index, line: 0, offset: 31 })) problems.push(`${label}: ${named(read.anchor)} to ${named(read.focus)}`);
      }
      // ONE BAND, on the run's letters: one polygon on the one line, its corners at the engine's boundaries 11 and 31.
      const corners = [await onLetter(index, 0, 11, 0), await onLetter(index, 0, 31, 0)];
      const reach = (/** @type {{ x: number, y: number }} */ point) => Math.min(...(shapes[0] ?? []).map((each) => Math.hypot(each.x - point.x, (each.y - point.y) * 0)));
      if (shapes.length !== 1) problems.push(`${String(shapes.length)} painted shapes for a one-line run`);
      else if (rotation === 0 && corners.some((corner) => reach(corner) > 1)) problems.push(`the band's ends stand ${corners.map((corner) => reach(corner).toFixed(2)).join(' and ')} px from the letters'`);
      if (problems.length > 0) throw new Error(problems.join('; '));
      return { steps, shapes: shapes.length };
    });
    await apart();
  }
}

await step('FLICKER: a slow drag recorded frame by frame — no frame shows a choice the engine did not make', async () => {
  const start = await onLetter(0, 0, 4, 0.65);
  const end = await onLetter(0, 0, 60, 0.65);
  await page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    const frames = /** @type {{ x: number, focus: number | null, collapsed: boolean, shapes: string }[]} */ ([]);
    let x = 0;
    const surface = w.document.querySelector('[data-text-layer="0"] .m-text-layer__selection');
    // READ AS THE FRAME IS DRAWN: frame callbacks run in the order they were asked for, so this one is asked for from a
    // listener added after the application's, and runs after any paint the application asked for that frame. A
    // free-running callback asked for in the frame before ran first, and read a frame before its paint.
    let asked = false;
    const tick = () => {
      asked = false;
      const selection = w.document.getSelection();
      const node = selection?.focusNode ?? null;
      frames.push({
        x,
        focus: node?.nodeType === w.Node.TEXT_NODE ? (selection?.focusOffset ?? null) : null,
        collapsed: selection?.isCollapsed ?? true,
        shapes: surface?.getAttribute('data-shapes') ?? '',
      });
    };
    w.document.addEventListener(
      'pointermove',
      (/** @type {{ clientX: number }} */ event) => {
        x = event.clientX;
        if (asked || w.__walkFrames === undefined) return;
        asked = true;
        w.requestAnimationFrame(tick);
      },
      { capture: true },
    );
    w.__walkFrames = frames;
  });
  await drag(start, [end], 80);
  const frames = /** @type {{ x: number, focus: number | null, collapsed: boolean, shapes: string }[]} */ (
    await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      const kept = w.__walkFrames;
      delete w.__walkFrames;
      return kept;
    })
  );
  // THE ENGINE'S CARET FOR EACH FRAME'S POINTER, from the fixture's boundaries.
  const box = await layerOf(0);
  const scale = box.width / WIDTH;
  const at = places[0] ?? [];
  const caretFor = (/** @type {number} */ x) => {
    const along = (x - box.x) / scale - X0;
    let best = 0;
    for (let letter = 0; letter < at.length - 1; letter += 1) {
      const middle = ((at[letter] ?? 0) + (at[letter + 1] ?? 0)) / 2;
      if (along >= middle) best = letter + 1;
    }
    return best;
  };
  const moving = frames.filter((frame, index) => index > 0 && frame.x !== 0 && frame.focus !== null && !frame.collapsed);
  const off = moving.filter((frame) => frame.focus !== caretFor(frame.x));
  // EVERY FRAME ON THE ENGINE'S CARET: each is read after the move it follows was handled, so a frame one letter off is
  // the browser's own choice for that move, drawn before the correction landed.
  const elsewhere = off;
  const unpainted = moving.filter((frame) => frame.shapes === '');
  const where = [
    ...elsewhere.map((frame) => `frame ${String(moving.indexOf(frame))}: caret ${String(frame.focus)}, the engine's ${String(caretFor(frame.x))}`),
    ...unpainted.map((frame) => `frame ${String(moving.indexOf(frame))}: nothing painted, caret ${String(frame.focus)}`),
  ];
  if (elsewhere.length > 0 || unpainted.length > 0) {
    throw new Error(
      `${String(elsewhere.length)} of ${String(moving.length)} frames holding a selection showed a caret more than a letter from the engine's (${where.join('; ')}), and ${String(unpainted.length)} showed nothing painted`,
    );
  }
  return { frames: moving.length, oneLetterBehind: off.length, elsewhere: elsewhere.length };
});

await step('THEMES: a run selected is painted in light, dark and high contrast', async () => {
  await apart();
  await drag(await onLetter(0, 0, 10, 0.65), [await onLetter(0, 0, 40, 0.65)], 10);
  const counts = { light: (await painted(0)).length, dark: 0, contrast: 0 };
  await page.screenshot({ path: join(output, 'theme-light.png') });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.waitForTimeout(300);
  counts.dark = (await painted(0)).length;
  await page.screenshot({ path: join(output, 'theme-dark.png') });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.emulateMedia({ forcedColors: 'active' });
  await page.waitForTimeout(300);
  counts.contrast = (await painted(0)).length;
  await page.screenshot({ path: join(output, 'theme-contrast.png') });
  await page.emulateMedia({ forcedColors: 'none' });
  if (counts.light !== 1 || counts.dark !== 1 || counts.contrast !== 1) throw new Error(`painted shapes: ${JSON.stringify(counts)}`);
  return counts;
});

for (const index of [0, 2]) {
  const rotation = ROTATIONS[index] ?? 0;
  await step(`DOUBLE AND TRIPLE CLICK on the page turned ${String(rotation)}: the engine's word, its line, and a double then a triple`, async () => {
    const effective = (LINES[0]?.text ?? '').indexOf('Effective');
    const at = await onLetter(index, 0, effective + 3, 0.5);
    await apart();
    await page.mouse.dblclick(at.x, at.y);
    const word = (await readSelection()).text;
    await apart();
    await page.mouse.click(at.x, at.y, { clickCount: 3 });
    await page.waitForTimeout(100);
    const line = (await readSelection()).text;
    await apart();
    await page.mouse.dblclick(at.x, at.y);
    await page.mouse.click(at.x, at.y, { clickCount: 3 });
    await page.waitForTimeout(100);
    const after = (await readSelection()).text;
    const problems = [];
    if (word !== 'Effective') problems.push(`the double click took ${JSON.stringify(word)}`);
    if (line.trim() !== LINES[0]?.text) problems.push(`the triple click took ${JSON.stringify(line)}`);
    if (after.trim() !== LINES[0]?.text) problems.push(`a double then a triple took ${JSON.stringify(after)}`);
    if (problems.length > 0) throw new Error(problems.join('; '));
    return { word, line: line.trim().length };
  });
}

await step('ANGLED LINE: a drag along a line turned 20 degrees takes the engine’s letters, painted along them', async () => {
  await apart();
  const read = await drag(await onLetter(ROTATIONS.length, 0, 10, 0.65), [await onLetter(ROTATIONS.length, 0, 40, 0.65)], 12);
  const shapes = await painted(ROTATIONS.length);
  const wanted = [named({ page: ROTATIONS.length, line: 0, offset: 11 }), named({ page: ROTATIONS.length, line: 0, offset: 41 })];
  if (named(read.anchor) !== wanted[0] || named(read.focus) !== wanted[1] || shapes.length !== 1) {
    throw new Error(`${named(read.anchor)} to ${named(read.focus)}, ${String(shapes.length)} shapes; wanted ${wanted.join(' to ')} and one`);
  }
  return { text: read.text };
});

await step('SEARCH: the matches of “the” are painted on the engine’s words', async () => {
  await layerOf(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+F');
  await page.locator('[data-find-input="true"]').fill('the');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const shapes = await painted(0, 'matches');
  const wanted = LINES.flatMap((line, at) => [...line.text.matchAll(/the/giu)].map((match) => ({ line: at, from: match.index })));
  const starts = await Promise.all(wanted.map((each) => onLetter(0, each.line, each.from, 0)));
  const nearest = starts.map((start) => Math.min(...shapes.map((shape) => Math.min(...shape.map((point) => Math.hypot(point.x - start.x, (point.y - start.y) * 0.1))))));
  const far = nearest.filter((distance) => distance > 1.5);
  await page.keyboard.press('Escape');
  if (shapes.length !== wanted.length || far.length > 0) {
    throw new Error(`${String(shapes.length)} matches painted for ${String(wanted.length)} on the page; ${String(far.length)} stand over 1.5 px from their word (${nearest.map((each) => each.toFixed(2)).join(', ')})`);
  }
  return { matches: shapes.length, farthestPx: Math.max(...nearest) };
});

/** The menu item `name` on a run of line `line`, letters `from` to `to`, dragged first. @param {string} name @param {number} line @param {number} from @param {number} to */
async function fromMenu(name, line, from, to) {
  await apart();
  await drag(await onLetter(0, line, from, 0.65), [await onLetter(0, line, to, 0.65)], 10);
  const on = await onLetter(0, line, Math.round((from + to) / 2), 0.5);
  await page.mouse.click(on.x, on.y, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}

const MARKS = /** @type {const} */ ([
  ['Highlight', 'Highlight', 0],
  ['Underline', 'Underline', 1],
  ['Strikethrough', 'StrikeOut', 2],
  ['Mark for redaction', 'Redact', 3],
]);
for (const [name, , line] of MARKS) {
  await step(`MARKUP: ${name} from a selection`, async () => {
    const before = await writesDone(page);
    await fromMenu(name, line, 2, 12);
    await writesLanded(page, before);
  });
}

const savedPath = join(output, 'marked.pdf');
await step('SAVED: every markup is in the file at the engine’s letters, read by pdf-lib', async () => {
  await saveTo(savedPath);
  await command('Save a copy…');
  // THE REDACTION MARK IS PENDING, so the save asks first (*Redactions not applied*); the marks are what is being saved.
  await page.getByRole('dialog').getByRole('button', { name: / without applying$/u }).click();
  await expect.poll(async () => (await readFile(savedPath).catch(() => null)) !== null).toBe(true);
  await page.waitForTimeout(500);
  const loaded = await PDFDocument.load(await readFile(savedPath), { updateMetadata: false });
  const annots = loaded.getPages()[0]?.node.Annots();
  /** @type {Record<string, number[]>} */
  const quads = {};
  for (const ref of annots instanceof PDFArray ? annots.asArray() : []) {
    const dict = loaded.context.lookup(ref, PDFDict);
    const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '';
    const points = dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray);
    if (points !== undefined) quads[subtype] = points.asArray().map((each) => (each instanceof PDFNumber ? each.asNumber() : NaN));
  }
  const problems = [];
  for (const [name, subtype, line] of MARKS) {
    const xs = (quads[subtype] ?? []).filter((_, at) => at % 2 === 0);
    const at = places[line] ?? [];
    const [from, to] = [X0 + (at[3] ?? 0), X0 + (at[13] ?? 0)];
    if (xs.length === 0) problems.push(`${name}: no QuadPoints`);
    else if (Math.abs(Math.min(...xs) - from) > 0.5 || Math.abs(Math.max(...xs) - to) > 0.5) {
      problems.push(`${name}: x ${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}, the letters ${from.toFixed(2)} to ${to.toFixed(2)}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
  return { quads: Object.keys(quads) };
});

await step('REOPENED: the saved markups are drawn on the letters', async () => {
  await open(savedPath);
  await layerOf(0);
  await page.screenshot({ path: join(output, 'reopened-marks.png') });
});

await step('APPLY REDACTIONS: the marked words leave the saved file', async () => {
  const before = await writesDone(page);
  await command('Apply redactions');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply redactions', exact: true }).click();
  await writesLanded(page, before);
  const redacted = join(output, 'redacted.pdf');
  await saveTo(redacted);
  await command('Save a copy…');
  await expect.poll(async () => (await readFile(redacted).catch(() => null)) !== null).toBe(true);
  await page.waitForTimeout(500);
  const words = (await savedWords(redacted))[0] ?? '';
  const gone = (LINES[3]?.text ?? '').slice(3, 13);
  if (words.includes(gone.trim())) throw new Error(`the saved page still reads ${JSON.stringify(gone)}: ${words.slice(0, 200)}`);
  return { remaining: words.length };
});

await step('COPY across a line end: the words, with the space', async () => {
  await open(documentPath);
  await layerOf(0);
  const first = LINES[0]?.text ?? '';
  await apart();
  await drag(await onLetter(0, 0, first.length - 8, 0.65), [await onLetter(0, 1, 5, 0.65)], 10);
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(200);
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  const wanted = `${first.slice(first.length - 7)} ${(LINES[1]?.text ?? '').slice(0, 6)}`;
  if (copied !== wanted) throw new Error(`copied ${JSON.stringify(copied)}, wanted ${JSON.stringify(wanted)}`);
  return { copied };
});

await step('ASK AI quotes the run in the assistant’s box (nothing is sent)', async () => {
  await fromMenu('Ask AI', 0, 10, 40);
  const quoted = await page.getByLabel('Ask about this document').inputValue();
  const wanted = `“${(LINES[0]?.text ?? '').slice(11, 41).trim()}” `;
  if (quoted !== wanted) throw new Error(`the box holds ${JSON.stringify(quoted)}, wanted ${JSON.stringify(wanted)}`);
  return { quoted };
});

await step('RIGHT-CLICK STRAIGHT AFTER A DRAG, then Translate: the menu offers it for the run (nothing is sent)', async () => {
  await page.keyboard.press('Escape');
  await layerOf(0);
  await apart();
  const end = await onLetter(0, 0, 40, 0.65);
  await drag(await onLetter(0, 0, 10, 0.65), [end], 10);
  await page.mouse.click(end.x, end.y, { button: 'right' });
  const item = page.getByRole('menu').getByRole('menuitem', { name: 'Translate', exact: true });
  await expect(item).toBeVisible();
  const held = (await readSelection()).text;
  await item.click();
  await page.waitForTimeout(800);
  const dialogs = await page.locator('[role=dialog]').allInnerTexts();
  await page.keyboard.press('Escape');
  if (held !== (LINES[0]?.text ?? '').slice(11, 41)) throw new Error(`the run held at the right-click was ${JSON.stringify(held)}`);
  return { held, opened: dialogs.map((text) => text.replaceAll(/\s+/gu, ' ').slice(0, 160)) };
});

await step('SPELL CHECK marks the misspelt word on its letters', async () => {
  await page.keyboard.press('Escape');
  await layerOf(0);
  await command('Spell check');
  await page.waitForTimeout(2000);
  const shapes = [...(await painted(0, 'matches')), ...(await painted(0, 'selection'))];
  const from = await onLetter(0, 3, 0, 0);
  const to = await onLetter(0, 3, 7, 0);
  const fits = shapes.some((shape) => Math.abs(Math.min(...shape.map((point) => point.x)) - from.x) < 1.5 && Math.abs(Math.max(...shape.map((point) => point.x)) - to.x) < 1.5);
  const spans = shapes.map((shape) => `${Math.min(...shape.map((point) => point.x)).toFixed(1)} to ${Math.max(...shape.map((point) => point.x)).toFixed(1)} at y ${Math.min(...shape.map((point) => point.y)).toFixed(1)}`);
  if (!fits) throw new Error(`no painted shape stands on “Recieve”, ${from.x.toFixed(1)} to ${to.x.toFixed(1)} at y ${from.y.toFixed(1)}: ${spans.join('; ')}`);
  return { shapes: shapes.length };
});

await step('A FONT THAT IS NOT INSTALLED (Caladea): a double click, a triple click and a drag take the page’s words', async () => {
  await page.keyboard.press('Escape');
  await open(uninstalledPath);
  await layerOf(0);
  const line = page.locator('[data-text-layer="0"]:visible [data-text-line]').first();
  const text = (await line.textContent()) ?? '';
  const box = await line.boundingBox();
  if (box === null) throw new Error('the line has no box');
  // THE ENGINE'S WORD UNDER A POINT a third of the way along the line, whichever it is: a double click must take a whole
  // word of the line's text, and a triple the line.
  const at = { x: box.x + box.width / 3, y: box.y + box.height / 2 };
  await apart();
  await page.mouse.dblclick(at.x, at.y);
  const double = (await readSelection()).text;
  await apart();
  await page.mouse.click(at.x, at.y, { clickCount: 3 });
  await page.waitForTimeout(100);
  const triple = (await readSelection()).text;
  const words = text.split(/\s+/u);
  if (!words.includes(double)) throw new Error(`the double click took ${JSON.stringify(double)}, which is no word of ${JSON.stringify(text)}`);
  if (triple.trim() !== text.trim()) throw new Error(`the triple click took ${JSON.stringify(triple)}`);
  return { double, line: text };
});

/** Each part of an exported Office file as text, read by fflate. @param {string} path */
async function partsOf(path) {
  const parts = unzipSync(new Uint8Array(await readFile(path)));
  return Object.fromEntries(Object.entries(parts).map(([name, data]) => [name, name.endsWith('.xml') || name.endsWith('.rels') ? strFromU8(data) : `(${String(data.length)} bytes)`]));
}

for (const [title, extension] of /** @type {const} */ ([['Export to Word…', 'docx'], ['Export to PowerPoint…', 'pptx']])) {
  await step(`${title.replace('…', '')}: the line and the picture placed off whole points are both in the file`, async () => {
    await page.keyboard.press('Escape');
    await open(picturePath);
    const target = join(output, `picture.${extension}`);
    await saveTo(target);
    await command(title);
    // THE DIALOG'S OWN DEFAULTS, a typed document and every page, and its one way on.
    await page.getByRole('dialog').getByRole('button', { name: 'Choose where to save…', exact: true }).click();
    await expect.poll(async () => (await readFile(target).catch(() => null)) !== null, { timeout: 120_000 }).toBe(true);
    await page.waitForTimeout(1000);
    const parts = await partsOf(target);
    const media = Object.keys(parts).filter((name) => /\/media\//u.test(name));
    const words = Object.values(parts).some((text) => text.includes('placed off whole points'));
    if (media.length === 0 || !words) throw new Error(`media ${JSON.stringify(media)}, words ${String(words)}`);
    return { media };
  });
}

if (reopen !== undefined) {
  await step('OPENED A FILE ANOTHER BUILD SAVED: its markup is drawn as it was', async () => {
    await page.keyboard.press('Escape');
    await open(reopen);
    await layerOf(0);
    await page.screenshot({ path: join(output, 'reopened-other-build.png') });
  });
}

await finish();
