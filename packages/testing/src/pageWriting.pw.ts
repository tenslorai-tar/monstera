import { AxeBuilder } from '@axe-core/playwright';
import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import type { BrowserShimOptions } from './browserShim.js';
import { againstPaper } from './contrast.js';
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
    expect(await againstPaper(box, 'outline-color')).toBeGreaterThanOrEqual(3);
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

/** The highlight the reply and edit cases answer, in PDF user space on a 612 × 792 page. */
const MARK = { x0: 100, y0: 600, x1: 300, y1: 620 };

/** A mark the shim lists, less where it is: every seeded mark here sits at {@link MARK} on page 1. */
type SeededMark = Omit<NonNullable<BrowserShimOptions['annotations']>[number], 'page' | 'index' | 'rect'>;

/** One page carrying `mark` at {@link MARK}, open, with every command it sends recorded. */
async function openedWithMark(page: Page, executed: Executed[], mark: SeededMark): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  const bytes = await onePagePdf();
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened', docId: FIRST, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'first.pdf' }],
      documentBytes: new Map([[FIRST, bytes]]),
      annotations: [{ page: 0, index: 0, rect: MARK, ...mark }],
      settings: { 'appearance.ribbon-section': 'comment' },
    },
    (channel, params) => {
      if (channel === 'document.execute') executed.push(params as Executed);
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
}

/** One page carrying {@link MARK}, the select tool on, and the mark selected by a click on it. */
async function selectedMark(page: Page, executed: Executed[], contents?: string): Promise<void> {
  await openedWithMark(page, executed, { kind: 'highlight', ...(contents === undefined ? {} : { contents }) });
  await chooseTool(page, 'Select annotations');
  const at = await markOnScreen(page);
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  // THE SELECTION SHOWN, which the panel being on screen is not: it is there with nothing selected too, and a press
  // made before the selection renders is read against no selection.
  await expect(page.getByRole('complementary', { name: 'Properties' }).getByRole('heading', { name: 'Highlight' })).toBeVisible();
}

/** Where {@link MARK} is on screen, from the drawing surface's box and the page's 612-point width. */
async function markOnScreen(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await surface(page).boundingBox();
  if (box === null) throw new Error('the drawing surface is not on screen');
  const scale = box.width / 612;
  return {
    x: box.x + MARK.x0 * scale,
    y: box.y + (792 - MARK.y1) * scale,
    width: (MARK.x1 - MARK.x0) * scale,
    height: (MARK.y1 - MARK.y0) * scale,
  };
}

test('REPLY from the Properties tab types the answer NEXT TO THE MARK, and a press elsewhere sends it for that mark', async ({
  page,
}) => {
  const executed: Executed[] = [];
  await selectedMark(page, executed);
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /^Reply/u }).click();

  const box = page.getByRole('textbox', { name: 'Your reply' });
  await expect(box).toBeFocused();
  // NO DIALOG over the page: the words go where the mark is.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const mark = await markOnScreen(page);
  const card = await box.boundingBox();
  if (card === null) throw new Error('the reply box is not on screen');
  // UNDER THE MARK and from its left edge, where the page has room (`besideBox`).
  expect(card.y).toBeGreaterThanOrEqual(mark.y + mark.height - 1);
  expect(Math.abs(card.x - mark.x)).toBeLessThan(24);

  await page.keyboard.type('Checked: they match');
  await expectNoBlocking(page);
  await page.mouse.click(mark.x + 400, mark.y - 200);
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ kind: 'replyToAnnotation', page: 0, index: 0, text: 'Checked: they match' });
});

test('EDIT COMMENT from the mark’s menu is typed next to the mark, and Escape finishes it and keeps the words', async ({
  page,
}) => {
  const executed: Executed[] = [];
  await selectedMark(page, executed);
  const mark = await markOnScreen(page);
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Edit comment/u }).click();

  // THE CARD'S FIELD, not the Properties tab's own Comment field beside it.
  const box = page.locator('.m-inline-writer').getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.type('Confirm the rate');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ kind: 'editAnnotationText', page: 0, index: 0, text: 'Confirm the rate' });
});

