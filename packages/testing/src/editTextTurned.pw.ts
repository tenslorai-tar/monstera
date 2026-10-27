import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { FRAME, SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A block set at an angle is edited where it stands (ADR-0273): text running up the page opens, takes typing and
 * finishes as an upright block does, drawn along its own lines. The read is the shim's, carrying the block's frame as
 * `document.textBlocks` answers it; what the writer does with the frame is the kernel's (`operatorEdit.test.ts`) and the
 * catalogue's (`proof:editcatalogue`, the turned and skewed pages).
 *
 * THE CONTROL is the same block read with no frame: its outline then lies along the page's x, so the tall outline below
 * is the frame's doing and not the box's numbers.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e3');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const WORDS = 'Running up the page';
/** A line running up the page: its frame's x is the page's y, and its y the page's -x. */
const UP = [0, 1, -1, 0] as const;
/** The line's box IN ITS FRAME: from 300 to 450 along it, its baseline at -300 (page x 300), its ink 12 above that. */
const BOX = { x0: 300, y0: -303, x1: 450, y1: -291 };

async function open(page: Page, sent: { channel: string; params: unknown }[], framed: boolean): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(WORDS, { x: 300, y: 300, size: 12, font, rotate: degrees(90) });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Turned.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [
        {
          box: BOX,
          lines: [{ runs: [{ index: 3, text: WORDS, style: RUN }], box: BOX, soft: false, baseline: -300 }],
          style: RUN,
          shape: { align: 'left' as const, firstIndent: 0 },
          ...(framed ? { frame: UP } : {}),
        },
      ],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-text-edit-layer="0"] [data-text-block="0"]')).toBeAttached({ timeout: 10_000 });
}

test('text running up the page is outlined along its line, opens, takes typing and finishes with one write of its words', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await open(page, sent, true);
  const outline = page.locator('[data-text-edit-layer="0"] [data-text-block="0"]');
  const area = await outline.boundingBox();
  if (area === null) throw new Error('the outline has no box');
  // ALONG ITS LINE: 150 points long and 12 across, so on screen it stands tall.
  expect(area.height).toBeGreaterThan(area.width * 5);

  await openWords(page, outline);
  const frame = await page.locator(FRAME).boundingBox();
  if (frame === null) throw new Error('the editor has no frame');
  expect(frame.height).toBeGreaterThan(frame.width * 3);
  await page.keyboard.press('End');
  await page.keyboard.type(' too');
  await expect(page.locator(SURFACE)).toContainText(`${WORDS} too`);

  // AWAY, on the page beside the block: the one write carries the words typed.
  await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 40 } });
  await expect
    .poll(() =>
      sent.flatMap(({ channel, params }) => {
        const command = (params as { command?: { kind?: string; blocks?: { text?: string }[]; text?: string } }).command;
        return channel === 'document.execute' ? [JSON.stringify(command)] : [];
      }),
    )
    .toStrictEqual([expect.stringContaining(`${WORDS} too`)]);
});

test('CONTROL: the same block read with no frame is outlined along the page’s x, so the tall outline is the frame’s', async ({ page }) => {
  await open(page, [], false);
  const area = await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').boundingBox();
  if (area === null) throw new Error('the outline has no box');
  expect(area.width).toBeGreaterThan(area.height * 5);
});
