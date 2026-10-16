// @ts-check
/**
 * The exports and conversions walk (cloud run 3): exports and conversions done in the running app with a real mouse and
 * keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`, and each one that writes a file READ BACK
 * from that file by a second reader.
 *
 *   node scripts/research/exportsWalk.mjs
 *
 * Its documents are built here, from the kernel's own fixtures in `packages/kernel/dist`, so the walk needs no file of
 * the owner's. What it walks:
 *
 * - O2: a printed scan of a ruled table (`scanTableFixture.ts`) exported to Excel with *Printed scan, read on this
 *   computer*, and the workbook read back for every word of the table (ADR-0233).
 * - O10: a CSV of about three mebibytes, past one composition's bound, imported whole in parts with the work and its
 *   Cancel on screen, and the saved PDF read back by PDF.js for its first and last records.
 * - N7: a two-page sheet with one Note saved as PDF/A-2b: the level asked first, the pop-up named by page in our words,
 *   no console window while Ghostscript runs, and the saved file read back by pdf-lib for the Note and its declarations.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { root, startWalk } from './liveWalk.mjs';

// A RECOGNITION AND AN EXPORT take several seconds each on the walk's machine; a step gets thirty.
const expect = defaultExpect.configure({ timeout: 30_000 });

// THE FIXTURE THIS BUILDS ITS SCAN FROM, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/kernel/src/scanTableFixture.ts', 'packages/kernel/dist/scanTableFixture.js', 'tsc']], 1);
// A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { SCAN_TABLE_ROWS, buildScannedTablePdf } = await import('../../packages/kernel/dist/scanTableFixture.js');
// THE ENGINE BOUND IN THIS PROCESS, through the one helper scripts use: the fixture opens a document with the kernel's
// engine code, which threw "the MuPDF shim is not bound in this process" on 2026-10-14 before any step ran.
if (bindNativeEngine() === null) throw new Error('the MuPDF shim is not built here, so the walk cannot make its scanned table: node scripts/provision/mupdf.mjs');

const walk = await startWalk('exports');
const { page, output, open, saveTo, command, step, finish } = walk;

/** Every part of a saved workbook as text, read by fflate rather than by the app that wrote it. @param {string} path */
async function workbookText(path) {
  return Object.values(unzipSync(new Uint8Array(await readFile(path))))
    .map((bytes) => strFromU8(bytes))
    .join('\n');
}

const scan = join(output, 'scanned-table.pdf');
await writeFile(scan, await buildScannedTablePdf());

await step('O2: a printed scan of a ruled table exported to Excel, read on this computer, and every word is in the workbook', async () => {
  await open(scan);
  await command('Export tables to Excel…');
  const dialog = page.getByRole('dialog', { name: 'Export tables to Excel' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Printed scan, read on this computer').check();
  const saved = join(output, 'scanned-table.xlsx');
  await saveTo(saved);
  await dialog.getByRole('button', { name: 'Choose where to save…' }).click();
  // THE RECOGNITION DIALOG SAYS WHAT HAPPENED, and is closed so the export can report.
  const recognition = page.getByRole('dialog', { name: 'Recognition' });
  await expect(recognition.getByText(/was read and added to this document/u)).toBeVisible();
  await recognition.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => existsSync(saved), { timeout: 60_000 }).toBe(true);
  const text = await workbookText(saved);
  /** @type {readonly (readonly string[])[]} */
  const rows = SCAN_TABLE_ROWS;
  const words = rows.flat().filter((word) => !/^[\d.]+$/u.test(word));
  const missing = words.filter((word) => !text.includes(word));
  expect(missing).toStrictEqual([]);
  return { wordsInWorkbook: words.length - missing.length, noTablesDialog: await page.getByText(/No tables with ruled lines/u).count() };
});

/** The words of a saved file's first and last pages and its page count, read by PDF.js. @param {string} path */
async function endsOf(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false });
  const loaded = await task.promise;
  /** @param {number} at */
  const words = async (at) => (await (await loaded.getPage(at)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  const ends = { pages: loaded.numPages, first: await words(1), last: await words(loaded.numPages) };
  await task.destroy();
  return ends;
}

// A REGISTER FILE PAST ONE COMPOSITION'S BOUND (`MAX_CSV_BYTES`, 1 MiB): about three parts, built here so the walk needs
// no file of the owner's. Its first and last records are named so the saved PDF can be read back for both ends.
/**
 * A register file of `rows` records, written to the walk's output.
 *
 * @param {string} name
 * @param {number} rows
 */
async function registerFile(name, rows) {
  const path = join(output, name);
  await writeFile(
    path,
    `Record,Name,Amount\n${Array.from({ length: rows }, (_unused, at) => `R${String(at + 1)},Item ${String(at % 97)},${String((at * 7) % 1000)}`).join('\n')}\n`,
  );
  return path;
}

/**
 * The register at `register` imported through New PDF table from CSV and read back for both ends.
 *
 * @param {string} register
 * @param {number} registerRows
 */
async function importRegister(register, registerRows) {
  const { app } = walk;
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, register);
  const saved = register.replace(/\.csv$/u, '.pdf');
  await saveTo(saved);
  await command('New PDF table from CSV…');
  // THE FONT QUESTION FIRST (L4), answered with its default, as commentsWalk's Markdown steps answer it: the picker is
  // opened by the button after it, and without this press the walk waited 30 s behind the dialog (2026-10-14).
  await page.getByRole('dialog', { name: 'New PDF' }).getByRole('button', { name: 'Choose file…' }).click();
  // THE WORK IS ON SCREEN while it runs, with a Cancel, and counts its parts once main has cut the file.
  const notice = page.locator('[data-task-notice]');
  await expect(notice).toContainText('Converting CSV to PDF');
  await expect(notice).toContainText(/\d+ of \d+/u, { timeout: 120_000 });
  await expect(notice.getByRole('button')).toBeVisible();
  await expect(notice).toHaveCount(0, { timeout: 600_000 });
  // NO REFUSAL: the sentence the owner met is not on screen.
  const refused = await page.getByText(/which is the most this app will import/u).count();
  expect(refused).toBe(0);
  await expect.poll(() => existsSync(saved), { timeout: 60_000 }).toBe(true);
  const ends = await endsOf(saved);
  // BOTH ENDS OF THE FILE, read back: the header and the first record on page one, the last record on the last page.
  expect(ends.first).toContain('Record');
  expect(ends.first).toContain('R1 ');
  expect(ends.last).toContain(`R${String(registerRows)}`);
  return { pages: ends.pages, csvBytes: (await readFile(register)).byteLength };
}

