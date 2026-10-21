import { type Page, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';
import { runCommand } from './palette.js';

/**
 * The status bar's start says only what the tool in hand does (the owner's R24), through the real application on the
 * pinned Chromium.
 *
 * ## The WHOLE start region is read, never the tool line's own span
 *
 * The cases that already read the tool line (`pageWriting.pw.ts`) read `.m-status-mode` alone, and every one of them
 * was green while a rotating tip sat beside it in the same region: *"… Esc gets you out. Redo: press Ctrl+Y."* A
 * sentence added anywhere in the start makes the region's text differ from the tool's, so an exact match on the region
 * is what separates *the line says the tool* from *the line says the tool and something else*. Run against the build
 * that still drew a tip, every case here was red (2026-10-21).
 */

const START = '.m-status-start';

/** Each tool the owner named, by its palette title, and the line it must show: its instruction and the one Escape. */
const TOOLS: readonly { readonly title: string; readonly line: string }[] = [
  {
    title: 'Highlight an area of the page',
    line: 'Drag a box over the part of the page you want to stand out, such as a picture or a scan. Esc gets you out.',
  },
  { title: 'Highlight text', line: 'Select the words you want to stand out. Esc gets you out.' },
  { title: 'Underline text', line: 'Select the words you want underlined. Esc gets you out.' },
  { title: 'Text box', line: 'Drag out a box, then type your words in it. Esc gets you out.' },
  { title: 'Select annotations', line: 'Click a mark to pick it, or drag around a few at once. Esc gets you out.' },
  { title: 'Measure distance', line: 'Drag from one point to the other to see how far apart they are. Esc gets you out.' },
];

async function opened(page: Page): Promise<void> {
  await openApp(page);
  await openDocument(page);
}

for (const tool of TOOLS) {
  test(`with ${tool.title} in hand, the bar's start says its instruction and that Esc gets you out, and nothing else`, async ({
    page,
  }) => {
    await opened(page);
    await runCommand(page, tool.title);
    await expect(page.locator(START)).toHaveText(tool.line);
    // ONE thing in the start, the tool line: a second element there, faded out or hidden, is a second voice the region
    // carries, which a text match on a hidden span would not see.
    await expect(page.locator(`${START} > *`)).toHaveCount(1);
  });
}

test('with NO tool in hand, the start says nothing at all, and a page outside the document is still said there', async ({
  page,
}) => {
  await opened(page);
  await expect(page.locator(START)).toHaveText('');
  await expect(page.locator(`${START} > *`)).toHaveCount(0);
  // CONTROL: the region is drawn and does carry the state it owns. A page the document does not have is said here, so
  // an empty start above is the absence of a tip and not a region that draws nothing.
  const field = page.getByRole('textbox', { name: 'Go to page' });
  await field.fill('999');
  await field.press('Enter');
  await expect(page.locator(START)).toHaveText(/^This document has pages 1 to \d+\.$/u);
});
