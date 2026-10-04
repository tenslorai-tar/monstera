import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';
import { runCommand, samplePdf } from './helpScreensHarness.js';

/**
 * EVERY EXPORT TO ANOTHER FORMAT, AND PRINT, SENDS THE PAGES ITS DIALOG'S ROW CHOSE (ADR-0161, cloud-4 item 9d).
 *
 * The UI half of the pair: the kernel and main halves are `wordPictures.test.ts`, `layoutText.test.ts`,
 * `printing.test.ts` and main's `documentCommands.test.ts`, which write only the chosen pages. This half drives the
 * real dialog in the built renderer — *Select pages*, a typed range, the button — and reads the request that left, so
 * a row drawn but not read, or a command that sent every page, fails here.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000e9');

async function opened(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await samplePdf();
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'report.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect.poll(() => page.locator('canvas:visible').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
}

const CASES = [
  { command: 'Export to Word…', dialog: 'Export to Word', apply: 'Choose where to save…', channel: 'document.exportWord' },
  {
    command: 'Export to PowerPoint…',
    dialog: 'Export to PowerPoint',
    apply: 'Choose where to save…',
    channel: 'document.exportPowerPoint',
  },
  { command: 'Export text…', dialog: 'Export text', apply: 'Choose where to save…', channel: 'document.exportText' },
  {
    command: 'Export text with layout…',
    dialog: 'Export text with layout',
    apply: 'Choose where to save…',
    channel: 'document.exportText',
  },
  { command: 'Print…', dialog: 'Print', apply: 'Choose a printer…', channel: 'document.print' },
] as const;

for (const each of CASES) {
  test(`${each.dialog}: Select pages 2 sends page 2 alone, and Every page sends them all`, async ({ page }) => {
    const sent: { channel: string; params: unknown }[] = [];
    await opened(page, sent);

    await runCommand(page, each.command);
    const dialog = page.getByRole('dialog', { name: each.dialog, exact: true });
    await dialog.getByRole('button', { name: 'Select pages' }).click();
    await dialog.getByRole('textbox', { name: 'Page numbers' }).fill('2');
    await dialog.getByRole('button', { name: each.apply }).click();
    await expect.poll(() => sent.filter((one) => one.channel === each.channel).length).toBe(1);
    // ZERO-BASED, as runs: the second page a person reads is page 1.
    expect((sent.find((one) => one.channel === each.channel)?.params as { pages: unknown }).pages).toStrictEqual([1]);

    // CONTROL: every page, as the row opens, is the whole document, so the case above is the row's doing.
    await runCommand(page, each.command);
    await page.getByRole('dialog', { name: each.dialog, exact: true }).getByRole('button', { name: each.apply }).click();
    await expect.poll(() => sent.filter((one) => one.channel === each.channel).length).toBe(2);
    const every = sent.filter((one) => one.channel === each.channel)[1]?.params as { pages: unknown };
    // THE SAMPLE'S EIGHT PAGES, as one run.
    expect(every.pages).toStrictEqual([[0, 7]]);
  });
}
