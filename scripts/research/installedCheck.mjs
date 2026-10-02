// @ts-check
/**
 * The installed-app check, run after every install of a test package: does the INSTALLED application do the things
 * only an installed application can show — its engine hosts start contained and work — on a copy of a document, and
 * does the owner's profile come out of the run exactly as it went in?
 *
 * ## Why an installed run, and why this one
 *
 * The packager starts the staged program before packing (`startCheck.mjs`), but the stage has no package identity,
 * and a host created by a process with none is refused the runtime (ADR-0023's 2026-09-30 correction): on the stage
 * every document is poisoned, so nothing there can say whether an install's hosts work. Here the installed package is
 * run inside its own package context (`Invoke-CommandInDesktopPackage`, no install and no elevation) on the owner's
 * real profile — the profile an install actually runs with.
 *
 * ## The steps, and what each is checked by
 *
 * 1. **Edit text and save**: a marker word appended to the first text block, committed with Escape, saved with
 *    Ctrl+S; the saved file is read back with the provisioned pdftotext and must hold the marker. An edit is a PDFium
 *    host command, so this is also that host working.
 * 2. **OCR one page**: *Make scanned pages searchable* (the dialog titled *Recognise text*) on page 1 of a scanned
 *    copy, at the dialog's defaults, saved; page 1 must then read words. A MuPDF host command.
 *
 * **Contained** is read two ways. A host's writer is bound only AFTER its containment verdict passes
 * (`composition.ts`: *bound after the verdict*), so steps 1 and 2 working is a contained PDFium and MuPDF host; and the
 * shell log's lines from this run must hold main's `package-data` line and no `engine-host-gone` or *not contained*.
 *
 * **The steps that need a Windows file dialog are the owner's** — Export to Word, importing a Word file, attaching a
 * file in the assistant. A file dialog is answered by a person typing into it, and nothing in this script sends input
 * to anything but the run's own page, so it lists them as the owner's steps and never waits on one.
 *
 * ## The owner's profile: copied before, put back after, and the putting back proven
 *
 * The run uses the owner's real profile, and an ordinary run writes into it: the recent list and the last session
 * (`recent.json`, which also carries the clean-exit flag the *closed unexpectedly* offer is gated on), the launch count
 * the rating prompt reads (`engagement.json`, where every launch is a session), the recent cards' pictures. Measured
 * 2026-10-02 on 0.1.9.0: a run that ended an instance by its PID left `cleanExit: false` and a session naming the
 * deleted copy, so the owner's next start said Monstera had closed unexpectedly and offered a file that no longer
 * existed, and the recent list kept the run's documents.
 *
 * So before anything starts, the application's records are copied out of the package's storage; after the
 * application has closed they are put back byte for byte, and files the run added beside them are removed. Two
 * readings prove it: each record is compared with its copy, and the start screen is read at an ordinary start before
 * the run and again after it — the *closed unexpectedly* offer and the recent list must be the same both times (the
 * list as a count and a digest; the owner's file names are never printed). Each of those starts is itself restored
 * after, since a start writes the same records.
 *
 * Every other file under the profile that changed is listed by its top-level name, so a record this list does not
 * name shows up rather than staying behind unseen. `secrets.json` is never copied, only compared; `library/` is
 * compared; a changed setting is put back and reported as a failure, because the check promises to change none.
 *
 * ## It closes the application only through the run's own window, and never kills it
 *
 * The run's instance is the one process listening on this run's debugging port, launched after the run listed every
 * process, whose executable is the installed `Monstera.exe` (or, for a dev run, the provisioned runtime on the run's
 * own profile) — and `ownInstance` refuses unless all three hold. `closeWindow` takes only what `ownInstance`
 * returned, re-checks that the process still holds the port, and posts WM_CLOSE to its main window, which is what
 * its close button does; a save prompt that names one of the run's own copies is answered *Don't save* in the run's
 * page, through the run's own debugging connection. There is no route here that ends a process, activates a window,
 * or reaches one by name.
 *
 * Measured 2026-10-02: bringing *Monstera PDF Editor* forward by its name opened a DIFFERENT installed program of that
 * name, which reopened one of the owner's own documents. That is why nothing here names a window; and when the run's
 * window does not close, the application is left running for the owner, the profile is not touched (it would be
 * written over at exit), and the script prints the command that finishes the restore once the owner has closed it:
 * `--restore <the run's folder>`.
 *
 * Usage: node scripts/research/installedCheck.mjs --document <absolute .pdf with text> --scan <absolute .pdf whose
 *   first page has no text> [--build installed|dev] [--steps edit,ocr] [--shots <folder>]
 *        node scripts/research/installedCheck.mjs --restore <the run's folder, as a NOT CLOSED run printed it>
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { chromium } from '@playwright/test';

import { repoRoot } from '../lib/gitScope.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';
import { DISPLAY_NAME } from '../release/packageMsix.mjs';

const ROOT = repoRoot();
const PORT = 9347;
const PACKAGE_NAME = 'TenslorInc.MonsteraPDFEditor.Test';
const MARKER = 'MONSTERACHECK';

/**
 * The application's records a run writes and this script puts back, as the shell names them: `RECENT_FILE`
 * (`recentFiles.ts`), `ENGAGEMENT_FILE` (`engagement.ts`), and `entry.ts`'s settings, crash-report and picture paths.
 * A name missing here is not silent: the comparison of the whole profile lists every other file that changed.
 */
