// @ts-check
/**
 * Steady memory of the running application, per process, against the file it holds: FEATURES row 303's *steady memory
 * under 1.5× the file*, read where `perf:gate` cannot — the whole application, renderer included.
 *
 * ## Why this exists beside `perf:gate`
 *
 * The gate measures `main` and the engine host as roles in their own processes and declares the renderer unasserted.
 * Since 2026-10-01 every open document keeps its view (ADR-0129), and the view keeps PDF.js' document, which keeps
 * every byte range it has loaded — so a document read to its end may hold a further copy in the RENDERER, which no
 * figure here had read.
 *
 * ## What it does
 *
 * Three launches of the same build, each with a scratch `--user-data-dir` and its tree ended by PID:
 *
 * 1. **empty** — the start screen, nothing open: each process's fixed cost;
 * 2. **one** — the document named on the command line, opened, then every page brought on screen (End, then back to
 *    the top), then left to settle;
 * 3. **two** — the document and a byte-identical copy at another path, two tabs, each read to its end the same way.
 *
 * After each, every process in the launched tree is read with `Get-CimInstance Win32_Process` (private bytes,
 * `PrivatePageCount`), classified by its command line: `main`, `renderer`, `gpu`, `utility`, and the engine hosts
 * (Node-mode processes). The figure per role is launch minus `empty`, over the file's size.
 *
 * ## The control, and the instrument refuses to report without it (audit item 4a)
 *
 * `main` holds exactly one copy of an open document (ADR-0121), so its delta for **one** must read close to 1.0× the
 * file and its delta for **two** close to 2.0×: a reading of main outside 0.8–1.4× (one) or 1.6–2.6× (two) means the
 * classification, the timing or the counter is wrong, and the run throws rather than reporting the other roles.
 *
 * Usage: node scripts/research/appMemory.mjs --build package|dev [--document <absolute .pdf>]
 * Without `--document`, the scan-shaped fixture (`scripts/perf/largeFixture.mjs`) is generated and measured.
 */

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { repoRoot } from '../lib/gitScope.mjs';
import { buildScanFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { developmentEnvironment } from '../lib/launchEnvironment.mjs';

const ROOT = repoRoot();
const PORT = 9341;
let ending = false;

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const build = option('build');
if (build !== 'package' && build !== 'dev') throw new Error('--build is package or dev');
/** What `npm start` hands a development shell (`launchEnvironment.mjs`); nothing for the package, which finds its own. */
const DEVELOPMENT_ENV = build === 'dev' ? await developmentEnvironment(ROOT) : {};

const scratch = mkdtempSync(join(tmpdir(), 'monstera-memory-'));
// THE SCAN THE OTHER INSTRUMENTS READ, from the one builder (it caches by its own digest), never a second generator.
const documentPath = option('document') ?? buildScanFixture({ root: ROOT }).path;
const copyPath = join(scratch, 'copy.pdf');
copyFileSync(documentPath, copyPath);
const fileBytes = statSync(documentPath).size;

/** The PIDs listening on the debugging port. */
function portListeners() {
  return execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(`127.0.0.1:${String(PORT)} `) && line.includes('LISTENING'))
    .map((line) => Number(line.trim().split(/\s+/u).at(-1)));
}

/** @param {readonly string[]} documents */
function launch(documents) {
  const already = portListeners();
  if (already.length > 0) throw new Error(`port ${String(PORT)} is already held by PID ${already.join(', ')}; end it first`);
  const userData = mkdtempSync(join(tmpdir(), 'monstera-memory-data-'));
  const common = [`--user-data-dir=${userData}`, `--remote-debugging-port=${String(PORT)}`, ...documents];
  const [command, args] =
    build === 'package'
      ? [join(ROOT, 'release', 'msix', 'test', 'layout', 'Monstera.exe'), common]
      : [electronBinaryPath(ROOT), [resolve(ROOT, 'apps', 'desktop'), ...common]];
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ...DEVELOPMENT_ENV } });
  child.on('exit', (code) => {
    if (!ending) console.error(`THE APPLICATION EXITED early, code ${String(code)}`);
  });
  return { child, userData };
}

