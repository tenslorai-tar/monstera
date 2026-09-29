// @ts-check
/**
 * Does ONLYOFFICE's `x2t` convert a `.docx`, `.xlsx` and `.pptx` to PDF inside an AppContainer with only what it was
 * handed? — item 8a of the owner's list of 28 September.
 *
 * ## Why this exists, and why it is research rather than a proof
 *
 * ADR-0092 deferred Office import because LibreOffice creates a fixed-name pipe before converting, which an
 * AppContainer refuses. Its third reopening route is *"a converter for these formats that runs inside the container as
 * it stands"*. This is `libreofficeContained.mjs`' shape pointed at `x2t`: the same granted session pair, the same host
 * surface with a program kind of `converter`, and an UNCONTAINED cell first as the control — a contained cell with no
 * PDF means nothing until its twin converts outside. It measures a machine and a 180 MB tree of somebody else's program,
 * so it is run by hand.
 *
 * ## What it is handed
 *
 * `MONSTERA_X2T_ROOT` — an extracted Document Builder, whose tree carries a read-and-execute grant for the SID of the
 * container profile below, applied before this runs. `MONSTERA_X2T_INPUTS` — a folder holding `probe.docx`,
 * `probe.xlsx` and `probe.pptx`. The input and a params file sit in the snapshot half; the PDF and a temporary
 * directory in the output half, one level down, which is where the container may write.
 *
 * ## The reading of 2026-09-29 (Document Builder v9.4.0, x2t.exe 39,539,696 bytes)
 *
 * All six cells converted, contained and uncontained alike: `.docx` 71,821 bytes, a hand-written `.xlsx` 35,001 and
 * `.pptx` 36,498, each `%PDF-1.7`, each read back by Poppler. With the tree's grant removed, the contained `.docx`
 * cell wrote nothing while its uncontained twin converted — the control that the contained cells were contained.
 *
 * That reading was taken on a scratch extraction before `provision:onlyoffice` existed. The script now runs the
 * provisioned tree, named through `x2tPath()` — the converter resolver `check:electronbinary` sanctions — so it
 * measures the tree the product runs rather than one somebody unpacked.
 *
 * Usage: MONSTERA_X2T_INPUTS=<folder> node scripts/research/x2tContained.mjs [--only <cell>]
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { onlyofficeRoot, x2tPath } from '../provision/onlyoffice.mjs';

const ROOT = repoRoot();
const TREE = onlyofficeRoot(ROOT);
const INPUTS = process.env['MONSTERA_X2T_INPUTS'] ?? '';

/** Its own profile name: two instruments sharing one container share whatever either leaves. */
const CONTAINER = 'monstera-x2t-convert';

/** How long one conversion may take before this reports that it did not finish. */
const CONVERT_BUDGET_MS = 90_000;

