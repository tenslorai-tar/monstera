// @ts-check
/**
 * What a start costs a person, and when the font list is ready: the owner's item 6 of 2026-10-24, *"the font list loads at
 * app start, not when Edit text is chosen … never slow the start or the interface"*.
 *
 *   node scripts/research/startupWalk.mjs [--runs <n>] [--again] [--early-edit] [--app-root <checkout>]
 *
 * Each run launches the app with user data of its own, so it is a computer's FIRST start: no font list is kept. With
 * `--again`, each run launches a second time over the first one's user data, a later start, which reads the kept list.
 * `--app-root` launches another checkout's build: the control, the trigger before item 6.
 *
 * ## What is measured
 *
 * - **window**: from the launch to the first window's document;
 * - **start screen**: to the start screen drawn (`.m-start-screen` visible);
 * - **first response**: the command palette asked for by its key and its search field shown, at once and again about 1,
 *   3 and 6 s later — while a background build would be running;
 * - **renderer long tasks**: every task over 50 ms the renderer ran in the first 20 s (`longtask`, read buffered);
 * - **main's event loop**: the longest delay a 20 ms timer in `main` saw from the window to the end;
 * - **font list kept**: when `font-families.json` appeared in the user data, from the launch: the list complete and kept,
 *   or `null` where nothing asked for it within the run;
 * - with `--early-edit`: a document opened and Edit text chosen at once, a block's words changed, the editor's opening and
 *   the write timed, beside whether the font list was kept by then.
 *
 * Nothing a person wrote is read: the document is made here.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { startWalk, writesDone, writesLanded } from './liveWalk.mjs';

const argv = process.argv.slice(2);
const option = (/** @type {string} */ name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const RUNS = Number(option('--runs') ?? '3');
const AGAIN = argv.includes('--again');
const EARLY_EDIT = argv.includes('--early-edit');
const appRootOption = option('--app-root');
const appRoot = appRootOption === undefined ? undefined : resolve(appRootOption);
const WATCH_MS = 20_000;

/** A one-page document of plain paragraphs, made here. */
async function plainDocument() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  ['The committee met on the fourth of the month', 'and agreed the plan for the spring season.'].forEach((line, at) =>
    page.drawText(line, { x: 72, y: 700 - at * 16, size: 12, font }),
  );
  const folder = await mkdtemp(join(tmpdir(), 'monstera-startup-'));
  const path = join(folder, 'plain.pdf');
  await writeFile(path, await document.save());
  return path;
}

/**
 * One launch, measured. @param {string | undefined} appData an earlier launch's user data, or a fresh folder when absent
 * @returns {Promise<Record<string, unknown>>}
 */
async function launch(appData) {
  const started = Date.now();
  const walk = await startWalk('startup', { ...(appRoot === undefined ? {} : { appRoot }), ...(appData === undefined ? {} : { appData }) });
  const { app, page } = walk;
  const windowMs = Date.now() - started;
  const data = appData ?? join(walk.output, 'app-data');
  const fontFile = join(data, 'font-families.json');
  const keptAlready = existsSync(fontFile);
  // MAIN'S EVENT LOOP, watched from inside it: the longest gap a 20 ms timer saw past its 20 ms.
  await app.evaluate(() => {
    const state = { worst: 0, last: Date.now() };
    /** @type {any} */ (globalThis).__loopWatch = state;
    setInterval(() => {
      const now = Date.now();
      state.worst = Math.max(state.worst, now - state.last - 20);
      state.last = now;
    }, 20).unref();
  });
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) /** @type {any} */ (globalThis).__long.push({ at: Math.round(entry.startTime), ms: Math.round(entry.duration) });
    }).observe(/** @type {any} */ ({ type: 'longtask', buffered: true }));
  });
  await page.locator('.m-start-screen').waitFor({ state: 'visible', timeout: 60_000 });
  const startScreenMs = Date.now() - started;

  /** @type {number | null} */
  let keptMs = keptAlready ? 0 : null;
  const watch = setInterval(() => {
    if (keptMs === null && existsSync(fontFile)) keptMs = Math.round(Math.max(0, statSync(fontFile).mtimeMs - started));
  }, 50);

  /** The palette asked for by its key, timed to its search field. */
  const respond = async () => {
    const asked = Date.now();
    await page.keyboard.press('Control+K');
    await page.locator('.m-palette-query').waitFor({ state: 'visible', timeout: 15_000 });
    const ms = Date.now() - asked;
    await page.keyboard.press('Escape');
    await page.locator('.m-palette-query').waitFor({ state: 'hidden', timeout: 15_000 });
    return ms;
  };
  /** @type {number[]} */
  const responses = [];
  /** @type {Record<string, unknown>} */
  let edit = {};
  if (EARLY_EDIT) {
    await walk.open(await plainDocument());
    const chose = Date.now();
    await walk.section('Edit');
    const control = page.locator('[data-command="text.edit"]:visible').first();
    if ((await control.getAttribute('aria-pressed')) !== 'true') await control.click();
    const block = page.locator('[data-text-edit-layer]:visible [data-text-block]').first();
    await block.waitFor({ timeout: 60_000 });
    // TWO STEPS (ADR-0271 section 3): the press selects the box, Enter puts the caret at the end of its words.
    await block.click();
    await page.keyboard.press('Enter');
    await page.locator('[data-kit-surface]').first().waitFor({ timeout: 60_000 });
    const editorOpenMs = Date.now() - chose;
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
    const before = await writesDone(page);
    const finished = Date.now();
    await page.keyboard.press('Escape');
    await writesLanded(page, before);
    edit = { editorOpenMs, writeMs: Date.now() - finished, writtenAtMs: Date.now() - started, fontListKeptByThen: keptMs !== null };
  } else {
    for (const wait of [0, 1000, 2000, 3000]) {
      await page.waitForTimeout(wait);
      responses.push(await respond());
    }
  }
  const left = WATCH_MS - (Date.now() - started);
  if (left > 0) await page.waitForTimeout(left);
  // AND UNTIL THE LIST IS KEPT, up to a minute more, so a slow build is timed rather than cut off.
  for (let waited = 0; keptMs === null && waited < 60_000; waited += 250) await page.waitForTimeout(250);
  clearInterval(watch);
  /** @type {{ at: number, ms: number }[]} */
  const long = await page.evaluate(() => /** @type {any} */ (globalThis).__long);
  const loopWorst = await app.evaluate(() => /** @type {any} */ (globalThis).__loopWatch.worst);
  await app.close();
  return {
    output: walk.output,
    appData: data,
    firstStart: !keptAlready,
    windowMs,
    startScreenMs,
    responsesMs: responses,
    longTasks: long,
    longestTaskMs: Math.max(0, ...long.map((each) => each.ms)),
    mainLoopWorstMs: loopWorst,
    fontListKeptMs: keptMs,
    ...edit,
  };
}

/** @type {Record<string, unknown>[]} */
const results = [];
for (let run = 0; run < RUNS; run += 1) {
  const first = await launch(undefined);
  results.push(first);
  process.stdout.write(`${JSON.stringify(first)}\n`);
  if (AGAIN) {
    const again = await launch(String(first['appData']));
    results.push(again);
    process.stdout.write(`${JSON.stringify(again)}\n`);
  }
}
await writeFile(join(String(results[0]?.['output'] ?? '.'), 'startup.json'), `${JSON.stringify({ appRoot: appRoot ?? '.', results }, null, 2)}\n`);
