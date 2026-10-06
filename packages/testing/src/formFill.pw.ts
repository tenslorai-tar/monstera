import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Filling a form, where only a browser can say what a control does to the text it holds.
 *
 * A one-line `<input>` strips line breaks from the value it shows, and a `<textarea>` turns a carriage return into a
 * line feed (HTML's value sanitisation and API value). happy-dom does neither, so the cases that depend on it are
 * here, on pinned Chromium.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

function field(over: Partial<ShimFormField> & Pick<ShimFormField, 'index' | 'name'>): ShimFormField {
  return {
    page: 0,
    kind: 'text',
    values: [],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: null,
    ...over,
  };
}

async function openWithFields(
  page: Page,
  look: (typeof LOOKS)[number],
  fields: readonly ShimFormField[],
  sent: { channel: string; params: unknown }[],
): Promise<void> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [fields],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
}

const fills = (sent: readonly { channel: string; params: unknown }[]): unknown[] =>
  sent
    .filter((call) => call.channel === 'document.execute')
    .map((call) => (call.params as { command: unknown }).command);

/**
 * A real AcroForm, so the page draws genuine widget appearances under the controls: each field's rectangle is given
 * here once, written into the PDF by pdf-lib and listed to the shim from the same numbers.
 */
const FORM = [
  { kind: 'text', name: 'Full name', rect: { x0: 180, y0: 626, x1: 520, y1: 646 }, values: ['Ada'] },
  { kind: 'checkbox', name: 'Subscribe', rect: { x0: 180, y0: 586, x1: 196, y1: 602 }, on: false },
  { kind: 'radio', name: 'Membership', rect: { x0: 180, y0: 546, x1: 196, y1: 562 }, on: true },
  { kind: 'radio', name: 'Membership', rect: { x0: 260, y0: 546, x1: 276, y1: 562 }, on: false },
  { kind: 'dropdown', name: 'Region', rect: { x0: 180, y0: 506, x1: 320, y1: 526 }, values: ['North'], options: ['North', 'South', 'West'] },
  { kind: 'text', name: 'Reference', rect: { x0: 180, y0: 466, x1: 320, y1: 486 }, values: ['R-1'], readOnly: true },
] as const;

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const fields = document.getForm();
  page.drawText('Membership application', { x: 72, y: 700, size: 22, font });
  const at = (rect: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: rect.x0,
    y: rect.y0,
    width: rect.x1 - rect.x0,
    height: rect.y1 - rect.y0,
  });
  const [name, subscribe, first, second, region, reference] = FORM;
  for (const each of [name, subscribe, first, region, reference]) {
    page.drawText(`${each.name}:`, { x: 72, y: each.rect.y0 + 5, size: 11, font });
  }
  const text = fields.createTextField(name.name);
  text.setText(name.values[0]);
  text.addToPage(page, { ...at(name.rect), font });
  fields.createCheckBox(subscribe.name).addToPage(page, at(subscribe.rect));
  const group = fields.createRadioGroup(first.name);
  group.addOptionToPage('Member', page, at(first.rect));
  group.addOptionToPage('Guest', page, at(second.rect));
  group.select('Member');
  const list = fields.createDropdown(region.name);
  list.addOptions([...region.options]);
  list.select(region.values[0]);
  list.addToPage(page, { ...at(region.rect), font });
  const locked = fields.createTextField(reference.name);
  locked.setText(reference.values[0]);
  locked.addToPage(page, { ...at(reference.rect), font });
  locked.enableReadOnly();
  return document.save();
}

/** The same fields as the shim lists them, in the widget walk's order. */
const LISTED: readonly ShimFormField[] = FORM.map((each, index) =>
  field({
    index,
    kind: each.kind,
    name: each.name,
    rect: each.rect,
    values: 'values' in each ? [...each.values] : [],
    on: 'on' in each ? each.on : null,
    options: 'options' in each ? [...each.options] : [],
    readOnly: 'readOnly' in each,
  }),
);

/** Where a field's centre is on screen, from the first page's slot and the page's 612 by 792 points. */
async function centreOf(page: Page, rect: { x0: number; y0: number; x1: number; y1: number }): Promise<{ x: number; y: number }> {
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  return { x: slot.x + ((rect.x0 + rect.x1) / 2) * scale, y: slot.y + (792 - (rect.y0 + rect.y1) / 2) * scale };
}