// ABOUT THREE MEBIBYTES, the size the Windows session saw fail on 2026-10-14 with no answer to engine/compose-csv in
// 120 s, and the OWNER'S TWELVE: each part's cost no longer grows with the fonts installed (`fontResolver.ts`), so a
// part answers in about the same time on a machine with hundreds of faces as with the bundled twenty.
const smallRegister = await registerFile('register.csv', 160_000);
await step('O10: a CSV past one composition’s bound is imported whole, with the work on screen, and both ends are in the PDF', () =>
  importRegister(smallRegister, 160_000),
);
const largeRegister = await registerFile('register-12mib.csv', 640_000);
await step('O10: a 12 MiB CSV, the size that timed out, is imported whole and both ends are in the PDF', () =>
  importRegister(largeRegister, 640_000),
);

/**
 * The owner's N7 document: two pages and one Note on page 1 with its pop-up, as the app's writer leaves them — the Note
 * printed (`/F 28`) with an appearance, the pop-up with no `/F`, which Ghostscript drops as non-printing.
 */
async function notedSheet() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  first.drawText('sheet one', { x: 72, y: 700, size: 14, font });
  document.addPage([612, 792]).drawText('sheet two', { x: 72, y: 700, size: 14, font });
  const appearance = document.context.register(document.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 20, 20] }));
  const note = document.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 600, 320, 620], F: 28, Contents: PDFString.of('sheet'), T: PDFString.of('Emem') });
  note.set(PDFName.of('AP'), document.context.obj({ N: appearance }));
  const noteRef = document.context.register(note);
  const popupRef = document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [320, 500, 520, 600], Parent: noteRef }));
  note.set(PDFName.of('Popup'), popupRef);
  first.node.set(PDFName.of('Annots'), document.context.obj([noteRef, popupRef]));
  return document.save({ useObjectStreams: false });
}

/**
 * Whether a Ghostscript process shows a window, read by PowerShell every 100 ms until `done` settles. A console program
 * started without CREATE_NO_WINDOW owns a console window, which is what `MainWindowHandle` reports (the owner's N7).
 *
 * A SECOND WITNESS, NOT THE CHECK: a conversion shorter than one look passes unseen. What does not depend on the
 * conversion's length is `containedProgram.test.ts`: the one creation site passes CREATE_NO_WINDOW, and no shipped
 * module starts a process any other way (item 9, 2026-10-14).
 *
 * @param {Promise<unknown>} done
 */
async function consoleWindowsWhile(done) {
  let settled = false;
  void done.finally(() => {
    settled = true;
  });
  let seen = 0;
  let looked = 0;
  while (!settled) {
    const listed = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-Process gswin64c -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count"],
      { encoding: 'utf8', windowsHide: true },
    );
    looked += 1;
    seen += Number(listed.stdout.trim() || '0');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { seen, looked };
}

await step('N7: a noted sheet saved as PDF/A-2b names the pop-up by page, shows no console, and the file declares 2b with the note kept', async () => {
  const noted = join(output, 'noted.pdf');
  await writeFile(noted, await notedSheet());
  await open(noted);
  const saved = join(output, 'noted-pdfa.pdf');
  await saveTo(saved);
  await command('Export as PDF/A…');
  const level = page.getByRole('dialog', { name: 'Export as PDF/A' });
  await expect(level.getByRole('radio', { name: /PDF\/A-2b/u })).toBeChecked();
  await level.getByRole('button', { name: 'Choose where to save…' }).click();
  const report = page.getByRole('dialog', { name: 'Saved as PDF/A' });
  const windows = await consoleWindowsWhile(report.waitFor({ state: 'visible', timeout: 120_000 }));
  await expect(report).toContainText('Saved as PDF/A-2b.');
  await expect(report).toContainText('One comment pop-up on page 1.');
  // NEVER THE CONVERTER: neither its name nor its words.
  expect(await report.textContent()).not.toMatch(/Ghostscript|not permitted/u);
  await page.keyboard.press('Escape');
  // NO CONSOLE WINDOW at any reading, and the instrument looked more than once (a single look can miss a flash).
  expect(windows.looked).toBeGreaterThan(1);
  expect(windows.seen).toBe(0);

  // READ BACK by pdf-lib: the note and its text on page 1, no pop-up, and the declarations the export checked.
  const bytes = await readFile(saved);
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const marks = (document.getPages()[0]?.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? [])
    .map((entry) => document.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict)
    .map((entry) => ({ subtype: String(entry.get(PDFName.of('Subtype'))), contents: String(entry.get(PDFName.of('Contents'))) }));
  expect(marks).toStrictEqual([{ subtype: '/Text', contents: '(sheet)' }]);
  const text = bytes.toString('latin1');
  expect(text).toMatch(/pdfaid:part(=['"]|>)2/u);
  expect(text).toContain('/OutputIntents');
  return { marks, consoleReadings: windows.looked };
});

await finish();
