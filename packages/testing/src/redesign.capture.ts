import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

// THE CAPTURE HARNESS for design review: five screens in three looks, rendered from the real
// renderer through the browser shim, written as files rather than asserted. Not a test — it fails
// nothing — and it is run by hand, which is why it lives under `*.capture.ts` and is collected only
// by `scripts/test/capture.config.mjs`. `CAPTURE_OUT` names the folder and `CAPTURE_LABEL` the run,
// so the same command captures the build before and after a change and the two sit side by side.
//
// Stage 10 compares these against the owner's exports in `assets/Monstera PDF Editor UI Design`.
const OUT = process.env['CAPTURE_OUT'] ?? 'capture';
const LABEL = process.env['CAPTURE_LABEL'] ?? 'today';

async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let at = 0; at < 3; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Quarterly report — page ${String(at + 1)}`, { x: 72, y: 700, size: 22, font: bold });
    for (let line = 0; line < 22; line += 1) {
      page.drawText('Revenue grew across all three regions, led by the northern accounts and renewals.', {
        x: 72,
        y: 660 - line * 24,
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
  const docId = asDocId('00000000-0000-4000-8000-0000000000e1');
  await bridgeUnder(page, look, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Quarterly report.pdf' }],
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
  test(`${look.name}: capture the five screens`, async ({ page, context }) => {
    test.setTimeout(240_000);

    await openApp(page, look, 1440, 900);
    await shot(page, look, '1-start');

    await openDocument(page);
    await shot(page, look, '2-document');

    await page.keyboard.press('F1');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, look, '4-dialog');
    await page.keyboard.press('Escape');

    // ONE BRIDGE PER PAGE, so each scene with its own settings is its own page.
    const assistant = await context.newPage();
    await openApp(assistant, look, 1440, 900, {
      'appearance.context-panel-open': true,
      'appearance.context-panel-tab': 'assistant',
    });
    await openDocument(assistant);
    await shot(assistant, look, '3-assistant');

    const narrow = await context.newPage();
    await openApp(narrow, look, 800, 600);
    await openDocument(narrow);
    await shot(narrow, look, '5-ribbon-minimum');
  });
}
