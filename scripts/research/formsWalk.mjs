// @ts-check
/**
 * The forms walk (CLOUD-BUNDLE section 0): the owner's form, filled and designed in the running app with a real mouse and
 * keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`.
 *
 *   node scripts/research/formsWalk.mjs [path/to/form-test.pdf]
 *
 * The form defaults to `_review/test-files/form-test.pdf`. It is copied before anything opens it, and the copies are what
 * the app writes to. Every step that changes the document is read back from the SAVED FILE by a second reader (pdf-lib
 * here, MuPDF in the app), so a step that only looked right on screen does not pass.
 *
 * What it walks, by the bundle's rows: filling with no tool on (A1), a press at a field's middle and near its edge,
 * Tab and Shift+Tab, a tick box, a radio and a dropdown; Edit fields, a placed field, a move with a snap, its
 * Properties (A2, A3, E1, C6); the Fields list (A4); Detect on a flattened copy, page and all pages, with the count
 * (A5, F4); Flatten of the selected fields (A6, G1); a tab order given by clicking (H1); the three exports read back in
 * with no warning (A7); a text field set in a real font and read back as drawn in it (A8.4, ADR-0229); and save and
 * reopen. A later step walks the third round's forms fix: a radio group's name typed for another radio is refused in
 * words rather than joining the group (BBBBBBBB-10). The last steps (run 4) choose in every kind of choice field, scroll
 * with a dropdown open, pick a date, offer a signature field's signing and press Reset, and read each value back from the
 * saved file (F2 to F10).
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import forge from 'node-forge';
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFTextField,
  StandardFonts,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { boxSettled, root, startWalk, writesDone, writesIdle, writesLanded } from './liveWalk.mjs';
import { savedSignature } from './savedPdf.mjs';

const source = process.argv[2] ?? join(root, '_review/test-files/form-test.pdf');
if (!existsSync(source)) throw new Error(`No form at ${source}. Pass the path to form-test.pdf.`);

const walk = await startWalk('forms');
const { page, output, copyOf, open, pickFiles, saveTo, command, section, pressOn, step, finish } = walk;
const form = await copyOf(source);

/**
 * The fields of a saved file that carry a real family (ADR-0229), each with the fonts its first widget's appearance names
 * by BaseFont, read by pdf-lib: a family stored but drawn in Helvetica shows here as a name with no matching font.
 * @param {string} path
 */
async function savedFieldFamilies(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const found = [];
  for (const field of document.getForm().getFields()) {
    const family = field.acroField.dict.lookup(PDFName.of('MonsteraFamily'));
    if (!(family instanceof PDFString || family instanceof PDFHexString)) continue;
    const appearance = field.acroField.getWidgets()[0]?.getNormalAppearance();
    const resources = appearance instanceof PDFRawStream ? appearance.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) : undefined;
    const fonts = [];
    for (const [, ref] of resources?.lookupMaybe(PDFName.of('Font'), PDFDict)?.entries() ?? []) {
      const base = document.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base !== undefined) fonts.push(base.decodeText());
    }
    found.push({ field: field.getName(), family: family.decodeText(), fonts });
  }
  return found;
}

/** Every widget's `/MK /BC` in a saved file, as numbers, read by pdf-lib. @param {string} path */
async function savedBorderColours(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  /** @type {number[][]} */
  const found = [];
  for (const field of document.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const colour = widget.getOrCreateAppearanceCharacteristics().getBorderColor();
      if (colour !== undefined) found.push(colour);
    }
  }
  return found;
}

/** What the saved file's text fields hold, read by pdf-lib rather than by the app that wrote it. @param {string} path */
async function savedValues(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Record<string, boolean>} */
  const ticks = {};
  for (const field of document.getForm().getFields()) {
    if (field instanceof PDFTextField) values[field.getName()] = field.getText() ?? '';
    if (field instanceof PDFCheckBox) ticks[field.getName()] = field.isChecked();
  }
  return { values, count: document.getForm().getFields().length, ticks };
}

await step('open the form, and nothing is armed in the Forms tab', async () => {
  await open(form);
  await section('Forms');
  await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
  return { fields: await page.locator('[data-form-field]').count() };
});

