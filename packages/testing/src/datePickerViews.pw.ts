import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * The date field's calendar in its four views (the owner's R25), on pinned Chromium against the compiled bundle, in every
 * look: each view has no serious accessibility violation and keeps the calendar inside its own box, and the route the
 * owner asked for — title, title, title, then the decade, the year, the month and the day — fills the field. The press
 * counts and the keyboard are `DatePickerViews.test.tsx`; this is the drawn half.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e5');
const BLOCKING = new Set(['serious', 'critical']);
const RECT = { x0: 180, y0: 626, x1: 340, y1: 646 } as const;

const DUE: ShimFormField = {
  index: 0,
  page: 0,
  kind: 'text',
  name: 'Born',
  values: ['21/10/2026'],
  on: null,
  options: [],
  readOnly: false,
  multiline: false,
  rect: RECT,
  format: { kind: 'date', pattern: 'dd/mm/yyyy' },
};

async function open(page: Page, look: (typeof LOOKS)[number], sent: { channel: string; params: unknown }[]): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  document.getForm().createTextField('Born').addToPage(first, { x: RECT.x0, y: RECT.y0, width: RECT.x1 - RECT.x0, height: RECT.y1 - RECT.y0, font });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [[DUE]],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('[data-form-layer="0"] [data-form-field="0"]')).toBeAttached();
}

for (const look of LOOKS) {
  test(`every view of the calendar is accessible and fits, and the decades route fills the field (R25), ${look.name}`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await open(page, look, sent);
    await page.getByRole('button', { name: 'Fill in Born', exact: true }).click();
    await page.getByRole('button', { name: 'Choose a date', exact: true }).click();
    const calendar = page.getByRole('dialog', { name: 'Calendar' });
    const widths: number[] = [];
    const check = async (view: string): Promise<void> => {
      widths.push(await calendar.evaluate((element) => element.getBoundingClientRect().width));
      await expect(calendar).toHaveAttribute('data-view', view);
      const results = await new AxeBuilder({ page }).include('.m-date-picker').analyze();
      const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
      expect(blocking.map((violation) => `${view}: ${String(violation.impact)} ${violation.id}`)).toStrictEqual([]);
      // NOTHING RUNS PAST THE CALENDAR'S EDGE: its content is no wider than the box it draws.
      expect(await calendar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);    };
    await check('days');
    await calendar.getByRole('button', { name: /, Choose a month$/u }).click();
    await check('months');
    await calendar.getByRole('button', { name: /, Choose a year$/u }).click();
    await check('years');
    await calendar.getByRole('button', { name: /, Choose ten years$/u }).click();
    await check('decades');
    // ONE WIDTH IN EVERY VIEW, so the title and the arrows stay under the pointer from one press to the next.
    expect(new Set(widths).size).toBe(1);
    await calendar.getByRole('button', { name: '1990–1999', exact: true }).click();
    await calendar.getByRole('button', { name: '1996', exact: true }).click();
    await calendar.getByRole('button', { name: 'October 1996', exact: true }).click();
    await calendar.getByRole('button', { name: /October 21, 1996$/u }).click();
    await expect
      .poll(() => sent.filter((call) => call.channel === 'document.execute').map((call) => (call.params as { command: unknown }).command))
      .toStrictEqual([{ kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: '21/10/1996' } }]);
  });
}
