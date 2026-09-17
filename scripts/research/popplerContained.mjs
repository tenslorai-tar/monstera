// @ts-check
/**
 * Does `pdftotext` run inside the contained launcher, reaching only what it is handed?
 *
 * ## The question, and why it was answered before ADR-0071 was written
 *
 * The owner's condition for Poppler: *"pdftotext runs as a separate contained
 * process, only input and output granted, never linked."* LibreOffice met the
 * first half of that sentence and not the second (ADR-0063 item 3: its front
 * ends start children the one-process job refuses). So the question is asked of
 * the SHIPPED surfaces — the Win32 host surface with `runs: 'converter'`, the
 * session-directory pair and its DACL — not of a harness's copy of them.
 *
 * ## Four cells, and two of them are controls
 *
 * - `contained`: AppContainer + job, the input in the granted snapshot directory.
 * - `uncontained`: the same command with no container — the reference text.
 * - `outside`: contained, but the input named OUTSIDE the granted pair. It must be
 *   refused; if it reads, the first cell's success says nothing about the grant.
 * - `outside-uncontained`: the same outside path with no container. It must read,
 *   or the refusal above is a missing file rather than a denied one.
 *
 * The fourth answer on 2026-09-16 was the one that makes the third mean something:
 * uncontained, the outside file read; contained, `I/O Error: Couldn't open file`.
 * A fifth reading, not repeated here because it needs an ungranted copy of the
 * tree, was taken the same day: from a stage with no `ALL APPLICATION PACKAGES`
 * ACE, the contained cell ran nothing and wrote nothing — so the `contained` cell
 * really ran inside a container.
 *
 * Needs `npm run build`, `npm run provision:poppler` and `npm run provision:grants`.
 *
 * Usage: node scripts/research/popplerContained.mjs <pdf>
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { pdftotextPath, popplerRoot } from '../provision/poppler.mjs';

const ROOT = repoRoot();
const CONTAINER = 'monstera-poppler-text';
const BUDGET_MS = 60_000;

if (process.platform !== 'win32') {
  process.stderr.write('popplerContained: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}

const argument = process.argv[2];
if (argument === undefined || !existsSync(argument)) {
  process.stderr.write('Usage: node scripts/research/popplerContained.mjs <pdf>\n');
  process.exit(2);
}
/** Narrowed once, so the functions below see a string. */
const document = argument;

/** @param {string} relative */
const built = async (relative) =>
  import(pathToFileURL(join(ROOT, relative)).href).catch((/** @type {unknown} */ cause) => {
    process.stderr.write(`popplerContained: could not import ${relative}; run \`npm run build\`. ${String(cause)}\n`);
    process.exit(70);
  });

const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directories = await built('apps/desktop/dist/win32DirectorySurface.js');
const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');

if (!existsSync(pdftotextPath(ROOT))) {
  process.stderr.write('popplerContained: Poppler is not provisioned. Run `npm run provision:poppler`.\n');
  process.exit(69);
}
const grant = inspect({ root: ROOT }).find((entry) => entry.path === popplerRoot(ROOT));
process.stdout.write(`tree grant: ${JSON.stringify(grant ?? null)}\n`);

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {number} pid */
function alive(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`], { encoding: 'utf8' });
  return `${result.stdout}`.trim() === 'yes';
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-poppler-'));

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
  const name = sessionDirectories.sessionDirectoryName(`ad-${index.toString(16)}-${process.pid.toString(16)}`);
  if (!name.ok) return { cell, outcome: 'bad-name', detail: name.error };
  const paths = sessionDirectories.sessionDirectoryPaths(scratch, name.value);
  const made = sessionDirectories.createSessionDirectories(
    directories.createWin32DirectorySurface(), paths, user.value, container.value);
  if (!made.ok) return { cell, outcome: 'no-pair', detail: `${made.error.stage}: ${made.error.detail}` };

  const granted = join(paths.snapshot, 'in.pdf');
  copyFileSync(document, granted);
  const output = join(paths.output, 'out.txt');
  const log = join(scratch, `${cell}.log`);

  const surface = hostSurface.createWin32HostSurface({
    program: {
      runs: 'converter',
      executablePath: pdftotextPath(ROOT),
      commandArguments: ['-layout', '-enc', 'UTF-8', outside ? document : granted, output],
    },
    workingDirectory: join(popplerRoot(ROOT), 'bin'),
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
  return {
    cell,
    exited,
    ms: Math.round(performance.now() - started),
    wrote: readdirSync(paths.output),
    lines: existsSync(output) ? readFileSync(output, 'utf8').split('\n').length : null,
    said: existsSync(log) ? readFileSync(log, 'utf8').trim().slice(0, 300) : '',
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
