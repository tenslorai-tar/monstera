import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { bridgeUnder, LOOKS } from './pageBridge.js';

/**
 * A form's own rules where a person fills it (ADR-0226 Decision 4), on pinned Chromium with real presses and typing: a
 * format checked on leaving the field, a length limit, a required field, a push button, a list that takes several
 * values, a dropdown that takes typing, and the light wash and red outline that show where to write.
 *
 * Each field's rectangle is written into a real AcroForm and listed to the shim from the same numbers, so the page draws
 * genuine widgets under the controls.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

const PRICE = { x0: 180, y0: 680, x1: 420, y1: 700 };
const CODE = { x0: 180, y0: 640, x1: 420, y1: 660 };
const NAME = { x0: 180, y0: 600, x1: 420, y1: 620 };
const SEND = { x0: 180, y0: 560, x1: 260, y1: 584 };
const TOPICS = { x0: 180, y0: 460, x1: 330, y1: 540 };
const TITLE = { x0: 180, y0: 420, x1: 330, y1: 440 };

type Rect = typeof PRICE;

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const at = (rect: Rect) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0, font });
  form.createTextField('Price').addToPage(page, at(PRICE));
  form.createTextField('Code').addToPage(page, at(CODE));
  const name = form.createTextField('Name');
  name.setText('Ada');
  name.addToPage(page, at(NAME));
  form.createButton('Send').addToPage('Send', page, at(SEND));
  const topics = form.createOptionList('Topics');
  topics.addOptions(['Art', 'Maths', 'Music']);
  topics.addToPage(page, at(TOPICS));
  const title = form.createDropdown('Title');
  title.addOptions(['Mr', 'Ms']);
  title.addToPage(page, at(TITLE));
  return document.save();
}

function field(index: number, over: Partial<ShimFormField>): ShimFormField {
  return { page: 0, index, kind: 'text', name: '', values: [], on: null, options: [], readOnly: false, multiline: false, rect: null, ...over };
}

const LISTED: readonly ShimFormField[] = [
  field(0, { name: 'Price', rect: PRICE, format: { kind: 'number', decimals: 2, separators: 'dot-comma', negative: 'minus' } }),
  field(1, { name: 'Code', rect: CODE, maxLength: 4 }),
  field(2, { name: 'Name', rect: NAME, values: ['Ada'], required: true }),
  field(3, { name: 'Send', kind: 'button', rect: SEND }),
  field(4, { name: 'Topics', kind: 'listbox', rect: TOPICS, options: ['Art', 'Maths', 'Music'], multiSelect: true }),
  field(5, { name: 'Title', kind: 'dropdown', rect: TITLE, options: ['Mr', 'Ms'], editable: true }),
];

type Sent = { channel: string; params: unknown }[];

const fills = (sent: Sent): unknown[] =>
  sent
    .filter((call) => call.channel === 'document.execute')
    .map((call) => (call.params as { command: { kind: string } }).command)
    .filter((command) => command.kind === 'fillFormField');

async function open(page: Page, sent: Sent, listed: readonly ShimFormField[] = LISTED): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 900 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [listed],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('[data-form-layer="0"] [data-form-field="0"]')).toBeAttached();
}

async function pointIn(page: Page, rect: Rect, fx = 0.5): Promise<{ x: number; y: number }> {
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  return { x: slot.x + (rect.x0 + (rect.x1 - rect.x0) * fx) * scale, y: slot.y + (792 - (rect.y0 + rect.y1) / 2) * scale };
}

async function press(page: Page, rect: Rect, fx = 0.5): Promise<void> {
  const at = await pointIn(page, rect, fx);
  await page.mouse.click(at.x, at.y);
}

test('a number field stores what was typed as the number, and says what it expects when it cannot read it', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await press(page, PRICE);
  await page.keyboard.type('1.234,5');
  await page.keyboard.press('Enter');
  // THE CANONICAL NUMBER, not what was typed in the field's own style: what every reader's format reads.
  await expect.poll(() => fills(sent)).toStrictEqual([{ kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: '1234.5' } }]);
  // CONTROL: no sentence for a value that fits.
  await expect(page.locator('.m-page-field-problem')).toHaveCount(0);

  await press(page, PRICE);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('cheap');
  await page.keyboard.press('Enter');
  const problem = page.locator('.m-page-field-problem [role="alert"]');
  await expect(problem).toContainText('Price expects a number, such as 1.234,50');
  // KEPT, NOT REFUSED: the value is filled as typed and the sentence says so.
  await expect.poll(() => fills(sent)).toHaveLength(2);
  expect(fills(sent)[1]).toMatchObject({ value: { set: 'text', text: 'cheap' } });
});

test('a field with a length limit takes no more than it holds, and a required field left empty says it must be filled', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await press(page, CODE);
  await page.keyboard.type('ABCDEFG');
  await page.keyboard.press('Enter');
  await expect.poll(() => fills(sent)).toStrictEqual([{ kind: 'fillFormField', page: 0, index: 1, version: 1, value: { set: 'text', text: 'ABCD' } }]);

  await press(page, NAME);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('.m-page-field-problem [role="alert"]')).toContainText('Name must be filled in.');
});

test('a push button says, when pressed, that what it is set to do is not run here', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  // NEAR THE EDGE as well as at the centre: a press anywhere on the button is the button's.
  await press(page, SEND, 0.1);
  await expect(page.locator('.m-page-field-problem [role="alert"]')).toContainText('does not run what a form’s buttons are set to do');
  expect(fills(sent)).toStrictEqual([]);
});

test('a list that takes several values is filled with every option chosen, in one fill', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await page.locator('[data-form-layer="0"] select[aria-label="Topics"]').selectOption(['Art', 'Music']);
  await expect.poll(() => fills(sent)).toStrictEqual([
    { kind: 'fillFormField', page: 0, index: 4, version: 1, value: { set: 'choices', options: ['Art', 'Music'] } },
  ]);
});

test('a dropdown that takes typing is filled with what was typed', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await press(page, TITLE);
  await page.keyboard.type('Dr');
  await page.keyboard.press('Enter');
  await expect.poll(() => fills(sent)).toStrictEqual([{ kind: 'fillFormField', page: 0, index: 5, version: 1, value: { set: 'choice', option: 'Dr' } }]);
});

test('a save with a required field still empty saves, then focuses that field with its sentence and says so', async ({ page }) => {
  const sent: Sent = [];
  // NAME IS REQUIRED AND EMPTY. The shim answers a scripted list rather than applying fills, so the empty field is in
  // the list the document opens with.
  await open(
    page,
    sent,
    LISTED.map((each) => (each.name === 'Name' ? { ...each, values: [] } : each)),
  );
  await page.keyboard.press('Control+S');
  // NEVER REFUSED: the save is sent.
  await expect.poll(() => sent.filter((call) => call.channel === 'document.save').length).toBe(1);
  await expect(page.getByText('The document was saved, and some required fields are still empty.', { exact: false })).toBeVisible();
  await expect(page.locator('[data-form-layer="0"] input[aria-label="Name"]')).toBeFocused();
  await expect(page.locator('.m-page-field-problem [role="alert"]')).toContainText('Name must be filled in.');
});

test('a save with every required field filled says nothing about them', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await page.keyboard.press('Control+S');
  await expect.poll(() => sent.filter((call) => call.channel === 'document.save').length).toBe(1);
  // CONTROL for the case above: Name holds Ada, so nothing is named and nothing moves the focus.
  await expect(page.getByText('some required fields are still empty', { exact: false })).toHaveCount(0);
  await expect(page.locator('.m-page-field-problem')).toHaveCount(0);
});

test('fields are washed and a required one outlined in red, until Highlight fields is turned off', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  const price = page.locator('[data-form-layer="0"] [data-form-field="0"]');
  const name = page.locator('[data-form-layer="0"] [data-form-field="2"]');
  await expect(price).toHaveClass(/m-page-field--tint/u);
  await expect(name).toHaveClass(/m-page-field--required/u);
  // CONTROL: a field that is not required has no red outline.
  await expect(price).not.toHaveClass(/m-page-field--required/u);
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Highlight fields');
  await page.getByRole('option').filter({ hasText: 'Highlight fields' }).first().click();
  await expect(price).not.toHaveClass(/m-page-field--tint/u);
  await expect(name).not.toHaveClass(/m-page-field--required/u);
});
