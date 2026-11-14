// @ts-check
/**
 * What Edit text costs before a person can type: the first read of a page's blocks, and opening a dense block.
 *
 *   node scripts/research/editOpenCost.mjs --corpus <folder> --file <n> [--rounds <n>] [--app-root <checkout>] [--profile]
 *     [--app-data <an earlier run's app-data folder>]
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
 *   it. Two figures are the editor's: the renderer's work (its long tasks) and ADR-0271's *click until editable*, from
 *   the press that opens the words to the first frame with the editor in text mode and focus in its words
 *   ({@link armEditableClock}).
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
import { readdirSync, writeFileSync } from 'node:fs';
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

// `--app-data`: an EARLIER run's app-data folder, so this launch is a second one, with the font catalogue that run kept
// (ADR-0293: the first launch after the fonts change pays the folders' read while the catalogue host writes the file).
// It prints the kept files it finds there before launching, and REFUSES a folder holding none (IIIIIIIII-4): readings
// taken there are a first launch's, and a run that went on would label them a second one. What it cannot say is whether
// the app TOOK the file: a changed font fingerprint reads the folders again, and the app logs neither route, so a first
// read near a first launch's on a folder that holds one is that, and the readings say so rather than this line.
const appData = option('--app-data');
if (appData !== undefined) {
  const kept = readdirSync(appData, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.catalogue.json'));
  process.stdout.write(`app data from an earlier run: ${String(kept.length)} kept catalogue file(s) in it\n`);
  if (kept.length === 0) {
    throw new Error(`--app-data names a folder with no kept catalogue file, so this launch would be a first one read as a second`);
  }
}
const walk = await startWalk('edit-open-cost', { ...appRootOption(process.argv), ...(appData === undefined ? {} : { appData }) });
const { page, open, section, finish, step, output } = walk;
const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : undefined;
if (profiler !== undefined) {
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.setSamplingInterval', { interval: 200 });
}
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
{
  // THE PRESS CLOCK'S CONTROL: a press made while a planted 600 ms task runs must carry a time stamp at least 200 ms
  // before its handler ran, or the press times below cannot see a press that waited, which is the case they exist for.
  // A clock read in the handler gives about 0. The task is long against the threshold because where the press lands
  // inside it depends on how long Playwright's press takes to arrive: with a 300 ms task the lag read 249 ms in one run
  // and 178 ms in the next (2026-11-12). Pressed on the start screen's empty right side, where a press does nothing.
  await page.evaluate(() => {
    const clock = /** @type {{ now: () => number }} */ (Reflect.get(globalThis, 'performance'));
    const later = /** @type {(run: () => void, ms: number) => void} */ (Reflect.get(globalThis, 'setTimeout'));
    const dom = /** @type {{ addEventListener: (type: string, run: (event: { timeStamp: number }) => void, options: unknown) => void }} */ (
      Reflect.get(globalThis, 'document')
    );
    dom.addEventListener('pointerdown', (event) => Reflect.set(globalThis, '__pressLag', clock.now() - event.timeStamp), { capture: true, once: true });
    later(() => {
      const until = clock.now() + 600;
      while (clock.now() < until) {
        // the planted task the press waits behind
      }
    }, 50);
  });
  await page.waitForTimeout(100);
  await page.mouse.click(1300, 220);
  await page.waitForTimeout(800);
  const lag = await page.evaluate(() => /** @type {number | undefined} */ (Reflect.get(globalThis, '__pressLag')));
  if (lag === undefined || lag < 200) {
    throw new Error(`a press made during a planted 600 ms task was stamped ${String(lag)} ms before its handler ran, so the press clock cannot see a press that waited`);
  }
  process.stdout.write(`control: a press that waited behind a planted task was stamped ${String(Math.round(lag))} ms before its handler ran\n`);
}

/**
 * THE FIRST-LETTER CLOCK'S CONTROL: a stand-in surface on the start screen that shows a typed letter `heldMs` after its
 * key, read by the same clock the rounds use. A letter held 1,200 ms must read as held, and one shown at once must not,
 * so a clock blind to a hold (the release read 0 held in 7 with nothing to say it could see one) and a clock that always
 * reads one are both refused before anything is measured.
 *
 * @param {number} heldMs
 */
async function letterThroughStandIn(heldMs) {
  await page.evaluate((delay) => {
    const dom = /** @type {{ createElement: (tag: string) => any, body: { append: (node: unknown) => void } }} */ (Reflect.get(globalThis, 'document'));
    const later = /** @type {(run: () => void, ms: number) => void} */ (Reflect.get(globalThis, 'setTimeout'));
    const surface = dom.createElement('div');
    surface.setAttribute('data-kit-surface', '');
    surface.setAttribute('data-stand-in', '');
    surface.tabIndex = 0;
    surface.textContent = 'words';
    surface.addEventListener('keydown', (/** @type {{ key: string, preventDefault: () => void }} */ event) => {
      event.preventDefault();
      later(() => {
        surface.textContent = `${String(surface.textContent)}${event.key}`;
      }, delay);
    });
    dom.body.append(surface);
    surface.focus();
  }, heldMs);
  await armFirstLetterClock();
  await page.keyboard.type('x');
  const read = await firstLetterReading();
  await page.evaluate(() => {
    const dom = /** @type {{ querySelector: (selector: string) => { remove: () => void } | null }} */ (Reflect.get(globalThis, 'document'));
    dom.querySelector('[data-stand-in]')?.remove();
  });
  return read;
}

