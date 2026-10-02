import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * What a person types straight after the palette's chord reaches the palette, whole.
 *
 * The field took focus through the dialog's `initialFocus`, a frame after the dialog opened, and the keys typed in
 * that gap went to the page: measured 2026-10-02, 12 of 20 openings lost letters — "Stamp" read "mp", "p" or nothing —
 * and on CI's ubuntu runner the stamp case of `renderedScreen.pw.ts` then ran no tool and timed out waiting for it.
 * Twenty openings, because the gap is a race: one opening could pass against the defect.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000bc');

test('every key typed straight after Ctrl+K lands in the palette’s field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  const bytes = await document.save();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'one.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });

  const seen: string[] = [];
  for (let opening = 0; opening < 20; opening += 1) {
    await page.keyboard.press('Control+K');
    // NO WAIT between the chord and the typing: the gap is exactly what a person does not wait for.
    await page.keyboard.type('Stamp');
    seen.push(await page.locator('.m-palette-query').inputValue());
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-palette-query')).toHaveCount(0);
  }
  expect(seen).toStrictEqual(Array.from({ length: 20 }, () => 'Stamp'));
});
