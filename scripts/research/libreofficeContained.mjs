// @ts-check
/**
 * ADR-0063 item 3, measured: does `soffice` start inside an AppContainer with only what it was
 * handed, and convert?
 *
 * ## Why this exists, and why it is research rather than a proof
 *
 * ADR-0063 lists five things the provisioning commit owes before anything is built on the
 * external-converter seam. Item 3 is the one it calls **the premise most likely to be false**:
 * *"whether `soffice.exe` starts at all inside an AppContainer with only the input and output
 * granted. It loads fonts, a profile and its own program files."* Item 2 — headless conversion
 * outside containment — was read on 2026-09-14 and re-read on 2026-09-16, exit 0 and a
 * `%PDF-1.7` both times.
 *
 * A proof asserts a property CI can hold. This measures a machine: an AppContainer, a 1.6 GB
 * tree of somebody else's program, and a conversion that either happens or does not. It is the
 * shape `containedStart.mjs` already has for the engine host, and it takes that file's
 * mechanisms rather than re-deriving them (B3a).
 *
 * ## TWO CELLS, and the uncontained one is the control
 *
 * A contained cell that writes no PDF has two explanations — containment refused it, or this
 * harness never had a working command — and they produce the same empty output directory. The
 * uncontained cell runs the identical argument vector through the identical surface with
 * `containerName: null`, which is the route control `win32HostSurface` was built to express. A
 * run where the uncontained cell also fails says nothing about containment and is reported that
 * way.
 *
 * ## What is granted, and what is not
 *
 * The pinned tree is granted `RX` by `provision:grants` (`containerGrants.mjs`), which is where
 * an artefact's ACEs belong — ADR-0027's rule that the thing that installs an artefact owns its
 * state. The input and output live in a session directory pair DACL'd to this user and the
 * container SID, exactly as an engine host's are. The profile is a directory INSIDE the output
 * half, because `-env:UserInstallation=` must be writable and the container may write nowhere
 * else.
 *
 * Usage: node scripts/research/libreofficeContained.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { libreOfficeRoot, sofficeLauncher, sofficePath } from '../provision/libreoffice.mjs';

const ROOT = repoRoot();

/** Its own profile name: two instruments sharing one container share whatever either leaves. */
const CONTAINER = 'monstera-libreoffice-convert';

/** How long a conversion has to produce a PDF before this reports that it did not. */
const CONVERT_BUDGET_MS = 45_000;

