// @ts-check
/**
 * What Edit text costs before a person can type: the first read of a page's blocks, and opening a dense block.
 *
 *   node scripts/research/editOpenCost.mjs --corpus <folder> --file <n> [--rounds <n>] [--app-root <checkout>]
 *
 * `--file` is the document's place in the folder's `.pdf` files sorted by name, so no document's name is printed or
 * written. Nothing here prints a word of a document either: a block is chosen by its outline's size, never its text.
 *
 * ## The two readings
 *
 * - **The first read** (`_review/NEXT-UPDATE.md` item 65): from the press of the ribbon's Edit text on a document just
 *   opened, to the first block outline in the page. Add text and Edit text both wait on this read the first time.
 * - **Opening a block** (items 28 and 64, the editor's 300 ms budget): from the first press on the page's largest block
 *   outline to the editor focused with its caret, through `editTextOpening`'s two presses, and the renderer's long tasks
 *   from that first press until two seconds after the editor took focus, since the fits re-run as the faces arrive. The
 *   700 ms between the two presses is a hand's pause (`openAt`), not the editor's cost, so the wall time is printed with
 *   it and the long tasks are the editor's figure.
 *
 * Each round opens the document afresh in a new tab and closes it without saving, so every round is a first read.
 *
 * ## The control, every run
 *
 * The long tasks come from Chromium's `longtask` entries, recorded in the page. Before any round the recorder must see a
 * task the script plants itself, a 150 ms busy loop, as one entry of at least 140 ms; otherwise nothing is reported,
 * because a recorder that sees nothing reads exactly like an editor that costs nothing (CLAUDE.md, item 4b).
 *
 * Nothing here is a pass or a fail. It prints each reading's median and its spread (fastest to slowest).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import { appRootOption, nothingInFlight, startWalk } from './liveWalk.mjs';
import { editTextOpening } from './textWalkSteps.mjs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const corpus = option('--corpus');
const fileNumber = Number(option('--file'));
const rounds = Number(option('--rounds') ?? '5');
if (corpus === undefined || !Number.isInteger(fileNumber) || !Number.isInteger(rounds) || rounds < 1) {
  throw new Error('usage: node scripts/research/editOpenCost.mjs --corpus <folder> --file <n> [--rounds <n>]');
}
const files = readdirSync(corpus)
  .filter((name) => name.toLowerCase().endsWith('.pdf'))
  .sort();
const chosen = files[fileNumber];
if (chosen === undefined) throw new Error(`the folder holds ${String(files.length)} PDF file(s); --file ${String(fileNumber)} names none`);
const documentPath = join(corpus, chosen);

const walk = await startWalk('edit-open-cost', appRootOption(process.argv));
const { page, open, section, finish, step } = walk;
const { openBlock } = editTextOpening(page);

/** Starts recording the renderer's long tasks into a list the script reads and empties. */
async function recordLongTasks() {
  await page.evaluate(() => {
    /** @type {{ start: number, duration: number }[]} */
    const tasks = [];
    Reflect.set(globalThis, '__longTasks', tasks);
    const Observer = /** @type {new (callback: (list: { getEntries: () => { startTime: number, duration: number }[] }) => void) => { observe: (options: unknown) => void }} */ (
      Reflect.get(globalThis, 'PerformanceObserver')
    );
    new Observer((list) => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: false });
  });
}
/** The long tasks recorded since the last call, emptied. @returns {Promise<{ start: number, duration: number }[]>} */
const takeLongTasks = () => page.evaluate(() => /** @type {{ start: number, duration: number }[]} */ (Reflect.get(globalThis, '__longTasks')).splice(0));
/** The renderer's clock, in the long tasks' own frame. */
const rendererNow = () => page.evaluate(() => /** @type {{ now: () => number }} */ (Reflect.get(globalThis, 'performance')).now());

await recordLongTasks();
{
  // THE CONTROL: a task this script plants must be recorded, or every figure below is a blind recorder's silence.
  await takeLongTasks();
  // FROM A TIMER IN THE PAGE, a task of the page's own event loop as a press's handler is. Run in the evaluate call
  // itself it was not recorded (2026-11-11, `[]`), which is what the editor's tasks are not.
  await page.evaluate(() => {
    const clock = /** @type {{ now: () => number }} */ (Reflect.get(globalThis, 'performance'));
    const later = /** @type {(run: () => void, ms: number) => void} */ (Reflect.get(globalThis, 'setTimeout'));
    later(() => {
      const until = clock.now() + 150;
      while (clock.now() < until) {
        // the planted task
      }
    }, 0);
  });
  await page.waitForTimeout(300);
  const seen = await takeLongTasks();
  if (!seen.some((task) => task.duration >= 140)) {
    throw new Error(`the long-task recorder did not see the planted 150 ms task (it saw ${JSON.stringify(seen)}), so it is blind and nothing is reported`);
  }
  process.stdout.write(`control: the planted 150 ms task was recorded as ${String(Math.round(Math.max(...seen.map((task) => task.duration))))} ms\n`);
}

