// @ts-check
/**
 * R22's push-button actions (ADR-0259), each built in Properties, pressed while filling, and its effect observed in the
 * LIVE application, on the real kernel and the real main process: the owner's condition of 2026-10-21, "the agent should
 * not just build the options and leave them there". `buttonActions.pw.ts` proves what the renderer SENDS against a
 * stubbed kernel; this walk is the other end — what the document, the window and the system were handed.
 *
 *   node scripts/research/buttonActionsWalk.mjs [--app-root <checkout> | --executable <Monstera.exe>] [--only <name|...>]
 *
 * What each step reads, never a DOM signal standing for the effect:
 * - a page and a view: the page box's own number and the status bar's zoom, before and after;
 * - a reset, a show or hide, an import: a copy saved after the press, read back by pdf-lib (a second reader);
 * - a link and mail: the address main hands `shell.openExternal`, which the walk records in place of opening it;
 * - print: Monstera's Print window, cancelled;
 * - submit to https: refused by ADR-0061's guard for this machine and its network — measured by a socket on this machine
 *   that must see no connection — and said; a private address is refused the same way;
 * - open a file: a tab for a PDF beside the document, and the sentence for one that is not there.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { AnnotationFlags, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { startWalk, writesDone, writesLanded } from './liveWalk.mjs';

const argv = process.argv.slice(2);
/** @param {string} name */
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const appRoot = option('--app-root');
const executable = option('--executable');
// SPLIT ON `|`: the checks' names carry commas.
const only = option('--only')?.split('|');
/** @param {string} name */
const wanted = (name) => only === undefined || only.includes(name);

const LONG = 'A long answer that runs past what a mail link can carry. '.repeat(40);
/** One button per action, in a column, and the order the walk presses them in. */
const BUTTONS = ['GoKeep', 'GoFit', 'GoWidth', 'Link', 'Reset', 'Hide', 'Print', 'Import', 'SubmitLocal', 'SubmitPrivate', 'MailShort', 'MailLong', 'OpenFile', 'OpenMissing', 'Several'];

/** The form: a name, a city and long notes, filled; a button for each action; three pages to go to. */
async function formPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const text = (/** @type {string} */ name, /** @type {string} */ value, /** @type {number} */ y) => {
    const field = form.createTextField(name);
    field.setText(value);
    field.addToPage(page, { x: 60, y, width: 300, height: 20, font });
  };
  text('applicant.name', 'Ada', 740);
  text('applicant.city', 'Paris', 710);
  text('applicant.notes', LONG, 680);
  BUTTONS.forEach((name, at) => {
    form.createButton(name).addToPage(name, page, { x: 60 + (at % 3) * 140, y: 620 - Math.floor(at / 3) * 36, width: 120, height: 26, font });
  });
  for (let more = 2; more <= 3; more += 1) {
    const next = document.addPage([612, 792]);
    next.drawText(`Page ${String(more)}`, { x: 72, y: 700, size: 24, font });
  }
  return document.save();
}

/** A PDF of its own name, for Open a file. @param {string} name */
async function besidePdf(name) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(name, { x: 72, y: 700, size: 24, font });
  return document.save();
}

/** FDF naming the applicant Grace, for Import form data. */
const FDF = '%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [ << /T (applicant.name) /V (Grace) >> ] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';

const walk = await startWalk(
  'buttonActions',
  executable !== undefined ? { executable: resolve(executable) } : appRoot === undefined ? {} : { appRoot: resolve(appRoot) },
);
const { app, page, output, command, section, pickFiles, saveTo, step, finish } = walk;

const formPath = join(output, 'buttons.pdf');
await writeFile(formPath, await formPdf());
await writeFile(join(output, 'Guide.pdf'), await besidePdf('Guide'));
const fdfPath = join(output, 'answers.fdf');
await writeFile(fdfPath, FDF);

// WHAT MAIN HANDS THE SYSTEM, recorded instead of opened: a browser and a mail app on the walk machine are not the
// observation, the address is. `shell.openExternal` is read at the moment of the call (`entry.ts`).
await app.evaluate(({ shell }) => {
  /** @type {string[]} */
  const handed = [];
  Reflect.set(globalThis, 'handedToSystem', handed);
  shell.openExternal = (/** @type {string} */ address) => {
    handed.push(address);
    return Promise.resolve();
  };
});
/** @returns {Promise<string[]>} */
const handed = () => app.evaluate(() => /** @type {string[]} */ ([...Reflect.get(globalThis, 'handedToSystem')]));

await walk.open(formPath);
await section('Forms');

