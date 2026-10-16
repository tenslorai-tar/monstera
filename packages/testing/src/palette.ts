import { type Page, expect } from '@playwright/test';

/**
 * Runs a command by its EXACT title through the command palette, as a person may: the ONE way a test or a walk drives
 * the palette (B3a). The rendered tests import it, and the walks, which are plain Node, import its built copy.
 *
 * ## Why the whole title
 *
 * The palette filters by substring and keeps registry order without ranking (`CommandPalette.tsx`), and a match by
 * `hasText` or a `^Title\b` pattern is a prefix or a substring too. So "Watermark…" ran "Edit watermark…" and the app
 * said there was no watermark to change (session 3, 36755ef6), and four drivers each held their own copy of the rule,
 * some still matching by substring.
 *
 * ## A title that names nothing fails AT ONCE, naming what is there
 *
 * The registry is the authority on what a command is called, and only the running app holds it, so this is where a
 * wrong title is caught: the exports walk's O2 asked for "Export tables to Excel" while the command is "Export tables
 * to Excel…" and waited 30 s as though the command were missing (2026-10-16). Now it says which titles the palette
 * offered for the words typed.
 */
export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  const choice = page.getByRole('option').filter({ has: page.locator('.m-palette-title').getByText(title, { exact: true }) });
  try {
    await expect(choice).toHaveCount(1, { timeout: 10_000 });
  } catch {
    const offered = await page.locator('.m-palette-title').allInnerTexts();
    throw new Error(`no command is titled exactly "${title}"; for those words the palette offered: ${offered.slice(0, 10).join(' | ') || '(nothing)'}`);
  }
  await choice.click();
}
