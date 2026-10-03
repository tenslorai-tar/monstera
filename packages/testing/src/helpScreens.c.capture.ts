import { writeFileSync } from 'node:fs';

import { displayLocationSchema } from '@monstera/contract';
import { asDocId, asDocVersion, asFileHandle } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import {
  type SceneShim,
  openApp,
  openDocument,
  openSection,
  runCommand,
  samplePdf,
  shoot,
} from './helpScreensHarness.js';

const SCRATCH = 'C:/Users/emiso/AppData/Local/Temp/claude/C--Users-emiso-Desktop-Claude-Monstera/f0f77468-166f-4838-bf05-b9d2eb4f8194/scratchpad/c-explore';

const EXPLORE = (process.env['EXPLORE'] ?? '').split('|').filter((title) => title !== '');

test('explore', async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page);
  await openDocument(page);
  for (const title of EXPLORE) {
    const slug = title.replace(/[^a-z0-9]+/giu, '-');
    await runCommand(page, title);
    await page.waitForTimeout(800);
    const dialog = page.getByRole('dialog');
    const snapshot = (await dialog.count()) > 0 ? await dialog.first().ariaSnapshot() : await page.locator('body').ariaSnapshot();
    writeFileSync(`${SCRATCH}-${slug}.txt`, snapshot);
    await page.screenshot({ path: `${SCRATCH}-${slug}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
});

test('explore-start', async ({ page }) => {
  const entries = ['Annual report.pdf', 'Board minutes.pdf', 'Supplier contract.pdf'].map((name, at) => ({
    handle: asFileHandle(`handle-${String(at)}`),
    name,
    location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
    openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
    availability: 'available' as const,
  }));
  await openApp(page, {
    recent: entries,
    lastExitClean: false,
    lastSession: entries.slice(0, 2).map(({ handle, name, availability }) => ({ handle, name, availability })),
    reviewDue: true,
  });
  await page.waitForTimeout(1500);
  writeFileSync(`${SCRATCH}-start.txt`, await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: `${SCRATCH}-start.png` });
  await openDocument(page);
  await page.waitForTimeout(1000);
  writeFileSync(`${SCRATCH}-doc.txt`, await page.locator('body').ariaSnapshot());
  writeFileSync(`${SCRATCH}-doc.html`, await page.locator('body').innerHTML());
});

test('explore-more', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  for (const [section, caption] of (process.env['EXPLORE_MORE'] ?? '').split('|').map((pair) => pair.split(':'))) {
    if (section === undefined || caption === undefined) continue;
    await openSection(page, section);
    const group = page
      .locator('.m-ribbon__group')
      .filter({ has: page.locator('.m-ribbon__caption', { hasText: new RegExp(`^${caption}$`, 'u') }) });
    await group.getByRole('button', { name: 'More' }).click();
    await page.waitForTimeout(500);
    writeFileSync(`${SCRATCH}-more-${section}-${caption}.txt`, await page.getByRole('menu').ariaSnapshot());
    await page.screenshot({ path: `${SCRATCH}-more-${section}-${caption}.png` });
    await page.keyboard.press('Escape');
  }
});

test('explore-misc', async ({ page }) => {
  await openApp(page, { recent: recentFiles(), reviewDue: true });
  await page.locator('.m-start-footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCRATCH}-start-bottom.png` });
  await openDocument(page);
  await page.getByRole('menubar', { name: 'Menu bar' }).getByRole('menuitem', { name: 'File' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCRATCH}-filemenu.png` });
});

test('explore-sections', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  for (const section of ['Comment', 'Protect', 'Organize', 'Edit']) {
    await openSection(page, section);
    await page.waitForTimeout(500);
    writeFileSync(`${SCRATCH}-section-${section}.txt`, await page.locator('body').ariaSnapshot());
  }
});

test('explore-split-grid', async ({ page }) => {
  await openApp(page, { settings: { 'viewing.grid': true } });
  await openDocument(page);
  for (let at = 0; at < 5; at += 1) await runCommand(page, 'Zoom out');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SCRATCH}-grid-zoomed-out.png` });
  await runCommand(page, 'Split view');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCRATCH}-split.png` });
  writeFileSync(`${SCRATCH}-split.txt`, await page.locator('body').ariaSnapshot());
  const lists = await page.locator('.m-page-list').evaluateAll((all) =>
    all.map((element) => JSON.stringify(element.getBoundingClientRect())),
  );
  writeFileSync(`${SCRATCH}-split-lists.txt`, lists.join('\n'));
});

// GROUP C's SCENES: one test per screenshot id, named as the article names it. Each drives the built renderer through
// the browser shim to the state its article's steps describe, and frames what the capture note asks for.

/** The sample document's text as the shim's text layer answers it — the same lines `samplePdf` draws on each page. */
function sampleLines(): readonly (readonly string[])[] {
  return Array.from({ length: 8 }, (_, at) => [
    `Annual report — page ${String(at + 1)}`,
    ...Array.from({ length: 22 }, () => 'Revenue grew across all three regions, led by the northern accounts and renewals.'),
  ]);
}

/** The open dialog — every scene here has exactly one. */
async function theDialog(page: Page): Promise<ReturnType<Page['getByRole']>> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('print-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Print…');
  const dialog = await theDialog(page);
  await expect(dialog.getByRole('radio', { name: /^Standard/u })).toBeChecked();
  await shoot(page, 'print-1', dialog);
});

test('resize-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Resize pages…');
  const dialog = await theDialog(page);
  await dialog.getByRole('button', { name: 'A4', exact: true }).click();
  await dialog.getByRole('button', { name: 'All pages', exact: true }).click();
  await shoot(page, 'resize-pages-1', dialog);
});

test('sanitize-a-document-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Sanitize document');
  const dialog = await theDialog(page);
  for (const box of await dialog.getByRole('checkbox').all()) await expect(box).toBeChecked();
  await shoot(page, 'sanitize-a-document-1', dialog);
});

test('split-a-document-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Split…');
  const dialog = await theDialog(page);
  await dialog.getByRole('radio', { name: 'One file for each range' }).check();
  await dialog.getByRole('textbox').fill('1-3, 4-6');
  await expect(dialog.getByRole('status')).toContainText('2');
  await shoot(page, 'split-a-document-1', dialog);
});

test('watermark-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Watermark…');
  const dialog = await theDialog(page);
  await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill('DRAFT');
  await dialog.getByRole('textbox', { name: 'Opacity (%)' }).fill('20');
  await dialog.getByRole('textbox', { name: 'Angle (degrees)' }).fill('45');
  await dialog.getByRole('textbox', { name: 'Size (points)' }).fill('72');
  await expect(dialog.getByRole('button', { name: 'Add watermark' })).toBeEnabled();
  await shoot(page, 'watermark-1', dialog);
});

test('word-count-1', async ({ page }) => {
  await openApp(page, { pageLines: sampleLines() });
  await openDocument(page);
  await runCommand(page, 'Word count');
  const dialog = await theDialog(page);
  await expect(dialog.getByRole('definition').first()).not.toHaveText('0');
  await shoot(page, 'word-count-1', dialog);
});

test('spell-check-1', async ({ page }) => {
  // THE SHIM'S DICTIONARY holds three words — document, page, spelling — so the lines are made of those and two
  // misspellings of them; everything the window lists is what the real checker found in these lines.
  await openApp(page, {
    pageLines: [
      ['spelling page document', 'documnet page'],
      ['page document spelling'],
      ['spelling speling page', 'documnet'],
    ],
  });
  await openDocument(page);
  await runCommand(page, 'Spell check');
  const dialog = await theDialog(page);
  await expect(dialog).toContainText('documnet');
  await shoot(page, 'spell-check-1', dialog);
});

test('set-up-ai-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Set up AI…');
  const dialog = await theDialog(page);
  await dialog.getByRole('combobox', { name: 'Provider' }).selectOption({ label: 'Anthropic' });
  // A PLACEHOLDER, not a key: the field masks it, and the shim never sends it anywhere.
  await dialog.getByLabel('API key').fill('sk-ant-example-0000000000000000000000');
  await shoot(page, 'set-up-ai-1', dialog);
});

test('sign-a-document-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Sign document');
  const dialog = await theDialog(page);
  await dialog.getByRole('textbox', { name: 'Reason (optional)' }).fill('Approved for release');
  await dialog.getByRole('combobox', { name: 'This signature says' }).selectOption({ label: 'I approve this document' });
  await dialog.getByRole('combobox', { name: 'Timestamp' }).selectOption({ label: 'DigiCert' });
  await shoot(page, 'sign-a-document-1', dialog);
});

test('save-a-smaller-copy-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Save a smaller copy…');
  const dialog = await theDialog(page);
  await dialog.getByRole('radio', { name: 'Medium' }).check();
  await dialog.getByRole('button', { name: 'Check the size' }).click();
  await expect(dialog.getByRole('button', { name: /^Choose where to save/u })).toBeVisible();
  await shoot(page, 'save-a-smaller-copy-1', dialog);
});

test('redact-content-1', async ({ page }) => {
  await openApp(page, {
    annotations: [
      { page: 0, index: 0, kind: 'redact', rect: { x0: 72, y0: 630, x1: 300, y1: 646 } },
      { page: 0, index: 1, kind: 'redact', rect: { x0: 72, y0: 558, x1: 420, y1: 574 } },
    ],
  });
  await openDocument(page);
  await runCommand(page, 'Apply redactions');
  const dialog = await theDialog(page);
  await dialog.getByRole('combobox', { name: 'Apply to' }).selectOption({ label: 'Every page' });
  await dialog.getByRole('combobox', { name: 'Leave behind' }).selectOption({ label: 'A filled box' });
  await dialog.getByRole('combobox', { name: 'Images under a mark' }).selectOption({ label: 'Blank only the covered part' });
  await shoot(page, 'redact-content-1', dialog);
});

test('settings-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Settings');
  const dialog = await theDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await shoot(page, 'settings-1', dialog);
});

test('recognise-scanned-pages-when-exporting-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Settings');
  const dialog = await theDialog(page);
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'OCR' }).click();
  const recognise = dialog.getByRole('switch', { name: 'Recognise scanned pages when exporting' });
  await recognise.click();
  await expect(recognise).toBeChecked();
  // THE ROW WHOLE: the page is scrolled to its foot, as a person reading the switch's sentence would.
  const settingsPage = dialog.locator('.m-settings__page');
  const box = await settingsPage.boundingBox();
  if (box !== null) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(300);
  await shoot(page, 'recognise-scanned-pages-when-exporting-1', dialog);
});

test('theme-and-accent-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Settings');
  const dialog = await theDialog(page);
  await dialog.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await shoot(page, 'theme-and-accent-1', dialog.locator('.m-settings__page'), 8);
});

/** Three recent files, as main's store would list them — opened an hour apart, all in Documents › Reports. */
function recentFiles(): ChannelEntries {
  return ['Annual report.pdf', 'Board minutes.pdf', 'Supplier contract.pdf'].map((name, at) => ({
    handle: asFileHandle(`handle-${String(at)}`),
    name,
    location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
    openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
    availability: 'available' as const,
  }));
}

type ChannelEntries = NonNullable<SceneShim['recent']>;

/** A ribbon group of the section in front, by its caption. */
function ribbonGroup(page: Page, caption: string): Locator {
  return page
    .locator('.m-ribbon__group')
    .filter({ has: page.locator('.m-ribbon__caption', { hasText: new RegExp(`^${caption}$`, 'u') }) });
}

test('start-screen-1', async ({ page }) => {
  await openApp(page, { recent: recentFiles() });
  // SCROLLED TO THE FOOT: at 1280 × 800 the screen is taller than the window, and the Recent list is what the article
  // is showing beside Open PDF… and the cards — the logo above the title is what scrolls out.
  await page.locator('.m-start-footer').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Supplier contract.pdf' })).toBeInViewport();
  await shoot(page, 'start-screen-1', 'window');
});

test('recent-files-1', async ({ page }) => {
  await openApp(page, { recent: recentFiles() });
  const recent = page.locator('.m-recent');
  await recent.scrollIntoViewIfNeeded();
  await expect(recent.getByRole('button', { name: 'Clear recent files' })).toBeVisible();
  await shoot(page, 'recent-files-1', recent);
});

test('recent-files-2', async ({ page }) => {
  // FILE › RECENT (ADR-0143): the three files, and a fourth on a drive that is not connected, marked Unavailable.
  const missing = {
    handle: asFileHandle('handle-usb'),
    name: 'Site survey.pdf',
    location: displayLocationSchema.parse({ within: null, folder: 'Surveys' }),
    openedAt: new Date(Date.now() - 86_400_000).toISOString(),
    availability: 'unavailable' as const,
  };
  await openApp(page, { recent: [...recentFiles(), missing] });
  // BY THE KEYBOARD, so the pointer `shoot` parks in the corner cannot close what a hover opened.
  await page.locator('.m-menu-bar__trigger[data-menu="file"]').focus();
  await page.keyboard.press('Enter');
  const recent = page.getByRole('menuitem', { name: 'Recent' });
  await recent.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Site survey.pdf, unavailable' })).toBeVisible();
  await shoot(page, 'recent-files-2', 'window');
});

test('reopen-after-a-crash-1', async ({ page }) => {
  const recent = recentFiles();
  await openApp(page, {
    recent,
    lastExitClean: false,
    lastSession: recent.slice(0, 2).map(({ handle, name, availability }) => ({ handle, name, availability })),
  });
  const offer = page.locator('.m-recent-recover');
  await offer.scrollIntoViewIfNeeded();
  await expect(offer.getByRole('button', { name: /^Reopen/u })).toHaveCount(2);
  await shoot(page, 'reopen-after-a-crash-1', offer);
});

test('rate-monstera-1', async ({ page }) => {
  await openApp(page, { reviewDue: true });
  await openDocument(page);
  const note = page.getByRole('region', { name: /A rating in the Microsoft Store/u });
  await expect(note.getByRole('button')).toHaveCount(4);
  await shoot(page, 'rate-monstera-1', note);
});

test('properties-panel-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const panel = page.getByRole('complementary', { name: 'Properties' });
  await expect(panel.getByRole('heading', { name: 'New annotations' })).toBeVisible();
  await shoot(page, 'properties-panel-1', panel, 8);
});

test('status-bar-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const bar = page.getByRole('status', { name: 'Document status' });
  await bar.getByRole('textbox', { name: 'Go to page' }).fill('4');
  await bar.getByRole('textbox', { name: 'Go to page' }).press('Enter');
  await runCommand(page, 'Rotate page');
  await expect(bar).toContainText('Unsaved changes');
  await expect(bar.getByRole('textbox', { name: 'Go to page' })).toHaveValue('4');
  await shoot(page, 'status-bar-1', bar, 4);
});

test('zoom-and-fit-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Tools');
  // THE FOUR ARE IN THE GROUP'S MORE MENU at this width — the group itself shows the rulers, the grid and the loupe.
  await ribbonGroup(page, 'Display').getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem', { name: 'Fit page' })).toBeVisible();
  await shoot(page, 'zoom-and-fit-1', menu, 100);
});

test('undo-and-redo-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  await runCommand(page, 'Rotate page');
  const file = ribbonGroup(page, 'File');
  const undo = file.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  // NO TOOLTIP: Undo's caption is its whole title, and a ribbon button whose caption says everything is not wrapped.
  await shoot(page, 'undo-and-redo-1', file, 8);
});

test('save-a-document-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  await runCommand(page, 'Rotate page');
  const bar = page.getByRole('status', { name: 'Document status' });
  await expect(bar).toContainText('Unsaved changes');
  await ribbonGroup(page, 'File').getByRole('button', { name: 'Save' }).click();
  await expect(bar).toContainText('Saved just now');
  await shoot(page, 'save-a-document-1', 'window');
});

test('save-a-copy-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.getByRole('menubar', { name: 'Menu bar' }).getByRole('menuitem', { name: 'File' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const item = menu.getByRole('menuitem', { name: /^Save a copy/u });
  await item.focus();
  await expect(item).toBeFocused();
  // Wide enough above to take in the File trigger the menu hangs from.
  await shoot(page, 'save-a-copy-1', menu, 30);
});

/** A document to open, by its tab name — the shim answers `document.open` with each in turn. */
async function documents(names: readonly string[], bytes?: Uint8Array): Promise<Pick<SceneShim, 'opens' | 'documentBytes'>> {
  const content = bytes ?? (await samplePdf());
  const ids = names.map((_, at) => asDocId(`00000000-0000-4000-8000-0000000000c${String(at + 1)}`));
  return {
    opens: names.map((name, at) => ({
      kind: 'opened' as const,
      docId: ids[at] ?? asDocId('00000000-0000-4000-8000-0000000000c0'),
      version: asDocVersion(1),
      byteLength: content.byteLength,
      name,
    })),
    documentBytes: new Map(ids.map((id) => [id, content])),
  };
}

/** Opens the next document in the shim's queue from the title bar's + button, and waits for its tab. */
async function openAnother(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Open another document' }).click();
  await expect(page.getByRole('navigation', { name: 'Open documents' }).getByRole('button', { name, exact: true })).toBeVisible();
}

/** Goes to a page through the status bar's page field. */
async function goToPage(page: Page, at: number): Promise<void> {
  const field = page.getByRole('status', { name: 'Document status' }).getByRole('textbox', { name: 'Go to page' });
  await field.fill(String(at));
  await field.press('Enter');
  await expect(field).toHaveValue(String(at));
}

test('rotate-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await page.getByRole('region', { name: 'Pages to organize' }).getByRole('button', { name: 'Page 3', exact: true }).click();
  await ribbonGroup(page, 'Pages').getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem', { name: 'Rotate page 270°' })).toBeVisible();
  // Wide enough to take in the group's own Rotate page button to the left and the selected card to the right.
  await shoot(page, 'rotate-pages-1', menu, 230);
});

test('work-with-tabs-1', async ({ page }) => {
  await openApp(page, await documents(['Annual report.pdf', 'Board minutes.pdf', 'Supplier contract.pdf']));
  await openDocument(page);
  await openAnother(page, 'Board minutes.pdf');
  await runCommand(page, 'Rotate page');
  await openAnother(page, 'Supplier contract.pdf');
  const tabs = page.getByRole('navigation', { name: 'Open documents' });
  // AT THE TAB'S FOOT, so the menu opens below the row and leaves the three tabs in sight.
  const first = tabs.getByRole('button', { name: 'Annual report.pdf', exact: true });
  const box = await first.boundingBox();
  await first.click({ button: 'right', position: { x: 24, y: (box?.height ?? 20) - 2 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  writeFileSync(`${SCRATCH}-tabmenu.txt`, await menu.ariaSnapshot());
  await shoot(page, 'work-with-tabs-1', tabs, 130);
});

test('replace-a-page-1', async ({ page }) => {
  await openApp(page, await documents(['Annual report.pdf', 'Board minutes.pdf']));
  await openDocument(page);
  await openAnother(page, 'Board minutes.pdf');
  await page.getByRole('navigation', { name: 'Open documents' }).getByRole('button', { name: 'Annual report.pdf', exact: true }).click();
  await goToPage(page, 2);
  await runCommand(page, 'Replace page…');
  const dialog = await theDialog(page);
  await shoot(page, 'replace-a-page-1', dialog);
});

test('split-view-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  // AT HALF SIZE, where both panes have room beside the two side panels (see the report on the left pane at 100%).
  for (let at = 0; at < 5; at += 1) await runCommand(page, 'Zoom out');
  await ribbonGroup(page, 'Display').getByRole('button', { name: 'Split view' }).click();
  const panes = page.locator('.m-page-list');
  await expect(panes).toHaveCount(2);
  // THE PAGE FIELD ACTS ON THE PANE LAST CLICKED IN: the left one to page 2, the right one to page 6.
  await panes.nth(0).click({ position: { x: 120, y: 200 } });
  await goToPage(page, 2);
  await panes.nth(1).click({ position: { x: 160, y: 200 } });
  await goToPage(page, 6);
  await page.waitForTimeout(800);
  await shoot(page, 'split-view-1', 'window');
});

test('rulers-and-grid-1', async ({ page }) => {
  await openApp(page, { settings: { 'viewing.ruler-unit': 'cm' } });
  await openDocument(page);
  await openSection(page, 'Tools');
  await ribbonGroup(page, 'Display').getByRole('button', { name: 'Show grid' }).click();
  await expect(ribbonGroup(page, 'Display').getByRole('button', { name: 'Show grid' })).toHaveAttribute('aria-pressed', 'true');
  await shoot(page, 'rulers-and-grid-1', page.getByRole('region', { name: 'Document pages' }), 4);
});

test('swap-two-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const panel = page.locator('.m-document-panel');
  const fifth = panel.getByRole('button', { name: 'Page 5', exact: true });
  // THE KEYBOARD'S WAY TO THE SAME GESTURE (the article's *Good to know*): the other page's picture holds the focus,
  // ready for Shift+Enter, while page 1 is the page being read. A pointer's hover would not survive the picture.
  await page.keyboard.press('Shift');
  await fifth.focus();
  await expect(fifth).toBeFocused();
  await shoot(page, 'swap-two-pages-1', panel, 8);
});

test('translate-a-page-1', async ({ page }) => {
  await openApp(page, { secrets: { 'ai.anthropic-key': 'stored' } });
  await openDocument(page);
  await runCommand(page, 'Translate this page…');
  const dialog = await theDialog(page);
  await dialog.getByRole('combobox').first().selectOption({ label: 'French' });
  await shoot(page, 'translate-a-page-1', dialog);
});
