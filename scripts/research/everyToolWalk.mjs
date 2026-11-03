// @ts-check
/**
 * The full walk of every tool (the owner's standing rule of 2026-11-02, ADR-0285): one step per command the registry
 * generates into `docs/manual-test-checklist.md`, run in the development app on Windows the way a person runs it, and
 * recorded with `covers` so the walk's record has a row for each.
 *
 *   node scripts/research/everyToolWalk.mjs [--app-root <checkout>] [--from <n>] [--only <id,id>]
 *
 * ## What one step does
 *
 * A fresh copy of the walk's form document (three pages, words, fields) is opened, and the command is run from the
 * command palette by its title: first as the document opened, then with words selected, since a command the registry
 * offers only with a selection is not offered without one. Any question the command asks is answered as a hand does,
 * by the dialog's own primary button (its danger button where the answer is destructive), and the platform's file
 * pickers are answered with paths in the walk's own folder. A dialog whose registry id is a `-problem` one, a problem
 * toast, or a page error is a failure.
 *
 * The step passes when the command shows what the registry declares for it (*Shows:* in the checklist): a done toast,
 * a dialog, or a change on screen. Where the document changed it is saved as a copy and the copy opened again, and it
 * must open whole: the wired-tools rule's *survives save and reopen*, at the depth one generic step can reach. The
 * feature walks (text, forms, AI, deep forms) assert exact effects and mark the commands they cover; this walk is the
 * floor every command stands on, and the report says which rows were checked to which depth.
 *
 * ## What it does not run, and says why
 *
 * Nothing here sends data off this computer, opens anything outside the app, or prints: every way main hands Windows
 * something to open (`shell.openExternal`, `shell.openPath`, `shell.showItemInFolder`) is recorded instead, and a
 * print where the window's `print` is; the walk's last step fails if an installed Monstera started during it. A command that
 * closes the window, or needs the owner's account or key, is not walked and its row says so, by name.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { expect } from '@playwright/test';
import { zipSync } from 'fflate';

import { appRootOption, root, startWalk } from './liveWalk.mjs';

/** @typedef {{ title: string, group: string, id: string, shows: string }} ListedCommand */

/** Every command the checklist names, once each, in its order: the registry's own list (ADR-0285 Decision 4). */
function listedCommands() {
  const text = readFileSync(join(root, 'docs', 'manual-test-checklist.md'), 'utf8');
  /** @type {Map<string, ListedCommand>} */
  const byId = new Map();
  // " · Help:" FOLLOWS ONLY WHERE A COMMAND HAS A HELP TOPIC, so the answer ends at the next separator or the line's end:
  // a pattern that required it dropped every command with none, silently (the walk's first trial, 2026-11-03).
  // THE GROUP TOO IS THERE ONLY WHERE A COMMAND HAS ONE: a context menu's and a panel's lines read "**Title** · `id`".
  for (const match of text.matchAll(/^- \[ \] \*\*(.+?)\*\*(?: — (.+?))? · `([a-z0-9][a-z0-9.-]*)` · Shows: ([^·\n]+)/gmu)) {
    const [, title = '', group = '', id = '', shows = ''] = match;
    if (!byId.has(id)) byId.set(id, { title, group, id, shows: shows.trim() });
  }
  if (!byId.has('document.save')) throw new Error('the checklist read found no document.save: it cannot see, so it lists nothing');
  // EVERY COMMAND THE CHECKLIST NAMES, or none: the record counts the same file's ids, and a read that dropped some would
  // be a walk that never reached them reading as complete.
  const named = new Set([...text.matchAll(/ · `([a-z0-9][a-z0-9.-]*)` · /gu)].map((each) => each[1] ?? ''));
  if (named.size !== byId.size) throw new Error(`the checklist names ${String(named.size)} commands and this read parsed ${String(byId.size)}`);
  return [...byId.values()];
}

/**
 * What a state-setting command is run after, so its state does not hold already: each is the registered command a
 * person would have used to get somewhere else first.
 */
const AWAY_FROM = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  'view.theme-system': ['view.theme-dark'],
  'view.theme-light': ['view.theme-dark'],
  'view.theme-dark': ['view.theme-light'],
  'view.layout-ribbon': ['view.layout-studio'],
  'view.page-layout-continuous': ['view.page-layout-facing'],
  'view.actual-size': ['view.zoom-in'],
  'view.page-first': ['view.page-last'],
  'view.page-previous': ['view.page-last'],
  'view.go-back': ['view.page-last'],
});

/**
 * What puts the WINDOW back after a command that changes it, because a view setting belongs to the window and outlives
 * the tab: in the full run of 2026-11-03 the steps after Show grid and Dim pages ran on a dimmed page under a grid, and
 * the loupe's step saw nothing it could judge. A switch is pressed again; a choice goes back to its setting's fallback
 * (`appearance.ts` system, `layout.ts` ribbon, `viewing.ts` continuous).
 */
