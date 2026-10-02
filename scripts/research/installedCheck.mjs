// @ts-check
/**
 * The installed-app check, run after every install of a test package: does the INSTALLED application do the things
 * only an installed application can show — its engine hosts start contained and work, its converters run — on a
 * copy of a document, with no setting changed?
 *
 * ## Why an installed run, and why this one
 *
 * The packager starts the staged program before packing (`startCheck.mjs`), but the stage has no package identity,
 * and a host created by a process with none is refused the runtime (ADR-0023's 2026-09-30 correction): on the stage
 * every document is poisoned, so nothing there can say whether an install's hosts work. Here the installed package is
 * run inside its own package context (`Invoke-CommandInDesktopPackage`, no install and no elevation) on the owner's
 * real profile — the profile an install actually runs with — and each step is one a person takes.
 *
 * ## The steps, and what each is checked by
 *
 * 1. **Edit text and save**: a marker word appended to the first text block, committed with Escape, saved with
 *    Ctrl+S; the saved file is read back with the provisioned pdftotext and must hold the marker. An edit is a PDFium
 *    host command, so this is also that host working.
 * 2. **OCR one page**: *Make scanned pages searchable* (the dialog titled *Recognise text*) on page 1 with the dialog's
 *    defaults, saved; the saved file must have changed.
 *    A MuPDF host command.
 * 3. **Export to Word**: through main's save dialog; the file must be a zip holding `word/document.xml`. x2t.
 * 4. **Import a Word file**: a small `.docx` generated here, through *New PDF from Word, Excel or PowerPoint…*; a new
 *    tab must appear and draw a page. x2t, then the import host.
 * 5. **Attach a text file in the assistant**, never sent: its chip must appear.
 *
 * **Contained** is read two ways. A host's writer is bound only AFTER its containment verdict passes
 * (`composition.ts`: *bound after the verdict*), so steps 1 and 2 working is a contained PDFium and MuPDF host; and the
 * shell log's lines from this run must hold main's `package-data` line and no `engine-host-gone` or *not contained*.
 *
 * ## What it touches
 *
 * A temporary folder OUTSIDE AppData for the copy and the files it makes — a packaged process's AppData writes are
 * redirected into the package's storage, where this script could not read them back — removed at the end. No setting
 * is changed: every dialog is taken at its defaults. The documents opened join the recent list, which is the
 * application's ordinary memory of a run, not a setting. If the application is already running the check refuses
 * rather than touch the owner's windows. The run's own windows are closed through the window, never killed, so the
 * next start is an ordinary one; the imported document is closed with *Don't save*.
 *
 * ## The file dialogs are a person's
 *
 * Three steps open a native file dialog, and this script never fills one: it opens the dialog, prints the path to type
 * into its File name box, and waits up to three minutes for the step's effect — the file written, the tab opened, the
 * chip shown. A person, or computer use typing into the File name box, answers it. The first version filled them through
 * UI Automation; that sends input to the application by script, which the rule for driving this application forbids,
 * and it did not work either (the panes it found exposed no value pattern), so it is gone rather than repaired.
 *
 * ## Answering the dialogs with computer use: make sure the click lands on THIS run's window
 *
 * Measured 2026-10-02: bringing *Monstera PDF Editor* forward by its name opened a DIFFERENT installed program of that
 * name, which reopened one of the owner's own documents, and the click and paste meant for the run's dialog may have
 * landed in it. So the dialog is reached only through the run's own window — the one whose tab reads `check.pdf` —
 * and never by launching or activating the application by name.
 *
 * Usage: node scripts/research/installedCheck.mjs --document <absolute .pdf with text> --scan <absolute .pdf whose
 *   first page has no text> [--build installed|dev] [--steps edit,ocr,export,import,attach] [--shots <folder>]
 */

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

import { repoRoot } from '../lib/gitScope.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';

const ROOT = repoRoot();
const PORT = 9347;
const PACKAGE_NAME = 'TenslorInc.MonsteraPDFEditor.Test';
const MARKER = 'MONSTERACHECK';

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

