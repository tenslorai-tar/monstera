import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { openSection, runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { commandsSettled } from './settled.js';

/**
 * *Edit fields* (ADR-0226 Decision 7) with real pointer events at real places on pinned Chromium: a press selects, a drag
 * moves, a handle resizes, a drag on empty paper takes what it sweeps, and the keys are the registered commands.
 *
 * The shim answers a scripted field list and stubs the kernel, so each case asserts the COMMAND the gesture sent, and
 * the numbers in it, converted from the pixels the pointer travelled through the page's own zoom. The kernel halves are
 * `formFieldEdit.test.ts` (a rect edit and a copy to a place) and `formFields.test.ts` (a delete).
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

const NAME = { x0: 180, y0: 626, x1: 520, y1: 646 };
const EMAIL = { x0: 180, y0: 546, x1: 520, y1: 566 };

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const at = (rect: typeof NAME) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 });
  form.createTextField('Full name').addToPage(page, { ...at(NAME), font });
  form.createTextField('Email').addToPage(page, { ...at(EMAIL), font });
  return document.save();
}

function field(index: number, name: string, rect: typeof NAME): ShimFormField {
  return { page: 0, index, kind: 'text', name, values: [], on: null, options: [], readOnly: false, multiline: false, rect };
}

const LISTED: readonly ShimFormField[] = [field(0, 'Full name', NAME), field(1, 'Email', EMAIL)];

type Sent = { channel: string; params: unknown }[];

/** The commands the page sent, in order. */
const commands = (sent: Sent): unknown[] =>
  sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { command: unknown }).command);

async function open(page: Page, sent: Sent, listDelay?: number): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [LISTED],
      // MAIN'S TIME FOR A FIELD LIST, for a case about what a press does while the list a write moved is read again.
      ...(listDelay === undefined ? {} : { delays: { 'document.formFields': listDelay } }),
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

async function designing(page: Page, sent: Sent, listDelay?: number): Promise<void> {
  await open(page, sent, listDelay);
  await runCommand(page, 'Edit fields');
  await expect(page.locator('[data-field-box="0"]')).toBeVisible();
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not on screen');
  return box;
}

/** CSS pixels per point at the zoom the page is drawn at, read from the name field's box: 340 points wide. */
async function zoomOf(page: Page): Promise<number> {
  return (await boxOf(page.locator('[data-field-box="0"]'))).width / (NAME.x1 - NAME.x0);
}

/**
 * The commands sent once there are `count` of them. A command reaches `sent` through the page's exposed binding, which
 * the test process hears AFTER `mouse.up()` resolves, so a read straight after a gesture races the bridge: measured on
 * the windows runner, a drag's one command was not there yet (CI run 38207412421) while Linux had it in time.
 */
async function sentOnce(page: Page, sent: Sent, count: number): Promise<unknown[]> {
  await expect.poll(() => commands(sent).length).toBe(count);
  // AND STILL THAT MANY once nothing is in flight (DDDDDDDD-4): the poll above passes the first moment the count
  // matches, so a gesture sending a second command close behind the first passed it.
  expect(await commandsSettled(page, () => commands(sent).length, 'the commands a gesture sent')).toBe(count);
  return commands(sent);
}

async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 3 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 3 });
  await page.mouse.up();
}

