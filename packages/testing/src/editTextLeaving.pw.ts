import { PDFDocument } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SURFACE, openWords } from './editTextSteps.js';
import { bridge } from './pageBridge.js';

/**
 * WORDS A WRITE REFUSED ARE NEVER LEFT WITHOUT A QUESTION (ADR-0278): every route that would end an Edit text editor
 * holding refused words asks *Your words were not written*, Keep editing keeps the editor, the words and the sentence,
 * and Discard puts the page's text back and goes on.
 *
 * THE CONTROL IS EACH ROUTE ITSELF: measured 2026-10-30 at e61f77b9, the ribbon's Edit text button closed such an editor
 * with no question, the page showed the old words and the bar said Saved. A route that does not await the leaving rule
 * shows no question, so its pair of cases fails at the first expectation.
 */

const BODY_RUN = { size: 12, colour: { r: 30, g: 30, b: 30 }, serif: false, mono: false, italic: false, bold: false };
const LEFT_SHAPE = { align: 'left', firstIndent: 0 } as const;
const WORDS = 'A paragraph of words';
const TYPED = `${WORDS} typed here`;
const FIRST = asDocId('00000000-0000-4000-8000-0000000000a1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000a2');

/** A block of one line at `top`, as `document.textBlocks` answers, its run numbered `index`. */
function blockAt(top: number, index: number, text: string) {
  return {
    box: { x0: 100, y0: top - 100, x1: 400, y1: top },
    lines: [{ runs: [{ index, text, style: BODY_RUN }], box: { x0: 100, y0: top - 14, x1: 400, y1: top }, soft: false, baseline: top - 11 }],
    style: BODY_RUN,
    shape: LEFT_SHAPE,
  };
}

/** A one-page document built here, so the case needs no fixture from the corpus (B10). */
async function onePagePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  return document.save();
}

/**
 * The first document open in Edit text, its first block's editor holding ` typed here` that the shim's writer refused,
 * the sentence beneath. `two` opens a second document first, so a tab can be switched to.
 */
async function refusedEditor(page: Page, two = false): Promise<{ readonly windowCloses: () => Promise<number> }> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await onePagePdf();
  const opened = (docId: typeof FIRST, name: string) => ({ kind: 'opened' as const, docId, version: asDocVersion(1), byteLength: bytes.byteLength, name });
  let closes = 0;
  await bridge(
    page,
    {
      opens: two ? [opened(SECOND, 'second.pdf'), opened(FIRST, 'first.pdf')] : [opened(FIRST, 'first.pdf')],
      documentBytes: new Map([
        [FIRST, bytes],
        [SECOND, bytes],
      ]),
      refusals: new Map([[FIRST, { code: 'edit-refused', detail: { step: 'read-back', engineError: 0 } }]]),
      textBlocks: [blockAt(700, 3, WORDS), blockAt(500, 7, 'Another block of words')],
    },
    (channel) => {
      if (channel === 'window.close') closes += 1;
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
  if (two) {
    await page.keyboard.press('Control+o');
    await expect(tabOf(page, FIRST)).toHaveAttribute('aria-current', 'true');
  }
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).first().click();
  await openWords(page, page.locator('[data-text-edit-layer="0"] [data-text-block="0"]'));
  await page.keyboard.type(' typed here');
  await page.keyboard.press('Escape');
  await expect(page.locator('.m-kit-problem')).toContainText('Press Esc to put the text back.');
  return { windowCloses: () => Promise.resolve(closes) };
}

const QUESTION = 'Your words were not written';

/** The question, answered: its dialog is up, then the button pressed, then gone. */
async function answer(page: Page, button: 'Keep editing' | 'Discard'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: QUESTION });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The editor is open with the typed words and the refusal's sentence. */
async function stillHeld(page: Page): Promise<void> {
  await expect(page.locator(SURFACE)).toBeVisible();
  expect(await page.locator(SURFACE).evaluate((element) => (element as HTMLElement).innerText)).toBe(TYPED);
  await expect(page.locator('.m-kit-problem')).toContainText('Press Esc to put the text back.');
}

/** A menu bar menu's item, chosen: a checked one, such as Split view, is a `menuitemcheckbox`. */
async function fromMenu(page: Page, menu: string, item: string, role: 'menuitem' | 'menuitemcheckbox' = 'menuitem'): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: menu, exact: true }).click();
  await page.getByRole(role, { name: item, exact: true }).click();
}

/** A document's tab, by the name button `DocumentTabs` draws for it; the one showing carries `aria-current`. */
const tabOf = (page: Page, docId: typeof FIRST) => page.locator(`[data-tab-select="${docId}"]`);

