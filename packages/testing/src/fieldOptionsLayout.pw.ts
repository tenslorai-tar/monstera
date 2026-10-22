import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { EVERY_FIELD_KIND as FIELDS, EVERY_FIELD_KIND_ROWS, formPdf } from './formFieldsFixture.js';
import { openSection, runCommand } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A field's Properties › Options, laid out with room (the owner, 2026-10-23, C6), on pinned Chromium against the compiled
 * bundle. The button's Actions editor is the hard shape: four labelled controls and a pair of buttons in one card. At the
 * panel's default width each label and its control share a row in two aligned columns, every control as wide as the
 * others; at its narrowest each label sits above its control; at both the editor is its own inset card and Save action
 * has room above it.
 *
 * Measured from the drawn boxes, because the defect was a drawing: before this, each drop-down ended where its longest
 * choice did, so *When*, *Do* and *Show it* were three widths at three left edges, and the case below fails on that.
 */

const ID = asDocId('00000000-0000-4000-8000-000000000001');

/** The panel's narrowest and its default (`panelOverflow.pw.ts`' own two). */
const NARROWEST = 264;
const DEFAULT = 340;

async function editorOpen(page: Page, width: number): Promise<Locator> {
  const bytes = await formPdf();
  await page.setViewportSize({ width: 1600, height: 1400 });
  await bridgeUnder(page, LOOKS[1], {
    opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Form.pdf' }],
    documentBytes: new Map([[ID, bytes]]),
    formFields: [FIELDS],
    settings: { 'appearance.context-panel-width': width, 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'properties' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('canvas.m-page').first()).toBeAttached();
  await openSection(page, 'Forms');
  await runCommand(page, 'Fields list');
  const rows = page.locator('.m-forms-panel .m-forms-jump');
  await expect(rows).toHaveCount(EVERY_FIELD_KIND_ROWS);
  await rows.filter({ hasText: 'ResetButton' }).click();
  const props = page.locator('[data-field-properties]');
  await props.getByRole('button', { name: 'Add action' }).click();
  const editor = props.locator('[data-button-action-editor]');
  await expect(editor.getByLabel('Page', { exact: true })).toBeVisible();
  return editor;
}

/** Each labelled control of the editor: its label's box and its control's. */
async function pairs(editor: Locator): Promise<{ name: string; label: DOMRect; control: DOMRect }[]> {
  return editor.evaluate((root) =>
    [...root.querySelectorAll('label[for]')].flatMap((label) => {
      const control = document.getElementById(label.getAttribute('for') ?? '');
      return control === null ? [] : [{ name: label.textContent, label: label.getBoundingClientRect().toJSON() as DOMRect, control: control.getBoundingClientRect().toJSON() as DOMRect }];
    }),
  );
}

async function insetAndRoom(editor: Locator): Promise<void> {
  const style = await editor.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { border: computed.borderTopStyle, padding: Number.parseFloat(computed.paddingTop) };
  });
  expect(style.border, 'the editor is its own inset card').toBe('solid');
  expect(style.padding, 'the inset card has room inside it').toBeGreaterThanOrEqual(8);
  const save = await editor.getByRole('button', { name: 'Save action' }).boundingBox();
  const controls = await pairs(editor);
  const lastBottom = Math.max(...controls.map((pair) => pair.control.bottom));
  if (save === null) throw new Error('Save action has no box');
  expect(save.y - lastBottom, 'room above Save action').toBeGreaterThanOrEqual(12);
}

test(`at the panel's default width (${String(DEFAULT)} px) the editor's controls are one column, one width and one height`, async ({ page }) => {
  const editor = await editorOpen(page, DEFAULT);
  const found = await pairs(editor);
  // AN INDEPENDENT COUNT (audit item 4c): When, Do, Page and Show it for *Go to a page*, the kind an editor opens on.
  expect(found.map((pair) => pair.name)).toStrictEqual(['When', 'Do', 'Page', 'Show it']);
  for (const pair of found) {
    // BESIDE: the label and its control share a row.
    expect(Math.abs(pair.label.top + pair.label.height / 2 - (pair.control.top + pair.control.height / 2)), pair.name).toBeLessThanOrEqual(2);
  }
  expect(new Set(found.map((pair) => Math.round(pair.control.left))).size, 'one left edge').toBe(1);
  expect(new Set(found.map((pair) => Math.round(pair.control.width))).size, 'one width').toBe(1);
  expect(new Set(found.map((pair) => Math.round(pair.control.height))).size, 'one height').toBe(1);
  // ROOM BETWEEN ROWS: no control closer than 8 px to the next.
  for (let at = 1; at < found.length; at += 1) {
    const [above, below] = [found[at - 1], found[at]];
    if (above === undefined || below === undefined) throw new Error('a pair is missing');
    expect(below.control.top - above.control.bottom, `${above.name} to ${below.name}`).toBeGreaterThanOrEqual(8);
  }
  await insetAndRoom(editor);
});

test(`at the panel's narrowest (${String(NARROWEST)} px) each label sits above its control, full width`, async ({ page }) => {
  const editor = await editorOpen(page, NARROWEST);
  const found = await pairs(editor);
  expect(found.map((pair) => pair.name)).toStrictEqual(['When', 'Do', 'Page', 'Show it']);
  const inner = await editor.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth);
  });
  for (const pair of found) {
    expect(pair.control.top, `${pair.name} is under its label`).toBeGreaterThanOrEqual(pair.label.bottom);
    expect(Math.abs(pair.control.width - inner), `${pair.name} fills the card`).toBeLessThanOrEqual(1);
  }
  await insetAndRoom(editor);
});
