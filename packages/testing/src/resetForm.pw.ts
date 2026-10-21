import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { openSection } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * *Reset form* on the Forms ribbon (the owner's R23), on pinned Chromium against the compiled bundle: the button is on
 * the ribbon while the document has a field, it asks first in a dialog with no serious accessibility violation, and a
 * yes sends exactly one `resetWholeForm` while a dismissal sends nothing. The kernel half — every kind back to its
 * default, the signature kept, through save and reopen — is `formFields.test.ts`.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e3');
const BLOCKING = new Set(['serious', 'critical']);
const RECT = { x0: 180, y0: 626, x1: 520, y1: 646 } as const;

const LISTED: ShimFormField = {
  index: 0,
  page: 0,
  kind: 'text',
  name: 'Full name',
  values: ['Ada'],
  on: null,
  options: [],
  readOnly: false,
  multiline: false,
  rect: RECT,
};

async function open(page: Page, sent: { channel: string; params: unknown }[], fields: readonly ShimFormField[]): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  if (fields.length > 0) {
    const field = document.getForm().createTextField('Full name');
    field.setText('Ada');
    field.addToPage(first, { x: RECT.x0, y: RECT.y0, width: RECT.x1 - RECT.x0, height: RECT.y1 - RECT.y0, font });
  }
  const bytes = await document.save();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
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
  await openSection(page, 'Forms');
}

const executed = (sent: readonly { channel: string; params: unknown }[]): unknown[] =>
  sent.filter((call) => call.channel === 'document.execute').map((call) => call.params);

test.describe('Reset form (R23)', () => {
  test('asks first, in an accessible dialog, then sends exactly one resetWholeForm', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await open(page, sent, [LISTED]);
    await page.getByRole('button', { name: 'Reset form', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset this form?' });
    await expect(dialog.getByText(/Signatures stay as they are/u)).toBeVisible();
    // NOTHING SENT while the question is open.
    expect(executed(sent)).toStrictEqual([]);
    const results = await new AxeBuilder({ page }).include('.m-dialog').analyze();
    const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
    expect(blocking.map((violation) => `${String(violation.impact)}: ${violation.id}`)).toStrictEqual([]);
    await dialog.getByRole('button', { name: 'Reset form', exact: true }).click();
    await expect.poll(() => executed(sent)).toStrictEqual([{ docId: ID, command: { kind: 'resetWholeForm' } }]);
  });

  test('CONTROL: Escape closes the question and sends nothing', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await open(page, sent, [LISTED]);
    await page.getByRole('button', { name: 'Reset form', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Reset this form?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Reset this form?' })).toHaveCount(0);
    expect(executed(sent)).toStrictEqual([]);
  });

  test('CONTROL: a document with no field has no Reset form on the ribbon', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await open(page, sent, []);
    // THE SECTION IS DRAWN, so the absence below is the command's and not an empty ribbon's.
    await expect(page.getByRole('button', { name: 'Flatten' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset form', exact: true })).toHaveCount(0);
  });
});
