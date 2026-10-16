// @ts-check
/**
 * The live-app walk harness: an isolated development app driven with Playwright's real mouse and keyboard, for the walk
 * scripts the Windows session runs (`formsWalk.mjs`, `textWalk.mjs`). Generalised from `firstCorrectionsLive.mjs`, whose
 * launch, open and palette steps it takes; what it adds is the RECORD.
 *
 * ## Every step is recorded, passed or failed, and the walk goes on
 *
 * A walk is a list of things a person does on a real document. One that stopped at the first failure would report one
 * finding per run, and the next run would start from the top. So each step runs in `step(name, work)`: its screenshot is
 * taken at its end whatever happened, a failure is written down with its message, and the walk carries on. The record is
 * `report.json` beside the screenshots, and the run's last line says how many steps passed, so a piped run is read
 * right (CLAUDE.md, *SEALED*).
 *
 * ## The engine runs only on Windows, and this says so rather than failing late
 *
 * The engine hosts are processes this build creates in an AppContainer (ADR-0022), so a document opens only on Windows.
 * On any other platform the harness refuses at the start, in words, before an app is launched.
 *
 * ## Where the output goes
 *
 * `_review/walks/<walk>/<time>/`, which git does not track: screenshots are binaries, and a walk's output is evidence
 * for the person reading the report, never an artefact the repository keeps (B8, B10).
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { _electron } from 'playwright';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { PALETTE_DRIVER, SHELL_LAUNCH, refuseStaleBuild } from '../lib/buildFreshness.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The content size every walk's screenshots are taken at. */
export const WALK_WINDOW = { width: 1400, height: 900 };

/**
 * How many writes (or, with `kind`, works) the window has finished: `data-writes-done` on the root, which the renderer
 * keeps (`packages/ui/src/inFlight.ts`, which says what each kind counts). Note it before an action, and hand it to
 * {@link writesLanded}.
 *
 * @param {import('playwright').Page} page
 * @param {'writes' | 'works'} [kind]
 */
export async function writesDone(page, kind = 'writes') {
  return Number((await page.locator('html').getAttribute(`data-${kind}-done`)) ?? '0');
}

/**
 * Waits until every write since `before` has landed: more writes finished than were noted, and none in flight. The
 * condition a fixed sleep stood for (the stage audit's GGGGGGGG-3). The finished count only grows, so a reading taken
 * before the write began cannot pass for one after it; an action that wrote nothing is a walk's own error and fails
 * here, naming the count, rather than passing on a wait that saw nothing.
 *
 * @param {import('playwright').Page} page
 * @param {number} before the count {@link writesDone} answered before the action
 * @param {number} [writes] how many the action makes, 1 unless said
 * @param {'writes' | 'works'} [kind]
 */
export async function writesLanded(page, before, writes = 1, kind = 'writes') {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const root = page.locator('html');
    const done = Number((await root.getAttribute(`data-${kind}-done`)) ?? '0');
    const inFlight = (await root.getAttribute(`data-${kind}`)) ?? '0';
    if (done >= before + writes && inFlight === '0') return;
    if (Date.now() > deadline) {
      throw new Error(`${kind} not landed after 60 s: ${String(done - before)} of ${String(writes)} finished, ${inFlight} in flight`);
    }
    // A POLL, NOT A SLEEP: the condition is read again every 100 ms until it holds or the deadline names what is missing.
    await page.waitForTimeout(100);
  }
}

/**
 * Waits until no write is in flight, for a step that may or may not have written and must not start while an earlier
 * step's write is still landing. Where the step knows it wrote, {@link writesLanded} is the stronger wait.
 *
 * @param {import('playwright').Page} page
 */
export async function writesIdle(page) {
  await writesLanded(page, await writesDone(page), 0);
}

/**
 * Waits until a box stops moving: two reads 100 ms apart that agree. For a scroll or a wheel, whose end has no event.
 *
 * @param {() => Promise<{ x: number; y: number; width: number; height: number } | null>} read
 * @param {import('playwright').Page} page
 */
