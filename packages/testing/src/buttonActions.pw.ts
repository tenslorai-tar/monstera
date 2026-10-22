import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { ButtonStep } from '@monstera/contract';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { openSection, runCommand } from './helpScreensHarness.js';
import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * A push button's actions (ADR-0259), through the real application on the pinned Chromium: set in Properties, then
 * pressed while filling. What is read is what was SENT — the edit that writes the list, the read a press makes, and the
 * command naming the step — because the shim's kernel is stubbed: the reset itself is `buttonActions.test.ts`' kernel
 * case, which this pairs with (CLAUDE.md's wired-tools rule).
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000a1');
const NAME_RECT = { x0: 180, y0: 626, x1: 520, y1: 646 } as const;
const BUTTON_RECT = { x0: 180, y0: 560, x1: 280, y1: 584 } as const;

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  form.createTextField('applicant.name').addToPage(page, { x: 180, y: 626, width: 340, height: 20, font });
  form.createButton('Clear').addToPage('Clear', page, { x: 180, y: 560, width: 100, height: 24, font });
  // TWO MORE PAGES, for a go-to to land on.
  document.addPage([612, 792]);
  document.addPage([612, 792]);
  return document.save();
}

const NAME: ShimFormField = {
  index: 0,
  page: 0,
  kind: 'text',
  name: 'applicant.name',
  values: ['Ada'],
  on: null,
  options: [],
  readOnly: false,
  multiline: false,
  rect: NAME_RECT,
};
const BUTTON: ShimFormField = { ...NAME, index: 1, kind: 'button', name: 'Clear', values: [], rect: BUTTON_RECT };

type Sent = { channel: string; params: unknown }[];

async function openForm(
  page: Page,
  sent: Sent,
  buttonSteps: Readonly<Record<string, readonly ButtonStep[]>> = {},
  look: Look = LOOKS[0],
): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [[NAME, BUTTON]],
      buttonSteps,
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  await openSection(page, 'Forms');
}

/** Selects the button from the Fields list and answers its Properties pane. */
async function buttonProperties(page: Page): Promise<Locator> {
  await runCommand(page, 'Fields list');
  await page.locator('.m-forms-jump', { hasText: 'Clear' }).click();
  const pane = page.locator('[data-field-properties]');
  await expect(pane.getByRole('group', { name: 'Actions' })).toBeVisible();
  return pane;
}

const executed = (sent: Sent): unknown[] =>
  sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { command: unknown }).command);

/**
 * Whether a drop-down draws its longest choice whole: its box at least as wide as the words in its own font, its padding
 * and the arrow's room. A cut face is what the owner saw (*"Reset the▾"*), and a select has no overflow to read, so the
 * words are measured.
 */
async function showsWholeChoice(select: Locator): Promise<boolean> {
  return select.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('not a drop-down');
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('no canvas to measure with');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const widest = Math.max(...[...element.options].map((option) => context.measureText(option.text).width));
    const arrow = 16;
    const room = element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - arrow;
    return room >= widest;
  });
}

