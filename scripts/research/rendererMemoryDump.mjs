// @ts-check
/**
 * Which of the renderer's allocators holds what, at the start screen and after seven documents were opened and closed:
 * Chromium's own memory dump (the `memory-infra` trace category), read through the DevTools protocol. Session 2 item 3:
 * the renderer held about 140 MB more after every document was closed than at the start, with its JS heap only 10 MB
 * more, its PDF.js workers ended, and a critical memory-pressure signal giving back almost none of it.
 *
 * Each dump lists, per process, the allocators Chromium accounts (`malloc`, `partition_alloc`, `blink_gc`, `v8`,
 * `skia`, `gpu`, `discardable`, `cc`, `web_cache`, ...) with their sizes. The walk prints the renderer's top-level ones
 * at both points and their difference. Its control: every dump must hold a `v8` allocator for the renderer, which every
 * renderer has, or the dump was read from the wrong process or the wrong field.
 *
 *   node scripts/research/rendererMemoryDump.mjs [<a .pdf to open seven copies of>]
 */
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect as defaultExpect } from '@playwright/test';

import { root, startWalk } from './liveWalk.mjs';

const expect = defaultExpect.configure({ timeout: 30_000 });
const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const walk = await startWalk('renderer-memory');
const { page, output, open, command, step, finish } = walk;
const session = await page.context().newCDPSession(page);

/**
 * One memory dump of every process, as Chromium accounts it: the trace's `memory-infra` events, with the renderer's
 * own picked out by the page's process id.
 *
 * @param {string} label
 */
async function dump(label) {
  // COLLECTED FIRST, V8's heap and Blink's together (the unified heap), so what the dump holds is what something keeps.
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  /** @type {unknown[]} */
  const events = [];
  /** @param {{ value: unknown[] }} data */
  const collect = (data) => events.push(...data.value);
  session.on('Tracing.dataCollected', collect);
  await session.send('Tracing.start', {
    // NO PERIODIC DUMPS: the one dump is asked for below, with the collection before it.
    traceConfig: { includedCategories: ['disabled-by-default-memory-infra'] },
  });
  const requested = await session.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  const done = new Promise((resolve) => session.once('Tracing.tracingComplete', () => resolve(undefined)));
  await session.send('Tracing.end');
  await done;
  session.off('Tracing.dataCollected', collect);
  await writeFile(join(output, `${label}-dump.json`), JSON.stringify(events));
  if (!requested.success) throw new Error('Chromium refused the memory dump');
  return events;
}

/**
 * The renderer's top-level allocators, in whole MB, from a dump: each `allocators` entry whose name has no `/`, read from
 * its `size` attribute (hex bytes, as the trace states sizes). The renderer is the process whose dump carries the
 * page's own process id, which `SystemInfo` cannot give a page session, so it is the one dump with a `blink_gc` and a
 * `v8` allocator and the most `partition_alloc`.
 *
 * @param {readonly unknown[]} events
 */
function rendererAllocators(events) {
  /** @type {Map<number, Record<string, number>>} */
  const byProcess = new Map();
  for (const event of events) {
    const { name, pid, args } = /** @type {{ name?: string, pid?: number, args?: { dumps?: { allocators?: Record<string, { attrs?: { size?: { value?: string } } }> } } }} */ (
      event
    );
    if (name !== 'periodic_interval' && name !== 'explicitly_triggered') continue;
    const allocators = args?.dumps?.allocators;
    if (pid === undefined || allocators === undefined) continue;
    const sizes = byProcess.get(pid) ?? {};
    for (const [key, value] of Object.entries(allocators)) {
      if (key.includes('/')) continue;
      const hex = value.attrs?.size?.value;
      if (hex !== undefined) sizes[key] = Math.round(Number.parseInt(hex, 16) / (1024 * 1024));
    }
    byProcess.set(pid, sizes);
  }
  const renderers = [...byProcess.entries()].filter(([, sizes]) => sizes['blink_gc'] !== undefined && sizes['v8'] !== undefined);
  if (renderers.length === 0) throw new Error(`no process in the dump carries blink_gc and v8; processes: ${JSON.stringify([...byProcess.keys()])}`);
  renderers.sort(([, a], [, b]) => (b['partition_alloc'] ?? 0) - (a['partition_alloc'] ?? 0));
  const [pid, sizes] = renderers[0] ?? [0, {}];
  return { pid, sizes, processes: byProcess.size };
}

/** Blink's own count of what is alive: documents, DOM nodes and JS event listeners, after the dump's collection. */
async function counters() {
  return session.send('Memory.getDOMCounters');
}

/**
 * The listeners on `window`, `document` and `document.body`, counted by target, event type and the handler's source
 * place (script and line, as DevTools names a function), so a set that grows names the code that added it.
 */
async function listeners() {
  await session.send('Debugger.enable');
  /** @type {Map<string, string>} */
  const scripts = new Map();
  /** @type {Record<string, number>} */
  const counted = {};
  for (const target of ['window', 'document', 'document.body']) {
    const { result } = await session.send('Runtime.evaluate', { expression: target });
    if (result.objectId === undefined) continue;
    const { listeners: found } = await session.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    for (const each of found) {
      let url = scripts.get(each.scriptId);
      if (url === undefined) {
        const source = await session.send('Debugger.getScriptSource', { scriptId: each.scriptId }).catch(() => undefined);
        url = source === undefined ? each.scriptId : `${each.scriptId}`;
        scripts.set(each.scriptId, url);
      }
      const key = `${target} ${each.type} @${url}:${String(each.lineNumber)}:${String(each.columnNumber)}`;
      counted[key] = (counted[key] ?? 0) + 1;
    }
  }
  return counted;
}

/** @type {Record<string, number>} */
let listenersAtStart = {};

/** @type {Record<string, number>} */
let atStart = {};
await step('A. the start screen: the renderer’s allocators', async () => {
  const read = rendererAllocators(await dump('a-start'));
  atStart = read.sizes;
  listenersAtStart = await listeners();
  return { ...read, dom: await counters() };
});

await step('B-D. seven documents opened and scrolled, then every one closed and 60 s waited', async () => {
  for (let at = 0; at < 7; at += 1) {
    const path = join(output, `memory-${String(at + 1)}.pdf`);
    await copyFile(sample, path);
    await open(path);
    const list = page.locator('[data-document-layer="active"] .m-page-list');
    await expect(list).toBeVisible();
    await list.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
    await page.waitForTimeout(1500);
  }
  for (let left = await page.locator('[data-tab-select]').count(); left > 0; left -= 1) {
    await command('Close tab');
    await expect(page.locator('[data-tab-select]')).toHaveCount(left - 1, { timeout: 30_000 });
  }
  await page.waitForTimeout(60_000);
  const read = rendererAllocators(await dump('d-closed'));
  const grew = Object.fromEntries(
    Object.keys({ ...atStart, ...read.sizes })
      .map((key) => [key, (read.sizes[key] ?? 0) - (atStart[key] ?? 0)])
      .filter(([, mb]) => mb !== 0),
  );
  const now = await listeners();
  const listenersGrew = Object.fromEntries(
    Object.keys({ ...listenersAtStart, ...now })
      .map((key) => [key, (now[key] ?? 0) - (listenersAtStart[key] ?? 0)])
      .filter(([, count]) => count !== 0),
  );
  return { ...read, grewMB: grew, dom: await counters(), listenersGrew };
});

await finish();