interface Route {
  readonly name: string;
  readonly two?: boolean;
  /** Leaves the editor this route's way. */
  readonly leave: (page: Page) => Promise<void>;
  /** That the route was NOT taken, after Keep editing. */
  readonly stayed: (page: Page, closes: () => Promise<number>) => Promise<void>;
  /** That the route WAS taken, after Discard. */
  readonly went: (page: Page, closes: () => Promise<number>) => Promise<void>;
}

const editTextOn = (page: Page) => expect(page.getByRole('button', { name: 'Edit text', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');

const ROUTES: readonly Route[] = [
  {
    name: 'the ribbon’s Edit text button, the measured route',
    leave: (page) => page.getByRole('button', { name: 'Edit text', exact: true }).first().click(),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.getByRole('button', { name: 'Edit text', exact: true }).first()).toHaveAttribute('aria-pressed', 'false'),
  },
  {
    name: 'another tool, the ribbon’s Text box',
    leave: (page) => page.getByRole('button', { name: 'Text box', exact: true }).first().click(),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.getByRole('button', { name: 'Text box', exact: true }).first()).toHaveAttribute('aria-pressed', 'true'),
  },
  {
    name: 'the rail’s Organize',
    leave: (page) => page.getByRole('button', { name: 'Organize', exact: true }).first().click(),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.locator('[data-text-edit-layer="0"]')).toHaveCount(0),
  },
  {
    name: 'another block pressed',
    leave: (page) => page.locator('[data-text-edit-layer="0"] [data-text-block="1"]').click(),
    // NOTHING BEYOND `stillHeld`: the first block's editor, its words and its sentence are what staying is here.
    stayed: () => Promise.resolve(),
    // THE PRESSED BLOCK OPENS once the first one's text is put back.
    went: async (page) => {
      await expect(page.locator(SURFACE)).toHaveCount(1);
      await expect.poll(() => page.locator(SURFACE).evaluate((element) => (element as HTMLElement).innerText)).toBe('Another block of words');
    },
  },
  {
    name: 'split view',
    leave: (page) => fromMenu(page, 'View', 'Split view', 'menuitemcheckbox'),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.locator('[data-text-edit-layer="0"]')).not.toHaveCount(1),
  },
  {
    name: 'another document’s tab',
    two: true,
    leave: (page) => tabOf(page, SECOND).click(),
    stayed: (page) => expect(tabOf(page, FIRST)).toHaveAttribute('aria-current', 'true'),
    went: (page) => expect(tabOf(page, SECOND)).toHaveAttribute('aria-current', 'true'),
  },
  {
    name: 'the start screen',
    leave: (page) => fromMenu(page, 'File', 'Start screen'),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.getByRole('button', { name: 'Open PDF…' })).toBeVisible(),
  },
  {
    name: 'closing the document’s tab',
    leave: (page) => page.getByRole('button', { name: 'Close first.pdf', exact: true }).click(),
    stayed: (page) => expect(tabOf(page, FIRST)).toBeVisible(),
    went: (page) => expect(tabOf(page, FIRST)).toHaveCount(0),
  },
  {
    name: 'closing the window, File › Exit',
    leave: (page) => fromMenu(page, 'File', 'Exit'),
    stayed: async (_page, closes) => {
      expect(await closes()).toBe(0);
    },
    went: async (_page, closes) => {
      await expect.poll(closes).toBe(1);
    },
  },
  {
    name: 'undo from the menu',
    leave: (page) => fromMenu(page, 'Edit', 'Undo'),
    stayed: (page) => editTextOn(page),
    went: (page) => expect(page.locator(SURFACE)).toHaveCount(0),
  },
];

for (const route of ROUTES) {
  test.describe(`leaving by ${route.name}`, () => {
    test('asks, and Keep editing keeps the editor, the words and the sentence', async ({ page }) => {
      const { windowCloses } = await refusedEditor(page, route.two === true);
      await route.leave(page);
      await answer(page, 'Keep editing');
      await stillHeld(page);
      await route.stayed(page, windowCloses);
    });

    test('asks, and Discard puts the page’s text back and goes on', async ({ page }) => {
      const { windowCloses } = await refusedEditor(page, route.two === true);
      await route.leave(page);
      await answer(page, 'Discard');
      await route.went(page, windowCloses);
    });
  });
}

test('the status bar says Unsaved changes while refused words are held, and Saved again once they are discarded', async ({ page }) => {
  await refusedEditor(page);
  const bar = page.locator('.m-status-saved').first();
  await expect(bar).toHaveText('Unsaved changes');
  await page.keyboard.press('Escape');
  await expect(page.locator(SURFACE)).toHaveCount(0);
  // CONTROL: the same document with nothing held is saved, which is what the bar said over the refused words before.
  await expect(bar).toHaveText('Saved');
});
