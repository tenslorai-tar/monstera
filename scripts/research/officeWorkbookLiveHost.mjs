// @ts-check
/**
 * The child of `officeWorkbookLive.mjs`: a generated workbook imported through the shipped shell — the real composition,
 * the contained x2t and the real compose host — and, as the control, the same workbook through x2t alone.
 *
 * ## The workbook
 *
 * Three sheets. `Big`, the active one, holds {@link BIG_ROWS} rows of ten cells: past x2t's 1,500-page cut-off, so x2t
 * alone hands over a cut PDF. `Hidden` is hidden and must not arrive. `Small` is visible and not active, so x2t alone
 * never prints it. Every row's first text cell carries its sheet's tag and its number, short enough that no column
 * width truncates it, which is how the driver reads which rows reached a PDF.
 *
 * Usage: not directly. `node scripts/research/officeWorkbookLive.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PDFDocument } from '@cantoo/pdf-lib';
import { strToU8, zipSync } from 'fflate';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';

const ROOT = repoRoot();
const REPORT_PATH = process.argv[2] ?? '';

/**
 * Rows on the active sheet: past the cut-off. These rows' cells are narrow, so they print about 51 to a page — 60,000
 * came out on 1,177 pages holding every row (measured 2026-09-30, this harness's first run) — and 100,000 is ~1,960.
 */
const BIG_ROWS = 100_000;
const HIDDEN_ROWS = 50;
const SMALL_ROWS = 300;

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const SHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

/** Each sheet's tag, as the driver searches for it. */
export const TAGS = { Big: 'Bg', Hidden: 'Hd', Small: 'Sm' };

/** @param {string} tag @param {number} count */
function sheetXml(tag, count) {
  const columns = 'ABCDEFGHIJ';
  const rows = [];
  for (let r = 1; r <= count; r += 1) {
    let cells = '';
    for (let c = 0; c < 10; c += 1) {
      const reference = `${columns[c] ?? 'A'}${String(r)}`;
      cells +=
        c === 1
          ? `<c r="${reference}" t="inlineStr"><is><t>${tag}${String(r)}</t></is></c>`
          : `<c r="${reference}"><v>${String(r * 10 + c)}</v></c>`;
    }
    rows.push(`<row r="${String(r)}">${cells}</row>`);
  }
  return strToU8(`${XML}<worksheet xmlns="${MAIN}"><sheetData>${rows.join('')}</sheetData></worksheet>`);
}

function workbook() {
  const sheets = /** @type {const} */ ([
    ['Big', BIG_ROWS, ''],
    ['Hidden', HIDDEN_ROWS, ' state="hidden"'],
    ['Small', SMALL_ROWS, ''],
  ]);
  return zipSync({
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${String(index + 1)}.xml" ContentType="${SHEET_TYPE}"/>`).join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(`${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        sheets.map(([name, , state], index) => `<sheet name="${name}" sheetId="${String(index + 1)}" r:id="rId${String(index + 1)}"${state}/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="${PKG}">` +
        sheets.map((_, index) => `<Relationship Id="rId${String(index + 1)}" Type="${REL}/worksheet" Target="worksheets/sheet${String(index + 1)}.xml"/>`).join('') +
        '</Relationships>',
    ),
    ...Object.fromEntries(sheets.map(([name, count], index) => [`xl/worksheets/sheet${String(index + 1)}.xml`, sheetXml(TAGS[name], count)])),
  });
}

/** @param {string} relative @returns {Promise<any>} */
function built(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href);
}

/**
 * Which rows of each sheet a PDF carries — how many distinct, the lowest and the highest — and its page count.
 *
 * @param {string} scratch @param {Uint8Array} pdf
 */