const RECORDS = ['recent.json', 'engagement.json', 'settings.json', 'crash-reports-offered.json'];
const PICTURES = 'recent-pictures';
/** Compared and never copied: the AI key's file, and the documents the owner keeps in the library. */
const COMPARED_ONLY = ['secrets.json', 'library'];

/** The steps a person takes, because each answers a Windows file dialog (see the header). */
const OWNER_STEPS = [
  'Export to Word: *Export to Word…* on an open document, saved through the Save As dialog; the .docx opens in Word with the text.',
  'Import a Word file: *New PDF from Word, Excel or PowerPoint…*, a .docx picked in the Open dialog and the new PDF named in the Save As; a new tab draws the page.',
  'Attach a file in the assistant: *Attach files* in the Assistant tab, a text file picked in the Open dialog; its chip appears. Never sent.',
];

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** @param {string} script */
function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 16 << 20 }).trim();
}

/** A PowerShell single-quoted string: its only escape is a doubled quote. @param {string} text */
const quoted = (text) => `'${text.replaceAll("'", "''")}'`;

/** @param {Buffer | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Every process on the machine, by PID. */
function allPids() {
  return new Set(
    execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.split('","')[1]))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
}

/** The PIDs listening on the debugging port. */
function portListeners() {
  return [
    ...new Set(
      execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.includes(`127.0.0.1:${String(PORT)} `) && line.includes('LISTENING'))
        .map((line) => Number(line.trim().split(/\s+/u).at(-1))),
    ),
  ];
}

/** A process's executable and command line. @param {number} pid */
function processOf(pid) {
  const [path = '', ...rest] = powershell(
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${String(pid)}'; if ($null -ne $p) { $p.ExecutablePath; $p.CommandLine }`,
  ).split(/\r?\n/u);
  return { path, commandLine: rest.join('\n') };
}

// ---------------------------------------------------------------------------------------------------------------

if (option('restore') === undefined && option('document') === undefined) {
  throw new Error('--document <absolute .pdf> is required (or --restore <the run\'s folder>).');
}
/**
 * `installed` (the default) or `dev`: this checkout's build through the provisioned runtime, handed its native
 * components as `npm start` hands them, on a scratch profile — for a change that has not reached a package yet. Its
 * hosts are contained the development way (ADR-0027's grant), not the package's, so a dev run says the commands work
 * through real hosts, never what an install does. It touches no profile but its own.
 */
const build = option('restore') === undefined ? (option('build') ?? 'installed') : 'installed';
if (build !== 'installed' && build !== 'dev') throw new Error('--build is installed or dev');
const [family = '', location = '', version = ''] =
  build === 'installed'
    ? powershell(
        `$p = Get-AppxPackage -Name '${PACKAGE_NAME}'; if ($null -eq $p) { exit 3 }; "$($p.PackageFamilyName)|$($p.InstallLocation)|$($p.Version)"`,
      ).split('|')
    : ['', '', 'development build'];
if (build === 'installed' && family === '') throw new Error('the test package is not installed');

const work = option('restore') ?? join(ROOT, '..', `installed-check-${String(Date.now())}`);
/** A development run's own profile, inside the run's folder. */
const devProfile = join(work, 'profile');
/** The installed application's profile: a packaged process's AppData is redirected into the package's storage. */
const profile = build === 'installed' ? join(process.env['LOCALAPPDATA'] ?? '', 'Packages', family, 'LocalCache', 'Roaming', DISPLAY_NAME) : devProfile;
const snapshotDirectory = join(work, 'profile-snapshot');
const expectedExecutable =
  build === 'installed' ? join(location, 'Monstera.exe') : (await import('../provision/electron.mjs')).electronBinaryPath(ROOT);

