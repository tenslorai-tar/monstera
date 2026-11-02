// @ts-check
/**
 * What drawing one page costs PDF.js, and whether the draw can leave the main thread: group S's figures, for the owner
 * to choose how the long frames left in a long-document scroll are treated. Builds nothing in the product.
 *
 * ## What it measures
 *
 * Four generated pages (nothing a person wrote): an ORDINARY text page (40 lines of 11 pt Times), the scroll fixture's
 * DENSE page (64 lines of 9 pt Helvetica, `longScroll.pw.ts`), that page with every line drawn TWICE over itself (the
 * same pixels, twice the letters), and an EMPTY page. Each is drawn at three scales: FULL (2 CSS pixels a point, a page
 * fitted to a 1,600-pixel window), HALF and QUARTER. For each, three readings (`drawCost/page.mjs`):
 *
 * - display: the app's own draw, in 15 ms slices each started in an animation frame: how long the page takes to appear;
 * - contiguous: the same draw with no frames waited for (the print intent): the drawing's own cost on the thread;
 * - worker: the draw inside a worker onto an OffscreenCanvas, and then the hand-over: one drawImage of the finished
 *   ImageBitmap on the main thread, which is what a scrolling frame would still pay.
 *
 * Under the renderer's own Content-Security-Policy, served as a header from `apps/desktop/dist/windowPolicy.js` (the
 * derived form `proof:rendererpolicy` holds equal to ARCHITECTURE §9.27), in the pinned Chromium (Playwright's) and in
 * the pinned Electron's renderer.
 *
 * ## The resolution test, before anything is reported (audit item 4a)
 *
 * The instrument must see a drawing difference made on purpose: the doubled page has the dense page's pixels and twice
 * its letters, so its contiguous draw must cost at least 1.3 times the dense page's at full scale, and the empty page
 * must cost under a third of it. Otherwise it reports nothing for that browser.
 *
 * Usage: node scripts/research/drawCost.mjs [--rounds 7] [--skip-electron]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { BROWSERS_PATH } from '../provision/playwright.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, [['apps/desktop/src/windowPolicy.ts', 'apps/desktop/dist/windowPolicy.js', 'tsc']], 1);
const { CONTENT_SECURITY_POLICY } = await import('../../apps/desktop/dist/windowPolicy.js');

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}
const ROUNDS = Number(option('rounds') ?? '7');
const WARMUP = 2;
const SCALES = [2, 1, 0.5];
const MARKER = 'MONSTERA_DRAW_COST ';

const LINE = 'The quarterly figures were reconciled against the ledger and every account balanced to the cent, as before.';
const PROSE = 'A page of ordinary prose set in a book face, one line after another, as most documents are written.';

/** The four pages, each as one PDF. */
async function fixtures() {
  /** @param {(page: import('@cantoo/pdf-lib').PDFPage, fonts: { serif: import('@cantoo/pdf-lib').PDFFont, sans: import('@cantoo/pdf-lib').PDFFont }) => void} draw */
  const make = async (draw) => {
    const document = await PDFDocument.create();
    const fonts = { serif: await document.embedFont(StandardFonts.TimesRoman), sans: await document.embedFont(StandardFonts.Helvetica) };
    draw(document.addPage([612, 792]), fonts);
    return Buffer.from(await document.save()).toString('base64');
  };
  /** @param {import('@cantoo/pdf-lib').PDFPage} page @param {import('@cantoo/pdf-lib').PDFFont} font */
  const dense = (page, font) => {
    for (let line = 0; line < 64; line += 1) page.drawText(`1.${String(line + 1)} ${LINE}`, { x: 48, y: 760 - line * 11, size: 9, font, color: rgb(0, 0, 0) });
  };
  return [
    {
      name: 'ordinary',
      base64: await make((page, { serif }) => {
        for (let line = 0; line < 40; line += 1) page.drawText(PROSE, { x: 72, y: 720 - line * 16, size: 11, font: serif, color: rgb(0, 0, 0) });
      }),
    },
    { name: 'dense', base64: await make((page, { sans }) => dense(page, sans)) },
    {
      name: 'doubled',
      base64: await make((page, { sans }) => {
        dense(page, sans);
        dense(page, sans);
      }),
    },
    { name: 'empty', base64: await make(() => undefined) },
  ];
}

