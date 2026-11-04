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
 *
 * ## By its id, and whether it is offered at all, for the full walk
 *
 * Two commands share some titles (Translate), so a walk of every command picks the option by the command's id, which
 * the palette writes into each option's element id with every character but a letter, digit, `_` or `-` an underscore.
 * And a command whose `when` is false is simply not offered, which is an answer and not a failure: `ifOffered` closes
 * the palette and answers `false` there ({@link runCommandIfOffered}). The walk held its own copy of this driver for
 * both (`ranFromPalette`), the fifth copy this module exists to prevent, found by `palette.test.ts` on 2026-11-04.
 */
export async function runCommand(page: Page, title: string): Promise<void> {
  await runOne(page, title, undefined, false);
}

/** {@link runCommand} by the command's id, answering whether the palette offered it: `false`, the palette closed, if not. */
export async function runCommandIfOffered(page: Page, title: string, id: string): Promise<boolean> {
  return runOne(page, title, id, true);
}

async function runOne(page: Page, title: string, id: string | undefined, ifOffered: boolean): Promise<boolean> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  const choice =
    id === undefined
      ? page.getByRole('option').filter({ has: page.locator('.m-palette-title').getByText(title, { exact: true }) })
      : page.locator(`[role="option"][id$="-${id.replaceAll(/[^A-Za-z0-9_-]/gu, '_')}"]`);
  try {
    await expect(choice).toHaveCount(1, { timeout: ifOffered ? 1_000 : 10_000 });
  } catch {
    if (ifOffered) {
      await page.keyboard.press('Escape');
      return false;
    }
    const offered = await page.locator('.m-palette-title').allInnerTexts();
    throw new Error(`no command is titled exactly "${title}"; for those words the palette offered: ${offered.slice(0, 10).join(' | ') || '(nothing)'}`);
  }
  await choice.click();
  return true;
}
