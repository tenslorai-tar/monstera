import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * A page command shown at once from the pages already drawn
 * ([ADR-0261](../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md)).
 *
 * The shim holds each command for {@link HELD_MS}, which is main applying it; everything asserted happens inside that
 * hold, so nothing the case sees can be the new version drawn. What it reads are the PIXELS on screen: each page's canvas
 * as a data address, and its shape. The sample's eight pages differ by their title, so two canvases are equal only when
 * they show the same page at the same size.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');
const HELD_MS = 2500;
/** How soon after the command the result must be on screen, generous for a shared runner: the live walk times it to the frame. */
const SHOWN_WITHIN_MS = 600;

interface Drawn {
  readonly pages: readonly string[];
  readonly shapes: readonly ('portrait' | 'landscape' | 'none')[];
  readonly thumbs: readonly ('portrait' | 'landscape' | 'none')[];
}

/** What the first two page canvases and the first strip card show now. */
async function drawn(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const shape = (canvas: HTMLCanvasElement | null): 'portrait' | 'landscape' | 'none' =>
      canvas === null || canvas.width === 0 ? 'none' : canvas.width > canvas.height ? 'landscape' : 'portrait';
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas.m-page')].slice(0, 2);
    const thumbs = [...document.querySelectorAll<HTMLCanvasElement>('canvas.m-thumb-canvas')].slice(0, 1);
    return {
      pages: canvases.map((canvas) => (canvas.width === 0 ? '' : canvas.toDataURL())),
      shapes: canvases.map(shape),
      thumbs: thumbs.map(shape),
    };
  });
}

/** Opens the sample with every command and undo held, waits for the first two pages and the strip's first card. */
async function openHeld(page: Page, extra: Record<string, unknown> = {}): Promise<Drawn> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 1600 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Sample.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    delays: { 'document.execute': HELD_MS, 'document.undo': HELD_MS },
    // THE READING VIEW: the Organize section would show its grid in place of the page list. The palette runs the commands.
    settings: { 'appearance.ribbon-section': 'home' },
    ...extra,
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect.poll(async () => (await drawn(page)).pages.filter((each) => each !== '').length, { timeout: 20_000 }).toBe(2);
  await expect.poll(async () => (await drawn(page)).thumbs[0], { timeout: 20_000 }).toBe('portrait');
  const before = await drawn(page);
  expect(before.pages[0]).not.toBe(before.pages[1]);
  return before;
}

test('a rotate is shown on the page and its card while main still holds the command', async ({ page }) => {
  await openHeld(page);
  const sent = Date.now();
  await runCommand(page, 'Rotate page');
  await expect.poll(async () => (await drawn(page)).shapes[0], { timeout: SHOWN_WITHIN_MS }).toBe('landscape');
  await expect.poll(async () => (await drawn(page)).thumbs[0], { timeout: SHOWN_WITHIN_MS }).toBe('landscape');
  // INSIDE THE HOLD, so what turned the page is the plan and not the new version drawn.
  expect(Date.now() - sent).toBeLessThan(HELD_MS);
});

test('CONTROL: a rotate sent behind an unplanned command still held is not drawn ahead', async ({ page }) => {
  // THE OBSERVABLE CAN SAY "NOT YET": with a mark's command in flight first, the plan refuses (ADR-0261 Decision 2), and
  // the same reading that passed above reads the page upright for the whole hold.
  await openHeld(page, { settings: { 'appearance.ribbon-section': 'comment' } });
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click();
  await page.mouse.move(slot.x + 100, slot.y + 100);
  await page.mouse.down();
  await page.mouse.move(slot.x + 200, slot.y + 180, { steps: 4 });
  await page.mouse.up();
  const sent = Date.now();
  await runCommand(page, 'Rotate page');
  await page.waitForTimeout(SHOWN_WITHIN_MS);
  expect((await drawn(page)).shapes[0]).toBe('portrait');
  expect(Date.now() - sent).toBeLessThan(HELD_MS);
});

test('a move is shown at once: the first page shows what the second showed, and the second the first', async ({ page }) => {
  const before = await openHeld(page);
  const sent = Date.now();
  await runCommand(page, 'Move page down');
  await expect.poll(async () => (await drawn(page)).pages, { timeout: SHOWN_WITHIN_MS }).toStrictEqual([before.pages[1], before.pages[0]]);
  expect(Date.now() - sent).toBeLessThan(HELD_MS);
});

test('a delete is shown at once: the page that followed takes the first place', async ({ page }) => {
  const before = await openHeld(page);
  await runCommand(page, 'Delete page');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Delete/u }).click();
  const sent = Date.now();
  await expect.poll(async () => (await drawn(page)).pages[0], { timeout: SHOWN_WITHIN_MS }).toBe(before.pages[1]);
  expect(Date.now() - sent).toBeLessThan(HELD_MS);
});

test('an undo of a move is shown at once, from the move it undoes', async ({ page }) => {
  const before = await openHeld(page);
  await runCommand(page, 'Move page down');
  await expect.poll(async () => (await drawn(page)).pages, { timeout: SHOWN_WITHIN_MS }).toStrictEqual([before.pages[1], before.pages[0]]);
  // THE SHIM APPLIES NOTHING: once the move is answered its version draws the pages in their first order, which is
  // what the undo's plan then reorders — the case is about the undo drawn ahead, not about the shim's bytes.
  await expect.poll(async () => (await drawn(page)).pages, { timeout: HELD_MS + 10_000 }).toStrictEqual([before.pages[0], before.pages[1]]);
  const sent = Date.now();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await drawn(page)).pages, { timeout: SHOWN_WITHIN_MS }).toStrictEqual([before.pages[1], before.pages[0]]);
  expect(Date.now() - sent).toBeLessThan(HELD_MS);
});

test('a refused rotate goes back: the page is upright again, with the message', async ({ page }) => {
  await openHeld(page, { refusals: new Map([[ID, { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } }]]) });
  await runCommand(page, 'Rotate page');
  await expect.poll(async () => (await drawn(page)).shapes[0], { timeout: SHOWN_WITHIN_MS }).toBe('landscape');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: HELD_MS + 10_000 });
  await expect.poll(async () => (await drawn(page)).shapes[0], { timeout: 5000 }).toBe('portrait');
  expect((await drawn(page)).thumbs[0]).toBe('portrait');
});
