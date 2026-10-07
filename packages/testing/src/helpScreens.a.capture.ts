import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import {
  SAMPLE_DOC_ID,
  type SceneShim,
  openApp,
  openDocument,
  openSection,
  runCommand,
  samplePdf,
  shoot,
} from './helpScreensHarness.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The id `openApp` gives the sample document, so a scene that swaps the bytes keeps the same tab. */
const SAMPLE_ID = asDocId(SAMPLE_DOC_ID);

/**
 * The shim options that open `bytes` as the one document, under `name`, in place of the sample — for a scene whose
 * article is about a document the sample is not (a form, a page with a logo). The bytes are a real PDF that PDF.js
 * draws, so what the picture shows is the document the shim's other answers describe.
 */
function openedAs(bytes: Uint8Array, name: string): Pick<SceneShim, 'opens' | 'documentBytes'> {
  return {
    opens: [{ kind: 'opened', docId: SAMPLE_ID, version: asDocVersion(1), byteLength: bytes.byteLength, name }],
    documentBytes: new Map([[SAMPLE_ID, bytes]]),
  };
}

/**
 * Takes screenshot `id` framed on several targets at once — a dialog AND the control or mark it belongs to.
 *
 * `shoot` frames one target; this computes the box around all of them and hands `shoot` a frame by way of the
 * window, with the same settling and pointer parking, so no second opinion about how a picture is taken lives here.
 */
async function shootAround(page: Page, id: string, targets: readonly Locator[], pad = 16): Promise<void> {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()));
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    if (box === null) throw new Error(`screenshot ${id}: one of its targets is not on screen`);
    x0 = Math.min(x0, box.x);
    y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.width);
    y1 = Math.max(y1, box.y + box.height);
  }
  await shoot(page, id, frameOf(page, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }), pad);
}

/**
 * A stand-in for a locator whose one member `shoot` reads — `boundingBox` — answers `box`.
 *
 * The harness frames a single locator and a scene file does not edit it, so this hands it a REGION rather than
 * re-implementing how a picture is taken (clamping to the window, parking the pointer, settling, where the file is
 * written). Every other member is the page root's, untouched.
 */
