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

for (const look of LOOKS) {
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
