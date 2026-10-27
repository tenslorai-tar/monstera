import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * A paragraph in the editor is laid out in the direction of its own first strong letter (FEATURES row 154, ADR-0228's
 * bidirectional text): a paragraph that begins in Hebrew runs right to left, one that begins in English left to right.
 *
 * MEASURED BY WHERE THE LETTERS LAND, never by the declaration: a style attribute holding `unicode-bidi: plaintext` says
 * nothing about the paragraph it does not reach, and `unicode-bidi` is not inherited. A paragraph's closing `!` is
 * neutral, so it takes the paragraph's base direction and lands at that direction's END: the far left of a right-to-left
 * paragraph, the far right of a left-to-right one. The word order alone cannot separate the two, since a Hebrew word
 * after an English one is on the right in both.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000dc');
const RUN = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false } as const;

function block(y: number, text: string) {
  const box = { x0: 100, y0: y, x1: 400, y1: y + 14 };
  return { box, lines: [{ runs: [{ index: 3, text, style: RUN }], box, soft: false, baseline: y + 4 }], style: RUN, shape: { align: 'left' as const, firstIndent: 0 } };
}

/** Where each of `letters` is drawn in the open editor's words, in CSS pixels from the left. */
async function lettersAt(page: Page, letters: readonly string[]): Promise<number[]> {
  return page.locator(SURFACE).evaluate(
    (surface, words) => {
      const at = (word: string): number => {
        const walker = surface.ownerDocument.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const offset = (node.textContent ?? '').indexOf(word);
          if (offset === -1) continue;
          const range = surface.ownerDocument.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          return range.getBoundingClientRect().left;
        }
        throw new Error(`no “${word}” in the editor`);
      };
      return words.map(at);
    },
    letters,
  );
}

for (const shape of [
  { name: 'a paragraph that begins in Hebrew runs right to left: its closing mark is at its far left', text: 'שלום world!', rightToLeft: true },
  { name: 'CONTROL: a paragraph that begins in English runs left to right: its closing mark is at its far right', text: 'world שלום!', rightToLeft: false },
] as const) {
  test(shape.name, async ({ page }) => {
    const bytes = await (async () => {
      const document = await PDFDocument.create();
      document.addPage([612, 792]);
      return document.save();
    })();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await bridgeUnder(page, LOOKS[0], {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Bidi.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      textBlocks: [block(686, shape.text)],
    });
    await page.goto('/');
    await page.getByRole('button', { name: /^Open PDF/u }).first().click();
    await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible({ timeout: 20_000 });
    await runCommand(page, 'Edit text on the page');
    await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
    const [mark = 0, hebrew = 0, latin = 0] = await lettersAt(page, ['!', 'ש', 'w']);
    const leftmost = mark < Math.min(hebrew, latin);
    const rightmost = mark > Math.max(hebrew, latin);
    expect(shape.rightToLeft ? leftmost : rightmost, `“!” at ${String(mark)}, Hebrew at ${String(hebrew)}, English at ${String(latin)}`).toBe(true);
  });
}
