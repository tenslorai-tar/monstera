import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

// THE v5 SIDE-BY-SIDES: each of the owner's v5 exports beside this build at the same screen, for the Stage 10
// report. Run by hand through `scripts/test/capture.config.mjs`. The exports are read from the owner's design
// folder, which `.gitignore` keeps out of every commit, and the composites are written to CAPTURE_OUT — which
// is never inside the repository, so neither the design nor a picture of it can be committed from here.
const OUT = process.env['CAPTURE_OUT'] ?? 'capture';
const EXPORTS = process.env['CAPTURE_EXPORTS'] ?? 'assets/Monstera PDF Editor UI Design/exports';

async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let at = 0; at < 12; at += 1) {
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

/** One screen: the export it is set beside, the look it is drawn in, and how to reach it. */
interface Screen {
  readonly name: string;
  readonly look: Look['name'];
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly document: boolean;
  readonly then?: (page: Page) => Promise<void>;
}

const openSettings = async (page: Page): Promise<void> => {
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Settings');
  await page.getByRole('option', { name: 'Settings' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const SCREENS: readonly Screen[] = [
  { name: 'v5-01-start-dark', look: 'dark', document: false },
  { name: 'v5-13-start-light', look: 'light', document: false },
  { name: 'v5-02-document-dark', look: 'dark', document: true },
  { name: 'v5-03-assistant-dark', look: 'dark', document: true, settings: { 'appearance.context-panel-tab': 'assistant' } },
  { name: 'v5-04-document-light', look: 'light', document: true },
  { name: 'v5-05-document-high-contrast', look: 'hc', document: true },
  { name: 'v5-06-studio-dark', look: 'dark', document: true, settings: { 'appearance.layout-mode': 'studio' } },
  { name: 'v5-07-focus-dark', look: 'dark', document: true, settings: { 'appearance.layout-mode': 'focus' } },
  { name: 'v5-08-forms-dark', look: 'dark', document: true, settings: { 'appearance.ribbon-section': 'forms' } },
  { name: 'v5-09-organize-dark', look: 'dark', document: true, settings: { 'appearance.ribbon-section': 'organize' } },
  { name: 'v5-10-settings-dark', look: 'dark', document: true, then: openSettings },
  { name: 'v5-10-settings-light', look: 'light', document: true, then: openSettings },
  { name: 'v5-14-menubar-dark', look: 'dark', document: true, settings: { 'appearance.context-panel-tab': 'assistant' } },
];

for (const screen of SCREENS) {
  test(`capture ${screen.name} beside its export`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const look = LOOKS.find((each) => each.name === screen.look);
    if (look === undefined) throw new Error(`no look ${screen.look}`);

    await page.setViewportSize({ width: 1920, height: 1080 });
    const bytes = await samplePdf();
    const docId = asDocId('00000000-0000-4000-8000-0000000000f5');
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Harbor Point Lease.pdf' }],
      documentBytes: new Map([[docId, bytes]]),
      settings: screen.settings ?? {},
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    if (screen.document) {
      await page.getByRole('button', { name: /^Open PDF/u }).first().click();
      await expect.poll(() => page.locator('canvas:visible').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    }
    await screen.then?.(page);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);

    mkdirSync(OUT, { recursive: true });
    const ours = await page.screenshot();
    const exported = join(EXPORTS, `${screen.name}.png`);
    if (!existsSync(exported)) throw new Error(`no export at ${exported}`);

    // THE COMPOSITE, drawn by the browser: the design on the left, this build on the right, each labelled and
    // scaled to one height, so a difference is read across one line of sight rather than between two files.
    const side = await context.newPage();
    await side.setViewportSize({ width: 2480, height: 760 });
    const design = readFileSync(exported).toString('base64');
    await side.setContent(
      `<html><body style="margin:0;background:#202020;font:14px Segoe UI,sans-serif;color:#eee;display:flex;gap:16px;padding:12px">` +
        `<figure style="margin:0"><figcaption>Design: ${screen.name}</figcaption><img style="height:690px" src="data:image/png;base64,${design}"></figure>` +
        `<figure style="margin:0"><figcaption>This build (${look.name}, 1920 × 1080)</figcaption><img style="height:690px" src="data:image/png;base64,${ours.toString('base64')}"></figure>` +
        `</body></html>`,
    );
    await side.screenshot({ path: join(OUT, `${screen.name}-side-by-side.png`), fullPage: true });
    await side.close();
  });
}
