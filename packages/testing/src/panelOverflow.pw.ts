import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { EVERY_FIELD_KIND as FIELDS, EVERY_FIELD_KIND_ROWS, LONG_WORDS as LONG, formPdf } from './formFieldsFixture.js';
import { SELECT_TOOL, armTool, openSection, runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * NO SIDE PANEL SCROLLS SIDEWAYS, at any width it can take (the owner's R16, 2026-10-20).
 *
 * 0.1.17.0 shipped a Fields list that scrolled 8 px sideways: the Flatten foot kept a `width: 100%` written for the
 * `<button>` it used to be, and on its `<div>` the side padding was added to the 100%. No baseline showed the list with a
 * form open, so nothing photographed it. This is the class, read on the real stylesheet: every tab of the left panel and
 * the Properties views a person reaches — the sections with nothing selected, a field of every kind, a mark of every
 * kind, several marks, measuring and Edit text — at each panel's narrowest and default widths and a wide one, with the
 * panel and every scroll container in it required to be no wider than it shows.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

/** The marks, clear of the fields, each picked at its centre. */
const markRect = (row: number) => ({ x0: 360, y0: 720 - row * 48, x1: 540, y1: 750 - row * 48 });
const MARKS = [
  { kind: 'square', contents: LONG },
  { kind: 'circle', contents: '' },
  { kind: 'highlight', contents: LONG },
  { kind: 'underline', contents: '' },
  { kind: 'strikeout', contents: '' },
  { kind: 'sticky-note', contents: LONG },
  { kind: 'stamp', contents: '' },
  { kind: 'caret', contents: '' },
  { kind: 'text-box', contents: LONG },
  { kind: 'callout', contents: LONG },
  { kind: 'redact', contents: '' },
] as const;

/** The widths each panel is read at: its narrowest, its default, and a wide one. */
const LEFT_WIDTHS = [256, 260, 480] as const;
const RIGHT_WIDTHS = [264, 340] as const;

async function open(page: Page, settings: Record<string, unknown>): Promise<void> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1600, height: 900 });
  await bridgeUnder(page, LOOKS[0], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    formFields: [FIELDS],
    annotations: MARKS.map((mark, index) => ({ page: 0, index, kind: mark.kind, rect: markRect(index), contents: mark.contents })),
    settings,
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
}

/**
 * Every side panel, and every scroll container inside one, that is wider than it shows; and how many were read, so a
 * page with no panel on it does not pass with nothing checked.
 */
async function sideways(page: Page): Promise<{ readonly read: number; readonly over: readonly string[] }> {
  return page.evaluate(() => {
    const over: string[] = [];
    let read = 0;
    for (const root of document.querySelectorAll('.m-document-panel, .m-context-panel')) {
      for (const element of [root, ...root.querySelectorAll('*')]) {
        const style = getComputedStyle(element);
        const scrolls = element === root || style.overflowX === 'auto' || style.overflowX === 'scroll';
        if (!scrolls || element.clientWidth === 0) continue;
        read += 1;
        if (element.scrollWidth > element.clientWidth) {
          over.push(`${element.tagName}.${element.className} is ${String(element.scrollWidth)} wide in ${String(element.clientWidth)}`);
        }
      }
    }
    return { read, over };
  });
}

async function expectNoneSideways(page: Page, where: string): Promise<void> {
  const { read, over } = await sideways(page);
  expect(read, `${where}: no panel was read`).toBeGreaterThan(0);
  expect(over, where).toStrictEqual([]);
}

for (const width of LEFT_WIDTHS) {
  test(`every tab of the left panel at ${String(width)} px scrolls only down`, async ({ page }) => {
    await open(page, { 'appearance.document-panel-width': width, 'appearance.context-panel-open': false });
    const tabs = page.locator('.m-document-panel__tabs [role="tab"]');
    // AN INDEPENDENT COUNT of the tabs (audit item 4c): a tab that left would otherwise leave the walk with it.
    await expect(tabs).toHaveCount(6);
    for (let at = 0; at < 6; at += 1) {
      const tab = tabs.nth(at);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expectNoneSideways(page, `tab ${String(at + 1)}, ${(await tab.getAttribute('aria-label')) ?? ''}`);
    }
  });
}