/** @param {import('node:child_process').ChildProcess} child @param {string} userData */
async function end(child, userData) {
  ending = true;
  const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once('exit', done));
  if (child.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Already gone: the state this wanted.
    }
  }
  await exited;
  for (let i = 0; i < 60 && portListeners().length > 0; i += 1) await new Promise((done) => setTimeout(done, 500));
  // `--keep` leaves the run's user data for its logs to be read, and says where.
  if (process.argv.includes('--keep')) {
    console.error(`KEPT ${userData}`);
    ending = false;
    return;
  }
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`The scratch folder ${userData} was not removed: ${String(error)}`);
  }
  ending = false;
}

/**
 * Every process in the tree under `root`, with its private bytes and its role.
 *
 * @param {number} root
 * @returns {{ pid: number, parent: number, role: string, privateBytes: number }[]}
 */
function treeMemory(root) {
  const script =
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, PrivatePageCount, CommandLine, Name | ConvertTo-Json -Compress';
  const all = /** @type {{ ProcessId: number, ParentProcessId: number, PrivatePageCount: number, CommandLine: string | null, Name: string }[]} */ (
    JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 << 20 }))
  );
  if (process.argv.includes('--dump')) {
    // EVERY PROCESS OF THE APPLICATION'S EXECUTABLE NAME, wherever it hangs and whether its command line is readable.
    const name = build === 'package' ? 'Monstera.exe' : 'electron.exe';
    for (const each of all.filter((p) => p.Name.toLowerCase() === name.toLowerCase())) {
      console.error(`DUMP pid=${String(each.ProcessId)} parent=${String(each.ParentProcessId)} private=${String(each.PrivatePageCount)} cmd=${(each.CommandLine ?? '<unreadable>').slice(-90)}`);
    }
  }
  const inTree = new Set([root]);
  // THE ENGINE HOSTS BY THEIR ENTRY FILES, wherever their parent is: a host is a process `main` creates itself
  // (ADR-0022), and the first reading found none under `main` in the tree — so they are named by what they run.
  for (const process of all) {
    if (/(?:hostEntry|pdfiumHostEntry|composeHostEntry)\.js/u.test(process.CommandLine ?? '')) inTree.add(process.ProcessId);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const process of all) {
      if (!inTree.has(process.ProcessId) && inTree.has(process.ParentProcessId)) {
        inTree.add(process.ProcessId);
        grew = true;
      }
    }
  }
  return all
    .filter((process) => inTree.has(process.ProcessId))
    .map((process) => {
      const line = process.CommandLine ?? '';
      const type = /--type=([a-z-]+)/u.exec(line)?.[1];
      const host = /(hostEntry|pdfiumHostEntry|composeHostEntry)\.js/u.exec(line)?.[1];
      const role =
        process.ProcessId === root
          ? 'main'
          : host !== undefined
            ? `host ${host === 'hostEntry' ? 'mupdf' : host === 'pdfiumHostEntry' ? 'pdfium' : 'compose'}`
          : type === 'renderer'
            ? 'renderer'
            : type === 'gpu-process'
              ? 'gpu'
              : type === 'utility'
                ? 'utility'
                : type === 'crashpad-handler'
                  ? 'crashpad'
                  : (type ?? 'unclassified');
      return { pid: process.ProcessId, parent: process.ParentProcessId, role, privateBytes: Number(process.PrivatePageCount) };
    });
}

/** @param {{ role: string, privateBytes: number }[]} processes */
function byRole(processes) {
  /** @type {Record<string, number>} */
  const sums = {};
  for (const { role, privateBytes } of processes) sums[role] = (sums[role] ?? 0) + privateBytes;
  return sums;
}

