import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { openSection } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Detect fields' review on pinned Chromium (the owner's F2, F3 and K7): the proposals are marked on the page while the
 * window is open and gone when it closes, *Find on all pages* brings the other pages' proposals into the same window,
 * and the accept is ONE create whose placements each name their page.
 *
 * The kernel is the shim's, which proposes what the case scripts; what the detector finds on a real page is
 * `flatFields.test.ts`' subject, against MuPDF.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

async function flatPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const word of ['Full name:', 'Signed by:']) {
    const page = document.addPage([612, 792]);
    page.drawText(word, { x: 72, y: 700, size: 11, font });
    page.drawLine({ start: { x: 180, y: 698 }, end: { x: 520, y: 698 }, thickness: 1 });
  }
  return document.save();
}

/** In display space at scale 1, which is what the spotlight draws: the rule's box, y measured from the top. */
const SHOWN = { x0: 180, y0: 82, x1: 520, y1: 95 } as const;

async function openFlat(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  const bytes = await flatPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Flat.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [[]],
      flatFieldCandidates: [
        { page: 0, rect: { x0: 180, y0: 697, x1: 520, y1: 710 }, label: 'Full name:', name: 'Full_name', shown: SHOWN },
        { page: 0, rect: { x0: 540, y0: 697, x1: 552, y1: 709 }, label: 'Over 18', name: 'Over_18', kind: 'checkbox', shown: { x0: 540, y0: 83, x1: 552, y1: 95 } },
        { page: 1, rect: { x0: 180, y0: 697, x1: 520, y1: 710 }, label: 'Signed by:', name: 'Signed_by', shown: SHOWN },
      ],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
}

test.describe('Detect fields', () => {
  test('marks each proposal on its page while the window is open, and the accept adds what stayed ticked across pages as one create', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openFlat(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Detect/u }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Fields this page could have' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Found 2 places for fields.')).toBeVisible();
    // ON THE PAGE, where the proposals are: two marks on the first page, and none on the second before it is asked for.
    await expect(page.locator('[data-spotlight-layer="0"] [data-spotlight="box"]')).toHaveCount(2);
    await expect(page.locator('[data-spotlight-layer="1"] [data-spotlight="box"]')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Find on all pages' }).click();
    await expect(dialog.getByText('Found 3 places for fields.')).toBeVisible();
    await expect(dialog.getByText('Page 2')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Find on all pages' })).toHaveCount(0);

    await dialog.getByRole('checkbox', { name: /Over 18/u }).uncheck();
    await dialog.getByRole('button', { name: 'Add 2 fields' }).click();
    await expect(dialog).toHaveCount(0);
    // THE MARKS GO WITH THE WINDOW.
    await expect(page.locator('[data-spotlight="box"]')).toHaveCount(0);

    const created = sent
      .filter((call) => call.channel === 'document.execute')
      .map((call) => (call.params as { command: { kind: string } }).command)
      .filter((command) => command.kind === 'createFormField');
    // ONE create, each placement on its own page: page 2's field is on page index 1 though the command's page is 0.
    expect(created).toStrictEqual([
      {
        kind: 'createFormField',
        page: 0,
        fields: [
          { rect: { x0: 180, y0: 697, x1: 520, y1: 710 }, name: 'Full_name', page: 0, field: { type: 'text' } },
          { rect: { x0: 180, y0: 697, x1: 520, y1: 710 }, name: 'Signed_by', page: 1, field: { type: 'text' } },
        ],
      },
    ]);
  });

  test('CONTROL: closing the window adds nothing and takes the marks away', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await openFlat(page, sent);
    await openSection(page, 'Forms');
    await page.getByRole('button', { name: /^Detect/u }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Fields this page could have' });
    await expect(page.locator('[data-spotlight-layer="0"] [data-spotlight="box"]')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-spotlight="box"]')).toHaveCount(0);
    expect(sent.filter((call) => call.channel === 'document.execute')).toStrictEqual([]);
  });
});