function frameOf(page: Page, box: { x: number; y: number; width: number; height: number }): Locator {
  const root = page.locator(':root');
  return new Proxy(root, {
    get(target, property, receiver) {
      if (property === 'boundingBox') return () => Promise.resolve(box);
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

// GROUP A OF THE HELP CENTRE'S SCENES (ADR-0112): one test per screenshot id, named as its article names it. Each
// scene drives the built renderer through the browser shim into the state its article's steps describe, and frames
// what the capture note asks for. A state the shim cannot produce is not drawn here — no page edit stands in for it.

/** The drawing surface over page `n` (1-based, as the surface's own label counts). */
function surface(page: Page, n = 1): Locator {
  return page.getByLabel(`Draw on page ${String(n)}`);
}

/** A spot on a Letter page, in points measured RIGHT from its left edge and DOWN from its top edge. */
type OnPage = readonly [right: number, down: number];

/**
 * Where `at` is in the window, on page `n`'s drawing surface. Both axes run the way the window's do, so the only
 * conversion is the surface's scale — the sample's pages are all 612 points wide.
 */
async function windowPoint(page: Page, at: OnPage, n = 1): Promise<{ x: number; y: number }> {
  const box = await surface(page, n).boundingBox();
  if (box === null) throw new Error(`page ${String(n)}'s drawing surface is not on screen`);
  const scale = box.width / 612;
  return { x: box.x + at[0] * scale, y: box.y + at[1] * scale };
}

/** Drags on page `n` from one spot to another. */
async function dragOnPage(page: Page, from: OnPage, to: OnPage, n = 1): Promise<void> {
  const start = await windowPoint(page, from, n);
  const end = await windowPoint(page, to, n);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** Clicks page `n` at a spot. */
async function clickOnPage(page: Page, at: OnPage, n = 1): Promise<void> {
  const point = await windowPoint(page, at, n);
  await page.mouse.click(point.x, point.y);
}

test('accessibility-check-1', async ({ page }) => {
  // THE KERNEL'S VERDICTS FOR THE SAMPLE DOCUMENT, read off `packages/kernel/src/accessibilityCheck.ts` rather than
  // invented: pdf-lib writes no XMP, no /MarkInfo, no /ViewerPreferences and no structure tree, and draws with two
  // unembedded standard fonts shared by all eight pages. Pages are the kernel's 0-based indices; the command turns
  // them into the numbers a person reads.
  const everyPage = [0, 1, 2, 3, 4, 5, 6, 7];
  /** A rule's answer; a failure on pages is placed on each page as a whole, as the kernel places a font. */
  const rule = (
    clause: string,
    test: number,
    verdict: 'passed' | 'failed' | 'not-applicable',
    count: number,
    pages: readonly number[],
  ) => ({ clause, test, verdict, count, pages, spots: pages.map((each) => ({ page: each, box: null })) });
  await openApp(page, {
    accessibilityRules: [
      rule('5', 1, 'not-applicable', 0, []),
      rule('6.2', 1, 'failed', 1, []),
      rule('7.1', 4, 'passed', 0, []),
      rule('7.1', 8, 'failed', 1, []),
      rule('7.1', 9, 'not-applicable', 0, []),
      rule('7.1', 10, 'failed', 1, []),
      rule('7.1', 11, 'failed', 1, []),
      rule('7.1', 5, 'not-applicable', 0, []),
      rule('7.3', 1, 'not-applicable', 0, []),
      rule('7.16', 1, 'not-applicable', 0, []),
      rule('7.18.1', 2, 'not-applicable', 0, []),
      rule('7.18.1', 3, 'not-applicable', 0, []),
      rule('7.18.3', 1, 'not-applicable', 0, []),
      rule('7.18.5', 2, 'not-applicable', 0, []),
      rule('7.21.4.1', 1, 'failed', 2, everyPage),
    ],
  });
  await openDocument(page);
  await openSection(page, 'Review');
  await runCommand(page, 'Accessibility check');
  // THE TOOL IN THE LEFT DOCUMENT PANEL (ADR-0189), which holds the page's side while it is open.
  const panel = page.locator('[data-panel-tool="open"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Needs fixing')).toBeVisible();
  await shoot(page, 'accessibility-check-1', panel);
});

test('bates-numbering-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await runCommand(page, 'Bates numbering…');
  const dialog = page.getByRole('dialog', { name: 'Bates numbering' });
  await dialog.getByLabel('Prefix').fill('ABC');
  await dialog.getByLabel('Start at').fill('431');
  await dialog.getByLabel('Digits').fill('6');
  await dialog.getByRole('button', { name: 'Bottom', exact: true }).click();
  await dialog.getByRole('button', { name: 'Right', exact: true }).click();
  await expect(dialog.getByText('ABC000431')).toBeVisible();
  await shoot(page, 'bates-numbering-1', dialog);
});

test('crop-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await runCommand(page, 'Crop pages…');
  const dialog = page.getByRole('dialog', { name: 'Crop pages' });
  for (const edge of ['Top', 'Bottom', 'Left', 'Right']) await dialog.getByLabel(`${edge} (points)`).fill('36');
  await dialog.getByRole('button', { name: 'All pages', exact: true }).click();
  await shoot(page, 'crop-pages-1', dialog);
});

test('delete-pages-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await runCommand(page, 'Delete pages…');
  const dialog = page.getByRole('dialog', { name: 'Delete pages' });
  await dialog.getByLabel('Pages to delete').fill('2, 4-5');
  await shoot(page, 'delete-pages-1', dialog);
});

test('donate-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const donate = page.getByRole('button', { name: 'Donate', exact: true });
  await donate.click();
  const dialog = page.getByRole('dialog', { name: 'Support Monstera' });
  await expect(dialog).toBeVisible();
  // THE BUTTON IS INERT UNDER THE MODAL, so the accessibility tree hides it; it is still where it was.
  await shootAround(page, 'donate-1', [dialog, page.getByRole('button', { name: 'Donate', exact: true, includeHidden: true })]);
});

test('autosave-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'Saving' }).click();
  await dialog.getByLabel('Save automatically').selectOption({ label: 'Every 5 minutes' });
  await shoot(page, 'autosave-1', dialog);
});

test('add-a-stamp-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Comment');
  await page.getByRole('button', { name: 'Stamp', exact: true }).click();
  await dragOnPage(page, [360, 20], [540, 80]);
  const dialog = page.getByRole('dialog', { name: 'Choose a stamp' });
  await dialog.getByRole('radio', { name: 'VOID', exact: true }).check();
  // THE DIALOG ALONE: the modal blurs the page behind it, the box drawn included.
  await shoot(page, 'add-a-stamp-1', dialog);
});