/** A button's control while filling, by its accessible name. @param {string} name */
const buttonOnPage = (name) => page.getByRole('button', { name: `Press ${name}`, exact: true });
/** The Properties pane of a field chosen from the Fields list. @param {string} name */
async function properties(name) {
  if ((await page.locator('.m-forms-jump').count()) === 0) await command('Fields list');
  await page.locator('.m-forms-jump').filter({ hasText: new RegExp(`^${name}$`, 'u') }).first().click();
  const pane = page.locator('[data-field-properties]');
  await pane.getByRole('group', { name: 'Actions' }).waitFor({ timeout: 15_000 });
  return pane;
}
/** Adds one action to `name`'s list and saves it. @param {string} name @param {(pane: import('playwright').Locator) => Promise<void>} set */
async function addAction(name, set) {
  const pane = await properties(name);
  await pane.getByRole('button', { name: 'Add action' }).click();
  await set(pane);
  // UNTIL THE EDIT HAS LANDED, not a fixed pause: a press before it reads the button as it was. With 800 ms and a cold
  // application, the first step of a run pressed a button that had no action yet (measured, a run of one step).
  const written = await writesDone(page);
  await pane.getByRole('button', { name: 'Save action' }).click();
  await writesLanded(page, written);
  await page.waitForTimeout(300);
}
/** Ticks the fields an action names, after choosing "only the fields ticked" where the action offers the choice. */
const tick = async (/** @type {import('playwright').Locator} */ pane, /** @type {string[]} */ names, chooseOnly = true) => {
  if (chooseOnly) await pane.getByLabel('Only the fields ticked below').check();
  for (const name of names) await pane.getByRole('checkbox', { name }).check();
};

/** A copy of the document as it now is, read back by pdf-lib. @param {string} name */
async function savedCopy(name) {
  const path = join(output, name);
  await saveTo(path);
  await command('Save a copy…');
  for (let waited = 0; !existsSync(path); waited += 200) {
    if (waited > 30_000) throw new Error(`no copy saved at ${path}`);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const form = document.getForm();
  const textOf = (/** @type {string} */ field) => form.getTextField(field).getText() ?? '';
  const hidden = (/** @type {string} */ field) =>
    form
      .getTextField(field)
      .acroField.getWidgets()
      .every((widget) => (widget.dict.get(PDFName.of('F'))?.toString() ?? '0') !== '0' && widget.hasFlag(AnnotationFlags.Hidden));
  return { path, textOf, hidden };
}
const shownPage = () => page.getByRole('textbox', { name: 'Go to page' }).inputValue();
const shownZoom = () => page.locator('.m-status-zoom').first().innerText();

/** @type {Record<string, unknown>} */
const results = {};
/** Runs one named check, records its facts, and lets the walk go on past a failure. @param {string} name @param {() => Promise<Record<string, unknown>>} body */
async function check(name, body) {
  if (!wanted(name)) return;
  await step(`R22 live: ${name}`, async () => {
    const facts = await body();
    results[name] = facts;
    process.stdout.write(`      ${name}: ${JSON.stringify(facts)}\n`);
    return facts;
  });
}

await check('go to a page, in each of the three views', async () => {
  // ONE BUTTON A VIEW, each pressed from page 1 at a zoom none of the views gives, so each view's own zoom is read: three
  // steps on one button run in one press and show only the last.
  /** @type {Record<string, unknown>} */
  const views = {};
  for (const [button, view] of /** @type {const} */ ([['GoKeep', 'keep'], ['GoFit', 'fit'], ['GoWidth', 'fit-width']])) {
    await addAction(button, async (pane) => {
      await pane.getByLabel('Page', { exact: true }).fill('3');
      await pane.getByLabel('Show it').selectOption(view);
    });
    await page.getByRole('textbox', { name: 'Go to page' }).fill('1');
    await page.keyboard.press('Enter');
    await command('Zoom in');
    await page.waitForTimeout(600);
    const before = { page: await shownPage(), zoom: await shownZoom() };
    await buttonOnPage(button).click();
    await page.waitForTimeout(1000);
    const after = { page: await shownPage(), zoom: await shownZoom() };
    views[view] = { before, after };
    if (after.page !== '3') throw new Error(`${view}: the press showed page ${after.page}, not 3`);
    if (view === 'keep' && after.zoom !== before.zoom) throw new Error(`keep changed the zoom: ${JSON.stringify(views[view])}`);
    if (view !== 'keep' && after.zoom === before.zoom) throw new Error(`${view} left the zoom as it was: ${JSON.stringify(views[view])}`);
  }
  return views;
});

await check('open a web link', async () => {
  await addAction('Link', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('link');
    await pane.getByLabel('Web address').fill('https://example.org/apply');
  });
  const before = (await handed()).length;
  await buttonOnPage('Link').click();
  const question = page.getByRole('dialog', { name: 'Open this link?' });
  await question.getByRole('button', { name: 'Cancel' }).click();
  const afterCancel = (await handed()).length - before;
  await buttonOnPage('Link').click();
  await question.getByRole('button', { name: 'Open link' }).click();
  await page.waitForTimeout(800);
  const given = (await handed()).slice(before);
  if (afterCancel !== 0 || given.length !== 1 || given[0] !== 'https://example.org/apply') throw new Error(`handed to the system: ${JSON.stringify(given)} (after Cancel: ${String(afterCancel)})`);
  return { afterCancel, handed: given };
});