/** @type {{ firstRead: number, selected: number, editable: number, firstLetter: number, wall: number, total: number, worst: number, count: number }[]} */
const readings = [];

/**
 * Closes every tab, ONE TAB AT A TIME BY ITS OWN BUTTON. A close can take seconds after the press: on 2026-11-11 the
 * close's `document.unsaved` answered in 9,471 ms beside a 14,040 ms `document.blockFaces` (`logs/shell.log`, round 2), so
 * a loop that counted the buttons again found the same one still there, pressed it, and waited 30 s on a button the first
 * press then removed. So the press is followed by waiting for THAT tab's button to go, answering Don't save if asked.
 */
async function closeTabs() {
  for (let tab = 0; tab < 8 && (await page.locator('.m-tab-close').count()) > 0; tab += 1) {
    const button = page.locator('.m-tab-close').first();
    const id = await button.getAttribute('data-tab-close');
    if (id === null) throw new Error('a tab close button carries no data-tab-close');
    await button.click();
    const same = page.locator(`.m-tab-close[data-tab-close="${id}"]`);
    const dontSave = page.locator('.m-dialog:not(.m-palette)').last().getByRole('button', { name: 'Don’t save' });
    await Promise.race([same.waitFor({ state: 'detached', timeout: 60_000 }), dontSave.waitFor({ state: 'visible', timeout: 60_000 })]);
    if ((await dontSave.count()) > 0) await dontSave.click();
    await same.waitFor({ state: 'detached', timeout: 60_000 });
    await nothingInFlight(page);
  }
}

/**
 * ADR-0271 section 4's first row, CLICK UNTIL EDITABLE (caret shown, a key would land), on the window's own clock: the
 * page notes every press, and on each frame whether the editor is in text mode with focus in its words. The first frame
 * where it is, less the last press before it, is the reading. The first of `openBlock`'s presses only selects the box
 * (`data-kit-mode="box"`), so the press it counts is the one that made the block editable, and the 700 ms between them is
 * not in it. Armed before the presses; answers the reading once the editor is editable.
 */
async function armEditableClock() {
  await page.evaluate(() => {
    const clock = /** @type {{ now: () => number }} */ (Reflect.get(globalThis, 'performance'));
    const dom = /** @type {{ querySelector: (selector: string) => unknown, activeElement: unknown, addEventListener: (type: string, run: (event: { timeStamp: number }) => void, options: unknown) => void, removeEventListener: (type: string, run: (event: { timeStamp: number }) => void, options: unknown) => void }} */ (
      Reflect.get(globalThis, 'document')
    );
    const frame = /** @type {(run: () => void) => void} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    // THE PRESS'S OWN TIME, `timeStamp`, which Chromium sets when the press arrives, on the same clock as `now()`. The
    // handler's own `now()` is when the handler RAN, and a press queued behind a long task runs late, so it would read
    // the wait as the press and the editor as faster than it is.
    let lastPress = -1;
    let firstPress = -1;
    let selected = -1;
    /** @param {{ timeStamp: number }} event */
    const press = (event) => {
      lastPress = event.timeStamp;
      if (firstPress < 0) firstPress = event.timeStamp;
    };
    dom.addEventListener('pointerdown', press, { capture: true });
    Reflect.set(
      globalThis,
      '__editable',
      new Promise((resolve) => {
        const look = () => {
          const kit = /** @type {{ getAttribute: (name: string) => string | null } | null} */ (dom.querySelector('[data-kit-frame]'));
          const words = dom.querySelector('[data-kit-surface]');
          if (selected < 0 && firstPress >= 0 && kit !== null && dom.activeElement === kit && kit.getAttribute('data-kit-mode') === 'box') {
            selected = clock.now() - firstPress;
          }
          if (lastPress >= 0 && kit?.getAttribute('data-kit-mode') === 'text' && words !== null && dom.activeElement === words) {
            dom.removeEventListener('pointerdown', press, { capture: true });
            resolve({ selected, editable: clock.now() - lastPress });
            return;
          }
          frame(look);
        };
        frame(look);
      }),
    );
  });
}
const editableReading = () => page.evaluate(() => /** @type {Promise<{ selected: number, editable: number }>} */ (Reflect.get(globalThis, '__editable')));

/**
 * THE FIRST TYPED LETTER, from its key's own time stamp to the first frame showing it in the words: a letter typed while
 * the block's faces are not settled is HELD (`BlockEditor.tsx`, at most `HOLD_KEYS_MS`, 1,500 ms) and shows when they
 * settle or the hold ends, so a held letter reads as a second or more and one that is not as a frame or two. Armed
 * before the key; answers once the words change, or `null` after five seconds.
 */
