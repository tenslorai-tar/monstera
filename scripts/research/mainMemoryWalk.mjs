// @ts-check
/**
 * What `main` and the renderer hold at the memory walk's four points, read from inside each and not only from Windows'
 * private bytes: the start screen, seven documents open, after one Edit text action, and every document closed with a
 * minute waited (session 2 item 3: `main` 162 → 229 MB on one edit, and 584 MB in total closed against 360 at the start).
 *
 * At each point, after a forced collection in that process (`HeapProfiler.collectGarbage`, through `node:inspector` in
 * `main` and the DevTools protocol in the renderer):
 * - every process's private bytes by role, through `processMemory.mjs`, the memory walk's one reader;
 * - `main`'s `process.memoryUsage()`: its V8 heap, the memory its buffers hold outside it, and its resident set;
 * - the renderer's JS heap (`Runtime.getHeapUsage`);
 * - a heap snapshot of each, written beside the run's screenshots, for `heapSnapshotDiff.mjs` to compare.
 *
 * A private-byte figure that stays high while the heap and the external memory fell is memory the process's allocator
 * keeps rather than anything this code holds; one whose heap stayed high names what holds it in the snapshot.
 *
 *   node scripts/research/mainMemoryWalk.mjs [<a .pdf to open seven copies of>]
 */
import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect as defaultExpect } from '@playwright/test';

import { byRole, processTreeMemory } from '../lib/processMemory.mjs';
import { root, startWalk } from './liveWalk.mjs';
import { editTextOpening } from './textWalkSteps.mjs';

const expect = defaultExpect.configure({ timeout: 30_000 });
const MB = 1024 * 1024;

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const walk = await startWalk('main-memory');
const { app, page, output, open, command, section, step, finish } = walk;
const launched = app.process().pid;
if (launched === undefined) throw new Error('the application has no process id to read memory under');
const mainPid = launched;
const renderer = await page.context().newCDPSession(page);

const copies = await Promise.all(
  Array.from({ length: 7 }, async (_, at) => {
    const path = join(output, `memory-${String(at + 1)}.pdf`);
    await copyFile(sample, path);
    return path;
  }),
);

/** `main`'s heap after a forced collection, and a snapshot of it at `path` when one is asked for. @param {string | null} path */
async function mainHeap(path) {
  return app.evaluate(async (_electron, snapshot) => {
    const inspector = /** @type {typeof import('node:inspector')} */ (process.getBuiltinModule('node:inspector'));
    const session = new inspector.Session();
    session.connect();
    await new Promise((resolve) => session.post('HeapProfiler.collectGarbage', () => resolve(undefined)));
    session.disconnect();
    const usage = process.memoryUsage();
    if (snapshot !== null) {
      const v8 = /** @type {typeof import('node:v8')} */ (process.getBuiltinModule('node:v8'));
      v8.writeHeapSnapshot(snapshot);
    }
    const mb = (/** @type {number} */ bytes) => Math.round(bytes / (1024 * 1024));
    return { heapUsed: mb(usage.heapUsed), heapTotal: mb(usage.heapTotal), external: mb(usage.external), arrayBuffers: mb(usage.arrayBuffers), rss: mb(usage.rss) };
  }, path);
}

/** The renderer's JS heap after a forced collection, and a snapshot of it at `path`. @param {string | null} path */
async function rendererHeap(path) {
  await renderer.send('HeapProfiler.collectGarbage');
  const usage = await renderer.send('Runtime.getHeapUsage');
  if (path !== null) {
    const { writeFile } = await import('node:fs/promises');
    /** @type {string[]} */
    const chunks = [];
    /** @param {{ chunk: string }} event */
    const take = (event) => chunks.push(event.chunk);
    renderer.on('HeapProfiler.addHeapSnapshotChunk', take);
    await renderer.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    renderer.off('HeapProfiler.addHeapSnapshotChunk', take);
    await writeFile(path, chunks.join(''));
  }
  return { usedMB: Math.round(usage.usedSize / MB), totalMB: Math.round(usage.totalSize / MB) };
}