for (const width of RIGHT_WIDTHS) {
  test(`the Properties views at ${String(width)} px scroll only down`, async ({ page }) => {
    await open(page, {
      'appearance.context-panel-width': width,
      'appearance.context-panel-open': true,
      'appearance.context-panel-tab': 'properties',
    });
    const properties = page.locator('.m-properties').first();
    await expect(properties).toBeVisible();
    await expectNoneSideways(page, 'New annotations, nothing selected');

    // A FIELD OF EVERY KIND, picked from the Fields list.
    await openSection(page, 'Forms');
    await expectNoneSideways(page, 'the Forms section, nothing selected');
    await runCommand(page, 'Fields list');
    const rows = page.locator('.m-forms-panel .m-forms-jump');
    await expect(rows).toHaveCount(EVERY_FIELD_KIND_ROWS);
    for (let row = 0; row < EVERY_FIELD_KIND_ROWS; row += 1) {
      await rows.nth(row).click();
      await expectNoneSideways(page, `the field of row ${String(row + 1)} selected`);
    }
    // AND EACH RADIO CHOICE, which is a field of its own.
    for (const choice of await page.locator('.m-forms-panel .m-forms-option__name').all()) {
      await choice.click();
      await expectNoneSideways(page, `the radio choice ${(await choice.textContent()) ?? ''} selected`);
    }
    await page.keyboard.press('Escape');

    // A MARK OF EVERY KIND, picked on the page.
    await openSection(page, 'Comment');
    await armTool(page, 'Select', SELECT_TOOL);
    // THE PAGE AS IT SITS NOW: opening the Fields list moved it, so its place is read at each pick.
    const onScreen = async (x: number, y: number) => {
      const now = await page.locator('.m-page-slot').first().boundingBox();
      if (now === null) throw new Error('the first page has no box');
      const scale = now.width / 612;
      return { x: now.x + x * scale, y: now.y + (792 - y) * scale };
    };
    const centre = async (row: number) => {
      const rect = markRect(row);
      return onScreen((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
    };
    for (const [row, mark] of MARKS.entries()) {
      const at = await centre(row);
      await page.mouse.click(at.x, at.y);
      await expect(page.locator(`[data-selection-index="${String(row)}"]`).first()).toBeAttached();
      await expectNoneSideways(page, `a ${mark.kind} selected`);
    }
    // SEVERAL SELECTED, by the Select tool's marquee: a drag from empty paper — right of the fields, which end at 300,
    // and left of the marks, which start at 360 — over the first two marks.
    const from = await onScreen(330, markRect(0).y1 + 10);
    const to = await onScreen(450, markRect(1).y0 + 5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    // TWO SELECTED, read rather than assumed.
    await expect(page.locator('[data-selection-index]')).toHaveCount(2);
    await expectNoneSideways(page, 'several marks selected');
    await page.keyboard.press('Escape');

    // MEASURING, and EDIT TEXT.
    await runCommand(page, 'Measure distance');
    await expectNoneSideways(page, 'while measuring');
    await page.keyboard.press('Escape');
    await openSection(page, 'Edit');
    await page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit text', exact: true }).click();
    await expectNoneSideways(page, 'Edit text');
  });
}

test('CONTROL: an over-wide row in a panel is found, on the real stylesheet', async ({ page }) => {
  await open(page, { 'appearance.document-panel': 'forms', 'appearance.context-panel-open': false });
  await expect(page.locator('.m-forms-panel').first()).toBeVisible();
  // CONTROL OF THE CONTROL: the same panel before the row is planted is read and found clean.
  await expectNoneSideways(page, 'the Fields list as drawn');
  await page.locator('.m-forms-list').first().evaluate((list) => {
    const row = document.createElement('li');
    row.textContent = 'a row with no break in it';
    row.style.width = '1200px';
    list.append(row);
  });
  const { over } = await sideways(page);
  expect(over.some((line) => line.startsWith('SECTION.m-forms-panel'))).toBe(true);
});