/** Every process of this run's program: run from the install location, or (dev) on this run's own profile. */
function runProcesses() {
  const filter =
    build === 'installed'
      ? `$_.ExecutablePath -and $_.ExecutablePath.StartsWith(${quoted(location)}, [System.StringComparison]::OrdinalIgnoreCase)`
      : `$_.CommandLine -and $_.CommandLine.Contains(${quoted(devProfile)})`;
  return powershell(`Get-CimInstance Win32_Process | Where-Object { ${filter} } | ForEach-Object { $_.ProcessId }`)
    .split(/\s+/u)
    .filter(Boolean)
    .map(Number);
}

/** Waits for every process of the run's program to end. @returns {Promise<boolean>} whether they all did */
async function allGone(limitMs = 60_000) {
  const began = Date.now();
  while (Date.now() - began < limitMs) {
    if (runProcesses().length === 0) return true;
    await pause(1000);
  }
  return runProcesses().length === 0;
}

const OWN = Symbol('the instance this run launched');

/**
 * The run's own instance, or a refusal: the ONE process on this run's debugging port, which did not exist before
 * the launch, running the expected executable (and, for a dev run, on the run's own profile). The returned token is
 * the only thing `closeWindow` accepts.
 *
 * @param {Set<number>} before every PID that existed before the launch
 */
function ownInstance(before) {
  const listeners = portListeners();
  if (listeners.length !== 1) throw new Error(`REFUSED: ${String(listeners.length)} processes listen on port ${String(PORT)}, so the run's own cannot be told apart`);
  const pid = /** @type {number} */ (listeners[0]);
  if (before.has(pid)) throw new Error(`REFUSED: process ${String(pid)} holds the debugging port and was running before this run launched anything`);
  const { path, commandLine } = processOf(pid);
  if (path.toLowerCase() !== expectedExecutable.toLowerCase()) throw new Error(`REFUSED: process ${String(pid)} on the debugging port runs ${path || 'an unreadable executable'}, not ${expectedExecutable}`);
  if (build === 'dev' && !commandLine.includes(devProfile)) throw new Error(`REFUSED: process ${String(pid)} is not on this run's profile`);
  return Object.freeze({ pid, [OWN]: true });
}

/** The names of the run's own copies: the only documents whose unsaved changes the run may discard. */
const RUN_COPIES = ['check.pdf', 'scan.pdf'];

/**
 * Asks the run's own main window to close, as its close button does (WM_CLOSE), and waits for the program to end.
 * Never ends a process: one ended from outside writes no clean exit, and the next start reads it as a crash.
 *
 * Closing a window that holds unsaved changes asks first, in the page — measured on 0.1.9.0, where a recognition the
 * run could not save left *“scan.pdf” has changes that are not saved* waiting and the application open. So an open
 * dialog is first dismissed with Escape, as any of the dialog primitive's is, and a save prompt that names one of the
 * run's own copies is answered *Don't save* in the run's page. A prompt naming anything else is left for the owner.
 *
 * @param {ReturnType<typeof ownInstance>} own
 * @param {any} page the run's page, through the run's own debugging connection, or undefined when there is none
 * @returns {Promise<boolean>} whether every process of the run's program ended
 */
async function closeWindow(own, page) {
  if (own[OWN] !== true) throw new Error('REFUSED: closeWindow takes only the run\'s own instance, from ownInstance');
  if (!portListeners().includes(own.pid)) {
    // The run's instance no longer holds the port: it is gone, or the PID is no longer the run's. Either way there is
    // nothing of the run's to close by it.
    return allGone(10_000);
  }
  const dialogs = () => page?.locator('[role="dialog"], [role="alertdialog"]') ?? null;
  for (let i = 0; i < 3 && ((await dialogs()?.count().catch(() => 0)) ?? 0) > 0; i += 1) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await pause(500);
  }
  powershell(
    "Add-Type -Name W -Namespace Check -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool PostMessage(System.IntPtr w, uint m, System.IntPtr a, System.IntPtr b);'; " +
      `$w = (Get-Process -Id ${String(own.pid)}).MainWindowHandle; if ($w -ne 0) { [void][Check.W]::PostMessage($w, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero) }`,
  );
  const began = Date.now();
  while (Date.now() - began < 60_000) {
    if (runProcesses().length === 0) return true;
    const asking = /** @type {string[]} */ (await dialogs()?.allInnerTexts().catch(() => []) ?? []);
    const ours = asking.length === 1 && RUN_COPIES.some((name) => asking[0]?.includes(`“${name}”`));
    if (ours) await page.getByRole('button', { name: 'Don’t save' }).click({ timeout: 3000 }).catch(() => undefined);
    await pause(1000);
  }
  return runProcesses().length === 0;
}

