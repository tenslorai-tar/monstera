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
import { _electron } from 'playwright';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { SHELL_LAUNCH, refuseStaleBuild } from '../lib/buildFreshness.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => undefined);

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
    // THE FIRST-RUN "Set up the AI assistant" DIALOG ARRIVES A VARIABLE TIME AFTER LAUNCH (absent at 0 s, present by 1 s,
    // measured 2026-10-12 over three launches), so it is waited for rather than counted once: a count taken before it
    // arrives finds none, and the dialog then covers the Open button for the rest of the run.
    const skip = page.getByRole('dialog').getByRole('button', { name: /later|skip|not now/iu });
    await skip.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    if ((await skip.count()) >= 1 && (await skip.first().isVisible())) await skip.first().click();
    const button = page.getByRole('button', { name: /^Open PDF/u }).first();
    if ((await button.count()) > 0 && (await button.isVisible())) await button.click();
    else await page.keyboard.press('Control+O');
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

  /** Runs a command by its title through the palette, as a person may. @param {string} title */
  const command = async (title) => {
    await page.keyboard.press('Control+K');
    await page.locator('.m-palette-query').fill(title);
    await page.getByRole('option').filter({ hasText: title }).first().click();
  };

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

  return { app, page, output, copyOf, open, pickFiles, saveTo, command, section, pressOn, step, finish };
}