/** The page's files, served from one origin with the renderer's policy on every answer. */
function serve(/** @type {string} */ fixturesModule) {
  const pdfjs = join(ROOT, 'node_modules', 'pdfjs-dist', 'build');
  const here = join(ROOT, 'scripts', 'research', 'drawCost');
  /** @type {Record<string, () => { readonly type: string, readonly body: string | Buffer }>} */
  const files = {
    '/': () => ({ type: 'text/html', body: readFileSync(join(here, 'index.html')) }),
    '/page.mjs': () => ({ type: 'text/javascript', body: readFileSync(join(here, 'page.mjs')) }),
    '/drawWorker.mjs': () => ({ type: 'text/javascript', body: readFileSync(join(here, 'drawWorker.mjs')) }),
    '/pdf.mjs': () => ({ type: 'text/javascript', body: readFileSync(join(pdfjs, 'pdf.mjs')) }),
    '/pdf.worker.mjs': () => ({ type: 'text/javascript', body: readFileSync(join(pdfjs, 'pdf.worker.mjs')) }),
    '/fixtures.mjs': () => ({ type: 'text/javascript', body: fixturesModule }),
    // THE ONE OWNER OF AN ERROR'S STACK (`check:stackowner`), served as it is: it imports nothing, so it runs in a page.
    '/reportError.mjs': () => ({ type: 'text/javascript', body: readFileSync(join(ROOT, 'scripts', 'lib', 'reportError.mjs')) }),
  };
  const server = createServer((request, response) => {
    const file = files[(request.url ?? '/').split('?')[0] ?? '/'];
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    const { type, body } = file();
    response.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'Cache-Control': 'no-store' });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}/` });
    });
  });
}

/** The readings in the pinned Chromium. @param {string} url */
async function inChromium(url) {
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = BROWSERS_PATH;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    /** @type {string[]} */
    const violations = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused/u.test(message.text())) violations.push(message.text().slice(0, 300));
    });
    // A WORKER'S OWN CONSOLE AND ERRORS, which the page does not see.
    page.on('worker', (worker) => {
      worker.on('console', (message) => violations.push(`worker console: ${message.text().slice(0, 300)}`));
    });
    page.on('pageerror', (error) => violations.push(`page error: ${error.message.slice(0, 300)}`));
    await page.goto(url);
    // IN THE PAGE, through `globalThis`: this file is checked as Node code, which has no `window`.
    await page.waitForFunction(() => /** @type {any} */ (globalThis).drawCost !== undefined, undefined, { timeout: 600_000 });
    const result = await page.evaluate(() => /** @type {any} */ (globalThis).drawCost);
    return { ...result, browser: browser.version(), violations };
  } finally {
    await browser.close();
  }
}

/** Electron's main process: one window, shown (a hidden one has its frames throttled), the page loaded, its readings printed. */
const ELECTRON_MAIN = String.raw`
const { app, BrowserWindow } = require('electron');
const url = process.argv[process.argv.length - 1];
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1600, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const violations = [];
  window.webContents.on('console-message', (details) => {
    const text = String(details.message || '');
    if (/Content Security Policy|Refused|Error|error/.test(text)) violations.push(text.slice(0, 300));
  });
  window.webContents.on('render-process-gone', (_event, details) => violations.push('renderer gone: ' + details.reason));
  process.stdout.write('MONSTERA_DRAW_COST_STAGE window\n');
  await window.loadURL(url);
  process.stdout.write('MONSTERA_DRAW_COST_STAGE loaded\n');
  const limit = Number(process.env.MONSTERA_DRAW_COST_WAIT || '600');
  for (let waited = 0; waited < limit; waited += 1) {
    const result = await window.webContents.executeJavaScript('window.drawCost');
    if (result !== undefined && result !== null) {
      process.stdout.write('MONSTERA_DRAW_COST ' + JSON.stringify(Object.assign({}, result, { browser: 'Electron ' + process.versions.electron + ' (Chromium ' + process.versions.chrome + ')', violations })) + '\n');
      app.quit();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const at = await window.webContents.executeJavaScript('String(window.drawCostAt) + " in " + document.readyState');
  process.stdout.write('MONSTERA_DRAW_COST ' + JSON.stringify({ ok: false, error: 'no readings within ' + limit + ' s; the page was at ' + at, violations }) + '\n');
  app.quit();
});
`;

/** The readings in the pinned Electron's renderer. @param {string} url */
async function inElectron(url) {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-draw-cost-'));
  try {
    writeFileSync(join(scratch, 'main.js'), ELECTRON_MAIN, 'utf8');
    writeFileSync(join(scratch, 'package.json'), `${JSON.stringify({ name: 'monstera-draw-cost', version: '0.0.0', main: 'main.js' })}\n`, 'utf8');
    const electron = electronBinaryPath(ROOT);
    const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
    const wrapper = ['/usr/bin/xvfb-run', '/bin/xvfb-run'].find((path) => existsSync(path));
    if (needsDisplay && wrapper === undefined) return { ok: false, error: 'Electron needs a display on Linux and no xvfb-run was found' };
    // AS ROOT, Chromium refuses to start with its process sandbox ("Running as root without --no-sandbox is not supported",
    // measured 2026-11-02 in a cloud container): the flag is passed then alone, and said in the report, since it turns off
    // the operating system's sandbox and not the web platform's — workers, OffscreenCanvas and the page's policy.
    const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const own = [...(asRoot ? ['--no-sandbox'] : []), scratch, url];
    const [command, args] = needsDisplay && wrapper !== undefined ? [wrapper, ['-a', electron, ...own]] : [electron, own];
    const wait = Number(process.env['MONSTERA_DRAW_COST_WAIT'] ?? '600');
    // NOT spawnSync: the page is served from THIS process, and a synchronous spawn holds its event loop, so the server
    // never answered Electron's request and the window waited on its first load for ever (measured 2026-11-02).
    /** @type {{ stdout: string, status: number | null }} */
    const result = await new Promise((resolve) => {
      const child = spawn(command, args, { env: { ...process.env, MONSTERA_DRAW_COST_WAIT: String(wait) } });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.resume();
      const timer = setTimeout(() => child.kill(), (wait + 120) * 1000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ stdout, status });
      });
    });
    const line = `${result.stdout}`.split('\n').find((entry) => entry.startsWith(MARKER));
    const stages = `${result.stdout}`.split('\n').filter((entry) => entry.startsWith('MONSTERA_DRAW_COST_STAGE ')).map((entry) => entry.slice(25));
    if (line === undefined) return { ok: false, error: `no readings; exit ${String(result.status)}; it reached: ${stages.join(', ') || 'nothing'}` };
    const parsed = JSON.parse(line.slice(MARKER.length));
    return { ...parsed, browser: `${String(parsed.browser)}${asRoot ? ', run as root with --no-sandbox' : ''}` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** @param {Record<string, any>} readings */
function resolutionTest(readings) {
  const dense = readings['dense@2']?.contiguous?.median;
  const doubled = readings['doubled@2']?.contiguous?.median;
  const empty = readings['empty@2']?.contiguous?.median;
  if (!(dense > 0) || !(doubled >= dense * 1.3) || !(empty < dense / 3)) {
    throw new Error(`the instrument cannot see a drawing difference made on purpose: dense ${String(dense)} ms, doubled ${String(doubled)} ms, empty ${String(empty)} ms`);
  }
  return `doubled letters ${(doubled / dense).toFixed(2)}x the dense page, empty ${(empty / dense).toFixed(2)}x`;
}

/** @param {string} where @param {any} result */
function report(where, result) {
  console.log(`\n== ${where}: ${String(result.browser ?? '')}`);
  if (result.ok !== true) {
    console.log(`  no readings: ${String(result.error)}`);
    if (Array.isArray(result.violations) && result.violations.length > 0) console.log(`  the page said: ${result.violations.join(' | ')}`);
    return;
  }
  try {
    console.log(`  resolution test PASSED: ${resolutionTest(result.readings)}`);
  } catch (error) {
    // NO FIGURES WITHOUT IT: an instrument that cannot see a difference made on purpose reports nothing it measured.
    console.log(`  resolution test FAILED, so no figures: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  console.log(`  policy violations seen: ${result.violations.length === 0 ? 'none' : result.violations.join(' | ')}`);
  console.log('  page@scale        display ms (min-max)      contiguous ms (min-max)   worker draw ms          hand-over ms');
  for (const [key, value] of Object.entries(result.readings)) {
    /** @param {{ median: number, min: number, max: number }} each */
    const cell = (each) => `${String(each.median).padStart(6)} (${String(each.min)}-${String(each.max)})`.padEnd(24);
    const worker = value.worker.ok === true ? `${cell(value.worker.draw)}  ${cell(value.worker.handover)}` : `FAILED at ${String(value.worker.stage)}: ${String(value.worker.error).split('\n')[0]}`;
    console.log(`  ${key.padEnd(16)}  ${cell(value.display)}  ${cell(value.contiguous)}  ${worker}`);
  }
  const full = result.readings['dense@2']?.contiguous?.median;
  for (const name of ['ordinary', 'dense']) {
    const at = (/** @type {number} */ scale) => result.readings[`${name}@${String(scale)}`]?.contiguous?.median ?? Number.NaN;
    console.log(`  ${name}: half saves ${(100 * (1 - at(1) / at(2))).toFixed(0)}%, quarter saves ${(100 * (1 - at(0.5) / at(2))).toFixed(0)}% of the full draw`);
  }
  void full;
}

async function main() {
  const pages = await fixtures();
  const fixturesModule = `export const FIXTURES = ${JSON.stringify(pages)};\nexport const SCALES = ${JSON.stringify(SCALES)};\nexport const ROUNDS = ${String(ROUNDS)};\nexport const WARMUP = ${String(WARMUP)};\n`;
  const { server, url } = /** @type {{ server: import('node:http').Server, url: string }} */ (await serve(fixturesModule));
  try {
    report('Chromium', await inChromium(url));
    if (!process.argv.includes('--skip-electron')) report('Electron', await inElectron(url));
  } finally {
    server.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
});