/**
 * Starts the application, as the installed package or this checkout, with `args` after the debugging port.
 *
 * @param {string[]} args
 */
async function launch(args) {
  if (build === 'installed') {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Invoke-CommandInDesktopPackage -PackageFamilyName ${quoted(family)} -AppId 'Monstera' -Command ${quoted(expectedExecutable)} -Args ${quoted(args.map((arg) => `"${arg}"`).join(' '))}`,
      ],
      { stdio: 'ignore' },
    );
    return;
  }
  const { developmentEnvironment } = await import('../lib/launchEnvironment.mjs');
  spawn(expectedExecutable, [join(ROOT, 'apps', 'desktop'), `--user-data-dir=${devProfile}`, ...args], {
    stdio: 'ignore',
    env: { ...process.env, ...(await developmentEnvironment(ROOT)) },
  });
}

/** Connects to the run's instance over its debugging port. @returns {Promise<any>} */
async function connect() {
  for (let i = 0; i < 120; i += 1) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      await pause(500);
    }
  }
  throw new Error('the application never opened its debugging port');
}

/** The first page of the instance that shows `selector`, within a minute. @param {any} browser @param {string} selector */
async function pageShowing(browser, selector) {
  for (let i = 0; i < 120; i += 1) {
    for (const candidate of browser.contexts().flatMap((/** @type {any} */ c) => c.pages())) {
      if (!candidate.isClosed() && (await candidate.locator(selector).count().catch(() => 0)) > 0) return candidate;
    }
    await pause(500);
  }
  throw new Error(`no window showed ${selector} within a minute`);
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's profile.

/** Every file under a folder, by its path relative to it, with its size and time: what changed, cheaply. @param {string} root */
function listing(root) {
  /** @type {Map<string, string>} */
  const files = new Map();
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    try {
      const stat = statSync(path);
      files.set(relative(root, path), `${String(stat.size)}:${String(stat.mtimeMs)}`);
    } catch {
      // A file Chromium removed between the listing and the stat is not one of the records; it is simply gone.
    }
  }
  return files;
}

/** A digest per compared-only entry: the file's bytes, or the folder's listing of names and bytes. */
function comparedOnly() {
  return COMPARED_ONLY.map((name) => {
    const path = join(profile, name);
    if (!existsSync(path)) return `${name}:absent`;
    if (statSync(path).isFile()) return `${name}:${sha256(readFileSync(path))}`;
    const inside = [...listing(path).keys()].sort().map((file) => `${file}:${sha256(readFileSync(join(path, file)))}`);
    return `${name}:${sha256(inside.join('\n'))}`;
  });
}

/**
 * Copies the application's records out of the profile into the run's folder, with a manifest of what existed, and
 * returns what the comparison afterwards needs.
 */
function takeSnapshot() {
  mkdirSync(join(snapshotDirectory, 'records'), { recursive: true });
  mkdirSync(join(snapshotDirectory, 'pictures'), { recursive: true });
  /** @type {Record<string, boolean>} */
  const records = {};
  for (const name of RECORDS) {
    records[name] = existsSync(join(profile, name));
    if (records[name]) copyFileSync(join(profile, name), join(snapshotDirectory, 'records', name));
  }
  const pictures = existsSync(join(profile, PICTURES)) ? readdirSync(join(profile, PICTURES)) : [];
  for (const name of pictures) copyFileSync(join(profile, PICTURES, name), join(snapshotDirectory, 'pictures', name));
  writeFileSync(join(snapshotDirectory, 'manifest.json'), `${JSON.stringify({ profile, records, pictures }, null, 2)}\n`);
  return { listing: listing(profile), compared: comparedOnly() };
}

/**
 * Puts the records back byte for byte from the run's folder and removes what the run added beside them. Called only
 * once every process of the run's program has ended, since the application writes these records as it exits.
 *
 * @returns {{ restored: string[], exact: boolean }} the records that differed, and whether every one now matches
 */
function restoreSnapshot() {
  const manifest = JSON.parse(readFileSync(join(snapshotDirectory, 'manifest.json'), 'utf8'));
  if (manifest.profile !== profile) throw new Error(`the snapshot is of ${String(manifest.profile)}, not ${profile}`);
  /** @type {string[]} */
  const restored = [];
  for (const name of RECORDS) {
    const path = join(profile, name);
    if (manifest.records[name] === true) {
      const bytes = readFileSync(join(snapshotDirectory, 'records', name));
      if (!existsSync(path) || !readFileSync(path).equals(bytes)) {
        writeFileSync(path, bytes);
        restored.push(name);
      }
    } else if (existsSync(path)) {
      rmSync(path);
      restored.push(name);
    }
  }
  const kept = new Set(/** @type {string[]} */ (manifest.pictures));
  const pictures = join(profile, PICTURES);
  for (const name of existsSync(pictures) ? readdirSync(pictures) : []) {
    if (!kept.has(name)) {
      rmSync(join(pictures, name));
      restored.push(`${PICTURES}/${name}`);
    }
  }
  for (const name of kept) {
    const bytes = readFileSync(join(snapshotDirectory, 'pictures', name));
    if (!existsSync(join(pictures, name)) || !readFileSync(join(pictures, name)).equals(bytes)) {
      mkdirSync(pictures, { recursive: true });
      writeFileSync(join(pictures, name), bytes);
      restored.push(`${PICTURES}/${name}`);
    }
  }
  const exact =
    RECORDS.every((name) =>
      manifest.records[name] === true
        ? existsSync(join(profile, name)) && readFileSync(join(profile, name)).equals(readFileSync(join(snapshotDirectory, 'records', name)))
        : !existsSync(join(profile, name)),
    ) &&
    (existsSync(pictures) ? readdirSync(pictures) : []).sort().join('\n') === [...kept].sort().join('\n') &&
    [...kept].every((name) => readFileSync(join(pictures, name)).equals(readFileSync(join(snapshotDirectory, 'pictures', name))));
  return { restored, exact };
}

/**
 * What an ordinary start shows: the application started with no document, its start screen read for the *closed
 * unexpectedly* offer and the recent list, then closed through its own window. The names are reduced to a digest.
 */
async function readStartScreen() {
  const before = allPids();
  await launch([`--remote-debugging-port=${String(PORT)}`]);
  /** @type {ReturnType<typeof ownInstance> | undefined} */
  let own;
  /** @type {any} */
  let browser;
  /** @type {any} */
  let page;
  try {
    browser = await connect();
    own = ownInstance(before);
    page = await pageShowing(browser, '.m-recent');
    await page.locator('.m-recent-list, .m-recent-empty').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    // BOTH NOTICES THAT SAY MONSTERA CLOSED UNEXPECTEDLY: the offer to reopen the last session, and the offer to send
    // a crash report.
    const offer = (await page.locator('.m-recent-recover, [data-crash-offer]').count()) > 0;
    const names = await page.locator('.m-recent-list .m-recent-item__name').allTextContents();
    return { offer, count: names.length, digest: sha256(names.join('\n')).slice(0, 12) };
  } finally {
    // An instance that could not be told to be the run's is never closed; with none running there is nothing to leave.
    const closed = own === undefined ? runProcesses().length === 0 : await closeWindow(own, page);
    await browser?.close().catch(() => undefined);
    if (!closed) leftRunning('the start screen\'s window');
  }
}

/**
 * The application did not close through its window, or could not be identified as the run's: it is left running for
 * the owner, and nothing of the profile is touched, because it rewrites those records when it exits.
 *
 * @param {string} what
 * @returns {never}
 */
function leftRunning(what) {
  console.log(
    `NOT CLOSED: ${what} did not close through its own window, so the application is left running for you and your profile has not been put back yet.` +
      `\n  Close it yourself, then run:  node scripts/research/installedCheck.mjs --restore "${work}"`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------
// --restore: finishing a run whose window did not close.

if (option('restore') !== undefined) {
  if (!existsSync(join(snapshotDirectory, 'manifest.json'))) throw new Error(`${work} holds no profile snapshot`);
  if (runProcesses().length > 0) {
    console.log('REFUSED: Monstera is still running. Close it first; this check never closes the owner\'s windows.');
    process.exit(2);
  }
  const { restored, exact } = restoreSnapshot();
  console.log(`profile ${exact ? 'put back exactly' : 'NOT put back exactly'}: ${restored.length === 0 ? 'nothing differed' : `restored ${restored.join(', ')}`}`);
  if (exact) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  process.exit(exact ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------------------------
// The run.

const documentPath = /** @type {string} */ (option('document'));
if (!existsSync(documentPath)) throw new Error('--document <absolute .pdf> must exist.');
/** Which steps run: `edit,ocr`, both by default. */
const only = option('steps')?.split(',');
const want = (/** @type {string} */ step) => only === undefined || only.includes(step);
if (runProcesses().length > 0) {
  console.log('REFUSED: Monstera is running. Close it first; this check never closes the owner\'s windows.');
  process.exit(2);
}
if (portListeners().length > 0) throw new Error(`port ${String(PORT)} is held by another process; this check will not share it`);

mkdirSync(work, { recursive: true });
const copy = join(work, 'check.pdf');
copyFileSync(documentPath, copy);
const scanPath = option('scan');
const scanCopy = scanPath === undefined ? undefined : join(work, 'scan.pdf');
if (scanPath !== undefined && scanCopy !== undefined) copyFileSync(scanPath, scanCopy);

/** @type {{ step: string, ok: boolean, detail: string }[]} */
const steps = [];
const record = (/** @type {string} */ step, /** @type {boolean} */ ok, /** @type {string} */ detail) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}: ${detail}`);
};