test('a LONG comment opens WHOLE in the card and in the Properties field, and an edit keeps its end', async ({ page }) => {
  // The walk lists a comment sliced to 512 characters. Opened on the slice, an edit would save it over the whole and
  // lose the end, which is why the end is distinct and the edit is made after it.
  const whole = `${'a'.repeat(600)} the end`;
  const executed: Executed[] = [];
  await selectedMark(page, executed, whole);
  const panelField = page.getByRole('complementary', { name: 'Properties' }).getByRole('textbox', { name: 'Comment' });
  await expect(panelField).toHaveValue(whole);
  await expect(panelField).not.toHaveAttribute('readonly');

  const mark = await markOnScreen(page);
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Edit comment/u }).click();
  const box = page.locator('.m-inline-writer').getByRole('textbox', { name: 'Comment' });
  await expect(box).toHaveValue(whole);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(', checked');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ kind: 'editAnnotationText', index: 0, text: `${whole}, checked` });
});

/** Typed words already on the page, in a style a reopen draws them in (ADR-0154 Decision 3). */
const TYPED_WORDS: SeededMark = {
  kind: 'typewriter',
  contents: 'Paid in full',
  typed: { fontSize: 14, colour: [0, 0, 0.6], font: 'serif', direction: 'left-to-right' },
};

test('a DOUBLE-CLICK with the select tool opens typed words IN THEIR OWN BOX AND SIZE, and Escape sends the edit', async ({
  page,
}) => {
  const executed: Executed[] = [];
  await openedWithMark(page, executed, TYPED_WORDS);
  await chooseTool(page, 'Select annotations');
  const mark = await markOnScreen(page);
  await page.mouse.dblclick(mark.x + mark.width / 2, mark.y + mark.height / 2);

  const box = page.locator('.m-inline-writer').getByRole('textbox', { name: 'Type onto the page' });
  await expect(box).toHaveValue('Paid in full');
  await expect(box).toBeFocused();
  // IN THE MARK'S BOX: the editor sits where the words are drawn, not on a card under them.
  const at = await box.boundingBox();
  if (at === null) throw new Error('the editor is not on screen');
  expect(Math.abs(at.x - mark.x)).toBeLessThan(4);
  expect(Math.abs(at.y - mark.y)).toBeLessThan(4);
  // IN THE MARK'S SIZE, at the zoom on screen: 14 points.
  const size = await box.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeCloseTo((14 * mark.width) / (MARK.x1 - MARK.x0), 0);
  await page.keyboard.press('End');
  await page.keyboard.type(', 4 October');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ kind: 'editAnnotationText', page: 0, index: 0, text: 'Paid in full, 4 October' });
});

test('a TYPEWRITER CLICK on typed words edits them rather than placing a second mark on top', async ({ page }) => {
  const executed: Executed[] = [];
  await openedWithMark(page, executed, TYPED_WORDS);
  await chooseTool(page, 'Typewriter');
  const mark = await markOnScreen(page);
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
  const box = page.locator('.m-inline-writer').getByRole('textbox', { name: 'Type onto the page' });
  await expect(box).toHaveValue('Paid in full');
  await page.keyboard.press('End');
  await page.keyboard.type(' (cash)');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  expect(executed[0]?.command).toMatchObject({ kind: 'editAnnotationText', index: 0, text: 'Paid in full (cash)' });

  // CONTROL: a click BESIDE the words still places a new typewriter, starting empty.
  await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height + 120);
  await expect(box).toHaveValue('');
  await page.keyboard.type('Received');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(2);
  expect(executed[1]?.command).toMatchObject({ kind: 'addAnnotation', annotation: { type: 'typewriter', text: 'Received' } });
});