async function readPdf(scratch, pdf) {
  const file = join(scratch, 'read.pdf');
  writeFileSync(file, pdf);
  const read = spawnSync(pdftotextPath(ROOT), [file, '-'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (read.status !== 0) throw new Error(`pdftotext exited ${String(read.status)}`);
  /** @type {Record<string, { count: number, low: number, high: number }>} */
  const rows = {};
  for (const [name, tag] of Object.entries(TAGS)) {
    const found = [...new Set([...read.stdout.matchAll(new RegExp(`\\b${tag}(\\d+)\\b`, 'gu'))].map((match) => Number(match[1])))];
    rows[name] = {
      count: found.length,
      low: found.reduce((low, row) => Math.min(low, row), Number.POSITIVE_INFINITY),
      high: found.reduce((high, row) => Math.max(high, row), 0),
    };
  }
  return { pages: (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount(), rows };
}

async function main() {
  if (REPORT_PATH === '') throw new Error('officeWorkbookLiveHost.mjs takes the path to write its report to.');
  if (!('electron' in process.versions)) throw new Error('officeWorkbookLiveHost.mjs must run under the Electron binary in Node mode.');

  /** @type {typeof import('../../apps/desktop/src/composition.js')} */
  const composition = await built('apps/desktop/dist/composition.js');
  /** @type {typeof import('../../apps/desktop/src/engineHostPlatform.js')} */
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  /** @type {typeof import('../../apps/desktop/src/harnessComposition.js')} */
  const harnessModule = await built('apps/desktop/dist/harnessComposition.js');
  /** @type {typeof import('../../apps/desktop/src/officeConversion.js')} */
  const office = await built('apps/desktop/dist/officeConversion.js');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-workbook-live-'));
  try {
    const xlsx = workbook();
    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot, {
      report: (outcome) => {
        if (!outcome.ok) process.stderr.write(`package-data check: ${outcome.error}\n`);
      },
    });
    if (platform === null) throw new Error('createEngineHostPlatform returned null, so no contained host can exist here.');
    const composePlatform = platformModule.createComposeHostPlatform(platform);
    if (composePlatform === null) throw new Error('createComposeHostPlatform returned null.');
    const officePlatform = platformModule.createOfficePlatform(platform);
    if (officePlatform === null) throw new Error('createOfficePlatform returned null: MONSTERA_ONLYOFFICE_EXECUTABLE did not reach this process.');

    // THE CONTROL: x2t alone, as the build before decision C converted every workbook. It loses rows one of two ways —
    // a PDF cut at 1,500 pages, or no PDF at all where the sheet exhausts the job's memory — and both are recorded.
    /** @type {string[]} */
    const controlLines = [];
    /** @type {{ pages: number, rows: Record<string, { count: number, low: number, high: number }> } | { failed: string }} */
    let control;
    try {
      const alone = await office.createOfficeSource(officePlatform, (line) => controlLines.push(line.event))('xlsx', xlsx);
      /** @type {Buffer[]} */
      const chunks = [];
      for await (const chunk of alone.output) chunks.push(Buffer.from(chunk));
      control = await readPdf(scratch, new Uint8Array(Buffer.concat(chunks)));
    } catch (error) {
      if (!(error instanceof office.OfficeConversionFailedError)) throw error;
      control = { failed: error.message.slice(0, 200) };
    }

    // THE PRODUCT: the channel a person's click sends, through the composition root.
    const destination = join(scratch, 'Workbook.pdf');
    /** @type {string[]} */
    const failures = [];
    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the workbook live harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickDestination: () => Promise.resolve(destination),
      enginePlatform: platform,
      composePlatform,
      officeImport: {
        platform: officePlatform,
        source: {
          pick: () => Promise.resolve(join(scratch, 'Workbook.xlsx')),
          read: () => Promise.resolve({ kind: 'read', bytes: xlsx }),
        },
      },
      log: {
        directory: scratch,
        failures: (/** @type {{ event: string, detail: string }} */ failure) => {
          failures.push(`${failure.event}: ${failure.detail}`);
        },
        incidents: (/** @type {{ id: string, channel: string }} */ incident) => {
          failures.push(`incident ${incident.id} on ${incident.channel}`);
        },
        reveal: () => Promise.resolve(false),
        write: () => undefined,
      },
    });
    const started = Date.now();
    const answer = await handlers['document.newFromOffice']({});
    const seconds = Math.round((Date.now() - started) / 1000);
    const product = answer.ok ? await readPdf(scratch, new Uint8Array(readFileSync(destination))) : null;
    if (answer.ok && (answer.value.kind === 'opened' || answer.value.kind === 'opened-incomplete')) {
      await handlers['document.close']({ docId: answer.value.docId });
    }

    writeFileSync(
      REPORT_PATH,
      JSON.stringify({
        rows: { Big: BIG_ROWS, Hidden: HIDDEN_ROWS, Small: SMALL_ROWS },
        control,
        controlLines,
        answer: answer.ok ? { kind: answer.value.kind, missing: 'missing' in answer.value ? answer.value.missing : [] } : answer.error,
        product,
        seconds,
        failures,
      }),
    );
  } finally {
    // THE HOSTS FIRST: they are this process's children, and while one lives this process does not end — the first run
    // wrote its report and then waited on them. `hostFileAnswersLiveHost.mjs`' cleanup.
    for (const id of childProcessIds()) {
      try {
        process.kill(id);
      } catch {
        // Already gone.
      }
    }
    const startedAt = Date.now();
    while (childProcessIds().length > 0 && Date.now() - startedAt < 5_000) await new Promise((resolve) => setTimeout(resolve, 250));
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.exit(0);
}

/**
 * This process's child process ids — `hostFileAnswersLiveHost.mjs`' enumeration.
 *
 * @returns {number[]}
 */
function childProcessIds() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(process.pid)}" | ` +
        `Where-Object { $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (result.error !== undefined) throw new Error('could not enumerate this process’s children', { cause: result.error });
  return `${result.stdout}`
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

main().catch((error) => {
  process.stderr.write(`MONSTERA_WORKBOOK_LIVE_FAILED ${formatError(error)}\n`);
  process.exit(1);
});
