import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * Words typed where they go (ADR-0154), in a real browser: the tools' cases see which request a gesture makes, and the
 * editor's see what each way of ending one answers in happy-dom, which lays nothing out and fires no blur when a
 * focused node is removed. This holds the two ends together — the press on the page, the box drawn over it, and the
 * command the words become — and the one thing only a browser does: take the box off the page.
 */

const FIRST = asDocId('00000000-0000-4000-8000-0000000000f1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000f2');
const BLOCKING = new Set(['serious', 'critical']);

/** What the page asked main to run, in the order it asked. */
interface Executed {
  readonly docId: string;
  readonly command: { readonly kind: string; readonly annotation?: Record<string, unknown> };
}

async function onePagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/** Opens `count` one-page documents, the last on show, and answers what the page runs into `executed`. */
async function opened(page: Page, look: Look, count: 1 | 2, executed: Executed[]): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  const bytes = await onePagePdf();
  const ids = count === 1 ? [FIRST] : [FIRST, SECOND];
  await bridgeUnder(
    page,
    look,
    {
      opens: ids.map((docId, at) => ({
        kind: 'opened' as const,
        docId,
        version: asDocVersion(1),
        byteLength: bytes.byteLength,
        name: at === 0 ? 'first.pdf' : 'second.pdf',
      })),
      documentBytes: new Map(ids.map((docId) => [docId, bytes])),
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel, params) => {
      if (channel === 'document.execute') executed.push(params as Executed);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  if (count === 2) {
    await page.getByRole('button', { name: 'Open another document' }).click();
    await expect(page.locator(`[data-tab-select="${SECOND}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-document-layer="active"] canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
  }
}

async function chooseTool(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.m-palette-query').fill(title);
  await page.getByRole('option', { name: new RegExp(`^${title}\\b`, 'u') }).first().click();
}

/** The drawing surface over the first page of the document on show. */
function surface(page: Page): Locator {
  return page.locator('[data-document-layer="active"]').getByLabel('Draw on page 1');
}

/** A press, a move and a release on the surface, from and to points measured from its top-left corner. */
async function dragOn(page: Page, from: readonly [number, number], to: readonly [number, number]): Promise<void> {
  const box = await surface(page).boundingBox();
  if (box === null) throw new Error('the drawing surface is not on screen');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

/** WCAG's contrast ratio between an element's computed outline colour and the page's paper, `--page`. */
async function outlineAgainstPage(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const luminance = (css: string): number => {
      const probe = document.createElement('span');
      probe.style.color = css;
      document.body.append(probe);
      const parts = getComputedStyle(probe).color.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      probe.remove();
      const [red = 0, green = 0, blue = 0] = parts.map((part) => {
        const channel = part / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const outline = luminance(getComputedStyle(node).outlineColor);
    const paper = luminance(getComputedStyle(node).getPropertyValue('--page').trim());
    return (Math.max(outline, paper) + 0.05) / (Math.min(outline, paper) + 0.05);
  });
}

async function expectNoBlocking(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
  expect(blocking, blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n')).toEqual([]);
}

for (const look of LOOKS) {
  test(`TEXT BOX: the words are typed in the box drawn, and a press on the page finishes them — ${look.name}`, async ({ page }) => {
    const executed: Executed[] = [];
    await opened(page, look, 1, executed);
    await chooseTool(page, 'Text box');
    await dragOn(page, [80, 60], [320, 140]);

    // THE BOX IS WHERE THE DRAG WAS, with the caret in it: no dialog over the page.
    const box = page.getByRole('textbox', { name: 'Text box' });
    await expect(box).toBeFocused();
    expect(await page.getByRole('dialog').count()).toBe(0);
    const surfaceBox = await surface(page).boundingBox();
    const drawn = await box.boundingBox();
    if (surfaceBox === null || drawn === null) throw new Error('nothing on screen');
    expect(Math.abs(drawn.x - (surfaceBox.x + 80))).toBeLessThan(2);
    expect(Math.abs(drawn.y - (surfaceBox.y + 60))).toBeLessThan(2);
    expect(Math.abs(drawn.width - 240)).toBeLessThan(2);

    await page.keyboard.type('See figure 3');
    await expectNoBlocking(page);
    // THE OUTLINE IS ON THE PAPER, and clears 3:1 against it in every look. CONTROL, measured 2026-10-04: the accent
    // itself is 2.54:1 on white in dark and 1.49:1 in high contrast, so an outline left in the token fails here.
    expect(await outlineAgainstPage(box)).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: test.info().outputPath(`text-box-${look.name}.png`) });

    // A PRESS ELSEWHERE ON THE PAGE finishes the words and goes no further: one command, and no second box.
    const surfaceAt = await surface(page).boundingBox();
    if (surfaceAt === null) throw new Error('the drawing surface is not on screen');
    await page.mouse.click(surfaceAt.x + 400, surfaceAt.y + 500);
    await expect.poll(() => executed.length).toBe(1);
    expect(executed[0]?.command).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'text-box', text: 'See figure 3' } });
    await expect(page.getByRole('textbox', { name: 'Text box' })).toHaveCount(0);
  });
}

test('TYPEWRITER: a click opens a box that GROWS with the words, and Escape finishes them', async ({ page }) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 1, executed);
  await chooseTool(page, 'Typewriter');
  await dragOn(page, [80, 60], [80, 60]);
  const box = page.getByRole('textbox', { name: 'Type onto the page' });
  await expect(box).toBeFocused();
  const before = await box.boundingBox();
  await page.keyboard.type('Received 1 October 2026');
  const after = await box.boundingBox();
  if (before === null || after === null) throw new Error('nothing on screen');
  // WIDER BY THE WORDS: a box of one size would wrap them in a sliver.
  expect(after.width).toBeGreaterThan(before.width + 100);
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ annotation: { type: 'typewriter', text: 'Received 1 October 2026' } });
});

test('NOTE: a click opens a box for the comment where it was clicked, and Ctrl+Enter finishes it', async ({ page }) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 1, executed);
  await chooseTool(page, 'Note');
  await dragOn(page, [200, 100], [200, 100]);
  const box = page.getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  const surfaceBox = await surface(page).boundingBox();
  const card = await box.boundingBox();
  if (surfaceBox === null || card === null) throw new Error('nothing on screen');
  // BESIDE THE POINT CLICKED: below it and from its left, where the page has room.
  expect(card.x).toBeGreaterThanOrEqual(surfaceBox.x + 200);
  expect(card.y).toBeGreaterThanOrEqual(surfaceBox.y + 100);
  await page.keyboard.type('Check this figure');
  await expectNoBlocking(page);
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ annotation: { type: 'sticky-note', text: 'Check this figure' } });
});

test('A REQUEST BELONGS TO ITS DOCUMENT: another on show takes the box off the page and nothing is sent; back, the words are there', async ({
  page,
}) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 2, executed);
  // ON THE FIRST DOCUMENT: the second is on show after opening both.
  await page.locator(`[data-tab-select="${FIRST}"]`).click();
  await chooseTool(page, 'Text box');
  await dragOn(page, [80, 60], [320, 140]);
  await page.keyboard.type('half a sentence');

  // A SWITCH THAT MOVES NO FOCUS — a programmatic click, as a file dropped on the window opens one — so the box leaves
  // the page with its focus still in it. Chromium then fires a blur at the removal; answering it would add the box to
  // the first document behind the person's back.
  await page.locator(`[data-tab-select="${SECOND}"]`).evaluate((tab) => {
    (tab as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: 'Text box' })).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(executed).toStrictEqual([]);

  // BACK ON THE FIRST: drawn again, with its words and the caret, and it finishes as it would have.
  await page.locator(`[data-tab-select="${FIRST}"]`).evaluate((tab) => {
    (tab as HTMLButtonElement).click();
  });
  const box = page.getByRole('textbox', { name: 'Text box' });
  await expect(box).toHaveValue('half a sentence');
  await expect(box).toBeFocused();
  await page.keyboard.type(' and the rest');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]).toMatchObject({
    docId: FIRST,
    command: { annotation: { type: 'text-box', text: 'half a sentence and the rest' } },
  });
});

test('CONTROL: the same switch made BY A CLICK on the tab is a press elsewhere, and finishes the words first', async ({
  page,
}) => {
  // The case above and this one differ only in whether focus leaves the box before the switch. This one answers, on
  // the first document, so the silence above is the removal's and not an observer that cannot see an answer.
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 2, executed);
  await page.locator(`[data-tab-select="${FIRST}"]`).click();
  await chooseTool(page, 'Text box');
  await dragOn(page, [80, 60], [320, 140]);
  await page.keyboard.type('finished by the click');
  await page.locator(`[data-tab-select="${SECOND}"]`).click();
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]).toMatchObject({ docId: FIRST, command: { annotation: { text: 'finished by the click' } } });
});

test('A CLOSED DOCUMENT’S REQUEST sends nothing, and leaves the tool free for the next box', async ({ page }) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 2, executed);
  await page.locator(`[data-tab-select="${FIRST}"]`).click();
  await chooseTool(page, 'Text box');
  await dragOn(page, [80, 60], [320, 140]);
  await page.keyboard.type('never sent');
  await page.locator(`[data-tab-close="${FIRST}"]`).evaluate((close) => {
    (close as HTMLButtonElement).click();
  });
  await expect(page.locator(`[data-tab-select="${FIRST}"]`)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(executed).toStrictEqual([]);

  // CONTROL: the next box on the document left works, so the request was answered rather than left waiting. The tool
  // is the window's and is still on, so it is not chosen again — that would be a press that takes it off.
  await expect(surface(page)).toBeVisible();
  await dragOn(page, [80, 60], [320, 140]);
  await page.keyboard.type('on the second');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]).toMatchObject({ docId: SECOND, command: { annotation: { text: 'on the second' } } });
});