await check('reset the field ticked, then undo', async () => {
  await addAction('Reset', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('reset');
    await tick(pane, ['applicant.name']);
  });
  await buttonOnPage('Reset').click();
  await page.waitForTimeout(1000);
  const reset = await savedCopy('after-reset.pdf');
  const afterReset = { name: reset.textOf('applicant.name'), city: reset.textOf('applicant.city') };
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(1000);
  const undone = await savedCopy('after-reset-undone.pdf');
  const afterUndo = { name: undone.textOf('applicant.name'), city: undone.textOf('applicant.city') };
  if (afterReset.name !== '' || afterReset.city !== 'Paris') throw new Error(`after the reset: ${JSON.stringify(afterReset)}`);
  if (afterUndo.name !== 'Ada') throw new Error(`after the undo: ${JSON.stringify(afterUndo)}`);
  return { afterReset, afterUndo };
});

await check('hide a field, save, reopen', async () => {
  await addAction('Hide', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('showHide');
    await tick(pane, ['applicant.city'], false);
    await pane.getByLabel('Hide them').check();
  });
  await buttonOnPage('Hide').click();
  await page.waitForTimeout(1000);
  const copy = await savedCopy('after-hide.pdf');
  const hiddenInFile = { city: copy.hidden('applicant.city'), name: copy.hidden('applicant.name') };
  await walk.open(copy.path);
  await page.waitForTimeout(1500);
  const layer = page.locator('[data-document-layer="active"] [data-form-layer="0"]');
  const reopened = {
    cityControls: await layer.getByRole('button', { name: /applicant\.city/u }).count(),
    nameControls: await layer.getByRole('button', { name: /applicant\.name/u }).count(),
  };
  // BACK TO THE FORM for the steps after.
  await page.locator('.m-tab').filter({ hasText: 'buttons.pdf' }).first().click();
  if (!hiddenInFile.city || hiddenInFile.name) throw new Error(`hidden in the saved file: ${JSON.stringify(hiddenInFile)}`);
  if (reopened.cityControls !== 0 || reopened.nameControls === 0) throw new Error(`reopened: ${JSON.stringify(reopened)}`);
  return { hiddenInFile, reopened };
});

await check('print, cancelled', async () => {
  await addAction('Print', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('print');
  });
  await buttonOnPage('Print').click();
  const dialog = page.getByRole('dialog', { name: 'Print', exact: true });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  return { printOpened: true, cancelled: true };
});

await check('import form data, then a step after it', async () => {
  await addAction('Import', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('importData');
    await pane.getByLabel('File name for other PDF readers').fill('answers.fdf');
  });
  // THE STEP AFTER empties the city, which no later check reads: emptying the notes took the long text the long mail needs
  // (measured, the full run of 08:24).
  await addAction('Import', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('reset');
    await tick(pane, ['applicant.city']);
  });
  await pickFiles([fdfPath]);
  await buttonOnPage('Import').click();
  await page.waitForTimeout(2500);
  const copy = await savedCopy('after-import.pdf');
  const read = { name: copy.textOf('applicant.name'), city: copy.textOf('applicant.city') };
  if (read.name !== 'Grace' || read.city !== '') throw new Error(`after the import and the reset: ${JSON.stringify(read)}`);
  return read;
});

/** Sets a submit action and presses it, answering Send. @param {string} name @param {string} address @param {string[]} fields */
async function submit(name, address, fields) {
  await addAction(name, async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('submit');
    await pane.getByLabel('Send to').fill(address);
    await pane.getByLabel('Send as').selectOption('html');
    await tick(pane, fields);
  });
  await buttonOnPage(name).click();
  const dialog = page.getByRole('dialog', { name: 'Send this form?' });
  await dialog.waitFor({ timeout: 15_000 });
  // THE QUESTION'S OWN ANSWER for each kind of address: a mail address opens the mail app and sends nothing itself.
  await dialog.getByRole('button', { name: address.startsWith('mailto:') ? 'Open in mail app' : 'Send', exact: true }).click();
  await page.waitForTimeout(2500);
  const said = await page.locator('.m-toast, [role="dialog"], [role="alert"]').allInnerTexts();
  for (const open of await page.getByRole('dialog').all()) {
    const ok = open.getByRole('button', { name: /^(OK|Close)$/u });
    if ((await ok.count()) > 0) await ok.first().click();
  }
  return said.map((text) => text.replaceAll(/\s+/gu, ' ').trim()).filter((text) => text !== '');
}

