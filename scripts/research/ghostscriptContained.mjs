// @ts-check
/**
 * Does `gswin64c` convert to PDF/A-2b inside the contained launcher, reaching only what it
 * is handed — ADR-0075's unexecuted item?
 *
 * Asked of the SHIPPED surfaces, as `popplerContained.mjs` asks it of `pdftotext`: the
 * Win32 host surface with `runs: 'converter'`, the session-directory pair and its DACL.
 * The arguments are the ones ADR-0075 fixes, the output intent included.
 *
 * ## Four cells, two of them controls
 *
 * - `contained`: AppContainer + job, the input in the granted snapshot directory.
 * - `uncontained`: the same command with no container — the reference.
 * - `outside`: contained, the input named OUTSIDE the pair. It must be refused, or the
 *   first cell's success says nothing about the grant.
 * - `outside-uncontained`: the same outside path with no container. It must convert, or
 *   the refusal above is a missing file rather than a denied one.
 *
 * Each cell prints whether an output was written, its size, and Ghostscript's own lines
 * that mention an error, PDF/A or a temporary file — where it writes its scratch files
 * inside a container being the second half of the item.
 *
 * Needs `npm run build`, `npm run provision:ghostscript` and `npm run provision:grants`.
 *
 * Usage: node scripts/research/ghostscriptContained.mjs <pdf>
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { ghostscriptRoot, gswin64cPath } from '../provision/ghostscript.mjs';

const ROOT = repoRoot();
const CONTAINER = 'monstera-ghostscript-pdfa';
const BUDGET_MS = 120_000;

/** `lib/PDFA_def.ps`'s pdfmarks, the profile read from Ghostscript's own ROM (ADR-0075). */
export const PDFA_OUTPUT_INTENT = [
  '[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark',
  '[{icc_PDFA} <</N 3>> /PUT pdfmark',
  '[{icc_PDFA} (%rom%iccprofiles/srgb.icc) (r) file /PUT pdfmark',
  '[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark',
  '[{OutputIntent_PDFA} <</Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB)>> /PUT pdfmark',
  '[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark',
].join(' ');

if (process.platform !== 'win32') {
  process.stderr.write('ghostscriptContained: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}

const argument = process.argv[2];
if (argument === undefined || !existsSync(argument)) {
  process.stderr.write('Usage: node scripts/research/ghostscriptContained.mjs <pdf>\n');
  process.exit(2);
}
const document = argument;

/** @param {string} relative */
const built = async (relative) =>
  import(pathToFileURL(join(ROOT, relative)).href).catch((/** @type {unknown} */ cause) => {
    process.stderr.write(`ghostscriptContained: could not import ${relative}; run \`npm run build\`. ${String(cause)}\n`);
    process.exit(70);
  });

const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directories = await built('apps/desktop/dist/win32DirectorySurface.js');
const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');

if (!existsSync(gswin64cPath(ROOT))) {
  process.stderr.write('ghostscriptContained: Ghostscript is not provisioned. Run `npm run provision:ghostscript`.\n');
  process.exit(69);
}
const grant = inspect({ root: ROOT }).find((entry) => entry.path === ghostscriptRoot(ROOT));
process.stdout.write(`tree grant: ${JSON.stringify(grant ?? null)}\n`);

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {number} pid */
function alive(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`], { encoding: 'utf8' });
  return `${result.stdout}`.trim() === 'yes';
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-ghostscript-'));

/**
 * @param {string} cell
 * @param {boolean} contained
 * @param {boolean} outside
 * @param {number} index
 */
function run(cell, contained, outside, index) {
  const user = pipes.currentUserSid();
  const container = pipes.hostContainerSid(CONTAINER);
  if (!user.ok || !container.ok) return { cell, outcome: 'no-sid' };
  const name = sessionDirectories.sessionDirectoryName(`a5-${index.toString(16)}-${process.pid.toString(16)}`);
  if (!name.ok) return { cell, outcome: 'bad-name', detail: name.error };
  const paths = sessionDirectories.sessionDirectoryPaths(scratch, name.value);
  const made = sessionDirectories.createSessionDirectories(
    directories.createWin32DirectorySurface(), paths, user.value, container.value);
  if (!made.ok) return { cell, outcome: 'no-pair', detail: `${made.error.stage}: ${made.error.detail}` };

  const granted = join(paths.snapshot, 'in.pdf');
  copyFileSync(document, granted);
  const output = join(paths.output, 'out.pdf');
  const log = join(scratch, `${cell}.log`);

  const surface = hostSurface.createWin32HostSurface({
    program: {
      runs: 'converter',
      executablePath: gswin64cPath(ROOT),
      commandArguments: [
        '-dPDFA=2', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sColorConversionStrategy=RGB',
        '-dPDFACompatibilityPolicy=1', '-sDEVICE=pdfwrite', `-sOutputFile=${output}`,
        '-c', PDFA_OUTPUT_INTENT, '-f', outside ? document : granted,
      ],
    },
    workingDirectory: join(ghostscriptRoot(ROOT), 'bin'),
    containerName: contained ? CONTAINER : null,
    diagnosticPath: log,
  });
  const started = performance.now();
  const created = surface.createSuspended();
  if (!created.ok) return { cell, outcome: 'create-failed', detail: created.error };
  surface.resume(created.value.thread);
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline && alive(created.value.pid)) sleep(200);
  const exited = !alive(created.value.pid);
  if (!exited) surface.terminate(created.value.process);
  surface.close(created.value.process);
  surface.close(created.value.thread);
  const said = existsSync(log) ? readFileSync(log, 'utf8') : '';
  return {
    cell,
    exited,
    ms: Math.round(performance.now() - started),
    wrote: readdirSync(paths.output),
    bytes: existsSync(output) ? statSync(output).size : null,
    said: said.split('\n').filter((line) => /error|pdf\/a|temp|unable|cannot|denied/iu.test(line)).slice(0, 6),
  };
}

try {
  const cells = [
    run('contained', true, false, 0),
    run('uncontained', false, false, 1),
    run('outside', true, true, 2),
    run('outside-uncontained', false, true, 3),
  ];
  for (const cell of cells) process.stdout.write(`${JSON.stringify(cell)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
