// @ts-check
/**
 * How long each engine host takes to start in the running application, measured from inside it: the walk's step 1,
 * repeated. Each run launches the app with its own user data, opens a page set in a producer's subset fonts and turns
 * on Edit text, as the text regression walk's first step does, then reads what each host wrote about its own start
 * (`bindEngineOrExit`: when the runtime was ready, when its modules were evaluated, when its engine was bound, each in
 * milliseconds since that host's process began) and every failure the shell logged.
 *
 * Why it exists: twice on 2026-10-16 the MuPDF host was created and twice in a row did not reach its pipe within
 * HOST_CONNECT_TIMEOUT_MS, so the first document was poisoned. Measured outside the app the same host connects in
 * about 1.1 s, so the question is what is different in the app.
 *
 * Nothing a person wrote is read: the page is made from words in the kernel's fixture.
 *
 *   node scripts/research/hostStartWalk.mjs [runs]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import { join } from 'node:path';

import { root, startWalk } from './liveWalk.mjs';
import { textSteps } from './textWalkSteps.mjs';

const RUNS = Number(process.argv[2] ?? '5');

// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { buildProducerSubsetPdf } = await import('../../packages/kernel/dist/producerSubsetFixture.js');
const { fontsDirectory } = await import('../provision/fonts.mjs');
const fonts = fontsDirectory(root);
const regular = await readFile(join(fonts, 'Tinos-Regular.ttf'));
const bold = await readFile(join(fonts, 'Tinos-Bold.ttf'));

/** Every host log in the run's session root, by file name. @param {string} sessions */
async function hostLines(sessions) {
  /** @type {Record<string, string>} */
  const said = {};
  for (const name of await readdir(sessions).catch(() => /** @type {string[]} */ ([]))) {
    if (!name.startsWith('host-')) continue;
    said[name] = (await readFile(join(sessions, name), 'utf8').catch(() => '')).trim();
  }
  return said;
}

/** @type {Record<string, unknown>[]} */
const results = [];
for (let run = 1; run <= RUNS; run += 1) {
  const freeAtStart = Math.round(freemem() / 2 ** 20);
  const started = performance.now();
  const walk = await startWalk('host-start');
  const launched = performance.now();
  const { page, output, open, section, finish } = walk;
  const { ensureEditText } = textSteps(walk);
  const serif = join(output, 'serif-subsets.pdf');
  await writeFile(serif, await buildProducerSubsetPdf(regular, bold, { regular: 'Tinos', bold: 'Tinos-Bold' }));
  /** @type {Record<string, unknown>} */
  const record = { run, freeMbAtStart: freeAtStart, launchMs: Math.round(launched - started) };
  // MAIN'S EVENT LOOP, watched from inside main across the open and Edit text: a host's connection is noticed on this
  // loop, and so is the bound it is held to, so a loop held for seconds can fail a host that connected in time.
  await walk.app.evaluate(() => {
    const hooks = /** @type {typeof import('node:perf_hooks')} */ (process.getBuiltinModule('node:perf_hooks'));
    const histogram = hooks.monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    Reflect.set(globalThis, 'monsteraWalkLoopDelay', histogram);
  });
  try {
    await open(serif);
    record['openMs'] = Math.round(performance.now() - launched);
    await section('Edit');
    // EDIT TEXT ON, as the walk's step 1 turns it on: the section alone starts no host.
    await ensureEditText();
    await page.locator('[data-text-block]').first().waitFor({ state: 'visible', timeout: 60_000 });
    record['blocksMs'] = Math.round(performance.now() - launched);
  } catch (error) {
    record['problem'] = error instanceof Error ? error.message.split('\n')[0] : String(error);
  }
  record['freeMbAfterOpen'] = Math.round(freemem() / 2 ** 20);
  record['mainLoopDelayMs'] = await walk.app.evaluate(() => {
    const histogram = /** @type {import('node:perf_hooks').IntervalHistogram} */ (Reflect.get(globalThis, 'monsteraWalkLoopDelay'));
    histogram.disable();
    return { max: Math.round(histogram.max / 1e6), p99: Math.round(histogram.percentile(99) / 1e6), mean: Math.round(histogram.mean / 1e6) };
  });
  record['hosts'] = await hostLines(join(output, 'app-data', 'engine-sessions'));
  await finish();
  const log = await readFile(join(output, 'app-data', 'logs', 'shell.log'), 'utf8').catch(() => '');
  record['failures'] = log
    .split('\n')
    .filter((line) => line.includes('FAILURE') && !line.includes('engine-host-closed'))
    .map((line) => line.slice(0, 900));
  results.push(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
await writeFile(join(root, '_review', 'walks', 'host-start', 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