test('add-a-text-box-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Comment');
  // THROUGH THE PALETTE: at 1280 wide the Markup group folds Text box into its More.
  await runCommand(page, 'Text box');
  await dragOnPage(page, [360, 20], [540, 80]);
  // TYPED WHERE THE WORDS GO (ADR-0154): the box drawn holds the caret, and the words are set as the page will set them.
  const box = page.getByRole('textbox', { name: 'Text box' });
  await box.fill('See figure 3');
  await shootAround(page, 'add-a-text-box-1', [box], 48);
});

test('add-a-note-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Comment');
  await runCommand(page, 'Note');
  await clickOnPage(page, [520, 60]);
  // ITS BOX OPENS WHERE IT WAS CLICKED (ADR-0154), a card on the page; the note's icon is drawn once it is added.
  const box = page.getByRole('textbox', { name: 'Comment' });
  await box.fill('Check this figure');
  await shootAround(page, 'add-a-note-1', [box], 48);
});

test('add-links-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Comment');
  await page.getByRole('button', { name: 'Web link', exact: true }).click();
  await dragOnPage(page, [72, 122], [300, 136]);
  // TYPED BESIDE THE REGION DRAWN (ADR-0154): a line under the box, in the application's own field.
  const line = page.getByRole('textbox', { name: 'Address' });
  await line.fill('https://example.com');
  await shootAround(page, 'add-links-1', [line], 48);
});

/** The four places to write on {@link formPdf}'s page, in PDF user space: the label, and the ruled line after it. */
const FORM_ROWS = [
  { label: 'Full name', name: 'full_name', y: 640 },
  { label: 'Email address', name: 'email_address', y: 600 },
  { label: 'Phone', name: 'phone', y: 560 },
  { label: 'Date of birth', name: 'date_of_birth', y: 520 },
] as const;

/** A flat one-page form: printed labels, each followed by a ruled line to write on, and no fields at all. */
async function formPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([612, 792]);
  page.drawText('Membership application', { x: 72, y: 700, size: 22, font: bold });
  for (const row of FORM_ROWS) {
    page.drawText(`${row.label}:`, { x: 72, y: row.y, size: 12, font });
    page.drawLine({ start: { x: 180, y: row.y - 2 }, end: { x: 520, y: row.y - 2 }, thickness: 0.8, color: rgb(0, 0, 0) });
  }
  return document.save();
}

/** Where {@link logoPdf} draws its logo on page 1, in PDF user space. */
const LOGO = { left: 468, bottom: 684, right: 540, top: 756 } as const;

/** The sample report with the Monstera logo, a real image object, at the top right of page 1. */
async function logoPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await samplePdf(), { updateMetadata: false });
  const logo = await document.embedPng(readFileSync(join(REPO_ROOT, 'assets', 'brand', 'logo-256.png')));
  document.getPage(0).drawImage(logo, {
    x: LOGO.left,
    y: LOGO.bottom,
    width: LOGO.right - LOGO.left,
    height: LOGO.top - LOGO.bottom,
  });
  return document.save();
}

/** One object as `document.pageObjects` answers it. */
type PageObject = NonNullable<SceneShim['pageObjects']>[number];

/**
 * The objects on page 1 of {@link logoPdf}, in the order its content stream draws them: the title and each body line
 * are one text object apiece (pdf-lib writes one text block per `drawText`), then the logo. Each text object's box is
 * computed from the same text, size and font the sample draws with, through pdf-lib's own metrics — so the numbers
 * the dialog shows are this page's, not ones written here.
 */
async function logoPageObjects(): Promise<PageObject[]> {
  const scratch = await PDFDocument.create();
  const font = await scratch.embedFont(StandardFonts.Helvetica);
  const bold = await scratch.embedFont(StandardFonts.HelveticaBold);
  const black = { red: 0, green: 0, blue: 0, alpha: 255 };
  const boxOf = (text: string, size: number, face: typeof font, x: number, y: number): Omit<PageObject, 'index' | 'kind' | 'fill'> => {
    const below = face.heightAtSize(size, { descender: true }) - face.heightAtSize(size, { descender: false });
    return { left: x, bottom: y - below, right: x + face.widthOfTextAtSize(text, size), top: y + face.heightAtSize(size, { descender: false }) };
  };
  const body = 'Revenue grew across all three regions, led by the northern accounts and renewals.';
  const objects: PageObject[] = [{ index: 0, kind: 'text', ...boxOf('Annual report — page 1', 22, bold, 72, 700), fill: black }];
  for (let line = 0; line < 22; line += 1) {
    objects.push({ index: line + 1, kind: 'text', ...boxOf(body, 11, font, 72, 660 - line * 24), fill: black });
  }
  objects.push({ index: 23, kind: 'image', ...LOGO, fill: null });
  return objects;
}

