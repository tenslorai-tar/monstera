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

/** The commands sent so far, as their kind, the annotation's type and how many points it carries. */
function drawn(
  sent: readonly Sent[],
): { kind: string | undefined; type: string | undefined; points: number | undefined }[] {
  return sent
    .filter((each) => each.channel === 'document.execute')
    .map((each) => {
      const command = (each.params as { command?: { kind?: string; annotation?: { type?: string; points?: unknown[] } } })
        .command;
      return { kind: command?.kind, type: command?.annotation?.type, points: command?.annotation?.points?.length };
    });
}

// THE OWNER'S ITEM 14b, with the browser's own clicks and keys: a key reaches the drawing only if the surface has the
// focus, which a synthetic key event dispatched at it cannot show.
test('CONNECTED LINES finish on Enter, and a POLYGON on Escape keeps its corners (14b)', async ({ page }) => {
  const sent: Sent[] = [];
  await openWithText(page, sent);
  const slot = page.locator('.m-page-slot').first();
  const box = await slot.boundingBox();
  if (box === null) throw new Error('the page has a box');
  const at = (x: number, y: number): [number, number] => [box.x + box.width * x, box.y + box.height * y];

  await chooseTool(page, 'Connected lines');
  for (const corner of [at(0.2, 0.2), at(0.5, 0.25), at(0.35, 0.4)]) await page.mouse.click(...corner);
  await page.keyboard.press('Enter');
  await expect.poll(() => drawn(sent).length, { timeout: 5_000 }).toBe(1);
  expect(drawn(sent)[0]).toStrictEqual({ kind: 'addAnnotation', type: 'polyline', points: 3 });

  await chooseTool(page, 'Polygon');
  for (const corner of [at(0.55, 0.2), at(0.8, 0.2), at(0.7, 0.4)]) await page.mouse.click(...corner);
  await page.keyboard.press('Escape');
  await expect.poll(() => drawn(sent).length, { timeout: 5_000 }).toBe(2);
  expect(drawn(sent)[1]).toStrictEqual({ kind: 'addAnnotation', type: 'polygon', points: 3 });
});

test('a POLYGON closed on its FIRST corner by a real double-click starts no second shape (14b)', async ({ page }) => {
  const sent: Sent[] = [];
  await openWithText(page, sent);
  await chooseTool(page, 'Polygon');
  const slot = page.locator('.m-page-slot').first();
  const box = await slot.boundingBox();
  if (box === null) throw new Error('the page has a box');
  const at = (x: number, y: number): [number, number] => [box.x + box.width * x, box.y + box.height * y];
  for (const corner of [at(0.3, 0.2), at(0.6, 0.2), at(0.5, 0.4)]) await page.mouse.click(...corner);
  await page.mouse.dblclick(...at(0.3, 0.2));
  await expect.poll(() => drawn(sent).length, { timeout: 5_000 }).toBe(1);
  expect(drawn(sent)[0]).toStrictEqual({ kind: 'addAnnotation', type: 'polygon', points: 3 });
  // A LEFT-BEHIND SHAPE would take these two clicks and an Enter as a second polygon's corners; with none live,
  // two corners and Enter are a drawing still going on, and nothing more is sent.
  for (const corner of [at(0.3, 0.5), at(0.6, 0.5)]) await page.mouse.click(...corner);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(drawn(sent)).toHaveLength(1);
});

test('a POLYGON is finished by a real double-click, and its corners are the ones placed (F-C5)', async ({ page }) => {
  // THE BROWSER'S OWN EVENTS, which is the point: Chromium puts no click count on a pointer event, and a synthetic
  // event carrying one is what let this pass while no polygon could be finished.
  const sent: Sent[] = [];
  await openWithText(page, sent);
  await chooseTool(page, 'Polygon');

  const slot = page.locator('.m-page-slot').first();
  const box = await slot.boundingBox();
  if (box === null) throw new Error('the page has a box');
  const at = (x: number, y: number): [number, number] => [box.x + box.width * x, box.y + box.height * y];
  // IN THE PART OF THE PAGE ON SCREEN: the page is taller than the window, so its lower part is under the status bar.
  for (const corner of [at(0.3, 0.25), at(0.6, 0.25)]) await page.mouse.click(...corner);
  // THE THIRD CORNER, by double-click: two presses and the `dblclick` the platform sends after them.
  await page.mouse.dblclick(...at(0.6, 0.4));

  await expect
    .poll(() => sent.filter((each) => each.channel === 'document.execute').length, { timeout: 5_000 })
    .toBe(1);
  const command = (sent.find((each) => each.channel === 'document.execute')?.params as { command?: unknown }).command as
    | { kind?: string; annotation?: { type?: string; points?: unknown[] } }
    | undefined;
  expect(command?.kind).toBe('addAnnotation');
  expect(command?.annotation?.type).toBe('polygon');
  // THREE CORNERS: the double-click's second press is the same corner, not a fourth.
  expect(command?.annotation?.points).toHaveLength(3);
});
