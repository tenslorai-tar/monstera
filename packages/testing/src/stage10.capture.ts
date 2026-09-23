import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

// STAGE 10's CAPTURE: the screens the owner's exports show, at the sizes they were drawn at, so the
// build can be put beside the design. Run by hand through `scripts/test/capture.config.mjs`.
const OUT = process.env['CAPTURE_OUT'] ?? 'capture';
const LABEL = process.env['CAPTURE_LABEL'] ?? 'app';

async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let at = 0; at < 8; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Harbor Point Lease — page ${String(at + 1)}`, { x: 72, y: 720, size: 18, font: bold });
    for (let line = 0; line < 24; line += 1) {
      page.drawText('Base rent is payable in advance on the first day of each calendar month.', {
        x: 72,
        y: 680 - line * 24,
        size: 11,
        font,
      });
    }
  }
  return document.save();
}

async function openApp(page: Page, look: Look, width: number, height: number, settings: Record<string, unknown> = {}): Promise<void> {
  await page.setViewportSize({ width, height });
  const bytes = await samplePdf();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f1');
  await bridgeUnder(page, look, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Harbor Point Lease.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
    settings,
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
}

async function shot(page: Page, look: Look, name: string): Promise<void> {
  const folder = join(OUT, LABEL);
  mkdirSync(folder, { recursive: true });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(folder, `${name}-${look.name}.png`) });
}

async function openDocument(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect.poll(() => page.locator('canvas:visible').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
}

for (const look of LOOKS) {
  test(`${look.name}: capture the Stage 10 screens`, async ({ page, context }) => {
    test.setTimeout(240_000);

    // THE OWNER'S SIZES: the exports are 1920 × 1080 wide and 1280 × 800 narrow.
    await openApp(page, look, 1920, 1080);
    await shot(page, look, 'start');
    await openDocument(page);
    await shot(page, look, 'document-wide');

    // SETTINGS, on top of the document, as the export shows it.
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Settings');
    await page.getByRole('option', { name: 'Settings' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, look, 'settings');
    await page.getByRole('button', { name: 'Done' }).click();

    // THE SAVE FEEDBACK, which is three things at once and has to be looked at as one frame:
    // the tab's dot while there are changes, the same dot gone and the status bar counting from
    // the save, and the toast that confirms it. Driven through the real command — a rotate to
    // dirty the document, then Ctrl+S — so what is captured is what a person gets.
    // THROUGH THE PALETTE, as Settings above is: the rotate button's name depends on which
    // ribbon section is showing and on whether its group has folded, and neither is what this
    // capture is about. The palette reaches the registered command whatever the ribbon is doing.
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Rotate page');
    await page.getByRole('option', { name: /^Rotate page/u }).first().click();
    await page.waitForTimeout(600);
    await shot(page, look, 'save-dirty');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(300);
    await shot(page, look, 'save-done');

    const narrow = await context.newPage();
    await openApp(narrow, look, 1280, 800);
    await openDocument(narrow);
    await shot(narrow, look, 'document-narrow');
  });
}