test('ai-keys-and-pricing-1', async ({ page }) => {
  // A KEY ALREADY STORED, as the OS credential store holds one: the shim answers that the id is stored and never
  // hands the value back, which is what the write-only field shows.
  await openApp(page, { settings: { 'ai.provider': 'anthropic' }, secrets: { 'ai.anthropic-key': 'stored-in-the-vault' } });
  await openDocument(page);
  await runCommand(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings pages' }).getByRole('button', { name: 'AI' }).click();
  await expect(dialog.getByText('A key is stored. Type a new one to replace it.').first()).toBeVisible();
  await shoot(page, 'ai-keys-and-pricing-1', dialog);
});

test('ai-keys-and-pricing-2', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Review');
  await runCommand(page, 'Set up AI…');
  const dialog = page.getByRole('dialog', { name: 'Set up the AI assistant' });
  await dialog.getByLabel('Provider').selectOption({ label: 'Azure OpenAI' });
  await expect(dialog.getByLabel('Azure OpenAI endpoint')).toBeVisible();
  await shoot(page, 'ai-keys-and-pricing-2', dialog);
});

test('barcodes-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  await runCommand(page, 'Add a barcode');
  // ORGANIZE'S PAGE AREA IS THE GRID, which has no page to drag on: opening page 1 from it (a double-click) returns
  // the reading view with the tool still chosen.
  await page.locator('[data-thumb-page="0"]').nth(1).dblclick();
  await dragOnPage(page, [460, 20], [540, 100]);
  const dialog = page.getByRole('dialog', { name: 'Add a barcode' });
  await dialog.getByLabel('Text or link').fill('https://example.com');
  await dialog.getByRole('radio', { name: 'QR Code' }).check();
  await shoot(page, 'barcodes-1', dialog);
});

test('check-signatures-1', async ({ page }) => {
  // THE CHANNEL'S ANSWER FOR A DOCUMENT WITH ONE INTACT SIGNATURE, as `document.signatures` carries it: both
  // coverage answers true, the certificate's dates as the kernel's ISO strings.
  await openApp(page, {
    signatures: {
      signatures: [
        {
          signer: 'Dana Whitfield',
          organisation: 'Northwind Holdings',
          reason: 'Approved for publication',
          location: 'London',
          notBefore: '2026-01-05T00:00:00.000Z',
          notAfter: '2028-01-05T00:00:00.000Z',
          coversDocument: true,
          coversWholeFile: true,
        },
      ],
      unreadable: false,
    },
  });
  await openDocument(page);
  await openSection(page, 'Protect');
  await runCommand(page, 'Check signatures');
  const dialog = page.getByRole('dialog', { name: 'Signatures' });
  await expect(dialog.getByText('Unchanged since it was signed')).toBeVisible();
  await shoot(page, 'check-signatures-1', dialog);
});

test('close-with-unsaved-changes-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  // ONE CHANGE, through a real command, so the shim's `document.unsaved` answers from its own log.
  await runCommand(page, 'Rotate page');
  await page.keyboard.press('Control+w');
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(dialog).toBeVisible();
  await shoot(page, 'close-with-unsaved-changes-1', dialog);
});

test('create-form-fields-1', async ({ page }) => {
  await openApp(page, openedAs(await formPdf(), 'Membership application.pdf'));
  await openDocument(page);
  await openSection(page, 'Forms');
  await runCommand(page, 'Draw a text field');
  // ALONG THE FULL NAME LINE, which sits 154 points down the page.
  await dragOnPage(page, [180, 140], [520, 156]);
  // NAMED BESIDE THE BOX DRAWN (ADR-0154), in a line under it.
  const line = page.getByRole('textbox', { name: 'Field name' });
  await line.fill('full_name');
  await shootAround(page, 'create-form-fields-1', [line], 48);
});

