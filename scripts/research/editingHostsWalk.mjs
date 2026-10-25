// @ts-check
/**
 * Whether the editing hosts stay running while the Edit tab is in use, and stop once it is left: the owner's item 7a of
 * 2026-10-24 (ADR-0048's correction of that day, `editingEngines.ts`). `main` stops a host `HOST_IDLE_MS` after its last
 * call; the Edit tab renews its ask every `EDITING_RENEW_MS`.
 *
 *   node scripts/research/editingHostsWalk.mjs [--stay <s>] [--away <s>]
 *
 * A document made here is opened and the Edit tab chosen; the app's engine-host processes are listed every 15 s for
 * `--stay` seconds (150 by default, past two idle periods), by the entry file each was started with. Then the Home tab is
 * chosen and the listing goes on for `--away` seconds (100 by default): THE CONTROL, where the editing hosts must stop —
 * without it, hosts that never stop and an instrument that cannot see a host stop would read as the same pass. Last, the
 * Edit tab again and Edit text chosen, timed to the first block outlined.
 *
 * Processes are read with `Get-CimInstance Win32_Process` below the app's own `main`, so a host of another app or of an
 * earlier run is never counted. Nothing a person wrote is read.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { startWalk } from './liveWalk.mjs';

const argv = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : Number(argv[at + 1]);
};
const STAY_S = option('--stay', 150);
const AWAY_S = option('--away', 100);
const EVERY_MS = 15_000;
const ENTRIES = { mupdf: 'hostEntry.js', pdfium: 'pdfiumHostEntry.js', compose: 'composeHostEntry.js' };

/** A one-page document of plain paragraphs, made here. */
async function plainDocument() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  ['The committee met on the fourth of the month', 'and agreed the plan for the spring season.'].forEach((line, at) =>
    page.drawText(line, { x: 72, y: 700 - at * 16, size: 12, font }),
  );
  const folder = await mkdtemp(join(tmpdir(), 'monstera-hosts-'));
  const path = join(folder, 'plain.pdf');
  await writeFile(path, await document.save());
  return path;
}

/**
 * The engine hosts below `root`, by kind, each as its process ids. @param {number} root `main`'s process id
 * @returns {Record<string, number[]>}
 */
function hostsBelow(root) {
  const json = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  /** @type {{ ProcessId: number, ParentProcessId: number, CommandLine: string | null }[]} */
  const all = JSON.parse(json);
  const below = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const each of all) {
      if (below.has(each.ParentProcessId) && !below.has(each.ProcessId)) {
        below.add(each.ProcessId);
        grew = true;
      }
    }
  }
  /** @type {Record<string, number[]>} */
  const found = { mupdf: [], pdfium: [], compose: [] };
  for (const each of all) {
    if (!below.has(each.ProcessId) || each.ProcessId === root) continue;
    const line = each.CommandLine ?? '';
    // THE LONGEST ENTRY NAME FIRST: `hostEntry.js` is the tail of the other two.
    const kind = ['pdfium', 'compose', 'mupdf'].find((name) => line.includes(ENTRIES[/** @type {keyof typeof ENTRIES} */ (name)]));
    if (kind !== undefined) found[kind]?.push(each.ProcessId);
  }
  return found;
}

const walk = await startWalk('editing-hosts');
const { app, page } = walk;
const mainPid = await app.evaluate(() => process.pid);
await walk.open(await plainDocument());
await walk.section('Edit');
const began = Date.now();
/** @type {{ phase: string, atS: number, hosts: Record<string, number[]> }[]} */
const readings = [];
const watch = async (/** @type {string} */ phase, /** @type {number} */ seconds) => {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    readings.push({ phase, atS: Math.round((Date.now() - began) / 1000), hosts: hostsBelow(mainPid) });
    process.stdout.write(`${JSON.stringify(readings.at(-1))}\n`);
    if (Date.now() >= until) break;
    await page.waitForTimeout(Math.min(EVERY_MS, until - Date.now()));
  }
};
await watch('edit tab', STAY_S);
await walk.section('Home');
await watch('home tab (control)', AWAY_S);
await walk.section('Edit');
const chose = Date.now();
const control = page.locator('[data-command="text.edit"]:visible').first();
if ((await control.getAttribute('aria-pressed')) !== 'true') await control.click();
await page.locator('[data-text-edit-layer]:visible [data-text-block]').first().waitFor({ timeout: 60_000 });
const outlinedMs = Date.now() - chose;
await app.close();

const editing = readings.filter((reading) => reading.phase === 'edit tab');
const away = readings.filter((reading) => reading.phase !== 'edit tab');
/** The same process ids for a kind across `list`: a host that stopped and was built again has another. */
const steady = (/** @type {typeof readings} */ list, /** @type {string} */ kind) =>
  list.every((reading) => (reading.hosts[kind]?.length ?? 0) > 0 && JSON.stringify(reading.hosts[kind]) === JSON.stringify(list[0]?.hosts[kind]));
const summary = {
  pdfiumSteadyInEditTab: steady(editing, 'pdfium'),
  composeSteadyInEditTab: steady(editing, 'compose'),
  editingHostsGoneAway: (away.at(-1)?.hosts['pdfium']?.length ?? 1) === 0 && (away.at(-1)?.hosts['compose']?.length ?? 1) === 0,
  editTextOutlinedAfterReturnMs: outlinedMs,
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
await writeFile(join(walk.output, 'editing-hosts.json'), `${JSON.stringify({ readings, summary }, null, 2)}\n`);