if (process.platform !== 'win32') {
  process.stderr.write('x2tContained: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}
if (!existsSync(x2tPath(ROOT))) {
  process.stderr.write('x2tContained: run npm run provision:onlyoffice first.\n');
  process.exit(69);
}
if (INPUTS === '') {
  process.stderr.write('x2tContained: MONSTERA_X2T_INPUTS must name a folder holding probe.docx, .xlsx and .pptx.\n');
  process.exit(69);
}

/** @param {string} relative */
const built = async (relative) => import(pathToFileURL(join(ROOT, relative)).href);

const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directories = await built('apps/desktop/dist/win32DirectorySurface.js');
const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Whether a process id is still running — `libreofficeContained.mjs`' reader, for its reason.
 *
 * @param {number} pid
 */
function alive(pid) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  return `${result.stdout}`.trim() === 'yes';
}

/** @param {string} text */
const xml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const scratch = mkdtempSync(join(tmpdir(), 'monstera-x2t-contained-'));

/**
 * One cell: a granted pair, the input copied in under a fixed name, a params file, one conversion.
 *
 * @param {string} cell
 * @param {boolean} contained
 * @param {'docx' | 'xlsx' | 'pptx'} format
 * @param {number} cellIndex its own session directory pair
 * @returns {{ cell: string, outcome: string, detail: string, bytes: number | null, log: string, pdf: Buffer | null }}
 */
function convert(cell, contained, format, cellIndex) {
  const refused = (/** @type {string} */ outcome, /** @type {string} */ detail) => ({
    cell,
    outcome,
    detail,
    bytes: null,
    log: '',
    pdf: null,
  });
  const user = pipes.currentUserSid();
  if (!user.ok) return refused('no-user-sid', String(user.error));
  const container = pipes.hostContainerSid(CONTAINER);
  if (!container.ok) return refused('no-container-sid', String(container.error));
  const name = sessionDirectories.sessionDirectoryName(`ad-${cellIndex.toString(16)}-${process.pid.toString(16)}`);
  if (!name.ok) return refused('bad-name', String(name.error));
  const paths = sessionDirectories.sessionDirectoryPaths(scratch, name.value);
  const made = sessionDirectories.createSessionDirectories(
    directories.createWin32DirectorySurface(),
    paths,
    user.value,
    container.value,
  );
  if (!made.ok) return refused('no-pair', `${String(made.error.stage)}: ${String(made.error.detail)}`);

  // A FIXED NAME, ADR-0063 Decision 2's rule: a picked file's own name never reaches a command line.
  /** @type {string} */
  const input = join(paths.snapshot, `in.${format}`);
  copyFileSync(join(INPUTS, `probe.${format}`), input);
  /** @type {string} */
  const out = join(paths.output, 'pdf');
  /** @type {string} */
  const temp = join(paths.output, 'temp');
  mkdirSync(out, { recursive: true });
  mkdirSync(temp, { recursive: true });
  const expected = join(out, 'out.pdf');
  const params = join(paths.snapshot, 'params.xml');
  writeFileSync(
    params,
    '<?xml version="1.0" encoding="utf-8"?>\n<TaskQueueDataConvert>' +
      `<m_sFileFrom>${xml(input)}</m_sFileFrom><m_sFileTo>${xml(expected)}</m_sFileTo>` +
      '<m_nFormatTo>513</m_nFormatTo>' +
      `<m_sFontDir>${xml(join(TREE, 'fonts'))}</m_sFontDir>` +
      `<m_sAllFontsPath>${xml(join(TREE, 'sdkjs', 'common', 'AllFonts.js'))}</m_sAllFontsPath>` +
      `<m_sThemeDir>${xml(join(TREE, 'sdkjs', 'slide', 'themes'))}</m_sThemeDir>` +
      `<m_sTempDir>${xml(temp)}</m_sTempDir>` +
      '</TaskQueueDataConvert>\n',
    'utf8',
  );

  const logPath = join(scratch, `${cell}.log`);
  const surface = hostSurface.createWin32HostSurface({
    program: { runs: 'converter', executablePath: x2tPath(ROOT), commandArguments: [params] },
    workingDirectory: TREE,
    containerName: contained ? CONTAINER : null,
    diagnosticPath: logPath,
  });
  const started = Date.now();
  const created = surface.createSuspended();
  if (!created.ok) return refused('create-failed', String(created.error));
  // THE RESUME'S ANSWER IS READ: a suspended process never resumed writes nothing, as a crashed one does.
  const resumed = surface.resume(created.value.thread);
  const pid = created.value.pid;
  const deadline = Date.now() + CONVERT_BUDGET_MS;
  while (Date.now() < deadline && alive(pid)) sleep(250);
  const running = alive(pid);
  const elapsed = Date.now() - started;
  if (running) surface.terminate(created.value.process);
  surface.close(created.value.process);
  surface.close(created.value.thread);
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const wrote = existsSync(out) ? readdirSync(out).join(', ') || '(nothing)' : '(no output directory)';
  const where =
    `pid ${String(pid)}, resume ${JSON.stringify(resumed)}, ` +
    `${running ? 'STILL RUNNING at the budget' : 'exited'} after ${String(elapsed)} ms, out: ${wrote}`;
  if (!existsSync(expected)) return { ...refused('no-pdf', where), log };
  const pdf = readFileSync(expected);
  // THE FIRST BYTES, because a file of the right name and the wrong content is what a half-written conversion leaves.
  const head = pdf.subarray(0, 8).toString('latin1');
  return {
    cell,
    outcome: head.startsWith('%PDF-') ? 'converted' : 'not-a-pdf',
    detail: `first bytes ${JSON.stringify(head)} — ${where}`,
    bytes: statSync(expected).size,
    log,
    pdf,
  };
}

try {
  process.stdout.write(`x2t: ${x2tPath(ROOT)}\ncontainer: ${CONTAINER}\n\n`);
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
  let index = 0;
  for (const format of /** @type {const} */ (['docx', 'xlsx', 'pptx'])) {
    // THE CONTROL FIRST: the same params through the same surface, uncontained.
    for (const contained of [false, true]) {
      const cell = `${format}-${contained ? 'contained' : 'uncontained'}`;
      index += 1;
      if (only !== undefined && !cell.includes(only)) continue;
      const result = convert(cell, contained, format, index);
      if (result.pdf !== null) writeFileSync(join(scratch, `${cell}.pdf`), result.pdf);
      process.stdout.write(
        `${result.cell}: ${result.outcome}\n  ${result.detail}\n  bytes: ${String(result.bytes)}\n` +
          `  log: ${result.log.trim().split('\n').slice(0, 4).join(' | ') || '(empty)'}\n\n`,
      );
    }
  }
  process.stdout.write(`PDFs kept in ${scratch} for reading back.\n`);
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