const SWITCHES = ['view.toggle-dark-page', 'view.toggle-grid', 'view.toggle-rulers', 'view.toggle-loupe', 'view.toggle-field-highlight', 'view.toggle-quick-toolbar', 'view.toggle-context-panel', 'view.toggle-panel', 'view.toggle-split', 'view.cover-page'];
const PUT_BACK = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  ...Object.fromEntries(SWITCHES.map((id) => [id, [id]])),
  'view.theme-dark': ['view.theme-system'],
  'view.theme-light': ['view.theme-system'],
  'view.layout-studio': ['view.layout-ribbon'],
  'view.layout-focus': ['view.layout-ribbon'],
  'view.page-layout-facing': ['view.page-layout-continuous'],
  'view.page-layout-pair': ['view.page-layout-continuous'],
  'view.page-layout-single': ['view.page-layout-continuous'],
});

/**
 * Commands whose dialog runs ANOTHER registered command, and the question that command asks when it runs: Convert a
 * scan's first row runs Make scanned pages searchable (`CONVERT_SCAN_TARGETS.searchable`), which answers with a result
 * dialog. The question is what ties the two: a walk that took this entry without seeing it would be judging a command
 * that never ran, so the step falls back to the hand-off's own declaration and fails as itself.
 */
const HANDS_OFF = /** @type {Readonly<Record<string, { to: string, question: string }>>} */ ({
  'document.convert-scan': { to: 'document.ocr', question: 'dialog.ocr' },
});

/**
 * Commands no generic step can walk here, each with the reason its row carries. Named, never left out: the record
 * refuses a row with no step and no reason, so a command missing from this list and from the walk is a refused pack.
 */
const NOT_HERE = /** @type {Readonly<Record<string, string>>} */ ({
  'app.exit': 'quits the application, which ends the walk; its close question is held by AppClose.test.tsx',
  'document.docusign-send': 'sends the document to DocuSign with the owner’s account, which leaves this computer and is the owner’s to approve',
  'document.docusign-retrieve': 'fetches a signed document from DocuSign with the owner’s account, which leaves this computer',
  'app.check-for-updates': 'asks the Microsoft Store, a request off this computer; the update check is dormant at launch by the owner’s decision',
  // MEASURED 2026-11-03: Print opens Windows' own print dialog through a native call, which is modal and holds main
  // until a person answers it, so the walk's first trial lost its window there.
  'document.print': 'opens Windows’ own print dialog, which holds the app until a person answers it and which this walk does not drive',
  // READ 2026-11-03 in documentCommands.ts' email(): the document is offered through Windows' share sheet.
  'document.email': 'offers the document through Windows’ own share sheet, from which it goes wherever the person picks, off this computer',
  // A PROVIDER'S KEY OR THE OWNER'S ACCOUNT: the walk's profile holds neither, and a key is the owner's to type
  // (aiKeyWalk.mjs and aiTranslateWalk.mjs walk the key's own rows).
  'ai.setup': 'checks and stores a provider’s key, which is the owner’s to type; the stored-key rows are aiKeyWalk.mjs’',
  'edit.translate-page': 'translates through a provider, which needs the owner’s key and sends the page off this computer',
  'ai.summarise-comments': 'asks a provider, which needs the owner’s key and sends the comments off this computer',
  'cloud.save-back': 'saves to a cloud document, which needs the owner’s cloud account',
  'document.sign-document': 'signs with a certificate file and its password, which the walk’s profile holds none of',
});

