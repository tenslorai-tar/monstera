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
 * Nothing here sends data off this computer, opens a page outside the app, or prints: an external link is recorded
 * where Electron's `shell.openExternal` is asked for it, and a print where the window's `print` is. A command that
 * closes the window, or needs the owner's account or key, is not walked and its row says so, by name.
 */
import { copyFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { expect } from '@playwright/test';

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
  }
  return document.save({ useObjectStreams: false });
}

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

/** A toast's kind on screen now, or none. */
const toastKind = async () => {
  if ((await page.locator('.m-toast--problem').count()) > 0) return 'problem';
  if ((await page.locator('.m-toast--done').count()) > 0) return 'done';
  return null;
};

const unsaved = async () => (await page.getByText('Unsaved changes', { exact: true }).count()) > 0;

/** Every tab closed, a close question answered "Don't save": the next step starts with nothing open. */
async function closeAll() {
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
 * Answers what the command asks, as a hand does, until nothing more is asked: the primary button, else a danger one,
 * else Escape. Records every dialog met, and a `-problem` one as the failure it is.
 * @param {string[]} met
 */
async function answerQuestions(met) {
  for (let round = 0; round < 6; round += 1) {
    await page.waitForTimeout(700);
    const id = await openDialog();
    if (id === null) return;
    met.push(id);
    if (/-problem$/u.test(id)) return;
    const dialog = page.locator('[data-dialog]').last();
    const primary = dialog.locator('.m-button--primary:not([disabled])').last();
    const danger = dialog.locator('.m-button--danger:not([disabled])').last();
    if ((await primary.count()) > 0) await primary.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else if ((await danger.count()) > 0) await danger.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    else await page.keyboard.press('Escape');
  }
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
  const first = await fingerprint();
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Zoom in');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  if ((await fingerprint()) !== first) throw new Error(`the palette opened and closed changed the fingerprint: ${first} then ${await fingerprint()}`);
  if (!(await ranFromPalette('Zoom in', 'view.zoom-in'))) throw new Error('the palette offered no Zoom in');
  await page.waitForTimeout(800);
  if ((await fingerprint()) === first) throw new Error('Zoom in left the fingerprint unchanged, so it cannot see a change');
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
      // A SECOND DOCUMENT'S WORTH OF PICKS: a command that opens, inserts or compares takes the second file, and one
      // that saves writes beside the walk's other outputs.
      await app.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked.open] });
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: picked.save });
      }, { open: second, save: join(output, `out-${command.id}.pdf`) });
      const before = { externals: await externals(), prints: await prints() };
      /** @type {string[]} */
      const errors = [];
      const onError = (/** @type {Error} */ error) => errors.push(error.message.slice(0, 200));
      page.on('pageerror', onError);
      let context = 'as opened';
      let start = await fingerprint();
      let ran = await ranFromPalette(command.title, command.id);
      if (!ran && (await selectWords())) {
        context = 'with words selected';
        start = await fingerprint();
        ran = await ranFromPalette(command.title, command.id);
      }
      if (!ran) return { notWalked: { [command.id]: 'the palette offered no command of this title, as the document opened or with words selected' } };
      /** @type {string[]} */
      const met = [];
      await answerQuestions(met);
      await page.waitForTimeout(1500);
      page.off('pageerror', onError);
      const toast = await toastKind();
      const changed = (await fingerprint()) !== start;
      const opened = (await externals()) - before.externals;
      const printed = (await prints()) - before.prints;
      const problem = met.find((id) => /-problem$/u.test(id));
      if (problem !== undefined) throw new Error(`${problem} was shown (${context})`);
      if (toast === 'problem') throw new Error(`a problem toast was shown (${context}): ${(await page.locator('.m-toast--problem').first().innerText()).slice(0, 200)}`);
      if (errors.length > 0) throw new Error(`the page threw: ${errors.join(' | ')}`);
      const shown =
        command.shows === 'a toast'
          ? toast === 'done' || opened > 0 || printed > 0
          : command.shows === 'a result dialog'
            ? met.length > 0
            : met.length > 0 || toast !== null || changed || opened > 0 || printed > 0;
      if (!shown) throw new Error(`it declares ${command.shows}, and nothing was shown (${context}; dialogs ${JSON.stringify(met)}, toast ${String(toast)}, window unchanged)`);
      // SAVED AND OPENED AGAIN, where it changed the document.
      let reopened = 'unchanged';
      if (await unsaved()) {
        const kept = join(output, `kept-${command.id}.pdf`);
        await saveTo(kept);
        await ranFromPalette('Save a copy…', 'document.save-copy');
        await expect.poll(async () => readFileSync(kept, { flag: 'r' }).byteLength > 0, { timeout: 30_000 }).toBe(true).catch(() => undefined);
        await closeAll();
        await open(kept);
        reopened = (await page.locator('canvas.m-page:visible').count()) > 0 ? 'saved and opened again' : 'saved, and the copy did not open';
        if (reopened !== 'saved and opened again') throw new Error(reopened);
      }
      return { context, dialogs: met, toast, changed, opened, printed, reopened };
    },
    { covers: [command.id] },
  );
}

await closeAll();
await finish();
