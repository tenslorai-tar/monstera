import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { openApp, openDocument, openSection, runCommand, samplePdf, shoot } from './helpScreensHarness.js';

// GROUP B OF THE HELP CENTRE'S SCENES (export-as-pdfa … pdf-table-from-csv). Each test is one screenshot id, named as
// its article names it, and drives the built renderer through the browser shim to the state the article describes.

/** One ribbon group, found by its caption — the groups carry no role of their own. */
function ribbonGroup(page: Page, caption: string): Locator {
  return page
    .locator('.m-ribbon__group')
    .filter({ has: page.locator('.m-ribbon__caption').getByText(caption, { exact: true }) });
}

/** Opens a ribbon group's menu button (*More*, *Export* …) and answers the menu it opened. */
async function openGroupMenu(page: Page, section: string, caption: string, button = 'More'): Promise<Locator> {
  await openSection(page, section);
  await ribbonGroup(page, caption).getByRole('button', { name: button, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Runs a command from the palette and answers the dialog it opened. */
async function openDialog(page: Page, title: string): Promise<Locator> {
  await runCommand(page, title);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// NOT CAPTURED HERE, each for a reason the shim or the harness decides rather than the application:
// - export-as-pdfa-1: the shim's `document.exportPdfa` always answers `unavailable`, so the removals window never opens.
// - export-tables-to-excel-1: the shim's `document.pageTables` finds no tables, so the dialog has no cells to show.
// - find-duplicate-pages-1: the shim's `document.duplicatePages` finds no groups, so there is no group and no Remove.
// - highlight-underline-strike-1, measure-1, page-background-1: the mark is written into the document's bytes, and
//   the shim's bytes never change after a command, so the page never shows it.
// - if-something-goes-wrong-1: the view problem panel needs a component to throw while drawing; nothing reaches it.
// - loupe-1: the loupe follows the pointer and closes when it leaves the pages, and `shoot` parks the pointer first.
// - pdf-from-camera-1: needs a live camera. pdf-from-office-1, pdf-table-from-csv-1: the picture is the converter's
//   output, and no converter runs in a browser — a page drawn here would be a made-up result.

test('export-pages-as-images-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  await ribbonGroup(page, 'Export').getByRole('button', { name: 'Image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export pages as images' });
  await expect(dialog).toBeVisible();
  // THE PAGE ROW AND THE FORMAT ARE SEGMENTED CONTROLS: each option is a toggle, a button with a pressed state.
  await dialog.getByRole('button', { name: 'Select pages', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Page numbers' }).fill('1-3');
  await dialog.getByRole('button', { name: 'JPEG', exact: true }).click();
  const quality = dialog.getByRole('textbox', { name: /quality/iu });
  if ((await quality.count()) > 0) await quality.fill('85');
  await shoot(page, 'export-pages-as-images-1', dialog);
});

test('export-to-word-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  await ribbonGroup(page, 'Export').getByRole('button', { name: 'Word', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export to Word' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio').first()).toBeChecked();
  await shoot(page, 'export-to-word-1', dialog);
});

test('extract-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await ribbonGroup(page, 'Pages').getByRole('button', { name: 'Extract pages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Extract pages' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Pages to extract' }).fill('2-4');
  await shoot(page, 'extract-pages-1', dialog);
});

test('find-and-redact-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Protect');
  await ribbonGroup(page, 'Redact').getByRole('button', { name: 'Redact matches', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark matches for redaction' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Find' }).fill('Harwood');
  await expect(dialog.getByRole('combobox', { name: 'Search' })).toHaveValue(/./u);
  await shoot(page, 'find-and-redact-1', dialog);
});

test('headers-and-footers-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await ribbonGroup(page, 'Marks').getByRole('button', { name: 'Headers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Headers and footers' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('group', { name: 'Footer' }).getByRole('textbox', { name: 'Centre' }).fill('Page {n} of {N}');
  await shoot(page, 'headers-and-footers-1', dialog);
});

test('open-from-a-web-address-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Tools', 'Create');
  await menu.getByRole('menuitem', { name: 'Open from web address…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a PDF from a web address' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Address' }).fill('https://example.com/report.pdf');
  await shoot(page, 'open-from-a-web-address-1', dialog);
});