console.log(build === 'installed' ? `installed ${version}` : 'development build');

/**
 * Reads the start screen and puts the records back after it whatever happened, since the start wrote them. A start
 * that could not be read is the end of the run: its folder goes, the profile having been put back.
 */
async function startScreenRestored() {
  try {
    return await readStartScreen();
  } catch (error) {
    console.log(`FAIL reading an ordinary start: ${String(error).slice(0, 300)}`);
    const { exact } = restoreSnapshot();
    console.log(`profile ${exact ? 'put back exactly' : 'NOT put back exactly'}`);
    if (exact) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    process.exit(1);
  } finally {
    writesByStarts.push(...restoreSnapshot().restored);
  }
}

/** @type {ReturnType<typeof takeSnapshot> | undefined} */
let snapshot;
/** @type {Awaited<ReturnType<typeof readStartScreen>> | undefined} */
let screenBefore;
/** What the ordinary starts wrote into the records, so a setting one of them changed is reported too. @type {string[]} */
const writesByStarts = [];
if (build === 'installed') {
  snapshot = takeSnapshot();
  screenBefore = await startScreenRestored();
  console.log(`  an ordinary start before the run: ${screenBefore.offer ? 'a closed-unexpectedly notice SHOWN' : 'no closed-unexpectedly notice'}; ${String(screenBefore.count)} recent file(s)`);
}