/**
 * How many threads `main` runs, from Windows: each Node worker thread is a thread of its own with an isolate behind it,
 * which is memory `main`'s own heap never shows.
 */
/**
 * THE PROCESS THE READER CALLS `main`, never `app.process()`: the walk launches a wrapper, which the reader names
 * `launcher`, and its thread count says nothing about main (the first reading of this walk read 4 then 1 from it).
 *
 * @param {readonly { role: string, pid: number }[]} processes
 */
function mainThreads(processes) {
  const main = processes.find((each) => each.role === 'main');
  if (main === undefined) throw new Error('the reader found no process it calls main');
  return Number(
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${String(main.pid)}).Threads.Count`], { encoding: 'utf8' }).trim(),
  );
}

/** Every reading at one point, with both snapshots named by `label` unless `snapshots` is false. @param {string} label @param {boolean} [snapshots] */
async function point(label, snapshots = true) {
  const main = await mainHeap(snapshots ? join(output, `${label}-main.heapsnapshot`) : null);
  const view = await rendererHeap(snapshots ? join(output, `${label}-renderer.heapsnapshot`) : null);
  const processes = processTreeMemory(mainPid);
  const rolesMB = Object.fromEntries(Object.entries(byRole(processes)).map(([role, bytes]) => [role, Math.round(bytes / MB)]));
  const totalMB = Math.round(processes.reduce((sum, each) => sum + each.privateBytes, 0) / MB);
  // THE RENDERER'S DEDICATED WORKERS, PDF.js' parsers among them, each an isolate of its own in the renderer process.
  const workers = page.workers().map((worker) => worker.url().replace(/^.*\//u, ''));
  return { totalMB, rolesMB, main, mainThreads: mainThreads(processes), renderer: view, rendererWorkers: workers };
}

await step('A. the start screen', () => point('a-start'));

await step('B. seven documents open, each scrolled to its end and back', async () => {
  for (const path of copies) {
    await open(path);
    const list = page.locator('[data-document-layer="active"] .m-page-list');
    await expect(list).toBeVisible();
    await list.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(10_000);
  return point('b-seven');
});

await step('C. one Edit text action, its write landed and its hosts settled', async () => {
  await section('Edit');
  const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await command('Edit text on the page');
  await editTextOpening(page).openAt(page.locator('[data-text-block]').nth(1));
  await page.keyboard.type(' walked');
  const pageBox = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (pageBox === null) throw new Error('the page is not on screen');
  await page.mouse.click(pageBox.x + pageBox.width - 20, Math.max(pageBox.y, 230) + 20);
  await expect(page.locator('[data-kit-frame]')).toHaveCount(0);
  await page.waitForTimeout(15_000);
  return point('c-edit');
});

await step('D. every document closed, then 60 s', async () => {
  for (let left = await page.locator('[data-tab-select]').count(); left > 0; left -= 1) {
    await command('Close tab');
    const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' });
    const tabs = page.locator('[data-tab-select]');
    const deadline = Date.now() + 30_000;
    let asked = false;
    while (Date.now() < deadline && (await tabs.count()) >= left) {
      if (await unsaved.isVisible()) {
        asked = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    if (asked) await unsaved.getByRole('button', { name: 'Don’t save' }).click();
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
  }
  await page.waitForTimeout(60_000);
  return point('d-closed');
});

await step('E. then Chromium told the computer is short of memory, as Windows tells it, and 10 s', async () => {
  // WHAT CHROMIUM GIVES BACK WHEN ASKED: a critical pressure signal makes it purge its caches and decommit what its
  // allocator keeps, so what stays after it is what something still holds.
  await renderer.send('Memory.simulatePressureNotification', { level: 'critical' });
  await page.waitForTimeout(10_000);
  return point('e-pressed', false);
});

await finish();