/** The running Monstera processes' PIDs. */
function monsteraPids() {
  return execFileSync('tasklist', ['/FI', 'IMAGENAME eq Monstera.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => Number(line.split('","')[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** The PIDs listening on the debugging port. */
function portListeners() {
  return execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(`127.0.0.1:${String(PORT)} `) && line.includes('LISTENING'))
    .map((line) => Number(line.trim().split(/\s+/u).at(-1)));
}

/** How long a step waits for a person to answer its file dialog. */
const DIALOG_WAIT_MS = 180_000;

/**
 * Asks for a file dialog to be answered: prints the path to type into its File name box, and returns the moment it
 * asked, which the caller's wait runs from. Never touches the dialog itself (see the header).
 *
 * @param {string} step @param {string} path
 */
function askForDialog(step, path) {
  console.log(`WAITING (${step}): in the dialog that opened, type this into the File name box and press Enter:\n  ${path}`);
  return Date.now();
}

/** Asks the run's main window to close, as its close button does (WM_CLOSE). @param {number} pid */
function closeWindow(pid) {
  powershell(
    "Add-Type -Name W -Namespace Check -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool PostMessage(System.IntPtr w, uint m, System.IntPtr a, System.IntPtr b);'; " +
      `$w = (Get-Process -Id ${String(pid)}).MainWindowHandle; if ($w -ne 0) { [void][Check.W]::PostMessage($w, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero) }`,
  );
}

/** The newest shell log in the installed package's storage, and its length now. @param {string} family */
function shellLog(family) {
  const local = join(process.env['LOCALAPPDATA'] ?? '', 'Packages', family, 'LocalCache');
  /** @type {{ path: string, time: number } | null} */
  let newest = null;
  if (existsSync(local)) {
    for (const entry of readdirSync(local, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || entry.name !== 'shell.log') continue;
      const path = join(entry.parentPath, entry.name);
      const time = statSync(path).mtimeMs;
      if (newest === null || time > newest.time) newest = { path, time };
    }
  }
  return newest === null ? null : { path: newest.path, length: statSync(newest.path).size };
}

/** A small Word file, zipped with the repository's fflate. @param {string} path */
function writeDocx(path) {
  const { zipSync, strToU8 } = createRequire(join(ROOT, 'package.json'))('fflate');
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const body =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Installed-app check: a Word file imported as a PDF.</w:t></w:r></w:p></w:body></w:document>';
  writeFileSync(path, zipSync({ '[Content_Types].xml': strToU8(types), '_rels/.rels': strToU8(rels), 'word/document.xml': strToU8(body) }));
}

/** A document's text as pdftotext reads it, or one page's. @param {string} path @param {number} [page] */
const textOf = (path, page) =>
  execFileSync(pdftotextPath(ROOT), ['-enc', 'UTF-8', ...(page === undefined ? [] : ['-f', String(page), '-l', String(page)]), path, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });

/** Waits until a file's modification time moves past `after`, or throws. @param {string} path @param {number} after */
async function savedAfter(path, after, limitMs = 60_000) {
  const began = Date.now();
  while (Date.now() - began < limitMs) {
    if (existsSync(path) && statSync(path).mtimeMs > after) {
      await new Promise((done) => setTimeout(done, 1500));
      return;
    }
    await new Promise((done) => setTimeout(done, 300));
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
  const option = page.getByRole('option', { name: title, exact: true });
  if ((await option.count()) !== 1) {
    const listed = await page.getByRole('option').allTextContents();
    await page.keyboard.press('Escape');
    throw new Error(`the palette holds no single option named "${title}"; it lists ${JSON.stringify(listed.slice(0, 6))}`);
  }
  await option.click();
}

// ---------------------------------------------------------------------------------------------------------------

const documentPath = option('document');
if (documentPath === undefined || !existsSync(documentPath)) throw new Error('--document <absolute .pdf> is required and must exist.');
/**
 * `installed` (the default) or `dev`: this checkout's build through the provisioned runtime, handed its native
 * components as `npm start` hands them, on a scratch profile — for a change that has not reached a package yet. Its
 * hosts are contained the development way (ADR-0027's grant), not the package's, so a dev run says the commands work
 * through real hosts, never what an install does.
 */
const build = option('build') ?? 'installed';
if (build !== 'installed' && build !== 'dev') throw new Error('--build is installed or dev');
/** Which steps run: `edit,ocr,export,import,attach`, every one by default. */
const only = option('steps')?.split(',');
const want = (/** @type {string} */ step) => only === undefined || only.includes(step);
if (build === 'installed' && monsteraPids().length > 0) {
  console.log('REFUSED: Monstera is running. Close it first; this check never closes the owner\'s windows.');
  process.exit(2);
}
if (portListeners().length > 0) throw new Error(`port ${String(PORT)} is held; end that process first`);
const [family = '', location = '', version = ''] =
  build === 'installed'
    ? powershell(
        `$p = Get-AppxPackage -Name '${PACKAGE_NAME}'; if ($null -eq $p) { exit 3 }; "$($p.PackageFamilyName)|$($p.InstallLocation)|$($p.Version)"`,
      ).split('|')
    : ['', '', 'development build'];
if (build === 'installed' && family === '') throw new Error('the test package is not installed');

const work = join(ROOT, '..', `installed-check-${String(Date.now())}`);
mkdirSync(work, { recursive: true });
const copy = join(work, 'check.pdf');
copyFileSync(documentPath, copy);
const docx = join(work, 'import.docx');
writeDocx(docx);
const notes = join(work, 'notes.txt');
writeFileSync(notes, 'A text file attached in the installed-app check.\n');
const exported = join(work, 'export.docx');
const scanPath = option('scan');
const scanCopy = scanPath === undefined ? undefined : join(work, 'scan.pdf');
if (scanPath !== undefined && scanCopy !== undefined) copyFileSync(scanPath, scanCopy);
/** A development run's own profile, inside the temporary folder, so its shell log is this run's alone. */
const devProfile = join(work, 'profile');
/** Where this run's shell log lives: the package's storage, or the development run's profile. */
const logOf = () => (build === 'installed' ? shellLog(family) : existsSync(join(devProfile, 'logs', 'shell.log')) ? { path: join(devProfile, 'logs', 'shell.log'), length: statSync(join(devProfile, 'logs', 'shell.log')).size } : null);
const logBefore = logOf();
/** @type {{ step: string, ok: boolean, detail: string }[]} */
const steps = [];
const record = (/** @type {string} */ step, /** @type {boolean} */ ok, /** @type {string} */ detail) => {
  steps.push({ step, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}: ${detail}`);
};

console.log(build === 'installed' ? `installed ${version}` : 'development build');
if (build === 'installed') {
  const exe = join(location, 'Monstera.exe');
  spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Invoke-CommandInDesktopPackage -PackageFamilyName ${quoted(family)} -AppId 'Monstera' -Command ${quoted(exe)} -Args ${quoted(`"--remote-debugging-port=${String(PORT)}" "${copy}"`)}`,
    ],
    { stdio: 'ignore' },
  );
} else {
  const { developmentEnvironment } = await import('../lib/launchEnvironment.mjs');
  const { electronBinaryPath } = await import('../provision/electron.mjs');
  spawn(
    electronBinaryPath(ROOT),
    [join(ROOT, 'apps', 'desktop'), `--user-data-dir=${devProfile}`, `--remote-debugging-port=${String(PORT)}`, copy],
    { stdio: 'ignore', env: { ...process.env, ...(await developmentEnvironment(ROOT)) } },
  );
}

/**
 * Opens a second document in the running application the way *Open with* does: a second launch on the same profile,
 * which loses the single-instance lock and hands its argument over. It quits by itself at the lock.
 *
 * @param {string} path
 */
async function handOver(path) {
  if (build === 'installed') {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Invoke-CommandInDesktopPackage -PackageFamilyName ${quoted(family)} -AppId 'Monstera' -Command ${quoted(join(location, 'Monstera.exe'))} -Args ${quoted(`"${path}"`)}`,
      ],
      { stdio: 'ignore' },
    );
    return;
  }
  const { developmentEnvironment } = await import('../lib/launchEnvironment.mjs');
  const { electronBinaryPath } = await import('../provision/electron.mjs');
  spawn(electronBinaryPath(ROOT), [join(ROOT, 'apps', 'desktop'), `--user-data-dir=${devProfile}`, path], {
    stdio: 'ignore',
    env: { ...process.env, ...(await developmentEnvironment(ROOT)) },
  });
}

/** @type {number | undefined} */
let appPid;
/** @type {any} */
let browser;
try {
  for (let i = 0; i < 120 && browser === undefined; i += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (browser === undefined) throw new Error('the installed application never opened its debugging port');
  appPid = portListeners()[0];
  /** @type {any} */
  let page;
  for (let i = 0; i < 120 && page === undefined; i += 1) {
    for (const candidate of browser.contexts().flatMap((/** @type {any} */ c) => c.pages())) {
      if (!candidate.isClosed() && (await candidate.locator('.m-page-list canvas').count().catch(() => 0)) > 0) page = candidate;
    }
    if (page === undefined) await new Promise((done) => setTimeout(done, 500));
  }
  if (page === undefined) throw new Error('no window showed the document within a minute');
  // A FRESH PROFILE OPENS ON THE FIRST-RUN SCREEN, which holds the keyboard until it is skipped; the owner's profile
  // never shows it, so the installed runs met it only in a development one.
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  const firstTab = await page.locator('[data-tab-select][aria-current="true"]').getAttribute('data-tab-select');

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
  // document cannot show it; `--scan` names one whose first page has none, opened as *Open with* opens a second one.
  if (want('ocr')) try {
    if (scanCopy === undefined) throw new Error('--scan <absolute .pdf whose first page has no text> is needed for OCR');
    const wordsBefore = textOf(scanCopy, 1).split(/\s+/u).filter(Boolean).length;
    if (wordsBefore > 0) throw new Error(`the --scan document's first page already has ${String(wordsBefore)} words, so recognition would leave it alone`);
    const tabsBefore = await page.locator('[data-tab-select]').count();
    await handOver(scanCopy);
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
    // the document (measured). Its whole text is recorded and its OK pressed before the save.
    const outcome = await page.locator('[role="dialog"]').allInnerTexts();
    console.log(
      `  after recognition, ${String(Math.round((Date.now() - began) / 1000))} s: ${outcome.length > 0 ? `the dialog said ${JSON.stringify(outcome.map((/** @type {string} */ text) => text.replace(/\s+/gu, ' ').trim()))}` : said.length > 0 ? `said ${JSON.stringify(said)}` : 'marked unsaved'}`,
    );
    // `--shots <folder>` keeps a picture of the window at this point, for a step whose screen said nothing readable.
    const shots = option('shots');
    if (shots !== undefined) await page.screenshot({ path: join(shots, 'after-recognition.png') });
    if (outcome.length > 0) {
      await page.locator('[role="dialog"]').getByRole('button', { name: /^OK$/u }).click({ timeout: 5000 });
      await page.waitForTimeout(1000);
    }
    await page.keyboard.press('Control+S');
    await savedAfter(scanCopy, before, 120_000);
    const wordsAfter = textOf(scanCopy, 1).split(/\s+/u).filter(Boolean).length;
    record('OCR one page and save', wordsAfter > 0, `page 1 of the saved scan reads ${String(wordsAfter)} words, from ${String(wordsBefore)}`);
  } catch (error) {
    record('OCR one page and save', false, String(error).slice(0, 300));
  }

  // 3. EXPORT TO WORD, through main's save dialog.
  if (want('export')) try {
    await runCommand(page, 'Export to Word…');
    void page.getByRole('button', { name: /^Choose where to save/u }).click({ timeout: 15_000 }).catch(() => undefined);
    const began = askForDialog('export to Word', exported);
    while (!existsSync(exported) && Date.now() - began < DIALOG_WAIT_MS) await new Promise((done) => setTimeout(done, 500));
    await page.waitForTimeout(3000);
    const bytes = existsSync(exported) ? readFileSync(exported) : Buffer.alloc(0);
    const isDocx = bytes.subarray(0, 2).toString('latin1') === 'PK' && bytes.includes(Buffer.from('word/document.xml'));
    record('export to Word', isDocx, isDocx ? `a .docx of ${String(bytes.length)} bytes` : 'no Word file was written');
  } catch (error) {
    record('export to Word', false, String(error).slice(0, 300));
  }

  // 4. IMPORT A WORD FILE as a new PDF.
  if (want('import')) try {
    const tabsBefore = await page.locator('[data-tab-select]').count();
    await runCommand(page, 'New PDF from Word, Excel or PowerPoint…');
    const began = askForDialog('import a Word file', docx);
    console.log('  then a Save As asks where the new PDF goes: keep the folder and name it suggests, and press Save.');
    while ((await page.locator('[data-tab-select]').count()) <= tabsBefore && Date.now() - began < DIALOG_WAIT_MS) await page.waitForTimeout(500);
    const opened = (await page.locator('[data-tab-select]').count()) > tabsBefore;
    await page.waitForTimeout(3000);
    const drawn = opened
      ? await page.evaluate(() => {
          const w = /** @type {any} */ (globalThis);
          return [...w.document.querySelectorAll('.m-page-list canvas.m-page')]
            .filter((c) => c.checkVisibility({ visibilityProperty: true }) && c.width > 0)
            .some((c) => (c.getContext('2d')?.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] ?? 0) > 0);
        })
      : false;
    record('import a Word file', opened && drawn, opened ? (drawn ? 'a new tab drew its page' : 'a new tab opened and drew nothing') : 'no new tab opened');
  } catch (error) {
    record('import a Word file', false, String(error).slice(0, 300));
  }

  // 5. ATTACH A TEXT FILE IN THE ASSISTANT, never sent.
  if (want('attach')) try {
    await page.getByRole('tab', { name: 'Assistant' }).first().click();
    await page.waitForTimeout(1000);
    void page.getByRole('button', { name: 'Attach files' }).first().click().catch(() => undefined);
    const began = askForDialog('attach a text file', notes);
    /** @type {string[]} */
    let chips = [];
    while (Date.now() - began < DIALOG_WAIT_MS) {
      chips = await page.locator('[data-assistant-attached] li').allTextContents();
      if (chips.some((chip) => chip.includes('notes.txt'))) break;
      await page.waitForTimeout(500);
    }
    const attached = chips.some((chip) => chip.includes('notes.txt'));
    record('attach a text file (not sent)', attached, attached ? `chip: ${chips.join(', ')}` : 'no chip appeared');
  } catch (error) {
    record('attach a text file (not sent)', false, String(error).slice(0, 300));
  }

  // CLOSE: every tab but the edited copy closed with Don't save, then the window through its own close.
  for (let i = 0; i < 4; i += 1) {
    const current = await page.locator('[data-tab-select][aria-current="true"]').getAttribute('data-tab-select').catch(() => null);
    if (current === null || current === firstTab) break;
    await page.keyboard.press('Control+W');
    await page.getByRole('button', { name: 'Don’t save' }).click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await browser.close().catch(() => undefined);
  closeWindow(/** @type {number} */ (appPid));
  await page.waitForTimeout(500).catch(() => undefined);
} finally {
  /** Whether the run's application is still alive: any Monstera process for an install, its own PID for a dev run. */
  const alive = () =>
    build === 'installed'
      ? monsteraPids().length > 0
      : appPid !== undefined && execFileSync('tasklist', ['/FI', `PID eq ${String(appPid)}`, '/NH'], { encoding: 'utf8' }).includes(String(appPid));
  for (let i = 0; i < 60 && alive(); i += 1) await new Promise((done) => setTimeout(done, 500));
  if (alive()) console.log('NOT CLOSED: the run\'s application is still running; its window did not close by itself.');

  // CONTAINED: the run's lines of the shell log. Main's `package-data` lock exists only in a package.
  const logAfter = logOf();
  if (logAfter === null) record('engine hosts contained', false, 'no shell log for this run');
  else {
    const from = logBefore !== null && logBefore.path === logAfter.path ? logBefore.length : 0;
    const lines = readFileSync(logAfter.path, 'utf8').slice(from).split('\n').filter((line) => line.trim() !== '');
    // A HOST FAILURE, not the shell ending its hosts as it quits: that line reads `code=shutdown` (MuPDF's wording) or
    // `ended (shutdown)` (PDFium's), says itself that nothing is a fault, and the run's own close writes one per host.
    const failures = lines.filter((line) => /engine-host-gone|not contained/u.test(line) && !/code=shutdown|\(shutdown\)/u.test(line));
    const locked = build === 'dev' || lines.some((line) => line.includes('package-data'));
    const worked = steps.filter((s) => s.step.startsWith('edit') || s.step.startsWith('OCR')).every((s) => s.ok);
    record(
      'engine hosts contained',
      failures.length === 0 && locked && worked,
      `${String(lines.length)} new log line(s); package-data ${build === 'dev' ? 'not applicable (no package)' : locked ? 'locked' : 'NOT read'}; ${String(failures.length)} host failure(s)` +
        `${failures.length > 0 ? `: ${failures[0]?.slice(0, 200) ?? ''}` : ''}; the hosts' commands ${worked ? 'worked' : 'did not all work'}`,
    );
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  console.log(`temporary files ${existsSync(work) ? 'NOT removed' : 'removed'}`);
  console.log(`\n${String(steps.filter((s) => s.ok).length)} of ${String(steps.length)} steps passed`);
  process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
}