async function openForm(page: Page, look: (typeof LOOKS)[number], sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [LISTED],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  await expect(page.locator('[data-form-layer="0"] [data-form-field="0"]')).toBeAttached();
}

for (const look of LOOKS) {
  test(`each fillable field on the page has its control over it, and a read-only one has none, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForm(page, look, sent);
    for (const [index, each] of FORM.entries()) {
      const { x, y } = await centreOf(page, each.rect);
      // WHAT A PRESS THERE MEETS, read from the browser's own hit test with the page's CSS applied.
      const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-form-field]')?.getAttribute('data-form-field') ?? null, [x, y]);
      expect(hit, each.name).toBe('readOnly' in each ? null : String(index));
    }
  });

  test(`a text field pressed on the page opens over it and Enter fills it; Escape keeps it, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForm(page, look, sent);
    const name = FORM[0];
    const { x, y } = await centreOf(page, name.rect);
    await page.mouse.click(x, y);
    const editor = page.locator('[data-form-layer="0"] input[aria-label="Full name"]');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Ada');
    await page.keyboard.type(' Lovelace');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    // CONTROL: Escape sent nothing, so the fill below is Enter's.
    expect(fills(sent)).toStrictEqual([]);

    await page.mouse.click(x, y);
    await page.keyboard.press('End');
    await page.keyboard.type(' Lovelace');
    await page.keyboard.press('Enter');
    await expect.poll(() => fills(sent)).toStrictEqual([
      { kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: 'Ada Lovelace' } },
    ]);
  });

  test(`a tick box, a radio and a dropdown are filled by a press on the page, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openForm(page, look, sent);
    const tick = await centreOf(page, FORM[1].rect);
    await page.mouse.click(tick.x, tick.y);
    const guest = await centreOf(page, FORM[3].rect);
    await page.mouse.click(guest.x, guest.y);
    await page.locator('[data-form-layer="0"] select[aria-label="Region"]').selectOption('South');
    // EACH AT THE VERSION THE ONE BEFORE MADE: a fill moves the version, and the next press names its field from the
    // list read again at the new one, never from the list it replaced.
    await expect.poll(() => fills(sent)).toStrictEqual([
      { kind: 'fillFormField', page: 0, index: 1, version: 1, value: { set: 'button', on: true } },
      { kind: 'fillFormField', page: 0, index: 3, version: 2, value: { set: 'button', on: true } },
      { kind: 'fillFormField', page: 0, index: 4, version: 3, value: { set: 'choice', option: 'South' } },
    ]);
  });

  test(`the Forms panel leaves a value holding line breaks as it was, ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openWithFields(
      page,
      look,
      [
        field({ index: 0, name: 'address', values: ['1 High Street\nLeeds'] }),
        // A CARRIAGE RETURN, which a textarea shows as a line feed: compared with the document's text, an untouched box
        // would write the conversion back.
        field({ index: 1, name: 'previous address', values: ['2 Low Road\rYork'] }),
        field({ index: 2, name: 'notes', multiline: true }),
      ],
      sent,
    );
    await page.getByRole('tablist', { name: 'Document panels' }).getByRole('tab', { name: 'Forms' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Forms' });
    const address = panel.getByLabel('address', { exact: true });
    const previous = panel.getByLabel('previous address', { exact: true });
    await expect(address).toHaveValue('1 High Street\nLeeds');
    // THE MEASUREMENT this case rests on, read where it happens: Chromium shows the CR as a line feed.
    await expect(previous).toHaveValue('2 Low Road\nYork');
    expect(await panel.getByLabel('notes', { exact: true }).evaluate((element) => element.tagName)).toBe('TEXTAREA');

    await address.focus();
    await previous.focus();
    await panel.getByLabel('notes', { exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(fills(sent)).toStrictEqual([]);

    // CONTROL: an edit is sent, with its line break.
    await address.fill('1 High Street\nLeeds LS1');
    await previous.focus();
    await expect.poll(() => fills(sent)).toStrictEqual([
      { kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: '1 High Street\nLeeds LS1' } },
    ]);
  });
}