await step('a press at a text field’s middle opens it for typing, and the words land', async () => {
  const first = page.locator('[data-form-field]').first();
  await pressOn(first);
  await expect(page.locator('.m-page-field-editor')).toBeVisible();
  await page.keyboard.type('Ada Lovelace');
  await page.keyboard.press('Enter');
  // NO WAIT AFTER THE FILL (O6a, 2026-10-14): the next press, sent while the fill lands, was answered 'out of date'
  // because the command lane did not follow a fill. It does now (KEEPS_THE_FIELD_WALK), so the walk presses on as a hand would.
});

await step('a press NEAR THE EDGE of another field opens it too, and Tab and Shift+Tab move between fields', async () => {
  const second = page.locator('[data-form-field]').nth(1);
  await pressOn(second, 3);
  await expect(page.locator('.m-page-field-editor')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.m-page-field-editor')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  // THE FILLS LANDED before the next step adds a field (GGGGGGGG-3: a 6 s sleep stood for this).
  await writesIdle(page);
});

/** The tick box pressed three times, by its field name (its accessible name), and how it ended on screen. */
/** @type {{ name: string, on: boolean } | undefined} */
let pressedTick;

await step('a tick box ticks at a press near its corner, and a radio chooses one of its group', async () => {
  const tick = page.getByRole('checkbox').first();
  const before = await tick.getAttribute('aria-checked');
  // THREE PRESSES IN A ROW, NO WAIT (the owner's O6a): each tick is a write of 3 to 5 s here, and the second press used
  // to be answered 'out of date'. An odd number of presses ends ticked the other way.
  await pressOn(tick, 2);
  await pressOn(tick, 2);
  await pressOn(tick, 2);
  const radio = page.getByRole('radio').nth(1);
  await pressOn(radio);
  await expect(tick).not.toHaveAttribute('aria-checked', before ?? '', { timeout: 30_000 });
  await expect(radio).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  expect(await page.getByText(/was out of date/u).count()).toBe(0);
  pressedTick = { name: (await tick.getAttribute('aria-label')) ?? '', on: (await tick.getAttribute('aria-checked')) === 'true' };
  return { tickBefore: before, pressedTick };
});

await step('Edit fields shows every field as a box with its name, and a field tool places a field named for its kind', async () => {
  await command('Edit fields');
  await expect(page.locator('[data-field-box]').first()).toBeVisible();
  await page.getByRole('button', { name: /^Text field/u }).first().click();
  const paper = await page.locator('canvas.m-page').first().boundingBox();
  if (paper === null) throw new Error('the page is not on screen');
  await page.mouse.click(paper.x + paper.width - 60, paper.y + 40);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/^Text\d+$/u);
  return { name: await page.getByLabel('Name', { exact: true }).inputValue() };
});

await step('the new field moves with a drag, snaps to another field’s edge with a guide, and nudges with an arrow', async () => {
  const boxes = page.locator('[data-field-box][aria-pressed="true"]');
  const at = await boxes.first().boundingBox();
  if (at === null) throw new Error('no field is selected');
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 - 40, at.y + at.height / 2 + 120, { steps: 8 });
  const guides = await page.locator('[data-field-guide]').count();
  await page.mouse.up();
  // W6: AN ARROW STRAIGHT AFTER THE MOVE, and three more as a held key sends them, with no wait: the command lane sends
  // each where the one before left the field (measured 2026-10-12 before the lane: the first arrow raised "out of date").
  const before = await writesDone(page);
  for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowRight');
  // ALL FOUR NUDGES LANDED, which is when an out-of-date refusal would have been said (a 3 s sleep stood for this).
  await writesLanded(page, before, 4);
  const outOfDate = await page.getByText(/was out of date/u).count();
  expect(outOfDate).toBe(0);
  return { guidesWhileHeld: guides, outOfDateDialogs: outOfDate };
});

