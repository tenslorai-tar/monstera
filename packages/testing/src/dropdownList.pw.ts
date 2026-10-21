import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { bridgeUnder, LOOKS } from './pageBridge.js';

/**
 * A dropdown's list, filling (the owner's R21, 2026-10-21): it opens AT its field — under it, or above it touching it
 * where there is no room below — stays with the field as the page moves, is never cut off by the page, and on opening
 * offers every option with the held one marked; typing filters by what is typed after opening.
 *
 * Two dropdowns, as the owner compared them: one that takes typing (`/Ff` Edit), as the form the owner filled came with,
 * whose list was the browser's `<datalist>` — placed by the screen's room, left behind by the page, and filtered by the
 * value already held — and one that does not, the kind Monstera makes, whose list was already the page's own rows. Both
 * sit near the page's foot and its right edge, where a list placed under the field ran off the page.
 *
 * Each field's rectangle is written into a real AcroForm and listed to the shim from the same numbers, so the page draws
 * genuine widgets under the controls (`formFillRules.pw.ts`' shape).
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000d1');
const CITIES = ['London', 'Berlin', 'Paris', 'Madrid', 'Rome'];
/** Near the foot and the right edge, in points from the page's bottom left. */
const TYPED = { x0: 420, y0: 24, x1: 580, y1: 44 };
const CHOSEN = { x0: 40, y0: 24, x1: 200, y1: 44 };

type Rect = typeof TYPED;

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const at = (rect: Rect) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0, font });
  const typed = form.createDropdown('City');
  typed.addOptions(CITIES);
  typed.enableEditing();
  typed.select('London');
  typed.addToPage(page, at(TYPED));
  const chosen = form.createDropdown('Capital');
  chosen.addOptions(CITIES);
  chosen.addToPage(page, at(CHOSEN));
  return document.save();
}

function field(index: number, over: Partial<ShimFormField>): ShimFormField {
  return { page: 0, index, kind: 'text', name: '', values: [], on: null, options: [], readOnly: false, multiline: false, rect: null, ...over };
}

const LISTED: readonly ShimFormField[] = [
  field(0, { name: 'City', kind: 'dropdown', rect: TYPED, options: CITIES, values: ['London'], editable: true }),
  field(1, { name: 'Capital', kind: 'dropdown', rect: CHOSEN, options: CITIES }),
];

type Sent = { channel: string; params: unknown }[];

const fills = (sent: Sent): unknown[] =>
  sent
    .filter((call) => call.channel === 'document.execute')
    .map((call) => (call.params as { command: { kind: string } }).command)
    .filter((command) => command.kind === 'fillFormField');

async function open(page: Page, sent: Sent): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 900 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Cities.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [LISTED],
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  const typed = page.locator('[data-form-layer="0"] [data-form-field="0"]');
  await expect(typed).toBeAttached();
  // THE FOOT OF THE PAGE ON SCREEN, where both fields are.
  await typed.scrollIntoViewIfNeeded();
}

/** The field's box and its open list's, on screen. */
async function boxes(field: Locator, list: Locator): Promise<{ field: Box; list: Box }> {
  const [a, b] = [await field.boundingBox(), await list.boundingBox()];
  if (a === null || b === null) throw new Error('the field or its list has no box');
  return { field: a, list: b };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The list touches its field, above or below, and lies wholly inside the page and the window. */
async function touchesAndShows(page: Page, field: Locator, list: Locator): Promise<void> {
  const { field: f, list: l } = await boxes(field, list);
  const below = Math.abs(l.y - (f.y + f.height));
  const above = Math.abs(l.y + l.height - f.y);
  expect(Math.min(below, above), `field ${JSON.stringify(f)} list ${JSON.stringify(l)}`).toBeLessThan(1.5);
  expect(Math.abs(l.x - f.x), 'the list starts where its field does').toBeLessThan(1.5);
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the page has no box');
  expect(l.y, 'not past the page’s top').toBeGreaterThanOrEqual(slot.y - 0.5);
  expect(l.y + l.height, 'not past the page’s foot').toBeLessThanOrEqual(slot.y + slot.height + 0.5);
  expect(l.x + l.width, 'not past the page’s right edge').toBeLessThanOrEqual(slot.x + slot.width + 0.5);
  // SHOWN, not only placed: the row in the list's middle is the element on top there.
  const middle = await page.evaluate(
    ([x, y]) => {
      const at = document.elementFromPoint(x ?? 0, y ?? 0);
      return at === null ? 'nothing' : at.closest('[role="listbox"]') !== null ? 'the list' : `${at.tagName.toLowerCase()}.${at.className}`;
    },
    [l.x + l.width / 2, l.y + l.height / 2],
  );
  expect(middle, `the list is on top where it is (window ${JSON.stringify(page.viewportSize())}, list ${JSON.stringify(l)})`).toBe('the list');
}

const rowsOf = (list: Locator) => list.getByRole('option');

test('a dropdown that takes typing opens its own list at its field, near the foot and the right edge, and after a scroll', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  const field = page.locator('[data-form-layer="0"] [data-form-field="0"]');
  await field.click();
  const list = page.getByRole('listbox', { name: 'City' });
  await expect(list).toBeVisible();
  // THE PAGE'S OWN ROWS, not the browser's: no datalist is left in the page.
  await expect(page.locator('datalist')).toHaveCount(0);
  await touchesAndShows(page, page.getByRole('combobox', { name: 'City' }), list);
  // THE PAGE MOVES and the list moves with it. A short way, so the field itself stays on screen: 120 px put it under the
  // window's foot (measured), where its list rightly went with it and could not be seen.
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(300);
  await touchesAndShows(page, page.getByRole('combobox', { name: 'City' }), list);
});

test('the dropdown Monstera makes opens at its field near the foot too, and is not cut off by the page', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  const field = page.locator('[data-form-layer="0"] [data-form-field="1"]');
  await field.click();
  const list = page.getByRole('listbox', { name: 'Capital' });
  await expect(list).toBeVisible();
  await touchesAndShows(page, field, list);
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -40);
  await page.waitForTimeout(300);
  await touchesAndShows(page, field, list);
});

test('with London held, the list offers all five cities with London marked; typing Be leaves Berlin, and choosing it fills it', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await page.locator('[data-form-layer="0"] [data-form-field="0"]').click();
  const list = page.getByRole('listbox', { name: 'City' });
  // EVERY OPTION ON OPENING: the held value hides none. This is the control for the filter below — a list filtered by
  // what the box holds offered London alone here.
  await expect(rowsOf(list)).toHaveText(CITIES);
  await expect(list.getByRole('option', { name: 'London' })).toHaveAttribute('aria-selected', 'true');
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(1);
  await page.keyboard.type('Be');
  await expect(rowsOf(list)).toHaveText(['Berlin']);
  await list.getByRole('option', { name: 'Berlin' }).click();
  await expect.poll(() => fills(sent)).toStrictEqual([{ kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'choice', option: 'Berlin' } }]);
});

// A VALUE NO ROW OFFERS, typed, still fills the field: `formFillRules.pw.ts`' "Dr" case, on the same box.
test('the arrows move through the offered rows from the box, and Enter chooses the one they are on', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await page.locator('[data-form-layer="0"] [data-form-field="0"]').click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => fills(sent)).toStrictEqual([{ kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'choice', option: 'Berlin' } }]);
});