if (process.platform !== 'win32') {
  process.stderr.write('libreofficeContained: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}

/** @param {string} relative */
const built = async (relative) => {
  const path = join(ROOT, relative);
  return import(pathToFileURL(path).href).catch((/** @type {unknown} */ cause) => {
    process.stderr.write(
      `libreofficeContained: could not import ${relative}. This reads the BUILD, so ` +
        `\`npm run build\` must have run. ${String(cause)}\n`,
    );
    process.exit(70);
  });
};

const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
const directories = await built('apps/desktop/dist/win32DirectorySurface.js');
const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const soffice = sofficePath(ROOT);
if (!existsSync(soffice)) {
  process.stderr.write(
    `libreofficeContained: no provisioned LibreOffice at ${soffice}. Run \`npm run provision:libreoffice\`.\n`,
  );
  process.exit(69);
}

// THE GRANT IS READ BEFORE ANYTHING RUNS, because a contained cell that fails for want of an ACE
// on the tree is a different finding from one that fails inside LibreOffice — and the ACE is
// provisioning's to hold, not this instrument's to apply.
const treeGrant = inspect({ root: ROOT }).find((entry) => entry.path === libreOfficeRoot(ROOT));

const scratch = mkdtempSync(join(tmpdir(), 'monstera-lo-contained-'));

/**
 * Whether a process id is still running, through the same reader `roleMupdfHost.mjs` uses for the
 * question — a second spelling here would be a second opinion about *is that pid still there*.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function alive(pid) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
  ], { encoding: 'utf8', timeout: 20_000 });
  return `${result.stdout}`.trim() === 'yes';
}

/**
 * One cell: a granted pair, an input copied in under a fixed name, and one conversion.
 *
 * @param {string} cell
 * @param {boolean} contained
 * @param {'exe' | 'com' | 'bin'} which the launcher this cell runs — `.exe` hands off to
 *   `soffice.bin` and writes no diagnostic, `.com` is the console front end, `.bin` is the program
 * @param {number} cellIndex its own session directory pair; two cells sharing a name collide on
 *   the first one's directory, which the minter reports rather than adopting
 * @returns {{ cell: string, outcome: string, detail: string, pdfBytes: number | null, log: string }}
 */
function convert(cell, contained, which = 'bin', cellIndex = 0) {
  const user = pipes.currentUserSid();
  if (!user.ok) return { cell, outcome: 'no-user-sid', detail: user.error, pdfBytes: null, log: '' };
  const container = pipes.hostContainerSid(CONTAINER);
  if (!container.ok) {
    return { cell, outcome: 'no-container-sid', detail: container.error, pdfBytes: null, log: '' };
  }

  // LOWER-CASE HEX AND HYPHENS ONLY. The minter is an allowlist because the host — hostile by
  // invariant 25 — is what normally supplies this name, so a readable word like `contained` is
  // refused. `ad` is a prefix inside that alphabet and the cell is a digit, which is what keeps
  // the two cells in different directories without leaving it.
  const name = sessionDirectories.sessionDirectoryName(
    `ad-${cellIndex.toString(16)}-${process.pid.toString(16)}`,
  );
  if (!name.ok) return { cell, outcome: 'bad-name', detail: name.error, pdfBytes: null, log: '' };
  const paths = sessionDirectories.sessionDirectoryPaths(scratch, name.value);
  const made = sessionDirectories.createSessionDirectories(
    directories.createWin32DirectorySurface(),
    paths,
    user.value,
    container.value,
  );
  if (!made.ok) {
    return { cell, outcome: 'no-pair', detail: `${made.error.stage}: ${made.error.detail}`, pdfBytes: null, log: '' };
  }

  // A FIXED NAME, which is ADR-0063 Decision 2's rule: a picked file's own name never reaches a
  // command line. The content is written here rather than taken from a corpus (B10).
  const input = join(paths.snapshot, 'in.txt');
  writeFileSync(input, 'ADR-0063 item 3: a contained conversion.\n', 'utf8');

  // INSIDE THE OUTPUT HALF, which is the only place the container may write.
  const profile = join(paths.output, 'profile');
  mkdirSync(profile, { recursive: true });

  const logPath = join(scratch, `${cell}.log`);
  const executable = sofficeLauncher(ROOT, which);
  const surface = hostSurface.createWin32HostSurface({
    // NAMED BY ITS RESOLVER at the call site, which is `check:electronbinary`'s rule: a host's
    // executable answers out of a tree this repository provisioned, never out of `PATH` and never
    // from the copy this machine has installed (ADR-0063 Decision 2).
    executablePath: sofficeLauncher(ROOT, which),
    commandArguments: [
      '--headless',
      '--norestore',
      `-env:UserInstallation=file:///${profile.replaceAll('\\', '/')}`,
      '--convert-to',
      'pdf',
      '--outdir',
      paths.output,
      input,
    ],
    // INSIDE THE GRANTED TREE, for `containedStart.mjs`' reason: a working directory of our own
    // would be a second path whose rights differ between the cells.
    workingDirectory: dirname(executable),
    containerName: contained ? CONTAINER : null,
    diagnosticPath: logPath,
  });

  const created = surface.createSuspended();
  if (!created.ok) {
    return { cell, outcome: 'create-failed', detail: created.error, pdfBytes: null, log: '' };
  }
  const pid = created.value.pid;
  // THE RESUME'S ANSWER IS READ, not assumed. A suspended process that was never resumed
  // produces exactly what a crashed one does — no output and an empty log — and the first run of
  // this instrument could not tell those apart.
  const resumed = surface.resume(created.value.thread);

  const expected = join(paths.output, 'in.pdf');
  const deadline = Date.now() + CONVERT_BUDGET_MS;
  while (Date.now() < deadline && !existsSync(expected)) sleep(250);
  const stillRunning = alive(pid);
  const wrote = (() => {
    try {
      return readdirSync(paths.output).join(', ') || '(nothing)';
    } catch (error) {
      return `unreadable: ${String(error)}`;
    }
  })();
  const where = `pid ${String(pid)}, resume ${JSON.stringify(resumed)}, alive ${String(stillRunning)}, out: ${wrote}`;

  const log = (() => {
    try {
      return readFileSync(logPath, 'utf8');
    } catch {
      // NOTHING WRITTEN IS A READING, not an error: cell 1 produces exactly this, and it is what
      // says the GUI front end reports nothing rather than that this instrument failed to look.
      return '';
    }
  })();

  if (!existsSync(expected)) {
    surface.terminate(created.value.process);
    surface.close(created.value.process);
    surface.close(created.value.thread);
    return { cell, outcome: 'no-pdf', detail: `nothing at ${expected} within the budget — ${where}`, pdfBytes: null, log };
  }

  // THE FIRST BYTES, because a file of the right name and the wrong content is what a half-written
  // conversion leaves — and its presence alone is the reassuring answer.
  const head = readFileSync(expected).subarray(0, 8).toString('latin1');
  surface.close(created.value.process);
  surface.close(created.value.thread);
  return {
    cell,
    outcome: head.startsWith('%PDF-') ? 'converted' : 'not-a-pdf',
    detail: `first bytes ${JSON.stringify(head)} — ${where}`,
    pdfBytes: statSync(expected).size,
    log,
  };
}

try {
  process.stdout.write(
    `soffice:   ${soffice}\ncontainer: ${CONTAINER}\ntree grant: ${JSON.stringify(treeGrant ?? null)}\n\n`,
  );

  // THE CONTROL FIRST. A contained failure means nothing until the same command is known to work
  // uncontained through this same surface.
  // THE LAUNCHER IS AN AXIS UNTIL ONE OF THEM CONVERTS UNDER `CreateProcessW`. `soffice.exe` is a
  // GUI-subsystem front end that hands off to `soffice.bin`; `soffice.com` is the console front
  // end, which is what the shell runs that converted on 2026-09-14 and again today used; and
  // `soffice.bin` is the program itself. A cell that writes no PDF says nothing about containment
  // until one of them writes one uncontained.
  const cells = [
    ['exe-uncontained', false, 'exe'],
    ['com-uncontained', false, 'com'],
    ['bin-uncontained', false, 'bin'],
    ['bin-contained', true, 'bin'],
  ];
  for (const [index, [cell, contained, which]] of cells.entries()) {
    const result = convert(
      String(cell),
      Boolean(contained),
      /** @type {'exe' | 'com' | 'bin'} */ (String(which)),
      index,
    );
    process.stdout.write(
      `${result.cell}: ${result.outcome}\n  ${result.detail}\n  bytes: ${String(result.pdfBytes)}\n` +
        `  log: ${result.log.trim().split('\n').slice(0, 4).join(' | ') || '(empty)'}\n\n`,
    );
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    process.stderr.write(`libreofficeContained: could not remove ${scratch}\n`);
  }
}