test('detect-form-fields-1', async ({ page }) => {
  // WHAT THE DETECTOR WOULD PROPOSE FOR THIS PAGE: each ruled line after its label, named from the label.
  await openApp(page, {
    ...openedAs(await formPdf(), 'Membership application.pdf'),
    flatFieldCandidates: FORM_ROWS.map((row) => ({
      rect: { x0: 180, y0: row.y - 2, x1: 520, y1: row.y + 14 },
      label: row.label,
      name: row.name,
    })),
  });
  await openDocument(page);
  await openSection(page, 'Forms');
  await runCommand(page, 'Find fields on this page…');
  const dialog = page.getByRole('dialog', { name: 'Fields this page could have' });
  await dialog.getByRole('checkbox', { name: /Date of birth/u }).uncheck();
  await shoot(page, 'detect-form-fields-1', dialog);
});

test('docusign-1', async ({ page }) => {
  // AN INTEGRATION KEY STORED, which is what makes the DocuSign commands appear at all.
  await openApp(page, { secrets: { 'integrations.docusign-integration-key': 'stored-in-the-vault' } });
  await openDocument(page);
  await openSection(page, 'Protect');
  await runCommand(page, 'Send to DocuSign');
  const dialog = page.getByRole('dialog', { name: 'Send to DocuSign' });
  await dialog.getByLabel('Email subject').fill('Please sign: Annual report');
  await dialog.getByLabel('Signer name').fill('Dana Whitfield');
  await dialog.getByLabel('Signer email').fill('dana@example.com');
  await shoot(page, 'docusign-1', dialog);
});

test('edit-page-in-another-app-1', async ({ page }) => {
  // THE OTHER APP SAVED THE PAGE: the send answers `sent` (the picker was answered) and the watch answers `changed`.
  await openApp(page, { externalEditSends: [{ kind: 'sent' }], externalEditWaits: [{ kind: 'changed' }] });
  await openDocument(page);
  await openSection(page, 'Organize');
  await runCommand(page, 'Edit page in another app…');
  const dialog = page.getByRole('dialog', { name: 'Put the edited page back?' });
  await expect(dialog).toBeVisible();
  await shoot(page, 'edit-page-in-another-app-1', dialog);
});

test('edit-page-objects-1', async ({ page }) => {
  await openApp(page, { ...openedAs(await logoPdf(), 'Annual report.pdf'), pageObjects: await logoPageObjects() });
  await openDocument(page);
  await openSection(page, 'Edit');
  // THE MODE ON THE PAGE (ADR-0153): every object outlined where it is, and the logo selected with its handles.
  await page.getByRole('button', { name: 'Edit object' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Edit all objects' }).click();
  const layer = page.getByRole('group', { name: 'Objects on page 1' });
  const logo = layer.locator('[data-object="content:23"]');
  await logo.click();
  await expect(logo).toHaveAttribute('aria-pressed', 'true');
  // FRAMED ON WHAT THE ARTICLE NAMES: the outlined title, the selected logo with its handles, and the Properties tab
  // saying what is selected — the whole page is taller than the window and says nothing more.
  const named = page.locator('.m-properties__head').first();
  await expect(named.getByRole('heading', { name: 'Object' })).toBeVisible();
  await shootAround(page, 'edit-page-objects-1', [
    layer.locator('[data-object="content:0"]'),
    layer.locator('[data-object="content:5"]'),
    logo,
    named,
  ]);
});

/** A ribbon group, by its caption. */
function ribbonGroup(page: Page, caption: string): Locator {
  return page.locator('.m-ribbon__group', { has: page.locator('.m-ribbon__caption', { hasText: new RegExp(`^${caption}$`, 'u') }) });
}

test('comment-files-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Review');
  const group = ribbonGroup(page, 'Comment files');
  await expect(group).toBeVisible();
  await shoot(page, 'comment-files-1', group, 8);
});

test('duplicate-a-page-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  const group = ribbonGroup(page, 'Pages');
  // AT THIS WIDTH DUPLICATE PAGE IS IN THE GROUP'S MORE, so the picture shows it where a person finds it.
  await group.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Duplicate page/u })).toBeVisible();
  await shootAround(page, 'duplicate-a-page-1', [group, menu], 8);
});

test('export-a-searchable-copy-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Tools');
  const group = ribbonGroup(page, 'OCR');
  const trigger = group.locator('[data-command="document.export-searchable"]');
  // ITS TOOLTIP ON KEYBOARD FOCUS, the way the ribbon shows a caption's full title without a pointer on it.
  await trigger.focus();
  await page.keyboard.press('Shift');
  const tip = page.locator('.m-tooltip');
  await expect(tip).toHaveText('Export a searchable copy');
  await shootAround(page, 'export-a-searchable-copy-1', [group, tip], 8);
});