async function armFirstLetterClock() {
  await page.evaluate(() => {
    const clock = /** @type {{ now: () => number }} */ (Reflect.get(globalThis, 'performance'));
    const dom = /** @type {{ querySelector: (selector: string) => { textContent: string | null } | null, addEventListener: (type: string, run: (event: { timeStamp: number }) => void, options: unknown) => void }} */ (
      Reflect.get(globalThis, 'document')
    );
    const frame = /** @type {(run: () => void) => void} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    const before = dom.querySelector('[data-kit-surface]')?.textContent ?? null;
    let keyAt = -1;
    dom.addEventListener(
      'keydown',
      (event) => {
        keyAt = event.timeStamp;
      },
      { capture: true, once: true },
    );
    Reflect.set(
      globalThis,
      '__firstLetter',
      new Promise((resolve) => {
        const look = () => {
          const now = dom.querySelector('[data-kit-surface]')?.textContent ?? null;
          if (keyAt >= 0 && now !== before) return resolve(clock.now() - keyAt);
          if (keyAt >= 0 && clock.now() - keyAt > 5000) return resolve(null);
          frame(look);
        };
        frame(look);
      }),
    );
  });
}
const firstLetterReading = () => page.evaluate(() => /** @type {Promise<number | null>} */ (Reflect.get(globalThis, '__firstLetter')));

/** A first letter that took this long was held: well past a frame, and below the hold's own 1,500 ms bound. */
const HELD_MS = 1000;

{
  const held = await letterThroughStandIn(1200);
  const shown = await letterThroughStandIn(0);
  if (held === null || held < HELD_MS || shown === null || shown >= 200) {
    throw new Error(`the first-letter clock read a letter held 1,200 ms as ${String(held)} ms and one shown at once as ${String(shown)} ms, so it cannot tell a held letter from one that is not`);
  }
  process.stdout.write(`control: a letter held 1,200 ms read ${String(Math.round(held))} ms, one shown at once ${String(Math.round(shown))} ms\n`);
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
    await armEditableClock();
    // `--profile`: a sampled CPU profile from just before the first press until the words are editable, written beside
    // the walk's pictures as `round-<n>.cpuprofile` for `cpuProfileTop.mjs`. The first press's task is most of it.
    await profiler?.send('Profiler.start');
    const from = await rendererNow();
    const started = Date.now();
    await openBlock(blocks.nth(largest), 'middle');
    const wall = Date.now() - started;
    const { selected, editable } = await editableReading();
    // THE FIRST LETTER, typed the moment the words are editable, as a quick typist's is: before the profile is taken,
    // which would put its own wait between the two.
    await armFirstLetterClock();
    await page.keyboard.type('x');
    const firstLetter = await firstLetterReading();
    if (firstLetter === null) throw new Error('the first typed letter never showed in the words within five seconds');
    if (profiler !== undefined) {
      const { profile } = await profiler.send('Profiler.stop');
      writeFileSync(join(output, `round-${String(round)}.cpuprofile`), JSON.stringify(profile));
    }
    if (selected < 0) throw new Error('the box was never seen selected between the presses, so the first press has no reading');
    await page.waitForTimeout(2000);
    const tasks = (await takeLongTasks()).filter((task) => task.start >= from);
    const total = tasks.reduce((sum, task) => sum + task.duration, 0);
    const worst = tasks.reduce((most, task) => Math.max(most, task.duration), 0);
    readings.push({ firstRead, selected, editable, firstLetter, wall, total, worst, count: tasks.length });
    process.stdout.write(
      `round ${String(round)}: first read ${String(firstRead)} ms; block ${String(largest + 1)} of ${String(handles.length)} (${String(Math.round(area))} px²): first press until selected ${String(Math.round(selected))} ms, click until editable ${String(Math.round(editable))} ms, first letter shown ${String(Math.round(firstLetter))} ms${firstLetter > HELD_MS ? ' (HELD)' : ''}, open in ${String(wall)} ms, long tasks ${String(Math.round(total))} ms over ${String(tasks.length)} (worst ${String(Math.round(worst))} ms)\n`,
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
      `  first press until the box shows selected (the window's clock): ${summary(readings.map((each) => each.selected))}`,
      `  click until editable (ADR-0271's 300 ms, the window's clock): ${summary(readings.map((each) => each.editable))}`,
      `  the first typed letter, key to shown: ${summary(readings.map((each) => each.firstLetter))}; held (over ${String(HELD_MS)} ms) in ${String(readings.filter((each) => each.firstLetter > HELD_MS).length)} of ${String(readings.length)}`,
      `  opening the largest block, wall (with the 700 ms pause between the presses): ${summary(readings.map((each) => each.wall))}`,
      `  opening it, long tasks in all: ${summary(readings.map((each) => each.total))}`,
      `  opening it, the worst long task: ${summary(readings.map((each) => each.worst))}`,
      '',
    ].join('\n'),
  );
}
await finish();