/** The shell log and its length now, so the containment reading takes this run's lines only. */
const logPath = join(profile, 'logs', 'shell.log');
const logBefore = existsSync(logPath) ? statSync(logPath).size : 0;

const launchedFrom = allPids();
await launch([`--remote-debugging-port=${String(PORT)}`, copy]);
/** @type {ReturnType<typeof ownInstance> | undefined} */
let own;
/** @type {any} */
let browser;
/** @type {any} */
let page;
try {
  browser = await connect();
  own = ownInstance(launchedFrom);
  page = await pageShowing(browser, '.m-page-list canvas');
  // A FRESH PROFILE OPENS ON THE FIRST-RUN SCREEN, which holds the keyboard until it is skipped; the owner's profile
  // never shows it, so only a development run meets it.
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(3000);

  // 1. EDIT TEXT AND SAVE.
  if (want('edit')) try {
    await runCommand(page, 'Edit text on the page');
    const block = page.locator('[data-text-edit-layer] [data-text-block]').first();
    await block.waitFor({ timeout: 30_000 });
    await block.click();
    const editor = page.locator('[data-text-editor]');
    await editor.waitFor({ timeout: 15_000 });
    await page.keyboard.press('Control+End');
    await page.keyboard.type(` ${MARKER}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    const before = statSync(copy).mtimeMs;
    await page.keyboard.press('Control+S');
    await savedAfter(copy, before);
    const held = textOf(copy).includes(MARKER);
    record('edit text and save', held, held ? `the saved file holds ${MARKER}` : 'the saved file does not hold the marker');
  } catch (error) {
    record('edit text and save', false, String(error).slice(0, 300));
  }

  // 2. OCR ONE PAGE of a SCANNED copy, at the dialog's defaults, and save. Recognition leaves a page that already
  // carries text alone (measured: *Nothing needed recognising — every page here already carries text*), so the edited
  // document cannot show it; `--scan` names one whose first page has none, opened as *Open with* opens a second one —
  // a second launch, which loses the single-instance lock, hands its argument over and quits by itself.
  if (want('ocr')) try {
    if (scanCopy === undefined) throw new Error('--scan <absolute .pdf whose first page has no text> is needed for OCR');
    const wordsBefore = textOf(scanCopy, 1).split(/\s+/u).filter(Boolean).length;
    if (wordsBefore > 0) throw new Error(`the --scan document's first page already has ${String(wordsBefore)} words, so recognition would leave it alone`);
    const tabsBefore = await page.locator('[data-tab-select]').count();
    await launch([scanCopy]);
    const opened = Date.now();
    while ((await page.locator('[data-tab-select]').count()) <= tabsBefore && Date.now() - opened < 60_000) await page.waitForTimeout(500);
    if ((await page.locator('[data-tab-select]').count()) <= tabsBefore) throw new Error('the scanned copy never opened in a tab');
    await page.waitForTimeout(3000);
    const before = statSync(scanCopy).mtimeMs;
    await runCommand(page, 'Make scanned pages searchable');
    await page.getByRole('button', { name: /^Recognise$/u }).click({ timeout: 15_000 });
    // UNTIL THE DOCUMENT IS CHANGED, or something says why not: a fixed wait could not tell a recognition still running
    // from one that failed from one that changed nothing — and the answer can be a dialog, not only a toast.
    /** @type {string[]} */
    let said = [];
    const began = Date.now();
    while (Date.now() - began < 180_000) {
      const unsaved = await page.locator('[data-tab-select][aria-current="true"]').getByText('Unsaved changes').count();
      said = (await page.locator('[role="alert"], .m-toast, [role="dialog"]').allTextContents()).filter((/** @type {string} */ text) => text.trim() !== '');
      if (unsaved > 0 || said.length > 0) break;
      await page.waitForTimeout(1000);
    }
    // THE OUTCOME IS A DIALOG, and while it is open it holds the keyboard: a save pressed then reaches the dialog, not
    // the document (measured). Its whole text is recorded and it is closed with Escape before the save — not by a
    // button's label, which differs between builds: 0.1.9.0's carries no text button, and a later round gave it OK.
    const outcome = await page.locator('[role="dialog"]').allInnerTexts();
    console.log(
      `  after recognition, ${String(Math.round((Date.now() - began) / 1000))} s: ${outcome.length > 0 ? `the dialog said ${JSON.stringify(outcome.map((/** @type {string} */ text) => text.replace(/\s+/gu, ' ').trim()))}` : said.length > 0 ? `said ${JSON.stringify(said)}` : 'marked unsaved'}`,
    );
    // `--shots <folder>` keeps a picture of the window at this point, for a step whose screen said nothing readable.
    const shots = option('shots');
    if (shots !== undefined) await page.screenshot({ path: join(shots, 'after-recognition.png') });
    if (outcome.length > 0) {
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').first().waitFor({ state: 'detached', timeout: 5000 });
    }
    await page.keyboard.press('Control+S');
    await savedAfter(scanCopy, before, 120_000);
    const wordsAfter = textOf(scanCopy, 1).split(/\s+/u).filter(Boolean).length;
    record('OCR one page and save', wordsAfter > 0, `page 1 of the saved scan reads ${String(wordsAfter)} words, from ${String(wordsBefore)}`);
  } catch (error) {
    record('OCR one page and save', false, String(error).slice(0, 300));
  }
} catch (error) {
  record('the run', false, String(error).slice(0, 300));
} finally {
  const closed = own === undefined ? runProcesses().length === 0 : await closeWindow(own, page);
  await browser?.close().catch(() => undefined);
  if (!closed) leftRunning('the run\'s window');
}

// CONTAINED: the run's lines of the shell log. Main's `package-data` lock exists only in a package.
if (!existsSync(logPath)) record('engine hosts contained', false, 'no shell log for this run');
else {
  const lines = readFileSync(logPath, 'utf8').slice(logBefore).split('\n').filter((line) => line.trim() !== '');
  // A HOST FAILURE, not the shell ending its hosts as it quits: that line reads `code=shutdown` (MuPDF's wording) or
  // `ended (shutdown)` (PDFium's), says itself that nothing is a fault, and the run's own close writes one per host.
  const failures = lines.filter((line) => /engine-host-gone|not contained/u.test(line) && !/code=shutdown|\(shutdown\)/u.test(line));
  const locked = build === 'dev' || lines.some((line) => line.includes('package-data'));
  const worked = steps.length > 0 && steps.every((s) => s.ok);
  record(
    'engine hosts contained',
    failures.length === 0 && locked && worked,
    `${String(lines.length)} new log line(s); package-data ${build === 'dev' ? 'not applicable (no package)' : locked ? 'locked' : 'NOT read'}; ${String(failures.length)} host failure(s)` +
      `${failures.length > 0 ? `: ${failures[0]?.slice(0, 200) ?? ''}` : ''}; the hosts' commands ${worked ? 'worked' : 'did not all work'}`,
  );
}

// NO TRACE: the records put back, then an ordinary start read again and compared with the one before the run.
if (build === 'installed' && snapshot !== undefined && screenBefore !== undefined) {
  const { restored, exact } = restoreSnapshot();
  const screenAfter = await startScreenRestored();
  const second = restoreSnapshot();
  /** @type {Map<string, number>} */
  const others = new Map();
  const after = listing(profile);
  for (const path of new Set([...snapshot.listing.keys(), ...after.keys()])) {
    if (snapshot.listing.get(path) === after.get(path)) continue;
    const top = path.split(/[\\/]/u)[0] ?? path;
    if (top === PICTURES || RECORDS.includes(top)) continue;
    others.set(top, (others.get(top) ?? 0) + 1);
  }
  const compared = comparedOnly();
  const untouched = compared.every((digest, at) => digest === snapshot?.compared[at]);
  const settingChanged = [...restored, ...writesByStarts].includes('settings.json');
  const sameScreen = screenAfter.offer === screenBefore.offer && screenAfter.count === screenBefore.count && screenAfter.digest === screenBefore.digest;
  record(
    'no trace in the profile',
    exact && second.exact && sameScreen && untouched && !settingChanged,
    `the run's writes ${restored.length === 0 ? 'were none' : `put back: ${restored.join(', ')}`}; records ${exact && second.exact ? 'match their copies byte for byte' : 'DO NOT match their copies'}` +
      `; an ordinary start after the run: ${screenAfter.offer ? 'a closed-unexpectedly notice SHOWN' : 'no closed-unexpectedly notice'}, ${String(screenAfter.count)} recent file(s), ${sameScreen ? 'the same as before the run' : 'DIFFERENT from before the run'}` +
      `; ${COMPARED_ONLY.join(' and ')} ${untouched ? 'unchanged' : 'CHANGED'}${settingChanged ? '; a SETTING was changed by the run (put back)' : ''}`,
  );
  console.log(
    `  other files the run's starts changed, not records of the owner's work: ${others.size === 0 ? 'none' : [...others].map(([top, n]) => `${top} (${String(n)})`).join(', ')}`,
  );
}

rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
console.log(`temporary files ${existsSync(work) ? 'NOT removed' : 'removed'}`);
console.log('\nOwner\'s steps, not run here because each answers a Windows file dialog:');
for (const step of OWNER_STEPS) console.log(`  owner's step: ${step}`);
console.log(`\n${String(steps.filter((s) => s.ok).length)} of ${String(steps.length)} steps passed`);
process.exitCode = steps.every((s) => s.ok) ? 0 : 1;

// ---------------------------------------------------------------------------------------------------------------

/** A document's text as pdftotext reads it, or one page's. @param {string} path @param {number} [page] */
function textOf(path, page) {
  return execFileSync(pdftotextPath(ROOT), ['-enc', 'UTF-8', ...(page === undefined ? [] : ['-f', String(page), '-l', String(page)]), path, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
}

/** Waits until a file's modification time moves past `after`, or throws. @param {string} path @param {number} after */
async function savedAfter(path, after, limitMs = 60_000) {
  const began = Date.now();
  while (Date.now() - began < limitMs) {
    if (existsSync(path) && statSync(path).mtimeMs > after) {
      await pause(1500);
      return;
    }
    await pause(300);
  }
  throw new Error(`${path} was not written within ${String(limitMs)} ms`);
}

/**
 * Runs a command by its EXACT title through the palette. A prefix would not do: *Recognise text* is a prefix of
 * *Recognise text in a box*, which the palette lists first, and the first version of this ran the wrong command.
 *
 * @param {any} page @param {string} title
 */
async function runCommand(page, title) {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  const choice = page.getByRole('option', { name: title, exact: true });
  if ((await choice.count()) !== 1) {
    const listed = await page.getByRole('option').allTextContents();
    await page.keyboard.press('Escape');
    throw new Error(`the palette holds no single option named "${title}"; it lists ${JSON.stringify(listed.slice(0, 6))}`);
  }
  await choice.click();
}
