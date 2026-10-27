import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Edit text's committed words stay on screen until the page draws them
 * ([ADR-0261](../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md) Decision 7).
 *
 * The shim holds the write for {@link WRITE_MS} and every view-model read for {@link MODEL_MS}: after the write is
 * answered, the page cannot draw the new version until the model answers for it, so for that long the old words are the
 * page's. The editor that held the typed words left at the answer until this decision (the owner's N1, a 1.0 s commit),
 * which is exactly that window with neither on screen.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d9');
const WRITE_MS = 1500;
const MODEL_MS = 1000;
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;

function block(y: number, text: string) {
  const box = { x0: 100, y0: y, x1: 400, y1: y + 14 };
  return {
    box,
    lines: [{ runs: [{ index: 3, text, style: RUN }], box, soft: false, baseline: y + 4 }],
    style: RUN,
    shape: { align: 'left' as const, firstIndent: 0 },
  };
}

async function open(page: Page, sent: number[]): Promise<void> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([612, 792]);
  sheet.drawText('The first paragraph', { x: 100, y: 690, size: 12, font });
  const bytes = await document.save();
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'One.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [block(686, 'The first paragraph')],
      delays: { 'document.execute': WRITE_MS, 'document.viewModel': MODEL_MS },
    },
    (channel) => {
      if (channel === 'document.execute') sent.push(Date.now());
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+K');
  await page.keyboard.type('Edit text on the page');
  await page.keyboard.press('Enter');
}

test('the written words are on screen in every frame until the page can draw them: the editor, then their drawn area', async ({ page }) => {
  const sent: number[] = [];
  await open(page, sent);
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  const editor = page.locator(SURFACE);
  const patch = page.locator('[data-text-edit-layer="0"] [data-kit-patch="drawn"]');
  await page.keyboard.type(' grows');
  // EVERY FRAME FROM THE PRESS ON is sampled for one of the two that show the written words: the editor while it holds
  // them (ADR-0261 Decision 7), then the edited area drawn at the new version (the note of 2026-10-27, ADR-0271).
  await page.evaluate(() => {
    const state = { frames: 0, bare: 0, stop: false };
    (window as unknown as { held: typeof state }).held = state;
    const look = (): void => {
      if (state.stop) return;
      state.frames += 1;
      const words = document.querySelector('[data-kit-surface]')?.textContent ?? '';
      if (!words.includes('grows') && document.querySelector('[data-kit-patch="drawn"]') === null) state.bare += 1;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => sent.length).toBe(1);
  const answered = (sent[0] ?? 0) + WRITE_MS;

  // INSIDE THE WINDOW the decision is about: the write is answered and the page cannot have drawn the new version yet.
  await page.waitForTimeout(Math.max(0, answered + MODEL_MS / 2 - Date.now()));
  expect(Date.now()).toBeLessThan(answered + MODEL_MS);
  await expect(patch).toBeVisible();
  await expect(editor).toHaveCount(0);
  // A KEY NOW goes into nothing: the words are written, and it writes no second time.
  await page.keyboard.type('X');
  const held = await page.evaluate(() => {
    const state = (window as unknown as { held: { frames: number; bare: number; stop: boolean } }).held;
    state.stop = true;
    return { frames: state.frames, bare: state.bare };
  });
  // THE DECISION: no frame between the press and here showed the old words bare. CONTROL: frames were sampled at all.
  expect(held.frames).toBeGreaterThan(10);
  expect(held.bare).toBe(0);

  // AND THE AREA GOES once the page has drawn the version the write produced, which then shows the same words.
  await expect(page.locator('[data-text-edit-layer="0"] [data-kit-patch]')).toHaveCount(0, { timeout: MODEL_MS + 10_000 });
  expect(sent).toHaveLength(1);
});