test.describe('a push button’s actions', () => {
  test('Reset the form: set in Properties for the field ticked, then a press sends the reset BY ITS STEP', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await expect(pane.getByText(/does nothing yet/u)).toBeVisible();

    await pane.getByRole('button', { name: 'Add action' }).click();
    // THE FACE IS WHOLE: the drop-downs draw their longest choice, where the number box's width cut "Reset the▾".
    expect(await showsWholeChoice(pane.getByLabel('Do', { exact: true }))).toBe(true);
    expect(await showsWholeChoice(pane.getByLabel('When'))).toBe(true);
    await pane.getByLabel('Do', { exact: true }).selectOption('reset');
    await pane.getByLabel('Only the fields ticked below').check();
    await pane.getByRole('checkbox', { name: 'applicant.name' }).check();
    await pane.getByRole('button', { name: 'Save action' }).click();
    const action = { trigger: 'up', action: { kind: 'reset', fields: ['applicant.name'] } };
    expect(executed(sent)).toStrictEqual([
      { kind: 'editFormFields', edits: [{ field: { page: 0, index: 1, name: 'Clear' }, set: { buttonActions: [action] } }], version: 1 },
    ]);
    // READ BACK at the version the edit produced, as the document now holds it.
    await expect(pane.getByText('Pressed and let go: Reset 1 field')).toBeVisible();

    // FILLING: a press on the button reads its steps and sends the reset naming the step, never the fields.
    await page.locator('[data-form-field="1"]').click();
    await expect.poll(() => executed(sent).length).toBe(2);
    expect(executed(sent)[1]).toStrictEqual({ kind: 'resetForm', page: 0, index: 1, trigger: 'up', step: 0, version: 2 });
    expect(sent.some((call) => call.channel === 'document.buttonActions')).toBe(true);
  });

  test('Go to a page: set in Properties, then a press shows that page, and sends nothing to the document', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await pane.getByRole('button', { name: 'Add action' }).click();
    // GO TO A PAGE IS THE FIRST KIND, the owner's order.
    await expect(pane.getByLabel('Do', { exact: true })).toHaveValue('goTo');
    await pane.getByLabel('Page', { exact: true }).fill('3');
    await pane.getByLabel('Show it').selectOption('fit');
    await pane.getByRole('button', { name: 'Save action' }).click();
    expect(executed(sent)).toStrictEqual([
      {
        kind: 'editFormFields',
        edits: [
          { field: { page: 0, index: 1, name: 'Clear' }, set: { buttonActions: [{ trigger: 'up', action: { kind: 'goTo', page: 2, view: 'fit', at: null } }] } },
        ],
        version: 1,
      },
    ]);
    await expect(pane.getByText('Pressed and let go: Go to page 3')).toBeVisible();

    const shown = page.getByRole('textbox', { name: 'Go to page' });
    // CONTROL: the reader is on page 1 before the press.
    await expect(shown).toHaveValue('1');
    await page.locator('[data-form-field="1"]').click();
    await expect(shown).toHaveValue('3');
    // A PAGE SHOWN IS NOT A CHANGE TO THE DOCUMENT: no command beyond the edit.
    expect(executed(sent)).toHaveLength(1);
  });

  test('Open a web link: set in Properties, then a press asks first, naming the address, and only Open link sends', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await pane.getByRole('button', { name: 'Add action' }).click();
    await pane.getByLabel('Do', { exact: true }).selectOption('link');
    const address = pane.getByLabel('Web address');
    // CONTROL: an address that is not a whole https one is said, and Save waits.
    await address.fill('http://example.org/apply');
    await expect(pane.getByText(/starts with https:\/\//u)).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Save action' })).toBeDisabled();
    await address.fill('https://example.org/apply');
    await pane.getByRole('button', { name: 'Save action' }).click();
    expect(executed(sent)).toStrictEqual([
      {
        kind: 'editFormFields',
        edits: [
          {
            field: { page: 0, index: 1, name: 'Clear' },
            set: { buttonActions: [{ trigger: 'up', action: { kind: 'link', address: 'https://example.org/apply' } }] },
          },
        ],
        version: 1,
      },
    ]);
    await expect(pane.getByText('Pressed and let go: Open https://example.org/apply')).toBeVisible();

    const opens = (): unknown[] => sent.filter((call) => call.channel === 'document.openButtonLink').map((call) => call.params);
    // CANCEL FIRST: the question is asked and nothing is sent.
    await page.locator('[data-form-field="1"]').click();
    const question = page.getByRole('dialog', { name: 'Open this link?' });
    await expect(question).toContainText('https://example.org/apply');
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    // THEN AGREE: one request, naming the step and never the address. Read after it, the cancel above sent nothing.
    await page.locator('[data-form-field="1"]').click();
    await question.getByRole('button', { name: 'Open link' }).click();
    await expect.poll(() => opens().length).toBe(1);
    expect(opens()).toStrictEqual([
      { docId: ID, version: 2, field: { page: 0, index: 1, name: 'Clear' }, trigger: 'up', step: 0 },
    ]);
  });

  test('Print the document: set in Properties, then a press opens the application’s Print, and only its button prints', async ({
    page,
  }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await pane.getByRole('button', { name: 'Add action' }).click();
    await pane.getByLabel('Do', { exact: true }).selectOption('print');
    await pane.getByRole('button', { name: 'Save action' }).click();
    expect(executed(sent)).toStrictEqual([
      {
        kind: 'editFormFields',
        edits: [{ field: { page: 0, index: 1, name: 'Clear' }, set: { buttonActions: [{ trigger: 'up', action: { kind: 'print' } }] } }],
        version: 1,
      },
    ]);
    await expect(pane.getByText('Pressed and let go: Print the document')).toBeVisible();

    const prints = (): unknown[] => sent.filter((call) => call.channel === 'document.print').map((call) => call.params);
    const dialog = page.getByRole('dialog', { name: 'Print', exact: true });
    // CANCEL FIRST: the Print window is the question, and closing it prints nothing.
    await page.locator('[data-form-field="1"]').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // THEN PRINT: exactly one request, for the document's every page (one range, 0 to 2), read after it.
    await page.locator('[data-form-field="1"]').click();
    await dialog.getByRole('button', { name: 'Choose a printer…' }).click();
    await expect.poll(() => prints().length).toBe(1);
    expect(prints()[0]).toMatchObject({ docId: ID, pages: [[0, 2]] });
  });

  test('Import form data: set in Properties with a file name, then a press opens the application’s import, which picks', async ({
    page,
  }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await pane.getByRole('button', { name: 'Add action' }).click();
    await pane.getByLabel('Do', { exact: true }).selectOption('importData');
    const file = pane.getByLabel('File name for other PDF readers');
    const save = pane.getByRole('button', { name: 'Save action' });
    // CONTROL: a name with a folder in it is said and cannot be saved, so the one saved below is the one typed.
    await file.fill('C:\\answers.fdf');
    await expect(pane.getByText('Type one file name, with no folder in it.')).toBeVisible();
    await expect(save).toBeDisabled();
    await file.fill('answers.fdf');
    await save.click();
    expect(executed(sent)).toStrictEqual([
      {
        kind: 'editFormFields',
        edits: [
          {
            field: { page: 0, index: 1, name: 'Clear' },
            set: { buttonActions: [{ trigger: 'up', action: { kind: 'importData', file: 'answers.fdf' } }] },
          },
        ],
        version: 1,
      },
    ]);
    await expect(pane.getByText('Pressed and let go: Import form data')).toBeVisible();

    const imports = (): unknown[] => sent.filter((call) => call.channel === 'document.importFormData').map((call) => call.params);
    expect(imports()).toStrictEqual([]);
    await page.locator('[data-form-field="1"]').click();
    // THE APPLICATION'S IMPORT, whose picker is main's: the request names the format, never the file the document holds.
    await expect.poll(() => imports().length).toBe(1);
    expect(imports()[0]).toStrictEqual({ docId: ID, format: 'fdf' });
  });

  /**
   * Pressed, then the text field filled: the fill is what arrives, so "nothing else was sent" is read after something
   * that WAS, never as an absence that waiting longer might have changed.
   */
  async function pressThenFill(page: Page): Promise<void> {
    await page.locator('[data-form-field="1"]').click();
    await page.locator('[data-form-field="0"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Grace');
    await page.keyboard.press('Enter');
  }

  test('CONTROL: a button with no actions sends nothing when pressed', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    await pressThenFill(page);
    await expect.poll(() => executed(sent).length).toBe(1);
    expect(executed(sent)[0]).toMatchObject({ kind: 'fillFormField', index: 0 });
    expect(sent.some((call) => call.channel === 'document.buttonActions')).toBe(false);
  });

  test('CONTROL: a button holding a script says so, and sends nothing', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent, { Clear: [{ trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'JavaScript', runsAs: null } }] });
    await page.locator('[data-form-field="1"]').click();
    await expect(page.locator('.m-page-field-problem [role="alert"]')).toContainText('never runs a script');
    await pressThenFill(page);
    await expect.poll(() => executed(sent).length).toBe(1);
    expect(executed(sent)[0]).toMatchObject({ kind: 'fillFormField', index: 0 });
  });

  for (const look of LOOKS) {
    test(`the list and its editor pass the accessibility gate — ${look.name}`, async ({ page }) => {
      const sent: Sent = [];
      await openForm(page, sent, { Clear: [{ trigger: 'up', step: 0, action: { kind: 'reset', fields: null } }] }, look);
      const pane = await buttonProperties(page);
      await expect(pane.getByText('Pressed and let go: Reset every field')).toBeVisible();
      await pane.getByRole('button', { name: 'Add action' }).click();
      await pane.getByLabel('Do', { exact: true }).selectOption('reset');
      await pane.getByLabel('Only the fields ticked below').check();
      const results = await new AxeBuilder({ page }).include('[data-field-properties]').analyze();
      const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
      expect(blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`)).toStrictEqual([]);
    });
  }

  test('CONTROL: the number box’s width cuts the same drop-down, so the measure above can fail', async ({ page }) => {
    const sent: Sent = [];
    await openForm(page, sent);
    const pane = await buttonProperties(page);
    await pane.getByRole('button', { name: 'Add action' }).click();
    const when = pane.getByLabel('When');
    await when.evaluate((element) => {
      element.setAttribute('class', 'm-properties__number');
    });
    expect(await showsWholeChoice(when)).toBe(false);
  });
});