const args = process.argv;
const at = (/** @type {string} */ flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const from = Number(at('--from') ?? '0');
const only = at('--only')?.split(',');

/**
 * The walk's own document: three pages of ordinary words in a standard font, a text field and a tick box, none of them
 * required. A form with required fields answers a correct save with a warning toast, and the walk's first trial read
 * that as Save failing (2026-11-03).
 */
async function walkDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();
  for (let number = 1; number <= 3; number += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Page ${String(number)} of the walk's document`, { x: 72, y: 720, size: 18, font });
    ['Every tool is run on these words, the way a person runs it.', 'A second line, so a selection can run across a line end.', 'And a third, for a paragraph.'].forEach((line, at) =>
      page.drawText(line, { x: 72, y: 680 - at * 16, size: 12, font }),
    );
    if (number === 1) {
      page.drawText('Name:', { x: 72, y: 560, size: 12, font });
      form.createTextField('name').addToPage(page, { x: 120, y: 552, width: 200, height: 20 });
      form.createCheckBox('agreed').addToPage(page, { x: 72, y: 520, width: 14, height: 14 });
    }
    // A RULED TABLE on page 2, three rows of two: what Export tables to Excel looks for, and answered rightly that the
    // walk's first document had none (2026-11-03).
    if (number === 2) {
      const [left, top, columns, rows, width, height] = [72, 560, 2, 3, 150, 24];
      for (let row = 0; row <= rows; row += 1) page.drawLine({ start: { x: left, y: top - row * height }, end: { x: left + columns * width, y: top - row * height }, thickness: 1 });
      for (let column = 0; column <= columns; column += 1) page.drawLine({ start: { x: left + column * width, y: top }, end: { x: left + column * width, y: top - rows * height }, thickness: 1 });
      [['Item', 'Count'], ['Pens', '3'], ['Pages', '12']].forEach((cells, row) =>
        cells.forEach((cell, column) => page.drawText(cell, { x: left + column * width + 6, y: top - row * height - 17, size: 11, font })),
      );
    }
    // A COMMENT on page 1, clear of the words: what Export comments writes and Import comments takes back, and what
    // Select all selects on the page on show. With none, the export was empty and the import answered rightly that
    // there was nothing in it; on page 3, Select all had nothing to select on page 1 (2026-11-03).
    if (number === 1) {
      const note = document.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [520, 740, 540, 760],
        Contents: PDFString.of("The walk's comment"),
        T: PDFString.of('Walk'),
      });
      page.node.addAnnot(document.context.register(note));
    }
  }
  return document.save({ useObjectStreams: false });
}

/** How many processes of an INSTALLED Monstera run now: the executable a package puts under WindowsApps. */
function installedRunning() {
  const listed = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='Monstera.exe'\" | Measure-Object).Count"], { encoding: 'utf8' });
  return Number(listed.trim());
}
const installedAtStart = installedRunning();

const walk = await startWalk('every-tool', appRootOption(process.argv));
const { app, page, output, open, saveTo, step, finish } = walk;
const source = join(output, 'walk-document.pdf');
await writeFile(source, await walkDocument());
const second = join(root, '_review', 'test-files', 'sample5.pdf');

// NOTHING LEAVES THIS COMPUTER: an external page and a print are recorded where main would ask for them.
await app.evaluate(({ shell, webContents }) => {
  const g = /** @type {any} */ (globalThis);
  g.__walkExternal = [];
  g.__walkPrinted = 0;
  shell.openExternal = async (/** @type {string} */ url) => {
    g.__walkExternal.push(url);
  };
  // AND EVERY OTHER WAY MAIN HANDS WINDOWS SOMETHING TO OPEN: a file or folder opened with its default program, and a
  // file shown in File Explorer. Only openExternal was recorded at first, and the first full run's "Edit page in another
  // app" handed its page to Windows, which opened it in the owner's installed Monstera (2026-11-03).
  shell.openPath = async (/** @type {string} */ path) => {
    g.__walkExternal.push(`open:${path}`);
    return '';
  };
  shell.showItemInFolder = (/** @type {string} */ path) => {
    g.__walkExternal.push(`folder:${path}`);
  };
  for (const contents of webContents.getAllWebContents()) {
    contents.print = (/** @type {unknown} */ _options, /** @type {((ok: boolean, why: string) => void) | undefined} */ done) => {
      g.__walkPrinted += 1;
      done?.(true, '');
    };
  }
});
const externals = () => app.evaluate(() => /** @type {any} */ (globalThis).__walkExternal.length);
const prints = () => app.evaluate(() => /** @type {any} */ (globalThis).__walkPrinted);

/** The open dialog's registry id, or none. */
const openDialog = () =>
  page
    .locator('[data-dialog]')
    .last()
    .getAttribute('data-dialog', { timeout: 500 })
    .catch(() => null);

/** Every toast on screen, by kind and words. */
const toastsNow = () =>
  page.locator('.m-toast').evaluateAll((all) =>
    all.map((toast) => `${toast.classList.contains('m-toast--problem') ? 'problem' : toast.classList.contains('m-toast--done') ? 'done' : 'other'}|${(toast.textContent ?? '').trim()}`),
  );

/**
 * The kind of toast this command put up, and its words, or none. ONLY THE TOASTS THAT CAME AFTER IT: a problem toast is
 * not timed and stays until it is dismissed, so one step's "Nothing is marked for redaction" failed every step after it
 * in the walk's first full run (2026-11-03).
 * @param {readonly string[]} before
 */
const toastAfter = async (before) => {
  const added = (await toastsNow()).filter((each) => !before.includes(each));
  const problem = added.find((each) => each.startsWith('problem|'));
  if (problem !== undefined) return { kind: 'problem', text: problem.slice(8) };
  const done = added.find((each) => each.startsWith('done|'));
  if (done !== undefined) return { kind: 'done', text: done.slice(5) };
  return added.length > 0 ? { kind: 'other', text: (added[0] ?? '').replace(/^[a-z]+\|/u, '') } : null;
};

