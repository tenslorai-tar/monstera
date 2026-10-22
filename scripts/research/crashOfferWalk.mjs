// @ts-check
/**
 * The crash report offer after a REAL crash (ADR-0109): a development build is crashed on purpose
 * (`--monstera-crash`, `apps/desktop/src/crashSwitch.ts`), first its renderer and then main, and started again over
 * the same user data. Each time the walk records that Crashpad wrote a report, that the start screen offers it, and
 * that Share… hands the Windows Share sheet the report and the diagnostics log.
 *
 * Why a switch: ending the process from outside (Task Manager's *End task*) is a termination, which Crashpad does not
 * report, so the offer is never reached that way (the owner, 2026-10-22).
 *
 *   node scripts/research/crashOfferWalk.mjs
 *
 * The Share sheet is the real one and opens on this desktop; it is closed with the app.
 */
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { launchApp, root, startWalk } from './liveWalk.mjs';

/** Every `.dmp` under `folder`, at any depth, as `crashReports.ts` counts them. @param {string} folder */
async function dumpsUnder(folder) {
  const names = await readdir(folder, { recursive: true }).catch(() => /** @type {string[]} */ ([]));
  return names.filter((name) => name.toLowerCase().endsWith('.dmp'));
}

/** Waits for `condition` to answer true, up to `ms`. @param {() => Promise<boolean>} condition @param {number} ms */
async function until(condition, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
/** @type {Record<string, unknown>[]} */
const results = [];
/** @type {string[]} */
const failedRuns = [];

for (const order of /** @type {const} */ (['renderer', 'main'])) {
  const appData = join(root, '_review', 'walks', 'crash-offer', `${stamp}-${order}-app-data`);
  await mkdir(appData, { recursive: true });
  /** @type {Record<string, unknown>} */
  const record = { order };

  // THE CRASH. A renderer crash is followed by the window's reload (ADR-0253), so the app is closed by the walk once
  // the report is on disk; a main crash ends the app by itself.
  const crashed = await launchApp('crash-offer', { appData, switches: [`--monstera-crash=${order}`] });
  const exited = new Promise((resolve) => {
    crashed.app.process().once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
  // THE WHOLE USER DATA FOLDER, not Crashpad's subfolder by name: `crashReports.ts` does not rely on its layout either.
  const crashpad = appData;
  record['reportWritten'] = await until(async () => (await dumpsUnder(crashpad)).length > 0, 60_000);
  // A RENDERER CRASH IS LOGGED, and the log is what goes beside the report. Crashpad writes the report BEFORE Electron
  // announces the crash, so closing at the report would close before the line (measured: the first run of this walk
  // shared a log without it). Main cannot log its own crash; the report is its record.
  const log = join(appData, 'logs', 'shell.log');
  const crashLine = 'FAILURE render-process-gone reason=crashed';
  if (order === 'renderer') {
    record['crashLogged'] = await until(async () => (await readFile(log, 'utf8').catch(() => '')).includes(crashLine), 30_000);
    await crashed.app.close().catch(() => undefined);
  }
  record['exit'] = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('still running after 60 s'), 60_000))]);
  record['dumps'] = (await dumpsUnder(crashpad)).length;

  // STARTED AGAIN over the same user data: the start screen asks main for a report not yet offered.
  const walk = await startWalk('crash-offer', { appData });
  const { app, page, step, finish } = walk;
  const temporary = await app.evaluate(({ app: electron }) => electron.getPath('temp'));
  const shares = join(temporary, 'Monstera shares');
  const sharesBefore = new Set(await readdir(shares).catch(() => /** @type {string[]} */ ([])));

  await step(`${order} crash: a report was written and the app ended or reloaded`, async () => {
    if (record['reportWritten'] !== true) throw new Error(`no .dmp under ${crashpad} within 60 s of the crash`);
    if (order === 'renderer' && record['crashLogged'] !== true) throw new Error(`the log never said ${crashLine}`);
    return { dumps: record['dumps'], exit: record['exit'] };
  });

  await step(`${order} crash: the start screen offers the report`, async () => {
    await page.locator('[data-crash-offer]').waitFor({ state: 'visible', timeout: 30_000 });
    return { offer: (await page.locator('[data-crash-offer] .m-crash-offer__question').innerText()).trim() };
  });

  await step(`${order} crash: Share… hands the sheet the report and the log`, async () => {
    const offer = page.locator('[data-crash-offer]');
    await offer.locator('.m-crash-offer__actions button').first().click();
    // SHARE IS A QUESTION FIRST (CR-SEC-22): the confirm group's second button opens the sheet.
    await offer.locator('[role=group] button').nth(1).click();
    const fresh = async () => (await readdir(shares).catch(() => /** @type {string[]} */ ([]))).filter((name) => !sharesBefore.has(name) && name.startsWith('share-'));
    if (!(await until(async () => (await fresh()).length > 0, 30_000))) throw new Error(`no share folder appeared under ${shares}`);
    const folder = join(shares, /** @type {string} */ ((await fresh())[0]));
    const files = await readdir(folder);
    const sizes = Object.fromEntries(await Promise.all(files.map(async (name) => [name, (await stat(join(folder, name))).size])));
    const report = files.some((name) => name.toLowerCase().endsWith('.dmp'));
    const withLog = files.includes('shell.log');
    if (!report || !withLog) throw new Error(`the shared files were ${JSON.stringify(sizes)}: a report ${String(report)}, the log ${String(withLog)}`);
    if (order === 'renderer' && !(await readFile(join(folder, 'shell.log'), 'utf8')).includes(crashLine)) {
      throw new Error(`the shared log does not name the crash (${crashLine})`);
    }
    // OFFERED IS THE SHEET SHOWN, and the offer then goes (`CrashReportOffer.tsx`).
    await offer.waitFor({ state: 'detached', timeout: 10_000 });
    return { shared: sizes };
  });

  record['steps'] = 'see report.json';
  results.push(record);
  await finish();
  // EACH RUN'S VERDICT KEPT: `finish` sets the exit code for its own run, so a later passing run would hide a failure.
  if (process.exitCode === 1) failedRuns.push(order);
}
process.stdout.write(`${JSON.stringify(results)}\n`);
process.stdout.write(`CRASH OFFER: ${failedRuns.length === 0 ? 'both runs passed' : `failed: ${failedRuns.join(', ')}`}\n`);
process.exitCode = failedRuns.length === 0 ? 0 : 1;
