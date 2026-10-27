import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A block of one line grows right as letters are added, to the edge of its column, and only then wraps (the owner's test
 * of milestone 1: a tight box wrapped on its first letter); and the editor sends the writer that same edge, so the two
 * break the line in one place (the local agent's walk). A block of several lines keeps its width.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e7');
const STYLE = { size: 14, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
const HEADING = { x0: 72, y0: 696, x1: 118, y1: 712 };
/** The paragraph below the heading: its right edge is the column's. */
const PARAGRAPH = [
  { x0: 72, y0: 650, x1: 540, y1: 664 },
  { x0: 72, y0: 634, x1: 520, y1: 648 },
];

async function open(page: Page, sent: { channel: string; params: unknown }[], which: 0 | 1): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  sheet.drawText('Short', { x: 72, y: 700, size: 14, font });
  sheet.drawText('A paragraph that runs the whole width of its column on the page', { x: 72, y: 654, size: 14, font });
  sheet.drawText('and a second line of it below the first one, a little short', { x: 72, y: 638, size: 14, font });
  const bytes = await document.save();
  const box = (lines: readonly { x0: number; y0: number; x1: number; y1: number }[]) => ({
    x0: Math.min(...lines.map((line) => line.x0)),
    y0: Math.min(...lines.map((line) => line.y0)),
    x1: Math.max(...lines.map((line) => line.x1)),
    y1: Math.max(...lines.map((line) => line.y1)),
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Reach.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      // THE WRITER MAIN NAMES FOR EVERY PAGE (ADR-0266): the operator writer, which alone takes a reach.
      textRewrite: 'operators',
      textBlocks: [
        { box: HEADING, lines: [{ runs: [{ index: 3, text: 'Short', style: STYLE }], box: HEADING, soft: false, baseline: 700 }], style: STYLE, shape: { align: 'left' as const, firstIndent: 0 } },
        {
          box: box(PARAGRAPH),
          lines: [
            { runs: [{ index: 4, text: 'A paragraph that runs the whole width of its column on the page', style: STYLE }], box: PARAGRAPH[0] ?? HEADING, soft: true, baseline: 654 },
            { runs: [{ index: 5, text: 'and a second line of it below the first one, a little short', style: STYLE }], box: PARAGRAPH[1] ?? HEADING, soft: false, baseline: 638 },
          ],
          style: STYLE,
          shape: { align: 'left' as const, firstIndent: 0 },
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
  await openWords(page, page.locator(`[data-text-edit-layer="0"] [data-text-block="${String(which)}"]`));
}

/** The places the one block edit sent carried. */
function placesSent(sent: readonly { channel: string; params: unknown }[]): unknown[] {
  return sent.flatMap(({ channel, params }) => {
    if (channel !== 'document.execute') return [];
    const command = (params as { command?: { kind?: string; places?: unknown[] } }).command;
    return command?.kind === 'editTextOperators' || command?.kind === 'editTextBlock' ? (command.places ?? []) : [];
  });
}

/** How many lines the editor's words are laid out on: their line boxes' distinct tops. */
async function linesShown(page: Page): Promise<number> {
  return page.locator(SURFACE).evaluate((root) => {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    return new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
  });
}

test('a heading of one line typed into grows right on one line, and the writer is sent the column’s edge to wrap at', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await open(page, sent, 0);
  await page.keyboard.type(' heading that grows to the right');
  // ONE LINE, where the box ended after "Short": the first letter past it wrapped before.
  expect(await linesShown(page)).toBe(1);
  await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
  await expect.poll(() => placesSent(sent)).toStrictEqual([expect.objectContaining({ reach: 540 })]);
});

test('CONTROL: a block of several lines keeps its width and is sent no reach', async ({ page }) => {
  const sent: { channel: string; params: unknown }[] = [];
  await open(page, sent, 1);
  await page.keyboard.type(' more words');
  await page.locator('[data-text-edit-layer="0"]').click({ position: { x: 40, y: 600 } });
  await expect.poll(() => sent.filter((one) => one.channel === 'document.execute').length).toBe(1);
  expect(placesSent(sent)).toStrictEqual([]);
});