test('document-panel-1', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const panel = page.locator('.m-document-panel');
  await expect(panel.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  await shoot(page, 'document-panel-1', panel, 8);
});

test('bookmarks-and-links-1', async ({ page }) => {
  // A NESTED OUTLINE, and two links on page 1 into the document. Pages are the kernel's 0-based indices.
  await openApp(page, {
    destinations: [
      { title: 'Summary', page: 0, depth: 0 },
      { title: 'Revenue', page: 1, depth: 0 },
      { title: 'Northern region', page: 1, depth: 1 },
      { title: 'Southern region', page: 2, depth: 1 },
      { title: 'Costs', page: 3, depth: 0 },
      { title: 'Outlook', page: 5, depth: 0 },
    ],
    pageLinks: [
      [
        { kind: 'internal', page: 3, bounds: { x0: 72, y0: 634, x1: 475, y1: 648 } },
        { kind: 'internal', page: 5, bounds: { x0: 72, y0: 610, x1: 475, y1: 624 } },
      ],
    ],
  });
  await openDocument(page);
  const panel = page.locator('.m-document-panel');
  await panel.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(panel.getByText('Links on this page')).toBeVisible();
  await shoot(page, 'bookmarks-and-links-1', panel, 8);
});

test('comments-list-1', async ({ page }) => {
  // A REVIEWED DOCUMENT'S MARKS as `document.annotations` lists them: two notes and a highlight on page 1, a reply to
  // the first note, a rectangle on page 3 and a highlight on page 5, by two reviewers.
  await openApp(page, {
    annotations: [
      { page: 0, index: 0, kind: 'sticky-note', rect: { x0: 520, y0: 690, x1: 540, y1: 710 }, author: 'Priya Shah' },
      { page: 0, index: 1, kind: 'highlight', rect: { x0: 72, y0: 633, x1: 475, y1: 647 }, author: 'Priya Shah' },
      { page: 0, index: 2, kind: 'sticky-note', rect: { x0: 520, y0: 690, x1: 540, y1: 710 }, author: 'Tom Okafor', inReplyTo: 0 },
      { page: 0, index: 3, kind: 'sticky-note', rect: { x0: 520, y0: 560, x1: 540, y1: 580 }, author: 'Tom Okafor' },
      { page: 2, index: 0, kind: 'square', rect: { x0: 70, y0: 500, x1: 480, y1: 600 }, author: 'Tom Okafor' },
      { page: 4, index: 0, kind: 'highlight', rect: { x0: 72, y0: 585, x1: 475, y1: 599 }, author: 'Priya Shah' },
    ],
  });
  await openDocument(page);
  const panel = page.locator('.m-document-panel');
  await panel.getByRole('tab', { name: 'Comments' }).click();
  await expect(panel.getByText('Reply', { exact: true })).toBeVisible();
  await shoot(page, 'comments-list-1', panel, 8);
});

test('delete-form-fields-1', async ({ page }) => {
  const field = (index: number, name: string, value: string, y: number): NonNullable<SceneShim['formFields']>[number][number] => ({
    page: 0,
    index,
    kind: 'text',
    name,
    values: [value],
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: { x0: 180, y0: y - 2, x1: 520, y1: y + 14 },
  });
  await openApp(page, {
    ...openedAs(await formPdf(), 'Membership application.pdf'),
    formFields: [
      [
        field(0, 'full_name', 'Ada Lovelace', 640),
        field(1, 'email_address', 'ada@example.com', 600),
        field(2, 'phone', '', 560),
        field(3, 'date_of_birth', '', 520),
      ],
    ],
  });
  await openDocument(page);
  const panel = page.locator('.m-document-panel');
  await panel.getByRole('tab', { name: 'Forms' }).click();
  const remove = panel.getByRole('button', { name: 'Delete this field' }).first();
  await expect(remove).toBeVisible();
  // ITS TOOLTIP ON KEYBOARD FOCUS, standing in for the pointer the picture cannot keep.
  await remove.focus();
  await page.keyboard.press('Shift');
  await shootAround(page, 'delete-form-fields-1', [panel.locator('li').first(), page.locator('.m-tooltip')], 8);
});
