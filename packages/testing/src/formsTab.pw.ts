import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { openSection, runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * The Forms tab is for filling, and drawing a field starts only when a field tool is chosen.
 *
 * Read on pinned Chromium, since what is asked is which element takes a press on the page: the form layer's control
 * or the drawing surface laid over it (ADR-0168 puts the form layer under the surface whenever a tool is on).
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

const FIELD_RECT = { x0: 180, y0: 626, x1: 520, y1: 646 } as const;

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  page.drawText('Full name:', { x: 72, y: 631, size: 11, font });
  document.getForm().createTextField('Full name').addToPage(page, {
    x: FIELD_RECT.x0,
    y: FIELD_RECT.y0,
    width: FIELD_RECT.x1 - FIELD_RECT.x0,
    height: FIELD_RECT.y1 - FIELD_RECT.y0,
    font,
  });
  return document.save();
}

const LISTED: ShimFormField = {
  index: 0,
  page: 0,
  kind: 'text',
  name: 'Full name',
  values: [],
  on: null,
  options: [],
  readOnly: false,
  multiline: false,
  rect: FIELD_RECT,
};

async function openForms(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [[LISTED]],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
}

test.describe('the Forms tab', () => {
  test('opens able to fill: no tool is on, no drawing surface is over the page, and a press on a field fills it', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');

    await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
    await expect(page.locator('[data-form-field="0"]')).toBeVisible();
    for (const name of ['Text field', 'Tick box', 'Radio button', 'Dropdown', 'List box']) {
      const button = page.getByRole('button', { name: new RegExp(`^${name}`, 'u') }).first();
      if ((await button.count()) > 0) await expect(button).not.toHaveAttribute('aria-pressed', 'true');
    }

    // A PRESS ON THE FIELD OPENS ITS EDITOR rather than starting a drag.
    await page.locator('[data-form-field="0"]').click();
    await expect(page.locator('.m-page-field-editor')).toBeVisible();
    expect(sent.filter((call) => call.channel === 'document.execute')).toStrictEqual([]);
  });

  test('a field tool is chosen, draws one field, and the tab is back to filling', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');

    await page.getByRole('button', { name: /^Text field/u }).first().click();
    await expect(page.locator('[data-annotation-overlay]').first()).toBeAttached();
    await page.keyboard.press('Escape');
    // ESC ENDS IT: the drawing surface goes and the form layer is the top again.
    await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
  });

  test('a field tool does not outlive the Forms tab: choosing another tab and coming back leaves filling', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Text field/u }).first().click();
    await expect(page.locator('[data-annotation-overlay]').first()).toBeAttached();

    await openSection(page, 'Home');
    await openSection(page, 'Forms');
    // THE MECHANISM THIS PROVES: the tool slot is the application's, not the tab's, so a tool chosen on this tab was
    // still armed when the tab was opened again, and the drawing surface took the press a field should have.
    await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
    await page.locator('[data-form-field="0"]').click();
    await expect(page.locator('.m-page-field-editor')).toBeVisible();
  });

  /** Draws a box on the drawing surface of the first page, and names it on the page. */
  async function drawNamed(page: Page, name: string, at: readonly [number, number] = [200, 400]): Promise<void> {
    const surface = page.locator('[data-annotation-overlay="0"]');
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the drawing surface is not on screen');
    await page.mouse.move(box.x + at[0], box.y + at[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + at[0] + 140, box.y + at[1] + 30, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('textbox', { name: 'Field name' }).fill(name);
    await page.keyboard.press('Enter');
  }

  test('a field tool is spent by ONE field: the create is sent, the drawing surface goes, the page fills again', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Text field/u }).first().click();
    await drawNamed(page, 'Nickname');

    await expect
      .poll(() => sent.filter((call) => call.channel === 'document.execute').length)
      .toBe(1);
    expect((sent.find((call) => call.channel === 'document.execute')?.params as { command: { kind: string } }).command.kind).toBe(
      'createFormField',
    );
    await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
  });

  test('a DOUBLE CLICK on the button keeps the tool on for several fields, and Escape ends it', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Text field/u }).first().dblclick();
    await expect(page.locator('[data-annotation-overlay]').first()).toBeAttached();

    await drawNamed(page, 'First');
    await expect.poll(() => sent.filter((call) => call.channel === 'document.execute').length).toBe(1);
    // STILL ON after one field, which is the whole of what the double click bought.
    await expect(page.locator('[data-annotation-overlay]').first()).toBeAttached();
    await drawNamed(page, 'Second', [200, 460]);
    await expect.poll(() => sent.filter((call) => call.channel === 'document.execute').length).toBe(2);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-annotation-overlay]')).toHaveCount(0);
  });

  test('a click on a row of the Fields list selects ONE field and outlines it on the page; Escape and a press on empty paper deselect', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await runCommand(page, 'Fields list');
    // THE LIST'S ROW and not the page's control, which carries the same name.
    const row = page.locator('.m-forms-jump', { hasText: 'Full name' });
    await row.click();
    await expect(page.locator('[data-form-selected="0"]')).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-form-selected]')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-pressed', 'false');

    await row.click();
    await expect(page.locator('[data-form-selected="0"]')).toBeVisible();
    // A PRESS ON THE PAGE'S PAPER, away from any field.
    const paper = await page.locator('canvas.m-page').first().boundingBox();
    if (paper === null) throw new Error('the page is not on screen');
    // THE TOP LEFT CORNER OF THE PAPER, where this page draws nothing and has no field.
    await page.mouse.click(paper.x + 20, paper.y + 20);
    await expect(page.locator('[data-form-selected]')).toHaveCount(0);
  });

  test('a selected field shows its properties in the Properties tab, and a control sends exactly one editFormFields for it', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await runCommand(page, 'Fields list');
    await page.locator('.m-forms-jump', { hasText: 'Full name' }).click();

    const pane = page.locator('[data-field-properties]');
    await expect(pane).toBeVisible();
    // THE PANE READ THE FIELD, by its handle.
    expect(sent.filter((call) => call.channel === 'document.formFieldProperties').length).toBeGreaterThan(0);
    await pane.getByLabel('Tooltip').fill('Your full legal name');
    await pane.getByLabel('Tooltip').blur();
    const edits = sent.filter((call) => call.channel === 'document.execute');
    expect(edits.length).toBe(1);
    expect(edits[0]?.params).toMatchObject({
      docId: ID,
      command: {
        kind: 'editFormFields',
        edits: [{ field: { page: 0, index: 0, name: 'Full name' }, set: { tooltip: 'Your full legal name' } }],
      },
    });
    // AND THE SELECTION SURVIVED IT, so the next control is used on the same field.
    await expect(page.locator('[data-form-selected="0"]')).toBeVisible();
    await expect(pane).toBeVisible();
  });

  test('a name the form already has is said where it is typed, in words, and nothing is sent', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForms(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Text field/u }).first().click();
    const surface = page.locator('[data-annotation-overlay="0"]');
    const box = await surface.boundingBox();
    if (box === null) throw new Error('the drawing surface is not on screen');
    await page.mouse.move(box.x + 200, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 340, box.y + 430, { steps: 6 });
    await page.mouse.up();
    // `Full name` is the form's one field.
    await page.getByRole('textbox', { name: 'Field name' }).fill('Full name');
    await expect(page.getByText('This form already has a field with that name. Choose another name.')).toBeVisible();
    await page.keyboard.press('Enter');
    expect(sent.filter((call) => call.channel === 'document.execute')).toStrictEqual([]);
  });
});
