import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import type { ShimFormField } from './browserShim.js';
import { bridgeUnder, LOOKS } from './pageBridge.js';
import { runCommand } from './palette.js';

/**
 * Filling a form under the tools a person leaves on (ADR-0226), with real pointer events at real places.
 *
 * The owner could not fill their form in 0.1.12.0 while every case in `formFill.pw.ts` was green: those cases open the
 * form with no tool on, and the comment Select tool, which stays on once chosen, put its surface over every field. So
 * each case here turns a tool on FIRST, the way a person who used it a minute earlier has it, and then fills.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');
const LOOK = LOOKS[0];

const NAME = { x0: 180, y0: 626, x1: 520, y1: 646 };
const SUBSCRIBE = { x0: 180, y0: 586, x1: 196, y1: 602 };
const EMAIL = { x0: 180, y0: 546, x1: 520, y1: 566 };
/** A comment over the right half of the name field: a press there is the comment's, a press on the left half the field's. */
const NOTE = { x0: 400, y0: 620, x1: 540, y1: 652 };

async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const form = document.getForm();
  const at = (rect: typeof NAME) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 });
  const name = form.createTextField('Full name');
  name.setText('Ada Lovelace');
  name.addToPage(page, { ...at(NAME), font });
  form.createCheckBox('Subscribe').addToPage(page, at(SUBSCRIBE));
  form.createTextField('Email').addToPage(page, { ...at(EMAIL), font });
  return document.save();
}

function field(index: number, over: Partial<ShimFormField>): ShimFormField {
  return { page: 0, index, kind: 'text', name: '', values: [], on: null, options: [], readOnly: false, multiline: false, rect: null, ...over };
}

const LISTED: readonly ShimFormField[] = [
  field(0, { name: 'Full name', rect: NAME, values: ['Ada Lovelace'] }),
  field(1, { name: 'Subscribe', kind: 'checkbox', on: false, rect: SUBSCRIBE }),
  field(2, { name: 'Email', rect: EMAIL }),
];

type Sent = { channel: string; params: unknown }[];

const fills = (sent: Sent): unknown[] =>
  sent
    .filter((call) => call.channel === 'document.execute')
    .map((call) => (call.params as { command: { kind: string } }).command)
    .filter((command) => command.kind === 'fillFormField');

async function open(page: Page, sent: Sent, withNote = false): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOK,
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      formFields: [LISTED],
      ...(withNote ? { annotations: [{ page: 0, index: 0, kind: 'square' as const, rect: NOTE }] } : {}),
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('[data-form-layer="0"] [data-form-field="0"]')).toBeAttached();
}

/** A point on the page, from the first page's slot and its 612 by 792 points: `fx` and `fy` are fractions of the rect. */
async function pointIn(page: Page, rect: typeof NAME, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> {
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  const px = rect.x0 + (rect.x1 - rect.x0) * fx;
  const py = rect.y0 + (rect.y1 - rect.y0) * fy;
  return { x: slot.x + px * scale, y: slot.y + (792 - py) * scale };
}

async function choose(page: Page, title: string): Promise<void> {
  await runCommand(page, title);
}

/** A real press: down, a small move, up, as a hand makes it. */
async function press(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 0.5, at.y);
  await page.mouse.up();
}

test('with the comment Select tool on, a press on a tick box fills it, at its centre and near its edge', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await choose(page, 'Select annotations');
  await expect(page.locator('.m-annotation-overlay').first()).toBeAttached();
  await press(page, await pointIn(page, SUBSCRIBE));
  await expect.poll(() => fills(sent)).toHaveLength(1);
  // NEAR THE EDGE, a point and a half in from the left: where a hand that aims at a small box often lands.
  await press(page, await pointIn(page, SUBSCRIBE, 0.1, 0.5));
  await expect.poll(() => fills(sent)).toHaveLength(2);
  expect(fills(sent)[0]).toMatchObject({ kind: 'fillFormField', page: 0, index: 1, value: { set: 'button', on: true } });
});

test('with the Select tool on, a press on a comment over a field is the comment, and beside it the field', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent, true);
  await choose(page, 'Select annotations');
  const onComment = await pointIn(page, NAME, 0.85);
  // CONTROL: what the browser's hit test meets there is the tool's surface, not the field.
  const hit = (at: { x: number; y: number }) =>
    page.evaluate(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('[data-form-field]')?.getAttribute('data-form-field') ?? null, [at.x, at.y]);
  expect(await hit(onComment)).toBeNull();
  expect(await hit(await pointIn(page, NAME, 0.2))).toBe('0');
  await press(page, await pointIn(page, NAME, 0.2));
  await expect(page.locator('[data-form-layer="0"] input[aria-label="Full name"]')).toBeFocused();
});

test('with the Hand tool on, a press on a field fills it and a drag elsewhere still moves the pages', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  await choose(page, 'Hand — drag to move the pages');
  await expect(page.locator('.m-page-list--panning')).toBeAttached();
  await press(page, await pointIn(page, SUBSCRIBE));
  await expect.poll(() => fills(sent)).toHaveLength(1);
  // A DRAG ON THE PAPER, away from every field, still moves the pages: the field took its own press only.
  const scroller = page.locator('.m-page-list--panning');
  await page.setViewportSize({ width: 1280, height: 500 });
  // ROOM TO SCROLL: a page that fits the pane has none, and a drag would move nothing whatever the tool did.
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  const before = await scroller.evaluate((element) => element.scrollTop);
  // INSIDE THE PANE AS IT NOW IS, near its top: the page's own top margin, above every field.
  const pane = await scroller.boundingBox();
  if (pane === null) throw new Error('the pages have no box');
  const from = { x: pane.x + pane.width / 2, y: pane.y + 40 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  expect(fills(sent)).toHaveLength(1);
});

test('a press in a text field puts the caret where it landed, and Tab fills it and moves to the next field', async ({ page }) => {
  const sent: Sent = [];
  await open(page, sent);
  // BETWEEN "Ada" AND " Lovelace": the field's own appearance draws its words from a small left inset, so the place is
  // found from the editor's own text once it is open, and pressed again there.
  await press(page, await pointIn(page, NAME, 0.9));
  const editor = page.locator('[data-form-layer="0"] input[aria-label="Full name"]');
  await expect(editor).toBeFocused();
  // CONTROL ON THE PRESS: far right of the words is the end, where a focused box would have put it anyway.
  expect(await editor.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe('Ada Lovelace'.length);
  const between = await editor.evaluate((element) => {
    const input = element as HTMLInputElement;
    const style = getComputedStyle(input);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('no canvas');
    context.font = style.font;
    const box = input.getBoundingClientRect();
    return { x: box.left + parseFloat(style.paddingLeft) + context.measureText('Ada').width, y: box.top + box.height / 2 };
  });
  await page.keyboard.press('Escape');
  await press(page, between);
  await expect(editor).toBeFocused();
  // THE DEFECT'S OWN READING: a box focused by its autofocus puts the caret at an end, never at 3.
  expect(await editor.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(3);
  await page.keyboard.type(' King');
  await page.keyboard.press('Tab');
  await expect.poll(() => fills(sent)).toStrictEqual([
    { kind: 'fillFormField', page: 0, index: 0, version: 1, value: { set: 'text', text: 'Ada King Lovelace' } },
  ]);
  await expect(page.locator('[data-form-layer="0"] [data-form-field="1"]')).toBeFocused();
});
