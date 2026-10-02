import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { openApp, openDocument, openSection, runCommand, samplePdf } from './helpScreensHarness.js';

/**
 * Six layout defects from the owner's screenshot review of 0.1.6.0, each asserted as the geometry or computed style it
 * got wrong, at the set's 1280 × 800 in the light look (the harness the Help pictures are taken with).
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element is laid out');
  return box;
}

async function openTwoDocuments(page: Page): Promise<void> {
  const bytes = await samplePdf();
  const first = asDocId('00000000-0000-4000-8000-0000000000c1');
  const second = asDocId('00000000-0000-4000-8000-0000000000c2');
  await openApp(page, {
    opens: [
      { kind: 'opened', docId: first, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Annual report.pdf' },
      { kind: 'opened', docId: second, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Appendix.pdf' },
    ],
    documentBytes: new Map([
      [first, bytes],
      [second, bytes],
    ]),
  });
  await openDocument(page);
  await page.getByRole('button', { name: 'Open another document' }).click();
  const tabs = page.getByRole('navigation', { name: 'Open documents' });
  await expect(tabs.getByRole('listitem')).toHaveCount(2);
  await tabs.getByRole('button', { name: 'Annual report.pdf', exact: true }).click();
}

test('the SEARCH TAB is drawn in the application’s controls, not the browser’s form', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('Control+F');
  const panel = page.getByRole('tabpanel', { name: 'Search' });
  await expect(panel).toBeVisible();
  const read = await panel.evaluate((element) => {
    const style = (selector: string): CSSStyleDeclaration | undefined => {
      const found = element.querySelector(selector);
      return found === null ? undefined : getComputedStyle(found);
    };
    return {
      options: style('fieldset')?.borderTopWidth,
      button: style('button[type="submit"]')?.borderTopLeftRadius,
      input: style('[data-find-input]')?.borderTopLeftRadius,
    };
  });
  // NO BROWSER FRAME round the options, and the buttons and box have the primitives' rounded edge — the browser's
  // own button and text box are square-cornered in Chromium.
  expect(read.options).toBe('0px');
  expect(read.button).not.toBe('0px');
  expect(read.input).not.toBe('0px');
});

test('the FORMS TAB shows each field’s whole name', async ({ page }) => {
  const rect = (y: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 72, y0: y, x1: 300, y1: y + 20 });
  await openApp(page, {
    formFields: [
      [
        { page: 0, index: 0, kind: 'text', name: 'Full name', values: [], on: null, options: [], readOnly: false, rect: rect(640) },
        { page: 0, index: 1, kind: 'text', name: 'Email', values: [], on: null, options: [], readOnly: false, rect: rect(600) },
      ],
    ],
  });
  await openDocument(page);
  await page.getByRole('tablist', { name: 'Document panels' }).getByRole('tab', { name: 'Forms' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Forms' });
  await expect(panel.getByRole('textbox', { name: 'Full name' })).toBeVisible();
  // NOT CUT: the name's button shows all of its text — no ellipsis means its content fits the box it has.
  const cut = await panel.locator('.m-forms-jump').evaluateAll((buttons) =>
    buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
  );
  expect(cut).toStrictEqual([]);
  // AND THE BOX IS WIDE ENOUGH TO READ, which `scrollWidth` alone does not say of a name allowed to wrap.
  expect((await boxOf(panel.locator('.m-forms-jump').first())).width).toBeGreaterThan(150);
});

test('the SETTINGS row keeps its description readable beside a wide control (Print quality)', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Rendering' }).click();
  const row = dialog.locator('.m-settings-row').filter({ hasText: 'Print quality' });
  await expect(row).toBeVisible();
  const text = await boxOf(row.locator('.m-settings-row__text'));
  const control = await boxOf(row.locator('[role="radiogroup"]'));
  const edge = await boxOf(row);
  // ONE WORD PER LINE was a text column a few dozen pixels wide; a readable one is hundreds.
  expect(text.width).toBeGreaterThan(200);
  // AND THE CONTROL STAYS INSIDE THE ROW rather than running past the dialog's edge.
  expect(control.x + control.width).toBeLessThanOrEqual(edge.x + edge.width + 1);
});

test('EVERY SETTINGS PAGE keeps every row’s description at its reading basis or wider, OCR’s languages included', async ({ page }) => {
  // THE CLASS, not Print quality alone: every row on every page, so a wide control added tomorrow on any page is held
  // to the same rule. The basis is the text's own `flex-basis`, resolved in its own font, so the case reads the rule
  // rather than restating a number; a row narrower than its basis may give the text the whole row instead.
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const pages = dialog.getByRole('navigation').getByRole('button');
  await expect(pages.first()).toBeVisible();
  const names = await pages.allTextContents();
  // THE POSITIVE CONTROL: the page the owner named is among those walked, so an empty walk cannot pass.
  expect(names).toContain('OCR');
  const narrow: string[] = [];
  let rows = 0;
  for (const name of names) {
    await pages.filter({ hasText: name }).first().click();
    const found = await dialog.locator('.m-settings-row').evaluateAll((all) =>
      all.map((row) => {
        const text = row.querySelector<HTMLElement>('.m-settings-row__text');
        if (text === null) return { label: '(no text)', width: 0, basis: 0, row: 1 };
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;visibility:hidden;inline-size:${getComputedStyle(text).flexBasis}`;
        text.append(probe);
        const basis = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          label: text.querySelector('.m-settings-row__label')?.textContent ?? '',
          width: text.getBoundingClientRect().width,
          basis,
          row: row.getBoundingClientRect().width,
        };
      }),
    );
    rows += found.length;
    for (const row of found) {
      if (row.width + 0.5 < Math.min(row.basis, row.row)) {
        narrow.push(`${name} › ${row.label}: ${String(Math.round(row.width))} px of ${String(Math.round(row.basis))}`);
      }
    }
  }
  expect(rows).toBeGreaterThan(20);
  expect(narrow).toStrictEqual([]);
});

test('the FLOAT BAR covers no ORGANIZE card at 1280 × 800', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  const bar = await boxOf(page.getByRole('toolbar', { name: 'Float bar' }));
  const first = await boxOf(page.locator('.m-page-grid').getByRole('button', { name: 'Page 1', exact: true }));
  expect(first.x).toBeGreaterThanOrEqual(bar.x + bar.width);
});

test('a DIALOG’S OPTION GROUP has no bare frame, and each option is a line of its own (Print)', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Print…');
  const dialog = page.getByRole('dialog', { name: 'Print' });
  await expect(dialog).toBeVisible();
  expect(await dialog.locator('fieldset').evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const radios = dialog.getByRole('radio');
  const tops = await Promise.all([0, 1, 2].map(async (at) => (await boxOf(radios.nth(at))).y));
  // ONE TO A LINE: three distinct rows, top to bottom, rather than a run of three that wraps mid-sentence.
  expect(tops[1]).toBeGreaterThan(tops[0] ?? Number.POSITIVE_INFINITY);
  expect(tops[2]).toBeGreaterThan(tops[1] ?? Number.POSITIVE_INFINITY);
});

test('MERGE’s document list stands clear of the button under it', async ({ page }) => {
  await openTwoDocuments(page);
  await openSection(page, 'Organize');
  await page.getByRole('button', { name: 'Merge', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: /Merge/u });
  await expect(dialog.getByRole('combobox')).toBeVisible();
  const list = await boxOf(dialog.getByRole('combobox'));
  const button = await boxOf(dialog.getByRole('button', { name: 'Merge', exact: true }));
  expect(button.y - (list.y + list.height)).toBeGreaterThanOrEqual(8);
});