test('POINTERS: the I-beam where words are typed, the arrow where a click places, the eraser its own picture', async ({
  page,
}) => {
  await opened(page, LOOKS[0], 1, []);
  const pointer = async (title: string): Promise<string> => {
    await chooseTool(page, title);
    const cursor = await surface(page).evaluate((node) => getComputedStyle(node).cursor);
    await page.keyboard.press('Escape');
    await expect(surface(page)).toHaveCount(0);
    return cursor;
  };
  expect(await pointer('Text box')).toBe('text');
  expect(await pointer('Typewriter')).toBe('text');
  expect(await pointer('Note')).toBe('default');
  expect(await pointer('Insertion mark')).toBe('default');
  const eraser = await pointer('Erase annotation');
  // THE PICTURE, both densities, with the crosshair after it for a pointer that cannot be drawn.
  expect(eraser).toContain('image-set');
  expect(eraser.match(/url\(/gu)?.length).toBe(2);
  expect(eraser.endsWith('crosshair')).toBe(true);
  // AND BOTH PICTURES DECODE, at the sizes the densities promise: a rule naming an image the browser cannot draw is
  // the crosshair wearing the eraser's name.
  const urls = [...eraser.matchAll(/url\("?([^")]+)"?\)/gu)].map((match) => match[1] ?? '');
  const sizes = await page.evaluate(
    (sources) =>
      Promise.all(
        sources.map(async (source) => {
          const image = new Image();
          image.src = source;
          await image.decode();
          return [image.naturalWidth, image.naturalHeight];
        }),
      ),
    urls,
  );
  expect(sizes).toStrictEqual([
    [24, 24],
    [48, 48],
  ]);
  // CONTROL: a drawing tool keeps the crosshair, so the rules above are each tool's and not one for every tool.
  expect(await pointer('Rectangle')).toBe('crosshair');
});

/** The status bar's tool line (ADR-0154 Decision 4). */
function toolLine(page: Page): Locator {
  return page.locator('.m-status-mode');
}

test('THE TOOL LINE says what the tool waits for, and Escape with nothing in flight STOPS the tool', async ({ page }) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 1, executed);
  await expect(toolLine(page)).toHaveCount(0);
  await chooseTool(page, 'Note');
  await expect(toolLine(page)).toHaveText('Click where the comment goes. Esc to stop.');

  await page.keyboard.press('Escape');
  await expect(toolLine(page)).toHaveCount(0);
  // STOPPED, not hidden: no drawing surface is left, so a click on the page places nothing and asks for nothing.
  await expect(surface(page)).toHaveCount(0);
  const pane = await page.locator('[data-document-layer="active"] canvas.m-page').first().boundingBox();
  if (pane === null) throw new Error('the page is not on screen');
  await page.mouse.click(pane.x + 200, pane.y + 100);
  await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
  expect(executed).toStrictEqual([]);
});

test('CONTROL: Escape in an open box FINISHES the words and leaves the tool on', async ({ page }) => {
  const executed: Executed[] = [];
  await opened(page, LOOKS[0], 1, executed);
  await chooseTool(page, 'Text box');
  await dragOn(page, [80, 60], [320, 140]);
  await page.keyboard.type('kept');
  await page.keyboard.press('Escape');
  await expect.poll(() => executed.length).toBe(1);
  await expect(toolLine(page)).toHaveText('Drag the box the words go in. Esc to stop.');
  await expect(surface(page)).toBeVisible();
});

test('ESCAPE IS INNERMOST FIRST: marks selected are let go, then the select tool stops', async ({ page }) => {
  const executed: Executed[] = [];
  await selectedMark(page, executed);
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Escape');
  await expect(properties.getByRole('heading', { name: 'Highlight' })).toHaveCount(0);
  await expect(toolLine(page)).toHaveText('Click a mark to select it, or drag around several. Esc to stop.');
  await page.keyboard.press('Escape');
  await expect(toolLine(page)).toHaveCount(0);
});