export async function boxSettled(page, read) {
  let last = await read();
  for (let tries = 0; tries < 50; tries += 1) {
    await page.waitForTimeout(100);
    const now = await read();
    if (JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  throw new Error('the box did not settle in 5 s');
}

/**
 * @typedef {object} StepRecord
 * @property {string} name
 * @property {'passed' | 'failed'} outcome
 * @property {string} [problem]
 * @property {string} screenshot
 * @property {Record<string, unknown>} [facts] what the step measured, when it measured anything
 */

/**
 * Starts a walk: refuses a stale build and a platform the engine does not run on, launches the app with its own user
 * data, and answers the helpers a walk script uses.
 *
 * @param {string} walk the walk's name, which is its output folder
 */
export async function startWalk(walk) {
  if (process.platform !== 'win32') {
    throw new Error(
      `The ${walk} walk opens real documents, and the engine hosts run only on Windows (ADR-0022). Run it there: ` +
        `node scripts/research/${walk}Walk.mjs <files>.`,
    );
  }
  refuseStaleBuild(root, SHELL_LAUNCH, 7);
  // THE PALETTE'S ONE DRIVER (`packages/testing/src/palette.ts`, B3a), read from its build once that build is this tree's.
  refuseStaleBuild(root, PALETTE_DRIVER, 1);
  // A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
  const { runCommand } = await import('../../packages/testing/dist/palette.js');
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  const output = join(root, '_review', 'walks', walk, stamp);
  await mkdir(output, { recursive: true });

  /** @type {Record<string, string>} */
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  Object.assign(environment, await developmentEnvironment(root));
  const app = await _electron.launch({
    executablePath: electronBinaryPath(root),
    args: [join(root, 'apps/desktop'), `--user-data-dir=${join(output, 'app-data')}`],
    cwd: root,
    env: environment,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  /**
   * Sizes the WINDOW's content area to `size`, and answers what the page then measures.
   *
   * Never `page.setViewportSize`: in Electron that is device-metrics emulation inside a native window that keeps its
   * own size, so a window wider than the emulated page draws the page and an empty band beside it (O11). The window
   * is the one owner of its size, so the walk asks the window. Unmaximised first, since a maximised window ignores a
   * content size; a screen whose work area is smaller clamps it, and the answer then says what was drawn instead.
   *
   * **Below the application's floor** (`MINIMUM_WINDOW`, or less on a small screen) the floor is lowered for that size
   * and put back by the next size at or above it: a step that needs a short window gets a real one, as a person on a
   * small screen has, rather than an emulated page.
   *
   * @param {{ width: number; height: number }} size
   */
  const sizeWindow = async (size) => {
    await app.evaluate(({ BrowserWindow }, wanted) => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) throw new Error('the application has no window to size');
      if (window.isMaximized()) window.unmaximize();
      const holder = /** @type {{ monsteraWalkFloor?: number[] }} */ (/** @type {unknown} */ (globalThis));
      holder.monsteraWalkFloor ??= window.getMinimumSize();
      const [floorWidth = 0, floorHeight = 0] = holder.monsteraWalkFloor;
      window.setMinimumSize(Math.min(floorWidth, wanted.width), Math.min(floorHeight, wanted.height));
      window.setContentSize(wanted.width, wanted.height);
    }, size);
    // THE PAGE'S OWN READING, once its resize has landed: the window's size is asked of main and the page's of the
    // page, and both are what the walk's screenshots show.
    const read = () => page.evaluate(() => ({ width: Reflect.get(globalThis, 'innerWidth'), height: Reflect.get(globalThis, 'innerHeight') }));
    for (let tries = 0; tries < 50; tries += 1) {
      const seen = await read();
      if (seen.width === size.width && seen.height === size.height) return seen;
      await page.waitForTimeout(100);
    }
    return read();
  };
  await sizeWindow(WALK_WINDOW);

  /** @type {StepRecord[]} */
  const steps = [];
  let counter = 0;

  /** A copy of a person's file in the output folder, so a walk never writes to the original. @param {string} path */
  const copyOf = async (path) => {
    const copied = join(output, `input-${basename(path)}`);
    await copyFile(path, copied);
    return copied;
  };

  /** Opens `path` through the app's own Open, with the platform's picker answered. @param {string} path */
  const open = async (path) => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, path);
    // NO FIRST-RUN DIALOG IS WAITED FOR: the AI setup is offered on the start screen below the Open button (W11), so
    // nothing arrives over it after launch.
    const button = page.getByRole('button', { name: /^Open PDF/u }).first();
    if ((await button.count()) > 0 && (await button.isVisible())) await button.click();
    else await page.keyboard.press('Control+O');
    // THE DOCUMENT JUST PICKED IS THE ONE ON SHOW, named in the status bar, before anything else is waited for. A visible
    // page canvas alone does not say whose it is: with a document already on show its canvas is visible before the new
    // tab takes over, so the wait returned at once and the next command ran against the PREVIOUS document. Its dialog then
    // belonged to the tab being left and was hidden as the new one came forward (comments N3's crop steps, runs d and e
    // of 2026-10-16: no dialog, nothing logged, about ten tabs open).
    // THE FIRST of the bar's name spans: it renders the name twice, both with the same title.
    await expect(page.locator('.m-status-name').first()).toHaveAttribute('title', basename(path), { timeout: 30_000 });
    // THE VISIBLE ONE: a second open document leaves the first tab's canvases mounted and hidden, and `.first()` is theirs.
    await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
  };

  /**
   * Answers the next open picker with `paths`, without pressing anything: for a picker a command opens itself, such as
   * Insert images, where several files are picked at once. @param {readonly string[]} paths
   */
  const pickFiles = async (paths) => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [...picked] });
    }, paths);
  };

  /** Answers the next save-as picker with `path`. @param {string} path */
  const saveTo = async (path) => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: picked });
    }, path);
  };

  /**
   * Runs a command by its EXACT title through the palette, as a person may. The palette filters by substring and keeps
   * registry order without ranking (`CommandPalette.tsx`), and a string `hasText` is a case-insensitive substring too, so
   * the first option containing "Watermark…" was "Edit watermark…" and the walk opened the wrong command. The option's
   * own title is matched whole instead. @param {string} title
   */
  const command = (title) => runCommand(page, title);

  /** Chooses a section in the rail. @param {string} name */
  const section = async (name) => {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click();
  };

  /** Presses at a locator's middle, or `inset` pixels in from its left edge. @param {import('playwright').Locator} target @param {number} [inset] */
  const pressOn = async (target, inset) => {
    const box = await target.boundingBox();
    if (box === null) throw new Error('the control is not on screen');
    await page.mouse.click(inset === undefined ? box.x + box.width / 2 : box.x + inset, box.y + box.height / 2);
  };

  /**
   * One step: `work` runs, a screenshot is taken whatever happened, and the outcome is recorded. A step's `work` may
   * answer facts it measured, which go into the record beside it.
   *
   * @param {string} name
   * @param {() => Promise<Record<string, unknown> | void>} work
   */
  const step = async (name, work) => {
    counter += 1;
    const screenshot = `${String(counter).padStart(2, '0')}-${name.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase().slice(0, 60)}.png`;
    /** @type {StepRecord} */
    let record;
    try {
      const facts = await work();
      record = { name, outcome: 'passed', screenshot, ...(facts === undefined ? {} : { facts }) };
    } catch (error) {
      // WHAT WAS OPEN, WORDED, BEFORE THE ESCAPE BELOW PUTS IT DOWN: the screenshot is taken after it, so a dialog that
      // blocked the step is otherwise in neither the record nor the picture.
      const open = await page.locator('[role=dialog]').allInnerTexts().catch(() => /** @type {string[]} */ ([]));
      const blocked = open.length === 0 ? '' : `\n[a dialog was open: ${open.map((text) => text.replaceAll(/\s+/gu, ' ').slice(0, 200)).join(' | ')}]`;
      record = { name, outcome: 'failed', problem: (error instanceof Error ? error.message.slice(0, 2000) : String(error)) + blocked, screenshot };
      // A DIALOG LEFT OPEN by a failed step would take the next step's presses, so it is put down.
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await page.screenshot({ path: join(output, screenshot) }).catch(() => undefined);
    steps.push(record);
    process.stdout.write(`${record.outcome === 'passed' ? 'ok  ' : 'FAIL'}  ${name}${record.problem === undefined ? '' : `\n      ${record.problem.split('\n')[0] ?? ''}`}\n`);
  };

  /** Closes the app and writes the record; the last line printed is the verdict. */
  const finish = async () => {
    await app.close().catch(() => undefined);
    const passed = steps.filter((each) => each.outcome === 'passed').length;
    await writeFile(join(output, 'report.json'), `${JSON.stringify({ walk, steps }, null, 2)}\n`);
    process.stdout.write(`\nScreenshots and report.json: ${output}\n`);
    process.stdout.write(`WALK ${walk}: ${String(passed)} of ${String(steps.length)} steps passed\n`);
    process.exitCode = passed === steps.length ? 0 : 1;
  };

  return { app, page, output, copyOf, open, pickFiles, saveTo, command, section, pressOn, step, finish, sizeWindow };
}
