import { expect, test } from '@playwright/test';

import { LINES, dragLetters, laidOut, openAgreement, paintedIn, selectSpan } from './agreementLetters.js';

/**
 * ADR-0280's TWO RULES, in Chromium, on the agreement page's Times lines with their letters stated as the engine reads
 * them (`agreementLetters.ts`):
 *
 * - **rule (i)**, the selection is painted from its range alone, over the engine's letters;
 * - **rule (ii)**, a letter's side is decided from the engine's letters, for a press and a drag's moving end.
 *
 * The layer is drawn in `monospace`, whose letters stand far from Times', so every rule that read the browser's layout
 * instead would land visibly elsewhere — the control on each case measures how far.
 */

test('RULE (i): the selection is painted over the engine’s letters, from its range alone', async ({ page }) => {
  const agreement = await openAgreement(page);
  await selectSpan(page, 0, 5, 30);
  const [shape, ...rest] = await paintedIn(page, 'selection');
  expect(rest).toStrictEqual([]);
  const xs = (shape ?? []).map((point) => point.x);
  const left = agreement.inLayer(0, 5).x;
  const right = agreement.inLayer(0, 30).x;
  expect(Math.abs(Math.min(...xs) - left), `painted left ${String(Math.min(...xs))} against the engine's ${String(left)}`).toBeLessThan(0.5);
  expect(Math.abs(Math.max(...xs) - right), `painted right ${String(Math.max(...xs))} against the engine's ${String(right)}`).toBeLessThan(0.5);
  // CONTROL: the browser lays the same span out elsewhere, so a painter that read the DOM would have failed above.
  const dom = await laidOut(page, 0, 5, 30);
  expect(Math.max(Math.abs(dom.left - left), Math.abs(dom.right - right))).toBeGreaterThan(5);
});

test('RULE (ii): a drag selects the letters the engine has under its two ends, not the substitute’s', async ({ page }) => {
  const agreement = await openAgreement(page);
  // EACH END ON A LETTER'S SECOND HALF, by the engine: letter 10 and letter 40, so the caret goes after each.
  expect(await dragLetters(page, agreement, 0, 10, 40)).toBe(LINES[0]?.text.slice(11, 41));
});

test('CONTROL: on a line placed as before, the same drag is the browser’s and lands elsewhere', async ({ page }) => {
  const agreement = await openAgreement(page, { bare: 0 });
  expect(await dragLetters(page, agreement, 0, 10, 40)).not.toBe(LINES[0]?.text.slice(11, 41));
});