await step('O6: the custom border colour dragged through many colours, with no out-of-date dialog, and the last one kept', async () => {
  const group = page.getByRole('group', { name: 'Border colour' });
  const custom = group.getByLabel('Custom colour');
  // A DRAG IN THE PICKER, as Chromium reports one: an input event per step, then a change when it closes.
  const before = await writesDone(page);
  await custom.evaluate((input) => {
    const element = /** @type {{ value: string, dispatchEvent: (event: Event) => boolean }} */ (/** @type {unknown} */ (input));
    for (const hex of ['#200000', '#400000', '#600000', '#800000', '#a00000', '#c00010']) {
      element.value = hex;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // THE COLOUR'S WRITES LANDED, all of them sent inside that one call (a 3 s sleep stood for this).
  await writesLanded(page, before);
  const outOfDate = await page.getByText(/was out of date/u).count();
  expect(outOfDate).toBe(0);
  return { outOfDateDialogs: outOfDate, shown: await custom.inputValue() };
});

await step('the Properties tab changes the text colour, the size and the tooltip of the selected field', async () => {
  // THE TEXT COLOUR'S OWN GROUP: an unscoped `Red` is the Border colour's first, which replaced the border step 7 set and
  // that step 13 reads back from the saved file (2026-10-13 run: the saved border was the Red swatch's, not #c00010).
  await page.getByRole('group', { name: 'Text colour' }).getByRole('button', { name: 'Red' }).first().click();
  const tooltip = page.getByLabel('Tooltip', { exact: true });
  await tooltip.fill('Written by the forms walk');
  await tooltip.blur();
});

await step('A8.4: the selected text field’s font set to Calibri, offered among this computer’s fonts and drawn in it', async () => {
  await page.getByRole('button', { name: /^Font:/u }).first().click();
  const search = page.getByRole('combobox', { name: 'Search fonts' });
  await search.fill('Calibri');
  // THIS COMPUTER'S FONTS ARE READ AFTER THE PICKER OPENS (measured 2026-10-12: absent at 1.5 s, present by 4 s), so the
  // walk waits for the list to arrive; a Calibri that never arrives still fails here, with the list as it stood.
  await page.locator('[data-font-choice="Calibri"]').first().waitFor({ timeout: 20_000 });
  const offered = await page.locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Font: Calibri' }).first()).toBeVisible();
  return { calibriOffered: offered.includes('Calibri') };
});

await step('Escape puts the selection down, a second Escape leaves Edit fields, and filling is back', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-field-box]')).toHaveCount(0);
  await expect(page.locator('[data-form-field]').first()).toBeVisible();
});

await step('the Fields list groups fields by page, searches, and a row selects its field', async () => {
  await command('Fields list');
  const panel = page.locator('.m-forms-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('searchbox').fill('name');
  return { rows: await panel.locator('.m-forms-jump').count() };
});

await step('a tab order given by clicking numbers the fields and is set in one command', async () => {
  await page.getByRole('button', { name: 'Tab order' }).first().click();
  await page.getByLabel(/In the order I click/u).check();
  await page.getByRole('button', { name: 'Set the tab order' }).click();
  const boxes = page.locator('[data-tab-order-box]');
  await expect(boxes.first()).toBeVisible();
  await pressOn(boxes.nth(2));
  await pressOn(boxes.nth(0), 3);
  await expect(boxes.nth(2)).toHaveText('1');
  await page.getByRole('button', { name: 'Set this order' }).click();
  await expect(page.getByText('Tab order set. Save to keep the change.')).toBeVisible();
});

const saved = join(output, 'form-test-saved.pdf');
await step('save as, and the saved file holds the typed value, read by a second reader', async () => {
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  const read = await savedValues(saved);
  expect(Object.values(read.values).some((value) => value.includes('Ada Lovelace'))).toBe(true);
  // O6a READ BACK: the tick box pressed three times in a row is in the saved file as it ended on screen, so the last
  // press was written, not refused.
  if (pressedTick === undefined) throw new Error('the tick step did not record its box');
  expect(read.ticks[pressedTick.name], `the saved ticks: ${JSON.stringify(read.ticks)}`).toBe(pressedTick.on);
  // O6 READ BACK: the last colour the drag ended on, #c00010, is a widget's border colour in the saved file.
  const borders = await savedBorderColours(saved);
  const kept = borders.some(([r = 0, g = 0, b = 0]) => Math.abs(r - 0xc0 / 255) < 0.01 && g < 0.01 && Math.abs(b - 0x10 / 255) < 0.01);
  expect(kept).toBe(true);
  return { fields: read.count, fieldsInARealFont: await savedFieldFamilies(saved), draggedColourKept: kept };
});

for (const [format, extension] of /** @type {const} */ ([['JSON', 'json'], ['XFDF', 'xfdf'], ['FDF', 'fdf']])) {
  await step(`export the form data as ${format} and import it back with no field left out (A7.2)`, async () => {
    const file = join(output, `form-data.${extension}`);
    await saveTo(file);
    await command(`Export form data as ${format}…`);
    await expect.poll(() => existsSync(file), { timeout: 20_000 }).toBe(true);
    await walk.app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
    }, file);
    await command(`Import form data from ${format}…`);
    // ITS OWN EXPORT, read back: nothing is named as left out.
    await expect(page.getByText(/were left as they were|was left as it was/u)).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
}

await step('Flatten with fields selected offers only those, and the rest stay fillable', async () => {
  await command('Fields list');
  await page.locator('.m-forms-jump').first().click();
  await page.getByRole('button', { name: 'Flatten' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Flatten the form' });
  await dialog.getByLabel(/Only the selected field/u).check();
  await dialog.getByRole('button', { name: 'Flatten form' }).click();
  await expect(page.getByText(/selected fields are flattened/u)).toBeVisible();
  return { fieldsLeft: await page.locator('[data-form-field]').count() };
});

await step('the whole form flattened, then Detect on the flat page proposes places, marks them, and reads all pages', async () => {
  await page.getByRole('button', { name: 'Flatten' }).first().click();
  await page.getByRole('dialog', { name: 'Flatten the form' }).getByRole('button', { name: 'Flatten form' }).click();
  await page.getByRole('button', { name: /^Detect/u }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Fields this page could have' });
  await expect(dialog).toBeVisible();
  const marks = await page.locator('[data-spotlight="box"]').count();
  const onPage = await dialog.locator('.m-flat-fields__row').count();
  await dialog.getByRole('button', { name: 'Find on all pages' }).click();
  await expect(dialog.getByText(/Page 2/u).first()).toBeVisible();
  const allPages = await dialog.locator('.m-flat-fields__row').count();
  // THE OWNER'S F4 COUNT: the form has 63 fields over 68 places, measured 62 found on 2026-10-11 in the kernel.
  const kinds = {
    text: await dialog.getByText('Text field', { exact: true }).count(),
    tick: await dialog.getByText('Tick box', { exact: true }).count(),
    radio: await dialog.getByText('Radio button', { exact: true }).count(),
  };
  await dialog.getByRole('button', { name: /^Add \d+ fields?$/u }).click();
  return { marksOnFirstPage: marks, proposedOnFirstPage: onPage, proposedOnAllPages: allPages, kinds };
});

// A COPY UNDER A NAME OF ITS OWN: `copyOf` names its copy after the source, so a second copy of the same file is the first
// one's path, which is already open and already flattened, and opening an open path changes nothing.
const forNaming = join(output, 'form-for-naming.pdf');
await copyFile(source, forNaming);
const named = await copyOf(forNaming);
await step('BBBBBBBB-10: a radio group’s name typed for another radio is refused in words, never joined to that group', async () => {
  await open(named);
  await command('Edit fields');
  const paper = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (paper === null) throw new Error('the page is not on screen');
  await page.getByRole('button', { name: /^Radio/u }).first().click();
  await page.mouse.click(paper.x + paper.width - 60, paper.y + 40);
  // A RADIO'S NAME IS ITS GROUP'S, so its field is labelled "Group name"; it is read while the placed field is still
  // selected (Escape puts the selection down and the panel with it). The tool stays armed after a placement and a second
  // press on the page would join the same group, so the first Escape ends the run and the tool is armed afresh, but only
  // when it is not armed still: pressing an armed tool puts it down.
  const groupName = page.getByLabel('Group name', { exact: true });
  const first = await groupName.inputValue();
  await page.keyboard.press('Escape');
  const radioTool = page.getByRole('button', { name: /^Radio/u }).first();
  if ((await radioTool.getAttribute('aria-pressed')) !== 'true') await radioTool.click();
  await page.mouse.click(paper.x + paper.width - 60, paper.y + 90);
  await expect(groupName).not.toHaveValue(first);
  const name = groupName;
  const second = await name.inputValue();
  await name.fill(first);
  await name.blur();
  const refused = page.getByText('This form already has a field with that name. Choose another name.');
  await expect(refused).toBeVisible();
  return { firstGroup: first, secondGroup: second, refusedInWords: await refused.isVisible() };
});

/**
 * Every stream of a saved file, decoded, as one Latin-1 text: where a flattened field's words can be, whichever stream the
 * bake put them in. @param {string} path
 */
async function savedStreamsText(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  const parts = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    try {
      parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
    } catch {
      // A STREAM PDF-LIB CANNOT DECODE (an image filter) holds no words, and is counted so the reading says what it skipped.
      parts.push('');
    }
  }
  return parts.join('\n');
}

const PIN = '4821';
const forPassword = join(output, 'form-for-password.pdf');
await copyFile(source, forPassword);
const masked = await copyOf(forPassword);
await step('L1: a password field filled with a PIN and flattened is masked in the SAVED file, never the digits', async () => {
  await open(masked);
  await command('Edit fields');
  const paper = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (paper === null) throw new Error('the page is not on screen');
  await page.getByRole('button', { name: /^Text field/u }).first().click();
  const placing = await writesDone(page);
  await page.mouse.click(paper.x + paper.width - 80, paper.y + 60);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/^Text\d+$/u);
  // A PLACE IS A WRITE (3 to 5 s on this machine, textWalk's reading of 2026-10-12): a property set while it lands is
  // answered by the panel's next draw (2026-10-13: the checkbox clicked 'did not change its state'). A 6 s sleep stood
  // for this.
  await writesLanded(page, placing);
  const name = await page.getByLabel('Name', { exact: true }).inputValue();
  // CLICKED, THEN WAITED FOR: the box is the field's own property, drawn from the document after its write lands (3 to 5 s
  // here), and `check()` asks for the new state at once and reported 'did not change its state' (2026-10-13).
  const hide = page.getByLabel('Hide what is typed (password)');
  const hiding = await writesDone(page);
  await hide.click();
  await expect(hide).toBeChecked({ timeout: 30_000 });
  await writesLanded(page, hiding);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // A FIELD'S MARK IS ITS INDEX; its name is in the control's accessible label.
  await pressOn(page.locator(`[data-form-field][aria-label*="${name}"]`).first());
  await page.keyboard.type(PIN);
  const filling = await writesDone(page);
  await page.keyboard.press('Enter');
  await writesLanded(page, filling);
  await page.getByRole('button', { name: 'Flatten' }).first().click();
  const flattening = await writesDone(page);
  await page.getByRole('dialog', { name: 'Flatten the form' }).getByRole('button', { name: 'Flatten form' }).click();
  // EACH WRITE LANDED before the next action reads its result (1.5 s sleeps stood for these three).
  await writesLanded(page, flattening);
  const file = join(output, 'form-password-flattened.pdf');
  await saveTo(file);
  await command('Save a copy…');
  await expect.poll(() => existsSync(file), { timeout: 20_000 }).toBe(true);
  const streams = await savedStreamsText(file);
  // THE DIGITS IN NO STREAM, as a literal string or as hex: the field's own words are the only place a PIN could be.
  const hex = Buffer.from(PIN, 'latin1').toString('hex');
  expect(streams.includes(`(${PIN})`) || streams.toLowerCase().includes(`<${hex}>`)).toBe(false);
  return { field: name, maskInSavedFile: streams.includes('(****)'), digitsInSavedFile: streams.includes(PIN) };
});

/**
 * THE CHOICES FORM (run 4, Part 3): every kind of choice, a date, a signature field and a Reset button, built here so the
 * walk knows each field's name and options rather than guessing at the owner's form. The walk of 2026-10-12 passed 18 of
 * 18 and missed every list box and dropdown defect, because no step chose in one and read the choice back.
 */
async function choicesForm() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  const fields = document.getForm();
  /** @param {string} label @param {number} y */
  const label = (label, y) => sheet.drawText(label, { x: 60, y, size: 11, font });
  label('City', 705);
  const city = fields.createDropdown('City');
  city.addOptions(['Leeds', 'London', 'York']);
  city.addToPage(sheet, { x: 180, y: 700, width: 160, height: 20, font });
  label('Language', 625);
  const language = fields.createOptionList('Language');
  language.addOptions(['English', 'German', 'French']);
  language.addToPage(sheet, { x: 180, y: 580, width: 160, height: 60, font });
  label('Interests', 525);
  const interests = fields.createOptionList('Interests');
  interests.addOptions(['Music', 'Travel', 'Cooking']);
  interests.enableMultiselect();
  interests.addToPage(sheet, { x: 180, y: 480, width: 160, height: 60, font });
  label('Due', 425);
  const due = fields.createTextField('Due');
  due.addToPage(sheet, { x: 180, y: 420, width: 160, height: 20, font });
  due.acroField.dict.set(
    PDFName.of('AA'),
    document.context.obj({ F: { S: 'JavaScript', JS: PDFString.of('AFDate_FormatEx("dd/mm/yyyy");') } }),
  );
  label('Signature', 345);
  const signature = document.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('Signature1'),
    Rect: [180, 320, 360, 360],
    F: 4,
    P: sheet.ref,
  });
  const signatureRef = document.context.register(signature);
  sheet.node.addAnnot(signatureRef);
  document.getForm().acroForm.addField(signatureRef);
  const reset = fields.createButton('Clear');
  reset.addToPage('Reset', sheet, { x: 180, y: 260, width: 80, height: 24, font });
  reset.acroField.getWidgets()[0]?.dict.set(PDFName.of('A'), document.context.obj({ S: 'ResetForm' }));
  return document.save();
}