const unsaved = async () => (await page.getByText('Unsaved changes', { exact: true }).count()) > 0;

/**
 * Dismisses any modal left open, whether or not it is a registry dialog: the command palette is the Dialog primitive
 * with no id, and the step after Command palette could not reach Open PDF beneath it (2026-11-03).
 */
async function dismissModals() {
  for (let modal = 0; modal < 4 && (await page.locator('.m-dialog').count()) > 0; modal += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

/** Every tab closed, a close question answered "Don't save": the next step starts with nothing open. */
async function closeAll() {
  await dismissModals();
  for (let tab = 0; tab < 12; tab += 1) {
    if ((await page.locator('.m-status-name').count()) === 0) return;
    await page.keyboard.press('Control+W');
    for (let asked = 0; asked < 3; asked += 1) {
      const id = await openDialog();
      if (id === null) break;
      if (id === 'dialog.close-unsaved') await page.locator('[data-dialog]').last().getByRole('button', { name: 'Don’t save' }).click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
  }
}

/** Words selected on page 1 by a drag across its first text line, as a hand selects. */
async function selectWords() {
  const line = page.locator('[data-text-layer="0"]:visible [data-text-line]').first();
  await expect(line).toBeVisible({ timeout: 30_000 });
  const box = await line.boundingBox();
  if (box === null) return false;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 2, 160), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  return true;
}

/**
 * The command run from the palette by its exact title, or `false` where the palette offers no command of that title
 * in this state of the window, which is what a command whose `when` is false looks like there.
 * @param {string} title
 * @param {string} id
 */
async function ranFromPalette(title, id) {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  // BY ITS ID, which the palette writes into each option's element id with every other character an underscore: two
  // commands share some titles (Translate), and a title alone picked neither (the walk's first trial, 2026-11-03).
  const choice = page.locator(`[role="option"][id$="-${id.replaceAll(/[^A-Za-z0-9_-]/gu, '_')}"]`);
  if ((await choice.count().catch(() => 0)) !== 1) {
    await page.waitForTimeout(400);
    if ((await choice.count().catch(() => 0)) !== 1) {
      await page.keyboard.press('Escape');
      return false;
    }
  }
  await choice.click();
  return true;
}

/**
 * What the window says, with the palette closed: the status bar's facts, every pressed button and selected tab, the
 * theme, the pages drawn and their sizes, the marks and fields on the page, the words selected and any dialog open.
 * Compared before and after a command, it says whether the command changed anything a person sees; a count of DOM
 * mutations cannot, since opening the palette and typing in it make hundreds (the walk's first trial, 2026-11-03).
 */
function fingerprint() {
  return page.evaluate(() => {
    const d = /** @type {any} */ (globalThis).document;
    const texts = (/** @type {string} */ selector) =>
      [...d.querySelectorAll(selector)].map((/** @type {any} */ each) => (each.getAttribute('aria-label') ?? each.textContent ?? '').trim()).sort();
    return JSON.stringify({
      status: (d.querySelector('.m-status-bar, footer')?.innerText ?? '').replaceAll(/\s+/gu, ' '),
      pressed: texts('[aria-pressed="true"]'),
      tabs: texts('[role="tab"][aria-selected="true"]'),
      theme: d.documentElement.getAttribute('data-theme'),
      pages: [...d.querySelectorAll('canvas.m-page')].map((/** @type {any} */ c) => `${String(Math.round(c.getBoundingClientRect().width))}x${String(Math.round(c.getBoundingClientRect().height))}`),
      marks: d.querySelectorAll('[data-annotation], [data-annotation-overlay] *').length,
      fields: d.querySelectorAll('[data-form-field], [data-field-box]').length,
      selected: String(/** @type {any} */ (globalThis).getSelection?.() ?? ''),
      dialogs: texts('[data-dialog]'),
      panels: texts('[role="tabpanel"]:not([hidden])').length,
      // WHICH PANE HOLDS THE FOCUS, by its own `data-pane`: F6 and Shift+F6 move nothing else (`paneCommands.ts`).
      pane: d.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? '',
      // WHAT IS DRAWN, by kind: every class of every element with a size, so a part that comes or goes with no button
      // pressed and no word changed (the rulers, a panel, a bar) is seen; the walk's second trial read Show rulers as
      // nothing shown. The palette, toasts and tooltips are a step's own furniture, and left out.
      drawn: [
        ...new Set(
          [...d.querySelectorAll('[class]')]
            .filter((/** @type {any} */ element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && element.closest('.m-palette, .m-toasts, [role="tooltip"]') === null;
            })
            .flatMap((/** @type {any} */ element) => [...element.classList].filter((name) => name.startsWith('m-'))),
        ),
      ].sort(),
    });
  });
}

/**
 * Returns once no task is running, up to two minutes. A command that runs as a task says it is working and answers
 * when it ends, so its answer is waited for rather than read while it runs: PDF/A's export was read at "Exporting to
 * PDF/A…" (2026-11-03). One rule for the step and for the dialogs, so neither reads a running task as an answer.
 */
async function tasksEnded() {
  for (let waited = 0; waited < 120 && (await page.locator('.m-toast--task').count()) > 0; waited += 1) await page.waitForTimeout(1000);
}

/**
 * Answers what the command asks, as a hand does, until nothing more is asked: the primary button, else a danger one,
 * else the first row's button, else Escape. Records every dialog met, and a `-problem` one as the failure it is.
 * @param {string[]} met
 */
async function answerQuestions(met) {
  for (let round = 0; round < 6; round += 1) {
    await page.waitForTimeout(700);
    // A QUESTION ASKED AGAIN AFTER A TASK: Save a smaller copy measures, then asks once more with the size it measured.
    // Read while the measuring ran, no dialog was open and the walk stopped answering (2026-11-03).
    await tasksEnded();
    const id = await openDialog();
    if (id === null) return;
    met.push(id);
    if (/-problem$/u.test(id)) return;
    const dialog = page.locator('[data-dialog]').last();
    // WHAT A HAND TYPES FIRST: a question whose primary waits for a word or a choice (a password, a language) is
    // answered by filling it, with a test value of the walk's own; a field with a value is left as the dialog set it.
    for (const field of await dialog.locator('input[type="text"]:not([disabled]), input[type="password"]:not([disabled]), input:not([type]):not([disabled])').all()) {
      if ((await field.inputValue().catch(() => 'x')) === '') await field.fill('walk-test-1').catch(() => undefined);
    }
    for (const choice of await dialog.locator('select:not([disabled])').all()) {
      if ((await choice.inputValue().catch(() => 'x')) === '') {
        const value = await choice.locator('option').evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? '').find((each) => each !== '') ?? '');
        if (value !== '') await choice.selectOption(value).catch(() => undefined);
      }
    }
    const primary = dialog.locator('.m-button--primary:not([disabled])').last();
    const danger = dialog.locator('.m-button--danger:not([disabled])').last();
    // A CHOICE OF ROWS, each with its own button and no primary (Convert a scan, Restore a previous version): a hand
    // presses the first row's. With Escape there, both dismissed themselves and read as doing nothing (2026-11-03).
    const row = dialog.locator('.m-dialog__body .m-button:not([disabled])').first();
    if ((await primary.count()) > 0) await primary.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else if ((await danger.count()) > 0) await danger.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else if ((await row.count()) > 0) await row.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else await page.keyboard.press('Escape');
  }
}

