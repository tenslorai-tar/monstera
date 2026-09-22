import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * A reader's place survives a command, in a real browser.
 *
 * Every command moves the document's version, and a new version reopens the view and remounts
 * the scroller (ADR-0084 made that every edit). Seen live 2026-09-18: a reader on page 3 was put
 * back on page 1 after each edit. happy-dom lays nothing out, so where the scroller really ends up
 * — after a page measures, the estimates settle and the observer reports — is this browser's
 * answer. Measured against the build before the fix: the same steps ended on page 1 of 3.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000f3');

/** Three Letter pages, so a page's position is decided by the two above it. */
async function threePages(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let at = 0; at < 3; at += 1) document.addPage([612, 792]);
  return document.save();
}

async function statusPage(page: Page): Promise<string> {
  return (await page.locator('.m-status-page').textContent()) ?? '';
}

test('a COMMAND leaves the reader on the page they were on', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await threePages();
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'three.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // GENEROUS, because these wait for a page to rasterise and are not a product bound: measured
  // 2026-09-18 on a machine at 100% CPU, the default 5 s missed a first draw that then arrived.
  await expect(page.locator('.m-page-list .m-page').first()).toBeVisible({ timeout: 20_000 });

  // TO PAGE 3 through the status bar's own field, as a person does.
  const field = page.getByRole('textbox', { name: 'Go to page' });
  await field.fill('3');
  await field.press('Enter');
  await expect.poll(() => statusPage(page)).toBe('Page 3 of 3');

  // A COMMAND, through the palette: the shim moves the version, so the view reopens.
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Rotate page');
  await page.locator('.m-palette-item').filter({ hasText: /^Rotate page$/u }).first().click();

  // THE REOPENED VIEW HAS DRAWN, which is what the scroller's reveal waits for.
  await expect(page.locator('canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  // THE VIEW MOVED — POLLED, and polled on the SCROLL, because the reveal follows the first
  // measurement. The status line cannot be the wait: the new scroller seeds its starting page and
  // reports it at mount, so "Page 3 of 3" is on screen BEFORE the reveal as well as after it, and a
  // single scroll read behind that poll raced the reveal — red on a loaded runner at 0040eb8 with
  // the status right and `scrollTop` 0. Page 3 of three Letter pages is well below the top, and a
  // build with no reveal stays at 0 until this times out.
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.m-page-list')?.scrollTop ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(1000);
  // AND THE READER IS WHERE THEY WERE once it has, rather than on the page the observer saw first.
  await expect.poll(() => statusPage(page), { timeout: 10_000 }).toBe('Page 3 of 3');
});
