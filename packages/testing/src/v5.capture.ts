import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type PDFFont, PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

// THE v5 SIDE-BY-SIDES: each of the owner's v5 exports beside this build at the same screen, for the Stage 10
// report. Run by hand through `scripts/test/capture.config.mjs`. The exports are read from the owner's design
// folder, which `.gitignore` keeps out of every commit, and the composites are written to CAPTURE_OUT — which
// is never inside the repository, so neither the design nor a picture of it can be committed from here.
const OUT = process.env['CAPTURE_OUT'] ?? 'capture';
const EXPORTS = process.env['CAPTURE_EXPORTS'] ?? 'assets/Monstera PDF Editor UI Design/exports';

/** Words of a lease clause, wrapped to `width` points in `font` at `size`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(next, size) > width && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const CLAUSES = [
  'Commencing on the Commencement Date, Tenant shall pay to Landlord, without notice, demand, abatement, deduction or set-off, Base Rent in the amount shown in the schedule below, payable in advance on or before the first day of each calendar month during the Term.',
  'On each anniversary of the Commencement Date, Base Rent shall increase by three percent of the Base Rent payable during the immediately preceding Lease Year, as set forth in the schedule below.',
  'All sums payable by Tenant under this Lease other than Base Rent, including without limitation Tenant’s Proportionate Share of Operating Expenses and Real Property Taxes, shall constitute Additional Rent.',
  'If any installment of Rent is not received within five days after the date due, Tenant shall pay a late charge equal to five percent of the overdue amount, plus interest at the lesser of twelve percent per annum or the maximum rate permitted by law.',
  'If the Term commences or ends on a day other than the first or last day of a calendar month, Rent for such partial month shall be prorated on a per-diem basis.',
];
const ARTICLES = ['PREMISES', 'TERM', 'RENT', 'SECURITY DEPOSIT', 'OPERATING EXPENSES', 'UTILITIES AND HVAC', 'REPAIRS', 'ALTERATIONS'];

/**
 * A REAL-LOOKING MULTI-PAGE DOCUMENT for the side-by-sides (the owner, 2026-09-26: "a real multi-page document, not
 * the test page"): a 24-page commercial lease — a cover, numbered articles in a serif face, a rent schedule, running
 * heads and a signature page — drawn here so no file from outside the repository appears in a capture.
 */
async function samplePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const serif = await document.embedFont(StandardFonts.TimesRoman);
  const serifBold = await document.embedFont(StandardFonts.TimesRomanBold);
  const sans = await document.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.45, 0.45, 0.45);
  const PAGES = 24;
  for (let at = 0; at < PAGES; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText('COMMERCIAL LEASE — HARBOR POINT, SUITE 400', { x: 72, y: 752, size: 7, font: sans, color: grey });
    page.drawText(`PAGE ${String(at + 1)} OF ${String(PAGES)}`, { x: 480, y: 752, size: 7, font: sans, color: grey });
    if (at === 0) {
      page.drawText('COMMERCIAL LEASE AGREEMENT', { x: 176, y: 560, size: 10, font: sans, color: grey });
      page.drawText('Harbor Point', { x: 206, y: 500, size: 34, font: serifBold, color: ink });
      page.drawText('Suite 400', { x: 240, y: 460, size: 34, font: serifBold, color: ink });
      page.drawLine({ start: { x: 266, y: 430 }, end: { x: 346, y: 430 }, thickness: 2, color: ink });
      page.drawText('Harbor Point Holdings LLC, Landlord', { x: 208, y: 400, size: 12, font: serif, color: ink });
      page.drawText('Northwind Analytics, Inc., Tenant', { x: 214, y: 382, size: 12, font: serif, color: ink });
      continue;
    }
    const article = ARTICLES[(at - 1) % ARTICLES.length] ?? 'GENERAL';
    page.drawText(`ARTICLE ${String(at)} — ${article}`, { x: 72, y: 712, size: 12, font: serifBold, color: ink });
    let y = 686;
    for (let clause = 0; clause < 5; clause += 1) {
      const heading = `${String(at)}.${String(clause + 1)} `;
      const lines = wrap(`${heading}${CLAUSES[(at + clause) % CLAUSES.length] ?? ''}`, serif, 10.5, 468);
      for (const line of lines) {
        page.drawText(line, { x: 72, y, size: 10.5, font: serif, color: ink });
        y -= 15;
      }
      y -= 8;
      if (clause === 1 && at % 4 === 1) {
        // THE RENT SCHEDULE, as a ruled table.
        const rows = [['Lease Year', 'Period', 'Monthly Base Rent', 'Annual'], ['1', 'Mar 1, 2026 – Feb 28, 2027', '$18,450.00', '$221,400.00'], ['2', 'Mar 1, 2027 – Feb 29, 2028', '$19,003.50', '$228,042.00'], ['3', 'Mar 1, 2028 – Feb 28, 2029', '$19,573.61', '$234,883.26'], ['4', 'Mar 1, 2029 – Feb 28, 2030', '$20,160.81', '$241,929.76']];
        for (const [index, row] of rows.entries()) {
          const columns = [72, 150, 350, 470];
          row.forEach((cell, column) => {
            page.drawText(cell, { x: columns[column] ?? 72, y, size: 9, font: index === 0 ? serifBold : sans, color: ink });
          });
          page.drawLine({ start: { x: 72, y: y - 5 }, end: { x: 540, y: y - 5 }, thickness: 0.4, color: grey });
          y -= 18;
        }
        y -= 8;
      }
    }
    if (at === PAGES - 1) {
      page.drawText('LANDLORD', { x: 72, y: 180, size: 9, font: serifBold, color: ink });
      page.drawText('TENANT', { x: 330, y: 180, size: 9, font: serifBold, color: ink });
      page.drawLine({ start: { x: 72, y: 130 }, end: { x: 270, y: 130 }, thickness: 0.6, color: ink });
      page.drawLine({ start: { x: 330, y: 130 }, end: { x: 540, y: 130 }, thickness: 0.6, color: ink });
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
      // THE PAGES STRIP DRAWN TOO, where it is on screen: its thumbnails draw lazily after the page, and a capture
      // taken before them shows empty frames the application would not show a moment later.
      await expect
        .poll(() => page.locator('canvas.m-thumb-canvas:visible').count(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(screen.settings?.['appearance.layout-mode'] === 'focus' ? 0 : 4)
        .catch(() => undefined);
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