test('make-scanned-pages-searchable-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Tools');
  await ribbonGroup(page, 'OCR').getByRole('button', { name: 'OCR pages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognise text' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'English' })).toBeChecked();
  await dialog.getByRole('group', { name: 'Pages' }).getByRole('button', { name: 'All pages' }).click();
  await shoot(page, 'make-scanned-pages-searchable-1', dialog);
});

test('page-transitions-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const dialog = await openDialog(page, 'Page transition…');
  await dialog.getByRole('group', { name: 'Transition' }).getByRole('button', { name: 'Fade' }).click();
  await dialog.getByRole('textbox', { name: 'Duration (seconds)' }).fill('1');
  await dialog.getByRole('group', { name: 'Pages' }).getByRole('button', { name: 'All pages' }).click();
  await shoot(page, 'page-transitions-1', dialog);
});

test('password-and-permissions-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Protect');
  await ribbonGroup(page, 'Encryption').getByRole('button', { name: 'Permissions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Password and permissions' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Encryption' }).selectOption({ label: 'AES-256 (recommended)' });
  // A SAMPLE VALUE, masked by the field: the picture is of the field, never of a real password.
  await dialog.getByRole('textbox', { name: 'Password to open (optional)' }).fill('sample-only');
  await expect(dialog.getByRole('checkbox', { name: 'Print', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Copy text and images' }).uncheck();
  await shoot(page, 'password-and-permissions-1', dialog);
});

test('keyboard-shortcuts-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('Control+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('row').nth(1).getByRole('button', { name: 'Change' }).click();
  await shoot(page, 'keyboard-shortcuts-1', dialog);
});

test('help-centre-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('F1');
  const help = page.getByRole('dialog', { name: 'Help centre' });
  await expect(help).toBeVisible();
  await help.locator('[data-article="rotate-pages"]').click();
  await expect(help.getByRole('group', { name: 'Show me' })).toBeVisible();
  await shoot(page, 'help-centre-1', help);
});

test('find-any-tool-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('Control+K');
  await page.keyboard.type('rotate');
  const palette = page.getByRole('dialog');
  await expect(palette.getByRole('option').first()).toBeVisible();
  await shoot(page, 'find-any-tool-1', palette);
});

test('layout-modes-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await shoot(page, 'layout-modes-1', page.getByRole('group', { name: 'Layout' }), 16);
});

test('open-a-pdf-1', async ({ page }) => {
  await openApp(page);
  await expect(page.getByText('or drop a PDF anywhere in this window')).toBeVisible();
  await shoot(page, 'open-a-pdf-1', page.locator('.m-start-primary'), 24);
});

test('float-bar-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.getByRole('status', { name: 'Document status' }).getByRole('button', { name: 'Fit width' }).click();
  const bar = page.getByRole('toolbar', { name: 'Float bar' });
  await expect(bar).toBeVisible();
  await shoot(page, 'float-bar-1', bar, 64);
});

test('export-text-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Tools', 'Convert');
  await expect(menu.getByRole('menuitem', { name: 'Export text…' })).toBeVisible();
  await shoot(page, 'export-text-1', menu, 12);
});

test('export-to-powerpoint-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  const group = ribbonGroup(page, 'Export');
  await group.getByRole('button', { name: 'PowerPoint', exact: true }).focus();
  await shoot(page, 'export-to-powerpoint-1', group, 8);
});

test('insert-a-blank-page-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Organize', 'Pages');
  await menu.getByRole('menuitem', { name: 'Insert blank page' }).focus();
  await shoot(page, 'insert-a-blank-page-1', menu, 12);
});

test('insert-an-image-as-a-page-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Organize', 'Pages');
  await menu.getByRole('menuitem', { name: 'Insert image…' }).focus();
  await shoot(page, 'insert-an-image-as-a-page-1', menu, 12);
});

test('form-data-import-export-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Forms', 'Data', 'Export');
  await shoot(page, 'form-data-import-export-1', menu, 12);
});

test('pdf-from-markdown-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Tools');
  await shoot(page, 'pdf-from-markdown-1', ribbonGroup(page, 'Create'), 12);
});

/** A second open document for the scenes that choose one: two pages of an appendix. */
async function appendixPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let at = 0; at < 2; at += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`Appendix — page ${String(at + 1)}`, { x: 72, y: 700, size: 22, font: bold });
    page.drawText('Regional figures by quarter.', { x: 72, y: 660, size: 11, font });
  }
  return document.save();
}

