import { type Page, expect, test } from '@playwright/test';

import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Every sentence in every dialog is spaced by ONE token (MMMMMMM-5, the owner's decision of 2026-10-17, 5a).
 *
 * Measured 2026-10-03: 144 of 233 gallery states drew a paragraph with the browser's own block margin, about 12 px, in a
 * column whose gap is 8 — so a sentence sat 12 from the dialog's top, 32 from the next — while the problem dialogs zeroed
 * it, and one-sentence dialogs read differently from each other. This walks EVERY state of every registered dialog in
 * the gallery and reads, for each paragraph in a dialog's body, its own margins: none may come from anywhere but the
 * token. Layout, so pinned Chromium: happy-dom computes no margins.
 */

/** Where `visual.config.mjs` serves the gallery, beside the application. */
const GALLERY = process.env['MONSTERA_GALLERY_ORIGIN'] ?? 'http://localhost:4175';

interface GalleryIndex {
  readonly registered: readonly string[];
  readonly states: Readonly<Record<string, readonly string[]>>;
}

interface Paragraph {
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  /** The drawn space from the paragraph before it, where its previous sibling is one; else null. */
  readonly fromPrevious: number | null;
}

/** Every paragraph in the open dialog's body, with its computed block margins and its distance from a paragraph above. */
async function paragraphsOf(page: Page): Promise<readonly Paragraph[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"] .m-dialog__body p')].map((each) => {
      const style = getComputedStyle(each);
      const previous = each.previousElementSibling;
      return {
        text: each.textContent.slice(0, 40),
        top: Number.parseFloat(style.marginBlockStart),
        bottom: Number.parseFloat(style.marginBlockEnd),
        fromPrevious:
          previous instanceof HTMLParagraphElement && previous.getClientRects().length > 0 && each.getClientRects().length > 0
            ? each.getBoundingClientRect().top - previous.getBoundingClientRect().bottom
            : null,
      };
    }),
  );
}

test('every paragraph in every dialog state takes its spacing from the column, with no margin of its own', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  });
  await bridgeUnder(page, LOOKS[0]);
  await page.goto(`${GALLERY}/gallery.html`);
  const index = await page.evaluate(() => (window as unknown as { __dialogGallery: GalleryIndex }).__dialogGallery);
  // THE POSITIVE CONTROL: a sweep that opened nothing would find no margin anywhere.
  expect(index.registered.length).toBeGreaterThan(100);

  const token = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dialog-sentence-gap')),
  );
  expect(token, 'the token resolves to a length').toBeGreaterThan(0);
  const offending: string[] = [];
  let paragraphs = 0;
  let pairs = 0;
  let states = 0;
  for (const id of index.registered) {
    for (const state of index.states[id] ?? []) {
      await page.goto(`${GALLERY}/gallery.html?dialog=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}`);
      const dialog = page.getByRole('dialog').last();
      try {
        await expect(dialog).toBeVisible({ timeout: 5_000 });
      } catch {
        continue;
      }
      await page.waitForTimeout(150);
      states += 1;
      for (const paragraph of await paragraphsOf(page)) {
        paragraphs += 1;
        if (paragraph.top !== 0 || paragraph.bottom !== 0) {
          offending.push(`${id} / ${state}: "${paragraph.text}" margins ${String(paragraph.top)} / ${String(paragraph.bottom)}`);
        }
        // TWO SENTENCES IN A ROW ARE ONE TOKEN APART: a paragraph whose margin went and whose parent is a plain block
        // would sit flush on the one above, which no margin reading shows.
        if (paragraph.fromPrevious !== null) {
          pairs += 1;
          if (Math.abs(paragraph.fromPrevious - token) > 0.5) {
            offending.push(`${id} / ${state}: "${paragraph.text}" ${paragraph.fromPrevious.toFixed(1)} px below the sentence above`);
          }
        }
      }
    }
  }
  console.log(
    `swept ${String(states)} states, ${String(paragraphs)} paragraphs, ${String(pairs)} pairs, ${String(offending.length)} off the token`,
  );
  // AND IT SAW PARAGRAPHS AND PAIRS: a selector that matched none would pass every state.
  expect(paragraphs).toBeGreaterThan(100);
  expect(pairs).toBeGreaterThan(10);
  expect(offending, offending.join('\n')).toStrictEqual([]);
});
