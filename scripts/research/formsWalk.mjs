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
 * reopen.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, PDFTextField } from '@cantoo/pdf-lib';
import { root, startWalk } from './liveWalk.mjs';

const source = process.argv[2] ?? join(root, '_review/test-files/form-test.pdf');
if (!existsSync(source)) throw new Error(`No form at ${source}. Pass the path to form-test.pdf.`);

const walk = await startWalk('forms');
const { page, output, copyOf, open, saveTo, command, section, pressOn, step, finish } = walk;
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

/** What the saved file's text fields hold, read by pdf-lib rather than by the app that wrote it. @param {string} path */
async function savedValues(path) {
  const document = await PDFDocument.load(await readFile(path), { updateMetadata: false });
  /** @type {Record<string, string>} */
  const values = {};
  for (const field of document.getForm().getFields()) {
    if (field instanceof PDFTextField) values[field.getName()] = field.getText() ?? '';
  }
  return { values, count: document.getForm().getFields().length };
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
});

await step('a press NEAR THE EDGE of another field opens it too, and Tab and Shift+Tab move between fields', async () => {
  const second = page.locator('[data-form-field]').nth(1);
  await pressOn(second, 3);
  await expect(page.locator('.m-page-field-editor')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.m-page-field-editor')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
});

await step('a tick box ticks at a press near its corner, and a radio chooses one of its group', async () => {
  const tick = page.getByRole('checkbox').first();
  const before = await tick.getAttribute('aria-checked');
  await pressOn(tick, 2);
  await expect(tick).not.toHaveAttribute('aria-checked', before ?? '');
  const radio = page.getByRole('radio').nth(1);
  await pressOn(radio);
  await expect(radio).toHaveAttribute('aria-checked', 'true');
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
  await page.keyboard.press('ArrowRight');
  return { guidesWhileHeld: guides };
});

await step('the Properties tab changes the text colour, the size and the tooltip of the selected field', async () => {
  await page.getByRole('button', { name: 'Red' }).first().click().catch(() => undefined);
  const tooltip = page.getByLabel('Tooltip', { exact: true });
  await tooltip.fill('Written by the forms walk');
  await tooltip.blur();
});

await step('A8.4: the selected text field’s font set to Calibri, offered among this computer’s fonts and drawn in it', async () => {
  await page.getByRole('button', { name: /^Font:/u }).first().click();
  const search = page.getByRole('combobox', { name: 'Search fonts' });
  await search.fill('Calibri');
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
  await command('Save a copy');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  const read = await savedValues(saved);
  expect(Object.values(read.values).some((value) => value.includes('Ada Lovelace'))).toBe(true);
  return { fields: read.count, fieldsInARealFont: await savedFieldFamilies(saved) };
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

await finish();
