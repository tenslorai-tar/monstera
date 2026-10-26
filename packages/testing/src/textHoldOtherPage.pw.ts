import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { expect, test } from '@playwright/test';

import { openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * The read a page keeps while its drawing is behind the document is the HOLD's, and only while a written editor on that
 * page waits for its words to be drawn
 * ([ADR-0261](../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md) Decision 7).
 *
 * Measured 2026-10-23 in `textWalk.mjs` (steps 4, W1 and W2): after a write on page 1, page 2's drawing was behind until
 * it drew again, and page 2 offered the read from before the write. An Add text box opened on it was keyed to that read,
 * and when page 2 drew the new version its read changed under the box, which closed with nothing sent: the typed words
 * were gone and Escape wrote nothing.
 *
 * The shim holds every view-model read for {@link MODEL_MS}, so after the write is answered page 2 cannot draw the new
 * version for that long: the box is opened inside that window and must outlive it.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000da');
const MODEL_MS = 2000;
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

test('an Add text box opened on another page while that page is still drawing survives its redraw, and Escape writes it', async ({ page }) => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < 2; at += 1) document.addPage([612, 792]).drawText('The first paragraph', { x: 100, y: 690, size: 12, font });
  const bytes = await document.save();
  const sent: string[] = [];
  await page.setViewportSize({ width: 1800, height: 1000 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Two.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [block(686, 'The first paragraph')],
      delays: { 'document.viewModel': MODEL_MS },
    },
    (channel, params) => {
      if (channel === 'document.execute') sent.push(JSON.stringify(params));
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas[data-page-canvas="1"]')).toBeVisible({ timeout: 20_000 });
  await runCommand(page, 'Edit text on the page');

  // A WRITE ON PAGE 1.
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  await page.keyboard.type(' grows');
  await page.keyboard.press('Escape');
  await expect.poll(() => sent.length).toBe(1);

  // AN ADD TEXT BOX ON PAGE 2 at once, while page 2 is still drawn from the version before the write.
  await runCommand(page, 'Add text');
  const surface = page.locator('[data-text-edit-layer="1"] [data-text-add-surface]');
  await expect(surface).toBeVisible({ timeout: 10_000 });
  // PAGE 2 IN THE WINDOW, its middle at the window's: it starts below page 1, where a press reaches nothing.
  await surface.evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface on page 2');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  // PAGE 2'S OWN: page 1's written editor may still be on screen as its words' look.
  const added = page.locator('[data-text-edit-layer="1"] [data-kit-surface]');
  await expect(added).toBeFocused();
  await page.keyboard.type('Added on page two');

  // PAST page 2's redraw: the box and its words are still there.
  await page.waitForTimeout(MODEL_MS + 1000);
  await expect(added).toHaveText('Added on page two');
  await page.keyboard.press('Escape');
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  // A MOMENT MORE for a write that should not come, then EXACTLY TWO: page 1's words once — the editor held as their look
  // is not written again when the palette takes the focus — and page 2's box with what was typed in it.
  await page.waitForTimeout(1500);
  const written = sent.map((each) => JSON.parse(each) as { command: { page: number; text: string; inserts?: unknown[] } });
  expect(written.map(({ command }) => command.page)).toStrictEqual([0, 1]);
  expect(written[0]?.command.text).toBe('The first paragraph grows');
  expect(JSON.stringify(written[1]?.command.inserts)).toContain('Added on page two');
});