/** Opens the sample document and then a second one, as a person with two tabs has them. */
async function openTwoDocuments(page: Page): Promise<void> {
  const report = await samplePdf();
  const appendix = await appendixPdf();
  const reportId = asDocId('00000000-0000-4000-8000-0000000000b1');
  const appendixId = asDocId('00000000-0000-4000-8000-0000000000b2');
  await openApp(page, {
    opens: [
      { kind: 'opened', docId: reportId, version: asDocVersion(1), byteLength: report.byteLength, name: 'Annual report.pdf' },
      { kind: 'opened', docId: appendixId, version: asDocVersion(1), byteLength: appendix.byteLength, name: 'Appendix.pdf' },
    ],
    documentBytes: new Map([
      [reportId, report],
      [appendixId, appendix],
    ]),
  });
  await openDocument(page);
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect(page.getByRole('navigation', { name: 'Open documents' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Open documents' }).getByRole('button', { name: 'Annual report.pdf', exact: true }).click();
  await expect.poll(() => page.locator('canvas:visible').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
}

test('merge-documents-1', async ({ page }) => {
  await openTwoDocuments(page);
  await openSection(page, 'Organize');
  await ribbonGroup(page, 'Combine').getByRole('button', { name: 'Merge', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Merge/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveText(/Appendix\.pdf/u);
  await shoot(page, 'merge-documents-1', dialog);
});

test('insert-pages-from-a-pdf-1', async ({ page }) => {
  await openTwoDocuments(page);
  await openSection(page, 'Organize');
  await ribbonGroup(page, 'Pages').getByRole('button', { name: 'Insert PDF', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Insert/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveText(/Appendix\.pdf/u);
  await dialog.getByRole('textbox').first().fill('3');
  await shoot(page, 'insert-pages-from-a-pdf-1', dialog);
});

test('import-page-as-layer-1', async ({ page }) => {
  await openTwoDocuments(page);
  const menu = await openGroupMenu(page, 'Organize', 'Pages');
  await menu.getByRole('menuitem', { name: 'Import page as layer…' }).click();
  const dialog = page.getByRole('dialog', { name: /layer/iu });
  await expect(dialog).toBeVisible();
  await shoot(page, 'import-page-as-layer-1', dialog);
});

test('open-a-protected-pdf-1', async ({ page }) => {
  // A REAL AES-256 FILE, encrypted by pdf-lib: PDF.js meets the encryption and the application asks for the password.
  const document = await PDFDocument.load(await samplePdf(), { updateMetadata: false });
  document.encrypt({ userPassword: 'sample-only', ownerPassword: 'sample-owner', algorithm: 'AES-256' });
  const locked = await document.save();
  const docId = asDocId('00000000-0000-4000-8000-0000000000b3');
  await openApp(page, {
    opens: [{ kind: 'opened', docId, version: asDocVersion(1), byteLength: locked.byteLength, name: 'Salaries 2026.pdf' }],
    documentBytes: new Map([[docId, locked]]),
  });
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await shoot(page, 'open-a-protected-pdf-1', dialog);
});

/** The sample document's own text, page by page — what `document.searchPage` searches, as the kernel would read it. */
function sampleLines(): string[][] {
  return Array.from({ length: 8 }, (_, at) => [
    `Annual report — page ${String(at + 1)}`,
    ...Array.from({ length: 22 }, () => 'Revenue grew across all three regions, led by the northern accounts and renewals.'),
  ]);
}

test('find-text-1', async ({ page }) => {
  await openApp(page, { pageLines: sampleLines() });
  await openDocument(page);
  await page.keyboard.press('Control+F');
  const panel = page.getByRole('tabpanel', { name: 'Search' });
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: 'Find on this page' }).fill('renewals');
  await panel.getByRole('button', { name: 'Search all pages' }).click();
  await expect(panel.getByText(/matches in this document/u)).toBeVisible();
  // THE PANEL ALONE: the shim places a page's text boxes by line index rather than where the words are drawn, so a
  // match outlined on the page would sit where the shim put it, not where the word is.
  await shoot(page, 'find-text-1', panel, 8);
});

test('find-and-replace-1', async ({ page }) => {
  await openApp(page, { pageLines: sampleLines() });
  await openDocument(page);
  await page.keyboard.press('Control+F');
  const panel = page.getByRole('tabpanel', { name: 'Search' });
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: 'Find on this page' }).fill('renewals');
  await panel.getByRole('textbox', { name: 'Replace with' }).fill('contract renewals');
  await shoot(page, 'find-and-replace-1', panel, 8);
});

test('fill-in-a-form-1', async ({ page }) => {
  const rect = (y: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 72, y0: y, x1: 300, y1: y + 20 });
  const fields = [
    { page: 0, index: 0, kind: 'text', name: 'Full name', values: [], on: null, options: [], readOnly: false, rect: rect(640) },
    { page: 0, index: 1, kind: 'text', name: 'Email', values: [], on: null, options: [], readOnly: false, rect: rect(600) },
    { page: 0, index: 2, kind: 'checkbox', name: 'Subscribe to updates', values: [], on: true, options: [], readOnly: false, rect: rect(560) },
    { page: 0, index: 3, kind: 'radio', name: 'Member', values: [], on: false, options: [], readOnly: false, rect: rect(520) },
    { page: 0, index: 4, kind: 'dropdown', name: 'Region', values: ['North'], on: null, options: ['North', 'South', 'West'], readOnly: false, rect: rect(480) },
  ] as const;
  await openApp(page, { formFields: [fields] });
  await openDocument(page);
  await page.getByRole('tablist', { name: 'Document panels' }).getByRole('tab', { name: 'Forms' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Forms' });
  await expect(panel.getByRole('textbox', { name: 'Full name' })).toBeVisible();
  await panel.getByRole('textbox', { name: 'Full name' }).fill('Jordan Ellis');
  await shoot(page, 'fill-in-a-form-1', panel.getByRole('region', { name: 'Form fields in this document' }), 12);
});

test('flatten-a-form-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Forms');
  await shoot(page, 'flatten-a-form-1', ribbonGroup(page, 'Manage'), 12);
});

test('layers-1', async ({ page }) => {
  await openApp(page, {
    layers: [
      [
        { index: 0, name: 'Floor plan', visible: true },
        { index: 1, name: 'Furniture', visible: false },
      ],
    ],
  });
  await openDocument(page);
  await page.getByRole('tablist', { name: 'Document panels' }).getByRole('tab', { name: 'Layers' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Layers' });
  await expect(panel.getByRole('checkbox')).toHaveCount(2);
  await shoot(page, 'layers-1', panel.getByRole('region', { name: 'Layers' }), 16);
});

test('move-between-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.getByRole('navigation', { name: 'Page thumbnails' }).getByRole('button', { name: 'Page 3' }).click();
  await expect(page.getByRole('textbox', { name: 'Go to page' })).toHaveValue('3');
  await shoot(page, 'move-between-pages-1', page.locator('.m-document-panel'), 8);
});

test('organize-pages-grid-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  // THE FLOAT BAR PUT AWAY, with its own status-bar button, so the picture is of the grid alone. (It sat over the
  // first column of cards until the grid reserved its lane, 2026-10-01; `layoutReview.pw.ts` holds that.)
  await page.getByRole('status', { name: 'Document status' }).getByRole('button', { name: 'Show or hide the Float bar' }).click();
  await expect(page.getByRole('toolbar', { name: 'Float bar' })).toBeHidden();
  const grid = page.locator('.m-page-grid');
  await grid.getByRole('button', { name: 'Page 3', exact: true }).click();
  await grid.getByRole('button', { name: 'Page 5', exact: true }).click({ modifiers: ['Control'] });
  await expect(grid.getByText('2 selected')).toBeVisible();
  await shoot(page, 'organize-pages-grid-1', grid, 0);
});

test('other-renderer-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const dialog = await openDialog(page, 'Settings');
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'Rendering' }).click();
  const toggle = dialog.getByRole('switch', { name: 'Draw pages with the other renderer' });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await shoot(page, 'other-renderer-1', dialog);
});

test('page-layout-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const dialog = await openDialog(page, 'Settings');
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'Viewing' }).click();
  await expect(dialog.getByRole('heading', { name: 'Viewing' })).toBeVisible();
  await shoot(page, 'page-layout-1', dialog);
});

test('pdf-from-images-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const menu = await openGroupMenu(page, 'Tools', 'Create');
  await menu.getByRole('menuitem', { name: 'New PDF from images…' }).focus();
  await shoot(page, 'pdf-from-images-1', menu, 12);
});