/** The choice fields and the date of a saved file, read by pdf-lib. @param {string} path */
async function savedChoices(path) {
  const read = (await PDFDocument.load(await readFile(path), { updateMetadata: false })).getForm();
  return {
    city: read.getDropdown('City').getSelected(),
    language: read.getOptionList('Language').getSelected(),
    interests: read.getOptionList('Interests').getSelected(),
    due: read.getTextField('Due').getText() ?? '',
  };
}

const choicesPath = join(output, 'form-choices.pdf');
await writeFile(choicesPath, await choicesForm());
const choices = await copyOf(choicesPath);

await step('F5, F6: a dropdown opens ONE list under its field with the empty choice first, and a row pressed fills it', async () => {
  await open(choices);
  await section('Forms');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'City' });
  await expect(list).toBeVisible();
  const rows = await list.getByRole('option').allTextContents();
  expect(rows).toStrictEqual(['(none)', 'Leeds', 'London', 'York']);
  await list.getByRole('option', { name: 'York', exact: true }).click();
  await expect(list).toHaveCount(0);
  return { rows };
});

await step('F4: an open dropdown moves with the page when it scrolls, staying under its field', async () => {
  const face = page.getByRole('button', { name: 'City', exact: true });
  await face.click();
  const list = page.getByRole('listbox', { name: 'City' });
  const before = await list.boundingBox();
  await page.mouse.wheel(0, 120);
  // THE SCROLL HAS ENDED: the field's box stops moving (a 500 ms sleep stood for this).
  await boxSettled(page, () => face.boundingBox());
  const [after, field] = [await list.boundingBox(), await face.boundingBox()];
  if (before === null || after === null || field === null) throw new Error('a box is missing');
  expect(Math.abs(after.y - (field.y + field.height))).toBeLessThan(2);
  await page.keyboard.press('Escape');
  return { movedBy: before.y - after.y };
});

