import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * The font list in Properties while a block is open in Edit text, SCROLLED (the owner's T1, 2026-10-23): a press on the
 * list's own scroll bar, a drag of it, the wheel and the keys move through the list and close neither the list nor the
 * editor; only a press outside, Escape or a choice ends the list. And the list never scrolls sideways: a name wider than
 * the list is shortened, its full name on hover.
 *
 * Each case ends by choosing a font and pressing away, and asserts the ONE write carries it: an editor that had quietly
 * finished would send its words without the font, or nothing.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000c1');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;
/** Wider than the panel's list at its default width, so a list that sized to its longest name would scroll sideways. */
const LONG = 'Monstera Extraordinarily Long Family Name Condensed Display';
/** Enough families that the list scrolls at its 18em height. */
const FAMILIES = [
  ...Array.from({ length: 40 }, (_unused, at) => ({ name: `Family ${String(at + 1).padStart(2, '0')}`, origin: 'installed' as const, embedding: 'whole' as const })),
  { name: LONG, origin: 'installed' as const, embedding: 'whole' as const },
];

async function openList(page: Page, sent: { channel: string; params: unknown }[]): Promise<{ list: Locator; editor: Locator }> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText('A paragraph of words', { x: 100, y: 690, size: 12, font });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Scroll.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      fontFamilies: FAMILIES,
      textBlocks: [
        {
          box: { x0: 100, y0: 686, x1: 400, y1: 700 },
          lines: [{ runs: [{ index: 3, text: 'A paragraph of words', style: RUN }], box: { x0: 100, y0: 686, x1: 400, y1: 700 }, soft: false, baseline: 690 }],
          style: RUN,
          shape: { align: 'left', firstIndent: 0 },
          push: { below: [], room: 0 },
        },
      ],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  await runCommand(page, 'Edit text on the page');
  await page.locator('[data-text-edit-layer="0"] [data-text-block="0"]').click();
  const editor = page.locator('[data-text-editor]');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+A');
  const panel = page.locator('[data-text-properties]');
  await panel.getByRole('button', { name: /^Font:/u }).click();
  const list = panel.locator('.m-font-picker__list');
  await expect(list.getByRole('option', { name: /Family 40/u })).toBeAttached();
  // THE LIST SCROLLS, or the cases below would press a bar that is not there.
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  return { list, editor };
}

/**
 * A point on the LIST ITSELF that is no choice: a group's heading. Headless Chromium draws no scroll bar (Playwright
 * starts it with `--hide-scrollbars`), and a press on the bar and on a heading are the same press to the page — on the
 * list element, where no choice holds the focus back — so the heading stands for the bar here, and the real bar is
 * pressed and dragged in the live app (`fontListWalk`, the closing walks).
 */
async function listPoint(list: Locator): Promise<{ x: number; y: number }> {
  const heading = list.locator('.m-font-picker__group').first();
  const box = await heading.boundingBox();
  if (box === null) throw new Error('the list shows no group heading to press');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Chooses `name` and presses away: the editor's one write must carry the font. */
async function chooseAndLeave(page: Page, list: Locator, editor: Locator, sent: { channel: string; params: unknown }[], name: string): Promise<void> {
  await list.getByRole('option', { name: new RegExp(name, 'u') }).click();
  await expect(editor).toBeFocused();
  await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
  await expect
    .poll(() =>
      sent.flatMap(({ channel, params }) => {
        if (channel !== 'document.execute') return [];
        const command = (params as { command?: { kind?: string; marks?: unknown[] } }).command;
        return command?.kind === 'editTextBlock' ? (command.marks ?? []) : [];
      }),
    )
    .toStrictEqual([expect.objectContaining({ set: expect.objectContaining({ family: name }) })]);
}

test.describe('The font list scrolled while a block is open (T1)', () => {
  test('a PRESS on the list itself, no choice under it (as on its scroll bar), closes neither the list nor the editor', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    const { list, editor } = await openList(page, sent);
    const point = await listPoint(list);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(400);
    await expect(list).toBeVisible();
    await expect(editor).toHaveCount(1);
    await chooseAndLeave(page, list, editor, sent, 'Family 33');
  });

  test('a press HELD and DRAGGED on the list, as a scroll bar is dragged, and the list and the editor stay', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    const { list, editor } = await openList(page, sent);
    const from = await listPoint(list);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(from.x, from.y + step * 12);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(list).toBeVisible();
    await expect(editor).toHaveCount(1);
    await chooseAndLeave(page, list, editor, sent, 'Family 20');
  });

  test('the WHEEL and the KEYS move through the list, and the list and the editor stay', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    const { list, editor } = await openList(page, sent);
    const box = await list.boundingBox();
    if (box === null) throw new Error('the list has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    await expect(editor).toHaveCount(1);
    await chooseAndLeave(page, list, editor, sent, 'Family 38');
  });

  test('CONTROL: a press outside the list, on the page, still closes it and ends the editor', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    const { list, editor } = await openList(page, sent);
    await page.locator('canvas[data-page-canvas="0"]').click({ position: { x: 40, y: 600 } });
    await expect(list).toHaveCount(0);
    await expect(editor).toHaveCount(0);
  });

  test('the list never scrolls sideways: a long name is shortened, and its full name is given on hover', async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    const { list } = await openList(page, sent);
    expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    const long = list.getByRole('option', { name: new RegExp(LONG, 'u') });
    await long.scrollIntoViewIfNeeded();
    const name = long.locator('.m-font-picker__option-name');
    expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(name).toHaveCSS('text-overflow', 'ellipsis');
    await expect(long).toHaveAttribute('title', LONG);
  });
});