/** @type {{ firstRead: number, wall: number, total: number, worst: number, count: number }[]} */
const readings = [];

async function closeTabs() {
  for (let tab = 0; tab < 8 && (await page.locator('.m-tab-close').count()) > 0; tab += 1) {
    await page.locator('.m-tab-close').first().click();
    const dontSave = page.locator('.m-dialog:not(.m-palette)').last().getByRole('button', { name: 'Don’t save' });
    await dontSave.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
    if ((await dontSave.count()) > 0) await dontSave.click();
    await nothingInFlight(page);
  }
}

for (let round = 1; round <= rounds; round += 1) {
  await step(`round ${String(round)}`, async () => {
    // THE TOOL IS THE APPLICATION'S, NOT THE DOCUMENT'S (`App.tsx`' tool slot), so it stays on across a closed tab and a
    // document opened under it is read at once. It starts down, and each round puts it down before closing its tab,
    // where the ribbon still shows it (with no document there is no ribbon to press).
    await open(documentPath);
    await nothingInFlight(page);
    await section('Edit');
    const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    if ((await tool.getAttribute('aria-pressed')) === 'true') throw new Error('Edit text is on in a document opened with the tool put down');
    const blocks = page.locator('[data-text-block]');
    if ((await blocks.count()) > 0) throw new Error('block outlines were in the page before Edit text was pressed');

    // THE FIRST READ: the press of the tool to the first outline.
    const pressed = Date.now();
    await tool.click();
    await blocks.first().waitFor({ state: 'attached', timeout: 60_000 });
    const firstRead = Date.now() - pressed;
    await nothingInFlight(page);
    await page.waitForTimeout(1000);

    // THE LARGEST OUTLINE ON SCREEN, by area, through one element handle per block so a list that grows cannot move it.
    const handles = await blocks.elementHandles();
    let largest = -1;
    let area = 0;
    const viewport = await page.evaluate(() => ({ height: /** @type {number} */ (Reflect.get(globalThis, 'innerHeight')) }));
    for (const [at, handle] of handles.entries()) {
      const box = await handle.boundingBox();
      if (box === null || box.y < 0 || box.y + Math.min(box.height, 40) > viewport.height) continue;
      if (box.width * box.height > area) {
        area = box.width * box.height;
        largest = at;
      }
    }
    if (largest < 0) throw new Error('no block outline is on screen to open');

    // OPENING IT: long tasks from the first press until two seconds after the editor took focus.
    await page.waitForTimeout(500);
    await takeLongTasks();
    const from = await rendererNow();
    const started = Date.now();
    await openBlock(blocks.nth(largest), 'middle');
    const wall = Date.now() - started;
    await page.waitForTimeout(2000);
    const tasks = (await takeLongTasks()).filter((task) => task.start >= from);
    const total = tasks.reduce((sum, task) => sum + task.duration, 0);
    const worst = tasks.reduce((most, task) => Math.max(most, task.duration), 0);
    readings.push({ firstRead, wall, total, worst, count: tasks.length });
    process.stdout.write(
      `round ${String(round)}: first read ${String(firstRead)} ms; block ${String(largest + 1)} of ${String(handles.length)} (${String(Math.round(area))} px²) open in ${String(wall)} ms, long tasks ${String(Math.round(total))} ms over ${String(tasks.length)} (worst ${String(Math.round(worst))} ms)\n`,
    );
    await page.keyboard.press('Escape');
    await nothingInFlight(page);
    if ((await tool.getAttribute('aria-pressed')) === 'true') await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    await closeTabs();
  });
}

/** @param {number[]} values */
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length % 2 === 1 ? (sorted[(sorted.length - 1) / 2] ?? 0) : ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2;
  return `median ${String(Math.round(middle))} ms (spread ${String(Math.round(sorted[0] ?? 0))} to ${String(Math.round(sorted.at(-1) ?? 0))})`;
}
if (readings.length > 0) {
  process.stdout.write(
    [
      `over ${String(readings.length)} round(s), document ${String(fileNumber)}:`,
      `  first read of the blocks: ${summary(readings.map((each) => each.firstRead))}`,
      `  opening the largest block, wall (with the 700 ms pause between the presses): ${summary(readings.map((each) => each.wall))}`,
      `  opening it, long tasks in all: ${summary(readings.map((each) => each.total))}`,
      `  opening it, the worst long task: ${summary(readings.map((each) => each.worst))}`,
      '',
    ].join('\n'),
  );
}
await finish();