/** Brings every page of the page list on screen, then returns to the top, and lets it settle. @param {any} page */
async function readToEnd(page) {
  // THE LAYER ON SHOW: a background document keeps its own, hidden page list (ADR-0129).
  const list = page.locator('[data-document-layer="active"] .m-page-list').first();
  await list.click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  for (let step = 0; step < 400; step += 1) {
    const done = await list.evaluate((/** @type {any} */ element) => {
      element.scrollTop += element.clientHeight;
      return element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
    });
    await page.waitForTimeout(120);
    if (done) break;
  }
  await page.waitForTimeout(2000);
  await list.evaluate((/** @type {any} */ element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(4000);
}

/**
 * One launch: opens what it is given, reads every document to its end, and reads the tree.
 *
 * @param {string} label @param {readonly string[]} documents
 */
async function run(label, documents) {
  const { child, userData } = launch(documents);
  try {
    /** @type {any} */
    let browser;
    for (let i = 0; i < 120 && browser === undefined; i += 1) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
      } catch {
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    if (browser === undefined) throw new Error(`${label}: the application never opened its debugging port`);
    if (!portListeners().includes(/** @type {number} */ (child.pid))) throw new Error(`${label}: the port answers from another process`);
    /** @type {any} */
    let page;
    for (let i = 0; i < 120 && page === undefined; i += 1) {
      for (const candidate of browser.contexts().flatMap((/** @type {any} */ context) => context.pages())) {
        const ready = documents.length === 0 ? '.m-title-bar' : '.m-page-list canvas';
        if (!candidate.isClosed() && (await candidate.locator(ready).count().catch(() => 0)) > 0) page = candidate;
      }
      if (page === undefined) await new Promise((done) => setTimeout(done, 500));
    }
    if (page === undefined) throw new Error(`${label}: no page showed within a minute`);
    await page.getByRole('button', { name: 'Skip' }).click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    // EACH DOCUMENT READ TO ITS END, by its tab: the last opened is on show, so the others are brought forward in turn.
    // THE DOCUMENT TABS by their own attribute: `role="tab"` also names the side panel's tabs, which open no document.
    const tabs = page.locator('[data-tab-select]');
    const count = documents.length === 0 ? 0 : await tabs.count();
    for (let index = 0; index < count; index += 1) {
      await tabs.nth(index).click();
      await page.waitForTimeout(1500);
      await readToEnd(page);
    }
    await page.waitForTimeout(5000);
    const processes = treeMemory(/** @type {number} */ (child.pid));
    return { label, processes, roles: byRole(processes), tabs: count, root: /** @type {number} */ (child.pid) };
  } finally {
    await end(child, userData);
  }
}

try {
  const empty = await run('empty', []);
  const one = await run('one', [documentPath]);
  const two = await run('two', [documentPath, copyPath]);

  /** @param {Record<string, number>} roles */
  const over = (roles) =>
    Object.fromEntries(
      Object.entries(roles).map(([role, bytes]) => [role, Number(((bytes - (empty.roles[role] ?? 0)) / fileBytes).toFixed(2))]),
    );
  const oneOver = over(one.roles);
  const twoOver = over(two.roles);

  // A SECOND CONTROL: an open document has a MuPDF host. The first readings had none — the launch lacked the native
  // components — and a role that is absent is not a role that costs nothing.
  for (const reading of [one, two]) {
    if (!reading.processes.some((p) => p.role === 'host mupdf')) {
      throw new Error(`${reading.label}: no MuPDF host was running, so the engine's share is missing from the reading.`);
    }
  }
  // THE CONTROL: main holds one copy per open document.
  const mainOne = oneOver['main'] ?? 0;
  const mainTwo = twoOver['main'] ?? 0;
  if (!(mainOne >= 0.8 && mainOne <= 1.4) || !(mainTwo >= 1.6 && mainTwo <= 2.6)) {
    throw new Error(
      `CONTROL FAILED: main read ${String(mainOne)}x with one document and ${String(mainTwo)}x with two, where it holds ` +
        'one copy each. The classification or the counter is wrong, and nothing else here is reported.',
    );
  }
  const mib = (/** @type {number} */ bytes) => Number((bytes / 1048576).toFixed(1));
  console.log(
    JSON.stringify(
      {
        build,
        fileMiB: mib(fileBytes),
        tabs: { one: one.tabs, two: two.tabs },
        emptyMiB: Object.fromEntries(Object.entries(empty.roles).map(([role, bytes]) => [role, mib(bytes)])),
        oneMiB: Object.fromEntries(Object.entries(one.roles).map(([role, bytes]) => [role, mib(bytes)])),
        twoMiB: Object.fromEntries(Object.entries(two.roles).map(([role, bytes]) => [role, mib(bytes)])),
        oneOverFile: oneOver,
        twoOverFile: twoOver,
        processes: { one: one.processes.length, two: two.processes.length },
        // WHERE EACH HOST HANGS, and an explicit NONE: a reading with no host would otherwise just omit the role.
        hosts: {
          one: one.processes.filter((p) => p.role.startsWith('host')).map((p) => `${p.role} parent=${String(p.parent === one.root ? 'main' : p.parent)}`),
          two: two.processes.filter((p) => p.role.startsWith('host')).map((p) => `${p.role} parent=${String(p.parent === two.root ? 'main' : p.parent)}`),
        },
      },
      null,
      1,
    ),
  );
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