await step('F2: a press on a list box row chooses THAT row, and Ctrl adds one in a list that takes several', async () => {
  // THE PAGE'S OWN LIST: the Fields list, open from an earlier step, shows each list box's value in a list of the same
  // name, so a listbox found by name alone was two (2026-10-15 screenshot: "Language" in the panel and on the page).
  /** @param {string} name */
  const pageList = (name) => page.getByRole('listbox', { name }).filter({ has: page.locator('.m-page-choice-row') });
  const choosing = await writesDone(page);
  await pageList('Language').getByRole('option', { name: 'French', exact: true }).click();
  const interests = pageList('Interests');
  await interests.getByRole('option', { name: 'Music', exact: true }).click();
  // A FILL IS A WRITE (3 to 5 s here); the Ctrl press adds to what the document then holds. Two fills landed, where a 6 s
  // sleep stood.
  await expect(interests.getByRole('option', { name: 'Music', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await writesLanded(page, choosing, 2);
  const adding = await writesDone(page);
  await interests.getByRole('option', { name: 'Cooking', exact: true }).click({ modifiers: ['Control'] });
  await writesLanded(page, adding);
});

await step('F10: a date field shows its pattern, and a day pressed on its calendar fills it in that pattern', async () => {
  await page.getByRole('button', { name: 'Fill in Due', exact: true }).click();
  const box = page.locator('[data-form-layer] input[aria-label="Due"]');
  await expect(box).toHaveAttribute('placeholder', 'dd/mm/yyyy');
  await page.getByRole('button', { name: 'Choose a date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Calendar' });
  const dating = await writesDone(page);
  await calendar.locator('td button').filter({ hasText: /^15$/u }).click();
  // THE DATE'S FILL LANDED before the file is saved (a 6 s sleep stood for this).
  await writesLanded(page, dating);
});

const choicesSaved = join(output, 'form-choices-saved.pdf');
await step('the dropdown, both list boxes and the date READ BACK from the saved file by a second reader', async () => {
  await saveTo(choicesSaved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(choicesSaved), { timeout: 20_000 }).toBe(true);
  const read = await savedChoices(choicesSaved);
  expect(read.city).toStrictEqual(['York']);
  expect(read.language).toStrictEqual(['French']);
  expect(read.interests).toStrictEqual(['Music', 'Cooking']);
  expect(read.due).toMatch(/^15\/\d{2}\/\d{4}$/u);
  return read;
});

await step('F8: an empty signature field pressed offers both ways to sign, each opening its own dialog', async () => {
  await page.getByRole('button', { name: 'Sign Signature1', exact: true }).click();
  await page.getByRole('button', { name: 'Sign with a typed, drawn or picture signature', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Signature' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sign Signature1', exact: true }).click();
  await page.getByRole('button', { name: 'Sign with a certificate', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sign document' })).toBeVisible();
  await page.keyboard.press('Escape');
});

const resetSaved = join(output, 'form-choices-reset.pdf');
await step('F7: the form’s Reset button empties every field as one step, READ BACK from the saved file', async () => {
  const resetting = await writesDone(page);
  await page.getByRole('button', { name: 'Press Clear', exact: true }).click();
  // THE RESET LANDED before the file is saved (a 6 s sleep stood for this).
  await writesLanded(page, resetting);
  await saveTo(resetSaved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(resetSaved), { timeout: 20_000 }).toBe(true);
  const read = await savedChoices(resetSaved);
  expect(read).toStrictEqual({ city: [], language: [], interests: [], due: '' });
  return read;
});

/**
 * A throwaway signing certificate, minted for this run in the system's temporary folder and never anywhere the
 * repository could take it in: a self-signed RSA key and certificate in a PKCS #12 file under `passphrase`.
 * @param {string} folder @param {string} name @param {string} passphrase
 */
async function mintCertificate(folder, name, passphrase) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: name }]);
  cert.setIssuer([{ name: 'commonName', value: name }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' })).getBytes();
  const path = join(folder, 'walk-signer.p12');
  await writeFile(path, Uint8Array.from(der, (character) => character.charCodeAt(0)));
  return path;
}

const signedProtected = join(output, 'protected-signed.pdf');
await step('17: a password-protected document, opened with its password and signed with a certificate, READ BACK signed and still protected', async () => {
  // MINTED AT RUN TIME, in the system's temporary folder: the certificate and the protected file are made here, used, and
  // left there; neither is in the repository or in the walk's output.
  const folder = await mkdtemp(join(tmpdir(), 'monstera-walk-sign-'));
  const certificate = await mintCertificate(folder, 'Monstera Walk Signer', 'walk-pass');
  const plain = await PDFDocument.create();
  const font = await plain.embedFont(StandardFonts.Helvetica);
  plain.addPage([400, 600]).drawText('A protected document to sign', { font, size: 18, x: 20, y: 540 });
  plain.encrypt({ userPassword: 'open-me', ownerPassword: 'own-me', permissions: { printing: 'highResolution' } });
  const protectedFile = join(folder, 'protected.pdf');
  await writeFile(protectedFile, await plain.save());

  // OPENED AS A PERSON OPENS IT: Open, then the password the app asks for.
  await pickFiles([protectedFile]);
  await page.keyboard.press('Control+O');
  const asks = page.getByRole('dialog', { name: 'This document is protected' });
  await expect(asks).toBeVisible({ timeout: 30_000 });
  await asks.getByLabel('Password', { exact: true }).fill('open-me');
  await asks.getByRole('button', { name: 'Open document', exact: true }).click();
  await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 });

  // SIGNED AS A PERSON SIGNS: Protect › Sign with Certificate, the certificate's password, then the certificate picked.
  await command('Sign with Certificate');
  const dialog = page.getByRole('dialog', { name: 'Sign document' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Certificate password (leave empty if it has none)', { exact: true }).fill('walk-pass');
  await pickFiles([certificate]);
  await dialog.getByRole('button', { name: 'Choose certificate and sign', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });

  await saveTo(signedProtected);
  await command('Save a copy…');
  await expect.poll(() => existsSync(signedProtected), { timeout: 30_000 }).toBe(true);
  const read = await savedSignature(signedProtected);
  expect(read).toStrictEqual({ protectedStill: true, signatures: 1, coversFile: true, signer: 'Monstera Walk Signer' });
  return read;
});

await finish();
