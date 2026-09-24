import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

// THE RIBBON AS IT IS DRAWN, section by section: every group's caption and every button's name, read
// off the running renderer at the owner's 1920-wide size. Stage 10's design pass maps each label in
// the owner's exports to a command, and a list typed by hand from the source would be a second
// opinion about what the ribbon holds. Run by hand through `scripts/test/capture.config.mjs`.
const OUT = process.env['CAPTURE_OUT'] ?? 'capture';

test('the ribbon, section by section, at 1920 × 1080', async ({ page }) => {
  test.setTimeout(120_000);
  const look = LOOKS[0];
  if (look === undefined) throw new Error('no look is declared');
  await page.setViewportSize({ width: 1920, height: 1080 });
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('Inventory', { x: 72, y: 720, size: 18, font });
  const bytes = await document.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000f2');
  await bridgeUnder(page, look, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Inventory.pdf' }],
    documentBytes: new Map([[docId, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('.m-ribbon__group').first()).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Sections' });
  const sections = await rail.getByRole('button').allTextContents();
  // A VACUITY GUARD: the design names eight sections, and an empty rail would write an empty file.
  expect(sections.length).toBe(8);

  const inventory: Record<string, { group: string; buttons: string[]; folded: boolean }[]> = {};
  for (const section of sections) {
    await rail.getByRole('button', { name: section, exact: true }).click();
    await page.waitForTimeout(200);
    inventory[section] = await page.locator('.m-ribbon__group').evaluateAll((groups) =>
      groups.map((group) => ({
        group: group.querySelector('.m-ribbon__caption')?.textContent ?? '',
        buttons: [...group.querySelectorAll('.m-ribbon__buttons button')].map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
        folded: group.querySelector('.m-ribbon__more') !== null,
      })),
    );
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'ribbon-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
});
