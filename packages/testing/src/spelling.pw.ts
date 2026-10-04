import { AxeBuilder } from '@axe-core/playwright';
import { asDocId, asDocVersion, tokensOf } from '@monstera/shared';
import { PDFDocument } from '@cantoo/pdf-lib';
import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * The Spelling tab (ADR-0156) on a rendered page, against the shim: the review opens beside the page, the word is
 * marked ON the page through the find highlight, the panel fits the window in every look, and Replace sends a point
 * that lies inside the word as PDF.js placed the page. The kernel half of the pair is `pdfiumReplaceAt.test.ts` and
 * `proof:pdfiumcommand`'s `replaceTextAt` records.
 *
 * ## The two numbers meet here
 *
 * The word's box is stated in the page's display space at scale 1 (the shim answers it as the engine would), and the
 * point the renderer sends is in PDF user space, converted through the crop PDF.js drew the page with. On a 612 x 792
 * page at rotation 0 the two are related by y = 792 - y, so the case asserts the point is inside the word's box under
 * that relation: a point converted through the wrong box, or not converted at all, lands outside it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000005e3');
const BLOCKING = new Set(['serious', 'critical']);
const CHARACTER = 6;

/** Two lines in the page's display space, with each token's box as `tokensOf` cuts it, 6 points a character. */
const LINES = [
  { text: 'spelling page documnet', box: { x0: 72, y0: 100, x1: 300, y1: 114 } },
  { text: 'page speling', box: { x0: 72, y0: 130, x1: 200, y1: 144 } },
];
const WORD_BOXES = LINES.map((line) => ({
  ...line,
  boxes: [...tokensOf(line.text)].flatMap((token) => [
    line.box.x0 + token.index * CHARACTER,
    line.box.y0,
    line.box.x0 + (token.index + token.text.length) * CHARACTER,
    line.box.y1,
  ]),
}));

interface Executed {
  readonly command: { readonly kind: string; readonly [key: string]: unknown };
}

async function onePagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

async function opened(page: Page, look: Look, size: { width: number; height: number }, executed: Executed[]): Promise<void> {
  await page.setViewportSize(size);
  const bytes = await onePagePdf();
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'letter.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      pageLinesPlaced: [LINES],
      pageWordBoxes: [WORD_BOXES],
    },
    (channel, params) => {
      if (channel === 'document.execute') executed.push(params as Executed);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
}

async function spellCheck(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill('Spell check');
  await page.getByRole('option', { name: /^Spell check\b/u }).first().click();
  await expect(page.locator('.m-spelling__word')).toHaveText('documnet');
}

/** The text the find highlight's ACTIVE ranges cover on the page — the occurrence the review is on. */
function activeHighlight(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(CSS.highlights.get('monstera-find-active') ?? [])].map((range) => (range instanceof Range ? range.toString() : '')),
  );
}

for (const look of LOOKS) {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 760, height: 560 },
  ]) {
    test(`${look.name} at ${String(size.width)} × ${String(size.height)}: SPELL CHECK opens the Spelling tab on the first word, marks it on the page, fits, and passes axe`, async ({
      page,
    }) => {
      const executed: Executed[] = [];
      await opened(page, look, size, executed);
      await spellCheck(page);

      await expect(page.getByRole('tab', { name: 'Spelling' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.m-spelling__context mark')).toHaveText('documnet');
      // ON THE PAGE, the one occurrence the panel shows, through the text layer the page draws.
      await expect.poll(() => activeHighlight(page)).toStrictEqual(['documnet']);

      // FITS: the panel inside the window, and nothing in it wider than the panel.
      const fit = await page.locator('.m-spelling').evaluate((panel) => {
        const box = panel.getBoundingClientRect();
        return {
          inside: box.left >= 0 && box.right <= window.innerWidth + 0.5 && box.width > 0,
          overflow: panel.scrollWidth - panel.clientWidth,
        };
      });
      expect(fit).toStrictEqual({ inside: true, overflow: 0 });

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
      expect(blocking, blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n')).toEqual([]);
      // CONTROL: opening the review sent nothing to the document.
      expect(executed).toStrictEqual([]);
    });
  }
}

test('REPLACE sends replaceTextAt with a point INSIDE the word as PDF.js placed the page, and the review goes on to the next', async ({
  page,
}) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], { width: 1280, height: 800 }, executed);
  await spellCheck(page);
  await expect(page.getByLabel('Change to')).toHaveValue('document');

  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => executed.length).toBe(1);
  const command = executed[0]?.command as { kind: string; page: number; find: string; replace: string; at: { x: number; y: number } };
  expect({ kind: command.kind, page: command.page, find: command.find, replace: command.replace }).toStrictEqual({
    kind: 'replaceTextAt',
    page: 0,
    find: 'documnet',
    replace: 'document',
  });
  // `documnet` is at offset 14 of line 0: x from 72 + 14 x 6 = 156 to 72 + 22 x 6 = 204, and the line runs from y 100
  // to 114 in display space, which is 678 to 692 in PDF user space on a 792-point page.
  expect(command.at.x).toBeGreaterThan(156);
  expect(command.at.x).toBeLessThan(204);
  expect(command.at.y).toBeGreaterThan(678);
  expect(command.at.y).toBeLessThan(692);

  // THE NEXT WORD, read again after the edit: the shim does not change its text, so the same `documnet` is still there,
  // and the review goes on past it rather than offering it again.
  await expect(page.locator('.m-spelling__word')).toHaveText('speling');
  await expect.poll(() => activeHighlight(page)).toStrictEqual(['speling']);
});