await check('submit to https on this machine is refused, and nothing arrives', async () => {
  // A SOCKET ON THIS MACHINE that counts what reaches it: the guard refuses before connecting, so it must count none.
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const said = await submit('SubmitLocal', `https://localhost:${String(port)}/take`, ['applicant.name']);
  server.close();
  if (connections !== 0) throw new Error(`${String(connections)} connections reached this machine`);
  return { port, connections, said };
});

await check('submit to a 192.168 address is refused', async () => {
  const said = await submit('SubmitPrivate', 'https://192.168.1.20/take', ['applicant.name']);
  if (said.some((text) => /was sent/u.test(text))) throw new Error(`said it was sent: ${JSON.stringify(said)}`);
  return { said };
});

await check('submit by mail, short: the data in the message', async () => {
  // WHAT THE FIELD HOLDS NOW, read from a saved copy: earlier checks change it (the import names Grace).
  const name = (await savedCopy('before-mail.pdf')).textOf('applicant.name');
  const before = (await handed()).length;
  const said = await submit('MailShort', 'mailto:forms@example.org', ['applicant.name']);
  const given = (await handed()).slice(before);
  const address = given[0] ?? '';
  if (given.length !== 1 || !address.startsWith('mailto:forms@example.org') || !decodeURIComponent(address).includes(`applicant.name=${name}`)) {
    throw new Error(`handed to the system: ${JSON.stringify(given)}`);
  }
  return { handed: given, said };
});

await check('submit by mail, long: the message without the data, and Export form data saves it', async () => {
  const before = (await handed()).length;
  const exported = join(output, 'mail-long-export.html');
  await saveTo(exported);
  const said = await submit('MailLong', 'mailto:forms@example.org', ['applicant.notes']);
  const given = (await handed()).slice(before);
  for (let waited = 0; !existsSync(exported) && waited < 15_000; waited += 300) await page.waitForTimeout(300);
  const saved = existsSync(exported) ? (await readFile(exported, 'utf8')).length : 0;
  if (given.length !== 1 || (given[0] ?? '').length > 2100 || saved === 0) throw new Error(`handed ${JSON.stringify(given)}, exported ${String(saved)} characters`);
  return { handed: given, exportedCharacters: saved, said };
});

/** Sets Open a file and presses it, answering Open. @param {string} name @param {string} file */
async function openFile(name, file) {
  await addAction(name, async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('openFile');
    await pane.getByLabel('PDF in the same folder').fill(file);
  });
  await buttonOnPage(name).click();
  const dialog = page.getByRole('dialog', { name: 'Open this file?' });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForTimeout(2500);
}

await check('open a file beside the document', async () => {
  await openFile('OpenFile', 'Guide.pdf');
  const tab = await page.locator('.m-tab').filter({ hasText: 'Guide.pdf' }).count();
  await page.locator('.m-tab').filter({ hasText: 'buttons.pdf' }).first().click();
  if (tab !== 1) throw new Error(`${String(tab)} tabs named Guide.pdf`);
  return { tab };
});

await check('open a file that is not there', async () => {
  await openFile('OpenMissing', 'Missing.pdf');
  const said = await page.getByText('That file could not be opened. It may have been moved, renamed or deleted.').count();
  if (said === 0) throw new Error('the missing file was not said');
  // ITS SENTENCE IS A DIALOG, put down before the next step: left open, its backdrop took the next press (measured).
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 });
  return { said };
});

await check('several actions in order: reset, go to page 2, hide', async () => {
  await addAction('Several', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('reset');
    await tick(pane, ['applicant.name']);
  });
  await addAction('Several', async (pane) => {
    await pane.getByLabel('Page', { exact: true }).fill('2');
  });
  await addAction('Several', async (pane) => {
    await pane.getByLabel('Do', { exact: true }).selectOption('showHide');
    await tick(pane, ['applicant.notes'], false);
    await pane.getByLabel('Hide them').check();
  });
  await page.getByRole('textbox', { name: 'Go to page' }).fill('1');
  await page.keyboard.press('Enter');
  await buttonOnPage('Several').click();
  await page.waitForTimeout(2000);
  const shown = await shownPage();
  const copy = await savedCopy('after-several.pdf');
  const read = { page: shown, name: copy.textOf('applicant.name'), notesHidden: copy.hidden('applicant.notes') };
  if (read.page !== '2' || read.name !== '' || !read.notesHidden) throw new Error(`after the press: ${JSON.stringify(read)}`);
  return read;
});

await writeFile(join(output, 'buttonActions.json'), `${JSON.stringify(results, null, 2)}\n`);
await finish();