test.describe('Edit fields', () => {
  test('every field is a box with its name, the fill controls are gone, and a press selects without filling', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const name = page.locator('[data-field-box="0"]');
    await expect(name).toContainText('Full name');
    await expect(page.locator('[data-form-field]')).toHaveCount(0);
    const at = await boxOf(name);
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await expect(name).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-field-box="1"]')).toHaveAttribute('aria-pressed', 'false');
    // NONE, read once settled (DDDDDDDD-4): read straight after the click it passed before any send could arrive.
    expect(await commandsSettled(page, () => commands(sent).length, 'the commands a click sent')).toBe(0);
  });

  // AN ARROW STRAIGHT AFTER A DRAG, while the field list the drag's write moved is being read again (2026-10-19). The
  // forms walk lost such presses in four gate-launched runs of nine: the selected box kept the focus and its look, and the
  // press sent nothing, because the selection was joined to the list at the version on show, which is empty until it has
  // been read. The list's read is held back three seconds here, so the press lands in that gap every time, not by chance.
  // THE CONTROL is the same arrow pressed once the list has been read again, which no gap separates from the drag.
  for (const [name, settle] of [
    ['while the list the drag moved is still being read again', 0],
    ['CONTROL: once the list has been read again', 4500],
  ] as const) {
    test(`an arrow pressed after a drag nudges the field it moved, ${name}`, async ({ page }) => {
      const sent: Sent = [];
      await designing(page, sent, 3000);
      const at = await boxOf(page.locator('[data-field-box="0"]'));
      await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: 40, y: 20 });
      await expect.poll(() => commands(sent).length).toBe(1);
      // THE CONTROL WAITS THE HELD READ OUT: a fixed wait is the case's own input here, the length of the gap it closes.
      await page.waitForTimeout(settle);
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => commands(sent).length, { timeout: 10_000 }).toBe(2);
      expect(commands(sent)[1]).toMatchObject({ kind: 'editFormFields', edits: [{ field: { page: 0, index: 0 } }] });
    });
  }

  // THE OTHER TWO READERS OF THE SAME JOIN, in the same held gap (2026-10-19): the Properties tab, where the forms walk's
  // A8.4 sets a font, and Flatten's "only the selected fields". Each timed out in the walk's gate-launched runs.
  test('the Properties tab keeps showing the selected field while the list a drag moved is read again', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent, 3000);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    const properties = page.getByRole('region', { name: 'Field properties' });
    await expect(properties).toBeVisible();
    await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: 40, y: 20 });
    await expect.poll(() => commands(sent).length).toBe(1);
    // AT ONCE, inside the three seconds the read is held: a tab that showed the form meanwhile is the defect.
    await expect(properties).toBeVisible({ timeout: 500 });
  });

  test('Flatten offers and flattens only the selected field while the list a drag moved is read again', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent, 3000);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: 40, y: 20 });
    await expect.poll(() => commands(sent).length).toBe(1);
    await page.getByRole('button', { name: 'Flatten' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Flatten the form' });
    await dialog.getByLabel(/Only the selected field/u).check({ timeout: 2000 });
    await dialog.getByRole('button', { name: 'Flatten form' }).click();
    await expect.poll(() => commands(sent).length).toBe(2);
    expect(commands(sent)[1]).toMatchObject({ kind: 'flattenFormFields', fields: [{ page: 0, index: 0 }] });
  });

  test('a drag from the CENTRE moves the field, as one editFormFields with the rect moved by the travel in points', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const zoom = await zoomOf(page);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: 40, y: 20 });
    const sentNow = await sentOnce(page, sent, 1);
    const edit = sentNow[0] as { kind: string; edits: { field: { index: number }; set: { rect: typeof NAME } }[] };
    expect(edit.kind).toBe('editFormFields');
    expect(edit.edits.map((each) => each.field.index)).toStrictEqual([0]);
    const rect = edit.edits[0]?.set.rect;
    // 40 pixels right is 40/zoom points right; 20 pixels DOWN is 20/zoom points down, which is a SMALLER y.
    expect(rect?.x0).toBeCloseTo(NAME.x0 + 40 / zoom, 1);
    expect(rect?.y1).toBeCloseTo(NAME.y1 - 20 / zoom, 1);
    expect((rect?.x1 ?? 0) - (rect?.x0 ?? 0)).toBeCloseTo(NAME.x1 - NAME.x0, 1);
  });

  test('a move that brings a field within a few pixels of another field’s edge SNAPS to it, with a guide line while it is held', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="1"]'));
    const from = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
    // THREE PIXELS RIGHT of the column both fields stand in, and down the page.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 3, from.y + 40, { steps: 4 });
    await expect(page.locator('[data-field-guide="x"]').first()).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-field-guide]')).toHaveCount(0);
    const edit = (await sentOnce(page, sent, 1))[0] as { edits: { set: { rect: typeof EMAIL } }[] };
    // ON THE COLUMN, exactly: the three pixels were taken back.
    expect(edit.edits[0]?.set.rect.x0).toBeCloseTo(EMAIL.x0, 3);
  });

  test('CONTROL: a move that stops well away from every edge lands where the pointer put it', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const zoom = await zoomOf(page);
    const at = await boxOf(page.locator('[data-field-box="1"]'));
    await drag(page, { x: at.x + at.width / 2, y: at.y + at.height / 2 }, { x: 15, y: 40 });
    const edit = (await sentOnce(page, sent, 1))[0] as { edits: { set: { rect: typeof EMAIL } }[] };
    expect(edit.edits[0]?.set.rect.x0).toBeCloseTo(EMAIL.x0 + 15 / zoom, 1);
  });

  test('a drag from NEAR AN EDGE of the box moves it too, and a press that does not travel sends nothing', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="1"]'));
    // TWO PIXELS IN from the left edge and the bottom: still the box, not the paper beside it.
    await page.mouse.click(at.x + 2, at.y + at.height - 2);
    await drag(page, { x: at.x + 2, y: at.y + at.height - 2 }, { x: 0, y: -30 });
    // ONE COMMAND IN ALL, and it is the move: a press that had sent one would put an unmoved rect first, or make two.
    const edit = (await sentOnce(page, sent, 1))[0] as { edits: { field: { index: number }; set: { rect: typeof EMAIL } }[] };
    expect(edit.edits[0]?.field.index).toBe(1);
    expect(edit.edits[0]?.set.rect.y0).toBeGreaterThan(EMAIL.y0);
  });

  test('the one selected field has eight handles, and the bottom right one resizes it', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const zoom = await zoomOf(page);
    const name = page.locator('[data-field-box="0"]');
    const at = await boxOf(name);
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await expect(page.locator('[data-field-handle]')).toHaveCount(8);
    const handle = await boxOf(page.locator('[data-field-handle="se"]'));
    await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: 30, y: 16 });
    const edit = (await sentOnce(page, sent, 1))[0] as { kind: string; edits: { set: { rect: typeof NAME } }[] };
    expect(edit.kind).toBe('editFormFields');
    const rect = edit.edits[0]?.set.rect;
    // THE TOP LEFT CORNER STAYS; the right edge and the bottom follow the pointer.
    expect(rect?.x0).toBeCloseTo(NAME.x0, 1);
    expect(rect?.y1).toBeCloseTo(NAME.y1, 1);
    expect(rect?.x1).toBeCloseTo(NAME.x1 + 30 / zoom, 1);
    expect(rect?.y0).toBeCloseTo(NAME.y0 - 16 / zoom, 1);
  });

  test('a drag on empty paper selects every field it sweeps, and a press there selects none', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const name = await boxOf(page.locator('[data-field-box="0"]'));
    const email = await boxOf(page.locator('[data-field-box="1"]'));
    // FROM THE PAPER LEFT OF BOTH, down across both of them.
    await drag(page, { x: name.x - 20, y: name.y - 10 }, { x: 60, y: email.y + email.height - name.y + 20 });
    await expect(page.locator('[data-field-box="0"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-field-box="1"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(name.x - 20, name.y - 30);
    await expect(page.locator('[aria-pressed="true"][data-field-box]')).toHaveCount(0);
    // NONE, read once settled (DDDDDDDD-4).
    expect(await commandsSettled(page, () => commands(sent).length, 'the commands a selection sent')).toBe(0);
  });

  test('Ctrl+D copies the selected field beside itself, on its own page', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await page.keyboard.press('Control+d');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)[0]).toMatchObject({
      kind: 'duplicateFormField',
      field: { page: 0, index: 0, name: 'Full name' },
      to: { kind: 'place', page: 0, rect: { x0: NAME.x0 + 12, y0: NAME.y0 - 12, x1: NAME.x1 + 12, y1: NAME.y1 - 12 } },
    });
  });

  test('Shift and an arrow nudge the selected field ten points along the page', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)[0]).toMatchObject({
      kind: 'editFormFields',
      edits: [{ field: { page: 0, index: 0, name: 'Full name' }, set: { rect: { x0: NAME.x0 + 10, x1: NAME.x1 + 10 } } }],
    });
  });

  test('Delete with a field selected sends ONE deleteFormFields for its page', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="1"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await page.keyboard.press('Delete');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)[0]).toMatchObject({ kind: 'deleteFormFields', page: 0, indices: [1] });
  });

  test('Escape puts the selection down first, and the mode second, and filling is back', async ({ page }) => {
    const sent: Sent = [];
    await designing(page, sent);
    const at = await boxOf(page.locator('[data-field-box="0"]'));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-field-box="0"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-field-design-layer]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-field-design-layer]')).toHaveCount(0);
    await expect(page.locator('[data-form-field="0"]')).toBeVisible();
  });

  test('CONTROL: while filling, a press on a field fills it and selects nothing', async ({ page }) => {
    const sent: Sent = [];
    await open(page, sent);
    await page.locator('[data-form-field="0"]').click();
    await expect(page.locator('[data-form-selected]')).toHaveCount(0);
    await expect(page.locator('.m-page-field-editor')).toBeVisible();
  });

  test('the Fields list fills a value in place, and Delete there removes the selected field', async ({ page }) => {
    const sent: Sent = [];
    await open(page, sent);
    await runCommand(page, 'Fields list');
    const list = page.locator('.m-forms-panel');
    // THE VALUE IS WORDS until it is clicked, and the click opens the field's box where they were.
    await list.getByRole('button', { name: 'Email', exact: true }).click();
    await list.getByRole('textbox', { name: 'Email' }).fill('ada@example.org');
    await list.getByRole('textbox', { name: 'Email' }).press('Enter');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)[0]).toMatchObject({ kind: 'fillFormField', page: 0, index: 1, value: { set: 'text', text: 'ada@example.org' } });
    // THE ROW SELECTED and the list holding the focus: Delete is the field's.
    await list.getByRole('button', { name: /^Full name — /u }).click();
    await page.keyboard.press('Delete');
    await expect.poll(() => commands(sent).length).toBe(2);
    expect(commands(sent)[1]).toMatchObject({ kind: 'deleteFormFields', page: 0, indices: [0] });
  });

  test('a selected field STAYS selected when another field is filled, so Delete still removes it (2026-10-18)', async ({ page }) => {
    // A FILL MOVES THE VERSION and keeps every field's key. Carried by the field edits' path alone, the selection was left
    // at the version before the fill, named nothing after it, and Delete sent nothing: the forms walk met it as arrows
    // that sent nothing after a late tick landed.
    const sent: Sent = [];
    await open(page, sent);
    await runCommand(page, 'Fields list');
    const list = page.locator('.m-forms-panel');
    await list.getByRole('button', { name: /^Full name — /u }).click();
    await list.getByRole('button', { name: 'Email', exact: true }).click();
    await list.getByRole('textbox', { name: 'Email' }).fill('ada@example.org');
    await list.getByRole('textbox', { name: 'Email' }).press('Enter');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)[0]).toMatchObject({ kind: 'fillFormField', page: 0, index: 1 });
    await list.getByRole('button', { name: /^Full name — /u }).focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => commands(sent).length).toBe(2);
    expect(commands(sent)[1]).toMatchObject({ kind: 'deleteFormFields', page: 0, indices: [0] });
  });

  test('CONTROL: with a field selected from the list but the focus on the page, Delete removes nothing', async ({ page }) => {
    const sent: Sent = [];
    await open(page, sent);
    await runCommand(page, 'Fields list');
    const row = page.locator('.m-forms-panel').getByRole('button', { name: /^Full name — /u });
    await row.click();
    // THE FOCUS LEAVES THE LIST and the selection STAYS (the row is still pressed): only the focus differs from the
    // case above, so a Delete that removed the field here would be one keyed on the selection alone.
    await row.evaluate((element) => {
      (element as HTMLElement).blur();
    });
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Delete');
    // AND THE SAME PRESS WITH THE FOCUS BACK does remove it, so the wait below is long enough to see one.
    await row.focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => commands(sent).length).toBe(1);
    expect(commands(sent)).toMatchObject([{ kind: 'deleteFormFields', indices: [0] }]);
  });

  test('a click with the text field tool places a field at the press and turns Edit fields on', async ({ page }) => {
    const sent: Sent = [];
    await open(page, sent);
    await runCommand(page, 'Add a text field');
    const paper = await boxOf(page.locator('canvas.m-page').first());
    await page.mouse.click(paper.x + 60, paper.y + 300);
    await expect.poll(() => commands(sent).length).toBe(1);
    const create = commands(sent)[0] as { kind: string; fields: { name: string; rect: typeof NAME; field: unknown }[] };
    expect(create.kind).toBe('createFormField');
    expect(create.fields[0]?.name).toBe('Text1');
    expect(create.fields[0]?.field).toStrictEqual({ type: 'text' });
    const rect = create.fields[0]?.rect;
    // 180 BY 20 POINTS, whatever the zoom: the kind's own size.
    expect(Math.abs((rect?.x1 ?? 0) - (rect?.x0 ?? 0))).toBeCloseTo(180, 1);
    expect(Math.abs((rect?.y1 ?? 0) - (rect?.y0 ?? 0))).toBeCloseTo(20, 1);
    await expect(page.locator('[data-field-design-layer]').first()).toBeAttached();
  });
});
