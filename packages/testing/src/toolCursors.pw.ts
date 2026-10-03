import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';
import { pageShown } from './settled.js';

/**
 * Each tool's pointer, and the highlighter's gesture, in a real browser (the owner's review of 0.1.6.0,
 * `cursors_16s`, `40s`, `60s`: the crosshair was every tool's, and Highlight drew a line between where a drag started
 * and ended, which is ambiguous between two lines of text).
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000b7');

/** Every command the page sent, by channel, for the case that asserts what a release dispatched. */
interface Sent {
  readonly channel: string;
  readonly params: unknown;
}

async function openWithText(page: Page, sent: Sent[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'words.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      pageLines: [['Quarterly totals for the north region', 'Revenue rose on the strength of new contracts']],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('[data-text-layer="0"] [data-text-line]')).toHaveCount(2);
  // THE PANE SHOWN: the lines mount while it is still hidden for its first frame.
  await pageShown(page);
}

async function chooseTool(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  await page.getByRole('option', { name: new RegExp(`^${title}\\b`, 'u') }).first().click();
}

/** The cursor the page shows at the middle of the first page, read from whatever element is under that point. */
async function cursorOverPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const slot = document.querySelector('.m-page-slot');
    if (slot === null) return 'no page';
    const box = slot.getBoundingClientRect();
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return under === null ? 'nothing' : getComputedStyle(under).cursor;
  });
}

test('each TOOL shows its own pointer: the arrow to pick or place, the I-beam on text, the crosshair to draw', async ({ page }) => {
  await openWithText(page, []);
  const wanted: Readonly<Record<string, string>> = {
    'Select annotations': 'default',
    Note: 'default',
    'Highlight text': 'text',
    Rectangle: 'crosshair',
  };
  for (const [title, cursor] of Object.entries(wanted)) {
    await chooseTool(page, title);
    await expect(page.locator('.m-palette-query')).toHaveCount(0);
    // POLLED FOR THE TOOL'S POINTER: the palette closing is not the tool's surface mounting over the page, so one read
    // straight after it can be the previous tool's pointer. A wrong pointer still fails, naming what was received.
    await expect.poll(() => cursorOverPage(page), title).toBe(cursor);
  }
});

test('HIGHLIGHT selects the words as they are dragged over, and marks exactly that selection on release', async ({ page }) => {
  const sent: Sent[] = [];
  await openWithText(page, sent);
  await chooseTool(page, 'Highlight text');

  const line = page.locator('[data-text-layer="0"] [data-text-line]').first();
  const box = await line.boundingBox();
  if (box === null) throw new Error('the first line has a box');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  // THE WORDS ARE SELECTED WHILE DRAGGING, the browser's own selection: this is what a person sees light up, and
  // what a drawing surface over the page made impossible.
  const during = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  expect(during.length).toBeGreaterThan(5);
  await page.mouse.up();

  await expect
    .poll(() => sent.filter((each) => each.channel === 'document.execute').length, { timeout: 5_000 })
    .toBeGreaterThan(0);
  const command = (sent.filter((each) => each.channel === 'document.execute').at(-1)?.params as { command?: unknown }).command as
    | { kind?: string; annotation?: { type?: string } }
    | undefined;
  expect(command?.kind).toBe('addAnnotation');
  expect(command?.annotation?.type).toBe('highlight');
  // AND THE SELECTION IS SPENT once it is a mark.
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');
});