/**
 * The fingerprint once the window has stopped changing: two readings half a second apart that agree, within 15 s. A
 * document just opened is still drawing its pages and its text layer, and a reading taken then changes by itself: the
 * walk's control failed so once in two runs after the restart of 2026-11-03, where it blamed the palette for the
 * document settling. A step's "before" read that early would let a command that did nothing pass as a change.
 */
async function settledFingerprint() {
  let last = await fingerprint();
  for (let tries = 0; tries < 30; tries += 1) {
    await page.waitForTimeout(500);
    const now = await fingerprint();
    if (now === last) return now;
    last = now;
  }
  throw new Error('the window did not stop changing within 15 s, so no change could be judged');
}

/** Which parts of two fingerprints differ, by name: what a failed step says it saw. @param {string} a @param {string} b */
function differing(a, b) {
  const [left, right] = [JSON.parse(a), JSON.parse(b)];
  const keys = Object.keys(left).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
  return keys.length === 0 ? 'nothing' : keys.join(', ');
}

/** A one-pixel PNG, for a command that asks for a picture. */
const PICTURE = join(output, 'walk-picture.png');
await writeFile(PICTURE, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

/** The walk's own files of the other kinds a command opens: Markdown, a table as CSV, and a Word document. */
const MARKDOWN = join(output, 'walk-notes.md');
await writeFile(MARKDOWN, ['# The walk’s notes', '', 'A paragraph of **ordinary** words.', '', '- one', '- two', ''].join('\n'));
const TABLE = join(output, 'walk-table.csv');
await writeFile(TABLE, ['Item,Count', 'Pens,3', 'Pages,12', ''].join('\n'));
const WORD = join(output, 'walk-letter.docx');
{
  const encode = (/** @type {string} */ text) => new TextEncoder().encode(text);
  await writeFile(
    WORD,
    zipSync({
      '[Content_Types].xml': encode(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': encode(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': encode(
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A letter the walk wrote.</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
  );
}
/** The walk's file for each extension a picker names first. */
const FILE_OF = /** @type {Readonly<Record<string, string>>} */ ({ md: MARKDOWN, markdown: MARKDOWN, csv: TABLE, docx: WORD, doc: WORD, odt: WORD, rtf: WORD, xlsx: WORD, pptx: WORD });

/**
 * The platform's pickers answered from what each asks for, as a hand answers them: a folder where it asks for one, a
 * save named with the first extension its own filter lists, and an open of a file of that extension, the walk's picture
 * for pictures, the file the matching export wrote for an import, and the second document otherwise. One answer for
 * every picker made the walk's first full run hand a PDF to every import and a `.pdf` name to every export (2026-11-03).
 * @param {string} id
 */
async function answerPickers(id) {
  await app.evaluate(
    ({ dialog }, picked) => {
      const optionsOf = (/** @type {unknown[]} */ args) => /** @type {any} */ (args.find((each) => each !== null && typeof each === 'object' && ('filters' in each || 'properties' in each)) ?? {});
      const extensionOf = (/** @type {any} */ options) => String(options.filters?.[0]?.extensions?.[0] ?? 'pdf').replace('*', 'pdf');
      dialog.showOpenDialog = async (/** @type {unknown[]} */ ...args) => {
        const options = optionsOf(args);
        if ((options.properties ?? []).includes('openDirectory')) return { canceled: false, filePaths: [picked.folder] };
        const extension = extensionOf(options);
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'].includes(extension)) return { canceled: false, filePaths: [picked.picture] };
        if (extension === 'pdf') return { canceled: false, filePaths: [picked.second] };
        const own = picked.files[extension];
        if (own !== undefined) return { canceled: false, filePaths: [own] };
        return { canceled: false, filePaths: [`${picked.exported}.${extension}`] };
      };
      dialog.showSaveDialog = async (/** @type {unknown[]} */ ...args) => ({ canceled: false, filePath: `${picked.save}.${extensionOf(optionsOf(args))}` });
    },
    {
      folder: output,
      picture: PICTURE,
      second,
      exported: join(output, `out-${id.replace('.import-', '.export-')}`),
      save: join(output, `out-${id}`),
      files: FILE_OF,
    },
  );
}

const commandsById = new Map(listedCommands().map((command) => [command.id, command]));
/** An edit to undo, for Undo and Redo: a quarter turn of the page. */
const rotate = [...commandsById.values()].find((command) => /rotate-page/u.test(command.id) && !/180/u.test(command.id));

/** A command run by its id, and what it asks answered. @param {string} id */
async function run(id) {
  const listed = commandsById.get(id);
  if (listed === undefined) throw new Error(`no command ${id} in the checklist`);
  if (!(await ranFromPalette(listed.title, id))) throw new Error(`the palette did not offer ${id}`);
  await answerQuestions([]);
  await page.waitForTimeout(800);
}

/**
 * What a command needs before it has anything to do, made as a hand makes it. Without it the command answers rightly
 * that there is nothing to do, and the walk's first full run read those answers as failures (2026-11-03).
 * @param {string} id
 */
async function prepare(id) {
  if ((id === 'document.undo' || id === 'document.redo') && rotate !== undefined) {
    await run(rotate.id);
    if (id === 'document.redo') await run('document.undo');
    return;
  }
  // AN IMPORT TAKES THE FILE ITS OWN EXPORT WRITES, which the pickers then hand it (`answerPickers`).
  const exported = id.replace('.import-', '.export-');
  if (exported !== id && commandsById.has(exported)) {
    // THE EXPORT'S OWN PICKERS while it runs, so it writes the file under its own name: with the import's set, it
    // wrote `out-<import>.json` and the import was handed a file that did not exist (2026-11-03).
    await answerPickers(exported);
    await run(exported);
    await answerPickers(id);
    return;
  }
  if (id === 'document.apply-redactions') {
    // MARKED FROM THE SELECTION'S OWN MENU, where Mark for redaction lives; the palette does not offer it.
    await selectWords();
    const line = await page.locator('[data-text-layer="0"]:visible [data-text-line]').first().boundingBox();
    if (line !== null) await page.mouse.click(line.x + 40, line.y + line.height / 2, { button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Mark for redaction', exact: true }).click({ timeout: 10_000 });
    await page.waitForTimeout(800);
    return;
  }
  if (id === 'edit.paste') {
    await selectWords();
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(300);
    return;
  }
  if (id === 'view.go-forward') {
    await run('view.page-last');
    await run('view.go-back');
    return;
  }
  // A COMMAND THAT SETS A STATE starts from another one, or it is run where its state already holds and rightly
  // changes nothing: the full run of 2026-11-03 asked for page 1 on page 1, the Ribbon in the Ribbon, 100% at 100%.
  const away = AWAY_FROM[id];
  if (away !== undefined) {
    for (const each of away) await run(each);
    return;
  }
  if (id === 'view.reset-float-bar') {
    // MOVED BY ITS GRIP, as a hand moves it, so there is a position to reset.
    const grip = await page.locator('.m-quick-toolbar__grip').first().boundingBox().catch(() => null);
    if (grip === null) throw new Error('no Float bar grip was drawn, so there was no position to move and reset');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 300, grip.y + 120, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    return;
  }
  if (id === 'document.clear-recent') {
    // THE RECENT FILES ARE DRAWN ON THE START SCREEN, so that is where clearing them is seen.
    await closeAll();
    return;
  }
  if (id === 'document.restore-version') {
    // A VERSION IS KEPT EACH TIME A FILE IS SAVED OVER, so an edit is saved over the walk's copy first.
    if (rotate !== undefined) await run(rotate.id);
    await run('document.save');
    return;
  }
}

/**
 * A saved copy opened again as a hand opens it, its password typed where it asks for one: the walk's own test value,
 * which the walk typed when Password and permissions asked (`answerQuestions`). `open` waits for the copy's name in the
 * status bar and could not answer the password question that stands before it (2026-11-03).
 * @param {string} path
 */
async function reopen(path) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, path);
  await page.keyboard.press('Control+O');
  const name = path.split(/[\\/]/u).at(-1) ?? '';
  for (let tries = 0; tries < 60; tries += 1) {
    if ((await page.locator(`.m-status-name[title="${name}"]`).count()) > 0) return true;
    if ((await openDialog()) === 'dialog.document-password') {
      const asked = page.locator('[data-dialog]').last();
      await asked.locator('input[type="password"]').first().fill('walk-test-1');
      await asked.locator('.m-button--primary').last().click();
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/** Where the pointer rests after a command that draws under it, the loupe's own place: over the page's words. */
async function pointerOverPage() {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box !== null) await page.mouse.move(box.x + box.width / 3, box.y + box.height / 5, { steps: 6 });
}

const commands = listedCommands().filter((command, index) => index >= from && (only === undefined || only.includes(command.id)));
process.stdout.write(`${String(commands.length)} commands to walk from the registry's checklist\n`);

// THE FINGERPRINT'S TWO CONTROLS, before it judges anything: the palette opened and closed changes nothing it reads, and
// a command that changes the view (Zoom in) changes it. Either failing would make every "changed on screen" below a
// guess, so the walk stops there.
let controlled = false;
await step('CONTROL: the window fingerprint sees a change and sees none where there is none', async () => {
  const copy = join(output, 'doc-control.pdf');
  await copyFile(source, copy);
  await open(copy);
  const first = await settledFingerprint();
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Zoom in');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const second = await settledFingerprint();
  if (second !== first) {
    const [a, b] = [JSON.parse(first), JSON.parse(second)];
    const moved = Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    throw new Error(`the palette opened and closed changed the fingerprint's ${moved.join(', ')}: ${moved.map((key) => `${key} ${JSON.stringify(a[key])} then ${JSON.stringify(b[key])}`).join('; ').slice(0, 900)}`);
  }
  if (!(await ranFromPalette('Zoom in', 'view.zoom-in'))) throw new Error('the palette offered no Zoom in');
  await page.waitForTimeout(800);
  if ((await settledFingerprint()) === first) throw new Error('Zoom in left the fingerprint unchanged, so it cannot see a change');
  controlled = true;
  return { fingerprint: first.slice(0, 200) };
});
if (!controlled) {
  await finish();
  process.exit(1);
}

for (const command of commands) {
  const reason = NOT_HERE[command.id];
  if (reason !== undefined) {
    await step(`${command.id}: not walked here`, async () => ({ notWalked: { [command.id]: reason } }));
    continue;
  }
  await step(
    `${command.id}: ${command.title}`,
    async () => {
      await closeAll();
      const copy = join(output, `doc-${command.id}.pdf`);
      await copyFile(source, copy);
      await open(copy);
      // THE TOOL IS THE WINDOW'S, NOT THE DOCUMENT'S, so a tool the step before armed is still armed in a fresh tab:
      // Add a date field's tool turned the redaction step's word selection into a new field (2026-11-03). Each step
      // starts from the one a person starts with; Select text's own step starts from another, so it has a change to make.
      await run(command.id === 'view.select-text' ? 'annotate.select' : 'view.select-text');
      await answerPickers(command.id);
      await prepare(command.id);
      const before = { externals: await externals(), prints: await prints(), toasts: await toastsNow() };
      /** @type {string[]} */
      const errors = [];
      const onError = (/** @type {Error} */ error) => errors.push(error.message.slice(0, 200));
      page.on('pageerror', onError);
      let context = 'as opened';
      let start = await settledFingerprint();
      let ran = await ranFromPalette(command.title, command.id);
      if (!ran && (await selectWords())) {
        context = 'with words selected';
        start = await settledFingerprint();
        ran = await ranFromPalette(command.title, command.id);
      }
      if (!ran) return { notWalked: { [command.id]: 'the palette offered no command of this title, as the document opened or with words selected' } };
      /** @type {string[]} */
      const met = [];
      await answerQuestions(met);
      // A COMMAND THAT DRAWS UNDER THE POINTER (the loupe) shows nothing until the pointer is over the page, as a hand's is.
      if (command.id === 'view.toggle-loupe') await pointerOverPage();
      await page.waitForTimeout(1500);
      await tasksEnded();
      // A QUESTION THAT OPENED LATE, after the answering had stopped looking: Convert text to curves' dialog, behind a
      // PDF/A export still finishing, opened after the first 700 ms and was judged as nothing shown (2026-11-03).
      for (let late = 0; late < 3 && (await openDialog()) !== null && !met.some((id) => /-problem$/u.test(id)); late += 1) {
        await answerQuestions(met);
        await page.waitForTimeout(1500);
        await tasksEnded();
      }
      page.off('pageerror', onError);
      const toast = await toastAfter(before.toasts);
      const end = await settledFingerprint();
      const changed = end !== start;
      const opened = (await externals()) - before.externals;
      const printed = (await prints()) - before.prints;
      const problem = met.find((id) => /-problem$/u.test(id));
      if (problem !== undefined) {
        // THE DIALOG'S OWN WORDS, so the failure says what the app said rather than only which dialog said it.
        const said = await page.locator('[data-dialog]').last().innerText().catch(() => '');
        throw new Error(`${problem} was shown (${context}): ${said.replaceAll(/\s+/gu, ' ').slice(0, 240)}`);
      }
      if (toast?.kind === 'problem') throw new Error(`a problem toast was shown (${context}): ${toast.text.slice(0, 200)}`);
      if (errors.length > 0) throw new Error(`the page threw: ${errors.join(' | ')}`);
      // A HAND-OFF IS JUDGED BY THE COMMAND IT HANDS TO, once that command's own question is seen: the hand-off's
      // declaration names one of its routes, and the walk takes the first.
      const handOff = HANDS_OFF[command.id];
      const handed = handOff !== undefined && met.includes(handOff.question) ? commandsById.get(handOff.to) : undefined;
      const shows = handed?.shows ?? command.shows;
      const shown =
        shows === 'a toast'
          ? toast?.kind === 'done' || opened > 0 || printed > 0
          : shows === 'a result dialog'
            ? met.length > 0
            : met.length > 0 || toast !== null || changed || opened > 0 || printed > 0;
      if (!shown) {
        throw new Error(
          `it declares ${shows}${handed === undefined ? '' : ` (as ${handed.id}, which it handed to)`}, and nothing was shown (${context}; dialogs ${JSON.stringify(met)}, toast ${toast === null ? 'none' : `${toast.kind}: ${toast.text.slice(0, 80)}`}, changed: ${differing(start, end)})`,
        );
      }
      // SAVED AND OPENED AGAIN, where it changed the document.
      let reopened = 'unchanged';
      if (await unsaved()) {
        const kept = join(output, `kept-${command.id}.pdf`);
        await saveTo(kept);
        await ranFromPalette('Save a copy…', 'document.save-copy');
        await expect.poll(async () => readFileSync(kept, { flag: 'r' }).byteLength > 0, { timeout: 30_000 }).toBe(true).catch(() => undefined);
        await closeAll();
        const back = await reopen(kept);
        await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
        reopened = back && (await page.locator('canvas.m-page:visible').count()) > 0 ? 'saved and opened again' : 'saved, and the copy did not open';
        if (reopened !== 'saved and opened again') throw new Error(reopened);
      }
      return { context, dialogs: met, toast, changed, opened, printed, reopened };
    },
    { covers: [command.id] },
  );
  // THE WINDOW PUT BACK, after the step and outside it, so its result stays the command's own; a put-back that fails
  // is a step of its own, and names what the next steps would otherwise run under.
  const back = PUT_BACK[command.id];
  if (back !== undefined) {
    try {
      await dismissModals();
      for (const each of back) await run(each);
    } catch (error) {
      await step(`${command.id}: the window was not put back`, () => Promise.reject(error));
    }
  }
}

// THE WALK STARTED NOTHING OUTSIDE ITSELF: a route to Windows the recorders above miss would open a file in whatever
// program Windows chooses, and for a PDF on this computer that is the owner's installed Monstera (2026-11-03).
await step('the walk started no installed Monstera: every file it wrote stayed inside the walk', async () => {
  const now = installedRunning();
  if (now > installedAtStart) throw new Error(`${String(now - installedAtStart)} installed Monstera process(es) started during the walk`);
  return { installedAtStart, now };
});

await closeAll();
await finish();
